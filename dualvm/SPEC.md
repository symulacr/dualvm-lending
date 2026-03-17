# DualVM Lending — System Specification

## Overview

DualVM Lending is a single isolated lending market on Polkadot Hub TestNet. It combines REVM custody/accounting with a live PVM-compiled risk engine and OpenZeppelin Governor-based governance.

## Canonical Deployment

- **Network**: Polkadot Hub TestNet (chain ID `420420417`)
- **Manifest**: `deployments/polkadot-hub-testnet-canonical.json`
- **Governance root**: Governor → TimelockController → AccessManager
- **Deployer has no residual roles** — admin renounced after bootstrap

## Contract Architecture

### Core Market (Immutable per version)

- **LendingCore** — Collateral deposits, borrowing, repayment, liquidation. Immutable per deployed version; new versions are activated via MarketVersionRegistry.
- **DebtPool** — ERC-4626 LP vault. LPs deposit USDC-test, borrowers draw from the pool. OZ inflation-attack protections active.
- **ManualOracle** — Governed manual price feed with circuit breaker (min/max price bounds, max delta per update). Staleness enforcement rejects borrows when oracle age exceeds maxAge.
- **RiskAdapter** — Publishes and consumes quote tickets. Calls the PVM-compiled quote engine for risk parameters.

### PVM Risk Engine (Live Cross-VM)

- **PvmQuoteProbe** — Compiled via `resolc` (Solidity→PolkaVM). Deployed on-chain with PVM code hash `0xba8fe2a621062a30bba558a3846d0a18bfb2e9a09bfaed656b123e698b59af5b`. Returns deterministic risk parameters: borrowRateBps, maxLtvBps, liquidationThresholdBps.
- The product-path LendingCore calls RiskAdapter → PvmQuoteProbe for every risk quote. This is **live cross-VM interop** — the PVM engine actively serves the product path.

### Interop Proof Package

Four probe stages independently verify REVM↔PVM cross-VM capability on the public testnet:

1. **Echo** — bytes32 round-trip (data integrity)
2. **Quote** — deterministic risk parameter retrieval
3. **Roundtrip Settlement** — REVM stores PVM-derived state
4. **XCM Precompile** — `weighMessage` call to XCM precompile at `0x...0a0000`

Probe verdicts: A=true, B=true, C=true, D=false (D=false means interop IS defensible).

### Governance

- **GovernanceToken** — ERC20 + ERC20Permit + ERC20Votes (timestamp CLOCK_MODE)
- **DualVMGovernor** — Governor + GovernorCountingSimple + GovernorVotes + GovernorVotesQuorumFraction + GovernorTimelockControl
- **TimelockController** — Holds AccessManager admin. 60s minimum delay.
- **AccessManager** — System-wide role management. Non-zero delays: riskAdmin=60s, treasury=60s, minter=60s, emergency=0s.
- Version activation requires a full governance proposal: propose → vote → queue → execute.

### Migration

- **MarketVersionRegistry** — On-chain version activation boundary. Registers and activates market versions.
- **MarketMigrationCoordinator** — Exports positions from old LendingCore, imports to new. Live migration proven on-chain (v1→v2 with debt/collateral preservation).

### Assets

- **WPAS** — Wrapped PAS (ERC-20 wrapper for native PAS)
- **USDCMock** — Mock stablecoin (18 decimals, minter-controlled)

## Market Parameters

| Parameter | Value |
|-----------|-------|
| Max LTV | 70% (7000 bps) |
| Liquidation Threshold | 80% (8000 bps) |
| Liquidation Bonus | 5% (500 bps) |
| Reserve Factor | 10% (1000 bps) |
| Supply Cap | 5,000,000 USDC |
| Borrow Cap | 4,000,000 USDC |
| Min Borrow Amount | 100 USDC |
| Oracle Max Age | 6 hours (21600s) |
| Base Rate | 2% (200 bps) |
| Slope 1 | 8% (800 bps) |
| Slope 2 | 30% (3000 bps) |
| Kink | 80% (8000 bps) |

## OpenZeppelin Integration

Non-trivial composition of OZ 5.x contracts:

- **AccessManager** — System-wide role-function mapping with execution delays
- **Governor** — Full propose/vote/queue/execute lifecycle (5 extensions composed)
- **TimelockController** — Governance timelock
- **ERC20Votes + ERC20Permit** — Governance token with delegation
- **ERC4626** — DebtPool LP vault with inflation-attack protection
- **SafeERC20** — All token transfers in LendingCore
- **Pausable** — Emergency pause on core, pool, and oracle
- **ReentrancyGuard** — All state-changing fund flows

## Frontend

React 18 + Vite frontend with:
- wagmi v2 + RainbowKit wallet connection
- Full write path: deposit, borrow, repay, withdraw, liquidate, supply liquidity
- Market snapshot reads: pool total assets, utilization, oracle price, freshness
- Observer mode: health factor and available-to-borrow for any address
- Post-write cache invalidation and multi-step TX history

## Testing

81 Hardhat tests covering:
- Full lending lifecycle (deposit, borrow, repay, liquidation)
- Bad-debt accounting, oracle staleness, circuit breaker
- ERC-4626 inflation attack protection
- Governor propose/vote/queue/execute lifecycle
- Reentrancy guards on DebtPool
- AccessManager role enforcement
- Deployment manifest validation

## Limitations

- Single isolated market
- Manual oracle (not a decentralized oracle network)
- USDC-test is a mock token
- PVM callback probe reverts (platform limitation)
- Hackathon governance parameters (not production values)
