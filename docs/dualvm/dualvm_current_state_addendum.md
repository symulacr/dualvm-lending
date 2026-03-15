# DualVM Current-State Addendum

This addendum updates the historical DualVM spec documents to match the current live build.

## Scope of this addendum
It does **not** replace the original architectural intent.
It does override stale operational assumptions where the live implementation and current network reality have moved on.

## 1. Network supersession
The original DualVM specs were written around Passet Hub assumptions.
The current live implementation runs on:

- Network: `Polkadot Hub TestNet`
- Chain ID: `420420417`
- RPC: `https://eth-rpc-testnet.polkadot.io/`
- Fallback RPC: `https://services.polkadothub-rpc.com/testnet/`
- Explorer: `https://blockscout-testnet.polkadot.io/`
- Faucet: `https://faucet.polkadot.io/`
  - Network: `Polkadot testnet (Paseo)`
  - Chain: `Hub (smart contracts)`

When the old specs mention Passet Hub endpoints, treat those references as historical context, not the current deployment target.

## 2. Current live deployment
Current deployed contracts:
- AccessManager: `0x06Ca684578a01d6978654A4572B6A00Abe934575`
- WPAS: `0x0Dece14653B651Ee10df0bBcb286C9170A24e1bc`
- USDCMock: `0x789cf6A8B73Eab267C6B0eEa0E38fbE2AcD0Caf4`
- Oracle: `0x7627582B2183bf8327f0ead9aA1D352201c7De06`
- RiskEngine: `0xe46b428cd93faD2601070E27ca9e6197f1576268`
- DebtPool: `0x7aFe578b08ffB14EdD6457f436fe68c3282D2B68`
- LendingCore: `0x42D489D093d00522a77405E6cEaE2F4B89956C25`

Live deployment manifest:
- `dualvm/deployments/polkadot-hub-testnet.json`
- Explorer verification artifact: `dualvm/deployments/polkadot-hub-testnet-verification.json`
- Governance proof artifact: `dualvm/deployments/polkadot-hub-testnet-governance-proof.json`
- Oracle proof artifact: `dualvm/deployments/polkadot-hub-testnet-oracle-proof.json`

## 3. Live proof completed so far
Completed on live chain:
- LP liquidity seed path
- PAS -> WPAS wrapping path
- collateral deposit path
- borrow path
- repay path
- fixed bad-debt liquidation path
- hardened oracle upgrade and circuit-breaker proof

Latest captured public-proof bundle:
- collateral deposit tx: `0x5bb5a89323efb7bdb56656b20c68ea01457ddfe9506f2534c116a6ac2863a602`
- borrow tx: `0x658ce8b5e631c3e77d970678e14da986a87a464eca274b1a8585baa65d846ba0`
- repay tx: `0x924ef9d6e5e5e69de37ffcaaf6c81593b1bc496a03ec049802d80392f247e43a`
- liquidation tx: `0xe8d1f4e36cbbb4c829f2b4d8ee19afc48acc2975e7a29804db9b28099932cef5`
- snapshot artifact refreshed at `2026-03-15T20:16:48.142Z` in `dualvm/deployments/polkadot-hub-testnet-recent-events.json`


## 4. Architectural truth note on PVM
The architectural intent remains:
- REVM is the source of truth for custody and solvency.
- PVM is a narrow stateless risk-computation wedge.

Current live truth:
- The system produces a PVM artifact for the risk engine.
- The live deployed lending path is still not proven as real cross-VM PVM execution.

Therefore any Track 2 or architecture wording should describe the PVM posture honestly as parity / bounded computation unless and until live cross-VM invocation is proven.
Canonical wording source:
- `docs/dualvm/dualvm_pvm_posture.md`
- Exact code location: `dualvm/contracts/pvm/PvmRiskEngine.sol`
- Exact artifact path: `dualvm/pvm-artifacts/PvmRiskEngine.json`


## 5. Accounting fix applied after original spec parity review
A critical liquidation accounting gap was found and fixed:
- previously, exhausted-collateral bad debt could attempt to write `remainingDebt` into principal-loss accounting even when `remainingDebt` included accrued interest
- now, only remaining principal is written against `DebtPool.recordLoss(...)`
- unpaid accrued interest is cleared with the borrower position

This is proven:
- locally by regression test
- live by the multi-wallet liquidation smoke flow

## 6. Source of truth hierarchy
Use this order when reasoning about the current system:
1. `docs/dualvm/dualvm_spec_parity_checklist.md`
2. `docs/dualvm/dualvm_gap_closure_plan.md`
3. `docs/dualvm/dualvm_current_state_addendum.md`
4. `docs/dualvm/dualvm_pvm_posture.md`
5. `docs/dualvm/dualvm_asset_path_decision.md`
6. the historical DualVM spec docs

## 7. Remaining important gaps
Still open long-horizon production considerations:
- ultimate AccessManager admin is still a single EOA rather than a multisig or timelocked governance layer
- multi-source / decentralized oracle path beyond the current hardened manual oracle
- deeper monitoring / alerting beyond the current watcher and guarded liquidator scripts
- a fuller indexer/service layer beyond the current cached reads and recent-events snapshot fallback

For the prioritized closure list, see:
- `docs/dualvm/dualvm_gap_closure_plan.md`

## 8. Explorer verification status
The current deployed contracts are verified on Blockscout.
Verification artifact:
- `dualvm/deployments/polkadot-hub-testnet-verification.json`
