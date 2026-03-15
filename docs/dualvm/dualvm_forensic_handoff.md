# DualVM Lending Forensic Build Audit and Full Implementation Handoff

## 1. Executive reality check

This document is not a product pitch, not a status dashboard, and not a victory report. It is a forensic build audit of the `DualVM Lending` project exactly as it exists in the current workspace. It is written so that another engineer, reviewer, or auditor can understand what is present, what is missing, what is mocked, what is production-risky, what is live on the current public testnet, what is only locally proven, and where the implementation departs from the historical specs.

The single most important fact about the project is that it has crossed the line from pure planning into a live, public-testnet-deployed lending MVP. That matters. There are deployed contracts, verified explorer pages, smoke-tested on-chain flows, and a front-end read shell. At the same time, the project is still not production-ready. Several parts are deliberately narrow or mocked, several security and governance properties are weaker than the architecture story might suggest, and the “DualVM” claim remains only partially realized in live execution semantics.

The second important fact is that the original docs under `docs/dualvm/` are historically useful but not operationally current by themselves. They were written against older Passet Hub assumptions. The current implementation, manifests, and proof artifacts now point to `Polkadot Hub TestNet` on chain ID `420420417`. The repo contains corrective documentation that explicitly supersedes stale endpoint assumptions, but the historical docs are still present and should be read as design context rather than current runtime truth.

The third important fact is that the project intentionally chose honesty over fake completeness in several places:

- the debt asset is still an explicitly documented mock asset, `USDC-test`, not a real stablecoin integration,
- the oracle is still an explicitly hardened manual oracle, not a decentralized multi-source oracle network,
- the front-end is still an observer/read shell rather than a polished end-user write UI,
- the PVM story is explicitly frozen at “parity / bounded computation posture” rather than claimed as proven live cross-VM execution.

Those choices are not mistakes by default. In the context of a disciplined hackathon MVP, they are often the correct trade. The problem is not that the project is narrow. The problem would be pretending it is wider or safer than it actually is. This handoff therefore emphasizes actual implementation truth over aspirational framing.

In practical terms, the project now consists of:

- a `dualvm/` implementation directory containing contracts, build config, scripts, front-end code, tests, deployment manifests, and proof artifacts,
- a `docs/dualvm/` documentation set containing historical specs plus current parity, current-state, PVM, asset-path, and submission guidance documents,
- a current live deployment on `Polkadot Hub TestNet`,
- proof artifacts for contract verification, governance role separation, oracle hardening, and recent event snapshots,
- local test coverage for core flows and a set of live smoke scripts proving supply, borrow, repay, liquidation, risk-admin delayed actions, minter delayed actions, and oracle hardening behavior.

That sounds strong, and in some ways it is. But the same project still has substantial real-world limitations:

- the ultimate `AccessManager` admin is still a single EOA, not a multisig or timelocked governance layer,
- the debt asset is still mock and therefore economically synthetic,
- the oracle remains manual even though it is now hardened with min/max bounds and a max-move circuit breaker,
- monitoring and liquidation automation now exist only as baseline operator scripts, not as continuously running services,
- the event/indexing layer is still lightweight and fallback-oriented, not a true indexer-backed application data plane,
- the live lending path remains REVM-centric and does not prove live REVM-to-PVM cross-VM execution.

The rest of this document explains the entire repository structure, current implementation, all important modules, all operational scripts, the exact live deployment state, the proof coverage, the weak spots, the remaining risks, and the final implementation status in a table that distinguishes what is real from what is only partially complete.

---

## 2. Full repository and working-tree structure

The workspace root currently contains a small number of top-level files and one primary implementation directory, `dualvm/`, plus historical and current documentation under `docs/dualvm/`.

### 2.1 Top-level tree

```text
/home/kpa/polkadot/
├── README.md
├── CLAUDE.md
├── PLAN.md
├── .lsp.json
├── .omp/
│   └── lsp-smoke/
├── docs/
│   └── dualvm/
└── dualvm/
```

### 2.2 What each top-level item is for

- `README.md`
  - Current top-level project README for the live DualVM Lending build.
  - It now points to the live deployment, verified contracts, current network, proof artifacts, current limits, workflow artifacts, and demo path.
  - This file is now part of the judge-facing truth surface.

- `CLAUDE.md`
  - Persistent project memory and planning context used by the coding workflow.
  - It describes the current network truth, locked product assumptions, and important caveats.
  - It is not a substitute for the public README, but it is part of the reproducibility and handoff surface.

- `PLAN.md`
  - Internal planning artifact from the execution process.
  - Useful for reconstruction of work performed, but not itself a canonical product doc.
  - If a public-facing repo should stay cleaner, this is a candidate for exclusion from submission-facing materials.

- `.lsp.json`
  - Project-root LSP configuration used to make language servers attach correctly from the repo root even though product code is nested under `dualvm/`.
  - This is tooling support, not product runtime logic.

- `.omp/lsp-smoke/`
  - Harness-only smoke files used to verify LSP support across languages.
  - Not part of the lending product.
  - Should not be treated as application logic.

- `docs/dualvm/`
  - Contains both the historical design specs and the newer current-state docs that reflect what is actually implemented.

- `dualvm/`
  - The live application and protocol implementation root.
  - This is where almost all product logic, scripts, manifests, and proofs live.

### 2.3 `docs/dualvm/` tree

```text
docs/dualvm/
├── dualvm_lending_final_spec_public_rpc.md
├── dualvm_lending_production_spec.md
├── dualvm_spec_parity_checklist.md
├── dualvm_gap_closure_plan.md
├── dualvm_current_state_addendum.md
├── dualvm_pvm_posture.md
├── dualvm_asset_path_decision.md
└── dualvm_submission_demo_guide.md
```

### 2.4 What each `docs/dualvm/` file means now

- `dualvm_lending_final_spec_public_rpc.md`
  - Historical “final” build spec.
  - Architecturally important, operationally stale in some network assumptions.
  - Still useful for intent, scope, architecture, and submission positioning.

- `dualvm_lending_production_spec.md`
  - Earlier corrected production-oriented MVP spec.
  - Useful for rationale, constraints, and the original definition-of-done framing.
  - Also contains stale network assumptions when read literally.

- `dualvm_spec_parity_checklist.md`
  - Current canonical parity audit between the written spec and the actual implementation.
  - Tracks DONE / PARTIAL / MISSING / DRIFTED items with evidence and risk.
  - This is one of the most important current documents.

