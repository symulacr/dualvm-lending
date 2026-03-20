# Adversarial Audit: DualVMFaucet Mesh Plan

**Auditor**: Automated adversarial review  
**Date**: 2026-03-20  
**Subject**: `/home/kpa/polkadot/dualvm/docs/faucet-mesh-architecture-report.md`  
**Verdict**: **PLAN NEEDS MAJOR REWORK** — 3 critical issues, 3 high issues

---

## CRITICAL Issues (will break the faucet or make it useless)

### C1. ROLE_MINTER Grants GovernanceToken.mint — Governance Takeover Vector

**Severity**: CRITICAL  
**Evidence**: `script/Deploy.s.sol` lines 541–543 and 575–577

```solidity
// Line 542 — USDCMock.mint mapped to ROLE_MINTER
minterFns[0] = USDCMock.mint.selector;
am.setTargetFunctionRole(a.usdc, minterFns, ROLE_MINTER);

// Line 576 — GovernanceToken.mint ALSO mapped to ROLE_MINTER
minterFns[0] = GovernanceToken.mint.selector;
am.setTargetFunctionRole(a.govToken, minterFns, ROLE_MINTER);
```

**What's wrong**: The plan proposes granting `ROLE_MINTER` (ID 4) to the faucet so it can call `USDCMock.mint()`. However, **`ROLE_MINTER` also authorizes `GovernanceToken.mint()`** because both functions are mapped to the same role in the AccessManager. A faucet holding `ROLE_MINTER` can mint unlimited `dvGOV` governance tokens, enabling:

1. Dilution of all governance voting power
2. Hostile proposal passage (mint tokens → self-delegate → vote)
3. Full protocol takeover via governance (change oracle, freeze markets, drain reserves)

The report acknowledges this in Section 4 ("ROLE_MINTER covers both USDCMock and GovernanceToken") but dismisses it with "the faucet function should only call usdc.mint(), not govToken.mint()". This is a **defense-in-depth violation** — the faucet contract's code is the only barrier between the public and unlimited governance token minting. Any reentrancy, arbitrary-call bug, or malicious upgrade path in the faucet makes this exploitable.

**Recommended fix**: Create a dedicated `ROLE_USDC_MINTER` (e.g., ID 10) mapped only to `USDCMock.mint`. This requires a governance proposal to:
1. `accessManager.setTargetFunctionRole(usdcMock, [mint.selector], ROLE_USDC_MINTER)`  
2. `accessManager.grantRole(ROLE_USDC_MINTER, faucet, 0)`

Or: redeploy with a split role scheme (Option C in the report).

---

### C2. Oracle Staleness Blocks Borrowing — Faucet Is Useless Without Oracle Maintenance

**Severity**: CRITICAL  
**Evidence**: `contracts/LendingEngine.sol` lines 465, 745–746; `contracts/ManualOracle.sol` lines 91–96

```solidity
// LendingEngine.borrow() calls:
uint256 price = _latestOraclePrice();  // line 465

// Which calls:
function _latestOraclePrice() private view returns (uint256) {
    return oracle.latestPriceWad();    // line 746
}

// ManualOracle.latestPriceWad() REVERTS on stale:
function latestPriceWad() external view whenNotPaused returns (uint256) {
    uint256 age = block.timestamp - lastUpdatedAt;
    if (age > maxAge) revert OraclePriceStale(age, maxAge);  // line 95
    return localPrice;
}
```

