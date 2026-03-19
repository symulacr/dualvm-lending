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
  └── riskEngine: RiskAdapter (inline deterministic math + optional DeterministicRiskModel cross-VM verification)

MarketVersionRegistry
  └── activateVersion() (governed)

MarketMigrationCoordinator
  └── migrateBorrower() / migrateLiquidity()

- `migrateBorrower(uint256 fromVersionId, uint256 toVersionId)` migrates `msg.sender`; there is no `migrateBorrower(account)` admin entrypoint.
- Borrower/liquidity migration only works between versions that share the same collateral asset and debt asset; mismatched pairs revert with `UnsupportedAssetPair`.
- The coordinator must be authorized to call the restricted migration import/export functions on the involved lending cores; opening the route alone is not sufficient.

## Migration constraint on canonical deployment
- The live canonical deployment currently has a long target-admin delay posture on existing market targets, so quick function-role remapping is not practical during time-sensitive migration proofs.
- The recorded live migration proof therefore used a temporary broader AccessManager grant to the `MarketMigrationCoordinator` rather than a fast narrow remap on the already-deployed v1 market.
- Future migration work should assume governed migration scripts must be restart-safe and explicit about any temporary privilege escalation/cleanup.

## Async XCM receipt handling
- Any inbox that de-duplicates async receipts by `correlationId` must authenticate the relay/caller allowed to deliver the receipt.
- A permissionless `receiveReceipt(correlationId, data)` shape lets arbitrary callers consume IDs first and spoof payloads before the legitimate XCM delivery arrives.
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
- `quoteViaTicket()` is now AccessManaged and meant to be callable only by the deployed LendingCore address via `ROLE_IDS.LENDING_CORE`
- RiskAdapter computes the canonical quote inline, then optionally verifies the result against the PVM-compiled `DeterministicRiskModel`

## Current M6 scrutiny gap
- `deploySystem.ts` wires `ROLE_IDS.LENDING_CORE` to `RiskAdapter.quoteViaTicket()`, but `deployMarketVersion.ts` currently does not. Fixtures or scripts that create versions through `deployMarketVersion()` may need manual AccessManager wiring until the scrutiny fix lands.

## Deployment state
- Canonical deployment: `dualvm/deployments/polkadot-hub-testnet-canonical.json`
- Governance root: `Governor -> TimelockController -> AccessManager`
- Frontend manifest import points directly at the canonical manifest.
- The canonical manifest does not currently expose `lendingCoreV2.liquidationNotifier`; scripts that need the notifier address must use explicit env vars or the V2 contracts manifest.
- `dualvm/deployments/liveV2Smoke-results.json` is not fully normalized: `step4_liquidation` stores `liquidationTxHash` instead of the `txHash` field used by earlier steps.
- Older baseline/versioned/governed manifests are historical and superseded by the canonical deployment path.

## Frontend Architecture
- Vite + React 18
- wagmi v2 + RainbowKit for wallet connection
- viem for chain reads (via readModel)
- Static manifest import from `src/lib/manifest.ts`
- `loadMarketSnapshot()` keeps a 10-second in-memory cache keyed only by observer address, so UI refresh triggers must invalidate/bust that cache when immediate post-write reads are required; otherwise both the market snapshot and embedded recent-activity payload can stay stale until the TTL expires.
- recent-events snapshot fallback
