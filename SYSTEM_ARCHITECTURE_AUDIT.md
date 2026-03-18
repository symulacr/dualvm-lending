# DualVM Lending - Adversarial System Architecture Audit
### Date: 2026-03-18 | Auditor: Principal Systems Architect | Confidence: HIGH (code-verified)

---

## 1. COMPLETION MATRIX

| Domain                              | Status    | Evidence                                                                                  | Confidence |
|-------------------------------------|-----------|-------------------------------------------------------------------------------------------|------------|
| **Canonical Lending (EVM)**         | DONE      | 12 contracts deployed to testnet, 105 tests passing, full borrow/repay/liquidate cycle    | HIGH       |
| **ERC-4626 Debt Pool**              | DONE      | OZ 5.5 ERC4626 with supply cap, reserve accounting, inflation-attack mitigation via OZ    | HIGH       |
| **AccessManager RBAC**              | DONE      | DualVMAccessManager wraps OZ AccessManager, 5+ roles wired, timelock delays configured    | HIGH       |
| **Governor + Timelock**             | DONE      | DualVMGovernor + GovernorTimelockControl, voting delay/period, quorum fraction, deployed   | HIGH       |
| **Market Version Registry**         | DONE      | registerVersion/activateVersion with cross-contract validation, tested                     | HIGH       |
| **Market Migration Coordinator**    | DONE      | Borrower + liquidity migration across versions, tested with route open/close               | HIGH       |
| **Oracle (Manual)**                 | DONE      | Circuit breaker (min/max/delta), staleness rejection (maxAge), epoch tracking              | HIGH       |
| **Risk Model (Inline Math)**        | DONE      | Kinked-curve in RiskAdapter._inlineQuote(), stressed/healthy regimes, deterministic        | HIGH       |
| **Batch Liquidation**               | DONE      | batchLiquidate() with try/catch per position, tested                                       | HIGH       |
| **XCM weighMessage**                | DONE      | Proven on-chain: TX 0xc147ac14, refTime=979880000, proofSize=10943                        | HIGH       |
| **XCM execute**                     | DONE      | Proven on-chain: TX 0xea5ecc4b, ClearOrigin V5 message executed locally                   | HIGH       |
| **XCM send**                        | DONE      | Proven on-chain: TX 0x26d74cf7, ClearOrigin sent to relay chain parent (0x050100)          | HIGH       |
| **XCM Liquidation Notifier**        | DONE      | Proven on-chain: TX 0x172a6c92, V5 ClearOrigin to relay, LiquidationNotified event        | HIGH       |
| **EVM->PVM (Stage 1: Echo+Quote)**  | DONE      | Proven: DirectSync REVM->PVM echo + deterministic quote match on testnet                   | HIGH       |
| **PVM->EVM (Stage 2: Callback)**    | FAILED    | "execution reverted" - PVM callback to REVM receiver failed on live testnet                | HIGH       |
| **Roundtrip Settlement (Stage 3)**  | PARTIAL   | settleBorrow principalDebt=2140 vs expected 1070 (state pollution from repeated runs)      | HIGH       |
| **PVM Compilation (resolc)**        | PARTIAL   | PvmQuoteProbe deployed via resolc, but DeterministicRiskModel NOT compiled to PVM          | HIGH       |
| **Frontend Tabbed Layout**          | DONE      | 3 tabs (Lend&Borrow, Market Data, Protocol Info), action forms at position #1              | HIGH       |
| **Frontend Health Display**         | DONE      | 4-tier color coding (green/yellow/orange/red), liquidation price, Max buttons              | MEDIUM     |
| **Frontend Write Path**             | DONE      | deposit/borrow/repay/liquidate/supply/withdraw via wagmi+viem, TxStatusBanner              | MEDIUM     |
| **LendingRouter (1-click PAS)**     | PARTIAL   | Contract deposits to ROUTER's position, not USER's - by-design for MVP but unusable        | HIGH       |
| **Documentation**                   | DONE      | 10 Mermaid diagrams, failure modes, deployment guide, SPEC reduced to pointer              | HIGH       |
| **Postmortem Rebuttal**             | DONE      | 74% cut, added Rebuttal citing Dec 2025 Revive, Elastic Scaling, official dual-VM docs     | HIGH       |

### Legend
- **DONE**: Functional, tested, deployed where applicable
- **PARTIAL**: Exists but has known limitations or incorrect behavior
- **FAILED**: Attempted but does not work on live network
- **MISSING**: Not implemented at all

---

## 2. GAP ANALYSIS

