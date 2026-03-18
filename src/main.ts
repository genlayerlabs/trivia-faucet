import './style.css';
import {
  getFaucetBalance,
  getWalletBalance,
  getTotalDistributed,
  getUserClaims,
} from './contract';

// ---- DOM refs ----

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const faucetBalanceEl = $('faucet-balance');
const totalDistEl = $('total-distributed');

const inputAddress = $<HTMLInputElement>('input-address');
const btnLookup = $<HTMLButtonElement>('btn-lookup');
const addressError = $('address-error');
const walletInfo = $('wallet-info');
const walletAddressEl = $('wallet-address');
const walletBalanceEl = $('wallet-balance');
const userClaimsEl = $('user-claims');

// ---- Address validation ----

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function isValidAddress(addr: string): boolean {
  return ADDRESS_RE.test(addr);
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ---- State ----

let currentAddress: string | null = localStorage.getItem('trivia-faucet-addr');

// ---- Init ----

function init() {
  if (currentAddress && isValidAddress(currentAddress)) {
    showWallet(currentAddress);
  }

  refreshStats();
  setInterval(refreshStats, 30_000);

  btnLookup.addEventListener('click', handleLookup);
  inputAddress.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLookup();
  });

  $('btn-clear').addEventListener('click', () => {
    currentAddress = null;
    localStorage.removeItem('trivia-faucet-addr');
    walletInfo.classList.add('hidden');
    inputAddress.value = '';
    addressError.classList.add('hidden');
  });
}

function handleLookup() {
  const addr = inputAddress.value.trim();
  addressError.classList.add('hidden');

  if (!addr) return;

  if (!isValidAddress(addr)) {
    addressError.textContent = 'Invalid address. Must be 0x followed by 40 hex characters.';
    addressError.classList.remove('hidden');
    return;
  }

  currentAddress = addr;
  localStorage.setItem('trivia-faucet-addr', addr);
  showWallet(addr);
}

function showWallet(addr: string) {
  inputAddress.value = addr;
  walletAddressEl.textContent = shortenAddress(addr);
  walletInfo.classList.remove('hidden');
  refreshWalletData(addr);
}

// ---- Data refresh ----

function refreshStats() {
  getFaucetBalance()
    .then((b) => (faucetBalanceEl.textContent = b))
    .catch((e) => console.error('Failed to fetch faucet balance:', e));

  getTotalDistributed()
    .then((t) => (totalDistEl.textContent = t))
    .catch((e) => console.error('Failed to fetch total distributed:', e));
}

function refreshWalletData(addr: string) {
  walletBalanceEl.textContent = '...';
  userClaimsEl.textContent = '...';

  getWalletBalance(addr)
    .then((b) => (walletBalanceEl.textContent = b))
    .catch(() => (walletBalanceEl.textContent = '0 GEN'));

  getUserClaims(addr)
    .then((c) => (userClaimsEl.textContent = c))
    .catch(() => (userClaimsEl.textContent = '—'));
}

// ---- Start ----

init();
