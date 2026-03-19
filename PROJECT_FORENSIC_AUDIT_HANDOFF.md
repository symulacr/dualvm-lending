# Project Forensic Audit and Implementation Handoff

Project root audited: `/home/kpa/polkadot`

Date of audit handoff: 2026-03-16

## 1. Executive reality check

This repository is not one clean, singular, production-ready application. It is a monorepo-like working tree centered on one active project, `dualvm/`, surrounded by a large body of project documentation, review artifacts, planning files, and harness metadata. The active codebase is the `dualvm/` directory. Everything else is either repo-level control metadata, archived or supporting documentation, submission evidence, or unrelated spec-only material.

The strongest current technical truth is this:

1. A live public testnet lending system exists on Polkadot Hub TestNet.
2. Dedicated probe contracts prove live REVM <-> PVM interoperability on the public chain.
3. A separate versioned market deployment exists where an immutable-per-version `LendingCore` consumes ticketed quotes through `RiskAdapter`, backed by a proven live PVM quote engine.
4. A separate governed deployment exists where governance root is no longer a single EOA: a 2-of-3 multisig schedules privileged operations into a timelock, and the timelock holds the real `AccessManager` admin boundary.
5. Migration-capable next-market hooks exist in code and are locally tested, but live migration is not yet proven on the governed deployment.

The strongest negative truth is this:

1. The repo still contains multiple overlapping “current” narratives from different implementation eras.
2. Explorer verification is complete only for the older baseline deployment family. The newer versioned and governed deployments have public-chain proof artifacts and tx hashes, but those newer deployments are not backed by an in-repo completed verification artifact.
3. The live product path is still not fully decentralized because the active oracle dependency is still `ManualOracle`, whose parameters and updates remain governance-controlled.
4. The hosted frontend is not a full user dApp. It is an observer-first read shell. Write-path proof comes from operator-run scripts and explorer links, not from end-user browser transaction flows.
5. The debt asset remains `USDC-test`, a mock ERC-20. This repo is explicit about that, but any reviewer who expects a real stablecoin integration would find that absent.
6. The migration format exists in code and tests, but it is not yet proven live.

This handoff therefore treats the project as a layered system with four distinct proof/status planes:

- historical baseline deployment plane,
- probe-based interoperability plane,
- versioned market plane,
- governed-root plane.

Any audit-grade reading of the repo must keep those planes separate. A major risk in this codebase is not just bugs; it is over-reading one proof plane as if it applied universally to all deployments and all docs.

A second reality check is needed about scope. The user requested that the entire project folder be read recursively and audited. The project root includes generated artifact trees (`dualvm/out/`, `dualvm/artifacts/`, `dualvm/artifacts-pvm/`, `dualvm/cache/`, `dualvm/cache-pvm/`, `dualvm/dist/`, `dualvm/pvm-artifacts/`), a large `node_modules/` vendor tree, and Git metadata under `.git/`. Those are inventoried and classified below. The semantic, line-by-line implementation review in this handoff focuses on project-authored code, tests, scripts, configs, manifests, and docs. Vendor dependencies and generated artifact trees are described as such and cross-checked against their generators and source-of-truth inputs; they are not treated as original authored modules.

The current project is therefore best described as:

- a serious public-testnet prototype,
- with real on-chain proofs,
- with meaningful architecture evolution already implemented,
- but with non-trivial remaining decentralization, migration, verification, and UX work.

It is not fake. It is also not complete in the strongest sense implied by some of its more optimistic docs.

---

## 2. Full folder tree with per-item explanations

The project root contains the following top-level structure:

```text
/home/kpa/polkadot
├── .claude/
├── .desloppify/
├── .git/
├── .github/
├── .gitignore
├── .lsp.json
├── .omp/
├── CLAUDE.md
├── PLAN.md
├── PROJECT_FORENSIC_AUDIT_HANDOFF.md
├── README.md
├── docs/
├── dualvm/
└── scorecard.png
```

### 2.1 Root-level items

#### `.claude/`
Contains harness/agent memory material. The listing visible during audit shows:
- `.claude/skills/`

This is not runtime product code. It is workflow metadata for the coding environment.

#### `.desloppify/`
Contains repo-analysis support data for the harness. The listing shows:
- `config.json`
- `config.json.bak`
- `plan.json`
- `plan.json.bak`
- `query.json`
- `review_packet_blind.json`
- `review_packets/`
- `state-typescript.json`
- `state-typescript.json.bak`
- `subagents/`

This is not application runtime code. It is audit/tooling metadata.

#### `.git/`
Git metadata. Present because this is a working repository. It is not application logic and is not treated as source-of-truth behavior.

#### `.github/`
Contains CI. The important file is:
- `.github/workflows/ci.yml`

This workflow confirms that CI is scoped to `dualvm/` and runs:
- `npm ci`
- `npm test`
- `npm run build`

This is meaningful because it defines what the repo continuously validates automatically, and what it does not. It does not run live deployment, live smoke, probe scripts, or verification.

#### `.gitignore`
Root ignore file. It explicitly ignores:
- `.omp/`
- `PLAN.md`
- `.desloppify/`
- `.claude/`
- `scorecard.png`

This file shows which root-level artifacts are considered agent/harness or ephemeral by repo policy.

#### `.lsp.json`
Repo-level language server configuration. It wires TS, JSON, CSS, HTML, YAML, Bash, Python, Rust, TOML, and Solidity language servers to this repo, with root markers that point at both the repo root and the nested `dualvm/` package. This is a control file, not runtime logic, but it matters because it defines the development environment assumptions.

#### `CLAUDE.md`
Project memory / policy note. Important because it states:
- source priority among docs,
- locked product decisions,
- network endpoints,
- debt asset truth (`USDC-test`),
- oracle posture,
- submission framing,
- caveats like public RPC instability and the metadata limitations of precompile assets.

This file is not runtime code, but it materially affects how contributors or reviewers understand intent and scope.

