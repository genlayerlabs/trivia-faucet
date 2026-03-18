import { createClient } from 'genlayer-js';
import { JsonRpcProvider, formatEther } from 'ethers';

const CONTRACT = '0x73ee6af5F210d5AC8902B18F53CE23b53eDFC65F' as any;
const RPC_URL = 'https://zksync-os-testnet-genlayer.zksync.dev';

// ethers provider for direct chain queries (eth_getBalance)
const provider = new JsonRpcProvider(RPC_URL);

// genlayer-js client for contract reads (gen_call)
const readClient = createClient({ endpoint: RPC_URL });

// ---- Chain balance queries (ethers) ----

export async function getFaucetBalance(): Promise<string> {
  const balance = await provider.getBalance(CONTRACT);
  return formatGEN(balance);
}

export async function getWalletBalance(address: string): Promise<string> {
  const balance = await provider.getBalance(address);
  return formatGEN(balance);
}

// ---- Contract read methods (genlayer-js) ----

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

// ---- Helpers ----

function formatGEN(raw: unknown): string {
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
