# Architectural Critique: Domains 5–8

## Domain 5: Transaction Flow — Sequential vs Parallel

### External Call Map

**`borrow()` execution path** (LendingCore.sol ~L220–260):
1. `collateralAsset.safeTransferFrom()` — NOT called (collateral already deposited)
2. `_accrue(position)` — internal, storage write
3. `oracle.latestPriceWad()` → **External call #1** (ManualOracle, reverts if stale or paused)
4. `oracle.lastUpdatedAt()` → **External call #2** (ManualOracle)
5. `debtPool.outstandingPrincipal()` → **External call #3** (DebtPool storage read)
6. `riskEngine.quoteViaTicket()` → **External call #4** (RiskAdapter → may delegate to PvmRiskEngine.quote() = **External call #5**)
7. `debtPool.drawDebt(msg.sender, amount)` → **External call #6** (DebtPool: nonReentrant + safeTransfer to borrower = nested external call #7)

**Total external calls in `borrow()`: 7** (including the nested PvmRiskEngine.quote inside quoteViaTicket, and the token transfer inside drawDebt).

**`repay()` execution path** (LendingCore.sol ~L262–300):
1. `_accrue(position)` — internal
2. `debtAsset.safeTransferFrom(msg.sender, address(debtPool), payment)` → **External call #1**
3. `debtPool.recordRepayment()` → **External call #2**
4. If remaining debt > 0: `oracle.priceWad()` → **External call #3**, `oracle.isFresh()` → **External call #4**, `oracle.lastUpdatedAt()` → **External call #5**, `debtPool.outstandingPrincipal()` → **External call #6**, `riskEngine.quoteViaTicket()` → **External calls #7–#8**

**Total external calls in `repay()`: up to 8.**

**`liquidate()` execution path** (LendingCore.sol ~L302–380):
1. `_accrue(position)` — internal
2. `oracle.latestPriceWad()` → **External call #1**
3. `oracle.lastUpdatedAt()` → **External call #2**
4. `debtPool.outstandingPrincipal()` → **External call #3**
5. `riskEngine.quoteViaTicket()` → **External calls #4–#5** (first quote for health check)
6. `debtAsset.safeTransferFrom()` → **External call #6**
7. `debtPool.recordRepayment()` → **External call #7**
8. `collateralAsset.safeTransfer()` → **External call #8**
9. If remaining debt > 0: `debtPool.outstandingPrincipal()` → **External call #9**, `riskEngine.quoteViaTicket()` → **External calls #10–#11** (second quote for updated rate)
10. If bad debt: `debtPool.recordLoss()` → **External call #9** (alternate path)

**Total external calls in `liquidate()`: up to 11.**

### Concurrency Analysis

**Can two independent borrows on different collateral positions execute concurrently?**

No. Every operation is strictly sequential within a single block. The EVM is inherently single-threaded — transactions execute one at a time. But the deeper problem is:

- `borrow()` reads `debtPool.outstandingPrincipal()` as a global shared state variable. Two borrows in the same block read the same value, meaning the second borrow's utilization calculation is based on stale data from *before* the first borrow's `drawDebt` updated `outstandingPrincipal`. This is not a bug per se (both reads are atomic within their own tx), but it means **risk pricing is not order-independent** — the second borrow in a block gets a risk quote based on pre-first-borrow utilization.
- The `borrowCap` check at L248 (`projectedOutstandingPrincipal > borrowCap`) uses a locally projected value but doesn't account for other borrows in the same block that haven't settled yet. Two borrows that individually pass the cap check could collectively exceed it.

**Theoretical max TPS for lending operations:**

With 6s block time and each `borrow()` consuming ~7 external calls, gas consumption per borrow is dominated by:
- 2 SSTORE operations (position update + debtPool.outstandingPrincipal update)
- 1 ERC20 safeTransfer (drawDebt)
- Multiple SLOAD cross-contract reads
- 1 quoteViaTicket (potentially SSTORE for ticket caching)

Conservative estimate: ~200k–300k gas per borrow. With a 10M gas block limit (typical for Polkadot Hub), that's ~33–50 borrows per block. At 6s blocks: **~5–8 borrow TPS**. With Elastic Scaling (2s blocks): **~16–25 borrow TPS**.

`liquidate()` is heavier (~400k–500k gas with 11 external calls): **~3–4 liquidation TPS** at 6s, **~10–12 at 2s**.

**Batching capability:**