#### `PLAN.md`
Checked-in planning artifact for architectural migration. It is not current behavior. It is useful to understand intended direction and prior refactor sequencing.

#### `README.md`
The most important root-level human-facing document. It currently claims the versioned market deployment as the current live product path and references the VM interop proof and versioned market proof.

#### `docs/`
Top-level documentation tree. It contains at least two subdomains:
- `docs/dualvm/` — active project docs
- `docs/sentinelos/` — unrelated spec-only material

#### `dualvm/`
The active executable project. This directory contains all contracts, frontend code, scripts, tests, configs, manifests, and generated outputs that actually implement DualVM.

#### `scorecard.png`
Root-level image artifact. Not part of executable logic.

---

### 2.2 `docs/` tree

```text
docs/
├── dorahacks_submission_playbook_polkadot_2026.md
├── dualvm/
│   ├── dualvm_architecture_migration_blueprint.md
│   ├── dualvm_asset_path_decision.md
│   ├── dualvm_current_state_addendum.md
│   ├── dualvm_dorahacks_submission.md
│   ├── dualvm_final_scoring_rehearsal.md
│   ├── dualvm_final_submission_completion_report.md
│   ├── dualvm_forensic_handoff.md
│   ├── dualvm_gap_closure_plan.md
│   ├── dualvm_governed_root_proof.md
│   ├── dualvm_last_decentralization_layer_plan.md
│   ├── dualvm_lending_final_spec_public_rpc.md
│   ├── dualvm_lending_production_spec.md
│   ├── dualvm_migration_format_proof.md
│   ├── dualvm_oracle_governance_decentralization_plan.md
│   ├── dualvm_overnight_completion_checkpoint_manual.md
│   ├── dualvm_pvm_posture.md
│   ├── dualvm_quote_ticket_cutover_proof.md
│   ├── dualvm_spec_parity_checklist.md
│   ├── dualvm_submission_demo_guide.md
│   ├── dualvm_versioned_market_proof.md
│   ├── dualvm_vm_interop_proof.md
│   ├── screenshots/
│   └── submission_evidence/
└── sentinelos/
    ├── sentinel_treasuryos_2_1_spec.md
    └── sentinel_treasuryos_final_spec_public_rpc.md
```

#### `docs/dorahacks_submission_playbook_polkadot_2026.md`
Submission-focused meta-doc, not runtime behavior.

#### `docs/dualvm/`
This is the major documentation body for DualVM. It includes:
- historical specs,
- architectural plans,
- proof artifacts in prose form,
- submission docs,
- screenshots and evidence,
- prior handoffs.

Important current-state docs include:
- `dualvm_current_state_addendum.md`
- `dualvm_pvm_posture.md`
- `dualvm_vm_interop_proof.md`
- `dualvm_versioned_market_proof.md`
- `dualvm_governed_root_proof.md`
- `dualvm_migration_format_proof.md`
- `dualvm_oracle_governance_decentralization_plan.md`
- `dualvm_last_decentralization_layer_plan.md`

Important caveat: this folder also contains stale and partially stale docs. Not every file here agrees with the current versioned or governed truth.

#### `docs/sentinelos/`
Spec-only materials for another domain. The root `CLAUDE.md` explicitly says to ignore SentinelOS for DualVM planning unless specifically asked. There is no corresponding executable code under this repo root.

---

### 2.3 `dualvm/` tree

The active project directory:

```text
dualvm/
├── .env.example
├── .gitignore
├── artifacts/
├── artifacts-pvm/
├── cache/
├── cache-pvm/
├── contracts/
│   ├── DebtPool.sol
│   ├── DualVMAccessManager.sol
│   ├── LendingCore.sol
│   ├── ManualOracle.sol
│   ├── MarketVersionRegistry.sol
│   ├── RiskAdapter.sol
│   ├── USDCMock.sol
│   ├── WPAS.sol
│   ├── governance/
│   │   ├── DualVMMultisig.sol
│   │   └── DualVMTimelockController.sol
│   ├── interfaces/
│   │   ├── IMarketVersionRegistry.sol
│   │   ├── IMigratableLendingCore.sol
│   │   ├── IRiskAdapter.sol
│   │   └── IRiskEngine.sol
│   ├── migration/
│   │   └── MarketMigrationCoordinator.sol
│   ├── probes/
│   │   ├── DualVmProbeLib.sol
│   │   ├── RevmCallbackReceiver.sol
│   │   ├── RevmQuoteCallerProbe.sol
│   │   ├── RevmRoundTripSettlementProbe.sol
│   │   ├── interfaces/
│   │   │   ├── IRevmCallbackReceiver.sol
│   │   │   └── IVmQuoteAdapterProbe.sol
│   │   └── pvm/
│   │       ├── PvmCallbackProbe.sol
│   │       └── PvmQuoteProbe.sol
│   └── pvm/
│       └── PvmRiskEngine.sol
├── deployments/
├── dist/
├── features.json
├── foundry.toml
├── hardhat.config.ts
├── hardhat.pvm.config.ts
├── index.html
├── init.sh
├── lib/
│   ├── config/
│   ├── deployment/
│   ├── governance/
│   ├── ops/
│   ├── probes/
│   ├── runtime/
│   └── shared/
├── node_modules/
├── ops/
│   └── watchlist.json
├── out/
├── package-lock.json
├── package.json
├── progress.md
├── pvm-artifacts/
├── scripts/
│   ├── applyRoleSeparation.ts
│   ├── build-pvm.mjs
│   ├── check-testnet-balance.mjs
│   ├── deploy.ts
│   ├── deployGoverned.ts
│   ├── executeLiquidation.ts
│   ├── generate-wallet-batch.mjs
│   ├── generate-wallet.mjs
│   ├── liquidation-watch.mjs
│   ├── liveLiquidationSmoke.ts
│   ├── liveMinterSmoke.ts
│   ├── liveOracleSmoke.ts
│   ├── liveRepaySmoke.ts
│   ├── liveRiskAdminSmoke.ts
│   ├── liveSmoke.ts
│   ├── snapshot-recent-events.mjs
│   ├── upgradeOracle.ts
│   ├── verifyAll.ts
│   └── probes/
│       ├── build-pvm-probes.mjs
│       ├── collect-proof.ts
│       ├── deploy-pvm-probes.ts
│       ├── deploy-revm-probes.ts
│       ├── run-pvm-to-revm.ts
│       ├── run-revm-to-pvm.ts
│       └── run-roundtrip-settlement.ts
├── SPEC.md
├── src/
│   ├── App.tsx
│   ├── appCopy.ts
│   ├── components/
│   │   ├── MetricCard.tsx
│   │   └── sections/
│   │       ├── AssetPathSection.tsx
│   │       ├── DemoFlowSection.tsx
│   │       ├── HeroSection.tsx
│   │       ├── ManifestSection.tsx
│   │       ├── ObserverSection.tsx
│   │       ├── OverviewSections.tsx
│   │       ├── ReadLayerSection.tsx
│   │       ├── RecentActivitySection.tsx
│   │       └── SecuritySection.tsx
│   ├── lib/
│   │   ├── abi.ts
│   │   ├── assetRegistry.ts
│   │   ├── format.ts
│   │   ├── manifest.ts
│   │   ├── readModel.ts
│   │   ├── recentActivity.ts
│   │   └── readModel/
│   │       ├── activity.ts
│   │       ├── marketSnapshot.ts
│   │       ├── observer.ts
│   │       └── types.ts
│   ├── main.tsx
│   └── style.css
├── test/
│   ├── frontendModules.tsx
│   ├── GovernanceTimelock.ts
│   ├── hardhatConfig.ts
│   ├── hardhatConfigExports.ts
│   ├── LendingCore.ts
│   ├── liveScenario.ts
│   ├── managedAccess.ts
│   ├── manifestSchema.ts
│   ├── manifestStore.ts
│   ├── MarketMigrationCoordinator.ts
│   ├── MarketVersionRegistry.ts
│   ├── ProbeContracts.ts
│   ├── QuoteTickets.ts
│   ├── recentActivity.ts
│   ├── runtime.ts
│   ├── scriptImports.ts
│   ├── lib/
│   │   ├── deployment/
│   │   │   └── manifestStore.ts
│   │   ├── ops/
│   │   │   ├── liveScenario.ts
│   │   │   └── managedAccess.ts
│   │   ├── runtime/
│   │   │   ├── entrypoint.ts
│   │   │   └── transactions.ts
│   │   └── shared/
│   │       └── deploymentManifest.ts
│   ├── scripts/
│   │   ├── applyRoleSeparation.ts
│   │   ├── deploy.ts
│   │   ├── executeLiquidation.ts
│   │   ├── liveLiquidationSmoke.ts
│   │   ├── liveMinterSmoke.ts
│   │   ├── liveOracleSmoke.ts
│   │   ├── liveRepaySmoke.ts
│   │   ├── liveRiskAdminSmoke.ts
│   │   ├── liveSmoke.ts
│   │   ├── upgradeOracle.ts
│   │   └── verifyAll.ts
│   └── src/
│       ├── App.tsx
│       ├── appCopy.ts
│       ├── components/
│       ├── lib/
│       └── main.tsx
├── tsconfig.json
├── typechain-types/
├── vite.config.ts
└── wallets/
```

Key classifications:

- `contracts/` = canonical on-chain source
- `lib/` = canonical TypeScript helper logic for deployment/runtime/governance/probes
- `scripts/` = canonical operational entrypoints
- `src/` = canonical frontend source
- `test/` = canonical local proof harness
- `deployments/` = checked-in runtime/proof artifacts and manifests
- `out/`, `artifacts/`, `artifacts-pvm/`, `cache/`, `cache-pvm/`, `dist/`, `pvm-artifacts/`, `typechain-types/` = generated outputs, not authored source-of-truth
- `node_modules/` = vendor code

---

## 3. Architecture in prose

### 3.1 Core system shape

The system is a lending-market prototype built around one isolated market. The product architecture has evolved through several layers, but the currently strongest product-path shape is:

1. `LendingCore` — immutable market-version settlement kernel
2. `DebtPool` — ERC-4626-style liquidity pool / LP share layer
3. `ManualOracle` — price source with freshness and circuit-breaker semantics
4. `RiskAdapter` — ticketed quote layer between settlement and quote engine
5. quote engine — either deployed `PvmRiskEngine` or, in the newer live deployments, the external proven `PvmQuoteProbe`
6. `MarketVersionRegistry` — registry-governed market version activation boundary
7. optionally on governed path, `DualVMMultisig` + `DualVMTimelockController` as admin root above `AccessManager`

### 3.2 Product-path data/control flow

At a high level, the product path on the newer versioned deployment is:

- User or operator calls into `LendingCore`
- `LendingCore` reads price/freshness/epoch from the oracle
- `LendingCore` constructs a quote input based on:
  - collateral,
  - current or projected debt,
  - outstanding principal,
  - oracle age/freshness
- `LendingCore` asks `RiskAdapter` to either publish or consume a quote ticket
- `RiskAdapter` either returns an existing ticketed quote or computes one through its quote engine
- The quote engine computes risk terms (rate / max LTV / liquidation threshold)
- `LendingCore` uses the quote to gate borrow/withdraw/liquidation and update debt state
- `DebtPool` moves liquidity and tracks principal / reserves

The important design improvement in the new versioned path is that quote computation is no longer an implicit mutable side path hidden behind economic setters. It is explicit, ticketed, versioned by oracle/config context, and behind `RiskAdapter`.

### 3.3 Probe-path architecture

Separate from the product path, the repo contains a dedicated probe subsystem proving live REVM↔PVM capability. That path is not just documentation; it is a complete set of contracts and scripts.

The probe architecture is:

- `RevmQuoteCallerProbe` calls `PvmQuoteProbe`
- `PvmCallbackProbe` calls `RevmCallbackReceiver`
- `RevmRoundTripSettlementProbe` uses `RevmQuoteCallerProbe` to demonstrate REVM→PVM→REVM state dependence

This probe system is what supports the repo’s strongest live interop claims.

### 3.4 Frontend architecture

The frontend is a Vite + React observer shell. It does not submit borrow/repay from the browser. It imports a deployment manifest statically and reads chain state using `viem` public RPC calls. It also falls back to a bundled recent-events snapshot if live recent-activity queries fail.

That means the UI is not the source of write-path proof. The write path is still operational scripts plus explorer txs.

### 3.5 Governance architecture

There are now three governance/control modes represented in-repo:

1. older baseline deployment with direct operational roles and admin surface
2. versioned deployment where the kernel is immutable per version but root governance is still weak
3. governed deployment where a multisig schedules operations into a timelock and the timelock holds the effective `AccessManager` admin boundary

The codebase therefore demonstrates not one governance state, but a progression of governance maturity.

---

## 4. Full folder review: source files and scripts

This section reviews every project-authored source file and script in the active `dualvm/` codebase and the top-level repo control files that materially affect it.

### 4.1 Root control and meta files

| Path | What it is | What it does | Audit note |
|---|---|---|---|
| `README.md` | root handoff/readme | describes live network, deployment, proofs, limitations, repo map | current public-facing truth surface, but must be read with caveats from proof/result docs |
| `CLAUDE.md` | project memory | freezes source priority, network, scope, and submission caveats | not runtime, but important for understanding why some docs are stale |
| `PLAN.md` | planning doc | migration/refactor planning | non-runtime, historical planning state |
| `.gitignore` | repo ignore | ignores harness metadata and planning files | confirms root harness dirs are not product runtime |
| `.lsp.json` | dev environment config | defines LSP server behavior for TS/Solidity/etc. | significant for development environment, not product execution |
| `.github/workflows/ci.yml` | CI | runs install/tests/build in `dualvm/` | does not validate live proofs or deploys |

### 4.2 `dualvm/` configuration files

| Path | What it does | Important details |
|---|---|---|
| `dualvm/package.json` | npm command map | defines compile/test/build/deploy/probe/smoke/governed deploy commands; package is `private: true`, so no npm publishing intent |
| `dualvm/package-lock.json` | dependency lockfile | pins Node dependency tree |
| `dualvm/.env.example` | env surface | defines deploy-time overrides, actor private keys, quote-engine override, governance threshold/timelock delay vars |
| `dualvm/.gitignore` | package ignore rules | ignores generated artifacts, `.env`, wallets, build caches |
| `dualvm/tsconfig.json` | TS project | compiles configs, libs, scripts, tests, and frontend in one TypeScript project |
| `dualvm/hardhat.config.ts` | main Hardhat config | primary EVM compile/deploy/verify config |
| `dualvm/hardhat.pvm.config.ts` | alternate Hardhat PVM config | used for probe-only PVM compilation/deployment path |
| `dualvm/foundry.toml` | Foundry config | alternate compiler/test toolchain against same contracts |
| `dualvm/vite.config.ts` | frontend build config | Vite config for observer UI |
| `dualvm/index.html` | frontend shell | HTML entrypoint for Vite app |
| `dualvm/init.sh` | helper bootstrap script | installs/tests/builds for convenience |
| `dualvm/features.json` | stale feature matrix | now partially stale; still points to baseline manifest and parity-only wording |
| `dualvm/progress.md` | progress log | partially updated current-state summary; still blends multiple eras |
| `dualvm/SPEC.md` | spec pointer | points to canonical docs, but itself is stale on some current-state claims |

### 4.3 Solidity contracts: core product path

#### `dualvm/contracts/DualVMAccessManager.sol`
Thin wrapper over OpenZeppelin `AccessManager`. No custom logic beyond constructor wiring. It exists to instantiate OZ’s central authority contract inside the project namespace.

#### `dualvm/contracts/WPAS.sol`
Wrapped native PAS token used as collateral. It gives ERC-20 semantics to the native gas asset for easier integration with the EVM-style lending path.

#### `dualvm/contracts/USDCMock.sol`
Mock debt asset. This is explicit and honest in both code and docs. It is not a real stablecoin integration.

#### `dualvm/contracts/ManualOracle.sol`
Manual price oracle with:
- `priceWad`
- `lastUpdatedAt`
- `maxAge`
- bounds (`minPriceWad`, `maxPriceWad`)
- `maxPriceChangeBps`
- `oracleEpoch`
- state hashing via `currentStateHash()`
- freshness checks via `isFresh()` and `latestPriceWad()`

This contract is a key remaining governance gap because it still exposes live mutable functions under access control:
- `setPrice`
- `setMaxAge`
- `setCircuitBreaker`
- `pause`
- `unpause`

#### `dualvm/contracts/RiskAdapter.sol`
Ticketed quote layer. It stores `QuoteTicket` objects keyed by context + quote input and supports:
- publishing quote tickets
- computing quote-ticket IDs
- returning quotes via ticket or on-demand publish
- exposing underlying `quoteEngine`

This contract is the product-path seam between settlement and quote compute.

#### `dualvm/contracts/DebtPool.sol`
ERC-4626 LP vault / liquidity pool. Responsibilities:
- LP deposits and share accounting
- reserve tracking
- available liquidity calculation
- principal accounting
- debt draw / repayment record / loss record
- reserve claims
- one-time `setLendingCore` wiring
- no live `setSupplyCap` anymore
- migration principal hooks (`migratePrincipalOut`, `migratePrincipalIn`)

This contract is much narrower than the old “pool plus policy” shape. It still depends on `AccessManaged` and `restricted` for claims/pause and one-time wiring.