- `dualvm_gap_closure_plan.md`
  - The gap-closure plan that was executed for the current hackathon scope.
  - It is now effectively a closure ledger plus future production-expansion pointer, not an active open plan.

- `dualvm_current_state_addendum.md`
  - Short operational supersession document telling readers to treat old Passet Hub assumptions as historical context and use the current Polkadot Hub TestNet reality instead.
  - Important for stopping readers from acting on stale network assumptions.

- `dualvm_pvm_posture.md`
  - Canonical statement of the final PVM / Track 2 truth.
  - Explicitly states that the build stops at parity-oriented / bounded-computation posture and does not claim proven live cross-VM execution in the deployed solvency path.

- `dualvm_asset_path_decision.md`
  - Explicit statement that the current mock debt asset is an intentional final hackathon choice, not a disguised production asset integration.

- `dualvm_submission_demo_guide.md`
  - Submission- and demo-oriented guide for presenting the current build honestly.

### 2.5 `dualvm/` tree

The `dualvm/` directory is the actual project root for the implementation.

```text
dualvm/
├── .gitignore
├── SPEC.md
├── features.json
├── progress.md
├── init.sh
├── package.json
├── package-lock.json
├── tsconfig.json
├── hardhat.config.ts
├── vite.config.ts
├── index.html
├── contracts/
│   ├── DualVMAccessManager.sol
│   ├── WPAS.sol
│   ├── USDCMock.sol
│   ├── ManualOracle.sol
│   ├── DebtPool.sol
│   ├── LendingCore.sol
│   ├── interfaces/
│   │   └── IRiskEngine.sol
│   └── pvm/
│       └── PvmRiskEngine.sol
├── scripts/
│   ├── marketConfig.ts
│   ├── accessManagerOps.ts
│   ├── deploySystem.ts
│   ├── deploy.ts
│   ├── verifyAll.ts
│   ├── build-pvm.mjs
│   ├── liveSmoke.ts
│   ├── liveRepaySmoke.ts
│   ├── liveLiquidationSmoke.ts
│   ├── liveRiskAdminSmoke.ts
│   ├── liveMinterSmoke.ts
│   ├── liveOracleSmoke.ts
│   ├── upgradeOracle.ts
│   ├── applyRoleSeparation.ts
│   ├── liquidationWatch.mjs
│   ├── snapshotRecentEvents.mjs
│   ├── executeLiquidation.ts
│   ├── generate-wallet.mjs
│   ├── generate-wallet-batch.mjs
│   └── check-testnet-balance.mjs
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── style.css
│   ├── components/
│   │   └── MetricCard.tsx
│   └── lib/
│       ├── abi.ts
│       ├── format.ts
│       ├── manifest.ts
│       ├── readModel.ts
│       └── assetRegistry.ts
├── test/
│   └── LendingCore.ts
├── deployments/
│   ├── polkadot-hub-testnet.json
│   ├── polkadot-hub-testnet-verification.json
│   ├── polkadot-hub-testnet-governance-proof.json
│   ├── polkadot-hub-testnet-oracle-proof.json
│   └── polkadot-hub-testnet-recent-events.json
├── ops/
│   └── watchlist.json
├── wallets/
│   ├── polkadot-hub-testnet-wallet.txt
│   ├── passet-hub-test-wallet.txt
│   └── paseo-faucet-wallet-batch-2026-03-15T07-49-47-281Z.txt
├── pvm-artifacts/
│   └── PvmRiskEngine.json
├── dist/
│   └── ... built frontend assets ...
├── artifacts/
│   └── ... Hardhat artifacts ...
├── cache/
│   └── solidity-files-cache.json
├── typechain-types/
│   └── ... generated typings ...
└── node_modules/
    └── ... dependencies ...
```

### 2.6 What each important `dualvm/` file or directory does

- `.gitignore`
  - Protects generated outputs and secrets from accidental commit.
  - Notably ignores:
    - `node_modules/`
    - `dist/`
    - `artifacts/`
    - `cache/`
    - `typechain-types/`
    - `pvm-artifacts/`
    - `.env`
    - `wallets/*.txt`
  - This is the main local protection against accidentally shipping private test wallet material.

- `SPEC.md`
  - A project-root pointer file directing new readers and agents to the current canonical documents.

- `features.json`
  - Feature inventory for the current implementation, now updated so current hackathon-scope items are marked done and future production-expansion concerns are no longer misrepresented as active feature gaps.

- `progress.md`
  - Current state and remaining long-horizon concerns.

- `init.sh`
  - Minimal reproducibility script: if `node_modules` is absent, it runs `npm install`, then runs tests and build.

- `package.json`
  - Central command index. This matters because operational workflow is script-driven.

- `hardhat.config.ts`
  - Hardhat network and verification configuration for Polkadot Hub TestNet.

- `contracts/`
  - Solidity contracts for the protocol.

- `scripts/`
  - The largest operational surface in the repo. Contains deployment, verification, smoke tests, governance adjustments, oracle upgrade, monitoring, event snapshotting, and wallet helpers.

- `src/`
  - Front-end observer shell.

- `test/LendingCore.ts`
  - Main local protocol test file. This is the only substantive unit/integration-style test file in the current repo.

- `deployments/`
  - The most important machine-readable state directory for the live deployment and proof artifacts.

- `ops/watchlist.json`
  - Operator watchlist for the monitoring script.

- `wallets/`
  - Local test wallets containing private keys and mnemonics. These are gitignored but still sensitive in practice.

- `pvm-artifacts/`
  - Output of the PVM artifact build step for the risk engine.

- `dist/`
  - Built front-end output.

- `artifacts/`, `cache/`, `typechain-types/`
  - Generated build products used by Hardhat and TypeChain.

- `node_modules/`
  - Third-party dependencies.

---

## 3. Runtime environment, public network assumptions, and chain truth

The current project is built around a single public testnet runtime assumption:

- **Network name:** Polkadot Hub TestNet
- **Chain ID:** `420420417`
- **Primary ETH RPC:** `https://eth-rpc-testnet.polkadot.io/`
- **Fallback ETH RPC:** `https://services.polkadothub-rpc.com/testnet/`
- **Explorer:** `https://blockscout-testnet.polkadot.io/`
- **Faucet:** `https://faucet.polkadot.io/`
  - Network: `Polkadot testnet (Paseo)`
  - Chain: `Hub (smart contracts)`

