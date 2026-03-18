import './style.css';
import {
  loadWallet,
  generateWallet,
  importWallet,
  disconnectWallet,
  shortenAddress,
  type Account,
} from './wallet';
import {
  setAccount,
  getFaucetBalance,
  getWalletBalance,
  getTotalDistributed,
  getUserClaims,
  answerTrivia,
} from './contract';

// ---- DOM refs ----

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const faucetBalanceEl = $('faucet-balance');
const totalDistEl = $('total-distributed');

const walletDisconnected = $('wallet-disconnected');
const walletConnected = $('wallet-connected');
const walletAddressEl = $('wallet-address');
const walletBalanceEl = $('wallet-balance');
const userClaimsEl = $('user-claims');
const importFormEl = $('import-form');
const inputPK = $<HTMLInputElement>('input-private-key');

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

// ---- State ----

let currentAccount: Account | null = null;

// ---- Init ----

async function init() {
  const saved = loadWallet();
  if (saved) connectWallet(saved);

  refreshStats();
  setInterval(refreshStats, 30_000);

  $('btn-generate').addEventListener('click', () => {
    const account = generateWallet();
    connectWallet(account);
  });

  $('btn-import').addEventListener('click', () => {
    importFormEl.classList.toggle('hidden');
    inputPK.focus();
  });

  $('btn-import-confirm').addEventListener('click', () => {
    const pk = inputPK.value.trim();
    if (!pk) return;
    try {
      const account = importWallet(pk);
      connectWallet(account);
      importFormEl.classList.add('hidden');
      inputPK.value = '';
    } catch (e) {
      alert('Invalid private key. Please check and try again.');
    }
  });

  $('btn-disconnect').addEventListener('click', () => {
    disconnectWallet();
    disconnectUI();
  });

  triviaForm.addEventListener('submit', handleSubmit);
}

// ---- Wallet UI ----

function connectWallet(account: Account) {
  currentAccount = account;
  setAccount(account);

  walletDisconnected.classList.add('hidden');
  walletConnected.classList.remove('hidden');
  walletAddressEl.textContent = shortenAddress(account.address);
  btnSubmit.disabled = false;

  refreshWalletData();
}

function disconnectUI() {
  currentAccount = null;
  setAccount(null);

  walletConnected.classList.add('hidden');
  walletDisconnected.classList.remove('hidden');
  btnSubmit.disabled = true;
  walletBalanceEl.textContent = '—';
  userClaimsEl.textContent = '—';
}

// ---- Data refresh ----

async function refreshStats() {
  try {
    const [balance, total] = await Promise.all([
      getFaucetBalance(),
      getTotalDistributed(),
    ]);
    faucetBalanceEl.textContent = balance;
    totalDistEl.textContent = total;
  } catch (e) {
    console.error('Failed to refresh stats:', e);
  }
}

async function refreshWalletData() {
  if (!currentAccount) return;
  try {
    const [balance, claims] = await Promise.all([
      getWalletBalance(currentAccount.address),
      getUserClaims(currentAccount.address),
    ]);
    walletBalanceEl.textContent = balance;
    userClaimsEl.textContent = claims;
  } catch (e) {
    console.error('Failed to fetch wallet data:', e);
    walletBalanceEl.textContent = '0 GEN';
    userClaimsEl.textContent = '0 GEN';
  }
}

// ---- Submit trivia ----

async function handleSubmit(e: Event) {
  e.preventDefault();

  const question = inputQuestion.value.trim();
  const answer = inputAnswer.value.trim();
  if (!question || !answer) return;

  btnSubmit.disabled = true;
  resultArea.classList.add('hidden');
  txPending.classList.remove('hidden');

  try {
    const result = await answerTrivia(question, answer, (msg) => {
      txStatusText.textContent = msg;
    });

    txPending.classList.add('hidden');
    resultArea.classList.remove('hidden');

    resultGrade.textContent = '★'.repeat(result.grade) + '☆'.repeat(5 - result.grade);
    resultReward.textContent = `+${result.reward}`;
    resultReasoning.textContent = result.reasoning;
    resultStatus.textContent = 'Transaction finalized';

    refreshStats();
    refreshWalletData();
  } catch (err: any) {
    txPending.classList.add('hidden');
    resultArea.classList.remove('hidden');

    resultGrade.textContent = '✕';
    resultReward.textContent = '';
    resultReasoning.textContent = err?.message || 'Transaction failed. Please try again.';
    resultStatus.textContent = '';
    resultStatus.style.color = 'var(--error)';
  } finally {
    btnSubmit.disabled = !currentAccount;
  }
}

// ---- Start ----

init();