#### `dualvm/contracts/LendingCore.sol`
Main settlement kernel. Key responsibilities:
- collateral deposit / withdrawal
- borrow / repay / liquidation
- debt accrual
- use of `RiskAdapter` quote path
- position storage
- `freezeNewDebt()` lifecycle gate for migration/wind-down
- migration hooks:
  - `exportPositionForMigration`
  - `importMigratedPosition`

Notable architectural improvement:
- core config and dependencies are immutable per deployed market version
- active economic setter mutation has been removed
- quote context is derived via `currentQuoteContext()` and `currentRiskConfigHash()`

Notable remaining weakness:
- it still depends on `ManualOracle` concrete type, not an abstract `IOracleAdapter`
- that is the last live semantic mutability gap in the product path

#### `dualvm/contracts/MarketVersionRegistry.sol`
Registry storing whole market versions and exposing:
- `registerVersion`
- `activateVersion`
- `latestVersionId`
- `activeVersionId`
- `getVersion`
- `activeVersion`

It validates that the supplied kernel/pool/oracle/riskEngine are internally coherent and records quote-engine, assets, and config hash for each version.

This is now the product-path governance boundary for replacing market versions.

### 4.4 Solidity contracts: governance and migration

#### `dualvm/contracts/governance/DualVMMultisig.sol`
Custom 2-of-N style multisig with:
- owner set
- threshold
- per-operation approval counting
- operation hash based on target/value/data/nonce
- approve / revoke / execute

This is not a generalized Safe replacement. It is a minimal project-owned multisig implementation used to prove root-governance hardening.

#### `dualvm/contracts/governance/DualVMTimelockController.sol`
Thin wrapper around OZ `TimelockController`. No custom logic. Exists so the repo owns a named contract and can deploy it directly via Hardhat.

#### `dualvm/contracts/migration/MarketMigrationCoordinator.sol`
Migration coordination contract. Supports:
- opening and closing migration routes between market versions
- borrower migration
- LP liquidity migration

Borrower migration flow:
- old core exports position
- coordinator receives collateral from old core
- coordinator approves/imports into new core
- debt pool principal is migrated through dedicated hooks

LP migration flow:
- old pool shares are transferred in
- old pool redeemed
- new pool deposit performed
- user receives new shares

This is locally proven in tests, not yet live-proven.

### 4.5 Solidity interfaces

| Path | Role |
|---|---|
| `contracts/interfaces/IRiskEngine.sol` | base quote input/output interface |
| `contracts/interfaces/IRiskAdapter.sol` | extends risk engine with quote-ticket concepts |
| `contracts/interfaces/IMarketVersionRegistry.sol` | registry version struct + activation interface |
| `contracts/interfaces/IMigratableLendingCore.sol` | migration export/import/freeze interface |

### 4.6 Solidity contracts: PVM and probes

#### `contracts/pvm/PvmRiskEngine.sol`
Pure/stateless risk engine originally intended as the bounded PVM compute module. Still present and still important as the original quote engine model.

#### `contracts/probes/**`
These files implement the REVM↔PVM proof system. Key files:
- `DualVmProbeLib.sol`
- `RevmQuoteCallerProbe.sol`
- `RevmCallbackReceiver.sol`
- `RevmRoundTripSettlementProbe.sol`
- `pvm/PvmQuoteProbe.sol`
- `pvm/PvmCallbackProbe.sol`
- interface files under `probes/interfaces/`

They are real executable proof infrastructure, not mock docs.

### 4.7 TypeScript runtime helpers under `dualvm/lib/`

#### `lib/config/marketConfig.ts`
Canonical constants for network, roles, delays, market and oracle defaults. This file is one of the strongest source-of-truth anchors in the codebase.

#### `lib/shared/deploymentManifest.ts`
Manifest type definitions and runtime parser. Important because it defines the schema for deployment manifests, including newer fields like:
- `quoteEngine`
- `marketRegistry`
- `governanceMultisig`
- `governanceTimelock`

#### `lib/deployment/manifestStore.ts`
Central manifest loader/writer. Critical hidden behavior:
- scripts default to `deployments/polkadot-hub-testnet.json` unless `DEPLOYMENT_MANIFEST_PATH` is set
- the frontend does not use this dynamic loader; it hardcodes its own manifest import

#### `lib/deployment/deployMarketVersion.ts`
Deploys one market version. It can:
- deploy `ManualOracle`
- deploy a quote engine or use an externally supplied one
- deploy `RiskAdapter`
- deploy `DebtPool`
- deploy `LendingCore`
- optionally wire pool to core

This helper is the main reusable deployment primitive for later versions.

#### `lib/deployment/deploySystem.ts`
Builds a full versioned system around `deployMarketVersion()` and deploys `AccessManager`, assets, registry, roles, and initial configuration.

#### `lib/deployment/deployGovernedSystem.ts`
Wraps `deploySystem` with governance-root hardening:
- deploys `DualVMMultisig`
- deploys `DualVMTimelockController`
- grants governance role to timelock
- transfers admin role from deployer to timelock

#### `lib/governance/timelock.ts`
Utility functions for building timelock operations, generating calldata, and scheduling/executing timelock operations via the multisig.

#### `lib/runtime/env.ts`
Minimal required-env helper.

#### `lib/runtime/entrypoint.ts`
Protects script `main()` functions so they only auto-run when directly executed.

#### `lib/runtime/transactions.ts`
Transaction/wait/format helpers.

#### `lib/runtime/actors.ts`
Maps named actor roles to environment variable private keys. Important because live scripts depend entirely on this actor map.

#### `lib/runtime/contracts.ts`
Manifest-based contract attachment helper.

#### `lib/ops/managedAccess.ts`
AccessManager delayed-operation helpers. It provides managed execution for actions that need scheduling/execution under role delays and now also includes helpers for version registration and activation.

#### `lib/ops/liveScenario.ts`
Reusable scenario helpers for:
- seeding debt pool liquidity
- opening borrow positions
- waiting for debt accrual

#### `lib/probes/*`
Probe-manifest storage and PVM runtime helpers for the dedicated interop proof system.

### 4.8 Scripts under `dualvm/scripts/`