These values are embedded in the implementation in several places:

- `dualvm/hardhat.config.ts`
- `dualvm/scripts/marketConfig.ts`
- `dualvm/deployments/polkadot-hub-testnet.json`
- `README.md`
- `docs/dualvm/dualvm_current_state_addendum.md`

This is important because the historical specs still mention Passet Hub. The live code no longer targets that old endpoint set. The current deployment and all recent work target Polkadot Hub TestNet. Any future reviewer must treat the old Passet Hub language as historical design context, not as deployment instruction.

The project also assumes a **public-RPC-first** operational model. No custom node, no self-hosted archive, no private backend, and no local chain startup are required. The front-end, scripts, and monitoring utilities all depend on public RPC and explorer infrastructure. This is both a strength and a risk:

### Strengths
- easy to demo to judges
- low infrastructure burden
- easy for a reviewer to inspect public state
- feasible on a small Linux VPS without running a full Polkadot node

### Risks
- public RPC rate limiting
- public RPC availability fluctuations
- event reads are more fragile than direct indexed infrastructure
- long-running watch/monitor tooling is only baseline-level today

The project now mitigates some of that risk by adding:

- short-TTL caching in the front-end read layer
- a recent-events snapshot file (`dualvm/deployments/polkadot-hub-testnet-recent-events.json`)
- an event snapshot generator script (`dualvm/scripts/snapshotRecentEvents.mjs`)
- an operator-side watch script (`dualvm/scripts/liquidationWatch.mjs`)

This is a meaningful improvement, but it is not a production-grade data plane. It is still a thin observer model with fallback artifacts.

---

## 4. Contract system overview

The live protocol consists of seven deployed contracts plus one interface and one PVM-side artifact.

### 4.1 Live deployed contract addresses

Current live deployment from `dualvm/deployments/polkadot-hub-testnet.json`:

- AccessManager: `0x06Ca684578a01d6978654A4572B6A00Abe934575`
- WPAS: `0x0Dece14653B651Ee10df0bBcb286C9170A24e1bc`
- USDCMock: `0x789cf6A8B73Eab267C6B0eEa0E38fbE2AcD0Caf4`
- ManualOracle: `0x7627582B2183bf8327f0ead9aA1D352201c7De06`
- PvmRiskEngine: `0xe46b428cd93faD2601070E27ca9e6197f1576268`
- DebtPool: `0x7aFe578b08ffB14EdD6457f436fe68c3282D2B68`
- LendingCore: `0x42D489D093d00522a77405E6cEaE2F4B89956C25`

All of these are verified on Blockscout and recorded in:
- `dualvm/deployments/polkadot-hub-testnet-verification.json`

### 4.2 Contract-by-contract review

#### 4.2.1 `contracts/interfaces/IRiskEngine.sol`

This file defines the shape of the risk quote interface consumed by `LendingCore` and implemented by the risk engine contract.

Key concepts:
- `QuoteInput`
  - `utilizationBps`
  - `collateralRatioBps`
  - `oracleAgeSeconds`
  - `oracleFresh`
- `QuoteOutput`
  - `borrowRateBps`
  - `maxLtvBps`
  - `liquidationThresholdBps`

This interface matters because it is the seam between the solvency core and the bounded risk computation. It also makes it possible to keep the risk module swappable in theory without changing the entire lending core.

#### 4.2.2 `contracts/pvm/PvmRiskEngine.sol`

This is the bounded risk module. It is intentionally stateless and purely computational. It holds immutable parameters for the rate model and risk thresholds. It computes:

- borrow rate from utilization with a kink model
- max LTV and liquidation threshold based on fresh/stressed conditions
- stale penalty behavior

Important truth:
- the current live deployed system calls a contract deployed at the `riskEngine` address,
- the repo also generates a PVM artifact for this module into `dualvm/pvm-artifacts/PvmRiskEngine.json`,
- but the live deployment does **not** prove real REVM-to-PVM cross-VM execution.

That is why the current PVM posture is deliberately frozen as “parity / bounded computation posture”.

#### 4.2.3 `contracts/DualVMAccessManager.sol`

This is a thin wrapper around OpenZeppelin `AccessManager`.

Why it exists:
- it gives the project a stable protocol-specific contract identity for authority management,
- it keeps the system explicit about using the OpenZeppelin modern authority model,
- it simplifies deployment and verification naming.

Operationally, this contract is the root authority for all restricted admin actions.

#### 4.2.4 `contracts/WPAS.sol`

`WPAS` is the wrapped collateral token.

What it does:
- receives native PAS
- mints ERC-20 `WPAS` 1:1
- allows withdrawal of native PAS by burning `WPAS`
- provides ERC-20 semantics for collateral handling

Why it exists:
- the lending system is much easier to reason about if collateral behaves like a normal ERC-20,
- this keeps the collateral path compatible with standard EVM token handling,
- it avoids forcing native-asset quirks directly into lending logic.

Main functions:
- `deposit()` / `depositTo()`
- `withdraw()` / `withdrawTo()`
- `receive()` fallback for direct native token wrap

Security characteristics:
- uses `ReentrancyGuard`
- explicit zero-amount rejection
- explicit transfer failure handling on unwrap

This contract is simple and intentionally boring, which is good.

#### 4.2.5 `contracts/USDCMock.sol`

`USDCMock` is the debt and LP-side asset.

What it does:
- standard ERC-20 behavior
- fixed decimals = `18`
- restricted `mint(address,uint256)` through `AccessManaged`

This is a mock asset by deliberate design. It is not a fake production stablecoin integration. The project now documents this explicitly in:
- `docs/dualvm/dualvm_asset_path_decision.md`
- `dualvm/src/lib/assetRegistry.ts`

Why it is still used:
- clean metadata
- predictable EVM UX
- avoids pretending the Polkadot asset precompile path is production-ready in this MVP
- aligns with the current honest hackathon scope

Production problem:
- it is centrally mintable and economically synthetic
- LP and liquidator funding based on it is not market-realistic

#### 4.2.6 `contracts/ManualOracle.sol`

This contract changed significantly during the work.

Original behavior:
- store a single `priceWad`
- store `lastUpdatedAt`
- enforce `maxAge`
- revert if stale

