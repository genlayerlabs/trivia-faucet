import './style.css';
import {
  getFaucetBalance,
  getWalletBalance,
  getRawBalance,
  getTotalDistributed,
  getLocalClaims,
  submitTrivia,
  waitForAcceptance,
  waitForTransfer,
  isWriteReady,
  EXPLORER_URL,
} from './contract';
import { getRandomQuestion } from './questions';

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
const questionDisplay = $('question-display');
const btnShuffle = $<HTMLButtonElement>('btn-shuffle');
const inputAnswer = $<HTMLTextAreaElement>('input-answer');
const btnSubmit = $<HTMLButtonElement>('btn-submit');

const progressArea = $('progress-area');
const stepSubmitIcon = $('step-submit-icon');
const stepSubmitText = $('step-submit-text');
const stepSubmit = $('step-submit');
const stepConsensusIcon = $('step-consensus-icon');
const stepConsensusText = $('step-consensus-text');
const stepConsensus = $('step-consensus');
const stepTransferIcon = $('step-transfer-icon');
const stepTransferText = $('step-transfer-text');
const stepTransfer = $('step-transfer');

const resultArea = $('result-area');
const resultGrade = $('result-grade');
const resultReward = $('result-reward');
const resultStatus = $('result-status');

// ---- Step helpers ----

function setStep(
  el: HTMLElement,
  icon: HTMLElement,
  text: HTMLElement,
  state: 'pending' | 'active' | 'done' | 'error',
  label: string,
) {
  el.className = 'progress-step ' + state;
  text.innerHTML = label;

  icon.className = 'step-icon';
  if (state === 'pending') icon.classList.add('checkbox');
  else if (state === 'active') icon.classList.add('spinner');
  else if (state === 'done') { icon.classList.add('check'); icon.textContent = '\u2713'; }
  else if (state === 'error') { icon.classList.add('cross'); icon.textContent = '\u2715'; }

  if (state !== 'done' && state !== 'error') icon.textContent = '';
}

function resetProgress() {
  setStep(stepSubmit, stepSubmitIcon, stepSubmitText, 'pending', 'Submit transaction');
  setStep(stepConsensus, stepConsensusIcon, stepConsensusText, 'pending', 'Wait for consensus');
  setStep(stepTransfer, stepTransferIcon, stepTransferText, 'pending', 'Receive GEN transfer');
  resultArea.classList.add('hidden');
}

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
let currentQuestion: string = getRandomQuestion();

// ---- Init ----

function init() {
  questionDisplay.textContent = currentQuestion;

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

  btnShuffle.addEventListener('click', () => {
    currentQuestion = getRandomQuestion();
    questionDisplay.textContent = currentQuestion;
    inputAnswer.value = '';
    progressArea.classList.add('hidden');
    resultArea.classList.add('hidden');
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

  getWalletBalance(addr)
    .then((b) => (walletBalanceEl.textContent = b))
    .catch(() => (walletBalanceEl.textContent = '0 GEN'));

  const claims = getLocalClaims(addr);
  userClaimsEl.textContent = claims > 0 ? `${claims.toFixed(1)} GEN` : '0 GEN';
}

// ---- Submit trivia ----

async function handleSubmit(e: Event) {
  e.preventDefault();

  if (!currentAddress) return;

  const question = currentQuestion;
  const answer = inputAnswer.value.trim();
  if (!question || !answer) return;

  btnSubmit.disabled = true;
  btnShuffle.disabled = true;
  resultArea.classList.add('hidden');
  progressArea.classList.remove('hidden');
  resetProgress();

  const recipient = currentAddress;

  try {
    // Step 1: Submit transaction
    setStep(stepSubmit, stepSubmitIcon, stepSubmitText, 'active', 'Submitting transaction...');

    const balanceBefore = await getRawBalance(recipient);
    const txHash = await submitTrivia(question, answer, recipient);

    const txLink = `<a href="${EXPLORER_URL}/tx/${txHash}" target="_blank" rel="noopener">${txHash.slice(0, 10)}...${txHash.slice(-6)}</a>`;
    setStep(stepSubmit, stepSubmitIcon, stepSubmitText, 'done', `Transaction submitted ${txLink}`);

    // Step 2: Wait for consensus
    setStep(stepConsensus, stepConsensusIcon, stepConsensusText, 'active', 'Waiting for consensus...');

    await waitForAcceptance(txHash);

    setStep(stepConsensus, stepConsensusIcon, stepConsensusText, 'done', 'Transaction accepted by consensus');

    // Step 3: Wait for GEN transfer
    setStep(stepTransfer, stepTransferIcon, stepTransferText, 'active', 'Waiting for GEN transfer...');

    const { grade, rewardGEN } = await waitForTransfer(recipient, balanceBefore);

    setStep(stepTransfer, stepTransferIcon, stepTransferText, 'done', `Received ${rewardGEN} GEN`);

    // Show result
    resultArea.classList.remove('hidden');
    resultGrade.textContent = '\u2605'.repeat(grade) + '\u2606'.repeat(5 - grade);
    resultReward.textContent = `+${rewardGEN} GEN`;
    resultStatus.innerHTML = `<a href="${EXPLORER_URL}/tx/${txHash}" target="_blank" rel="noopener">View on Explorer</a>`;
    resultStatus.style.color = '';

    // Load a new question for next round
    currentQuestion = getRandomQuestion();
    questionDisplay.textContent = currentQuestion;
    inputAnswer.value = '';

    refreshStats();
    refreshWalletData(recipient);
  } catch (err: any) {
    // Mark whichever step is active as error
    const activeStep = document.querySelector('.progress-step.active');
    if (activeStep) {
      const icon = activeStep.querySelector('.step-icon') as HTMLElement;
      const text = activeStep.querySelector('.step-text') as HTMLElement;
      activeStep.className = 'progress-step error';
      icon.className = 'step-icon cross';
      icon.textContent = '\u2715';
      text.textContent = err?.message || 'Something went wrong. Please try again.';
    }
  } finally {
    btnShuffle.disabled = false;
    updateSubmitButton();
  }
}

// ---- Start ----

init();
