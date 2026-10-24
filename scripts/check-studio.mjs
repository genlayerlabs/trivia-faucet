import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { CalldataAddress } from "genlayer-js/types";

// Studio only: the test sender stands in for the vault. This validates GenVM
// execution and emission, not execution of the Solidity payout on Bradbury.
const path = process.argv[2];
if (!path)
  throw new Error("Usage: npm run test:studio -- /path/to/trivia_faucet.py");
const code = readFileSync(path);
const account = createAccount();
const sender = process.env.STUDIO_TEST_SENDER || account.address;
const client = createClient({ chain: studioDevnet, account });
const typedAddress = (address) =>
  new CalldataAddress(Buffer.from(address.slice(2), "hex"));
const schema = await client.getContractSchemaForCode(code);
assert.equal(schema.methods.answer_trivia.params.length, 4);
let address = process.env.STUDIO_TEST_CONTRACT;
let deploymentHash;
if (!address) {
  const fees = await client.estimateTransactionFees({
    executionBudgetPerRound: 10n ** 18n,
  });
  deploymentHash = await client.deployContract({
    code,
    args: [typedAddress(sender)],
    fees,
  });
  console.log("Studio deployment submitted:", deploymentHash);
  const receipt = await client.waitForTransactionReceipt({
    hash: deploymentHash,
    waitUntil: "finalized",
    interval: 3000,
    retries: 120,
  });
  assert.equal(receipt.lifecycle.outcome, "accepted");
  address = receipt.recipient;
}
assert.equal(
  await client.getContractCode(address),
  code.toString("utf8"),
  "Deployed source must match the source under test",
);
const total = await client.readContract({
  address,
  functionName: "get_total_distributed",
  args: [],
});
assert.equal(BigInt(total), 0n);
const args = [
  "What is GenLayer?",
  "GenLayer is a blockchain for Python Intelligent Contracts using AI and Optimistic Democracy consensus.",
  typedAddress(sender),
  1n,
];
const simulation = await client.simulateWriteContract({
  account: { address: sender },
  address,
  functionName: "answer_trivia",
  args,
  includeReceipt: true,
});
assert.equal(simulation.receipt.execution_result, "SUCCESS");
const messages = simulation.receipt.pending_transactions;
assert.equal(messages.length, 1);
assert.equal(messages[0].on, "finalized");
assert.equal(messages[0].is_eth_send, true);
assert.equal(messages[0].address.toLowerCase(), sender.toLowerCase());
assert.equal(BigInt(messages[0].value), 0n);
const checks = [];
for (const [name, changes, caller, expected] of [
  [
    "unauthorized",
    {},
    "0x0000000000000000000000000000000000000001",
    "Only vault can submit",
  ],
  ["zero request", { 3: 0n }, sender, "Invalid or duplicate request"],
  ["empty answer", { 1: "" }, sender, "Answer cannot be empty"],
  ["oversized answer", { 1: "x".repeat(4001) }, sender, "Input too long"],
  [
    "zero recipient",
    { 2: typedAddress("0x" + "00".repeat(20)) },
    sender,
    "Invalid recipient",
  ],
]) {
  await assert.rejects(
    client.simulateWriteContract({
      account: { address: caller },
      address,
      functionName: "answer_trivia",
      args: Object.assign([...args], changes),
    }),
    (error) => {
      const failure = error.cause?.data?.receipt;
      assert.equal(failure?.execution_result, "ERROR");
      const result = Buffer.from(failure.result, "base64");
      assert.equal(result[0], 1);
      assert.match(result.subarray(1).toString("utf8"), new RegExp(expected));
      return true;
    },
  );
  checks.push(name);
}
// Allowlist evidence fields: Studio receipts can contain internal node details.
const evidence = {
  checkedAt: new Date().toISOString(),
  sdk: "2.0.0-rc.2",
  network: studioDevnet.rpcUrls.default.http[0],
  sourceSha256: createHash("sha256").update(code).digest("hex"),
  address,
  sender,
  deploymentHash,
  schema,
  execution: simulation.receipt.execution_result,
  message: {
    recipient: messages[0].address,
    phase: messages[0].on,
    external: messages[0].is_eth_send,
    value: messages[0].value,
  },
  negativeChecks: checks,
  limitation:
    "Studio does not execute arbitrary EVM callbacks or expose their complete calldata in this receipt. Verify the Solidity payout on Bradbury after deployment.",
};
if (process.env.STUDIO_EVIDENCE_PATH)
  writeFileSync(
    process.env.STUDIO_EVIDENCE_PATH,
    JSON.stringify(evidence, null, 2) + "\n",
  );
console.log(JSON.stringify(evidence, null, 2));
