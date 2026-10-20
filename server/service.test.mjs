import test from "node:test";
import assert from "node:assert/strict";
import { Interface, Wallet } from "ethers";
import { abi } from "genlayer-js";
import {
  admissionReason,
  encodeAnswer,
  validateSubmission,
  createService,
} from "./service.mjs";
import { VAULT_ABI } from "../shared/abi.mjs";
const recipient = "0x0000000000000000000000000000000000000001";
const requestId = "0x" + "01".repeat(32);
const body = {
  recipient,
  requestId,
  question: " What is GenLayer? ",
  answer: " AI blockchain ",
};
test("validates address, bounded input, and stable nonzero request identity", () => {
  assert.equal(validateSubmission(body).question, "What is GenLayer?");
  for (const invalid of [
    { requestId: "0x0" },
    { requestId: "0x" + "00".repeat(32) },
    { recipient: "garbage" },
    { question: "" },
    { answer: "x".repeat(4001) },
  ])
    assert.throws(() => validateSubmission({ ...body, ...invalid }));
});
test("on-chain quota presentation uses distinct daily, queue, rate and cooldown limits", () => {
  const base = {
    dailyRemaining: 5,
    userPending: 0,
    recentGlobal: 0,
    globalPending: 0,
    retryAt: 0,
  };
  assert.equal(admissionReason(base, 100), null);
  for (const state of [
    { dailyRemaining: 0 },
    { userPending: 5 },
    { recentGlobal: 50 },
    { globalPending: 50 },
    { retryAt: 101 },
  ])
    assert.ok(admissionReason({ ...base, ...state }, 100));
  assert.equal(admissionReason({ ...base, retryAt: 100 }, 100), null);
});
test("encodes the new request argument and vault selector unambiguously", () => {
  const encoded = encodeAnswer(validateSubmission(body));
  assert.match(encoded, /^0x[0-9a-f]+$/);
  assert.notEqual(
    encoded,
    encodeAnswer({
      ...validateSubmission(body),
      requestId: "0x" + "02".repeat(32),
    }),
  );
  const iface = new Interface(VAULT_ABI);
  const callback = iface.encodeFunctionData("fundWallet", [
    BigInt(requestId),
    recipient,
    10n ** 19n,
  ]);
  assert.equal(
    iface.decodeFunctionData("fundWallet", callback)[0],
    BigInt(requestId),
  );
  assert.equal((callback.length - 2) / 2, 100);
});
test("ABI tuple carries current fee policy, allocation phase and request identity", () => {
  const iface = new Interface(VAULT_ABI);
  const fn = iface.getFunction("submit");
  assert.deepEqual(
    fn.inputs[2].components.map((item) => item.name),
    [
      "sender",
      "recipient",
      "numOfInitialValidators",
      "maxRotations",
      "validUntil",
      "saltNonce",
      "userValue",
      "feesDistribution",
      "txCalldata",
      "messageAllocations",
    ],
  );
  assert.equal(
    fn.inputs[2].components[9].arrayChildren.components[1].name,
    "onAcceptance",
  );
});
