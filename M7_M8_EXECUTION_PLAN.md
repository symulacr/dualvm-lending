# m7+m8 execution plan
### 2026-03-18 | lead architect | adversarial review complete

---

## 1. official-doc verification block

| domain | source | status | key facts | last updated |
|--------|--------|--------|-----------|--------------|
| xcm precompile | docs.polkadot.com/smart-contracts/precompiles/xcm/ | **stable** | 3 functions: execute, send, weighMessage. address 0xA0000. SCALE-encoded V5 payloads. example uses WithdrawAsset+BuyExecution+DepositAsset. | jan 2026 |
| polkadot hub revm | docs.polkadot.com/reference/polkadot-hub/smart-contracts/ | **stable** | full evm compatibility via revm. standard ethereum tooling works. | jan 2026 |
| polkadot hub pvm | same page | **preview** | "PVM smart contracts with Ethereum compatibility are in early-stage development and may be unstable or incomplete." | jan 2026 |
| resolc | github.com/paritytech/revive | **stable compiler, preview target** | solidity compiler for polkavm via pallet-revive. @parity/resolc ^1.0.0 installed in project. | active |
| hardhat polkadot | @parity/hardhat-polkadot ^0.2.7 | **stable** | project already uses this for pvm deployment | installed |
| openzeppelin contracts | v5.5.0 | **stable** | AccessManager, ERC4626, Governor, Pausable, ReentrancyGuard all stable. no breaking changes. | mar 2026 |
| oz defender | openzeppelin.com/news/doubling-down-on-open-source | **sunset** | defender saas phasing out jan 2026. replaced by open-source relayer+monitor. NOT usable for new projects. | jan 2026 |
| oz monitor (oss) | announced but early | **not yet stable** | open-source monitor announced but no stable polkadot hub support confirmed. | jan 2026 |
| mermaid | mermaid-js v11+ | **stable** | flowchart/graph TB, subgraph, classDef all supported. no breaking syntax changes. | 2025 |

**dependencies NOT upgrading**: none. all installed deps are current stable.
**dependencies NOT using**: oz defender (sunset), oz open-source monitor (no polkadot hub support confirmed).
**platform blocker acknowledged**: PVM is officially preview. pvm->evm callbacks are platform-broken. we will NOT claim this is fixed by app code.

---

## 2. blocker truth table

