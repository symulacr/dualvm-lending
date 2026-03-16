# DualVM Lending Architecture Migration Blueprint

Status anchor before any future refactor:
- Stable snapshot pushed to `main` at commit `0031c9b` (`refactor dualvm quality foundations`)
- Future refactor planning branch: `dualvm-architecture-refactor-plan`

This file is a planning artifact only. It does not claim the redesign is implemented.

---

## 1. Why this document exists

The current codebase works as an isolated-market lending MVP, but it is not yet a first-principles architecture for high-throughput, permissionless, low-replication execution. The current system is still optimized around a hackathon-proof REVM-centered implementation with operator scripts, a manual oracle, and a parity-only PVM posture.

The purpose of this document is to:
1. freeze the current code state before any branch-level architectural rewrite,
2. map the exact current components and hidden logic,
3. define a component-by-component migration target,
4. define a file-by-file refactor map,
5. identify assumptions and likely false positives before touching code.

The design target is not “literal infinite scale” — that is not honest for a single shared settlement chain. The real target is:
- constant-size settlement work,
- sharply reduced duplicated orchestration,
- reduced shared mutable state,
- permissionless keepers instead of trusted operators,
- versioned and verifiable quote computation,
- clearer immutability boundaries,
- lower gas and lower code size,
- stronger Track 1 truth and a future-real Track 2 path.

---

## 2. Current architecture in the code today

### 2.1 Current component graph

```text
                                   CURRENT IMPLEMENTED STACK

   Wallet / User / LP / Liquidator / Admin
                    │
                    ▼
         Public ETH RPC / Blockscout / Faucet
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                  REVM / Solidity Layer                                  │
│                                                                                          │
│  WPAS ─────────────┐                                                                      │
│  wraps native PAS  │                                                                      │
│                    ▼                                                                      │
│               LendingCore ────────► DebtPool                                             │
│               - positions         - ERC4626 liquidity                                     │
│               - solvency          - LP shares                                             │
│               - borrow/repay      - reserves                                              │
│               - liquidation       - principal accounting                                  │
│                    │                                                                      │
│                    ├──────────────► ManualOracle                                          │
│                    │               - price                                                 │
│                    │               - freshness                                             │
│                    │               - bounds + circuit breaker                              │
│                    │                                                                      │
│                    └──────────────► PvmRiskEngine                                         │
│                                    - bounded stateless arithmetic                         │
│                                    - deployed today as REVM-consumed contract path        │
│                                                                                          │
│  USDCMock ────────► debt token / LP asset                                                 │
│  AccessManager ───► role gating + delays                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Current hidden logic flow

Borrow path today:

```text
borrow(amount)
  -> accrue borrower state
  -> fetch fresh oracle price
  -> derive projected utilization from global pool state
  -> derive projected collateral ratio from borrower state
  -> call RiskEngine.quote(...)
  -> clamp to configured LTV/threshold
  -> check borrow cap
  -> check minimum debt
  -> check solvency again in REVM
  -> draw debt from DebtPool
```

Liquidation path today:

```text
liquidate(borrower, requestedRepay)
  -> accrue borrower state
  -> fetch fresh oracle price
  -> refresh risk snapshot
  -> require health factor < 1
  -> cap repay against collateral value
  -> transfer debt token into DebtPool
  -> repay interest then principal
  -> seize collateral
  -> if collateral exhausted and debt remains:
       write off remaining principal only
       forgive accrued interest with the position
```

Read path today:

```text
frontend read model
  -> reads pool totals
  -> reads lending core params and observer state
  -> reads oracle state
  -> reads recent events from RPC
  -> falls back to snapshot file when activity query fails