Current hardened behavior:
- all of the above, plus:
  - `minPriceWad`
  - `maxPriceWad`
  - `maxPriceChangeBps`
  - `setCircuitBreaker(...)`
  - revert on out-of-bounds price
  - revert on excessive price delta relative to prior price

Important errors:
- `OraclePriceUnset`
- `OraclePriceStale`
- `OraclePriceOutOfBounds`
- `OraclePriceDeltaTooLarge`
- `InvalidConfiguration`

Operational meaning:
- the oracle is still manual and centralized,
- but it now has explicit guardrails against obviously invalid updates and violent one-step moves,
- this is still not a decentralized oracle network,
- but it is no longer a bare single-value mutable variable with only freshness checks.

The current live oracle is:
- `0x7627582B2183bf8327f0ead9aA1D352201c7De06`

Current observed live state after crosscheck:
- price = `1000.0`
- min price = `1.0`
- max price = `10000.0`
- max price change = `2500` bps
- fresh = `true`

Proof artifact:
- `dualvm/deployments/polkadot-hub-testnet-oracle-proof.json`

#### 4.2.7 `contracts/DebtPool.sol`

This is the LP-side pool and share-accounting contract.

Core responsibilities:
- ERC-4626-style liquidity pool for `USDC-test`
- tracks `supplyCap`
- tracks `outstandingPrincipal`
- tracks `reserveBalance`
- provides `availableLiquidity()`
- allows `drawDebt()` by `LendingCore`
- records repayments and principal losses

Important state:
- `lendingCore`
- `outstandingPrincipal`
- `supplyCap`
- `reserveBalance`

Important logic:
- `deposit`, `mint`, `withdraw`, `redeem` are constrained by liquidity and cap logic
- `drawDebt` transfers debt asset out and increments outstanding principal
- `recordRepayment` splits principal reduction from interest reserve cut
- `recordLoss` only writes down principal, not accrued interest
- reserve-cut interest is segregated into `reserveBalance`, and because `availableLiquidity()` subtracts reserves while `totalAssets()` is `availableLiquidity() + outstandingPrincipal`, that reserve slice is not part of LP-withdrawable cash until it is explicitly claimed to treasury. This is a real accounting choice owned by `DebtPool`, not by the collateral token.

This last point matters because it is what made the original bad-debt bug possible when `LendingCore` tried to push a total debt value into a principal-only accounting function.

#### 4.2.8 `contracts/LendingCore.sol`

This is the actual product.

It is the central state machine for:
- collateral deposit
- collateral withdrawal
- debt opening
- debt accrual
- repayment
- liquidation
- risk snapshot persistence

Important state:
- immutable references to collateral asset and debt asset
- references to `DebtPool`, `ManualOracle`, `IRiskEngine`
- `borrowCap`
- `minBorrowAmount`
- `reserveFactorBps`
- `maxConfiguredLtvBps`
- `maxConfiguredLiquidationThresholdBps`
- `liquidationBonusBps`
- `positions[address]`

Each position stores:
- collateral amount
- principal debt
- accrued interest
- borrow rate snapshot
- max LTV snapshot
- liquidation threshold snapshot
- last accrual timestamp
- last risk update timestamp

This contract is where almost all protocol truth lives.

##### Borrow path
The borrow path roughly does:
1. accrue pending interest
2. read fresh oracle price via `latestPriceWad()`
3. query risk engine
4. derive effective risk bounds
5. enforce borrow cap
6. enforce minimum borrow
7. persist debt and snapshot state
8. check borrow safety locally
9. ask `DebtPool` to transfer debt asset

##### Repay path
The repay path roughly does:
1. accrue pending interest
2. cap payment at total debt
3. transfer debt asset to `DebtPool`
4. pay interest first, principal second
5. call `DebtPool.recordRepayment(principalPaid, interestPaid, reserveFactorBps)`
6. either clear debt state or refresh risk snapshot if debt remains
- if debt remains after a partial repay, the core refreshes the risk snapshot only when the oracle path is still fresh; otherwise repayment still succeeds but no fresh risk snapshot is written in that branch.

##### Liquidation path
The liquidation path roughly does:
1. accrue interest
2. require nonzero debt
3. require fresh oracle through `latestPriceWad()`
4. refresh risk snapshot
5. require health factor below 1
6. compute repay amount limited by debt and collateral value
7. transfer debt asset from liquidator to pool
8. split payment into interest then principal
9. call `recordRepayment`
10. seize collateral to liquidator
11. if collateral exhausted and debt remains, handle bad debt
12. if collateral remains after liquidation, the core still enforces the minimum-debt floor on the residual position; liquidation cannot leave a dust debt smaller than `minBorrowAmount` without reverting.

##### The bad-debt bug that was fixed
Originally, exhausted-collateral liquidation could do:
- compute `remainingDebt = _currentDebt(position)`
- call `DebtPool.recordLoss(remainingDebt)`

That was wrong because `remainingDebt` included accrued interest, while `DebtPool.recordLoss` only accepts principal loss.

Current fix:
- only `position.principalDebt` is written down through `DebtPool.recordLoss(...)`
- unpaid accrued interest is cleared with the borrower position instead of being pushed into principal-loss accounting

This fix is present in the current code and has both local and live proof.
One additional nuance matters for forensic reconciliation: the pool only records principal loss, but the `badDebtWrittenOff` / `BadDebtRealized` values emitted by `LendingCore` still represent total borrower debt forgiven at that point, including any residual accrued interest. So event-level bad-debt amounts and pool principal-loss amounts are intentionally not the same quantity.

##### Remaining concerns in `LendingCore`
- still depends on a manual oracle
- still depends on a mock debt asset
- still uses centralized admin-controlled dependencies
- still does not prove live PVM execution semantics

### 4.3 Contract communication summary

On-chain contract communication is now:

- `LendingCore` reads `ManualOracle`
- `LendingCore` reads `PvmRiskEngine`
- `LendingCore` calls `DebtPool.drawDebt()`
- `LendingCore` calls `DebtPool.recordRepayment()`
- `LendingCore` calls `DebtPool.recordLoss()`
- `AccessManager` governs mutation permissions across `USDCMock`, `ManualOracle`, `DebtPool`, and `LendingCore`
- `WPAS` is externalized and approved into `LendingCore`

