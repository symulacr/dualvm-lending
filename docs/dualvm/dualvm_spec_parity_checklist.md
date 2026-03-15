# DualVM Spec Parity Checklist

Status legend:
- DONE — implemented and evidenced in code or live deployment
- PARTIAL — implemented in part, or present but not yet proven in the exact planned way
- MISSING — planned but not yet built/proven
- DRIFTED — built against current reality, but the written spec/source assumption changed underneath it

## Current live reference state
- Network: `Polkadot Hub TestNet`
- Chain ID: `420420417`
- RPC: `https://eth-rpc-testnet.polkadot.io/`
- Explorer: `https://blockscout-testnet.polkadot.io/`
- Live deployment manifest: `dualvm/deployments/polkadot-hub-testnet.json`
- Live borrow smoke script: `dualvm/scripts/liveSmoke.ts`
- Live liquidation smoke script: `dualvm/scripts/liveLiquidationSmoke.ts`
- Live repay smoke script: `dualvm/scripts/liveRepaySmoke.ts`
- Current live deployed contracts:
  - AccessManager: `0x06Ca684578a01d6978654A4572B6A00Abe934575`
  - WPAS: `0x0Dece14653B651Ee10df0bBcb286C9170A24e1bc`
  - USDCMock: `0x789cf6A8B73Eab267C6B0eEa0E38fbE2AcD0Caf4`
  - Oracle: `0x7627582B2183bf8327f0ead9aA1D352201c7De06`
  - RiskEngine: `0xe46b428cd93faD2601070E27ca9e6197f1576268`
  - DebtPool: `0x7aFe578b08ffB14EdD6457f436fe68c3282D2B68`
  - LendingCore: `0x42D489D093d00522a77405E6cEaE2F4B89956C25`
- Explorer verification artifact: `dualvm/deployments/polkadot-hub-testnet-verification.json`
- Governance proof artifact: `dualvm/deployments/polkadot-hub-testnet-governance-proof.json`
- Oracle proof artifact: `dualvm/deployments/polkadot-hub-testnet-oracle-proof.json`




## Product scope parity
| Spec item | Planned state | Current built state | Status | Evidence | Risk if left as-is |
|---|---|---|---|---|---|
| One isolated market | One collateral asset, one debt asset, one liquidation path | Single market with WPAS + USDC-test only | DONE | `docs/dualvm/dualvm_lending_final_spec_public_rpc.md:53-67`, `dualvm/contracts/LendingCore.sol` | Low |
| Collateral asset | WPAS wrapper around PAS | `WPAS.sol` deployed and used in live smoke | DONE | `dualvm/contracts/WPAS.sol`, `dualvm/scripts/liveSmoke.ts:36-39` | Low |
| Debt asset | Mock `USDC-test` with metadata | `USDCMock.sol` is deployed and the asset path is now explicitly documented as the intentional final hackathon choice | DONE | `dualvm/contracts/USDCMock.sol`, `dualvm/scripts/liveSmoke.ts:32-39`, `docs/dualvm/dualvm_asset_path_decision.md` | Medium if anyone later overstates it as a production stable integration |
| Oracle | Manual price feed with freshness window and circuit breaker | Hardened `ManualOracle.sol` is deployed; borrow path depends on `latestPriceWad()` and live oracle hardening proof exists | DONE | `dualvm/contracts/ManualOracle.sol`, `dualvm/deployments/polkadot-hub-testnet-oracle-proof.json` | Oracle still remains centralized even after hardening |
| XCM out of critical path | No dependency on cross-chain execution for MVP flow | No XCM dependency in lending flow | DONE | Contract set; live smoke path has no XCM | Low |
| Narrow PVM wedge | Stateless bounded risk computation | Risk engine exists and is called, but live path is still ordinary Solidity deployment; PVM artifact generated separately | PARTIAL | `dualvm/contracts/pvm/PvmRiskEngine.sol`, `dualvm/pvm-artifacts/PvmRiskEngine.json`, `dualvm/contracts/LendingCore.sol:223-225` | High if submission claims full live DualVM execution |