**What's wrong**: The faucet plan says "faucet does NOT touch oracle" (Section 4). While the faucet's `depositCollateralFor()` works with stale oracle (uses `_oracleSnapshot()` which doesn't revert), the **entire purpose of the faucet** — enabling users to borrow — requires `borrow()`, which calls `_latestOraclePrice()`, which **reverts** if the oracle is stale.

Oracle freshness:
- `maxAge` = 1800 seconds (30 minutes) per deploy script constant `ORACLE_MAX_AGE`
- `setPrice()` requires `ROLE_RISK_ADMIN` (ID 2)
- `ROLE_RISK_ADMIN` is granted **only to TimelockController** per `_wireLabelsAndGrants()`
- Refreshing oracle therefore requires: governance proposal → vote (5 min) → queue → timelock (60s) → execute ≈ **~6 minutes minimum per refresh**
- Oracle expires every 30 minutes → this cycle must repeat indefinitely

**The faucet can onboard users (deposit collateral + give USDC), but users CANNOT BORROW**, making the faucet pointless for demonstrating the lending flow.

Additionally affected by stale oracle (all revert):
- `withdrawCollateral()` (line 332)
- `liquidate()` (line 433)
- `importMigratedPosition()` (line 579)

**Recommended fix**: The plan MUST address oracle maintenance. Options:
1. Grant `ROLE_RISK_ADMIN` to a dedicated keeper EOA via governance (one-time vote)
2. Include an oracle refresh in the faucet itself (but this is dangerous — too much power)
3. Increase `maxAge` via governance to e.g. 24 hours for testnet use
4. Add a separate oracle keeper contract with limited `setPrice` permission

---

### C3. Governance Self-Delegation Missing — Option A Vote Will Fail

**Severity**: CRITICAL  
**Evidence**: `script/Deploy.s.sol` (no `delegate` call anywhere); `contracts/governance/GovernanceToken.sol` (inherits `ERC20Votes`)

**What's wrong**: The report's Option A assumes the deployer can self-vote because "the deployer holds all 1M dvGOV". However, **ERC20Votes requires explicit self-delegation before voting power is active**. The deploy script mints 1M dvGOV to the deployer but **never calls `delegate(deployer)`**.

OpenZeppelin's `ERC20Votes._transferVotingUnits()` (called during mint) routes voting units to `delegates(to)`. Since the deployer has never delegated, `delegates(deployer)` returns `address(0)`. The voting power goes to address(0), giving the deployer **zero votes**.

Confirmed by grep: no `delegate` call exists anywhere in `Deploy.s.sol`.

Without self-delegation:
- Deployer's `getVotes()` returns 0
- 4% quorum of 0 votes = 0, but the proposal still needs at least 1 vote
- Governor's `_quorumReached()` checks `againstVotes + forVotes + abstainVotes >= quorum`. With 0 quorum and 0 votes, this is technically reachable (0 >= 0), but `_voteSucceeded()` requires `forVotes > againstVotes`. With 0 for-votes, this fails.

**Timeline impact**: Not a blocker if deployer self-delegates before proposing (1 extra tx), but the report **omits this required step**, making the 6-minute timeline inaccurate.

**Recommended fix**: Add `GovernanceToken(govToken).delegate(deployer)` to the deploy script after minting, or document it as a mandatory pre-governance step.

---

## HIGH Issues (significant problems)

### H1. No Oracle Maintenance Plan Means Entire Lending Flow is Dead on Arrival

**Severity**: HIGH (elevated from the oracle discussion in C2)  
**Evidence**: `.env` file shows `RISK_ADMIN=0xE6E56B87...` and `RISK_PRIVATE_KEY=***` but `Deploy.s.sol` only grants `ROLE_RISK_ADMIN` to TimelockController

**What's wrong**: The `.env` file suggests a dedicated risk admin EOA was intended, but the canonical deploy script **does not grant `ROLE_RISK_ADMIN` to any EOA**. The .env role addresses are dead config. Unless a post-deployment governance vote already granted this role (unverifiable from code alone), oracle refresh is governance-gated.

The faucet plan has zero mention of oracle operations. A complete onboarding plan needs:
1. Fresh oracle (for borrow)
2. Debt pool liquidity (for drawDebt) — addressed by seedDebtPool ✅
3. Collateral (for LTV) — addressed by depositCollateralFromPAS ✅
4. USDC for testing — addressed by claimUSDC ✅

Item 1 is entirely missing.

**Recommended fix**: The faucet plan should include a companion oracle keeper script or document how oracle freshness will be maintained. At minimum, grant `ROLE_RISK_ADMIN` to a keeper EOA as the first governance action.

---

### H2. Faucet Duplicates LendingRouter Instead of Delegating

**Severity**: HIGH  
**Evidence**: `contracts/LendingRouter.sol` lines 55–67; report Section 6

**What's wrong**: The proposed `depositCollateralFromPAS()` in the faucet exactly reimplements `LendingRouter.depositCollateralFromPAS()`:

```
Both do: WPAS.deposit{value}() → WPAS.forceApprove(lendingEngine) → lendingEngine.depositCollateralFor(msg.sender, amount)
```

The faucet can't delegate to the existing LendingRouter because `msg.sender` inside the router would be the faucet (not the user), crediting the faucet's position. **However**, the reimplementation means:

1. The faucet needs `ROLE_ROUTER` (a second dangerous permission)
2. Two contracts now have `ROLE_ROUTER`, doubling the attack surface for `depositCollateralFor`
3. Any future bug fix to the router logic must be duplicated in the faucet

**Alternative**: Rather than giving the faucet `ROLE_ROUTER`, consider having the faucet:
1. Call `wpas.deposit{value}()` to get WPAS
2. Transfer WPAS directly to the user: `wpas.transfer(msg.sender, amount)`
3. Let the user call `depositCollateral()` themselves (permissionless, just needs WPAS approval)

This eliminates the need for `ROLE_ROUTER` entirely, reducing the faucet's permission footprint to just `ROLE_MINTER` (or ideally `ROLE_USDC_MINTER` per C1).

---

### H3. No Withdrawal/Recovery Mechanism for Faucet Assets

**Severity**: HIGH  
**Evidence**: Report Section 6 — no `withdraw`, `rescue`, or recovery function mentioned

**What's wrong**: The faucet design shows:
- `seedDebtPool()` mints USDC and deposits into DebtPool → faucet receives dvUSDC shares
- `depositCollateralFromPAS()` wraps PAS → WPAS → collateral

But there is **no mechanism to recover**:
1. dvUSDC shares held by the faucet (from pool seeding)
2. Accidentally sent tokens (ERC-20 rescue)
3. Native PAS accidentally sent to the faucet

If the faucet accumulates significant dvUSDC shares from seeding (100K per call), those become permanently locked. On a testnet this is acceptable but violates good contract design.

**Recommended fix**: Add a restricted `rescueERC20(token, to, amount)` function and a `rescueNative(to, amount)` function, both gated by AccessManager.

---

## MEDIUM Issues (design flaws)

### M1. Rate Limiting Is Trivially Bypassable

**Severity**: MEDIUM  
**Evidence**: Report Section 6 — `COOLDOWN = 24 hours`, `mapping(address => uint256) public lastClaimed`

**What's wrong**: Rate limiting by address is trivially bypassed by creating new wallets. On Polkadot Hub TestNet, anyone can generate unlimited EOAs. The 24-hour cooldown per address provides zero protection against:
- Sybil attacks draining the USDC mint supply
- A single user claiming from 100 addresses in 100 seconds

For a testnet faucet, this is somewhat acceptable, but the report presents it as a security feature. At minimum, document that it's UX friction (prevents accidental double-claims), not a security mechanism.

**Recommended fix**: Consider global rate limiting (total claims per hour) or a maximum outstanding supply. Alternatively, accept the risk and document it as a known testnet limitation.

---

### M2. seedDebtPool Makes Faucet a Permanent LP — Share Accounting Unaddressed

**Severity**: MEDIUM  
**Evidence**: Report Section 6 — `debtPool.deposit(amount, address(this))` — faucet receives dvUSDC shares

**What's wrong**: When `seedDebtPool()` is called, the faucet mints USDC, deposits into DebtPool, and receives dvUSDC ERC-4626 shares. These shares:
1. Accrue value from borrower interest repayments
2. Cannot be redeemed (no withdraw function in faucet design)
3. Count toward DebtPool's totalSupply, affecting share price calculations

Over time, if seeding is called multiple times, the faucet becomes a major LP with no ability to exit. If borrowers repay with interest, the faucet's shares appreciate but the value is permanently locked.

**Recommended fix**: Either (a) deposit with `receiver = address(0x1)` (burn shares, effectively donating liquidity), or (b) add a restricted redeem function.

---

### M3. `claimAndDeposit()` Combines Unrelated Actions with Unclear UX

**Severity**: MEDIUM  
**Evidence**: Report Section 6

**What's wrong**: `claimAndDeposit()` combines:
1. Minting 10K USDC to user (debt asset, for testing repay/LP)
2. Wrapping `msg.value` PAS as collateral

These serve different purposes. A user calling `claimAndDeposit{value: X}()` might not realize they're getting USDC separately AND depositing PAS as collateral. The USDC goes to their wallet, NOT to the debt pool.

Additionally, `claimAndDeposit()` shares the same 24h cooldown as `claimUSDC()`, meaning a user who claims USDC separately can't use `claimAndDeposit()` for just the collateral part until cooldown expires.

**Recommended fix**: Keep functions separate. Users call `claimUSDC()` once for USDC, and `depositCollateralFromPAS{value}()` as many times as needed (no cooldown needed for wrapping their own PAS).

---

### M4. ERC-4626 Inflation Attack Not Mitigated in DebtPool

**Severity**: MEDIUM  
**Evidence**: `contracts/DebtPool.sol` — no `_decimalsOffset()` override found

**What's wrong**: DebtPool inherits from OpenZeppelin ERC4626 but does not override `_decimalsOffset()`. In OZ 5.x, the default `_decimalsOffset()` returns 0, providing no virtual share/asset offset. This makes the first deposit vulnerable to the classic ERC-4626 inflation attack:
1. Attacker deposits 1 wei, gets 1 share
2. Attacker donates a large amount directly to the vault
3. Subsequent depositors get 0 shares due to rounding

For `seedDebtPool()`, if an attacker front-runs the first seed deposit with a small donation, the faucet could receive 0 shares for a large deposit.

**Recommended fix**: Override `_decimalsOffset()` to return a non-zero value (e.g., 6) in DebtPool, or ensure the first deposit is made during deployment before admin is renounced (deployment currently doesn't seed the pool).

---

## LOW Issues (nice-to-haves)

### L1. No Frontend ABI or Integration Guide

**Severity**: LOW  

The report provides no guidance on frontend integration: which ABI to use, how to construct transactions, or gas estimates for `claimAndDeposit()`. The frontend team needs this.

---

### L2. No Test Plan

**Severity**: LOW  

The report provides no test strategy. At minimum, a fork test should verify:
- claimUSDC respects cooldown
- depositCollateralFromPAS correctly credits beneficiary
- seedDebtPool mints and deposits correctly
- ROLE_MINTER can't be abused for govToken minting (or verify the mitigation)

---

### L3. Gas Estimation Missing

**Severity**: LOW  

`claimAndDeposit()` performs: USDC mint + WPAS deposit + WPAS approve + depositCollateralFor (which includes safeTransferFrom + storage writes + optional risk quote). On Polkadot Hub TestNet, gas costs and limits may differ from Ethereum. No gas estimates are provided.

---

### L4. Deployer Private Key Reuse Across All Roles

**Severity**: LOW  
**Evidence**: `.env` shows `ADMIN_PRIVATE_KEY`, `EMERGENCY_PRIVATE_KEY`, `RISK_PRIVATE_KEY`, etc. all censored but comment says "all use same deployer key for simplicity"

For a hackathon testnet this is fine, but the faucet plan should acknowledge that all role operations (oracle refresh, emergency pause, etc.) depend on a single key.

---

## Verified Claims (report is correct)

| Claim | Verdict | Evidence |
|---|---|---|
| ROLE_MINTER = 4 | ✅ Correct | `Deploy.s.sol` line 62 |
| ROLE_ROUTER = 8 | ✅ Correct | `Deploy.s.sol` line 67 |
| Admin renounced by deployer | ✅ Correct | `Deploy.s.sol` step 18, line ~380 |
| TimelockController is sole admin | ✅ Correct | `Deploy.s.sol` step 17 |
| WPAS.deposit() is permissionless | ✅ Correct | `contracts/WPAS.sol` — no access modifier |
| DebtPool.deposit() is permissionless | ✅ Correct | `contracts/DebtPool.sol` — nonReentrant + whenNotPaused only |
| USDCMock.mint() requires ROLE_MINTER | ✅ Correct | `contracts/USDCMock.sol` — `restricted` modifier |
| depositCollateralFor() requires ROLE_ROUTER | ✅ Correct | `contracts/LendingEngine.sol` — `restricted` modifier |
| depositCollateralFor() credits beneficiary's position | ✅ Correct | `contracts/LendingEngine.sol` lines 388–415 |
| Voting delay = 1 second | ✅ Correct | `Deploy.s.sol` constant |
| Voting period = 300 seconds (5 min) | ✅ Correct | `Deploy.s.sol` constant |
| Timelock delay = 60 seconds | ✅ Correct | `Deploy.s.sol` constant |
| Quorum = 4% | ✅ Correct | `Deploy.s.sol` constant |
| Deployer holds all 1M dvGOV | ✅ Correct | GovernanceToken constructor mints to `initialHolder = deployer` |
| LendingRouter duplicates exact faucet logic | ✅ Correct | `contracts/LendingRouter.sol` lines 55–67 |
| Token economic model (USDC = debt, WPAS = collateral) | ✅ Correct | Not reversed |

---

## Final Verdict

**The plan needs major rework before implementation.** The three critical issues are:

1. **C1 (Governance Token Minting)**: The faucet can mint unlimited governance tokens due to shared ROLE_MINTER. This is a protocol-ending vulnerability if the faucet has any bug.

2. **C2 (Oracle Staleness)**: The entire purpose of the faucet (enabling users to borrow) is blocked by oracle staleness. Without an oracle maintenance plan, the faucet deposits collateral that users can never use.

3. **C3 (Self-Delegation)**: Option A (governance grant) will fail at the voting step because the deployer has never self-delegated. This is fixable with one tx but is undocumented.

**Recommended path forward**:
1. Fix C3 first: deployer calls `governanceToken.delegate(deployer)` 
2. Via governance, create `ROLE_USDC_MINTER` (new role ID 10) and map only to USDCMock.mint — fixes C1
3. Via governance, grant `ROLE_RISK_ADMIN` to a keeper EOA — fixes C2
4. Then proceed with faucet deployment using `ROLE_USDC_MINTER` + `ROLE_ROUTER`
5. Alternatively: redeploy everything (Option C) with all fixes baked in