This architecture is coherent and understandable. The biggest truth caveat remains that the live risk engine call path is still not proven to cross VM boundaries.

---

## 5. Front-end review

The front-end is under `dualvm/src/` and is intentionally an observer/read shell.

### 5.1 Files

- `src/main.tsx`
  - bootstraps the app
- `src/App.tsx`
  - main UI composition
- `src/style.css`
  - styling
- `src/components/MetricCard.tsx`
  - simple metric display card
- `src/lib/manifest.ts`
  - typed import of the deployment manifest
- `src/lib/abi.ts`
  - view-level ABI fragments for contracts
- `src/lib/readModel.ts`
  - live read layer, cache, event reads, fallback snapshot handling
- `src/lib/format.ts`
  - formatting utilities
- `src/lib/assetRegistry.ts`
  - explicit asset truth registry

### 5.2 What the UI actually does now

The UI presents:
- network and faucet information
- deployment manifest addresses
- pool-level metrics
- oracle metrics
- oracle circuit breaker metrics
- tracked-address observer mode:
  - current debt
  - available to borrow
  - health factor
- recent events list from `LendingCore`
- scope guardrails
- asset-path truth section
- explicit observer-only posture in the text
The recent-activity pane is explicitly a capped preview, not a full history browser. Live event reads scan only a recent 5,000-block window and the UI renders just the newest eight items; if the live log query fails, those rows may instead come from the cached snapshot artifact rather than a fresh chain query.

### 5.3 What the UI does **not** do

It does not:
- connect a browser wallet for writes
- submit borrow/repay/liquidation transactions from the browser
- act like a full product frontend
- persist indexed data in a backend
- include a dedicated watcher service or backend API

This is now clearly stated in the docs and UI. That is a strength from a truthfulness perspective, but a limitation from a polish perspective.
Another operationally important boundary: pausing is asymmetric across contracts. `LendingCore.pause()` blocks collateral deposit, collateral withdrawal, and borrowing, but it does not block `repay()` or `liquidate()`. `DebtPool.pause()` independently blocks LP entry/exit and new debt draws because `deposit`, `mint`, `withdraw`, `redeem`, and `drawDebt` are `whenNotPaused`, while `recordRepayment`, `recordLoss`, and reserve accounting still continue. Separately, pausing the oracle causes `isFresh()` to return false and `latestPriceWad()` to revert, which changes the borrow/withdraw/liquidation read path without acting like a full protocol halt.

### 5.4 `readModel.ts`

This file is the actual client-side read logic.

It does all of the following:
- creates a public viem client against the manifest RPC URL
- reads core pool and oracle state directly from chain
- reads per-address debt, borrow headroom, and health factor when a tracked address is provided
- fetches recent lending events by querying logs
- maintains a short-TTL in-memory snapshot cache
- falls back to `deployments/polkadot-hub-testnet-recent-events.json` if live event log queries fail

This is the key improvement in RPC/indexing resilience that was added late in the build.
That resilience is narrower than it may first sound. The fallback snapshot only covers the recent-activity pane. The main pool/oracle/observer cards still depend on live RPC reads and will surface a read error if those calls fail. Also, the same-address observer refresh remains cache-gated for the full 10-second TTL; pressing Refresh does not bypass the cache if the tracked address has not changed.

### 5.5 `assetRegistry.ts`

This file exists to make the asset truth explicit. It avoids quietly implying a production-real stablecoin path.

Current entries:
- `WPAS` as real collateral path
- `USDC-test` as intentional metadata-stable mock debt/LP asset path

This is valuable because reviewers and judges can see the asset honesty directly in the UI and code.
The watchlist-backed observer scope is also deliberately narrow: the repo's watchlist file contains only four explicit addresses, so neither the UI nor the operator scripts should be read as a complete market-wide actor inventory. They are selected-address tools, not a general discovery layer.

### 5.6 Vercel assumptions

The project assumes a front-end-only hosting model that could fit on Vercel, but there is no concrete Vercel project config in the repo:
- no `vercel.json`
- no `.vercel/` project folder
- no deployment hooks or explicit environment mapping

So Vercel is still an assumed hosting target, not a configured repository deployment target. That matters. The docs talk about Vercel as a suitable platform, but the codebase does not yet carry Vercel-specific deployment files. This would not block a manual Vercel deployment of a plain Vite app, but it means Vercel is not “operationally configured” inside the repository.

---

## 6. Deployment flow, config, and manifests

### 6.1 Core config files

- `dualvm/package.json`
- `dualvm/hardhat.config.ts`
- `dualvm/scripts/marketConfig.ts`
- `dualvm/deployments/polkadot-hub-testnet.json`

### 6.2 `package.json`

This file is important because the project is script-driven.

Current high-value scripts include:
- `npm test`
- `npm run build`
- `npm run deploy:testnet`
- `npm run verify:testnet`
- `npm run repay-smoke:testnet`
- `npm run risk-smoke:testnet`
- `npm run oracle-smoke:testnet`
- `npm run minter-smoke:testnet`
- `npm run watch:testnet`
- `npm run index-events:testnet`
- `npm run liquidate:testnet`
- `npm run governance:apply`
- `npm run oracle-upgrade:testnet`

Notably absent:
- no `lint` script
- no `format` script
- no CI wrapper script
- no Docker build/publish script
- no npm publish script

Also important:
- `package.json` is marked `private: true`
- this means there is no intended npm publication in the current form

### 6.3 `hardhat.config.ts`

This file sets:
- Solidity compiler version `0.8.28`
- `cancun` EVM target
- two live networks:
  - `polkadotHubTestnet`
  - `polkadotHubTestnetFallback`
- Blockscout verification settings for Polkadot Hub TestNet
- The fallback RPC network is present in config, but it is not exposed as a first-class deploy/verify target in the shipped npm command surface. The published workflow uses `polkadotHubTestnet`; the fallback is a manual escape hatch rather than a parallel supported deployment lane.

Environment-driven values:
- `PRIVATE_KEY`
- `POLKADOT_HUB_TESTNET_RPC_URL`
- `POLKADOT_HUB_TESTNET_RPC_FALLBACK_URL`
- `BLOCKSCOUT_API_KEY`

### 6.4 `marketConfig.ts`

This file centralizes:
- network constants
- role IDs
- target admin delay
- live execution-delay defaults
- risk-engine parameters
- oracle defaults
- oracle circuit-breaker defaults
- pool defaults
- core defaults

