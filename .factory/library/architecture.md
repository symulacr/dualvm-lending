# Architecture

Architectural decisions, patterns, and component relationships.

---

## Contract Architecture

```
Governor → TimelockController → AccessManager → [all protocol contracts]

LendingCore (immutable per version)
  ├── collateralAsset: WPAS
  ├── debtAsset: USDCMock
  ├── debtPool: DebtPool (ERC4626)
  ├── oracle: ManualOracle
  └── riskEngine: RiskAdapter → PvmQuoteProbe (PVM-compiled)

MarketVersionRegistry
  └── activateVersion() (governed)

MarketMigrationCoordinator
  └── migrateBorrower() / migrateLiquidity()
```

## Governance Chain
1. GovernanceToken holders delegate voting power
2. Governor creates proposals, holders vote
3. Succeeded proposals queued to TimelockController
4. TimelockController executes after delay
5. Executed operations go through AccessManager to target contracts

## Quote Ticket System
- RiskAdapter stores QuoteTickets keyed on (oracleEpoch, configEpoch, stateHash, configHash, input)
- Any oracle update invalidates all outstanding tickets (epoch changes)
- LendingCore uses `quoteViaTicket()` which auto-publishes if ticket missing
- Quote engine is PVM-compiled PvmQuoteProbe — genuine cross-VM call

## Deployment Families (HISTORICAL — being consolidated)
- Baseline: `polkadot-hub-testnet.json` (old, separate roles, explorer-verified)
- Versioned: `polkadot-hub-testnet-versioned.json` (immutable kernel, but single EOA)
- Governed: `polkadot-hub-testnet-governed.json` (multisig+timelock, but not verified)
- CANONICAL: will be single governed+versioned deployment with Governor

## Frontend Architecture
- Vite + React 18
- wagmi v2 + RainbowKit for wallet connection
- viem for chain reads (via readModel)
- Static manifest import from `src/lib/manifest.ts`
- 10-second read cache, recent-events snapshot fallback