```

### 2.3 Current hidden shared-state bottlenecks

The current system has three real shared-state bottlenecks:

1. **Global pool utilization state**
   - `DebtPool.totalAssets()`
   - `DebtPool.outstandingPrincipal()`
   Borrow quotes depend on this shared global state.

2. **Global oracle validity state**
   - `priceWad`
   - `lastUpdatedAt`
   - `maxAge`
   - circuit-breaker config
   Borrow, withdraw, and liquidation all depend on this.

3. **Per-position snapshot state inside LendingCore**
   - borrow rate snapshot
   - LTV snapshot
   - liquidation threshold snapshot
   - timestamps
   This duplicates configuration/risk-derived state across every position.

### 2.4 Current operational duplication sources

Even after the latest cleanup, duplication still clusters around:
- script entrypoint setup,
- wallet/actor loading,
- contract attachment,
- market scenario orchestration,
- repeated oracle/risk-engine restore flows,
- mirrored read-model and frontend projection logic.

That is why the duplication score is still poor.

---

## 3. Current EVM to PVM reality

### 3.1 What is true
- `dualvm/contracts/pvm/PvmRiskEngine.sol` defines the bounded risk computation logic.
- `dualvm/pvm-artifacts/PvmRiskEngine.json` exists.
- The live protocol path consumes a deployed `RiskEngine` address.

### 3.2 What is not true
- The deployed hot path is **not yet a proven live REVM -> PVM cross-VM flow**.
- The current system should **not** be redesigned under the assumption that a stable production-grade cross-VM settlement path already exists.

### 3.3 Current truth diagram

```text
TODAY
Borrow / Liquidate tx
  -> LendingCore (REVM)
      -> RiskEngine.quote(...)
      -> REVM state mutation

NOT YET PROVEN TODAY
Borrow / Liquidate tx
  -> REVM kernel
      -> proven cross-VM dispatch
      -> PVM risk execution
      -> verified return path
      -> REVM settlement
```

This matters because any refactor that assumes the second path already exists will overfit to a false premise.

---

## 4. Target architecture: first-principles redesign

### 4.1 Target component graph

```text
                                TARGET MIGRATION ARCHITECTURE

                               Users / LPs / Liquidators / Keepers
                                             │
                                             ▼
                               Public RPC / Explorer / Hosted Frontend
                                             │
                                             ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                              REVM Settlement / Market Kernel                             │
│                                                                                          │
│   MarketKernel (immutable market rules + settlement)                                     │
│      ├── CollateralVault (custody of WPAS or collateral adapter)                         │
│      ├── LiquidityVault  (debt asset liquidity + LP shares + reserves)                   │
│      ├── QuoteTicketValidator (epoch / hash / config verification)                       │
│      └── Liquidation settlement                                                           │
│                                                                                          │
│   OracleEpochSource                                                                       │
│      └── versioned freshness / price state, not arbitrary mutable authority everywhere    │
│                                                                                          │
│   ConfigRegistry (replaceable market registry, not mutable kernel internals)              │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                            Quote / Scheduling / Compute Plane                            │
│                                                                                          │
│   QuoteTicketCache                                                                        │
│      - permissionless write                                                               │
│      - versioned by marketEpoch, accountEpoch, oracleEpoch, configHash                   │
│                                                                                          │
│   RiskAdapter                                                                             │
│      - validates quote ticket                                                             │
│      - can consume REVM-local or PVM-backed quote path                                    │
│                                                                                          │
│   PVM Risk Engine                                                                          │
│      - pure arithmetic only                                                               │
│      - no custody                                                                         │
│      - no settlement state                                                                │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Core design rules

1. **Immutable kernel, replaceable periphery**
   - market settlement logic should be immutable per market version
   - registry/peripheral modules may evolve
   - upgrades happen by adding a new market version, not mutating old settlement semantics

2. **One domain, one owner**
   - collateral custody should not be mixed with debt liquidity accounting
   - quote validation should not be mixed with LP share accounting
   - oracle versioning should not be mixed with borrower debt state

3. **Versioned quote consumption**
   - the settlement path should consume a quote ticket keyed by current epochs
   - repeated risk recomputation in the settlement path should shrink dramatically

4. **Permissionless keeper model**
   - quote publication, liquidation execution, and health refresh should be available to any actor
   - the chain remains the authority; off-chain work is proposed, not trusted

---

## 5. Target migration, component by component

## 5.1 `LendingCore.sol` → split kernel + quote validator + smaller position state

Current role:
- collateral deposit/withdraw
- debt accounting
- rate snapshots
- solvency checks
- liquidation settlement
- config setters
- treasury setter
- oracle setter
- risk-engine setter

Target role split:

### Keep inside `MarketKernel`
- borrower principal / accrued interest accounting
- collateral balances
- borrow settlement
- repay settlement
- liquidation settlement
- minimum debt floor
- borrow cap enforcement

### Move out of `MarketKernel`
- mutable config setters → `ConfigRegistry` / versioning
- oracle source setter → registry/periphery
- risk-engine setter → registry/periphery
- persistent quote snapshots where avoidable

### State reduction target
Current `Position` stores too much quote-derived state.
Refactor target:
- keep only state that must survive settlement exactly
- stop persisting values that can be recovered from:
  - config epoch
  - oracle epoch
  - quote ticket hash

### Migration path
1. Introduce a `QuoteTicket` struct and validator in a new module
2. Move mutable config surface out of core
3. Reduce `Position` storage width and field count
4. Make the market core constructor take immutable market parameters where possible

### Likely deletions from current core
- `setRiskEngine`
- `setOracle`
- `setTreasury`
- possibly `setBorrowCap`, `setMinBorrowAmount`, `setRiskBounds`, `setReserveFactorBps`, `setLiquidationBonusBps`
  if you switch to immutable-per-market deployment plus registry versioning

---

## 5.2 `DebtPool.sol` → rename conceptually to `LiquidityVault`

Current role:
- ERC4626 LP vault
- LP share issuance
- principal accounting
- reserve accounting
- liquidity gating

Target role:
- keep this mostly intact
- but conceptually narrow it to liquidity state only
- it should not know anything about risk policy other than hard liquidity math

### Keep
- ERC4626 share layer
- reserve segregation
- available liquidity computation
- principal-only accounting truth

### Potential simplifications
- if market parameters become immutable, fewer admin mutations remain
- `setSupplyCap` may move to versioned market deployment rather than live mutation

### Migration path
1. keep ERC4626 behavior
2. remove live-mutated economic knobs if market versioning replaces setter churn
3. expose only liquidity semantics, not policy semantics

---

## 5.3 `ManualOracle.sol` → `OracleEpochSource`

Current role:
- price
- freshness
- bounds
- max move breaker
- pause

Target role:
- explicit epoch/version source for settlement eligibility
- oracle module should produce a compact versioned state, not broad mutable coupling

### Keep
- freshness checks
- bounds
- max move breaker
- explicit liveness semantics

### Change
- every accepted oracle update increments `oracleEpoch`
- settlement and quote tickets depend on `oracleEpoch`
- UI and keepers can invalidate old quotes cheaply

### Migration path
1. add `oracleEpoch`
2. add typed oracle state hash / version view
3. migrate settlement path to validate against oracle epoch rather than re-derive everything inline

### Future decentralized path
- registry accepts a new oracle adapter version
- market kernel consumes epoch/version, not vendor-specific semantics

---

## 5.4 `PvmRiskEngine.sol` → true quote VM, still pure and stateless

Current role:
- bounded quote arithmetic
- no storage
- no custody

Target role:
- remain stateless
- become the canonical quote VM **only after** the proof path is real

### Keep
- pure arithmetic only
- no settlement authority
- no user funds

### Do not add
- custody
- debt state
- config mutation
- liquidation settlement

### Migration path
1. introduce a quote ticket abstraction first
2. let `RiskAdapter` validate quote ticket epochs/hashes
3. later swap quote source from REVM-local path to proven PVM-backed path

This avoids building a fake DualVM path before it is actually trustworthy.

---

## 5.5 `DualVMAccessManager.sol` + role choreography → registry-governed periphery, not mutable kernel

Current role:
- broad function-role mapping
- delays on sensitive functions
- one ultimate admin still exists

Target role:
- reduce what needs governance at all
- move most “governed” behavior to version selection, not in-place mutation

### Keep
- emergency pause of periphery if necessary
- delayed activation of new market versions / oracle adapters / registries

### Reduce
- live mutation of economic parameters inside the active settlement kernel
- broad setter surfaces requiring operator scripts

### Migration path
1. freeze more in market deployment
2. keep AccessManager around registry activation / emergency functions
3. push governance up one layer, not into the settlement hot path

---

## 5.6 Frontend read model → explicit projection layer with provenance

Current role:
- read many contracts directly
- observer mode
- recent-activity snapshot fallback