This is the parameter truth surface for the current system.

### 6.5 `deploySystem.ts` and `deploy.ts`

`deploySystem.ts` is the reusable deploy constructor. It:
- deploys all contracts
- labels roles
- grants roles
- maps target function roles in AccessManager
- sets target admin delays
- sets `DebtPool.lendingCore`
- optionally seeds pool liquidity
- returns network / governance / config / contract references
By itself, `deploySystem.ts` is more permissive than the current live posture: if no overrides are passed, it defaults `treasury`, `emergencyAdmin`, `riskAdmin`, `treasuryOperator`, and `minter` to the deployer and defaults role execution delays to zero. The current safer posture exists only because the caller layer and later governance scripts explicitly inject different role addresses and non-zero delays.

`deploy.ts` is the manifest writer wrapper. It:
- accepts environment overrides
- calls `deployDualVmSystem(...)`
- writes `deployments/polkadot-hub-testnet.json`
That means a reviewer should treat `deploySystem.ts` as a generic constructor, not as proof that the live governance posture is the default. The live deployment truth comes from the manifest plus the post-deploy governance application and proof artifacts.
One more subtlety matters here: the `treasury` address passed into `LendingCore` is the reserve recipient recorded in protocol state, while `treasuryOperator` is the AccessManager-controlled role holder that can actually call treasury-gated functions such as reserve claims. Those are related but not identical concerns in the deployment model.

The manifest contains:
- network values
- current role addresses
- governance metadata including execution delays
- config values
- deployed addresses

### 6.6 Current deployment manifest truth

From `dualvm/deployments/polkadot-hub-testnet.json`:
- live contract addresses
- role addresses
- governance delays
- hardened oracle circuit-breaker defaults
- protocol parameter values

This is the machine-readable live source of truth.
It also carries the deployment snapshot timestamp, the bundled network descriptor (`networkName`, RPC URLs, explorer, faucet), the one-hour target-admin delay (`config.adminDelaySeconds`), and the root AccessManager admin under `governance.admin`. Those fields are the only machine-readable record of the root governance posture for the live deployment.

### 6.7 Verification artifact

`dualvm/deployments/polkadot-hub-testnet-verification.json` contains explorer links for the current deployment.

Important note:
- the project now **does** preserve verified explorer URLs,
- but it still does **not** persist the original deployment transaction hashes in the manifest.

That means:
- a reviewer can inspect verified code pages,
- but cannot reconstruct all deployment tx hashes from the manifest alone.

### 6.8 Governance and oracle proof artifacts

- `dualvm/deployments/polkadot-hub-testnet-governance-proof.json`
  - contains role addresses
  - execution delays
  - tx hashes for risk-admin and minter proof actions
  - importantly, this proof artifact only proves delayed action flows for risk-admin and minter. It lists the broader operational role set, but it does not itself prove treasury or emergency execution paths.

- `dualvm/deployments/polkadot-hub-testnet-oracle-proof.json`
  - contains oracle address
  - circuit-breaker defaults
  - tx hashes for oracle upgrade and oracle smoke actions

- `dualvm/deployments/polkadot-hub-testnet-recent-events.json`
  - cached recent lending event snapshot with tx hashes and block numbers

---

## 7. Exact commands used or supported

### 7.1 Install / bootstrap

Manual install:
- `cd dualvm && npm install`

Bootstrap script:
- `cd dualvm && ./init.sh`

`init.sh` behavior:
- if `node_modules` is missing, run `npm install`
- run `npm test`
- run `npm run build`

### 7.2 Build and test

- `cd dualvm && npm test`
- `cd dualvm && npm run build`
- `cd dualvm && npm run build:pvm`
- `cd dualvm && npm run build:app`
- `cd dualvm && npm run compile`

No lint command exists.
No formatter command exists.

### 7.3 Deployment and verification

- `cd dualvm && npm run deploy:testnet`
- `cd dualvm && npm run verify:testnet`

### 7.4 Live proof scripts

- `cd dualvm && npm run repay-smoke:testnet`
- `cd dualvm && npm run risk-smoke:testnet`
- `cd dualvm && npm run oracle-smoke:testnet`
- `cd dualvm && npm run minter-smoke:testnet`
- `cd dualvm && npm run watch:testnet`
- `cd dualvm && npm run index-events:testnet`
- `cd dualvm && npm run liquidate:testnet`
- `cd dualvm && npm run governance:apply`
- `cd dualvm && npm run oracle-upgrade:testnet`

### 7.5 Environment variables and secrets

The script surface depends heavily on environment variables rather than checked-in secrets.

Important environment variables in use include:

#### Hardhat / network config
- `PRIVATE_KEY`
- `POLKADOT_HUB_TESTNET_RPC_URL`
- `POLKADOT_HUB_TESTNET_RPC_FALLBACK_URL`
- `BLOCKSCOUT_API_KEY`

#### Deploy-time overrides
- `TREASURY_ADDRESS`
- `EMERGENCY_ADMIN`
- `RISK_ADMIN`
- `TREASURY_OPERATOR`
- `MINTER`
- `INITIAL_LIQUIDITY`
- `INITIAL_ORACLE_PRICE_WAD`
- `ORACLE_MAX_AGE_SECONDS`
- `ADMIN_DELAY_SECONDS`
- `EMERGENCY_EXECUTION_DELAY_SECONDS`
- `RISK_ADMIN_EXECUTION_DELAY_SECONDS`
- `TREASURY_EXECUTION_DELAY_SECONDS`
- `MINTER_EXECUTION_DELAY_SECONDS`

#### Role/application scripts
- `ADMIN_PRIVATE_KEY`
- `EMERGENCY_PRIVATE_KEY`
- `RISK_PRIVATE_KEY`
- `TREASURY_PRIVATE_KEY`
- `MINTER_PRIVATE_KEY`
- `LENDER_PRIVATE_KEY`
- `BORROWER_PRIVATE_KEY`
- `LIQUIDATOR_PRIVATE_KEY`
- `RECIPIENT_PRIVATE_KEY`
- `BORROWER_ADDRESS`

### 7.6 Secrets handling verdict

Good:
- `.env` is gitignored
- `wallets/*.txt` is gitignored
- manifests and proof artifacts store addresses and tx hashes, not private keys