Zero. There is no `multicall()`, no `batch()`, no `aggregate()` pattern anywhere in the contracts. Every operation requires its own transaction. A liquidator who needs to liquidate 10 positions must submit 10 separate transactions.

### Verdict: MODERATE CONCERN

**Root cause:** Standard single-threaded EVM execution with no batching, combined with shared global state (`outstandingPrincipal`) that makes risk quotes order-dependent within a block.

**Consequence:** Liquidation cascades are bottlenecked by block capacity. A mass undercollateralization event (oracle price crash) could require many blocks to clear all liquidatable positions, accumulating bad debt while positions queue up. MEV bots ordering transactions can extract value by choosing which borrows land first (lower utilization = lower rate).

**Minimum viable fix:**
1. Add a `multicall()` or `batchLiquidate()` function to clear multiple positions in one tx.
2. Consider flash-loan style liquidation helper to reduce capital requirements for liquidators.
3. Accept the TPS limit as an inherent EVM constraint — document it as a known protocol capacity bound.

---

## Domain 6: Deployment Architecture

### Deployment Order

`deploySystem.ts` orchestrates a **strictly sequential** deployment:

1. Deploy `DualVMAccessManager` (1 tx)
2. Deploy `WPAS` (1 tx)
3. Deploy `USDCMock` (1 tx)
4. Call `deployMarketVersion()` which deploys:
   - `ManualOracle` (1 tx)
   - `PvmRiskEngine` (1 tx)
   - `RiskAdapter` (1 tx)
   - `DebtPool` (1 tx)
   - `LendingCore` (1 tx)
   - `debtPool.setLendingCore()` (1 tx)
5. Deploy `MarketVersionRegistry` (1 tx)
6. `marketRegistry.registerVersion()` (1 tx)
7. `marketRegistry.activateVersion(1)` (1 tx)
8. 4x `accessManager.labelRole()` (4 tx)
9. 4x `accessManager.grantRole()` (4 tx)
10. 5x `accessManager.setTargetFunctionRole()` (5 tx — LendingCore pause/unpause, DebtPool pause/unpause, DebtPool claimReserves, Oracle set*/setCircuitBreaker, Oracle pause/unpause)
11. 1x `accessManager.setTargetFunctionRole()` for USDCMock.mint (1 tx)
12. 1x `accessManager.setTargetFunctionRole()` for MarketVersionRegistry (1 tx)
13. 5x `accessManager.setTargetAdminDelay()` (5 tx)
14. If initial liquidity: `usdc.mint()` + `usdc.approve()` + `debtPool.deposit()` (3 tx)

**Total sequential transactions for base deployment: ~30 transactions.**

For `deployGovernedSystem.ts`, add:
15. Deploy `GovernanceToken` (1 tx)
16. Deploy `TimelockController` (1 tx)
17. Deploy `DualVMGovernor` (1 tx)
18. `timelock.grantRole(PROPOSER)` (1 tx)
19. `timelock.grantRole(CANCELLER)` (1 tx)
20. `timelock.renounceRole()` (1 tx)
21. 3x `accessManager.setTargetFunctionRole()` for gov token + registry (3 tx)
22. `accessManager.labelRole()` for GOVERNANCE (1 tx)
23. 6x `accessManager.grantRole()` for timelock (6 tx)
24. 5x `accessManager.revokeRole()` for deployer (5 tx)

**Total sequential transactions for governed deployment: ~51 transactions.**

At 6s block time, assuming one tx per block (conservative for testnet): **~5 minutes for governed deployment**. Assuming instant inclusion: **~3 minutes**.

### Idempotency

**Is deployment idempotent?** **No.**

- `deploySystem.ts` always deploys fresh contracts. There is zero address caching, no `if (alreadyDeployed) skip` logic.
- `debtPool.setLendingCore()` has a `LendingCoreAlreadySet` guard — calling it twice reverts.
- `marketRegistry.activateVersion(1)` has a `VersionAlreadyActive` guard — calling it twice reverts.
- Re-running the script creates an entirely new set of contracts with different addresses. The old deployment is orphaned.
- The `manifestStore.ts` writes the manifest to `polkadot-hub-testnet-canonical.json`, overwriting whatever was there. No history, no rollback.

**What happens on redeployment?** Everything is deployed fresh. The old contracts still exist on-chain with locked user funds/positions. There is no migration path for in-flight positions during redeployment (the `IMigratableLendingCore` exists but is not wired into the deployment script).

### Deployment State Timeline

