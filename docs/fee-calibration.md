# CON-1042 fee measurements — 2026-10-24

The deployment blocker was the Python runtime dependency. Sixteen successful
Bradbury deployments in a 150-transaction sample used
`py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0`.
Changing only Trivia's dependency to that runner produced a finalized successful
deployment at `0x715bcfcBbD61B8540a798A235BBB6771b1c1CBd4`, consensus ID
`0x41d374b43aafacb46305cd83132b2eaf0db56b9f4d197051e6bdc539acb9c290`.
The 2.5 GEN budget, 130/230-second allowances and contract logic were unchanged.
The new source passed 22 direct tests against GenVM Manager v0.6.0-rc10.

Successful deployment accounting: **0.00006193175000128 GEN** protocol fees,
**0.00006476352 GEN** EVM gas, and **2.499938068250001506 GEN** returned.
The copied reference EVM transaction is
`0x32fbe3a41ed2a5151d9786bbc201141949cfe8dc9eebc8b6f1247395848915bd`.
It used 300/300-second allowances, 0.01 GEN per round and three rotations;
those settings were recorded for comparison, not needed to fix Trivia.

The paired consensus evidence files `trivia_bradbury_deployment_comparison.json`
and `trivia_bradbury_runtime_retry.json` preserve the comparison and result.
Studio rejects schema inspection of the new runtime (-32603); the older Studio
measurement below is historical and is not validation of the current runtime.
The previous failed attempts below are retained as historical measurements.

## Deployment through genlayer.js

`scripts/deploy-bradbury.mjs` uses the pinned `genlayer-js@2.0.0-rc.2`
`estimateTransactionFees` and `deployContract` methods. It checks the genesis,
consensus address, signer, exact Bradbury-runtime-tested source and outstanding nonce.
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

The owner explicitly requested a third attempt with a much larger execution
budget. Its consensus ID is
`0x52684b9d40ef31c4b1d9b9514825f1b8a0347d4b844736cccf03b00323305fdc`
(EVM `0xab4d092f9a1e6105a009611d4f516e83431c50f06c27b0a9138c91260ce8e85b`).
All five validators again reported `FinishedWithError (2)` with the 2.5 GEN
execution allowance. The failed ghost
`0x173D5c822b013efac111667f5aE7C40f85Acd32f` remains unauthorized.
The paired consensus evidence file `trivia_bradbury_high_budget.json` records
its observed lifecycle and fees. Further retries need new diagnostic evidence.
The public chain RPC lacks `gen_getTransactionData`, with or without the Conduit
key. The table below records the earlier 0.025 GEN attempt, not the larger retry.

| Quantity                                                 |                  GEN |
| -------------------------------------------------------- | -------------------: |
| SDK quoted deployment deposit                            | 0.025000000000002588 |
| Studio successful deployment execution consumed          |        0.00007867375 |
| Bradbury failed SDK attempt execution consumed           |          0.000061886 |
| Bradbury failed SDK attempt recorded total protocol fees |   0.0000619297500011 |
| Returned to sender                                       | 0.024938070250001294 |
| Bradbury envelope gas cost                               |        0.00006495008 |

The initial 0.025 GEN SDK budget was conservative, not a measured minimum.
The owner subsequently requested a much larger allocation: the deployment tool
now explicitly reserves **2.5 GEN**, a 100× increase, with a 3 GEN deposit guard. Studio's
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

## Execution time allowance

The operator requested 30 additional seconds. Both deployment and answer
submissions now use **130 leader time units** and **230 validator time units**,
up from 100 and 200. The deployment tool reads these fields from the same
configuration as the browser client instead of keeping separate constants.

The on-chain phase timeouts for the preceding attempt were 100 and 200 seconds;
current bounds are 30–600 seconds for each phase. The node derives phase deadlines
in seconds and subtracts its chain-submission buffer from the VM's usable time.
These allocations are phase allowances, not a guarantee of exactly that much VM
runtime or a delay before finalization.

The highlighted explorer field `GEN per time unit` is the unit **price**, not a
runtime allowance. On-chain reads confirmed current and settled locked prices of
**1 wei per time unit**, below the submitted **2 wei cap**. The explorer's missing
locked-price display does not establish missing time funding. No network fee-price
or validator-node settings were changed.

The new SDK retry has consensus ID
`0xe5963f177605e05766ed0d35eb34ef584871cc1dc8e38e20a05e8003d0e1055a`
and EVM envelope
`0x24e2c55fe2086b69dcca4f2210ff07cd689723f249694916b987792333bea135`.
Its outcome and measured phase allowances are recorded in the paired consensus
PR's `trivia_bradbury_extra_time.json`.

## Finalization message allocation

Every admitted answer reserves one external-message allocation targeting the
vault's `fundWallet(uint256,address,uint256)` selector, with `onAcceptance=false`
and a root parent index. Its ABI-encoded fee parameters are `(gasLimit,maxGasPrice)`.
Both `totalMessageFees` and the allocation budget equal their product; the deposit
is the round-zero primary fee plus that budget. Rewards come from the separate
2,500 GEN vault reserve.

The configured allocation is **5,000,000 gas at a 500,000,000 wei cap**, reserving
**0.0025 GEN per answer**, increased tenfold at the owner’s request. Above-cap price changes fail closed and require a fresh
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

## Live finalization payout verified

The shared browser submission client submitted request
`0x7e6bc89b241e15a1dc1909eaad1238a407780c124081cf947ea3933249d1d688`
through the real vault to the new IC. Consensus ID:
`0x67996b9bf7af997fd29336bc1b87fa0e8520fcd3394a949a63f3ae5d6dd71247`.
All five validators agreed on successful execution. At acceptance, reward and
claimed balance were zero and both pending counters were 1. After finalization,
the recipient balance increased by exactly **40 GEN**, the request settled with
zero credit, and both pending counters became **0**. The receipt contains one
external `fundWallet` message with `onAcceptance: false`, allocated 5,000,000 gas
at the 500,000,000 wei cap. This completes the live Ghost/Messages dispatch check
that the earlier local calibration could not cover.

The paired consensus `trivia_bradbury_live_payout.json` contains the observations
and receipts. No additional reward funding was sent. The dApp is configured for
the working ghost; the existing Pages environment requires `main` for publication.
