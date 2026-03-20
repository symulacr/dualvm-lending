# Faucet Mesh Architecture Report

## 1. Current Contract Graph

### Deployed Contracts (from deploy-manifest.json)

| Contract | Address | Role |
|---|---|---|
| AccessManager | `0xc126951a...` | Governance root, role manager |
| WPAS | `0x5e18c770...` | Wrapped PAS (ERC-20, no access control) |
| USDCMock | `0x2d7e6057...` | Mock USDC-test (mint restricted by ROLE_MINTER) |
| ManualOracle | `0xfe5636f2...` | Price oracle (setPrice restricted by ROLE_RISK_ADMIN) |
| GovernancePolicyStore | `0x0c8c0c8e...` | Risk policy overrides |
| RiskGateway | `0x5c66f69a...` | Unified risk engine (PVM primary + REVM fallback) |
| DebtPool | `0xff42db4e...` | ERC-4626 vault for USDC liquidity |
| LendingEngine | `0x11bf643d...` | Core lending market |
| LendingRouter | `0x1b86e010...` | PAS→WPAS→collateral convenience router |
| LiquidationHookRegistry | `0xddb390a3...` | Post-liquidation hooks |
| GovernanceToken | `0xfb99fea8...` | Voting token (dvGOV) |
| TimelockController | `0x7b8f6f36...` | Governance execution queue |
| DualVMGovernor | `0x27918831...` | On-chain governance |

### Call Graph (who calls who)

```
User/EOA
  ├─→ WPAS.deposit{value}()              [permissionless — wraps PAS]
  ├─→ LendingEngine.depositCollateral()   [permissionless — needs WPAS approval]
  ├─→ LendingEngine.borrow()              [permissionless — needs collateral]
  ├─→ LendingEngine.repay()               [permissionless — needs USDC approval]
  ├─→ LendingEngine.liquidate()           [permissionless]
  ├─→ DebtPool.deposit()/mint()           [permissionless — supplies USDC liquidity]
  └─→ LendingRouter.depositCollateralFromPAS{value}()  [permissionless]

LendingRouter (ROLE_ROUTER)
  ├─→ WPAS.deposit{value}()              [wraps PAS to WPAS]
  ├─→ WPAS.forceApprove(lendingEngine)   [approves engine to pull WPAS]
  └─→ LendingEngine.depositCollateralFor(beneficiary)  [restricted to ROLE_ROUTER]

LendingEngine (ROLE_LENDING_CORE)
  ├─→ WPAS.safeTransferFrom()            [pulls collateral from user/router]
  ├─→ DebtPool.drawDebt(borrower, amount) [sends USDC to borrower - onlyLendingCore]
  ├─→ DebtPool.recordRepayment()          [onlyLendingCore]
  ├─→ DebtPool.recordLoss()              [onlyLendingCore]
  ├─→ RiskGateway.quoteViaTicket()        [restricted to ROLE_LENDING_CORE]
  ├─→ ManualOracle (read-only)            [priceWad, isFresh, lastUpdatedAt]
  └─→ LiquidationHookRegistry.notifyLiquidation()  [post-liquidation hook]

DebtPool
  ├─→ USDCMock (ERC-4626 underlying)     [holds USDC liquidity]
  └─→ USDC.safeTransfer()                [sends USDC to borrowers via drawDebt]

TimelockController (has ALL governance roles)
  ├─→ AccessManager.grantRole()           [ADMIN_ROLE — sole admin after deploy]
  ├─→ USDCMock.mint()                     [ROLE_MINTER]
  ├─→ ManualOracle.setPrice()             [ROLE_RISK_ADMIN]
  └─→ [all restricted functions]          [via governance proposal flow]
```

### Approval Graph (who approves what)

```
User must approve:
  WPAS → LendingEngine   (before depositCollateral)
  USDC → LendingEngine   (before repay)
  USDC → DebtPool         (before deposit/mint liquidity)

LendingRouter internally approves:
  WPAS → LendingEngine   (during depositCollateralFromPAS)
```

## 2. Token Flow Diagrams

### Flow A: PAS → Collateral → Borrow

```
[User has PAS]
    │
    ▼ (send PAS)
[WPAS.deposit{value}()] ──→ User receives WPAS tokens
    │
    ▼ (approve WPAS to LendingEngine)
[WPAS.approve(lendingEngine, amount)]
    │
    ▼
[LendingEngine.depositCollateral(amount)]
    │  ├─ WPAS transferred from User → LendingEngine
    │  └─ User's position.collateralAmount += amount
    │
    ▼
[LendingEngine.borrow(amount)]
    │  ├─ Checks: oracle fresh, LTV safe, borrow cap, min borrow
    │  ├─ RiskGateway.quoteViaTicket() → borrowRate, maxLTV
    │  ├─ DebtPool.drawDebt(user, amount) → USDC sent to User
    │  └─ User's position.principalDebt += amount
    │
    ▼
[User has USDC-test]
```