**Is the deployment strategy documented as a state timeline?** No. The deployment is a flat imperative script with no state machine, no checkpoints, no resumability. If it fails at transaction #17, you restart from scratch. The `serializeManifest.ts` only serializes the final state — there's no intermediate-state tracking.

### Two Compilation Pipelines

`hardhat.config.ts`:
- Sources: `./contracts` (the full contract set)
- Artifacts: `./artifacts`
- Solidity 0.8.28, Cancun EVM, optimizer on

`hardhat.pvm.config.ts`:
- Sources: `./contracts/probes` (a subset — only probe contracts)
- Artifacts: `./artifacts-pvm`
- Uses `@parity/hardhat-polkadot` plugin with `resolc` compiler
- Network: `polkadotHubPvmTestnet` with `polkadot: true` flag

**How do they interact?** They don't share state. They compile completely different source directories to different artifact directories. The PVM pipeline only compiles probe contracts (`contracts/probes/`), not the core lending contracts. This means **the core lending protocol is EVM-only** — the "DualVM" in the name refers only to the fact that some probe/risk contracts are compiled to PVM artifacts for experimentation, not that the protocol runs across both VMs.

### Verdict: SIGNIFICANT CONCERN

**Root cause:** Deployment is a monolithic imperative script with no idempotency, no checkpointing, no resumability, and ~51 sequential transactions for the governed path.

**Consequence:** Any failure mid-deployment leaves a partially initialized system on-chain with no cleanup or resume capability. Redeployment orphans previous contracts. On rate-limited public RPC, 51 sequential txs can easily hit rate limits and fail partway.

**Minimum viable fix:**
1. Add a deployment state machine with checkpointing — save progress after each step, resume from last checkpoint on retry.
2. Make `setLendingCore` idempotent (skip if already set to the same address).
3. Implement `CREATE2` deterministic deployment so addresses are predictable and deployment can be verified/resumed.
4. Document the 51-tx deployment as a known operational constraint.

---

## Domain 7: Adapter Layer (Lockbox, MABA, Gas)

### Concept Search Results

| Concept | Present in codebase? |
|---------|---------------------|
| Lockbox | **No** |
| MABA (Mint-and-Burn Adapter) | **No** |
| Mint-and-burn pattern | **No** |
| Gas adapter | **No** |
| Bridge adapter | **No** |
| Cross-chain liquidity transport | **No** |

**Zero cross-chain asset handling infrastructure exists.**

### What IS the Cross-Chain Asset Handling Strategy?

There isn't one. The protocol operates entirely within a single EVM execution environment on Polkadot Hub TestNet. The XCM-related code (`CrossChainQuoteEstimator`, `IXcm`) is purely demonstrative — it calls `weighMessage` on the XCM precompile and records the result. It is not integrated into any lending flow.

From `CLAUDE.md`: "XCM is out of the MVP critical path." This is honest. The codebase backs it up.

### WPAS Wrapping (contracts/WPAS.sol)

WPAS is a standard WETH9-style wrapper for the native PAS token:
- `deposit()` / `depositTo()`: receive native PAS via `msg.value`, mint equivalent WPAS ERC-20 tokens
- `withdraw()` / `withdrawTo()`: burn WPAS, send native PAS via low-level `call{value}`
- Uses `ReentrancyGuard` on both deposit and withdraw (correct)
- Uses OpenZeppelin `ERC20` base (correct)

**Assessment:** Functionally correct but trivial. This is a textbook WETH clone with no novel cross-chain behavior. The collateral asset for the lending protocol is WPAS, meaning users must wrap their native PAS before depositing as collateral. There is no "zap" function that wraps-and-deposits atomically — users need 2 transactions (wrap, then depositCollateral with approve in between = 3 txs total).

### USDCMock (contracts/USDCMock.sol)

A minimalist controlled-mint ERC-20:
- 18 decimals (explicitly overridden — note: real USDC uses 6 decimals, this is a deliberate deviation)
- `mint()` gated by `restricted` (AccessManaged)
- No burn, no blacklist, no pause
- No supply cap

**Assessment:** This is a test token, not a bridged asset. There is no USDC bridge, no CCTP integration, no lockbox pattern. The "USDC" in the protocol is a mock that can be minted at will by anyone with the MINTER role. This is acceptable for a hackathon MVP but means **the debt-side asset has zero connection to real USDC liquidity**.

### Verdict: NOT APPLICABLE (by design) but DISCLOSURE CONCERN

**Root cause:** Cross-chain asset handling was explicitly scoped out. No lockbox, MABA, bridge adapter, or gas adapter exists because the protocol is single-chain EVM-only.