### GAP-1: PVM->EVM Callback (Stage 2) is BROKEN
- **What remains**: PVM-initiated callbacks to REVM contracts revert on live testnet
- **Why it matters**: Without PVM->EVM, the "dual-VM" story is one-directional only. PVM can be called FROM EVM but cannot call BACK. This undermines the bidirectional composability claim.
- **Root cause**: PVM "preview release" (official Polkadot docs: "early-stage development, may be unstable"). The cross-VM callback ABI encoding or dispatch path is not yet stable.
- **Blockers**: Platform-level - Parity must stabilize PVM callback dispatch. Cannot be fixed at application level.
- **Required changes**: Wait for PVM stabilization, then re-run Stage 2 probes.
- **Assumptions**: We assume EVM->PVM (Stage 1) continues to work. If PVM preview changes break Stage 1 too, the entire dual-VM story collapses.
- **How to finish**: Re-deploy PvmCallbackProbe after next PVM SDK update, re-run `probe:pvm-to-revm:testnet`.

### GAP-2: DeterministicRiskModel is NOT PVM-compiled
- **What remains**: The renamed contract exists at `contracts/pvm/DeterministicRiskModel.sol` but is deployed via Hardhat to EVM, not via resolc to PVM.
- **Why it matters**: RiskAdapter's `_verifyCrossVM()` calls `quoteEngine.quote()` expecting a PVM-deployed contract. Currently the `quoteEngine` address (0x9a78F65b00E0AeD0830063eD0ea66a0B5d8876DE) points to the PvmQuoteProbe, not DeterministicRiskModel. The canonical deployment has a stale PVM target.
- **Root cause**: The M6 refactoring renamed PvmRiskEngine to DeterministicRiskModel but didn't recompile/redeploy it via resolc. The existing PvmQuoteProbe was left as the quoteEngine.
- **Blockers**: resolc compilation pipeline exists (`build:pvm` script) but hasn't been run for DeterministicRiskModel specifically.
- **Required changes**: (1) Compile DeterministicRiskModel with resolc, (2) Deploy to PVM, (3) Update canonical manifest with new quoteEngine address, (4) Redeploy RiskAdapter pointing to new PVM quoteEngine.
- **Assumptions**: resolc can compile DeterministicRiskModel without issues. The PVM deployment slot remains stable.
- **How to finish**: `npm run build:pvm` for DeterministicRiskModel, deploy via Hardhat PVM config, update manifest.

### GAP-3: LendingRouter credits ITSELF, not the USER
- **What remains**: `LendingRouter.depositCollateralFromPAS()` calls `lendingCore.depositCollateral(amount)` with `msg.sender = router`. The position is recorded for the router's address, not the user's.
- **Why it matters**: Users who use the 1-click PAS deposit lose their collateral to the router contract. There is no mechanism to withdraw or borrow against it. This is documented as "by-design for hackathon MVP" but renders the feature useless for actual lending.
- **Root cause**: `depositCollateral()` uses `msg.sender` to assign positions. A router contract becomes `msg.sender`.
- **Blockers**: Fixing requires either: (a) adding `depositCollateralFor(address user, uint256 amount)` to LendingCore, or (b) having the router hold proxy positions.
- **Required changes**: Add `depositCollateralFor()` to LendingCore that accepts a beneficiary address.
- **Assumptions**: AccessManaged restrictions on new LendingCore functions would need wiring.
- **How to finish**: Single function addition + router update + test.

### GAP-4: XCM messages are ClearOrigin ONLY
- **What remains**: All XCM demonstrations use `ClearOrigin` (opcode 0x0a) - the simplest possible instruction that carries no assets, no data, and no actionable payload.
- **Why it matters**: For a lending protocol, meaningful XCM would involve: cross-chain liquidation notifications with data, asset transfers, or remote execution of state changes. ClearOrigin proves the precompile works but demonstrates zero lending-specific cross-chain capability.
- **Root cause**: Building real XCM payloads requires SCALE-encoding complex instruction sequences (WithdrawAsset, BuyExecution, DepositAsset, Transact). The project chose demonstration over functionality.
- **Blockers**: SCALE encoding complexity, destination chain configuration, XCM fee estimation.
- **Required changes**: Build XCM messages with actual data payloads (e.g., embed liquidation data in SetTopic, or use Transact to call a remote contract).
- **Assumptions**: The relay chain parent accepts ClearOrigin but may reject more complex messages without proper fee payment.
- **How to finish**: Construct SCALE-encoded V5 messages with WithdrawAsset+BuyExecution+DepositAsset or Transact instructions, test on testnet.

### GAP-5: Oracle is Manual with 6-hour staleness window
- **What remains**: ManualOracle with `maxAge = 21600` seconds (6 hours). Price is set by a privileged `riskAdmin` address.
- **Why it matters**: A 6-hour staleness window in DeFi is extremely dangerous. At PAS volatility rates, a 6-hour-old price can be 10-30% wrong, enabling theft via over-borrowing or blocking legitimate liquidations.
- **Root cause**: Hackathon scope - no oracle network exists on Polkadot Hub TestNet.
- **Blockers**: No Chainlink/DIA/RedStone deployment on Polkadot Hub TestNet.
- **Required changes**: Reduce maxAge to 30-60 minutes for any non-demo deployment. Document the 6-hour window as a critical security gap.
- **Assumptions**: The hackathon judges understand this is a demo constraint.
- **How to finish**: Parameter change only (setMaxAge call via governance).