Target role:
- projection layer with explicit provenance
- no hidden backend necessary, but state assembly should be cleaner and narrower

### Keep
- observer-first truth
- explicit fallback provenance
- public-RPC-first operation

### Change
- split `App.tsx` into focused sections
- centralize read projections per domain:
  - market projection
  - observer projection
  - recent-activity projection
  - network/provenance projection

### Migration path
1. split `App.tsx`
2. turn current `loadMarketSnapshot` into composable projection modules
3. later consume quote-ticket / epoch views if added

---

## 5.7 Script layer → replace many scenario entrypoints with composable runners

Current role:
- many separate operator scripts
- repeated wallet loading, contract attachment, scenario steps

Target role:
- few small entrypoints built from shared scenario graph

### Desired structure
```text
lib/runtime/
  env.ts
  entrypoint.ts
  transactions.ts
  actors.ts
  contracts.ts

lib/ops/
  managedAccess.ts
  liveScenario.ts
  quoteScenario.ts
  restoreScenario.ts

scripts/
  deploy.ts
  verifyAll.ts
  scenario-borrow.ts
  scenario-repay.ts
  scenario-liquidate.ts
  scenario-risk.ts
```

### Migration path
1. add `actors.ts` for wallet loading
2. add `contracts.ts` for manifest-driven contract attachment bundles
3. collapse current live scripts into small scenario entrypoints
4. eliminate repeated contract wiring from every entrypoint

---

# 6. File-by-file refactor map

This is the concrete file-level plan.

## 6.1 Keep, but narrow / split

### `dualvm/contracts/LendingCore.sol`
- keep as the seed of `MarketKernel`
- split out:
  - quote ticket validation
  - mutable config surface
- reduce stored snapshot fields
- likely largest refactor target

### `dualvm/contracts/DebtPool.sol`
- keep largely intact
- narrow conceptually to liquidity-only vault
- remove live-mutated policy if replaced by market versioning

### `dualvm/contracts/ManualOracle.sol`
- keep as current testnet oracle source
- add epoch/version semantics if refactor proceeds

### `dualvm/contracts/pvm/PvmRiskEngine.sol`
- keep as stateless compute module
- do not enlarge its authority

### `dualvm/src/App.tsx`
- split aggressively
- target files:
  - `src/components/sections/HeroSection.tsx`
  - `NetworkSection.tsx`
  - `ScopeSection.tsx`
  - `ManifestSection.tsx`
  - `ReadLayerSection.tsx`
  - `ObserverSection.tsx`
  - `RecentActivitySection.tsx`
  - `SecuritySection.tsx`

### `dualvm/src/lib/readModel.ts`
- split into:
  - `marketProjection.ts`
  - `observerProjection.ts`
  - `activityProjection.ts`
  - `projectionTypes.ts`

## 6.2 Keep as shared foundations

### `dualvm/lib/shared/deploymentManifest.ts`
- keep
- this is the right shared boundary

### `dualvm/lib/deployment/manifestStore.ts`
- keep
- continue to centralize manifest load/write

### `dualvm/lib/runtime/env.ts`
- keep

### `dualvm/lib/runtime/transactions.ts`
- keep

### `dualvm/lib/runtime/entrypoint.ts`
- keep

## 6.3 Merge / compress further

### `dualvm/lib/ops/liveScenario.ts`
- expand into the real shared scenario runner
- merge repeated live script setup into it

### current script entrypoints
Potentially merge or replace:
- `liveSmoke.ts`
- `liveRepaySmoke.ts`
- `liveLiquidationSmoke.ts`
- `liveMinterSmoke.ts`
- `liveOracleSmoke.ts`
- `liveRiskAdminSmoke.ts`
- `applyRoleSeparation.ts`
- `upgradeOracle.ts`

Target:
- keep fewer entrypoints
- parameterize scenario steps instead of duplicating orchestration

## 6.4 Likely delete after migration

If the refactor succeeds, delete or drastically reduce:
- duplicated scenario-specific orchestration across `dualvm/scripts/*`
- duplicated UI section logic inside `App.tsx`
- live-mutated config setters in `LendingCore` if immutable-per-market design is adopted

---

# 7. Assumptions to validate before touching the refactor branch