**Consequence:** The "DualVM" branding is misleading if interpreted as "assets flow between VMs." In reality:
- Collateral (WPAS) = native PAS wrapped into ERC-20 on the same chain
- Debt (USDCMock) = team-minted test token on the same chain
- There is zero cross-chain liquidity, zero bridged assets, zero VM-interop for asset transfer
- The PVM compilation pipeline compiles probe contracts but they don't participate in the lending flow

**Minimum viable fix:**
1. **Documentation honesty:** Clearly state "single-chain EVM lending with PVM risk computation" not "DualVM lending" in user-facing materials.
2. If the WPAS→collateral deposit flow is kept, add an atomic `wrapAndDeposit()` helper to reduce from 3 transactions to 1.
3. If real USDC integration is ever planned, 18 decimals must change to 6, which would break all existing positions and the ERC-4626 share math.

---

## Domain 8: Capital Efficiency and Live State Composability

### Cross-Contract State Reads Within a Single Block

**Can all contracts read each other's live state in a single block?** Yes, within a single transaction. The EVM executes synchronously, so:

- `LendingCore.healthFactor()` calls `oracle.priceWad()`, `oracle.isFresh()`, `oracle.lastUpdatedAt()`, `debtPool.outstandingPrincipal()`, and `riskEngine.quote()` — all within one `view` call. ✅
- `LendingCore.availableToBorrow()` reads the same set of external state. ✅
- `LendingCore.previewBorrow()` reads oracle + debtPool + riskEngine state. ✅
- `DebtPool.totalAssets()` reads its own `availableLiquidity()` + `outstandingPrincipal` — no cross-contract call needed. ✅
- `DebtPool.utilizationBps()` reads `outstandingPrincipal` and `totalAssets()` — internal only. ✅

**However**, cross-transaction state reads within the same block see **stale pre-execution state**. If tx₁ modifies `outstandingPrincipal` via `drawDebt`, tx₂ sees the updated value. But if tx₁ and tx₂ are constructed by different actors before the block is built, they both reference the state at the start of the block. This is standard EVM behavior, not a protocol bug.

### Worst-Case Latency for State Propagation

Within a single block: **0 latency** (synchronous EVM). The oracle price, risk quote, and pool state are all read atomically within a transaction.

Across blocks: **6 seconds** (block time). If the oracle price is updated in block N, any transaction in block N+1 sees it. With Elastic Scaling: **2 seconds**.