### GAP-6: Roundtrip Settlement state pollution
- **What remains**: Stage 3 probe shows principalDebt=2140 vs expected 1070 because the test was run multiple times on the same testnet state without resetting.
- **Why it matters**: Casts doubt on whether the REVM->PVM->REVM settlement actually works correctly, or if the EVM-only path produces the same result.
- **Root cause**: Non-idempotent test execution on persistent testnet state.
- **Blockers**: Would require fresh deployment or state reset to prove cleanly.
- **Required changes**: Redeploy probes from scratch, run exactly once, capture results.
- **How to finish**: Fresh probe deployment + single clean run.

### GAP-7: No integration between XCM contracts and lending protocol
- **What remains**: CrossChainQuoteEstimator and XcmLiquidationNotifier are standalone contracts with no connection to LendingCore. LendingCore never calls them.
- **Why it matters**: XCM is presented as a feature but is architecturally disconnected from the lending protocol. There's no automated cross-chain notification on liquidation events.
- **Root cause**: Scope decision - XCM was MVP-excluded per CLAUDE.md ("XCM is out of the MVP critical path").
- **Blockers**: Would require modifying liquidate() in LendingCore to call XcmLiquidationNotifier.
- **Required changes**: Add optional XCM notification hook to liquidation flow.
- **How to finish**: Add post-liquidation callback, wire XcmLiquidationNotifier address.

### GAP-8: Frontend Max buttons parse formatted strings
- **What remains**: Max buttons on Borrow/Repay forms auto-fill from observer state but may parse locale-formatted strings (with commas) instead of raw numeric values.
- **Root cause**: Observer returns formatted strings like "1,234.56 USDC-test", extraction may not strip formatting consistently.
- **Required changes**: Use raw bigint values from observer, format only for display.

---

## 3. CURRENT-STATE ARCHITECTURE

### 3.1 Contract Inventory (30 .sol files, 2739 total LOC)

| Contract                       | LOC | OZ Inheritance                                          | Deployed | Role       |
|--------------------------------|-----|---------------------------------------------------------|----------|------------|
| LendingCore                    | 772 | AccessManaged, Pausable, ReentrancyGuard                | YES      | Core       |
| RiskAdapter                    | 253 | AccessManaged, IRiskAdapter                              | YES      | Risk       |
| DebtPool                       | 204 | ERC4626, AccessManaged, Pausable, ReentrancyGuard       | YES      | Pool       |
| ManualOracle                   | 163 | AccessManaged, Pausable                                  | YES      | Oracle     |
| MarketMigrationCoordinator     | 110 | AccessManaged                                            | YES      | Migration  |
| DualVMGovernor                 | 100 | Governor, Counting, Votes, Quorum, TimelockControl       | YES      | Governance |
| MarketVersionRegistry          | 97  | AccessManaged                                            | YES      | Registry   |
| DeterministicRiskModel         | 87  | IRiskEngine (stateless)                                  | YES(EVM) | PVM Target |
| CrossChainQuoteEstimator       | 87  | None (uses IXcm precompile)                              | YES      | XCM Demo   |
| XcmLiquidationNotifier         | 82  | None (uses IXcm precompile)                              | YES      | XCM Demo   |
| LendingRouter                  | 64  | ReentrancyGuard                                          | YES      | UX Helper  |
| WPAS                           | 41  | (custom WETH-style)                                      | YES      | Wrapper    |
| USDCMock                       | 17  | (ERC20 mock)                                             | YES      | Mock Asset |
| DualVMAccessManager            | 8   | AccessManager                                            | YES      | RBAC       |
| GovernanceToken                | 39  | ERC20, ERC20Permit, ERC20Votes                           | YES      | Governance |
| + 6 Probe contracts            | ~350| Various                                                  | YES      | Probe/Test |
| + 4 Interface files            | ~130| N/A                                                      | N/A      | Interface  |
| + 2 Test helper contracts      | ~97 | N/A                                                      | N/A      | Test Only  |

### 3.2 OpenZeppelin Usage Inventory (v5.5.0)

| OZ Module                            | Used By                            | Purpose                              |
|--------------------------------------|-------------------------------------|--------------------------------------|
| AccessManager                        | DualVMAccessManager                 | Central RBAC authority                |
| AccessManaged                        | LendingCore, RiskAdapter, DebtPool, ManualOracle, MarketVersionRegistry, MarketMigrationCoordinator | Role-gated function calls |
| ERC4626                              | DebtPool                            | Tokenized lending pool               |
| ERC20, ERC20Permit, ERC20Votes       | GovernanceToken                     | Governance token with delegation     |
| Governor + extensions                | DualVMGovernor                      | On-chain governance                  |
| TimelockController                   | Via GovernorTimelockControl          | Execution delay                      |
| Pausable                             | LendingCore, DebtPool, ManualOracle | Emergency pause                      |
| ReentrancyGuard                      | LendingCore, DebtPool, LendingRouter| Reentrancy protection               |
| SafeERC20                            | LendingCore, DebtPool, MarketMigrationCoordinator | Safe token transfers   |
| Math                                 | DebtPool                            | Min calculations for liquidity       |

