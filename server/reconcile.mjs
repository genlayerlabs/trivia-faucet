import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { VAULT_ABI } from "../shared/abi.mjs";
import { createService } from "./service.mjs";
const requestId = process.argv[2];
if (!/^0x[0-9a-fA-F]{64}$/.test(requestId || ""))
  throw new Error("Usage: npm run reconcile -- <request ID>");
const config = JSON.parse(
  readFileSync(process.env.TRIVIA_CONFIG || "server/config.json", "utf8"),
);
const provider = new JsonRpcProvider(config.rpcUrl);
const signer = new Wallet(process.env.FAUCET_ADMIN_PRIVATE_KEY, provider);
await createService({ provider, signer, config }).preflight();
const vault = new Contract(config.vault, VAULT_ABI, signer);
await vault.reconcile.staticCall(BigInt(requestId));
const tx = await vault.reconcile(BigInt(requestId));
console.log("Reconciliation transaction:", tx.hash);
await tx.wait();
