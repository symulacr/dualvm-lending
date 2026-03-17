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

## Migration constraint on canonical deployment
- The live canonical deployment currently has a long target-admin delay posture on existing market targets, so quick function-role remapping is not practical during time-sensitive migration proofs.
- The recorded live migration proof therefore used a temporary broader AccessManager grant to the `MarketMigrationCoordinator` rather than a fast narrow remap on the already-deployed v1 market.
- Future migration work should assume governed migration scripts must be restart-safe and explicit about any temporary privilege escalation/cleanup.
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

## Deployment state
- Canonical deployment: `dualvm/deployments/polkadot-hub-testnet-canonical.json`
- Governance root: `Governor -> TimelockController -> AccessManager`
- Frontend manifest import points directly at the canonical manifest.
- Older baseline/versioned/governed manifests are historical and superseded by the canonical deployment path.

## Frontend Architecture
- Vite + React 18
- wagmi v2 + RainbowKit for wallet connection
- viem for chain reads (via readModel)
- Static manifest import from `src/lib/manifest.ts`
- `loadMarketSnapshot()` keeps a 10-second in-memory cache keyed only by observer address, so UI refresh triggers must invalidate/bust that cache when immediate post-write reads are required; otherwise both the market snapshot and embedded recent-activity payload can stay stale until the TTL expires.
- recent-events snapshot fallback
