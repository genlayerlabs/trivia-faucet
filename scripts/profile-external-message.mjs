import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ContractFactory,
  Contract,
  JsonRpcProvider,
  JsonRpcSigner,
  parseEther,
  AbiCoder,
  MaxUint256,
  Wallet,
} from "ethers";

// Disposable Hardhat chain only. Consensus reads are mocked; this measures the
// real vault callback branches, not Bradbury's complete message dispatch path.
const provider = new JsonRpcProvider(
  process.env.TEST_RPC || "http://127.0.0.1:18546",
);
if ((await provider.getNetwork()).chainId !== 31337n)
  throw new Error("Local chain required");
if (!process.env.CONSENSUS_ARTIFACTS)
  throw new Error("CONSENSUS_ARTIFACTS required");
const owner = await provider.getSigner(0);
const admin = await provider.getSigner(1);
const artifact = (path) =>
  JSON.parse(readFileSync(resolve(process.env.CONSENSUS_ARTIFACTS, path)));
async function deploy(path, args = []) {
  const a = artifact(path);
  const c = await new ContractFactory(a.abi, a.bytecode, owner).deploy(...args);
  await c.waitForDeployment();
  return c;
}
const mock = await deploy(
  "contracts/test-helpers/MockTriviaConsensus.sol/MockTriviaConsensus.json",
);
const vaultArtifact = "contracts/trivia/TriviaVault.sol/TriviaVault.json";
const vault = await deploy(vaultArtifact, [
  mock.target,
  mock.target,
  mock.target,
  await admin.getAddress(),
]);
await (await vault.setFundingCaller(mock.target)).wait();
await (
  await owner.sendTransaction({ to: vault.target, value: parseEther("1000") })
).wait();
await provider.send("hardhat_impersonateAccount", [mock.target]);
await provider.send("hardhat_setBalance", [mock.target, "0x56bc75e2d63100000"]);
const ghost = new JsonRpcSigner(provider, mock.target);
const callback = new Contract(vault.target, artifact(vaultArtifact).abi, ghost);
const config = JSON.parse(
  readFileSync(new URL("../src/deployment.json", import.meta.url)),
);
const gasLimit = BigInt(config.messageGasLimit);
const amount = parseEther("50");
const samples = [];
for (const scenario of [
  "first payout to new wallet",
  "reward credited after recipient revert",
  "reward credited when recipient needs more transfer gas",
]) {
  const snapshot = await provider.send("evm_snapshot", []);
  const recipient =
    scenario === "first payout to new wallet"
      ? Wallet.createRandom().address
      : (
          await deploy(
            "contracts/test-helpers/MockTriviaConsensus.sol/" +
              (scenario.includes("revert")
                ? "RejectTriviaReward"
                : "GasHungryTriviaReward") +
              ".json",
          )
        ).target;
  const id = BigInt(samples.length + 1);
  const feesDistribution = {
    leaderTimeunitsAllocation: 1,
    validatorTimeunitsAllocation: 1,
    appealRounds: 0,
    executionBudgetPerRound: 1,
    executionConsumed: 0,
    totalMessageFees: gasLimit,
    rotations: [0],
    maxPriceGenPerTimeUnit: 1,
    storageFeeMaxGasPrice: 1,
    receiptFeeMaxGasPrice: 1,
  };
  const params = {
    sender: vault.target,
    recipient: mock.target,
    numOfInitialValidators: 5,
    maxRotations: 0,
    validUntil: 0,
    saltNonce: 0,
    userValue: 0,
    feesDistribution,
    txCalldata: "0x1234",
    messageAllocations: [
      {
        messageType: 0,
        onAcceptance: false,
        parentIndex: MaxUint256,
        recipient: vault.target,
        callKey: vault.interface
          .getFunction("fundWallet")
          .selector.padEnd(66, "0"),
        budget: gasLimit,
        feeParams: AbiCoder.defaultAbiCoder().encode(
          ["uint256", "uint256"],
          [gasLimit, 1],
        ),
      },
    ],
  };
  await (
    await vault
      .connect(admin)
      .submit(id, recipient, params, { value: gasLimit + 1234n })
  ).wait();
  const txId = (await vault.requests(id)).txId;
  await (await mock.setStatus(txId, 7)).wait();
  await (
    await mock.setMessage(
      txId,
      vault.target,
      vault.interface.encodeFunctionData("fundWallet", [id, recipient, amount]),
      false,
    )
  ).wait();
  const estimate = await callback.fundWallet.estimateGas(id, recipient, amount);
  assert(
    (estimate * 150n) / 100n < gasLimit,
    "Configured allocation must cover measured gas with 50% headroom",
  );
  const receipt = await (
    await callback.fundWallet(id, recipient, amount, { gasLimit })
  ).wait();
  assert.equal((await vault.requests(id)).settled, true);
  assert.equal(await vault.totalPending(), 0n);
  if (scenario === "first payout to new wallet")
    assert.equal(await provider.getBalance(recipient), amount);
  else assert.equal(await vault.credits(recipient), amount);
  samples.push({
    scenario,
    estimatedGas: estimate.toString(),
    receiptGasUsed: receipt.gasUsed.toString(),
  });
  await provider.send("evm_revert", [snapshot]);
}
const report = {
  measuredAt: new Date().toISOString(),
  vaultBytecodeSha256: (await import("node:crypto"))
    .createHash("sha256")
    .update(artifact(vaultArtifact).deployedBytecode)
    .digest("hex"),
  environment:
    "Hardhat; real vault, mocked consensus reads, direct authenticated ghost callback",
  limitation:
    "Live Ghost/Messages dispatch and actual Bradbury consensus-read costs still require a successful live IC. No live payout has been claimed.",
  gasLimit: gasLimit.toString(),
  headroomPercent: 50,
  samples,
};
if (process.env.PROFILE_OUTPUT)
  writeFileSync(
    process.env.PROFILE_OUTPUT,
    JSON.stringify(report, null, 2) + "\n",
  );
console.log(JSON.stringify(report, null, 2));
await provider.send("hardhat_stopImpersonatingAccount", [mock.target]);
provider.destroy();
