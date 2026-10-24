import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury, studioDevnet } from "genlayer-js/chains";
import { CalldataAddress } from "genlayer-js/types";
import { keccak256 } from "ethers";

// Run with Node --env-file. Keys and authenticated upstream URLs stay local.
// Default is quote/signing preflight only. --submit authorizes one journaled send.
const [sourcePath, journalPath] = process.argv
  .slice(2)
  .filter((x) => !x.startsWith("--"));
if (!sourcePath || !journalPath)
  throw new Error(
    "Usage: node --env-file=... scripts/deploy-bradbury.mjs SOURCE JOURNAL [--submit | --status]",
  );
const submit = process.argv.includes("--submit");
const statusOnly = process.argv.includes("--status");
if (submit && statusOnly) throw new Error("Choose --submit or --status");
const config = JSON.parse(
  readFileSync(new URL("../src/deployment.json", import.meta.url)),
);
const source = readFileSync(sourcePath);
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const validated =
  "b4370f9ae7dc6c1aa4d764a155706b524bc058c826ff5c99b9af17191454296e";
if (sourceSha256 !== validated)
  throw new Error(
    "Source differs from the Studio-validated contract; re-profile before deployment",
  );
const key = process.env.TRIVIA_FAUCET_PRIVATE_KEY;
if (!key) throw new Error("TRIVIA_FAUCET_PRIVATE_KEY is required");
const signer = createAccount(key);
if (signer.address.toLowerCase() !== config.admin.toLowerCase())
  throw new Error("Unexpected faucet signer");
if (
  testnetBradbury.consensusMainContract.address.toLowerCase() !==
  config.consensusMain.toLowerCase()
)
  throw new Error("SDK consensus target mismatch");
if (!statusOnly && existsSync(journalPath))
  throw new Error(
    "Journal already exists; reconcile its recorded transaction before any new attempt",
  );
const json = (value) =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
const record = statusOnly
  ? JSON.parse(readFileSync(journalPath))
  : {
      sdk: "2.0.0-rc.2",
      sourceSha256,
      chainId: config.chainId,
      consensusMain: config.consensusMain,
      vault: config.vault,
      admin: signer.address,
      checkedAt: new Date().toISOString(),
    };
const save = () =>
  writeFileSync(journalPath, json(record) + "\n", { mode: 0o600 });
const upstream =
  "https://rpc.testnet-chain.genlayer.com" +
  (process.env.CONDUIT_API_KEY
    ? "/" + encodeURIComponent(process.env.CONDUIT_API_KEY)
    : "");
// SDK rc.2's policy call sets gasPrice but omits from. Nitro checks balance
// even for eth_call. Supplying the funded sender preserves the live price.
const server = createServer(async (request, response) => {
  let payload;
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    payload = JSON.parse(body);
    if (payload.method === "eth_call" && !payload.params[0].from)
      payload.params[0].from = signer.address;
    if (payload.method === "eth_sendRawTransaction") {
      if (!submit || record.evmHash)
        throw new Error("Duplicate or unauthorized broadcast");
      record.evmHash = keccak256(payload.params[0]);
      record.broadcastState = "prepared; reconcile this hash if interrupted";
      save(); // Persist the signed envelope hash BEFORE sending. Never replay it here.
    } else if (
      !/^(eth_call|eth_get\w+|eth_chainId|eth_blockNumber|eth_gasPrice|eth_estimateGas|net_version)$/.test(
        payload.method,
      )
    ) {
      throw new Error("Unexpected RPC method");
    }
    const result = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    response.setHeader("content-type", "application/json");
    response.end(await result.text());
  } catch {
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: payload?.id ?? 1,
        error: {
          code: -32000,
          message: "RPC relay failed; reconcile the journal before retrying",
        },
      }),
    );
  }
});
// Hosted SDK errors may contain raw server internals. This operator command
// publishes only the explicit sanitized records below.
const reportError = console.error;
console.error = () =>
  reportError(
    "SDK RPC failed; see the sanitized outcome or reconcile the journal.",
  );
