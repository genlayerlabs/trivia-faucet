# Trivia Faucet — CON-1042

The static GitHub Pages site signs directly with the operator-selected faucet
wallet and calls the Solidity vault. No hosted admin API is required. The vault
atomically enforces admission and submits the funded consensus call. The
intelligent contract emits one external `fundWallet(requestId, user, reward)`
message on finalization. The page displays vault settlement as payment evidence.

## Limits

- Five admitted attempts per wallet in a rolling 24 hours, regardless of outcome.
- Five pending requests per wallet; finalization releases pending capacity only.
- Fifty admissions in a rolling ten minutes and fifty outstanding globally.
- Reaching fifty outstanding starts a thirty-minute cooldown. Settlements continue;
  draining the queue does not end the cooldown. A subsequent refill starts a new one.
- Rejected EVM submissions consume no quota. Accepted requests that later fail still
  count toward the daily/rate limits.

## Deployment and browser signer

Deploy with the paired `genlayer-consensus` CON-1042 change:
[consensus PR #1922](https://github.com/genlayerlabs/genlayer-consensus/pull/1922).
The selected public Bradbury instance is ConsensusMain
`0x2E2766cbc3E5e61Ce93bBcdCBb3eAcB82082A019`, chain 4221,
RPC `https://rpc.testnet-chain.genlayer.com`. This is the instance selected at
epoch 2; it advanced to epoch 3 before rollout. The older Orbit book in
`v0.6-rc-1` identifies a different deployment and must not be used.

`src/deployment.json` contains public addresses and fee policy. The vault is
`0x41604b0d7fA8B4b0F771E94b1cf79384C87cc12f`; the finalized working IC is
`0x715bcfcBbD61B8540a798A235BBB6771b1c1CBd4`. The vault was funded with the
authorized 2,500 GEN and has authorized this IC. A real answer paid **40 GEN only
after finalization**, with wallet/global pending counters falling from 1 to 0.
Smoke consensus ID:
`0x67996b9bf7af997fd29336bc1b87fa0e8520fcd3394a949a63f3ae5d6dd71247`.
The configuration now enables submissions. GitHub Pages permits deployments
from `main` only; this PR must land before the prepared update is published.

The previous deployment failures were caused by using Studio's older Python
runtime dependency. The current source copies the dependency used by successful
Bradbury deployments (`py-genlayer:babwp9…`, GenVM Manager v0.6.0-rc10).
All 22 direct contract tests pass with that runtime. Studio currently rejects
schema inspection for it, so the historical Studio result is not validation of
the current source. See [fee measurements](docs/fee-calibration.md) for the
controlled comparison and finalization evidence.

The selected browser signer is `0x485E1588cf917a5db01018FA32D0BF0C8C5c1fFf`.
Set the GitHub repository secret `TRIVIA_FAUCET_PRIVATE_KEY`; the Pages workflow
passes it to Vite as `VITE_TRIVIA_FAUCET_PRIVATE_KEY`. This deliberately makes the
signing key available in the downloaded JavaScript, as requested by the operator.
It is a dedicated low-balance submission wallet, not the vault owner. The owner
is `0x913C8cA13923BFF9F6459e1f2630c39A1E15A2EE`; its key is never included in the
site. On-chain quotas apply even when the page is bypassed. Browser signing does
not authenticate who controls the recipient address.

Run `npm ci`, `npm test`, and `npm run build`. For local signing, provide
`VITE_TRIVIA_FAUCET_PRIVATE_KEY` through the environment or an ignored `.env.local`.
The key must match the configured admin address. Publishing uses the existing
GitHub Pages workflow; no API URL or separate server is needed.

The server tools remain optional for operators: copy `server/config.example.json`
to ignored `server/config.json`, fill the verified vault/ghost/fee policy, and set
`FAUCET_ADMIN_PRIVATE_KEY` in ignored `.env.server`. They use the same submission
client as the page.

## Requests and recovery

The page saves a random uint256 request ID before its first broadcast. Duplicate
requests return the existing on-chain transaction. Each browser serializes its writes and retries explicit nonce conflicts between
visitors with the same request ID. If a broadcast outcome is uncertain, that browser stops new writes until the transaction is reconciled. Do not
create a replacement request ID while the original outcome is uncertain. The browser preserves IDs across reloads and never reports accepted work as paid.

Canceled/failed requests can be reconciled with:

```sh
npm run reconcile -- 0x<64-hex-character-request-id>
# Cancel through the vault when consensus permits the current phase:
npm run cancel -- 0x<64-hex-character-request-id>
```

This is an explicit on-chain admin operation. The vault rejects cleanup of live
work and delayed callbacks. Failed external dispatch can recover its reward from
the finalized recorded message; terminal work with no payout releases its slot.
If a recipient rejects native GEN, settlement credits that recipient and releases
the slot. The recipient calls `vault.claimCredit(destination)` to withdraw it, or anyone
can call `vault.retryCredit(recipient)` with more gas to pay the original recipient.
Unused consensus fee refunds belong to the submitting vault; the owner can recycle
unreserved funds to the admin signer with `withdraw`. Reserve at least 2,500 GEN
for a full 50-request queue, plus separate admin gas and consensus fees.

## Validation

```sh
npm test
npm run build
# Start a disposable Hardhat node from the paired consensus checkout on port 18545.
# Compile the paired contracts, then run the shared browser client against the deployed vault:
CONSENSUS_ARTIFACTS=/absolute/path/to/consensus/artifacts npm run test:integration
```

The integration test uses the real vault and browser submission client, with consensus progression
mocked. It verifies concurrent duplicate submissions, current calldata/fee
forwarding, finalization-only payout, replay protection, and quota enforcement.
A live Bradbury smoke test is still required after the new faucet deployment:
answer → accepted (no GEN yet) → finalized → settled → GEN received.

## Studio validation

The SDK is pinned to `genlayer-js@2.0.0-rc.2`. Run the exact Python source from the
paired consensus checkout:

```sh
npm run test:studio -- /absolute/path/to/consensus/intelligent_contracts/trivia_faucet.py
```

This deploys a disposable Studio devnet contract with an ephemeral sender standing
in for the vault, waits for finalization, executes a real LLM call, verifies one
finalization-only external message and checks authorization/input rejections.
`STUDIO_EVIDENCE_PATH` optionally saves a sanitized report and source hash.
Studio does not execute arbitrary Solidity callbacks and does not expose complete
external-call calldata in this receipt. The vault tests and post-deployment
Bradbury smoke test cover those boundaries.

Wallets, questions and answers are public blockchain data. Do not enter secrets or
confidential information in the page. Admission uses Orbit block timestamps; the
page's rate display is informational and the vault enforces the limits.

## Deployment and message fee evidence

See [fee calibration](docs/fee-calibration.md) for the genlayer.js deployment command,
measured callback gas, exact message allocation and the SDK retry outcome. The
second live deployment also finalized with a VM execution error; the page remains
disabled pending diagnosis and a successful live payout.