**The real latency bottleneck is the oracle.** The `ManualOracle.setPrice()` is an on-chain transaction gated by the RISK_ADMIN role through AccessManaged. If the admin wants to update the price, they must:
1. Submit an on-chain tx
2. If `riskAdminExecutionDelaySeconds > 0` (it's 60s in the canonical deployment), they need to schedule + execute through AccessManager's time delay mechanism

Wait — actually, checking the AccessManaged pattern: `setPrice()` has `restricted` modifier. Looking at the canonical manifest, `riskAdminExecutionDelaySeconds: 60`. This means the risk admin has a 60-second execution delay on role-gated functions. **But** — AccessManaged's `restricted` modifier with delays works via the `schedule()` pattern in AccessManager, which requires a prior `schedule()` call then a `wait-for-delay` then `execute`. For a 60-second delay, that means **oracle price updates have a 60-second minimum propagation time** from decision to on-chain effect.

### Oracle Freshness and 6-Hour Stale Tolerance

From the canonical manifest: `oracleMaxAgeSeconds: 21600` (6 hours).

`ManualOracle.isFresh()` returns `true` if:
- `priceWad != 0`
- `!paused()`
- `block.timestamp - lastUpdatedAt <= maxAge`

`ManualOracle.latestPriceWad()` reverts with `OraclePriceStale` if age > maxAge.

**What happens with 6-hour stale tolerance?**

The protocol has a **two-tier response** to staleness via the risk engine:

1. **Oracle age 0–30 minutes:** `PvmRiskEngine.quote()` uses `healthyMaxLtvBps` and `healthyLiquidationThresholdBps`
2. **Oracle age > 30 minutes:** `PvmRiskEngine.quote()` switches to `stressedMaxLtvBps` (6500 vs 7500) and `stressedLiquidationThresholdBps` (7800 vs 8500)
3. **Oracle age > 6 hours:** `latestPriceWad()` reverts → `borrow()` and `liquidate()` revert → protocol is effectively frozen

**BUT** — there's a critical subtlety in `_buildQuoteInput()` (LendingCore.sol):

```solidity
uint256 normalizedOracleAgeSeconds = 0;
if (state.oracleFresh && state.oracleAgeSeconds > 30 minutes) {
    normalizedOracleAgeSeconds = 30 minutes + 1;
}
```

This **normalizes** the oracle age to either 0 or 1801 seconds. The risk engine never sees the actual age — it only gets a binary "fresh" or "slightly stale" signal. The risk engine then checks `input.oracleAgeSeconds > 30 minutes` which triggers the stressed path. So the protocol has a **binary cliff at 30 minutes**, not a gradual degradation.

### Can the Protocol Operate on Stale Collateral Valuations?

**Yes, for up to 6 hours.**

- Between 0–30 minutes: full LTV, healthy parameters
- Between 30 minutes–6 hours: stressed LTV (reduced by ~1000 BPS), stressed liquidation threshold
- After 6 hours: full halt (reverts)

During the 30min–6hr window, the protocol allows:
- **Borrows** at reduced LTV (6500 BPS max instead of 7500 BPS)
- **Liquidations** with a tighter threshold (7800 BPS instead of 8500 BPS)
- **Repayments** always work (no oracle required for repay — `repay()` only reads oracle if remaining debt > 0, and even then it's wrapped in `if (fresh && price != 0)` which means **repay() works even with stale oracle**)
- **Withdrawals** call `_latestOraclePrice()` which calls `oracle.latestPriceWad()` which reverts if stale > 6hr

**Critical issue:** `withdrawCollateral()` and `borrow()` both call `_latestOraclePrice()` which goes through `latestPriceWad()` — this reverts on stale oracle. But `depositCollateral()` uses `_oracleSnapshot()` which goes through `oracle.priceWad()` (a simple storage read that doesn't revert on staleness) + `oracle.isFresh()`. So:

| Operation | Works with stale oracle (30min–6hr)? | Works with very stale oracle (>6hr)? |
|-----------|---------------------------------------|---------------------------------------|
| `depositCollateral()` | ✅ Yes (skips rate update if stale) | ✅ Yes |
| `withdrawCollateral()` | ✅ Yes (stressed params) | ❌ Reverts |
| `borrow()` | ✅ Yes (stressed params) | ❌ Reverts |
| `repay()` | ✅ Yes (skips rate update if stale) | ✅ Yes |
| `liquidate()` | ✅ Yes (stressed params) | ❌ Reverts |

**Under what conditions can stale valuations cause harm?**

If the real-world price of PAS drops 30% but the oracle hasn't been updated in 5 hours (still within the 6hr window), the protocol still allows:
- New borrows at the old (now dangerously high) price with stressed LTV
- Liquidations at the old price, meaning positions that should be liquidated at the new price are still considered healthy
- Existing positions that are actually underwater remain unliquidatable

With `maxPriceChangeBps: 2500` (25% max single update), even when the oracle admin tries to update, they can only move the price 25% per update. A 50% crash would require at minimum 2 sequential `setPrice()` calls.

### Verdict: SIGNIFICANT CONCERN

**Root cause:** 6-hour oracle staleness tolerance combined with binary (not graduated) risk parameter adjustment creates a wide window where the protocol operates on dangerously stale collateral valuations. The 25% max price change per update further delays catching up to reality.

**Consequence:**
1. A 30%+ price crash during a 5-hour oracle gap means the protocol extends credit against worthless collateral for hours.
2. The binary cliff at 30 minutes means there's no difference in protocol behavior between a 31-minute-old price and a 5-hour-59-minute-old price — both use the same stressed parameters.
3. Multiple `setPrice()` calls needed for large moves creates a cascading update problem where each intermediate price is itself potentially dangerous.
4. Bad debt accumulation is guaranteed in any scenario where the oracle admin is unavailable for >30 minutes during a significant price move.

**Minimum viable fix:**
1. **Reduce maxAge to 1 hour maximum** for a hackathon-grade manual oracle. 6 hours is dangerously long.
2. Implement **graduated risk degradation** — interpolate between healthy and stressed parameters based on actual oracle age, not a binary cliff.
3. Add a **price update cooldown bypass** for emergency scenarios — allow the emergency admin to bypass the 25% maxPriceChangeBps in extreme conditions (e.g., a "circuit breaker reset" that allows setting an arbitrary price after pausing).
4. Document the oracle gap risk explicitly: "If the admin is unreachable for 6 hours during a price crash, the protocol will accumulate bad debt proportional to the price movement."