let client;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const account = {
    ...signer,
    signTransaction: async (transaction) => {
      // rc.2 can fall back to 200k gas when estimation fails. Never broadcast that.
      if (transaction.gas < 500000n)
        throw new Error("Deployment gas estimate failed or unexpectedly low");
      record.envelope = {
        nonce: transaction.nonce,
        gasLimit: transaction.gas,
        gasPrice: transaction.gasPrice,
        feeValue: transaction.value,
        maximumGasCost: transaction.gas * transaction.gasPrice,
      };
      if (!submit) {
        console.log(json(record));
        throw new Error("QUOTE_ONLY_COMPLETE");
      }
      return signer.signTransaction(transaction);
    },
  };
  client = createClient({
    chain: testnetBradbury,
    account,
    endpoint: "http://127.0.0.1:" + server.address().port,
  });
  if (statusOnly) {
    const tx = await client.getTransaction({ hash: record.txId });
    record.outcome = {
      checkedAt: new Date().toISOString(),
      status: tx.status,
      lifecycle: tx.lifecycle,
      executionResult: tx.txExecutionResult,
      executionResultName: tx.txExecutionResultName,
      recipient: tx.recipient,
    };
    record.outcome.usableDeployment =
      tx.lifecycle.state === "finalized" && tx.txExecutionResult === 1;
    save();
    console.log(json(record.outcome));
  } else {
    const genesis = await client.request({
      method: "eth_getBlockByNumber",
      params: ["0x0", false],
    });
    if (
      genesis.hash !==
      "0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4"
    )
      throw new Error("Wrong Bradbury genesis");
    const [latest, pending] = await Promise.all(
      ["latest", "pending"].map((tag) =>
        client.request({
          method: "eth_getTransactionCount",
          params: [signer.address, tag],
        }),
      ),
    );
    if (latest !== pending)
      throw new Error(
        "Faucet signer has an outstanding envelope; reconcile it first",
      );
    const studio = createClient({ chain: studioDevnet });
    const measured = await studio.getTransaction({
      hash: "0x126d4ff39991c7d37c480b84e60085873673ff83ab42a0997658112309ad7daa",
    });
    if (
      measured.lifecycle.state !== "finalized" ||
      measured.lifecycle.outcome !== "accepted" ||
      Number(measured.txExecutionResult) !== 1
    )
      throw new Error("Studio measurement must be finalized and accepted");
    record.studioMeasurement = {
      transaction: measured.hash,
      fees: measured.fees,
    };
    const fees = await client.estimateTransactionFees({
      executionBudgetPerRound: BigInt(config.deploymentExecutionBudget),
      leaderTimeunitsAllocation: BigInt(
        config.feesDistribution.leaderTimeunitsAllocation,
      ),
      validatorTimeunitsAllocation: BigInt(
        config.feesDistribution.validatorTimeunitsAllocation,
      ),
      appealRounds: 0n,
      rotations: [0n],
      totalMessageFees: 0n,
    });
    // Operator-selected 100x execution allowance; retain a hard deposit ceiling.
    if (fees.feeValue > 3n * 10n ** 18n)
      throw new Error("Deployment fee exceeds 3 GEN ceiling");
    record.estimate = fees;
    console.log(
      json({
        feeValue: fees.feeValue,
        studioExecutionConsumed: measured.fees.consumed.executionConsumed,
        messageBudget: fees.distribution.totalMessageFees,
      }),
    );
    record.txId = await client.deployContract({
      code: source,
      args: [new CalldataAddress(Buffer.from(config.vault.slice(2), "hex"))],
      consensusMaxRotations: 0,
      fees,
    });
    record.broadcastState = "envelope confirmed; consensus outcome pending";
    save();
    console.log(json({ txId: record.txId, evmHash: record.evmHash }));
  }
} catch (error) {
  if (error.message !== "QUOTE_ONLY_COMPLETE") {
    reportError(
      error.shortMessage || error.name || "Deployment failed; inspect journal",
    );
    process.exitCode = 1;
  }
} finally {
  console.error = reportError;
  server.close();
}