### 3.3 Access Control Role Graph

```
DualVMAccessManager (0x32d0...c2f0)
├── ADMIN_ROLE
│   └── governanceTimelock (0x6571...) — 3600s admin delay
├── EMERGENCY_ADMIN_ROLE  
│   └── deployer (0x5198...) — 0s delay
│   └── Targets: LendingCore.pause(), DebtPool.pause(), ManualOracle.pause()
├── RISK_ADMIN_ROLE
│   └── riskAdmin (0xE6E5...) — 60s delay
│   └── Targets: ManualOracle.setPrice/setMaxAge/setCircuitBreaker
├── TREASURY_ROLE
│   └── treasury (0x5198...) — 60s delay
│   └── Targets: DebtPool.claimReserves()
├── MINTER_ROLE
│   └── minter (0x26fd...) — 60s delay  
│   └── Targets: USDCMock.mint()
├── LENDING_CORE_ROLE (ID 7)
│   └── LendingCore (0x9faC...) 
│   └── Targets: RiskAdapter.quoteViaTicket()
└── VERSION_MANAGER_ROLE
    └── governanceTimelock
    └── Targets: MarketVersionRegistry.registerVersion/activateVersion
```

### 3.4 Inter-Contract Call Graph

```
User TX
  │
  ├──► LendingCore.borrow()
  │      ├──► ManualOracle.latestPriceWad()     [view]
  │      ├──► ManualOracle.isFresh()             [view]
  │      ├──► ManualOracle.lastUpdatedAt()       [view]
  │      ├──► ManualOracle.oracleEpoch()         [view]
  │      ├──► ManualOracle.currentStateHash()    [view]
  │      ├──► RiskAdapter.quoteViaTicket()       [restricted, state-changing]
  │      │      ├──► _inlineQuote() [internal, pure math]
  │      │      └──► quoteEngine.quote() [optional PVM cross-VM, try/catch]
  │      ├──► DebtPool.outstandingPrincipal()    [view]
  │      ├──► DebtPool.totalAssets()             [view]
  │      └──► DebtPool.drawDebt()               [state-changing]
  │
  ├──► LendingCore.liquidate()
  │      ├──► [same oracle/risk reads as borrow]
  │      ├──► IERC20.safeTransferFrom(liquidator) [debt repayment]
  │      ├──► DebtPool.recordRepayment()
  │      ├──► IERC20.safeTransfer(liquidator)     [collateral seizure]
  │      └──► DebtPool.recordLoss()              [bad debt case]
  │      └──► [NO call to XcmLiquidationNotifier] ◄── GAP-7
  │
  └──► LendingRouter.depositCollateralFromPAS()
         ├──► WPAS.deposit{value}()
         ├──► WPAS.forceApprove(lendingCore)
         └──► LendingCore.depositCollateral()    [position = router, NOT user] ◄── GAP-3

STANDALONE (not connected to lending):
  CrossChainQuoteEstimator ──► IXcm.weighMessage/execute/send
  XcmLiquidationNotifier   ──► IXcm.send
```

### 3.5 External Call Count Per Core Function

| Function                         | External Calls | State Writes | View Reads |
|----------------------------------|---------------|--------------|------------|
| borrow()                         | 3 writes      | 3            | 8 views    |
| liquidate()                      | 3 writes      | 3            | 8 views    |
| batchLiquidate(n)                | 3n writes     | 3n           | 8n views   |
| repay()                          | 2 writes      | 2            | ~6 views   |
| depositCollateral()              | 1 write       | 1            | ~6 views   |
| withdrawCollateral()             | 1 write       | 1            | ~8 views   |

### 3.6 Data Flow: Blockchain -> Frontend -> User