## Runtime and infrastructure parity
| Spec item | Planned state | Current built state | Status | Evidence | Risk if left as-is |
|---|---|---|---|---|---|
| Public-RPC-first runtime | No local Polkadot node required | Live deployment and smoke use public RPC only | DONE | `dualvm/hardhat.config.ts`, live manifest | Medium public-RPC rate-limit exposure |
| Official public testnet target | Original spec named Passet Hub `420420422` | Implementation retargeted to current official Polkadot Hub TestNet `420420417` | DRIFTED | `dualvm/hardhat.config.ts`, `dualvm/scripts/marketConfig.ts`, `CLAUDE.md` | Low if documented honestly |
| Frontend-only hosted story | Thin client-side read layer, no backend requirement | Frontend reads chain directly; no backend service added | PARTIAL | `dualvm/src/App.tsx`, `dualvm/src/lib/readModel.ts` | Medium UX/RPC fragility |
| Demoability on public infra | Judges can inspect same public chain/explorer | Live deployment exists on public testnet | DONE | live manifest, successful `eth_getCode` verification | Low |

## Contract architecture parity
| Spec item | Planned state | Current built state | Status | Evidence | Risk if left as-is |
|---|---|---|---|---|---|
| Debt pool separate from collateral | LPs deposit debt asset, borrowers deposit collateral separately | `DebtPool` handles USDC-test liquidity, `LendingCore` handles collateral | DONE | `dualvm/contracts/DebtPool.sol`, `dualvm/contracts/LendingCore.sol` | Low |
| Lending core owns solvency | REVM core is source of truth | Core computes debt, health, borrow safety, liquidation | DONE | `dualvm/contracts/LendingCore.sol` | Low |
| ERC-4626-style pool | Standardized share accounting with inflation-attack caution | `DebtPool` inherits `ERC4626`; no custom virtual-offset weakening observed | DONE | `dualvm/contracts/DebtPool.sol` | Medium if initialization assumptions are not documented |
| AccessManager architecture | Modern access stack rather than single owner | AccessManager deployed and function-role mapping configured | DONE structurally | `dualvm/contracts/DualVMAccessManager.sol`, `dualvm/scripts/deploySystem.ts` | Medium if readers assume live role separation from architecture alone |
| Distinct live roles | Emergency/risk/treasury/minter separated | Live deployment now splits operational roles across distinct funded EOAs | DONE | `dualvm/deployments/polkadot-hub-testnet.json`, `dualvm/deployments/polkadot-hub-testnet-governance-proof.json` | Ultimate admin remains a separate production concern |
| Delayed sensitive admin actions | Risk/admin changes should be delayed | Live risk, treasury, and minter actions now execute through AccessManager with non-zero delays; emergency remains immediate | DONE | `dualvm/deployments/polkadot-hub-testnet.json`, `dualvm/scripts/liveRiskAdminSmoke.ts`, `dualvm/scripts/liveMinterSmoke.ts` | Ultimate AccessManager admin is still a single EOA |

