---
name: solidity-worker
description: Implements and tests Solidity smart contracts using Foundry (forge build, forge test), creates forge deployment scripts, and manages contract architecture.
---

# Solidity Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:
- Writing or modifying Solidity contracts
- Writing or modifying Foundry Solidity tests (test/*.t.sol)
- Writing or modifying Foundry deployment scripts (script/*.s.sol)
- Writing or modifying TypeScript operational scripts in `scripts/` (using viem, NOT ethers)
- Migrating Hardhat tests to Foundry

## Work Procedure

1. **Read the feature description** carefully. Identify all contracts, tests, and scripts that need to change.

2. **Read existing code** before writing. Check:
   - `dualvm/contracts/` for existing patterns (imports, error style, event style, constructor patterns)
   - `dualvm/test/*.t.sol` for Foundry test patterns (if they exist yet)
   - `dualvm/test/helpers/BaseTest.sol` for shared test setup (if it exists)
   - `dualvm/foundry.toml` for Foundry configuration
   - `dualvm/lib/config/marketConfig.ts` for constants and defaults (operational scripts)

3. **Write Foundry tests and implementation**:
   - Create test files as `dualvm/test/<Name>.t.sol`
   - Use `forge-std/Test.sol` as base: `import "forge-std/Test.sol";`
   - Use forge cheatcodes: `vm.prank(addr)`, `vm.expectRevert(Selector)`, `vm.warp(timestamp)`, `vm.deal(addr, amount)`, `vm.startPrank/vm.stopPrank`, `vm.expectEmit(true, true, false, true)`
   - Create shared test helpers in `dualvm/test/helpers/BaseTest.sol` if a common deployment fixture is needed
   - Use `setUp()` for test initialization (runs before each test)
   - Name test functions with `test_` prefix for passing tests, `testFuzz_` for fuzz tests, `testFail_` or `test_RevertWhen_` for expected reverts
   - Tests must exercise REAL behavior, not just check ABI presence
   - For mock XCM precompile: use `vm.mockCall(XCM_PRECOMPILE_ADDRESS, ...)` to simulate precompile responses in Hardhat-replacement tests

4. **Implement contracts**:
   - Write Solidity contracts following existing patterns
   - Use OpenZeppelin 5.x imports: `@openzeppelin/contracts/...`
   - Use custom errors (not require strings)
   - Use events for all state changes

5. **Write deployment scripts** (when applicable):
   - Create as `dualvm/script/<Name>.s.sol`
   - Use `forge-std/Script.sol` as base
   - Use `vm.startBroadcast()` / `vm.stopBroadcast()` for transaction batching
   - Output addresses to console or write to JSON file

6. **Run tests to confirm they pass**:
   - `cd /home/kpa/polkadot/dualvm && forge test --match-contract <TestContract> -vvv`
   - Fix any failures

7. **Run full validation suite**:
   - `cd /home/kpa/polkadot/dualvm && forge test` (all tests)
   - `cd /home/kpa/polkadot/dualvm && forge build` (compile check)
   - If TypeScript files were changed: `cd /home/kpa/polkadot/dualvm && npx tsc --noEmit`

8. **Commit with a descriptive message** following the repo's existing commit style.

## Foundry-Specific Patterns

### Test file structure
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";
// ... other imports

contract LendingEngineTest is Test {
    LendingEngine engine;
    
    function setUp() public {
        // Deploy contracts, wire dependencies
    }
    
    function test_BorrowEmitsCorrelationId() public {
        // Test implementation
    }
    
    function test_RevertWhen_BorrowExceedsCap() public {
        vm.expectRevert(LendingEngine.BorrowCapExceeded.selector);
        engine.borrow(tooMuchAmount);
    }
}
```

### Mock XCM precompile
```solidity
// Mock the XCM precompile for local tests
vm.mockCall(
    address(0x0A0000),
    abi.encodeWithSelector(IXcm.send.selector),
    abi.encode()
);
```

### AccessManager test pattern
```solidity
// Grant role to test caller
accessManager.grantRole(ROLE_ID, caller, 0);
vm.prank(caller);
restrictedContract.restrictedFunction();
```

## Example Handoff

```json
{
  "salientSummary": "Migrated core lending tests to Foundry: created test/LendingEngine.t.sol with 45 test cases covering deposit/borrow/repay/liquidate/batch/pause/reentrancy. Created test/helpers/BaseTest.sol with shared deployment fixture. Renamed LendingCoreV2.sol to LendingEngine.sol. forge test passes 45 tests, forge build clean.",
  "whatWasImplemented": "test/LendingEngine.t.sol (45 Foundry test cases), test/helpers/BaseTest.sol (shared fixture), contracts/LendingEngine.sol (renamed from LendingCoreV2.sol), all imports updated",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "cd /home/kpa/polkadot/dualvm && forge test --match-contract LendingEngineTest -vvv", "exitCode": 0, "observation": "45 tests passing"},
      {"command": "cd /home/kpa/polkadot/dualvm && forge test", "exitCode": 0, "observation": "All 45 tests passing"},
      {"command": "cd /home/kpa/polkadot/dualvm && forge build", "exitCode": 0, "observation": "Compilation clean"}
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "test/LendingEngine.t.sol",
        "cases": [
          {"name": "test_DepositCollateral", "verifies": "deposit records position"},
          {"name": "test_BorrowWithinLTV", "verifies": "borrow succeeds within LTV"},
          {"name": "test_RevertWhen_BorrowExceedsLTV", "verifies": "borrow reverts above LTV"}
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Contract compilation fails due to missing OpenZeppelin dependency or version mismatch
- Existing tests break in unexpected ways unrelated to the feature
- Feature requires deployment to live testnet (deployment-worker handles that)
- Feature requires frontend changes (frontend-worker handles that)