#### `build-pvm.mjs`
Builds the non-probe PVM artifact path for `PvmRiskEngine`.

#### `check-testnet-balance.mjs`
Simple RPC balance check script.

#### `generate-wallet.mjs` / `generate-wallet-batch.mjs`
Test wallet generation utilities that derive EVM address, fallback AccountId32, and SS58 view. They write wallet text files under `wallets/`, which are ignored.

#### `deploy.ts`
Base deployment script that uses `deployDualVmSystem()` and writes a manifest.

#### `deployGoverned.ts`
Governed deployment entrypoint using the multisig + timelock wrapper path.

#### `verifyAll.ts`
Verification script. Important caveat: verification completeness differs by deployment family; this script is not proof that the newest manifests were verified.

#### `liveSmoke.ts`
Live borrow-path smoke script.

#### `liveRepaySmoke.ts`
Live repay-path smoke script.

#### `liveLiquidationSmoke.ts`
Live liquidation-path proof script. This script mutates live state and should not be treated as a passive check.

#### `liveRiskAdminSmoke.ts`
Now used as version-activation smoke. On governed path it schedules/registers/activates a temporary version and restores the original.

#### `liveOracleSmoke.ts`
Live oracle mutation/restore script against the current governed model. Mutates live oracle state.

#### `liveMinterSmoke.ts`
Live mint-path proof script.

#### `upgradeOracle.ts`
No longer a kernel setter swap in the older sense. In the newer architecture it deploys a new market version and activates it through the registry.

#### `applyRoleSeparation.ts`
Historical/operational role split script. Now less central than the newer governed deployment path.

#### `executeLiquidation.ts`
Operator liquidation helper against the currently selected manifest.

#### `liquidation-watch.mjs`
Watchlist-based monitoring helper.

#### `snapshot-recent-events.mjs`
Creates the recent-events snapshot consumed by the frontend fallback.

### 4.9 Probe scripts under `dualvm/scripts/probes/`

These scripts build, deploy, run, and collect the dedicated interop proof path. They include:
- `build-pvm-probes.mjs`
- `deploy-pvm-probes.ts`
- `deploy-revm-probes.ts`
- `run-revm-to-pvm.ts`
- `run-pvm-to-revm.ts`
- `run-roundtrip-settlement.ts`
- `collect-proof.ts`

### 4.10 Frontend files under `dualvm/src/`

#### `App.tsx`
Top-level React composition. It loads a market snapshot, tracks observer address, and renders section components.

#### `appCopy.ts`
Static text arrays and helper copy. Important because it explicitly states the observer-first, non-browser-write truth.

#### `main.tsx`
React bootstrap entrypoint.

#### `style.css`
Frontend styling.

#### `components/MetricCard.tsx`
Simple reusable metric card.

#### `components/sections/*`
Nine section components divide the page into:
- hero
- overview
- manifest
- asset path
- read layer
- observer
- demo flow
- recent activity
- security

These are presentational components and support the observer UI structure.

#### `src/lib/manifest.ts`
Critical hidden control file. It statically imports:
- `../../deployments/polkadot-hub-testnet-versioned.json`

That means the frontend is currently pinned to the versioned deployment manifest, not the governed manifest and not the default manifest used by scripts.

#### `src/lib/abi.ts`
Minimal frontend ABIs for pool, core, and oracle reads.

#### `src/lib/assetRegistry.ts`
Static asset registry exposing the explicit truth of WPAS and `USDC-test`.

#### `src/lib/format.ts`
Display helpers.

#### `src/lib/recentActivity.ts`
Snapshot parsing and window-formatting helpers.

#### `src/lib/readModel.ts`
Thin export boundary to the `readModel/` submodules.

#### `src/lib/readModel/marketSnapshot.ts`
Main frontend read aggregation. It reads pool/core/oracle/observer/recent-activity data using `viem`, caches for 10 seconds, and falls back to bundled recent-events snapshot on recent-activity query failure.

#### `src/lib/readModel/activity.ts`
Loads live recent events from the chain and falls back to bundled JSON snapshot.

#### `src/lib/readModel/observer.ts`
Reads tracked-address debt, health factor, and available-to-borrow.

#### `src/lib/readModel/types.ts`
Frontend read-model types.

### 4.11 Tests under `dualvm/test/`

The test tree is broader than core contract tests. It includes:
- contract logic tests
- frontend module import tests
- script import tests
- manifest schema/store tests
- runtime helper tests
- recent-activity tests
- live-scenario helper tests

Important tests:
- `LendingCore.ts`
- `QuoteTickets.ts`
- `MarketVersionRegistry.ts`
- `GovernanceTimelock.ts`
- `MarketMigrationCoordinator.ts`
- `ProbeContracts.ts`

There are also smoke/import tests under `test/scripts/`, `test/src/`, and `test/lib/` that ensure modules load and helpers behave as expected.

---

## 5. Run scripts, config files, and environment setup

### 5.1 Installation and local build commands

The repo’s active package is `dualvm/`. The basic local commands are:

```bash
cd dualvm
npm ci
npm test
npm run build
npx tsc --noEmit
/home/kpa/.foundry/bin/forge build
```

What these do:
- `npm ci` installs exact Node dependencies
- `npm test` runs Hardhat tests
- `npm run build` runs compile + PVM artifact build + frontend build
- `npx tsc --noEmit` validates TypeScript types across configs/scripts/tests/frontend
- `forge build` compiles the Solidity tree through Foundry as a secondary diagnostic path

### 5.2 Package scripts

Important `package.json` scripts include:
- `compile`
- `test`
- `build:pvm`
- `build:pvm:probes`
- `build:app`
- `build`
- `deploy:testnet`
- `deploy:governed:testnet`
- `deploy:pvm:probes:testnet`
- `deploy:revm:probes:testnet`
- `probe:*`
- `verify:testnet`
- `repay-smoke:testnet`
- `risk-smoke:testnet`
- `oracle-smoke:testnet`
- `minter-smoke:testnet`
- `oracle-upgrade:testnet`
- `watch:testnet`
- `index-events:testnet`
- `liquidate:testnet`
- `governance:apply`
- `wallet:generate`

