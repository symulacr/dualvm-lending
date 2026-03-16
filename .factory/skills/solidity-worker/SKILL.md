---
name: solidity-worker
description: Implements and tests Solidity smart contracts, TypeScript deployment helpers, and Hardhat test suites.
---

# Solidity Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:
- Writing or modifying Solidity contracts
- Writing or modifying Hardhat tests
- Writing or modifying TypeScript deployment/runtime helpers in `lib/`
- Writing or modifying operational scripts in `scripts/`

## Work Procedure

1. **Read the feature description** carefully. Identify all contracts, tests, and helpers that need to change.

2. **Read existing code** before writing. Check:
   - `dualvm/contracts/` for existing patterns (imports, error style, event style, constructor patterns)
   - `dualvm/test/LendingCore.ts` for test fixture patterns (loadFixture, deployFixture, assertion style)
   - `dualvm/lib/config/marketConfig.ts` for constants and defaults
   - `dualvm/lib/deployment/deploySystem.ts` for deployment patterns

3. **Write tests and implementation** (order depends on task type):
   - **For new contracts/interfaces**: Read existing code and specs first, implement the contract, then write tests. Discovery-first is appropriate when understanding the design space is necessary.
   - **For test-hardening features**: Read the existing contract code to understand what needs testing, then write meaningful tests that exercise real behavior (not just ABI checks).
   - **For bug fixes or refinements**: Write a failing test first if the fix is well-scoped, then fix it.
   - Create or update test files in `dualvm/test/`
   - Use `loadFixture` pattern with a `deployFixture` function
   - Tests must exercise REAL behavior, not just check ABI presence. For security features (ReentrancyGuard, inflation protection), deploy an attacker contract or simulate the attack vector.

4. **Implement contracts and helpers (green)**:
   - Write Solidity contracts following existing patterns
   - Use OpenZeppelin 5.x imports: `@openzeppelin/contracts/...`
   - Use custom errors (not require strings)
   - Use events for all state changes
   - Update deployment helpers in `lib/` if needed

5. **Run tests to confirm they pass**:
   - `cd /home/kpa/polkadot/dualvm && npx hardhat test test/<file>.ts`
   - Fix any failures

6. **Run full validation suite**:
   - `cd /home/kpa/polkadot/dualvm && npm test` (all tests)
   - `cd /home/kpa/polkadot/dualvm && npx tsc --noEmit` (typecheck)
   - `cd /home/kpa/polkadot/dualvm && npx hardhat compile` (compile check)

7. **Commit with a descriptive message** following the repo's existing commit style.

## Example Handoff

```json
{
  "salientSummary": "Implemented GovernanceToken (ERC20Votes + timestamp CLOCK_MODE) and DualVMGovernor (Governor + GovernorCountingSimple + GovernorVotes + GovernorVotesQuorumFraction + GovernorTimelockControl). Deleted DualVMMultisig.sol and DualVMTimelockController.sol. Updated deployGovernedSystem.ts. Tests cover propose/vote/queue/execute lifecycle. All 12 tests passing, typecheck clean.",
  "whatWasImplemented": "contracts/governance/GovernanceToken.sol (ERC20+ERC20Permit+ERC20Votes with timestamp clock), contracts/governance/DualVMGovernor.sol (full Governor composition), updated lib/deployment/deployGovernedSystem.ts, test/GovernorLifecycle.ts with 12 test cases",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "cd /home/kpa/polkadot/dualvm && npx hardhat test test/GovernorLifecycle.ts", "exitCode": 0, "observation": "12 passing"},
      {"command": "cd /home/kpa/polkadot/dualvm && npm test", "exitCode": 0, "observation": "All 24 tests passing"},
      {"command": "cd /home/kpa/polkadot/dualvm && npx tsc --noEmit", "exitCode": 0, "observation": "No type errors"}
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "test/GovernorLifecycle.ts",
        "cases": [
          {"name": "deploys governance token with correct supply", "verifies": "VAL-GOV-001"},
          {"name": "self-delegation activates voting power", "verifies": "VAL-GOV-003"},
          {"name": "full propose/vote/queue/execute lifecycle", "verifies": "VAL-GOV-005, VAL-GOV-006, VAL-GOV-007"}
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
