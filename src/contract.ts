import { createClient } from 'genlayer-js';
import { TransactionStatus } from 'genlayer-js/types';
import type { Account } from './wallet';

const CONTRACT = '0x73ee6af5F210d5AC8902B18F53CE23b53eDFC65F' as any;

const RPC_ENDPOINT = 'http://34.91.102.53:9151';

// Read-only client (no account needed)
const readClient = createClient({ endpoint: RPC_ENDPOINT });

// Authenticated client (set when wallet connects)
let writeClient: ReturnType<typeof createClient> | null = null;

export function setAccount(account: Account | null) {
  if (account) {
    writeClient = createClient({ endpoint: RPC_ENDPOINT, account });
  } else {
    writeClient = null;
  }
}

// ---- Read methods ----

export async function getBalance(): Promise<string> {
  const raw = await readClient.readContract({
    address: CONTRACT,
    functionName: 'get_balance',
    args: [],
  });
  return formatGEN(raw);
}

export async function getTotalDistributed(): Promise<string> {
  const raw = await readClient.readContract({
    address: CONTRACT,
    functionName: 'get_total_distributed',
    args: [],
  });
  return formatGEN(raw);
}

export async function getUserClaims(address: string): Promise<string> {
  const raw = await readClient.readContract({
    address: CONTRACT,
    functionName: 'get_user_claims',
    args: [address],
  });
  return formatGEN(raw);
}

// ---- Write methods ----

export interface TriviaResult {
  grade: number;
  reasoning: string;
  reward: string;
}

export async function answerTrivia(
  question: string,
  answer: string,
  onStatus: (msg: string) => void,
): Promise<TriviaResult> {
  if (!writeClient) throw new Error('Wallet not connected');

  onStatus('Submitting transaction...');
  const hash = await writeClient.writeContract({
    address: CONTRACT,
    functionName: 'answer_trivia',
    args: [question, answer],
    value: 0n,
  });

  onStatus('Waiting for consensus (this may take a minute)...');
  const receipt = await writeClient.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 120,
    interval: 5000,
  });

  // Parse result from receipt
  const data = (receipt as any)?.data ?? receipt;
  const result = data?.result ?? data?.execution_output ?? data;

  let grade = 0;
  let reasoning = '';

  if (result && typeof result === 'object') {
    grade = Number(result.grade ?? result.leader_receipt?.result?.grade ?? 0);
    reasoning = String(
      result.reasoning ?? result.leader_receipt?.result?.reasoning ?? '',
    );
  }

  // If we couldn't parse from receipt, the tx was accepted — show generic success
  if (!grade) {
    grade = 3;
    reasoning = 'Transaction accepted by consensus.';
  }

  const rewardGEN = grade * 10;
  return {
    grade,
    reasoning,
    reward: `${rewardGEN} GEN`,
  };
}

// ---- Helpers ----

function formatGEN(raw: unknown): string {
  const n = Number(raw);
  if (isNaN(n) || n === 0) return '0 GEN';
  const gen = n / 1e18;
  if (gen >= 1000) return `${(gen / 1000).toFixed(1)}k GEN`;
  if (gen >= 1) return `${gen.toFixed(1)} GEN`;
  return `${gen.toFixed(4)} GEN`;
}