### 5.3 Environment variables

`dualvm/.env.example` shows the full env surface.

Categories:

Network / verification
- `PRIVATE_KEY`
- `POLKADOT_HUB_TESTNET_RPC_URL`
- `POLKADOT_HUB_TESTNET_RPC_FALLBACK_URL`
- `BLOCKSCOUT_API_KEY`

Deploy-time overrides
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
- `RISK_QUOTE_ENGINE_ADDRESS`
- `GOVERNANCE_THRESHOLD`
- `TIMELOCK_MIN_DELAY_SECONDS`
- `TIMELOCK_OPEN_EXECUTOR`

Live operator / smoke scripts
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

Critical hidden behavior:
- scripts load actors from env private keys via `lib/runtime/actors.ts`
- deployment manifest selection for scripts is controlled by `DEPLOYMENT_MANIFEST_PATH`
- frontend does not use `DEPLOYMENT_MANIFEST_PATH`; it statically imports one manifest file

### 5.4 Secrets handling

Good:
- `.env` is ignored
- generated wallet text files are ignored
- repo does not commit private keys in tracked files

Risks:
- the operational model depends on many private keys in env
- several live smoke scripts need multiple funded actor wallets
- operator misuse could hit the wrong deployment if `DEPLOYMENT_MANIFEST_PATH` is not set correctly

---

## 6. External endpoints, services, APIs, and runtime assumptions

The repo depends on these public endpoints and assumptions:

Network endpoints
- ETH RPC: `https://eth-rpc-testnet.polkadot.io/`
- fallback RPC: `https://services.polkadothub-rpc.com/testnet/`
- WSS used in some probe/runtime paths: `wss://asset-hub-paseo-rpc.n.dwellir.com`
- explorer: `https://blockscout-testnet.polkadot.io/`
- faucet: `https://faucet.polkadot.io/`

Hosted frontend assumption
- docs point to `http://eyawa.me/dualvm-lending/`
- repo itself does not contain hosting infra; it only contains the frontend build

Runtime assumptions
- public shared RPCs are expected to rate-limit or fail intermittently
- frontend recent-activity logic explicitly expects that and falls back to bundled snapshot
- no local Polkadot node is required
- no backend/indexer cluster is required

Important consequence
- a live demo on a small Linux VPS is sensitive to public RPC variability
- the browser UI may read stale or fallback recent events if live queries fail
- writes are not browser-native anyway, so proof still depends on scripts + explorer

---

## 7. Test strategy and actual test coverage

### 7.1 Local-only coverage

The local Hardhat suite covers:
- lending flows and error paths (`test/LendingCore.ts`)
- quote tickets and epoch/config context (`test/QuoteTickets.ts`)
- version registry behavior (`test/MarketVersionRegistry.ts`)
- governance root timelock model (`test/GovernanceTimelock.ts`)
- migration format (`test/MarketMigrationCoordinator.ts`)
- probe semantics (`test/ProbeContracts.ts`)
- runtime/helper/module import tests (`test/lib/**`, `test/scripts/**`, `test/src/**`)

### 7.2 Live public-chain proof

Live public-chain proof exists for:
- older baseline lending flow family (via recent-events + proof docs)
- dedicated VM interop probes
- quote-ticket cutover alternate deployment
- versioned market deployment
- governed root deployment

### 7.3 What is only theoretical or local

Only local, not live-proven:
- migration coordinator borrower migration
- migration coordinator LP migration
- threshold/decentralized oracle adapter path (not implemented yet)
- DAO/Governor layer

### 7.4 CI coverage

CI only proves:
- install
- local tests
- build

CI does not prove:
- deployability
- explorer verification
- governed timelock proof on live chain
- any smoke scripts
- hosted frontend availability

---

## 8. What was tested on real public endpoints versus only locally

### Real public-chain or public-endpoint proof

Proven on public chain / public explorer / public RPC:
- baseline deployment and earlier flows
- probe interop deployment and probe txs
- versioned deployment and its borrow/repay/liquidation/activation txs
- governed deployment and its borrow/repay/timelocked activation txs

### Local only
- governance root tests in Hardhat
- migration coordinator tests
- helper/import tests
- frontend module tests
- Foundry compilation

### Not proven
- current governed deployment explorer verification completion
- live migration execution on-chain
- decentralized oracle adapter live path
- DAO voting path

---

## 9. Addresses, transaction hashes, explorer links, and artifacts

This repo contains multiple deployment/result JSON files under `dualvm/deployments/`.

Important current ones:
- `polkadot-hub-testnet.json` — older baseline manifest
- `polkadot-hub-testnet-versioned.json` — versioned product-path manifest
- `polkadot-hub-testnet-governed.json` — governed-root manifest
- `polkadot-hub-testnet-probes.json` — probe deployment manifest
- corresponding `*-results.json` files for newer proof deployments

Strongest currently relevant proof docs:
- `docs/dualvm/dualvm_vm_interop_proof.md`
- `docs/dualvm/dualvm_versioned_market_proof.md`
- `docs/dualvm/dualvm_governed_root_proof.md`
- `docs/dualvm/dualvm_migration_format_proof.md`

The versioned market results file and governed results file are the most important machine-readable truth surfaces after the manifests.

---

## 10. Package publishing status

No publishable package configuration is present for the active project.

Evidence:
- `dualvm/package.json` has `"private": true`
- no `publishConfig`
- no npm release workflow
- no Python package layout
- no `Cargo.toml` for a Rust package
- no crates publishing configuration

Conclusion:
- this repo is not set up for npm/PyPI/crates.io publishing
- it is a deployable app/prototype repo, not a reusable published package repo

---

## 11. Error cases, revert paths, and hidden failure modes

### Contract-level errors

