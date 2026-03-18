import { createAccount, generatePrivateKey } from 'genlayer-js';

const STORAGE_KEY = 'trivia-faucet-pk';

export type Account = ReturnType<typeof createAccount>;

export function loadWallet(): Account | null {
  const pk = localStorage.getItem(STORAGE_KEY);
  if (!pk) return null;
  try {
    return createAccount(pk as `0x${string}`);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function generateWallet(): Account {
  const pk = generatePrivateKey();
  const account = createAccount(pk);
  localStorage.setItem(STORAGE_KEY, pk);
  return account;
}

export function importWallet(privateKey: string): Account {
  let pk = privateKey.trim();
  if (!pk.startsWith('0x')) pk = '0x' + pk;
  const account = createAccount(pk as `0x${string}`);
  localStorage.setItem(STORAGE_KEY, pk);
  return account;
}

export function disconnectWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