| # | blocker | status | type | why it matters | evidence | owner | fixable | safe fix | anti-patterns to avoid | confidence |
|---|---------|--------|------|---------------|----------|-------|---------|----------|----------------------|------------|
| 1 | pvm->evm callback broken | FAILED | platform blocker | bidirectional dual-vm claim is false | probe-results.json stage2: "execution reverted" | parity | NO | document honestly; do not claim bidirectional. prove evm->pvm works. | do not fake it with evm-only calls. do not redeploy hoping it works. | HIGH |
| 2 | DeterministicRiskModel not pvm-compiled | STALE | architecture gap | quoteEngine address points to PvmQuoteProbe (test probe), not production model. RiskAdapter._verifyCrossVM() calls a probe, not the real model. | canonical.json quoteEngine=0x9a78... = PvmQuoteProbe address from probes.json | us | YES | compile via resolc, deploy to pvm, update RiskAdapter quoteEngine reference in NEW canonical manifest entry. do NOT redeploy RiskAdapter — its quoteEngine is immutable. deploy new RiskAdapter with correct quoteEngine, migrate via market version registry. | do not "just update the manifest address" — RiskAdapter.quoteEngine is immutable constructor arg. do not redeploy all contracts. | HIGH |
| 3 | LendingRouter credits router not user | BUG | app bug | 1-click deposit is useless. collateral trapped in router address. | LendingRouter.sol line 58: lendingCore.depositCollateral(amount) where msg.sender=router | us | YES | add depositCollateralFor(address,uint256) to LendingCore. redeploy LendingRouter calling new function. use market version + migration to cut over. | do not modify existing deployed LendingCore (immutable). deploy new LendingCore version with the function. | HIGH |
| 4 | xcm standalone, clearorigin-only | GAP | architecture gap | xcm "integration" is a lie — no connection to lending protocol. messages carry zero data. | LendingCore.sol: no import/call of XcmLiquidationNotifier. all xcm payloads are 0x05040a (ClearOrigin). | us | PARTIAL | wire XcmLiquidationNotifier into liquidation flow via post-liquidation hook. upgrade xcm payloads to include SetTopic with liquidation data hash. full Transact payloads are possible but complex and may fail on relay without proper fee setup — mark as aspirational. | do not claim "cross-chain liquidation" when we only send ClearOrigin. do not build complex Transact payloads without testing fee payment on destination. | HIGH |
| 5 | oracle maxAge=21600s (6h) | CONFIG | infra gap | 6h stale price enables arbitrage/theft. judges will notice. | canonical.json: oracleMaxAgeSeconds: 21600 | us | YES | call ManualOracle.setMaxAge(1800) via riskAdmin. 30min is still generous for a manual oracle but honest. one tx, no redeploy. | do not set to 0 (breaks freshness). do not claim "real-time oracle". | HIGH |
| 6 | roundtrip settlement proof polluted | DIRTY | infra gap | stage3 principalDebt=2140 vs expected 1070 from repeated runs. proof is unreliable. | probe-results.json stage3.settleBorrow.observed.principalDebt=2140 | us | YES | deploy fresh probe instances, run exactly once, capture clean results. small blast radius — probes are standalone. | do not redeploy core lending contracts. probes are isolated. | HIGH |
| 7 | no live integration tests | MISSING | infra gap | test suite is hardhat-only. no coverage of live rpc, testnet state, precompile behavior. | test/ directory: all .ts files use hardhat fixtures | us | YES | add scripts that call deployed contracts on testnet and assert expected state. not a full test suite — targeted smoke checks. | do not try to run hardhat tests against live rpc (evm_increaseTime unsupported per polkadot docs). use ethers/viem scripts instead. | MEDIUM |
| 8 | docs/diagram drift | STALE | docs gap | README lines 45/52 still say PvmQuoteProbe. system overview diagram is pre-M6. | grep README.md for "PvmQuoteProbe" → 2 hits | us | YES | find-replace in README. 1 file, 2 lines. no test needed. | do not create a milestone feature or heavy test pass for a 2-line text fix. | HIGH |
| 9 | admin centralization | DESIGN | architecture gap | deployer EOA (0x5198) holds emergency_admin + treasury roles. single point of compromise. governance timelock is admin but deployer has backdoor. | canonical.json: roles.treasury = roles.emergencyAdmin = 0x5198... | us | PARTIAL | transfer emergency_admin to a multisig or the timelock. for hackathon, document the risk. for production, remove EOA admin entirely. | do not remove emergency admin without replacement — protocol needs pause capability. | MEDIUM |
| 10 | no monitoring/tracing | MISSING | infra gap | no event indexer, no watcher, no alerting for liquidation opportunities, oracle staleness, or position health. | no monitoring code in repo | us | YES | build lightweight off-chain event watcher using viem + ethers event subscriptions. NOT an on-chain monitor contract. | do not add storage-heavy monitor functions to contracts. do not depend on oz defender (sunset). | MEDIUM |

---

## 3. before architecture (current state)

see SYSTEM_ARCHITECTURE_AUDIT.md sections 3.1-3.6 for full inventory. summary:

```
contracts (revm): LendingCore(772) RiskAdapter(253) DebtPool(204) ManualOracle(163) 
                  MarketVersionRegistry(97) MarketMigrationCoordinator(110)
                  DualVMGovernor(100) GovernanceToken(39) DualVMAccessManager(8)
                  WPAS(41) USDCMock(17) LendingRouter(64)
xcm (revm, standalone): CrossChainQuoteEstimator(87) XcmLiquidationNotifier(82)
pvm (preview): PvmQuoteProbe(19) PvmCallbackProbe(33) [DeterministicRiskModel NOT compiled]
probes (revm): RevmQuoteCallerProbe(99) RevmCallbackReceiver(34) RevmRoundTripSettlementProbe(70)
frontend: 30 files, ~2400 LOC, React 18 + wagmi 2 + viem 2 + RainbowKit
tests: 21 files, 105 passing, ~3900 LOC
total solidity: 2739 LOC across 30 .sol files
```

**control flow**: user→LendingCore→{Oracle,RiskAdapter,DebtPool}. RiskAdapter→PvmQuoteProbe (optional, try/catch).
**data flow**: frontend→viem→rpc→chain. no indexer. no event cache.
**message flow**: xcm contracts exist but are not called by lending. messages are ClearOrigin only.
**failure flow**: oracle stale→borrows blocked. pvm down→inline math continues. rpc down→frontend dead.
**hidden coupling**: RiskAdapter.quoteEngine is immutable and points to PvmQuoteProbe (test contract), not DeterministicRiskModel. LendingRouter.depositCollateral credits router address. canonical manifest quoteEngine field is stale.

---

## 4. after architecture (target state)

### new components (all marked PROPOSED)

| component | type | purpose | loc estimate |
|-----------|------|---------|-------------|
| LendingCoreV2 | contract (revm) | adds depositCollateralFor(address,uint256) + optional post-liquidation hook | +20 LOC vs current |
| LendingRouterV2 | contract (revm) | calls depositCollateralFor instead of depositCollateral | ~64 LOC (rewrite) |
| DeterministicRiskModel (pvm) | deployment | same .sol compiled via resolc and deployed to pvm | 0 new LOC |
| RiskAdapterV2 | contract (revm) | same code, new constructor arg pointing to pvm DeterministicRiskModel | 0 new LOC |
| XcmLiquidationHook | library/adapter | encodes SetTopic with liquidation data hash, calls notifier from LendingCore | ~30 LOC |
| EventWatcher | off-chain script | viem event subscription for Liquidated, PriceUpdated, BadDebtRealized | ~150 LOC |
| deploy-idempotent.ts | script | manifest-diff-based deployment with resume support | ~200 LOC |

### what stays the same
- DebtPool, ManualOracle, GovernanceToken, DualVMGovernor, TimelockController, DualVMAccessManager, WPAS, USDCMock: NO changes
- MarketVersionRegistry, MarketMigrationCoordinator: used for V1→V2 cutover, no code changes
- CrossChainQuoteEstimator: stays as-is (proven)
- XcmLiquidationNotifier: stays as-is, gets called from hook

### what changes
- LendingCore: new version with depositCollateralFor + liquidation hook
- RiskAdapter: new deployment with correct pvm quoteEngine
- LendingRouter: new version calling depositCollateralFor
- ManualOracle: maxAge reduced to 1800 via admin call (no redeploy)
- Probes: fresh deploy for clean stage3 proof

### what is platform-blocked (NOT fixed)
- pvm->evm callbacks: platform preview limitation. documented, not claimed as working.
- full Transact xcm payloads: feasible but untested fee payment on relay. marked aspirational.

---

## 5. side-by-side ascii board

