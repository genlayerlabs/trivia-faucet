import {
  AbiCoder,
  Contract,
  Interface,
  MaxUint256,
  ZeroAddress,
  ZeroHash,
  getAddress,
  getBytes,
  hexlify,
} from "ethers";
import { abi } from "genlayer-js";
import { CalldataAddress } from "genlayer-js/types";
import { VAULT_ABI, LIFECYCLE_ABI, FEE_ABI } from "../shared/abi.mjs";

export function validateSubmission(body) {
  if (
    !body ||
    !/^0x[0-9a-fA-F]{64}$/.test(body.requestId) ||
    BigInt(body.requestId) === 0n
  )
    throw new Error("Invalid request ID");
  const recipient = getAddress(body.recipient);
  if (recipient === ZeroAddress) throw new Error("Invalid recipient");
  for (const field of ["question", "answer"]) {
    if (
      typeof body[field] !== "string" ||
      !body[field].trim() ||
      body[field].length > 4000
    )
      throw new Error(`Invalid ${field}`);
  }
  return {
    requestId: body.requestId,
    recipient,
    question: body.question.trim(),
    answer: body.answer.trim(),
  };
}

export function admissionReason(state, now) {
  if (Number(state.dailyRemaining) === 0)
    return "Five attempts used in the last 24 hours";
  if (Number(state.userPending) >= 5)
    return "Five transactions are still pending";
  if (Number(state.retryAt) > now)
    return "Faucet rate limit or cooldown is active";
  if (Number(state.globalPending) >= 50) return "Faucet queue is full";
  if (Number(state.recentGlobal) >= 50)
    return "Fifty submissions in the last ten minutes";
  return null;
}

export function encodeAnswer({ question, answer, recipient, requestId }) {
  const call = abi.calldata.makeCalldataObject(
    "answer_trivia",
    [
      question,
      answer,
      new CalldataAddress(getBytes(recipient)),
      BigInt(requestId),
    ],
    undefined,
  );
  return hexlify(
    abi.transactions.serialize([abi.calldata.encode(call), false]),
  );
}