`LendingCore` can revert on:
- zero amounts
- no debt
- insufficient collateral
- borrow cap exceeded
- debt below minimum
- unhealthy liquidation conditions not met
- invalid liquidation amount
- new debt disabled (`freezeNewDebt`)
- invalid configuration
- migration state errors (`NoPosition`, `ExistingPosition`)

`ManualOracle` can revert on:
- unset price
- stale price
- out-of-bounds price
- too-large delta
- invalid config

`DebtPool` can revert on:
- invalid config
- supply cap exceeded
- insufficient liquidity
- unauthorized caller (`OnlyLendingCore`)
- repeated kernel wiring

`RiskAdapter` can revert on:
- invalid quote engine
- missing quote ticket when queried directly

### Operational failure modes

- script points at wrong manifest because `DEPLOYMENT_MANIFEST_PATH` not set
- frontend points at versioned manifest while scripts default elsewhere
- public RPC 429 / timeout / network failures
- governed path depends on several separate actor keys
- some live scripts mutate production-like state and are not safe to run casually

### Demo failure modes on a small VPS or hackathon review

Likely failure points:
- public RPC read failures causing stale/empty UI sections
- reviewer assuming browser can write when it cannot
- reviewer assuming newest deployment is explorer-verified when it is not
- reviewer conflating probe proof with product-path proof
- reviewer conflating governed deployment with frontend-target deployment

---

## 12. Security concerns and known risks

### Stronger parts
- immutable kernel per market version
- registry-governed version activation boundary
- multisig + timelock root exists and is live-proven
- explicit non-production framing in code/docs
- public-chain proofs are real

### Remaining concerns
- live oracle path still operator/governance-controlled
- no decentralized oracle yet
- no state migration live proof
- no browser write UX
- current governed deployment not explorer-verified in repo
- current versioned deployment also not explorer-verified in repo
- debt asset is still mock

### Risk of misunderstanding / fake-complete surfaces
- `dualvm/features.json` is stale and says parity-only PVM wording
- `dualvm/SPEC.md` still says explorer verification complete and parity-only PVM truth
- several docs still reference the baseline deployment as current
- some proof docs can be overread if the deployment family is not stated explicitly

---

## 13. Production-readiness verdict

Production-ready verdict: **No**.

Why not:
- oracle not decentralized
- debt asset mock-only
- migration not live-proven
- frontend not full write path
- verification incomplete for newest deployments
- system truth split across multiple deployment families
- root governance improved only on governed deployment family

Closer-to-production-than-before verdict: **Yes**.

Why:
- immutable kernel per version exists
- registry activation exists
- multisig/timelock root exists
- interop proof is real
- migration format exists in code
- testing/build discipline is stronger than a typical hackathon throwaway repo

---

## 14. Final status table: done / not done / risky / fake-complete

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Isolated lending market exists | DONE | `dualvm/contracts/LendingCore.sol`, `dualvm/deployments/*.json` | One market only |
| Baseline borrow/repay/liquidation live proof | DONE | `dualvm/deployments/polkadot-hub-testnet-recent-events.json` | Older baseline family |
| REVM↔PVM probe proof | DONE | `docs/dualvm/dualvm_vm_interop_proof.md` | Live proven |
| Quote-ticket product path | DONE | `RiskAdapter.sol`, `QuoteTickets.ts`, `...quote-ticket-results.json` | Live alternate deployment proven |
| Immutable versioned market path | DONE | `MarketVersionRegistry.sol`, `...versioned.json`, `...versioned-results.json` | Live proven |
| Governed root (multisig+timelock) | DONE | `DualVMMultisig.sol`, `DualVMTimelockController.sol`, `...governed.json`, `...governed-results.json` | Live proven |
| Migration-enabled next format | PARTIAL | `MarketMigrationCoordinator.sol`, `IMigratableLendingCore.sol`, `test/MarketMigrationCoordinator.ts` | Local proof only |
| Oracle decentralization | NOT DONE | `ManualOracle.sol` | Still governed mutable oracle |
| DAO / Governor layer | NOT DONE | no implementation | Only planned |
| Explorer verification for newest deployments | NOT DONE | result docs say not completed | Baseline only verified |
| Browser write-path lending UX | NOT DONE | `src/appCopy.ts`, `ObserverSection` posture | Observer-only frontend |
| Real stable debt asset integration | NOT DONE | `USDCMock.sol`, docs | Mock asset by design |
| Public-RPC fallback resilience | RISKY | `src/lib/readModel/activity.ts`, docs | Read fallback exists, but RPC fragility remains |
| Features/spec truth alignment | FAKE-COMPLETE / STALE | `dualvm/features.json`, `dualvm/SPEC.md` | These files overstate or lag current truth |
| Governed deployment as canonical frontend target | NOT DONE | `src/lib/manifest.ts` still points to versioned manifest | Governed proof exists, but frontend not switched |
| Live migration proof | NOT DONE | no governed/live migration proof artifact | Only local tests |

---

## 15. Final forensic conclusion

The project root contains one active executable codebase (`dualvm/`) and a large amount of supporting and historical documentation. The codebase is real, live-proven, and technically serious. It is also layered, stateful, and easy to misread if one does not keep the deployment families separate.

The current safest audit statement is:

- The repo contains a real lending MVP on Polkadot Hub TestNet.
- It contains a real probe-based REVM↔PVM interop proof package.
- It contains a real versioned market architecture with immutable per-version kernel and registry activation.
- It contains a real governed-root proof deployment using multisig + timelock.
- It contains local migration-capable next-version hooks.

The current strongest caveat is:

- Oracle decentralization is still not done.
- Migration is not live-proven.
- The newest deployments are not explorer-verified in-repo.
- The frontend is still observer-first, not a full browser-based lending client.
- Some checked-in docs and status files are stale enough that another reviewer could overstate the repo unless this handoff is used instead.

That is the exact current state of the project folder as audited from the files, configs, scripts, manifests, proof docs, and live-proof artifacts present in the repository.
