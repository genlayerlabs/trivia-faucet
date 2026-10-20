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

The live RPC inspection on 2026-10-20 returned chain 4221, but the configured
ConsensusData did not expose `getStoredTransactionStatus`. The legacy vault also
lacks `fundingCaller`. This implementation deliberately refuses those old ABIs.
Do not enable this UI on the historical deployment or reuse the old vault/ghost.
Complete the consensus compatibility preflight and deploy the paired new contracts.
No production contracts or Pages deployment were changed during implementation.

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
```

This is an explicit on-chain admin operation. The vault rejects cleanup of live
work and delayed callbacks. Failed external dispatch can recover its reward from
the finalized recorded message; terminal work with no payout releases its slot.
If a recipient rejects native GEN, settlement credits that recipient and releases
the slot. The recipient calls `vault.claimCredit(destination)` to withdraw it.

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
A live Bradbury smoke test is still required after compatible deployment:
answer → accepted (no GEN yet) → finalized → settled → GEN received.