## Definition-of-done parity
| Spec done item | Current state | Status | Evidence | Gap |
|---|---|---|---|---|
| LP deposits stable and receives shares | Proven live | DONE | `dualvm/scripts/liveSmoke.ts:32-34` | None |
| Borrower deposits collateral and opens debt | Proven live | DONE | `dualvm/scripts/liveSmoke.ts:36-39` | None |
| LendingCore calls RiskEngine PVM and persists returned path | Core calls a RiskEngine and persists quote outputs, but live path is not proven as live PVM execution | PARTIAL | `dualvm/contracts/LendingCore.sol:223-239` | Live DualVM parity not yet demonstrated |
| Repayment reduces debt correctly | Proven live with before/after debt reduction on the current deployment | DONE | `dualvm/test/LendingCore.ts:62-67`, `dualvm/scripts/liveRepaySmoke.ts` | None at MVP parity level |
| Liquidation works below threshold | Proven live after fixed-contract redeploy, including a bad-debt path where debt exceeded tracked principal before liquidation | DONE | `dualvm/test/LendingCore.ts:69-77`, `dualvm/scripts/liveLiquidationSmoke.ts` | None at MVP parity level; production concerns still remain |
| Contracts verified on explorer | Verified contracts published on Blockscout for the current deployment | DONE | `dualvm/deployments/polkadot-hub-testnet-verification.json` | None at MVP parity level |
| UI shows balances, utilization, health factor, recent events | Observer-mode UI now shows pool balances, utilization, tracked-address debt/borrow headroom/health factor, and recent LendingCore events from the live deployment | DONE | `dualvm/src/App.tsx`, `dualvm/src/lib/readModel.ts`, live observer query against the current deployment | Observer-only transaction UX remains a separate product gap, but the read-layer parity is now met |
| Agent-readable instructions and reproducible demo flow | `CLAUDE.md`, `SPEC.md`, `features.json`, `progress.md`, `init.sh`, deployment scripts, and smoke scripts exist | DONE | `CLAUDE.md`, `dualvm/SPEC.md`, `dualvm/features.json`, `dualvm/progress.md`, `dualvm/init.sh` | None at MVP parity level |

## Submission parity
| Submission expectation | Current state | Status | Evidence | Gap |
|---|---|---|---|---|
| Public repo tells one truthful story | README, submission guide, addendum, checklist, and PVM posture doc are aligned with the current live deployment | DONE | `README.md`, `docs/dualvm/dualvm_submission_demo_guide.md`, `docs/dualvm/dualvm_current_state_addendum.md`, `docs/dualvm/dualvm_pvm_posture.md` | None at MVP parity level |
| Track 1: stablecoin-enabled DeFi app | Supported by live supply/collateral/borrow/repay/liquidation path | DONE | live deployment and smoke flow | None |
| Track 2: honest PVM wedge | Final wording frozen at parity-only / bounded computation posture | DONE | `docs/dualvm/dualvm_pvm_posture.md`, submission docs | None so long as wording is obeyed |
| OpenZeppelin sponsor story | AccessManager, Pausable, ReentrancyGuard, SafeERC20, ERC4626 all present | DONE | contract inheritance/imports | Need polished documentation only if desired |
| Explorer-confirmed txs + app state update | Live txs exist and all current contracts are verified on Blockscout | DONE | live smoke tx hashes, `dualvm/deployments/polkadot-hub-testnet-verification.json` | Need curated demo capture, but verification itself is complete |

## Funds-flow parity
### Planned funds flow
1. Faucet PAS to user wallet
2. User wraps PAS into WPAS
3. LP deposits USDC-test into debt pool
4. Borrower deposits WPAS into LendingCore
5. Borrower draws USDC-test debt from DebtPool
6. Repayments split into principal reduction and interest/reserve accounting
7. Liquidation repays debt and seizes collateral

### Current built funds flow
- PAS → `WPAS.deposit()` → WPAS minted to wallet → approved to LendingCore → `depositCollateral()`
- `USDCMock.mint()` → wallet → approved to `DebtPool.deposit()` → pool shares minted
- `LendingCore.borrow()` → oracle/risk quote → `DebtPool.drawDebt()` → USDC-test to borrower
- `LendingCore.repay()` → borrower sends USDC-test to DebtPool → `recordRepayment(principal, interest, reserveFactor)`
- `LendingCore.liquidate()` → liquidator sends USDC-test to DebtPool → collateral sent from LendingCore to liquidator → optional `recordLoss(...)`