```
Polkadot Hub TestNet (chain ID 420420417)
    │
    ├──► viem PublicClient (via eth-rpc-testnet.polkadot.io)
    │       │
    │       ├──► readContract(lendingCore, "currentDebt")
    │       ├──► readContract(lendingCore, "availableToBorrow")
    │       ├──► readContract(lendingCore, "healthFactor")
    │       ├──► readContract(lendingCore, "positions")
    │       ├──► readContract(lendingCore, "maxConfiguredLiquidationThresholdBps")
    │       ├──► readContract(debtPool, "totalAssets/utilizationBps/...")
    │       └──► readContract(oracle, "priceWad/isFresh/...")
    │
    ├──► observer.ts: loadObserverSnapshot()
    │       └──► Computes: healthFactorNumeric, liquidationPrice, formatted amounts
    │
    ├──► marketSnapshot.ts: loadMarketSnapshot()
    │       └──► Aggregates: pool stats, oracle data, observer data, recent activity
    │
    └──► App.tsx (React 18 + wagmi 2 + viem 2 + RainbowKit)
            ├── TabNav: [Lend&Borrow | Market Data | Protocol Info]
            ├── Lend&Borrow tab:
            │     ├── CompactMarketSnapshot (TVL, utilization, price)
            │     ├── WritePathSection (deposit/borrow/repay/liquidate/supply/withdraw forms)
            │     └── ObserverSection (position viewer, health factor display)
            ├── Market Data tab:
            │     ├── ReadLayerSection (pool metrics)
            │     ├── RecentActivitySection (event log)
            │     └── AssetPathSection (asset registry)
            └── Protocol Info tab:
                  ├── HeroSection, OverviewSections
                  ├── ManifestSection (contract addresses)
                  ├── SecuritySection, DemoFlowSection
```

---

## 4. UNICODE/ASCII SYSTEM BOARD