### Flow A' (via Router): PAS → Collateral in one tx

```
[User has PAS]
    │
    ▼ (send PAS with call)
[LendingRouter.depositCollateralFromPAS{value}()]
    │  ├─ WPAS.deposit{value}() → Router gets WPAS
    │  ├─ WPAS.forceApprove(lendingEngine, amount)
    │  └─ LendingEngine.depositCollateralFor(user, amount)
    │       └─ WPAS transferred Router → LendingEngine
    │          User's position credited
    ▼
[User has collateral deposited, can borrow]
```

### Flow B: USDC → Debt Pool → Available for borrows

```
[Liquidity Provider has USDC-test]
    │
    ▼ (approve USDC to DebtPool)
[USDCMock.approve(debtPool, amount)]
    │
    ▼
[DebtPool.deposit(amount, receiver)]
    │  ├─ USDC transferred LP → DebtPool
    │  ├─ LP receives dvUSDC shares (ERC-4626)
    │  └─ Pool's totalAssets increases → borrowers can draw
    │
    ▼
[USDC available as liquidity for borrows]
```

### Flow C: Repayment

```
[Borrower has USDC-test]
    │
    ▼ (approve USDC to DebtPool via LendingEngine)
[USDCMock.approve(lendingEngine_address, amount)]
    │
    ▼
[LendingEngine.repay(amount)]
    │  ├─ USDC transferred User → DebtPool
    │  ├─ Interest portion: partially → reserveBalance
    │  ├─ Principal portion: reduces outstandingPrincipal
    │  └─ User's debt decreases
    ▼
[User debt reduced]
```

## 3. AccessManager Role Map

| Role ID | Label | Current Holder | Delay | Purpose |
|---|---|---|---|---|
| 0 (ADMIN) | ADMIN | TimelockController | — | Can grant/revoke roles, set target functions |
| 1 | EMERGENCY | TimelockController | 0 | pause/unpause LendingEngine, DebtPool, Oracle; freezeNewDebt |
| 2 | RISK_ADMIN | TimelockController | 0 | oracle setPrice/setMaxAge/setCircuitBreaker; policy store set/remove |
| 3 | TREASURY | TimelockController | 0 | DebtPool.claimReserves() |
| 4 | MINTER | TimelockController | 0 | USDCMock.mint(), GovernanceToken.mint() |
| 5 | GOVERNANCE | TimelockController | 0 | LiquidationHookRegistry, MarketVersionRegistry |
| 6 | MIGRATION | TimelockController + Coordinator | 0 | LendingEngine export/import, migration routes |
| 7 | LENDING_CORE | LendingEngine | 0 | RiskGateway.quoteViaTicket() |
| 8 | ROUTER | LendingRouter | 0 | LendingEngine.depositCollateralFor() |
| 9 | RELAY_CALLER | TimelockController | 0 | XcmInbox.receiveReceipt() |

**CRITICAL: The deployer has renounced ADMIN_ROLE.** The TimelockController is the sole admin. Granting new roles requires a governance proposal → vote → queue → execute flow (60-second timelock delay).

## 4. What the Faucet Needs

### Minimum Permissions (Simple Faucet - USDC only)
- **ROLE_MINTER (4)** on AccessManager → to call `USDCMock.mint(to, amount)`

### Full Mesh Permissions
- **ROLE_MINTER (4)** → mint USDC-test to users and to itself (for pool seeding)
- **ROLE_ROUTER (8)** → call `LendingEngine.depositCollateralFor(beneficiary, amount)` to deposit collateral on behalf of users

### What does NOT need permissions
- **WPAS wrapping**: Anyone can call `WPAS.deposit{value}()` - permissionless
- **DebtPool deposit**: Anyone can call `DebtPool.deposit(amount, receiver)` - permissionless (just needs USDC + approval)
- **Oracle refresh**: NOT recommended for faucet (ROLE_RISK_ADMIN is too powerful)

## 5. Redeployment Assessment

### Option A: No redeployment — Governance grant (COMPLEX)
Since the deployer renounced admin, granting ROLE_MINTER and ROLE_ROUTER to a new faucet contract requires:
1. Deploy faucet contract
2. Create governance proposal: `accessManager.grantRole(ROLE_MINTER, faucet, 0)` + `accessManager.grantRole(ROLE_ROUTER, faucet, 0)`
3. Vote with dvGOV tokens (need 4% quorum)
4. Queue in timelock (60s delay)
5. Execute

**Feasibility**: The deployer holds all 1M dvGOV (initial supply), so they CAN self-vote. The flow is: propose → wait 1 second (voting delay) → vote → wait 5 minutes (voting period) → queue → wait 60 seconds (timelock) → execute. Total ~6 minutes.

### Option B: Redeploy entire system (CLEAN but heavy)
Modify `Deploy.s.sol` to include the faucet contract and wire its roles before the admin renounce step.