These must be checked before implementing the redesign.

## Assumption A — one-market immutability is acceptable
If you freeze market config at deployment time, you are assuming:
- one-market versioning is acceptable for hackathon scope
- replacing a market is cleaner than mutating it

Validate by asking:
- do you want mutable market parameters for demos, or a cleaner immutable kernel?

## Assumption B — quote tickets are acceptable UX
A quote-ticket model assumes:
- borrow/liq flows can tolerate one more derived object/version dependency
- public-RPC latency is acceptable for keeper-submitted or user-submitted quote tickets

Validate by prototyping the UX overhead before redesigning settlement around it.

## Assumption C — Track 2 should stay bounded during the refactor
Do not assume that the refactor branch should strengthen live DualVM claims.
That is a different project.

Validate by keeping the branch scoped to:
- cleaner architecture
- smaller code
- lower duplication
- better hot-path boundaries

## Assumption D — immutable kernel is preferred over proxy upgradeability
This design assumes:
- transparency and version migration are better than in-place mutation

Validate against your real product posture. If you want proxy-style governance, this plan changes materially.

## Assumption E — operator scripts remain acceptable for proof while refactoring
The current codebase still depends on them for live proofs.
Do not remove them until replacement flows exist.

---

# 8. False positives to avoid during planning

These are the traps most likely to waste time or create fake progress.

## False positive 1 — “PVM will solve throughput by itself”
No.
The real bottleneck is shared mutable state and repeated orchestration, not pure arithmetic cost.

## False positive 2 — “More roles means more decentralization”
No.
More mutable admin roles can just mean more complex centralization.

## False positive 3 — “A giant keeper/indexer plane makes it scalable”
No.
If keepers become authoritative, you have only moved the centralization point.

## False positive 4 — “One monolithic kernel is simpler”
At this size, a single settlement contract is acceptable.
At the next step, the hidden coupling cost becomes the real complexity driver.

## False positive 5 — “A bigger frontend means a better product”
No.
Projection quality and provenance matter more than more panels.

## False positive 6 — “Infinite scale” is a valid design target on one shared chain
No.
The valid target is constant-size on-chain settlement work plus permissionless off-chain proposal work.

## False positive 7 — “Test health score should be chased mechanically”
No.
The score is a signal, not the architecture. Do not add junk tests just to hit a percentage.
The right move is more direct tests around smaller, well-factored modules.

---

# 9. Migration branch strategy

Recommended branch sequence:

```text
main
 └── current stable snapshot: 0031c9b
      └── dualvm-architecture-refactor-plan
           └── future implementation branches
                ├── dualvm-kernel-split
                ├── dualvm-frontend-projection-split
                ├── dualvm-scenario-runner-collapse
                └── dualvm-quote-epoch-prototype
```

Implementation order:
1. split frontend projection and App sections
2. collapse script orchestration into shared actor/contract/scenario loaders
3. prototype quote epochs and quote-ticket validation
4. only then refactor the market kernel
5. only after that revisit true PVM execution claims

This keeps Track 1 alive while reducing architectural risk.

---

# 10. Minimal next-step recommendation

If the next branch starts tomorrow, do this first:

## Step 1 — reduce code without changing semantics
- split `App.tsx`
- split `readModel.ts`
- collapse script contract/wallet loading into shared modules

## Step 2 — reduce mutable surface
- identify every `restricted` setter in `LendingCore`
- decide which are moved to immutable market config
- decide which survive at registry/periphery layer

## Step 3 — prototype versioned quote tickets
- no PVM dependency required yet
- prove the settlement path can consume a quote ticket safely

That is the cleanest architecture-first move.

---

# 11. Final planning verdict

The current codebase is good enough to support a serious refactor branch.
The correct next move is **not** to chase “infinite scale” slogans directly.
The correct next move is to:
- shrink duplicated orchestration,
- separate immutable settlement from mutable periphery,
- introduce versioned quote validation,
- reduce repeated recomputation in the settlement path,
- preserve Track 1 truth,
- keep Track 2 bounded until it is actually proven.

That is the fastest route to something that is:
- smaller,
- clearer,
- cheaper,
- more permissionless,
- more transparent,
- more upgradeable by versioning,
- and more credible at scale.