```
╔═══════════════════════════ BEFORE ════════════════════════════╦═══════════════════════════ AFTER ═════════════════════════════╗
║                                                               ║                                                               ║
║  REVM                                                         ║  REVM                                                         ║
║  ┌──────────────────────────────────┐                         ║  ┌──────────────────────────────────┐                         ║
║  │ LendingCore (v1)                 │                         ║  │ LendingCoreV2              [NEW] │                         ║
║  │  depositCollateral(amt)          │                         ║  │  depositCollateral(amt)          │                         ║
║  │  [no depositFor]                 │                         ║  │  depositCollateralFor(user,amt)  │                         ║
║  │  liquidate() → no xcm hook      │                         ║  │  liquidate() → xcm hook    [NEW] │                         ║
║  │  borrow/repay/batch              │                         ║  │  borrow/repay/batch              │                         ║
║  └──────────┬───────────────────────┘                         ║  └──────────┬───────────────────────┘                         ║
║             │                                                 ║             │                                                 ║
║  ┌──────────▼──────────┐  ┌──────────────────┐               ║  ┌──────────▼──────────┐  ┌──────────────────┐               ║
║  │ RiskAdapter (v1)    │  │ ManualOracle     │               ║  │ RiskAdapterV2  [NEW]│  │ ManualOracle     │               ║
║  │ quoteEngine =       │  │ maxAge = 21600 ⚠│               ║  │ quoteEngine =       │  │ maxAge = 1800 ✓  │               ║
║  │  PvmQuoteProbe ⚠   │  └──────────────────┘               ║  │  DetermRiskModel ✓  │  └──────────────────┘               ║
║  └─────────────────────┘                                      ║  └─────────────────────┘                                      ║
║                                                               ║                                                               ║
║  ┌─────────────────────┐                                      ║  ┌─────────────────────┐                                      ║
║  │ LendingRouter (v1)  │                                      ║  │ LendingRouterV2[NEW]│                                      ║
║  │ credits SELF ⚠      │                                      ║  │ credits USER ✓      │                                      ║
║  └─────────────────────┘                                      ║  └─────────────────────┘                                      ║
║                                                               ║                                                               ║
║  XCM (standalone) ────────────────── no connection            ║  XCM (connected) ───────────────── hooked to liquidate()     ║
║  ┌─────────────────────┐                                      ║  ┌─────────────────────┐                                      ║
║  │ XcmLiqNotifier      │                                      ║  │ XcmLiqNotifier      │ ◄── called from LendingCoreV2      ║
║  │ ClearOrigin only ⚠  │                                      ║  │ SetTopic+data ✓     │                                      ║
║  └─────────────────────┘                                      ║  └─────────────────────┘                                      ║
║                                                               ║                                                               ║
║  PVM ─────────────────────────────────────────                ║  PVM ─────────────────────────────────────────                ║
║  ┌─────────────────────┐                                      ║  ┌─────────────────────┐                                      ║
║  │ PvmQuoteProbe       │ ← quoteEngine target (wrong)        ║  │ DeterministicRisk    │ ← quoteEngine target (correct) [NEW]║
║  │ (test probe)        │                                      ║  │ Model (pvm-compiled) │                                      ║
║  └─────────────────────┘                                      ║  └─────────────────────┘                                      ║
║  pvm->evm: BROKEN ✗                                           ║  pvm->evm: STILL BROKEN ✗ (platform)                         ║
║                                                               ║                                                               ║
║  OPS ──────────────────────────────────                       ║  OPS ──────────────────────────────────                       ║
║  deploy: non-idempotent, no resume                            ║  deploy: idempotent, manifest-diff, resume              [NEW] ║
║  monitor: none                                                ║  monitor: event watcher (off-chain)                     [NEW] ║
║  probes: state polluted                                       ║  probes: fresh deploy, clean evidence                   [NEW] ║
║                                                               ║                                                               ║
║  DOCS ─────────────────────────────────                       ║  DOCS ─────────────────────────────────                       ║
║  README: PvmQuoteProbe refs at L45/52                         ║  README: all refs corrected, <250 word summary          [NEW] ║
║  frontend: verbose, 2400 LOC                                  ║  frontend: minimal, ~1500 LOC target                    [NEW] ║
║                                                               ║                                                               ║
╚═══════════════════════════════════════════════════════════════╩═══════════════════════════════════════════════════════════════╝
```

---

## 6. side-by-side mermaid

saved to M7_M8_MERMAID.md (separate file for rendering)

---

## 7. milestone definitions

### m9 — stabilize, connect, and de-risk

(using m9 because m6/m7/m8 are taken by previous milestones)