### Option C: Redeploy with faucet wired in during deploy (RECOMMENDED)
Add the faucet to the deployment script between steps 15 and 16 (before role wiring), then wire `ROLE_MINTER` and `ROLE_ROUTER` to the faucet in `_wireLabelsAndGrants`. This is cleanest because:
- Faucet gets roles atomically during deploy
- No governance dance needed
- Deploy script is the canonical system definition

### Recommendation: **Option A is viable for the current deployment** since the deployer holds all governance tokens and can self-vote. Option C is better for a fresh deployment.

## 6. Recommended Faucet Design

### Mesh Faucet: `DualVMFaucet.sol`

A single contract that serves as a one-stop onboarding tool:

```solidity
contract DualVMFaucet is AccessManaged, ReentrancyGuard {
    // Dependencies
    USDCMock public immutable usdc;
    WPAS public immutable wpas;
    DebtPool public immutable debtPool;
    LendingEngine public immutable lendingEngine;

    // Rate limiting
    uint256 public constant USDC_DRIP = 10_000e18;     // 10,000 USDC per claim
    uint256 public constant POOL_SEED = 100_000e18;     // 100,000 USDC per pool seed
    uint256 public constant COOLDOWN = 24 hours;

    mapping(address => uint256) public lastClaimed;

    // === Core Functions ===

    // 1. Simple USDC drip (needs ROLE_MINTER)
    function claimUSDC() external;
    //    → usdc.mint(msg.sender, USDC_DRIP)

    // 2. Wrap PAS and deposit as collateral (needs ROLE_ROUTER)
    function depositCollateralFromPAS() external payable;
    //    → wpas.deposit{value}()
    //    → wpas.approve(lendingEngine)
    //    → lendingEngine.depositCollateralFor(msg.sender, amount)

    // 3. Seed debt pool with USDC liquidity (needs ROLE_MINTER)
    function seedDebtPool(uint256 amount) external;
    //    → usdc.mint(address(this), amount)
    //    → usdc.approve(debtPool, amount)
    //    → debtPool.deposit(amount, address(this))  // faucet holds shares

    // 4. All-in-one: claim USDC + wrap PAS + deposit collateral
    function claimAndDeposit() external payable;
    //    → claimUSDC logic
    //    → depositCollateralFromPAS logic

    // 5. Admin: seed pool with initial liquidity
    function adminSeedPool() external restricted;
    //    → seedDebtPool(POOL_SEED)
}
```

### Permission Summary

| Function | Required Role | Why |
|---|---|---|
| `claimUSDC()` | ROLE_MINTER (via `usdc.mint()`) | Mints USDC-test to user |
| `depositCollateralFromPAS()` | ROLE_ROUTER (via `lendingEngine.depositCollateralFor()`) | Deposits collateral on behalf of user |
| `seedDebtPool()` | ROLE_MINTER (via `usdc.mint()`) | Mints USDC to itself, deposits into pool |
| `adminSeedPool()` | ROLE_MINTER + `restricted` modifier | Admin-only initial seeding |

### Contract Interactions

```
DualVMFaucet
  ├─→ USDCMock.mint(to, amount)                    [ROLE_MINTER required]
  ├─→ WPAS.deposit{value}()                        [permissionless]
  ├─→ WPAS.forceApprove(lendingEngine, amount)     [permissionless - faucet is token holder]
  ├─→ LendingEngine.depositCollateralFor(user, amt) [ROLE_ROUTER required]
  ├─→ USDCMock.approve(debtPool, amount)            [permissionless - faucet is token holder]
  └─→ DebtPool.deposit(amount, faucet)              [permissionless - faucet deposits to itself]
```

### What the Faucet Does NOT Do (and shouldn't)
- **Oracle price updates**: Too dangerous. ROLE_RISK_ADMIN stays with governance.
- **Borrow on behalf of users**: Users should explicitly borrow themselves (risk decision).
- **Liquidate positions**: That's a market function, not a faucet function.
- **Mint governance tokens**: ROLE_MINTER covers both USDCMock and GovernanceToken; the faucet function should only call `usdc.mint()`, not `govToken.mint()`.

### Mesh Benefit
The "mesh" pattern means one faucet contract benefits the entire ecosystem:
1. **Users get USDC** → can test repayments, liquidations
2. **Users get collateral deposited** → can immediately borrow
3. **Debt pool gets seeded** → borrowing is possible from day one
4. **All via one contract** → single point of integration for frontend
5. **Rate-limited** → prevents abuse on testnet

### AccessManager Wiring Needed

```solidity
// In Deploy.s.sol or via governance proposal:
am.grantRole(ROLE_MINTER, faucetAddress, 0);   // mint USDC-test
am.grantRole(ROLE_ROUTER, faucetAddress, 0);    // depositCollateralFor
```

Since `setTargetFunctionRole` for `USDCMock.mint` → `ROLE_MINTER` and `LendingEngine.depositCollateralFor` → `ROLE_ROUTER` are already wired, only the role grants are needed. No function-role mapping changes.
