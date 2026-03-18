import { createClient, createAccount } from 'genlayer-js';
import { chains } from 'genlayer-js';
import { TransactionStatus } from 'genlayer-js/types';
import { JsonRpcProvider, formatEther, parseEther } from 'ethers';

const CONTRACT = '0x438B4aA69550240646bfCa172a8263152b13900a' as any;
const RPC_URL = 'https://zksync-os-testnet-genlayer.zksync.dev';
const CHAIN = chains.testnetBradbury;

// ethers provider for direct chain queries (eth_getBalance)
const provider = new JsonRpcProvider(RPC_URL);

// Hidden faucet wallet — signs transactions on behalf of users
// This wallet is pre-funded with GEN to cover gas fees
const FAUCET_PK = import.meta.env.VITE_FAUCET_PK as `0x${string}`;
const faucetAccount = FAUCET_PK ? createAccount(FAUCET_PK) : null;
const writeClient = faucetAccount
  ? createClient({ endpoint: RPC_URL, chain: CHAIN, account: faucetAccount })
  : null;

const REWARD_PER_GRADE = 10; // 10 GEN per grade point

// Initial funding amount — used to estimate total distributed
const INITIAL_FUNDING = parseEther('1000');

// ---- localStorage helpers for user claims tracking ----

const CLAIMS_KEY = 'trivia-faucet-claims';

function loadClaims(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(CLAIMS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveClaim(address: string, rewardGEN: number): void {
  const claims = loadClaims();
  const addr = address.toLowerCase();
  claims[addr] = (claims[addr] || 0) + rewardGEN;
  localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
}

export function getLocalClaims(address: string): number {
  return loadClaims()[address.toLowerCase()] || 0;
}

// ---- Chain balance queries (ethers) ----

export async function getFaucetBalance(): Promise<string> {
  const balance = await provider.getBalance(CONTRACT);
  return formatGEN(balance);
}

export async function getTotalDistributed(): Promise<string> {
  const balance = await provider.getBalance(CONTRACT);
  const distributed = INITIAL_FUNDING - balance;
  if (distributed <= 0n) return '0 GEN';
  return formatGEN(distributed);
}

export async function getWalletBalance(address: string): Promise<string> {
  const balance = await provider.getBalance(address);
  return formatGEN(balance);
}

export async function getRawBalance(address: string): Promise<bigint> {
  return provider.getBalance(address);
}

// ---- Write methods ----

export const EXPLORER_URL = 'https://explorer-bradbury.genlayer.com';

export interface ProgressCallback {
  onSubmitted: (txHash: string) => void;
  onAccepted: (txHash: string) => void;
  onTransfer: (grade: number, rewardGEN: number) => void;
}

export async function submitTrivia(
  question: string,
  answer: string,
  recipient: string,
): Promise<string> {
  if (!writeClient) throw new Error('Faucet wallet not configured');

  return writeClient.writeContract({
    address: CONTRACT,
    functionName: 'answer_trivia',
    args: [question, answer, recipient],
    value: 0n,
  });
}

export async function waitForAcceptance(txHash: string): Promise<void> {
  if (!writeClient) throw new Error('Faucet wallet not configured');

  await writeClient.waitForTransactionReceipt({
    hash: txHash as any,
    status: TransactionStatus.ACCEPTED,
    retries: 120,
    interval: 5000,
  });
}

export async function waitForTransfer(
  recipient: string,
  balanceBefore: bigint,
  maxRetries = 60,
  interval = 3000,
): Promise<{ grade: number; rewardGEN: number }> {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, interval));
    const balanceNow = await provider.getBalance(recipient);
    if (balanceNow > balanceBefore) {
      const diff = balanceNow - balanceBefore;
      const rewardGEN = Number(formatEther(diff));
      const grade = Math.round(rewardGEN / REWARD_PER_GRADE);
      // Track claim locally
      saveClaim(recipient, rewardGEN);
      return { grade: Math.max(1, Math.min(5, grade)), rewardGEN };
    }
  }
  throw new Error('Transfer not detected — it may still be processing.');
}

export function isWriteReady(): boolean {
  return writeClient !== null;
}

// ---- Helpers ----

export function formatGEN(raw: unknown): string {
  if (typeof raw === 'bigint') {
    const gen = Number(formatEther(raw));
    return fmtGen(gen);
  }
  const n = Number(raw);
  if (isNaN(n) || n === 0) return '0 GEN';
  const gen = n / 1e18;
  return fmtGen(gen);
}

function fmtGen(gen: number): string {
  if (gen === 0) return '0 GEN';
  if (gen >= 1000) return `${(gen / 1000).toFixed(1)}k GEN`;
  if (gen >= 1) return `${gen.toFixed(1)} GEN`;
  return `${gen.toFixed(4)} GEN`;
}