```
╔══════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                         DualVM Lending — Current-State System Board (2026-03-18)                       ║
╠══════════════════════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                                        ║
║  ┌─────────────────────────────── FRONTEND (Vite + React 18) ────────────────────────────────────┐     ║
║  │  wagmi 2.19 + viem 2.37 + RainbowKit 2.2                                                      │     ║
║  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                                         │     ║
║  │  │ Lend & Borrow│  │ Market Data  │  │ Protocol Info│                                         │     ║
║  │  │  (default)   │  │              │  │              │                                         │     ║
║  │  │ ┌──────────┐ │  │ ReadLayer    │  │ HeroSection  │                                         │     ║
║  │  │ │Snapshot  │ │  │ RecentAct.   │  │ Manifest     │                                         │     ║
║  │  │ │TVL|Util% │ │  │ AssetPaths   │  │ Security     │                                         │     ║
║  │  │ └──────────┘ │  │              │  │ DemoFlow     │                                         │     ║
║  │  │ ┌──────────┐ │  └──────────────┘  └──────────────┘                                         │     ║
║  │  │ │WritePath │ │  TxHistoryList (global, above tabs)                                          │     ║
║  │  │ │Deposit   │ │                                                                              │     ║
║  │  │ │Borrow    │ │  observer.ts ──── loadObserverSnapshot() ──► healthFactor, liquidationPrice  │     ║
║  │  │ │Repay     │ │  marketSnapshot.ts ──── loadMarketSnapshot() ──► pool stats, oracle, events  │     ║
║  │  │ │Liquidate │ │                                                                              │     ║
║  │  │ │Supply    │ │                                                                              │     ║
║  │  │ │Withdraw  │ │                                                                              │     ║
║  │  │ └──────────┘ │                                                                              │     ║
║  │  │ ┌──────────┐ │                                                                              │     ║
║  │  │ │Observer  │ │                                                                              │     ║
║  │  │ │HealthFx  │ │  Color: ■ green(>2.0)  ■ yellow(1.5-2.0)  ■ orange(1.0-1.5)  ■ red(<1.0)   │     ║
║  │  │ │LiqPrice  │ │                                                                              │     ║
║  │  │ │Max btns  │ │                                                                              │     ║
║  │  │ └──────────┘ │                                                                              │     ║
║  │  └──────────────┘                                                                              │     ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘     ║
║                           │ JSON-RPC (eth-rpc-testnet.polkadot.io)                                     ║
║                           ▼                                                                            ║
║  ┌──────────────────── POLKADOT HUB TESTNET (Chain 420420417) ──────────────────────────────────┐     ║
║  │                                                                                                │     ║
║  │   ┌──────────── REVM (EVM-compatible) ─────────────────────────────────────────────────┐      │     ║
║  │   │                                                                                     │      │     ║
║  │   │  ╔═══════════════════╗     ╔════════════════════╗     ╔══════════════════╗          │      │     ║
║  │   │  ║ DualVMAccessMgr   ║────►║ ManualOracle       ║     ║ GovernanceToken   ║          │      │     ║
║  │   │  ║ (OZ AccessManager)║     ║ price, staleness,  ║     ║ ERC20Votes        ║          │      │     ║
║  │   │  ║ 5+ roles, delays  ║     ║ circuit breaker    ║     ╚════════╤═════════╝          │      │     ║
║  │   │  ╚═══════╤═══════════╝     ║ maxAge=6h ⚠       ║              │                     │      │     ║
║  │   │          │                  ╚════════╤═══════════╝     ╔═══════▼══════════╗          │      │     ║
║  │   │          │                           │                 ║ DualVMGovernor   ║          │      │     ║
║  │   │          ▼                           │                 ║ + TimelockCtrl   ║          │      │     ║
║  │   │  ╔═══════════════════╗               │                 ╚══════════════════╝          │      │     ║
║  │   │  ║   LendingCore     ║◄──────────────┘                                              │      │     ║
║  │   │  ║ borrow/repay/liq  ║                                                               │      │     ║
║  │   │  ║ batch liquidate   ║──────────────────────►╔══════════════════╗                    │      │     ║
║  │   │  ║ AccessManaged     ║                       ║   RiskAdapter     ║                    │      │     ║
║  │   │  ║ Pausable, ReGuard ║                       ║ INLINE kinked    ║                    │      │     ║
║  │   │  ╚═══════╤═══════════╝                       ║ curve = CANONICAL║                    │      │     ║
║  │   │          │                                    ║ + optional PVM   ║───┐                │      │     ║
║  │   │          │                                    ║ verify (try/catch)║  │                │      │     ║
║  │   │          ▼                                    ╚══════════════════╝  │                │      │     ║
║  │   │  ╔═══════════════════╗                                              │ quoteEngine    │      │     ║
║  │   │  ║   DebtPool        ║     ╔══════════════════╗                     │ .quote()       │      │     ║
║  │   │  ║ ERC-4626 vault    ║     ║  LendingRouter   ║                     │ (optional)     │      │     ║
║  │   │  ║ supply cap, resv  ║     ║ PAS→WPAS→deposit ║                     │                │      │     ║
║  │   │  ║ liq tracking      ║     ║ ⚠ credits SELF   ║                     │                │      │     ║
║  │   │  ╚═══════════════════╝     ╚══════════════════╝                     │                │      │     ║
║  │   │                                                                      │                │      │     ║
║  │   │  ╔══════════════════════╗  ╔══════════════════════╗                  │                │      │     ║
║  │   │  ║ MarketVersionReg     ║  ║ MigrationCoordinator ║                  │                │      │     ║
║  │   │  ║ register/activate    ║  ║ borrower+liquidity   ║                  │                │      │     ║
║  │   │  ╚══════════════════════╝  ╚══════════════════════╝                  │                │      │     ║
║  │   │                                                                      │                │      │     ║
║  │   │  ╔══════════════════════╗  ╔══════════════════════╗                  │                │      │     ║
║  │   │  ║ WPAS (wrapper)       ║  ║ USDCMock (ERC20)     ║                  │                │      │     ║
║  │   │  ╚══════════════════════╝  ╚══════════════════════╝                  │                │      │     ║
║  │   │                                                                      │                │      │     ║
║  │   │  ┌─── XCM STANDALONE (not connected to lending) ─────────────────┐  │                │      │     ║
║  │   │  │ CrossChainQuoteEstimator ──► IXcm @ 0x...A0000                │  │                │      │     ║
║  │   │  │   weighMessage ✓  execute ✓  send ✓  (all ClearOrigin only)   │  │                │      │     ║
║  │   │  │ XcmLiquidationNotifier ──► IXcm.send (ClearOrigin to relay)   │  │                │      │     ║
║  │   │  │   ⚠ NO integration with LendingCore.liquidate()              │  │                │      │     ║
║  │   │  └───────────────────────────────────────────────────────────────┘  │                │      │     ║
║  │   └─────────────────────────────────────────────────────────────────────┘                │      │     ║
║  │                                                                          │                │      │     ║
║  │   ┌──────────── PVM (PolkaVM / RISC-V) ─── "Preview Release" ──────────┘                │      │     ║
║  │   │                                                                                      │      │     ║
║  │   │  ╔══════════════════════╗                                                            │      │     ║
║  │   │  ║ PvmQuoteProbe        ║ ◄── resolc compiled, deployed via revive                   │      │     ║
║  │   │  ║ (=quoteEngine target)║     Stage 1: EVM→PVM echo+quote ✓                         │      │     ║
║  │   │  ╚══════════════════════╝     Stage 2: PVM→EVM callback   ✗ BROKEN                  │      │     ║
║  │   │                               Stage 3: Roundtrip settle   ~ PARTIAL (state polluted) │      │     ║
║  │   │                                                                                      │      │     ║
║  │   │  ╔══════════════════════╗                                                            │      │     ║
║  │   │  ║ PvmCallbackProbe     ║ ◄── deployed but callbacks revert on live testnet          │      │     ║
║  │   │  ╚══════════════════════╝                                                            │      │     ║
║  │   │                                                                                      │      │     ║
║  │   │  DeterministicRiskModel: EXISTS as .sol but NOT compiled to PVM ⚠                   │      │     ║
║  │   └──────────────────────────────────────────────────────────────────────────────────────┘      │     ║
║  │                                                                                                │      ║
║  │   ┌──────────── XCM PRECOMPILE @ 0x...A0000 ───────────────────────────────────────────┐      │     ║
║  │   │  weighMessage(bytes) → Weight    ✓ proven (refTime=979880000)                       │      │     ║
║  │   │  execute(bytes, Weight)          ✓ proven (ClearOrigin V5)                          │      │     ║
║  │   │  send(bytes dest, bytes msg)     ✓ proven (ClearOrigin to relay parent 0x050100)    │      │     ║
║  │   │                                                                                     │      │     ║
║  │   │  Destination used: 0x050100 = V5 Location{parents:1, Here} = relay chain            │      │     ║
║  │   │  Message used: 0x05040a = V5 Vec<1> ClearOrigin                                     │      │     ║
║  │   │  ⚠ No real cross-chain data transfer demonstrated                                  │      │     ║
║  │   └─────────────────────────────────────────────────────────────────────────────────────┘      │     ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘     ║
║                                                                                                        ║
║  ┌──────────── DEPLOYMENT STATE ──────────────────────────────────────────────────────────────────┐    ║
║  │  12 core contracts + 2 XCM contracts + 5 probe contracts = 19 deployed                         │    ║
║  │  Canonical manifest: polkadot-hub-testnet-canonical.json                                       │    ║
║  │  XCM manifest: polkadot-hub-testnet-xcm-full-integration.json                                  │    ║
║  │  Probe results: polkadot-hub-testnet-probe-results.json                                        │    ║
║  │  Deployment scripts: deploy.ts (~25-40 TXs), deployGoverned.ts, deployXcmFullIntegration.ts    │    ║
║  │  ⚠ Non-idempotent: no resume capability, hardcoded deployment order                           │    ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘    ║
║                                                                                                        ║
║  ┌──────────── TEST SUITE ────────────────────────────────────────────────────────────────────────┐    ║
║  │  21 test files | 105 tests passing | 3947 total LOC in tests                                   │    ║
║  │  Coverage: LendingCore ✓, RiskAdapter ✓, DebtPool ✓, Governor ✓, Migration ✓                  │    ║
║  │  XCM tests: mock-only (precompile not present in Hardhat)                                      │    ║
║  │  Probe tests: mock-only (cross-VM not available locally)                                       │    ║
║  │  ⚠ No fork tests, no integration tests against live RPC                                       │    ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘    ║
║                                                                                                        ║
║  ┌──────────── DOCUMENTATION ─────────────────────────────────────────────────────────────────────┐    ║
║  │  README.md: 10 Mermaid diagrams, failure modes, deployment guide, market params                │    ║
║  │  SPEC.md: 122 words (pointer to README)                                                        │    ║
║  │  Postmortem: 1687 words with Rebuttal section                                                  │    ║
║  │  CLAUDE.md: Locked decisions, security guardrails, submission posture                          │    ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
```

