import { createClient, createAccount, abi } from 'genlayer-js';
import { chains } from 'genlayer-js';
import { CalldataAddress } from 'genlayer-js/types';
import { ethers, formatEther, parseEther } from 'ethers';

const CONTRACT = '0xDF0bb9da188eeA054E9c3B78d4EDD6d16CD57F09';
const VAULT = '0x7a0C406351E00fA5A04F1B547d3A8bD0a00f0c69';
const RPC_URL = 'https://rpc-bradbury.genlayer.com';
const CONSENSUS_MAIN = '0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D';
const CHAIN = chains.testnetBradbury;

// HTTPS RPC for balance queries, gen_call reads, and EVM transactions
const provider = new ethers.JsonRpcProvider(RPC_URL);

// genlayer-js client for gen_call reads + getTransaction polling
const glClient = createClient({ endpoint: RPC_URL, chain: CHAIN });

// Faucet wallet for sending transactions
const FAUCET_PK = import.meta.env.VITE_FAUCET_PK as string;
const faucetWallet = FAUCET_PK ? new ethers.Wallet(FAUCET_PK, provider) : null;

const REWARD_PER_GRADE = 10;
const INITIAL_FUNDING = parseEther('1000');

// ---- localStorage helpers ----

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

// ---- Balance queries (ethers) ----

export async function getFaucetBalance(): Promise<string> {
  const balance = await provider.getBalance(VAULT);
  return formatGEN(balance);
}

export async function getWalletBalance(address: string): Promise<string> {
  const balance = await provider.getBalance(address);
  return formatGEN(balance);
}

export async function getRawBalance(address: string): Promise<bigint> {
  return provider.getBalance(address);
}

// ---- Contract reads (gen_call via genlayer-js) ----

export async function getTotalDistributed(): Promise<string> {
  try {
    const raw = await glClient.readContract({
      address: CONTRACT as any,
      functionName: 'get_total_distributed',
      args: [],
    });
    return formatGEN(raw);
  } catch {
    const balance = await provider.getBalance(VAULT);
    const distributed = INITIAL_FUNDING - balance;
    if (distributed <= 0n) return '0 GEN';
    return formatGEN(distributed);
  }
}

export async function getUserClaims(address: string): Promise<string> {
  try {
    const raw = await glClient.readContract({
      address: CONTRACT as any,
      functionName: 'get_user_claims',
      args: [new CalldataAddress(ethers.getBytes(address))],
    });
    return formatGEN(raw);
  } catch {
    const claims = getLocalClaims(address);
    return claims > 0 ? `${claims.toFixed(1)} GEN` : '0 GEN';
  }
}

// ---- Write: submit via ethers directly to ConsensusMain ----

export const EXPLORER_URL = 'https://explorer-bradbury.genlayer.com';

const CONSENSUS_MAIN_ABI = [
  'function addTransaction(address _sender, address _recipient, uint256 _numOfInitialValidators, uint256 _maxRotations, bytes _calldata, uint256 _validUntil) payable',
];

export async function submitTrivia(
  question: string,
  answer: string,
  recipient: string,
): Promise<string> {
  if (!faucetWallet) throw new Error('Faucet wallet not configured');

  // Encode inner calldata using GenVM calldata format
  // Wrap recipient as CalldataAddress so it encodes as Address type, not string
  const recipientAddr = new CalldataAddress(ethers.getBytes(recipient));
  const calldataObj = abi.calldata.makeCalldataObject('answer_trivia', [question, answer, recipientAddr], undefined);
  const encodedCalldata = abi.calldata.encode(calldataObj);
  const innerBytes = abi.transactions.serialize([encodedCalldata, false]);

  const consensusMain = new ethers.Contract(CONSENSUS_MAIN, CONSENSUS_MAIN_ABI, faucetWallet);

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const tx = await consensusMain.addTransaction(
        faucetWallet.address,
        CONTRACT,
        5,  // numOfInitialValidators
        3,  // maxRotations
        innerBytes,
        0,  // validUntil
        { value: 0 },
      );

      const receipt = await tx.wait();
      if (receipt.status !== 1) throw new Error('Transaction reverted');

      // Extract txId from the ConsensusMain log (topics[1] is the txId)
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === CONSENSUS_MAIN.toLowerCase() && log.topics.length >= 2) {
          return log.topics[1];
        }
      }

      throw new Error('Could not extract transaction ID from receipt');
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  throw lastError;
}

