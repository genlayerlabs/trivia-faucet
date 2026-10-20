import { formatEther, hexlify, randomBytes } from "ethers";

const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error("Faucet submissions are not configured yet");
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(135000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Faucet request failed");
  return result;
}
export function isWriteReady() {
  return Boolean(API_URL);
}
export function getAdmission(address: string) {
  return api<Admission>(`/api/admission/${encodeURIComponent(address)}`);
}
export function getRequest(id: string) {
  return api<RequestState>(`/api/requests/${id}`);
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
  // Save before sending. An HTTP timeout must not cause a fresh on-chain play.
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
  const result = await api<RequestState>("/api/trivia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
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
