import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AbiCoder,
  MaxUint256,
  ContractFactory,
  Wallet,
  JsonRpcProvider,
  hexlify,
  randomBytes,
  parseEther,
} from "ethers";
import { createService, encodeAnswer } from "../shared/client.mjs";

// Run against a disposable Hardhat node and the paired consensus artifacts.
// This uses the shared browser client and vault, with only consensus progression mocked.
test("Browser client admission -> current struct/fees -> finalization -> exactly-once reward", async () => {
  if (!process.env.CONSENSUS_ARTIFACTS)
    throw new Error("CONSENSUS_ARTIFACTS is required");
  const provider = new JsonRpcProvider(
    process.env.TEST_RPC || "http://127.0.0.1:18545",
  );
  const owner = await provider.getSigner(0),
    admin = new Wallet(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      provider,
    );
  const alice = await (await provider.getSigner(2)).getAddress();
  async function deploy(path, args = []) {
    const a = JSON.parse(
      readFileSync(resolve(process.env.CONSENSUS_ARTIFACTS, path), "utf8"),
    );
    const c = await new ContractFactory(a.abi, a.bytecode, owner).deploy(
      ...args,
    );
    await c.waitForDeployment();
    return c;
  }
  const mock = await deploy(
    "contracts/test-helpers/MockTriviaConsensus.sol/MockTriviaConsensus.json",
  );
  const vault = await deploy(
    "contracts/trivia/TriviaVault.sol/TriviaVault.json",
    [mock.target, mock.target, mock.target, await admin.getAddress()],
  );
  await (await vault.setFundingCaller(mock.target)).wait();
  await (
    await owner.sendTransaction({
      to: vault.target,
      value: parseEther("10000"),
    })
  ).wait();
  const config = {
    chainId: 31337,
    vault: vault.target,
    ghost: mock.target,
    consensusMain: mock.target,
    consensusData: mock.target,
    feeManager: mock.target,
    messages: mock.target,
    transactionManager: mock.target,
    initialValidators: 5,
    maxRotations: 0,
    messageGasLimit: "5000000",
    messageMaxGasPrice: "1",
    feesDistribution: {
      leaderTimeunitsAllocation: 1,
      validatorTimeunitsAllocation: 1,
      appealRounds: 0,
      executionBudgetPerRound: 1,
      executionConsumed: 0,
      totalMessageFees: 0,
      rotations: [0],
      maxPriceGenPerTimeUnit: 1,
      storageFeeMaxGasPrice: 1,
      receiptFeeMaxGasPrice: 1,
    },
  };
  const service = createService({ provider, signer: admin, config });
  await service.preflight();
  const reader = createService({ provider, signer: null, config });
  assert.equal((await reader.admission(alice)).dailyRemaining, 5);
  const input = {
    requestId: hexlify(randomBytes(32)),
    recipient: alice,
    question: "What is GenLayer?",
    answer: "AI blockchain",
  };
  const [a, b] = await Promise.all([
    service.submit(input),
    service.submit(input),
  ]);
  assert.equal(a.txId, b.txId);
  assert.equal(await vault.totalPending(), 1n);
  assert.equal(await mock.receivedFees(), 5001234n);
  assert.equal(await mock.lastOnAcceptance(), false);
  assert.equal(await mock.lastCalldata(), encodeAnswer(input));
  // Inspect the actual admitted envelope: reserve equals allocated external gas,
  // targets only fundWallet, and cannot execute at acceptance.
  const admitted = await vault.queryFilter(
    vault.filters.Submitted(BigInt(input.requestId)),
  );
  const envelope = await provider.getTransaction(admitted[0].transactionHash);
  const params = vault.interface.parseTransaction(envelope).args[2];
  const allocation = params.messageAllocations[0];
  assert.equal(params.messageAllocations.length, 1);
  assert.equal(allocation.messageType, 0n);
  assert.equal(allocation.onAcceptance, false);
  assert.equal(allocation.parentIndex, MaxUint256);
  assert.equal(allocation.recipient, vault.target);
  assert.equal(
    allocation.callKey,
    vault.interface.getFunction("fundWallet").selector.padEnd(66, "0"),
  );
  const [allocatedGas, cappedPrice] = AbiCoder.defaultAbiCoder().decode(
    ["uint256", "uint256"],
    allocation.feeParams,
  );
  assert.equal(allocatedGas, BigInt(config.messageGasLimit));
  assert.equal(cappedPrice, BigInt(config.messageMaxGasPrice));
  assert.equal(allocation.budget, allocatedGas * cappedPrice);
  assert.equal(params.feesDistribution.totalMessageFees, allocation.budget);
  assert.equal(envelope.value, 1234n + allocation.budget);

  assert.equal((await service.admission(alice)).dailyRemaining, 4);
  await (await mock.setStatus(a.txId, 5)).wait();
  await assert.rejects(
    mock.deliver.staticCall(
      vault.target,
      BigInt(input.requestId),
      alice,
      parseEther("30"),
    ),
  );
  assert.equal((await service.request(input.requestId)).settled, false);
  await (await mock.setStatus(a.txId, 7)).wait();
  await (
    await mock.deliver(
      vault.target,
      BigInt(input.requestId),
      alice,
      parseEther("30"),
    )
  ).wait();
  await (
    await mock.deliver(
      vault.target,
      BigInt(input.requestId),
      alice,
      parseEther("30"),
    )
  ).wait();
  assert.equal(await vault.totalPending(), 0n);
  assert.equal(await vault.claimed(alice), parseEther("30"));
  assert.equal((await service.request(input.requestId)).settled, true);
  assert.equal((await service.admission(alice)).dailyRemaining, 4);
  await assert.rejects(
    createService({ provider, signer: owner, config }).preflight(),
    /not the vault admin/,
  );
  const submissions = Array.from({ length: 4 }, () => ({
    ...input,
    requestId: hexlify(randomBytes(32)),
  }));
  // Independent browser sessions cannot share an in-memory nonce queue.
  const otherBrowser = createService({
    provider,
    signer: new Wallet(admin.privateKey, provider),
    config,
  });
  await Promise.all([
    service.submit(submissions[0]),
    otherBrowser.submit(submissions[1]),
  ]);
  await Promise.all(submissions.slice(2).map((item) => service.submit(item)));
  await assert.rejects(
    service.submit({ ...input, requestId: hexlify(randomBytes(32)) }),
    /Five attempts/,
  );
  assert.equal(await vault.totalPending(), 4n);
});