---

## 5. CAPABILITY REDUCTIONS, BOTTLENECKS, LIMITS, RISKS

### 5.1 Throughput Bottleneck Analysis

| Operation       | External calls/TX | Gas estimate | Max TPS @ 6s blocks | Max TPS @ 2s blocks (Elastic) |
|-----------------|-------------------|-------------|---------------------|-------------------------------|
| borrow()        | ~11 (8 view + 3 write) | ~300-500k | ~3-5 borrows/block | ~9-15 borrows/block |
| liquidate()     | ~11 (8 view + 3 write) | ~350-550k | ~3-5 liquidations/block | ~9-15/block |
| batchLiquidate(10) | ~110 | ~3-5M | ~1 batch/block | ~3 batches/block |
| repay()         | ~8 (6 view + 2 write) | ~200-350k | ~5-8/block | ~15-24/block |
| deposit()       | ~7 (6 view + 1 write) | ~150-250k | ~7-10/block | ~21-30/block |

**Verdict**: At 6s blocks, maximum sustained throughput is ~5-8 borrow TPS. With Elastic Scaling (2s blocks), ~15-24. This is adequate for a single-market testnet demo but would not support production DeFi volumes.

### 5.2 Security Risk Matrix

| Risk                               | Severity | Probability | Impact  | Mitigation                           |
|------------------------------------|----------|-------------|---------|--------------------------------------|
| Oracle staleness (6h maxAge)       | CRITICAL | HIGH        | Funds   | Reduce to 30min; add external oracle |
| LendingRouter credits self         | HIGH     | CERTAIN     | UX/Fund | Add depositCollateralFor()           |
| No liquidation incentive bot       | MEDIUM   | HIGH        | Bad debt| Deploy keeper/bot infrastructure     |
| PVM callback failure               | LOW      | CERTAIN     | Demo    | Platform-level; cannot fix           |
| Manual oracle price manipulation   | MEDIUM   | MEDIUM      | Funds   | Circuit breaker limits delta to 25%  |
| ERC-4626 inflation attack          | LOW      | LOW         | Funds   | OZ 5.5 mitigation in place           |
| Reentrancy on liquidation          | LOW      | LOW         | Funds   | ReentrancyGuard on all write paths   |
| Batch liquidation gas limit        | MEDIUM   | MEDIUM      | Liveness| Limit batch size to ~10              |

### 5.3 Blast Radius Analysis

