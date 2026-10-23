# Trivia Faucet — CON-1042

The page uses a server-side admin service. The service calls the Solidity vault;
the vault atomically enforces admission and submits the funded consensus call.
The intelligent contract emits one external `fundWallet(requestId, user, reward)`
message on finalization. The page displays vault settlement, not speculative IC
claim totals, as payment evidence.

## Limits

- Five admitted attempts per wallet in a rolling 24 hours, regardless of outcome.
- Five pending requests per wallet; finalization releases pending capacity only.
- Fifty admissions in a rolling ten minutes and fifty outstanding globally.
- Reaching fifty outstanding starts a thirty-minute cooldown. Settlements continue;
  draining the queue does not end the cooldown. A subsequent refill starts a new one.
- Rejected EVM submissions consume no quota. Accepted requests that later fail still
  count toward the daily/rate limits.

## Deployment dependency

Deploy with the paired `genlayer-consensus` CON-1042 change. When publishing PRs,
link this consumer to that PR with a direct `Depends-On` entry.

The selected target is the current public Bradbury deployment at **epoch 2**,
confirmed on 2026-10-23: ConsensusMain
`0x2E2766cbc3E5e61Ce93bBcdCBb3eAcB82082A019`, RPC
`https://rpc.testnet-chain.genlayer.com`, chain 4221. Registry/interface preflight
passed and the former epoch-2 blocker is cleared. The older epoch-12 Orbit book
in `v0.6-rc-1` is a different instance and must not be used for this rollout.
Deploy a new vault and IC, fund/configure the admin signer and fee policy, and
complete the live payout smoke test before enabling submissions. No Bradbury
faucet deployment has been made. The paired consensus PR includes a verified
dependency snapshot for preparing a separate rollout book.

## Run the admin API

1. Install the lockfile with `npm ci` (Node 20.19 or later).
2. Copy `server/config.example.json` to the ignored `server/config.json`. Fill the
   verified deployment addresses, chain, and operator-reviewed fee policy. Values
   marked `REQUIRED_...` are intentionally not runnable defaults. The service quotes
   primary round-zero fees and adds the reserved finalization-message gas budget.
3. Set `FAUCET_ADMIN_PRIVATE_KEY` in the ignored `.env.server`, for a dedicated
   signer configured as `vault.admin()`. Fund it for consensus fees and gas.
4. Run `npm run serve:api`. It performs read-only preflight before listening.
5. Expose the API through the page administrator's HTTPS reverse proxy. Configure
   allowed origins and request limits there. CORS is a browser policy, not user
   authentication; the on-chain per-wallet/global limits remain authoritative.
6. Set `VITE_API_URL` for `npm run build`, or set the repository variable
   `TRIVIA_API_URL` for the Pages workflow. GitHub Pages hosts only the static UI;
   it does not host the admin API. The API defaults to `127.0.0.1:8787`.

Never set a `VITE_*` variable to a private key. The old `VITE_FAUCET_PK` path and
Pages secret injection have been removed. Retire the previous browser-exposed
signer when rolling out the new vault, and authorize the new server signer.

## Requests and recovery

The page saves a random uint256 request ID before its first HTTP request. Duplicate
requests return the existing on-chain transaction. The API serializes writes to
avoid signer nonce races. If a broadcast outcome is uncertain, it stops admitting
new writes until the operator resolves that transaction and restarts the service.
Do not restart while the transaction is still pending; resume with the same request
ID. The browser preserves IDs across reloads and never reports accepted work as paid.

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
# Compile the paired contracts, then run the real API against the deployed vault:
CONSENSUS_ARTIFACTS=/absolute/path/to/consensus/artifacts npm run test:integration
```

The integration test uses the real vault and service, with consensus progression
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
service's rate display is informational and the vault enforces the limits.
