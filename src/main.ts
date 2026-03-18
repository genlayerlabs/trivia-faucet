import './style.css';
import {
  getFaucetBalance,
  getWalletBalance,
  getTotalDistributed,
  getUserClaims,
  answerTrivia,
  isWriteReady,
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

const triviaForm = $<HTMLFormElement>('trivia-form');
const inputQuestion = $<HTMLInputElement>('input-question');
const inputAnswer = $<HTMLTextAreaElement>('input-answer');
const btnSubmit = $<HTMLButtonElement>('btn-submit');

const resultArea = $('result-area');
const resultGrade = $('result-grade');
const resultReward = $('result-reward');
const resultReasoning = $('result-reasoning');
const resultStatus = $('result-status');

const txPending = $('tx-pending');
const txStatusText = $('tx-status-text');

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
    updateSubmitButton();
  });

  triviaForm.addEventListener('submit', handleSubmit);
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
  updateSubmitButton();
}

function updateSubmitButton() {
  btnSubmit.disabled = !currentAddress || !isWriteReady();
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

// ---- Submit trivia ----

async function handleSubmit(e: Event) {
  e.preventDefault();

  if (!currentAddress) return;

  const question = inputQuestion.value.trim();
  const answer = inputAnswer.value.trim();
  if (!question || !answer) return;

  btnSubmit.disabled = true;
  resultArea.classList.add('hidden');
  txPending.classList.remove('hidden');

  try {
    const result = await answerTrivia(question, answer, currentAddress, (msg) => {
      txStatusText.textContent = msg;
    });

    txPending.classList.add('hidden');
    resultArea.classList.remove('hidden');

    resultGrade.textContent = '\u2605'.repeat(result.grade) + '\u2606'.repeat(5 - result.grade);
    resultReward.textContent = `+${result.reward}`;
    resultReasoning.textContent = result.reasoning;
    resultStatus.textContent = 'Transaction finalized';
    resultStatus.style.color = '';

    refreshStats();
    refreshWalletData(currentAddress);
  } catch (err: any) {
    txPending.classList.add('hidden');
    resultArea.classList.remove('hidden');

    resultGrade.textContent = '\u2715';
    resultReward.textContent = '';
    resultReasoning.textContent = err?.message || 'Transaction failed. Please try again.';
    resultStatus.textContent = '';
    resultStatus.style.color = 'var(--error)';
  } finally {
    updateSubmitButton();
  }
}

// ---- Start ----

init();