Bad:
- the repo still contains local wallet text files with private keys and mnemonics under `dualvm/wallets/`
- these are gitignored but still present in the working tree
- commands were historically run with private keys passed inline via shell env assignments
- there is no `.env.example`
- there is no dedicated secret management pattern beyond “set env vars manually”

This is acceptable for local hackathon execution but weak for a cleaner shared engineering workflow.

---

## 8. Test strategy and actual proof coverage

### 8.1 Local tests

Only one substantive local test file exists:
- `dualvm/test/LendingCore.ts`

Current test cases:
1. supports deposit, borrow, repay, and liquidation
2. liquidation clears bad debt when accrued interest remains
3. rejects excessive oracle jumps until the circuit breaker is widened
4. rejects borrow attempts when the oracle is stale
5. prevents non-admin minting of the debt asset

This is decent focused coverage for a small MVP, but it is not broad coverage.
More specifically, local tests do not directly cover collateral withdrawal branches, pause/unpause behavior, reserve claiming, or the residual-debt floor after partial liquidation. Those are real state-machine branches in the current contracts even though they are not covered by a dedicated local test case.

What is not covered locally in a dedicated test file:
- frontend behavior
- event snapshot generation
- operator watch script behavior
- manifest-writing semantics
- verification script behavior
- delayed AccessManager scheduling edge cases in generalized form

### 8.2 Real public-testnet proofs

The following are proven live in some form:
- deployment to current Polkadot Hub TestNet
- explorer verification
- supply/LP path
- borrow path
- repay path
- liquidation path
- bad-debt liquidation accounting after the fix
- risk-admin delayed actions
- minter delayed actions
- oracle hardening upgrade
- oracle circuit-breaker delayed actions
- monitoring/watch read path
- guarded operator liquidation refusal on a safe borrower

### 8.3 What is only locally proven or still theoretical

- true live cross-VM PVM execution is still theoretical / unproven in the deployed path
- production-grade oracle behavior under independent data sources is not proven
- real debt-asset integration is not present
- service-grade automation is not present

### 8.4 Important nuance about live scripts

The live scripts are strong evidence, but they are not the same as a polished demo harness. Several of them:
- require environment variables with private keys
- assume pre-funded test wallets
- may temporarily mutate live oracle or risk-engine state and then restore it
- are operator tools, not judge-friendly front-end flows
- if one of the delayed or state-mutating scripts is aborted mid-run, the intended cleanup or restoration step may not execute, leaving the live system temporarily in a non-default intermediate state until an operator restores it.

This is acceptable for internal proof. It is not the same as having a polished live demo application.

---

## 9. What was tested on the real public testnet vs only locally

### Live public-testnet validated
- contract deployment
- explorer verification
- borrow flow
- repay flow
- liquidation flow
- delayed minter action proof
- delayed risk-admin action proof
- oracle upgrade and circuit-breaker proof
- watch script
- liquidator operator dry-run safety gate
- event snapshot generation (`npm run index-events:testnet`) and recent-events fallback behavior

### Local-only or not directly live-proven as a packaged experience
- full end-user write flow through the browser UI
- full Vercel deployment process
- service-grade monitoring process
- multi-source oracle integration
- real debt-asset path
- live cross-VM PVM invocation path

---

## 10. Error cases, revert paths, and protocol assumptions

### 10.1 Core lending assumptions
- oracle must be fresh for borrow and withdrawal
- debt pool must have liquid cash for debt draws
- borrower must stay within LTV bounds
- `DebtPool` principal accounting reflects principal, not accrued interest
- liquidator must approve enough debt asset to execute liquidation
- USDC-test minting remains an authority-gated operation

### 10.2 Important revert paths

In current code, some of the meaningful revert paths include:
- zero amount actions
- invalid configuration
- stale oracle (`OraclePriceStale`)
- oracle out-of-bounds price
- oracle price delta too large
- borrow cap exceeded
- insufficient collateral
- debt below minimum borrow amount
- liquidation of healthy position
- supply cap exceeded
- insufficient liquidity
- unauthorized access-managed actions

### 10.3 Important changed assumption after oracle hardening

The manual oracle is no longer just “fresh or stale”. It now also enforces:
- price within configured min/max bounds
- stepwise price change within `maxPriceChangeBps`, unless risk admin temporarily widens the breaker

This improves safety but also makes large demo-induced price moves dependent on risk-admin control and delayed execution.

---

## 11. Security concerns and weak spots

This section is intentionally blunt.

### 11.1 Still weak or centralized
- ultimate AccessManager admin remains a single EOA
- manual oracle remains centralized even though hardened
- debt asset remains mock and centrally mintable
- no multisig
- no timelocked governance layer above AccessManager admin

### 11.2 Still incomplete for production
- no decentralized oracle
- no real stable asset path
- no always-on liquidator service
- no alerting service
- no dedicated indexer
- no front-end transaction UX
- no CI/lint/security pipeline

### 11.3 No live PVM execution proof
This remains the most important architectural truth gap.

The repository now does a much better job of stating this honestly. However, any reviewer expecting “live DualVM execution” from the deployed system will still find that the live solvency-critical path is not actually proven as REVM-to-PVM cross-VM execution.

### 11.4 Residual governance concern
Operational role separation has improved materially. That is good. But the admin root remains one account. The correct production direction would be:
- multisig or timelocked admin
- then operational sub-roles beneath that

### 11.5 Potential reviewer trap
The repo now contains both historical specs and current-state docs. That is useful for engineering context but potentially confusing to an external reviewer if they read old specs first. This is why the addendum and parity checklist matter. If a public submission is curated more tightly, historical docs may need clearer supersession labeling or relocation.

---

## 12. What is fully built, partially built, mocked, skipped, broken, or risky

### Fully built and evidenced
- live deployment on current public testnet
- verified contracts
- borrow/repay/liquidation smoke coverage
- bad-debt accounting fix
- observer front-end with health factor and recent events
- role separation for operational roles
- delayed minter/risk actions
- hardened manual oracle with circuit breaker
- asset-path truth docs
- monitoring/watch baseline scripts
- recent-event snapshot generation
- workflow artifacts

### Partially built
- front-end as a full user product (reads only, not polished writes)
- governance model (operationally improved, root admin still centralized)
- PVM story (truthful parity posture, not live cross-VM execution)