// ---- Consensus queries via ConsensusData contract (ethers) ----

const CONSENSUS_DATA = '0x85D7bf947A512Fc640C75327A780c90847267697';
const CONSENSUS_DATA_ABI = [
  'function getTransactionData(bytes32 txId, uint256 timestamp) view returns (tuple(uint256 currentTimestamp, address sender, address recipient, uint256 initialRotations, uint256 txSlot, uint256 createdTimestamp, uint256 lastVoteTimestamp, bytes32 randomSeed, uint8 result, bytes32 txExecutionHash, bytes txCalldata, bytes eqBlocksOutputs, tuple(uint8 messageType, address recipient, uint256 value, bytes data, bool onAcceptance, uint256 saltNonce)[] messages, uint8 queueType, uint256 queuePosition, address activator, address lastLeader, uint8 status))',
];
// Status enum: 0=Pending,1=Proposing,2=Committing,3=LeaderRevealing,4=Revealing,5=Decided,6=Appeal,7=Finalized
const STATUS_ACCEPTED = 5; // Decided (accepted)
const STATUS_FINALIZED = 7;

const consensusData = new ethers.Contract(CONSENSUS_DATA, CONSENSUS_DATA_ABI, provider);

async function getTxData(txHash: string) {
  const ts = Math.round(Date.now() / 1000);
  return consensusData.getTransactionData(txHash, ts);
}

export async function waitForAcceptance(
  txId: string,
  retries = 120,
  interval = 5000,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const tx = await getTxData(txId);
      const status = Number(tx.status);
      if (status >= STATUS_ACCEPTED) return;
    } catch {
      // tx may not be indexed yet
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('Consensus timeout — transaction may still be processing.');
}

export async function getTransactionGrade(
  txHash: string,
  recipient: string,
): Promise<{ grade: number; rewardGEN: number }> {
  const tx = await getTxData(txHash);
  if (tx.messages && tx.messages.length > 0) {
    const msg = tx.messages[0];
    const iface = new ethers.Interface(['function fundWallet(address wallet, uint256 amount)']);
    const decoded = iface.decodeFunctionData('fundWallet', msg.data);
    const amount = decoded[1]; // uint256
    const rewardGEN = Number(formatEther(amount));
    const grade = Math.round(rewardGEN / REWARD_PER_GRADE);
    saveClaim(recipient, rewardGEN);
    return { grade: Math.max(1, Math.min(5, grade)), rewardGEN };
  }
  throw new Error('No messages found in transaction');
}

export async function waitForFinalization(
  txHash: string,
  onStatusUpdate: (minutesElapsed: number, finalized: boolean) => void,
  maxMinutes = 35,
): Promise<{ finalized: boolean }> {
  const startTime = Date.now();
  const interval = 60_000; // 1 minute

  for (let i = 0; i < maxMinutes; i++) {
    const minutesElapsed = Math.round((Date.now() - startTime) / 60_000);
    try {
      const tx = await getTxData(txHash);
      if (Number(tx.status) === STATUS_FINALIZED) {
        onStatusUpdate(minutesElapsed, true);
        return { finalized: true };
      }
    } catch {
      // tx fetch may fail transiently
    }
    onStatusUpdate(minutesElapsed, false);
    await new Promise((r) => setTimeout(r, interval));
  }
  return { finalized: false };
}

export function isWriteReady(): boolean {
  return faucetWallet !== null;
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