**objective**: fix the blockers that prevent a credible end-to-end build without unsafe redeploys.

**scope**:
1. compile DeterministicRiskModel via resolc → deploy to pvm → deploy new RiskAdapterV2 pointing to it → register as market version v2
2. add depositCollateralFor(address,uint256) to new LendingCoreV2 → deploy new LendingRouterV2 → register as market version v2
3. add post-liquidation hook to LendingCoreV2 that optionally calls XcmLiquidationNotifier with SetTopic payload (not ClearOrigin)
4. call ManualOracle.setMaxAge(1800) via riskAdmin tx
5. deploy fresh probe instances → run stage1+stage3 once → capture clean results
6. fix README lines 45/52 (PvmQuoteProbe → DeterministicRiskModel)
7. add idempotent deploy script with manifest-diff and resume
8. cut frontend verbosity ~40% (remove fluff sections, marketing copy)
9. write 250-word lowercase readme summary

**exclusions**:
- pvm->evm callbacks (platform blocker — document, do not fix)
- full Transact xcm payloads (aspirational — defer to m10)
- oz defender/monitor integration (sunset/not available)
- multi-market expansion
- production oracle integration

**dependencies**:
- resolc must compile DeterministicRiskModel cleanly
- testnet rpc must be reachable for deployments
- riskAdmin key must be available for setMaxAge tx

**acceptance criteria**:
- RiskAdapterV2.quoteEngine() returns address of pvm-compiled DeterministicRiskModel
- LendingRouterV2.depositCollateralFromPAS() credits user's address (not router)
- liquidate() emits LiquidationNotified event via xcm hook
- ManualOracle.maxAge() == 1800
- fresh probe stage1 passes, stage3 clean (no state pollution)
- README has no PvmQuoteProbe references
- deploy script is resumable with manifest checkpoint

**sequencing**:
1. pvm compilation + deployment (blocks RiskAdapterV2)
2. LendingCoreV2 + RiskAdapterV2 (parallel with probe cleanup)
3. LendingRouterV2 (depends on LendingCoreV2)
4. xcm hook wiring (depends on LendingCoreV2)
5. oracle maxAge tx (independent, can run anytime)
6. probe cleanup (independent)
7. docs + frontend (independent, parallel)
8. deploy script (independent)

**rollback**: market version registry keeps v1 active until v2 is validated. rollback = keep v1 active.

**test gates**:
- focused unit: LendingCoreV2.depositCollateralFor, xcm hook
- integration: deploy to testnet, call depositCollateralFromPAS, verify user position
- live verification: probe stage1+stage3 clean results
- lint/static only: docs, frontend copy changes
- none: oracle maxAge tx (single admin call)

**proof required to close**:
- testnet tx hash showing RiskAdapterV2 calling pvm DeterministicRiskModel
- testnet tx hash showing LendingRouterV2 depositing to user's position
- testnet tx hash showing liquidation event with xcm notification
- clean probe-results.json with stage1 pass and stage3 clean
- git diff showing README PvmQuoteProbe refs removed

**confidence**: HIGH (all changes are within our control, no platform dependencies)

---

### m10 — permissionless async bilateral infrastructure

**objective**: move from demo coupling to modular, bilateral, asynchronous, permissionless infrastructure.

**scope**:
1. design bilateral async request/receipt flow:
   - evm→xcm: LendingCore emits RequestSent(correlationId, type, data) → xcm send with SetTopic(correlationId) → off-chain correlator matches RequestSent to XcmSent
   - xcm→evm: incoming xcm execute triggers ReceiptReceived(correlationId) event on a new XcmInbox contract
   - correlation ids: keccak256(sender, nonce, block.timestamp)
   - idempotency: inbox tracks processed correlationIds, rejects duplicates
   - timeout: requests have deadline block number, auto-expire after N blocks
   - retry: off-chain retry logic with exponential backoff, max 3 attempts