### Mocked intentionally
- debt asset / LP asset (`USDC-test`)
- manual oracle data source

### Skipped intentionally
- XCM in critical flow
- multi-market expansion
- native asset/precompile debt path in critical flow
- generalized stablecoin integration

### Broken now
At the moment of this audit, no known critical functional break remains in the current documented hackathon-scope implementation. The previously identified bad-debt liquidation accounting issue has been fixed and proven.

### Still risky
- root admin single point of control
- manual oracle trust model
- public RPC dependence
- front-end write UX absence for demo polish
- no deep observability backend
- no live cross-VM proof

---

## 13. Package publishing and repository-publication status

### npm
- `package.json` has `"private": true`
- there is no publish configuration
- there is no evidence of an npm package release workflow

### PyPI
- no `pyproject.toml`
- no `setup.py`
- no Python packaging metadata
- no evidence of PyPI publication

### GitHub / CI
- no `.github/` directory visible in the current workspace root listing
- no GitHub Actions workflow present in the working tree
- no evidence of CI pipelines in-repo

### Git repository metadata
- top-level directory listing did not show a `.git/` directory in the current workspace snapshot
- therefore no git remote or branch metadata is described here
- if this workspace is later pushed into a GitHub repo, that publication step is external to the current working-tree evidence

---

## 14. Production-readiness verdict

The project is not production-ready.

That statement is not a criticism of scope discipline. It is simply the technically correct verdict.

### Why it is not production-ready
- centralized root admin
- manual oracle, even though hardened
- mock debt asset
- no multisig/timelock admin root
- no live cross-VM execution proof
- no service-grade monitoring stack
- no real indexer-backed app state plane
- no polished front-end write UX
- no CI/lint/security automation

### Why it is still a credible hackathon MVP
- live on public testnet
- on-chain borrowing, repayment, and liquidation proved
- explorer verification complete
- architecture coherent and narrow
- truthfulness improved materially through docs and proof artifacts
- weak spots are documented rather than hidden

---

## 15. Final “done / not done / risky / fake-complete” table

| Area | State | Evidence | Notes |
|---|---|---|---|
| Current network retarget | DONE | `hardhat.config.ts`, manifest, README | Uses Polkadot Hub TestNet `420420417` |
| Live deployment | DONE | `deployments/polkadot-hub-testnet.json` | Current addresses recorded |
| Explorer verification | DONE | `deployments/polkadot-hub-testnet-verification.json` | Verified pages exist |
| Borrow flow | DONE | `scripts/liveSmoke.ts`, recent events snapshot | Live proof exists |
| Repay flow | DONE | `scripts/liveRepaySmoke.ts` | Live proof exists |
| Liquidation flow | DONE | `scripts/liveLiquidationSmoke.ts`, recent events snapshot | Live proof exists |
| Bad-debt accounting fix | DONE | `contracts/LendingCore.sol`, `test/LendingCore.ts` | Previously risky, now fixed |
| Oracle circuit breaker | DONE | `contracts/ManualOracle.sol`, `oracle-proof.json` | Hardened but still centralized |
| Operational role separation | DONE | `governance-proof.json`, manifest | Operational roles split |
| Delayed minter/risk actions | DONE | governance proof + smoke scripts | 5-second execution delays |
| Observer UI health factor/events | DONE | `src/App.tsx`, `src/lib/readModel.ts` | Read-only UX |
| Recent-event fallback snapshot | DONE | `snapshotRecentEvents.mjs`, snapshot JSON | Lightweight resilience, not full indexer |
| Workflow artifacts | DONE | `SPEC.md`, `features.json`, `progress.md`, `init.sh` | Restart surface exists |
| Asset-path truth | DONE | `assetRegistry.ts`, `dualvm_asset_path_decision.md` | Honest mock-stable posture |
| PVM posture doc | DONE | `dualvm_pvm_posture.md` | Freezes truthful wording |
| Full end-user front-end write UX | NOT DONE | no write flows in `src/` | Observer shell only |
| Multisig/timelocked root admin | NOT DONE | manifest + docs | Root admin still one EOA |
| Decentralized oracle | NOT DONE | docs + contract review | Hardened manual only |
| Real stable debt asset integration | NOT DONE | asset decision doc | Intentionally mock for current scope |
| Full indexing service | NOT DONE | no backend/indexer dir | Snapshot fallback only |
| Liquidator daemon/service | NOT DONE | scripts only | Manual operator tooling only |
| Live cross-VM PVM execution proof | NOT DONE | PVM posture doc | Parity-only truth frozen |
| “Production-ready” claim | FAKE-COMPLETE if claimed | docs explicitly forbid it | Must not be claimed |
| “Fully DualVM live execution” claim | FAKE-COMPLETE if claimed | PVM posture doc explicitly forbids it | Must not be claimed |
| “Real stablecoin integration” claim | FAKE-COMPLETE if claimed | asset decision doc explicitly forbids it | Must not be claimed |
| Public-RPC dependence | RISKY | runtime model, read layer | Acceptable for MVP, fragile at scale |
| Root admin centralization | RISKY | manifest, docs | Biggest governance weakness |
| Manual oracle trust | RISKY | `ManualOracle.sol` | Hardened, still centralized |
| Wallet secrets in local workspace | RISKY | `wallets/*.txt`, `.gitignore` | Gitignored, but still present locally |

---

## 16. Final auditor conclusion

The project now exists as a live, narrow, technically coherent public-testnet lending MVP with a substantially improved truth surface. It is not a slide deck pretending to be a product. It has real deployed contracts, verified code pages, live smoke proofs, an observer front-end, explicit asset and PVM truth documents, a hardened but still manual oracle, split operational roles, delayed admin actions for sensitive operational roles, and basic operator/watch tooling.

At the same time, it is not remotely production-ready. The core reasons are not subtle:
- centralized root governance,
- manual oracle,
- mock debt asset,
- no live cross-VM proof,
- no full front-end write UX,
- no deep indexer or backend observability plane,
- no service-grade automation.

For hackathon submission, this is acceptable if and only if the README, demo, and submission use the current truth rather than the older, more ambitious or stale interpretation. For a serious production roadmap, the remaining work is substantial and should be treated as a new phase, not a small patch set.

This handoff should therefore be read with one rule in mind:
- trust what is proven by a file, manifest, or live proof artifact,
- distrust any stronger interpretation that is not explicitly evidenced.
