import "./style.css";
import {
  getAdmission,
  getRequest,
  savedRequests,
  forgetRequest,
  submitTrivia,
  isWriteReady,
  formatGEN,
  statusLabel,
  EXPLORER_URL,
  type Admission,
} from "./contract";
import { getRandomQuestion } from "./questions";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = $<HTMLInputElement>("input-address");
const answer = $<HTMLTextAreaElement>("input-answer");
const submit = $<HTMLButtonElement>("btn-submit");
let address = localStorage.getItem("trivia-faucet-addr") || "";
let question = getRandomQuestion();
let admission: Admission | null = null;
let submitting = false;
let refreshing = false;
const quota = document.createElement("p");
quota.setAttribute("role", "status");
quota.className = "hint";
$("trivia-form").prepend(quota);
const requests = document.createElement("section");
requests.setAttribute("aria-label", "Your trivia transactions");
requests.className = "request-list";
$("trivia-form").after(requests);
function button() {
  answer.disabled = submitting;
  $<HTMLButtonElement>("btn-shuffle").disabled = submitting;
  submit.textContent = submitting ? "Submitting…" : "Submit Answer";
  submit.disabled =
    submitting ||
    !address ||
    !isWriteReady() ||
    !admission ||
    Boolean(admission.reason);
}
function newQuestion() {
  question = getRandomQuestion();
  $("question-display").textContent = question;
  answer.value = "";
}
function showError(message: string) {
  $("address-error").textContent = message;
  $("address-error").classList.remove("hidden");
}
function chooseAddress() {
  const candidate = input.value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(candidate) || /^0x0{40}$/i.test(candidate)) {
    showError("Enter a valid wallet address.");
    return;
  }
  address = candidate;
  admission = null;
  localStorage.setItem("trivia-faucet-addr", address);
  $("address-error").classList.add("hidden");
  $("wallet-info").classList.remove("hidden");
  $("wallet-address").textContent =
    `${address.slice(0, 6)}…${address.slice(-4)}`;
  button();
  void refresh();
}
async function refresh() {
  if (!address || refreshing) return;
  refreshing = true;
  const selected = address;
  try {
    const state = await getAdmission(selected);
    if (address !== selected) return;
    admission = state;
    $("faucet-balance").textContent = formatGEN(state.balance);
    $("total-distributed").textContent = formatGEN(state.totalDistributed);
    $("wallet-balance").textContent = formatGEN(state.walletBalance);
    $("user-claims").textContent = formatGEN(state.claimed);
    const wait = Math.max(0, Math.ceil((state.retryAt - state.now) / 60));
    quota.textContent = `${state.dailyRemaining}/5 attempts remaining in the last 24 hours · ${state.userPending}/5 pending · Faucet queue ${state.globalPending}/50. ${state.reason || ""}${wait ? ` Check again in ${wait} min.` : ""}`;
    if (BigInt(state.credits) > 0n)
      quota.textContent += ` ${formatGEN(state.credits)} is available to claim from the vault.`;
    const entries = await Promise.all(
      savedRequests()
        .filter(
          (item) => item.recipient.toLowerCase() === selected.toLowerCase(),
        )
        .map(async (item) => {
          try {
            return { item, state: await getRequest(item.requestId) };
          } catch {
            return { item, state: null };
          }
        }),
    );
    if (address !== selected) return;
    requests.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("p");
      row.textContent = `${entry.item.question}: ${entry.state ? statusLabel(entry.state) : "Unable to refresh status; saved request retained"}. `;
      if (entry.state?.txId) {
        const link = document.createElement("a");
        link.textContent = "View transaction";
        link.href = `${EXPLORER_URL}/tx/${entry.state.txId}`;
        link.target = "_blank";
        link.rel = "noopener";
        row.append(link);
      }
      // Keep uncertain requests: their IDs are needed for safe retries.
      if (entry.state?.settled) {
        const dismiss = document.createElement("button");
        dismiss.textContent = "Dismiss";
        dismiss.className = "btn btn-ghost btn-sm";
        dismiss.onclick = () => {
          forgetRequest(entry.item.requestId);
          void refresh();
        };
        row.append(" ", dismiss);
      }
      requests.append(row);
    }
  } catch (error) {
    if (address === selected) {
      admission = null;
      quota.textContent = (error as Error).message;
    }
  } finally {
    refreshing = false;
    button();
    if (address && address !== selected) void refresh();
  }
}
$("btn-lookup").onclick = chooseAddress;
input.onkeydown = (event) => {
  if (event.key === "Enter") chooseAddress();
};
$("btn-clear").onclick = () => {
  address = "";
  admission = null;
  localStorage.removeItem("trivia-faucet-addr");
  input.value = "";
  $("wallet-info").classList.add("hidden");
  requests.replaceChildren();
  quota.textContent = "";
  button();
};
$("btn-shuffle").onclick = newQuestion;
$("trivia-form").onsubmit = async (event) => {
  event.preventDefault();
  if (submitting || !address || !answer.value.trim()) return;
  submitting = true;
  button();
  $("address-error").classList.add("hidden");
  const selected = address;
  try {
    const latest = await getAdmission(selected);
    if (latest.reason) throw new Error(latest.reason);
    await submitTrivia(question, answer.value.trim(), selected);
    newQuestion();
  } catch (error) {
    showError((error as Error).message);
  } finally {
    submitting = false;
    await refresh();
    button();
  }
};
newQuestion();
input.value = address;
if (address) chooseAddress();
else
  quota.textContent = isWriteReady()
    ? "Select a wallet to see your remaining attempts."
    : "Faucet submissions are not configured yet.";
button();
setInterval(() => void refresh(), 15000);