2. remove hardcoded routing:
   - replace hardcoded XcmLiquidationNotifier address with a registry pattern: LiquidationHookRegistry mapping(bytes32 hookType => address handler)
   - hooks are registered via governance, not constructor args
   - add/remove hooks without redeploying core

3. reduce singleton admin:
   - transfer emergencyAdmin from deployer EOA to governance timelock
   - document temporary riskAdmin EOA with expiry plan
   - add renounceRole path for deployer after governance is proven

4. modular asset expansion:
   - extract market factory pattern from deployment scripts
   - new markets deployable via governance proposal (registerVersion + activateVersion already exist)
   - document the market creation flow

5. parallel processing design:
   - off-chain: parallel event subscriptions for oracle, liquidation, pool metrics
   - off-chain: batch rpc calls via multicall for read operations
   - on-chain: batchLiquidate already exists. no additional parallelism possible on-chain.

6. benchmarking:
   - measure actual gas costs for borrow/repay/liquidate on testnet
   - measure block inclusion time
   - measure end-to-end latency: user tx → confirmation → frontend update
   - document honest numbers, not claims

7. off-chain event correlator:
   - viem event subscription pipeline
   - correlates: xcm send events ↔ liquidation events ↔ oracle updates
   - local timestamps with ms resolution
   - outputs structured json logs

**exclusions**:
- pvm->evm callbacks (still platform-blocked)
- full Transact xcm with fee payment (complex, untested on relay)
- multi-chain deployment (single testnet only)
- production oracle network
- formal verification

**dependencies**:
- m9 must be complete (v2 contracts deployed)
- testnet rpc stable

**acceptance criteria**:
- XcmInbox contract deployed with correlationId tracking
- LiquidationHookRegistry deployed with at least XcmLiquidationNotifier registered
- emergencyAdmin transferred to timelock
- market factory pattern documented and tested
- gas benchmarks for all core operations documented
- event correlator running and producing structured logs

**sequencing**:
1. XcmInbox + hook registry (independent)
2. admin transfer (depends on governance being proven)
3. benchmarking (independent, can start immediately)
4. event correlator (depends on m9 event watcher foundation)
5. market factory docs (independent)

**rollback**: all new contracts are additive. existing v2 contracts unaffected. registry is optional — core works without it.

**test gates**:
- focused unit: XcmInbox correlationId dedup, timeout, hook registry CRUD
- integration: deploy registry, register hook, trigger liquidation, verify xcm sent
- live verification: gas benchmarks on testnet
- none: documentation, admin transfer tx

**proof required to close**:
- testnet tx showing correlationId-based xcm dispatch
- gas benchmark table with actual testnet measurements
- event correlator log showing correlated xcm↔liquidation events
- evidence of emergencyAdmin role transfer

**confidence**: MEDIUM (some components are novel, xcm inbox requires testing on live precompile)

---

## 8. implementation plan

### phase 1 (m9, parallelizable workstreams)

| stream | tasks | depends on | validation level |
|--------|-------|-----------|-----------------|
| A: pvm-risk | 1. resolc compile DeterministicRiskModel 2. deploy to pvm testnet 3. verify with stage1 echo | nothing | live verification |
| B: core-v2 | 1. add depositCollateralFor to LendingCoreV2 2. add liquidation xcm hook 3. compile+test | nothing | focused unit |
| C: probe-cleanup | 1. deploy fresh probes 2. run stage1+stage3 once 3. capture results | nothing | live verification |
| D: oracle-fix | 1. call setMaxAge(1800) via riskAdmin | nothing | none (1 tx) |
| E: docs-frontend | 1. fix README L45/52 2. cut frontend fluff 3. write 250w summary | nothing | lint only |
| F: deploy-script | 1. write idempotent deploy with manifest diff | nothing | focused unit |

**sequencing**: A, B, C, D, E, F all start in parallel.
then:
- G: deploy RiskAdapterV2 (depends on A)
- H: deploy LendingCoreV2 + LendingRouterV2 (depends on B)
- I: register market v2, activate (depends on G + H)
- J: wire xcm hook + test on testnet (depends on I)

