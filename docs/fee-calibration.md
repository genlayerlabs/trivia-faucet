# CON-1042 fee measurements — 2026-10-24

The rollout remains disabled. Both Bradbury IC attempts finalized with execution
result `FinishedWithError (2)`. Consensus acceptance alone is not successful VM
execution. The funded vault is unchanged and neither failed ghost is authorized.

## Deployment through genlayer.js

`scripts/deploy-bradbury.mjs` uses the pinned `genlayer-js@2.0.0-rc.2`
`estimateTransactionFees` and `deployContract` methods. It checks the genesis,
consensus address, signer, exact Studio-validated source and outstanding nonce.
The default mode quotes and prepares without broadcasting; `--submit` sends once.
It journals the signed envelope hash before broadcast and refuses to reuse a
journal for another send. `--status` reads the consensus outcome without sending.

The SDK's gas-priced fee-policy read omits `from`, which this Nitro endpoint
rejects for the unfunded zero address. A loopback RPC adapter supplies the funded
admin address for those read calls. It preserves the live gas price and never
retries a broadcast. The Conduit key stays in the operator environment, not the
browser bundle. The adapter also refuses the SDK's 200k gas fallback if estimation
fails; the measured deployment envelope is much larger.

Run with Node 22+, the environment file containing `TRIVIA_FAUCET_PRIVATE_KEY`
and optionally `CONDUIT_API_KEY`, the Python source path, and a fresh journal:

```sh
node --env-file=/path/to/.env scripts/deploy-bradbury.mjs /path/to/trivia_faucet.py /path/to/attempt.json
# Add --submit only for an intended new attempt; --status reads an existing journal.
```

Do not send another attempt merely to change the fee budget. The second attempt
already reproduced the VM error with the SDK. Diagnose the validator execution
error first. The public chain RPC lacks `gen_getTransactionData`, with or without
the Conduit key.

| Quantity                                                 |                  GEN |
| -------------------------------------------------------- | -------------------: |
| SDK quoted deployment deposit                            | 0.025000000000002588 |
| Studio successful deployment execution consumed          |        0.00007867375 |
| Bradbury failed SDK attempt execution consumed           |          0.000061886 |
| Bradbury failed SDK attempt recorded total protocol fees |   0.0000619297500011 |
| Returned to sender                                       | 0.024938070250001294 |
| Bradbury envelope gas cost                               |        0.00006495008 |

The 0.025 GEN SDK budget is conservative, not a measured minimum. Studio's
successful deployment consumed much less; the failed live attempt cannot measure
the cost of a successful Bradbury deployment. Prices are read live for each quote.
The constructor emits no messages, so its message budget/allocation list is empty.

SDK retry consensus ID:
`0x318f6f4e02d8abd39932fd920816ed2b0c4985e4f215b169b94b9c4772593312`.
EVM envelope:
`0xc6878f48ce4b5e831d0202301ddbfa205fae8a877c61fe0294d4a96d76a02aa8`.
Failed ghost: `0x956c7607c3195c813c9E1F7d05b8D674DaccD023`.
Sanitized full fee/refund evidence is in the paired consensus PR's
`intelligent_contracts/deployment/trivia_bradbury_sdk_retry.json`.

## Finalization message allocation

Every admitted answer reserves one external-message allocation targeting the
vault's `fundWallet(uint256,address,uint256)` selector, with `onAcceptance=false`
and a root parent index. Its ABI-encoded fee parameters are `(gasLimit,maxGasPrice)`.
Both `totalMessageFees` and the allocation budget equal their product; the deposit
is the round-zero primary fee plus that budget. Rewards come from the separate
2,500 GEN vault reserve.

The configured allocation is **500,000 gas at a 500,000,000 wei cap**, reserving
**0.00025 GEN per answer**. Above-cap price changes fail closed and require a fresh
operator quote; they do not silently underfund the message. This cap is distinct
from the smaller current EVM transaction gas price.

The local profile in `external-message-profile.json` measures the real vault with
mocked consensus reads and an authenticated direct ghost callback. Each scenario
starts from the same fresh state. Estimates: new-wallet payout 230,952 gas;
recipient revert/credit 206,086; recipient requiring more transfer gas/credit
206,113. All fit the configured allocation with at least 50% headroom.

```sh
# Start a disposable paired-consensus Hardhat node on port 18546, then:
CONSENSUS_ARTIFACTS=/path/to/consensus/artifacts npm run profile:external
CONSENSUS_ARTIFACTS=/path/to/consensus/artifacts TEST_RPC=http://127.0.0.1:18546 npm run test:integration
```

The integration test decodes the actual submitted envelope and verifies recipient,
selector, phase, parent, gas/price encoding, allocation budget, parent message
budget and deposit. It also verifies no payout before finalization and exactly-once
settlement afterwards.

This is **not full live dispatch calibration**: real Bradbury Ghost/Messages and
consensus-read overhead still need a successful IC and live payout. The Studio
`estimateTransactionFeesForWrite` call with an explicit allocation failed on
2026-10-24 due to a server database transaction error (numeric value out of range).
No write-fee measurement is inferred from that failure. Retain the conservative
parent execution budget and message reserve until both measurements succeed.