export function createService({ provider, signer, config }) {
  const vault = new Contract(config.vault, VAULT_ABI, signer);
  const lifecycle = new Contract(config.consensusData, LIFECYCLE_ABI, provider);
  const feeManager = new Contract(config.feeManager, FEE_ABI, provider);
  let queue = Promise.resolve();
  let uncertainSubmission = false;
  const serialize = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  const iface = new Interface(VAULT_ABI);

  async function preflight() {
    if ((await provider.getNetwork()).chainId !== BigInt(config.chainId))
      throw new Error("Wrong RPC chain");
    for (const address of [
      config.vault,
      config.ghost,
      config.consensusMain,
      config.consensusData,
      config.feeManager,
      config.messages,
      config.transactionManager,
    ])
      if ((await provider.getCode(address)) === "0x")
        throw new Error(`No deployed code at ${address}`);
    if (
      getAddress(await vault.admin()) !== getAddress(await signer.getAddress())
    )
      throw new Error("Signer is not the vault admin");
    for (const [method, expected] of [
      ["fundingCaller", config.ghost],
      ["consensus", config.consensusMain],
      ["lifecycle", config.consensusData],
      ["messages", config.messages],
      ["transactions", config.transactionManager],
    ])
      if (getAddress(await vault[method]()) !== getAddress(expected))
        throw new Error(`Vault ${method} mismatch`);
    // Fail closed on legacy Bradbury ABIs; never guess a numeric state from old tuples.
    await lifecycle.getStoredTransactionStatus(ZeroHash);
    await vault.admission(await signer.getAddress());
    await feeManager.calculateRoundFees(
      config.feesDistribution,
      config.initialValidators,
      0,
    );
  }
  async function admission(address) {
    const user = getAddress(address);
    const [state, block, balance, total, claimed, credit] = await Promise.all([
      vault.admission(user),
      provider.getBlock("latest"),
      provider.getBalance(config.vault),
      vault.totalDistributed(),
      vault.claimed(user),
      vault.credits(user),
    ]);
    return {
      dailyRemaining: Number(state.dailyRemaining),
      userPending: Number(state.userPending),
      recentGlobal: Number(state.recentGlobal),
      globalPending: Number(state.globalPending),
      retryAt: Number(state.retryAt),
      now: block.timestamp,
      reason: admissionReason(state, block.timestamp),
      balance: balance.toString(),
      totalDistributed: total.toString(),
      claimed: claimed.toString(),
      credits: credit.toString(),
      walletBalance: (await provider.getBalance(user)).toString(),
    };
  }
  async function request(requestId) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(requestId))
      throw new Error("Invalid request ID");
    const entry = await vault.requests(BigInt(requestId));
    if (entry.recipient === ZeroAddress) return { exists: false };
    const status = Number(
      await lifecycle.getStoredTransactionStatus(entry.txId),
    );
    return {
      exists: true,
      requestId,
      txId: entry.txId,
      recipient: entry.recipient,
      status,
      settled: entry.settled,
      reward: entry.reward.toString(),
      credits: (await vault.credits(entry.recipient)).toString(),
    };
  }
  async function submit(body) {
    const input = validateSubmission(body);
    return serialize(async () => {
      const existing = await request(input.requestId);
      if (existing.exists) {
        if (getAddress(existing.recipient) !== input.recipient)
          throw new Error("Request recipient mismatch");
        return existing;
      }
      // A transport error after broadcast is ambiguous. Stop writes until the
      // operator reconciles the transaction; never blindly create another play.
      if (uncertainSubmission)
        throw new Error(
          "Submission reconciliation required; try reading your request status",
        );
      const state = await admission(input.recipient);
      if (state.reason) throw new Error(state.reason);
      const gasLimit = BigInt(config.messageGasLimit);
      const maxGasPrice = BigInt(config.messageMaxGasPrice);
      const budget = gasLimit * maxGasPrice;
      const feesDistribution = {
        ...config.feesDistribution,
        executionConsumed: 0,
        totalMessageFees: budget,
      };
      const primary = await feeManager.calculateRoundFees(
        feesDistribution,
        config.initialValidators,
        0,
      );
      const params = {
        sender: config.vault,
        recipient: config.ghost,
        numOfInitialValidators: config.initialValidators,
        maxRotations: config.maxRotations,
        validUntil: state.now + 600,
        saltNonce: 0,
        userValue: 0,
        feesDistribution,
        txCalldata: encodeAnswer(input),
        messageAllocations: [
          {
            messageType: 0,
            onAcceptance: false,
            parentIndex: MaxUint256,
            recipient: config.vault,
            callKey: iface.getFunction("fundWallet").selector.padEnd(66, "0"),
            budget,
            feeParams: AbiCoder.defaultAbiCoder().encode(
              ["uint256", "uint256"],
              [gasLimit, maxGasPrice],
            ),
          },
        ],
      };
      const value = primary + budget;
      await vault.submit.staticCall(
        BigInt(input.requestId),
        input.recipient,
        params,
        { value },
      );
      let broadcast = false;
      try {
        broadcast = true;
        const tx = await vault.submit(
          BigInt(input.requestId),
          input.recipient,
          params,
          { value },
        );
        const receipt = await tx.wait(1, 120000);
        if (!receipt || receipt.status !== 1)
          throw new Error("Submission not confirmed");
        const event = receipt.logs
          .filter(
            (log) => log.address.toLowerCase() === config.vault.toLowerCase(),
          )
          .map((log) => {
            try {
              return iface.parseLog(log);
            } catch {
              return null;
            }
          })
          .find(
            (log) =>
              log?.name === "Submitted" &&
              log.args.requestId === BigInt(input.requestId),
          );
        if (!event) throw new Error("Missing Submitted event");
        return await request(input.requestId);
      } catch (error) {
        if (broadcast) uncertainSubmission = true;
        throw error;
      }
    });
  }
  return { preflight, admission, request, submit };
}