### phase 2 (m10, after m9 complete)
sequential: inbox → registry → admin transfer → benchmarks → correlator → docs

### smallest safest changes first
1. oracle setMaxAge: 1 tx, zero blast radius
2. README 2-line fix: zero runtime risk
3. fresh probe deploy: isolated, no impact on lending
4. DeterministicRiskModel pvm compile+deploy: isolated
5. LendingCoreV2: new contract, v1 stays active
6. market version cutover: existing migration system handles this

---

## 9. orchestration plan

### coordinator role
- orchestrator (me) manages feature sequencing, milestone state, handoff review
- does NOT write code

### worker types needed

| worker | responsibility | inputs | outputs | parallel? |
|--------|---------------|--------|---------|-----------|
| solidity-worker | LendingCoreV2, LendingRouterV2, RiskAdapterV2, XcmInbox, HookRegistry | feature spec, existing contracts | compiled contracts, tests | yes (1 per contract) |
| deployment-worker | pvm compilation, testnet deployment, probe runs, oracle tx | compiled artifacts, manifest | deployment receipts, updated manifest | sequential per dependency |
| frontend-worker | cut verbosity, fix components, write summary | feature spec, existing src/ | modified tsx/ts files | yes |
| docs-worker | README fix, deploy guide, benchmark docs | feature spec | modified .md files | yes |

### parallel vs sequential

**parallel (no dependencies)**:
- solidity-worker: LendingCoreV2
- solidity-worker: deploy script
- frontend-worker: cut verbosity
- docs-worker: README fix
- deployment-worker: oracle setMaxAge + probe cleanup

**sequential (dependency chain)**:
1. solidity-worker: LendingCoreV2 → deployment-worker: deploy → deployment-worker: register version
2. deployment-worker: pvm compile DeterministicRiskModel → deployment-worker: deploy RiskAdapterV2

### stop conditions
- resolc compilation fails → stop pvm stream, continue others
- testnet rpc unreachable → stop all deployment, continue local dev
- market version activation fails → investigate, do not proceed to v2

### handoff rules
- every worker commits before returning
- every deployment includes tx hash in manifest
- every contract change includes focused test
- docs changes do NOT require test passes

### conflict resolution
- if two workers modify same file: first commit wins, second rebases
- if test fails: worker fixes before returning, does not hand off broken state

### efficiency rules
- do NOT re-run full 105 test suite for docs-only changes
- do NOT create separate features for oracle setMaxAge (1 tx, bundle into deployment stream)
- batch safe edits: README fix + SPEC fix + frontend copy cuts can be one feature
- separate docs-only work from runtime work in features.json (different skillNames if needed)

### token/compute optimization
- avoid scanning entire codebase when scope is known
- workers read only files they need to modify
- no duplicate test runs within same milestone
- batch lint+typecheck into single verification step

---

## 10. performance and decentralization analysis

| metric | baseline (current) | target (m9) | target (m10) | unknown |
|--------|-------------------|-------------|-------------|---------|
| borrow gas | ~300-500k (estimate) | same | same | need actual measurement |
| liquidate gas | ~350-550k (estimate) | +~5k (xcm hook) | same | need actual measurement |
| max borrow tps @ 6s block | ~3-5 | same | same | block gas limit unknown |
| max borrow tps @ 2s block | ~9-15 | same | same | elastic scaling timeline unknown |
| end-to-end latency | unknown | unknown | measured | need benchmark |
| pvm verification latency | unknown | measured | measured | depends on pvm performance |
| admin EOAs | 3 (deployer, riskAdmin, minter) | 3 (document risk) | 1 (riskAdmin only, with expiry) | governance proven? |
| emergency pause | deployer EOA | deployer EOA | governance timelock | acceptable for hackathon |
| oracle update | single riskAdmin | single riskAdmin | single riskAdmin + documented | no alternative on testnet |
| asset expansion | manual deploy script | documented flow | factory pattern | needs testing |
| LOC (solidity) | 2739 | ~2800 (+V2 contracts) | ~2900 (+inbox+registry) | modest growth |
| LOC (frontend) | ~2400 | ~1500 (-40%) | ~1500 | depends on cut depth |
| LOC (tests) | ~3900 | ~4100 (+v2 tests) | ~4300 (+inbox tests) | proportional |