### ASCII funds-flow diagram
```text
PAS Faucet/Wallet
    │ native PAS
    ▼
┌──────────┐
│   WPAS   │ wrap PAS -> mint WPAS
└────┬─────┘
     │ approve/transferFrom
     ▼
┌──────────────┐
│ LendingCore  │ stores collateral
└────┬─────────┘
     │ borrow()
     │  ├─ read Oracle
     │  ├─ read RiskEngine
     │  └─ drawDebt()
     ▼
┌──────────────┐        LP deposits USDC-test
│  DebtPool    │◄───────────────────────────────┐
│ liquidity +  │                                │
│ share acctg  │                                │
└────┬─────────┘                                │
     │ transfer USDC-test                       │
     ▼                                          │
 Borrower wallet                                │
                                                │
Repay/liquidate path                            │
Borrower/Liquidator USDC-test ─────────────────►│
                                                │
DebtPool.recordRepayment() splits:
  principal -> outstandingPrincipal down
  interest  -> reserveBalance up (reserve cut)
```

## Before-fix critical issue: bad-debt liquidation accounting
### Observed code path
- `LendingCore.liquidate()` computes `remainingDebt = _currentDebt(position)` after applying liquidation payment.
- If collateral is exhausted and `remainingDebt > 0`, it calls `debtPool.recordLoss(remainingDebt)`.
- `DebtPool.recordLoss()` only accepts a loss up to `outstandingPrincipal` and reduces principal only.

### Why this is dangerous
- `_currentDebt(position)` includes both principal and accrued interest.
- `DebtPool.outstandingPrincipal` tracks principal only.
- If bad debt remains after collateral exhaustion and some of that remaining debt is accrued interest, `recordLoss(remainingDebt)` can exceed `outstandingPrincipal` and revert.
- That means liquidation can fail in the exact stressed branch that is supposed to clear bad debt.

### Status
- Status before fix: PARTIAL / BUG CANDIDATE
- Evidence: `dualvm/contracts/LendingCore.sol:313-318`, `dualvm/contracts/DebtPool.sol:174-177`
- Risk if left as-is: CRITICAL

## After fix and live redeploy: bad-debt liquidation accounting
### What changed
- `LendingCore.liquidate()` now writes down only `position.principalDebt` through `DebtPool.recordLoss(...)` when collateral is exhausted.
- Any unpaid accrued interest is cleared with the borrower position instead of being forced into principal-loss accounting.
- A regression test proves liquidation succeeds when accrued interest remains after collateral exhaustion.
- Fixed contracts were redeployed to Polkadot Hub TestNet and the live bad-debt liquidation path was exercised with funded multi-wallet roles.

### Current status after the fix
- Status after fix: DONE locally and redeployed live
- Code evidence: `dualvm/contracts/LendingCore.sol:313-324`
- Test evidence: `dualvm/test/LendingCore.ts:80-103`
- Local verification evidence: `cd dualvm && npm test` -> 4 passing, `cd dualvm && npm run build` -> success
- Live verification evidence: `dualvm/scripts/liveLiquidationSmoke.ts` executed successfully after redeploy
- Live proof point: the smoke output showed `debtBefore = 21415.525114155251141552` while `principalBefore = 10100.0`, then `debtAfter = 0.0` and `principalAfter = 100.0` after liquidation
- Remaining risk: the accounting bug is fixed, but governance, oracle centralization, and explorer-verification gaps still remain

## Additional critical gaps and architectural truth points
1. **Live DualVM parity is partial**
   - The current live deployment proves a risk engine contract exists and is called, but not that live cross-VM PVM execution is in the deployed solvency path.
2. **Operational role separation now exists, but ultimate admin remains centralized**
   - Emergency, risk, treasury, and minter roles are split with live delay proofs, but the AccessManager admin is still a single EOA rather than a multisig or timelocked governance layer.
3. **Frontend is observer-capable, not full transaction UX**
   - Health factor and recent events are now surfaced, but the UI still does not provide a polished end-user transaction flow.
4. **Explorer verification is complete**
   - Verified contract pages now exist for all current deployed contracts on Blockscout.
5. **Explorer verification is complete**
   - Verified contract pages now exist for all current deployed contracts on Blockscout.
## Immediate next steps after this checklist
1. Decide how far to go on production-oriented hardening versus what remains explicitly out of hackathon scope.
2. Keep docs and live artifacts aligned as production-oriented changes land.
