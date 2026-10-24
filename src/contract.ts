import { Wallet, formatEther, hexlify, randomBytes } from "ethers";
import { createService } from "../shared/client.mjs";
import deployment from "./deployment.json";
import { FaucetProvider } from "../shared/provider.mjs";

// The operator explicitly uses a public, low-balance browser signer.
const key = import.meta.env.VITE_TRIVIA_FAUCET_PRIVATE_KEY || "";
const provider = new FaucetProvider(deployment.rpcUrl);
const signer = key ? new Wallet(key, provider) : null;
if (signer && signer.address.toLowerCase() !== deployment.admin.toLowerCase())
  throw new Error("Faucet signing key does not match the configured wallet");
const service = createService({ provider, signer, config: deployment });
let ready: Promise<void> | undefined;
export const EXPLORER_URL = "https://explorer-bradbury.genlayer.com";
export interface Admission {
  dailyRemaining: number;
  userPending: number;
  recentGlobal: number;
  globalPending: number;
  retryAt: number;
  now: number;
  reason: string | null;
  balance: string;
  totalDistributed: string;
  claimed: string;
  credits: string;
  walletBalance: string;
}
export interface RequestState {
  exists: boolean;
  requestId: string;
  txId: string;
  recipient: string;
  status: number;
  settled: boolean;
  reward: string;
  credits: string;
}
export interface SavedRequest {
  confirmed?: boolean;
  requestId: string;
  recipient: string;
  question: string;
  answer: string;
}
const STORAGE_KEY = "trivia-faucet-requests-v2";

export function isWriteReady() {
  return Boolean(
    deployment.enabled &&
      signer &&
      /^0x[0-9a-fA-F]{40}$/.test(deployment.vault),
  );
}
export async function getAdmission(address: string): Promise<Admission> {
  return service.admission(address);
}
export async function getRequest(id: string): Promise<RequestState> {
  return service.request(id) as Promise<RequestState>;
}
export function savedRequests(): SavedRequest[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}
export function saveRequests(requests: SavedRequest[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
}
export function forgetRequest(id: string) {
  saveRequests(savedRequests().filter((request) => request.requestId !== id));
}
export async function submitTrivia(
  question: string,
  answer: string,
  recipient: string,
) {
  // Save before broadcasting. Retries must use the same on-chain request ID.
  const existing = savedRequests().find(
    (request) =>
      !request.confirmed &&
      request.recipient.toLowerCase() === recipient.toLowerCase() &&
      request.question === question &&
      request.answer === answer,
  );
  const request = existing || {
    requestId: hexlify(randomBytes(32)),
    question,
    answer,
    recipient,
  };
  if (!existing) saveRequests([...savedRequests(), request]);
  if (!isWriteReady())
    throw new Error("Faucet signing wallet is not configured");
  ready ||= service.preflight().catch((error: Error) => {
    ready = undefined;
    throw error;
  });
  await ready;
  const result = (await service.submit(request)) as RequestState;
  if (result.exists)
    saveRequests(
      savedRequests().map((item) =>
        item.requestId === request.requestId
          ? { ...item, confirmed: true }
          : item,
      ),
    );
  return result;
}
export function formatGEN(wei: string) {
  return `${Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 4 })} GEN`;
}
export function statusLabel(state: RequestState): string {
  if (!state.exists)
    return "Submission unconfirmed — retry the same answer to check safely";
  if (state.settled) {
    if (BigInt(state.reward) === 0n) return "Completed without a reward";
    if (BigInt(state.credits) > 0n)
      return "Finalized — reward available to claim from vault";
    return `Finalized — ${formatGEN(state.reward)} paid`;
  }
  switch (state.status) {
    case 5:
      return "Accepted — awaiting finalization; reward is provisional";
    case 7:
      return "Finalized — awaiting reward settlement";
    case 8:
      return "Canceled — awaiting queue cleanup";
    case 6:
      return "Undetermined — awaiting finalization";
    case 9:
    case 10:
      return "Appeal in progress";
    case 11:
    case 12:
      return "Timeout resolution in progress";
    default:
      return "Consensus in progress";
  }
}