**honest limits**:
- throughput is bounded by block gas limit and block time. no app-level optimization changes this.
- pvm->evm is platform-blocked. no timeline from parity.
- xcm Transact with fee payment is untested on relay. may fail.
- manual oracle is a fundamental limitation. no oracle network on polkadot hub testnet.

---

## 11. contradictions register

| # | contradiction | source A | source B | which is wrong | resolution |
|---|-------------|----------|----------|---------------|------------|
| 1 | quoteEngine address | canonical.json: 0x9a78...=quoteEngine | probes.json: 0x9a78...=PvmQuoteProbe | canonical.json is misleading — field says "quoteEngine" but value is a test probe | deploy real DeterministicRiskModel to pvm, update manifest |
| 2 | README L45 "quote ticket publication" | README.md line 45 | RiskAdapter.sol: no public publishQuoteTicket | README is stale | fix README |
| 3 | README L52 "PvmQuoteProbe" | README.md line 52 | contracts/pvm/DeterministicRiskModel.sol exists | README uses old name | fix README |
| 4 | LendingRouter "by-design" | docs say "intentional for hackathon MVP" | audit says "renders feature useless" | both are true — it's intentionally broken. fix it. | deploy LendingRouterV2 |
| 5 | "105 tests passing" | test output | some tests mock xcm precompile | both true — 105 pass but xcm coverage is mock-only | document limitation, add live smoke checks |
| 6 | oracle "circuit breaker" | code has min/max/delta checks | maxAge=6h allows 6h stale data | circuit breaker works but maxAge is too generous | reduce maxAge |
| 7 | "dual-vm" claim | README claims dual-vm | pvm->evm is broken | claim is half-true | document: "evm->pvm proven, pvm->evm blocked by platform preview" |

---

## 12. go / no-go

### m9 (stabilize, connect, de-risk): **GO**
- all fixes are within our control
- no platform dependencies
- surgical changes with rollback via market version registry
- estimated effort: 2-3 days
- risk: LOW

### m10 (permissionless async bilateral): **CONDITIONAL GO**
- go if m9 succeeds and testnet is stable
- conditional on: xcm inbox working on live precompile, governance proven enough for admin transfer
- estimated effort: 3-5 days
- risk: MEDIUM (novel components, live precompile testing)

### overall: **GO** with honest scope

### top 10 blockers remaining after plan

| # | blocker | status after m9 | status after m10 |
|---|---------|----------------|-----------------|
| 1 | pvm->evm callbacks | STILL BROKEN (platform) | STILL BROKEN (platform) |
| 2 | DeterministicRiskModel not pvm | FIXED | FIXED |
| 3 | LendingRouter credits self | FIXED | FIXED |
| 4 | xcm disconnected | FIXED (hook + SetTopic) | FIXED (+ correlator) |
| 5 | oracle maxAge 6h | FIXED (1800s) | FIXED |
| 6 | probe pollution | FIXED (fresh run) | FIXED |
| 7 | no live tests | PARTIAL (smoke checks) | IMPROVED (benchmarks) |
| 8 | docs drift | FIXED | FIXED |
| 9 | admin centralization | DOCUMENTED | PARTIALLY FIXED (emergency→timelock) |
| 10 | no monitoring | MISSING | FIXED (event correlator) |
| NEW | xcm Transact with fees | NOT ATTEMPTED | ASPIRATIONAL (untested) |
| NEW | production oracle | NOT AVAILABLE | NOT AVAILABLE (testnet limitation) |