| Component Failure       | Blast Radius                                              | Recovery Time |
|------------------------|-----------------------------------------------------------|---------------|
| Oracle goes stale       | All borrows blocked, liquidations may be blocked           | Minutes (admin setPrice) |
| Oracle paused           | All borrows blocked, positions frozen                      | Minutes (admin unpause) |
| RPC endpoint down       | Frontend shows stale data, all TXs fail                    | External dependency |
| PVM becomes unavailable | Inline math continues (canonical), CrossVMDivergence emitted | Zero (by design) |
| AccessManager admin key | Complete protocol takeover possible                        | Governance proposal |
| DebtPool drained        | All borrows fail, withdrawals blocked for over-utilized pool | Requires injection |

### 5.4 Post-Mission Impact Assessment

**What works for hackathon demo**:
- Full lending cycle (deposit, borrow, repay, liquidate) on live testnet
- Governance lifecycle (propose, vote, queue, execute) tested
- XCM precompile interaction proven with on-chain TX hashes
- EVM->PVM cross-VM call proven (Stage 1)
- 10 Mermaid architecture diagrams
- 105 automated tests
- Honest documentation with rebuttal of overclaimed flaws

**What does NOT work for production**:
- PVM->EVM callback (platform-level blocker)
- XCM is isolated from lending (no automated notifications)
- Manual oracle with 6h staleness
- LendingRouter positions owned by router
- No liquidation bot/keeper
- No monitoring/alerting
- No price feed redundancy
- Non-idempotent deployment

---

## 6. TOP 10 BLOCKERS (Ranked by Impact)

| # | Blocker | Severity | Fixable? | Effort | Impact on Submission |
|---|---------|----------|----------|--------|---------------------|
| 1 | PVM->EVM callback broken (Stage 2) | HIGH | NO (platform) | N/A | Undermines bidirectional dual-VM claim |
| 2 | DeterministicRiskModel not PVM-compiled | HIGH | YES | 2-4h | quoteEngine points to probe, not production model |
| 3 | XCM disconnected from lending | MEDIUM | YES | 4-6h | "XCM integration" is standalone demo only |
| 4 | LendingRouter credits self | MEDIUM | YES | 2-3h | 1-click UX is non-functional for users |
| 5 | Oracle maxAge=6h | MEDIUM | YES | 30min | Security concern for judges reviewing config |
| 6 | XCM messages are ClearOrigin only | MEDIUM | YES | 4-8h | No meaningful cross-chain data transfer |
| 7 | Roundtrip settlement state polluted | LOW | YES | 1-2h | Probe results look questionable |
| 8 | Max buttons parse formatted strings | LOW | YES | 1h | UX bug on Borrow/Repay forms |
| 9 | No fork/integration tests | LOW | YES | 4-8h | Test suite doesn't cover live network behavior |
| 10 | README System Overview diagram stale | LOW | YES | 30min | Lines 45/52 still say PvmQuoteProbe |

---

## 7. GO / NO-GO VERDICT

### FOR HACKATHON SUBMISSION: **GO** (with caveats)

**Strengths**:
- Fully functional single-market lending protocol on live testnet
- Genuine OZ integration (AccessManager, ERC-4626, Governor, TimelockControl, Pausable, ReentrancyGuard, SafeERC20)
- Proven EVM->PVM cross-VM call (Stage 1) — real, not mocked
- Proven XCM precompile usage (all 3 functions) with on-chain TX hashes
- 105 tests, 10 Mermaid diagrams, honest documentation
- Market versioning + migration system (advanced feature for hackathon)
- Governance lifecycle with timelock and role separation

**Caveats that MUST be disclosed**:
1. PVM->EVM direction does not work (platform preview limitation)
2. XCM demonstration is ClearOrigin-only and disconnected from lending
3. LendingRouter 1-click deposits are non-functional for users
4. Oracle is manual with 6-hour staleness (demo only)
5. DeterministicRiskModel runs on EVM, not PVM

**Recommended disclosures for judges**:
- "Dual-VM: EVM->PVM verified on testnet; PVM->EVM blocked by PVM preview status"
- "XCM: All 3 precompile functions proven; integration with lending is architectural, not automated"
- "Oracle: Manual price feed for testnet demo; production would require oracle network"

### FOR PRODUCTION: **NO-GO**

Missing: real oracle, liquidation bot, audit, PVM stability, monitoring, multi-sig admin, deployment idempotency, XCM fee estimation, error recovery.

---

## METHODOLOGY & CONFIDENCE

**Sources**: Every claim in this document was verified by reading the actual source code, deployment manifests, and test files. No claims are based on documentation or comments alone.

**Verification**: 105 tests passing confirmed at time of audit. Deployment addresses verified against canonical manifest. XCM TX hashes verified against xcm-full-integration manifest.

**Limitations**: I did not execute live RPC calls to verify deployed contract state. Frontend UX claims are based on code reading, not browser testing. PVM probe results are from the project's own proof collection, not independently reproduced.
