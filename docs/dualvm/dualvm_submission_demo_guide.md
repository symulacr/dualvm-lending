# DualVM Submission and Demo Guide

## Short submission pitch
DualVM Lending is a public-RPC-first isolated lending market on Polkadot Hub TestNet. It uses Solidity and OpenZeppelin security patterns for custody and accounting on REVM, with a bounded PVM-aligned risk-computation module. The current live deployment demonstrates the lending MVP on-chain and preserves an honest Track 2 story through real PVM parity artifacts and risk-engine design, without claiming proven live cross-VM execution in the solvency-critical path.

## Track mapping
### Track 1
- Stablecoin-enabled DeFi application
- Live isolated lending market with collateral deposit, debt draw, repay, and liquidation

### Track 2
- Honest PVM posture: the risk engine is implemented as a bounded stateless module and PVM artifacts are generated
- Current live deployed lending path is not yet proven as live cross-VM PVM execution
- Submission wording must not imply stronger cross-VM proof than what exists
- Canonical wording is frozen in `docs/dualvm/dualvm_pvm_posture.md`

### OpenZeppelin sponsor fit
- `AccessManager`
- `Pausable`
- `ReentrancyGuard`
- `SafeERC20`
- `ERC4626`-style debt pool with explicit inflation-attack awareness

## Current live deployment
- AccessManager: `0x06Ca684578a01d6978654A4572B6A00Abe934575`
- WPAS: `0x0Dece14653B651Ee10df0bBcb286C9170A24e1bc`
- USDCMock: `0x789cf6A8B73Eab267C6B0eEa0E38fbE2AcD0Caf4`
- Oracle: `0x7627582B2183bf8327f0ead9aA1D352201c7De06`
- RiskEngine: `0xe46b428cd93faD2601070E27ca9e6197f1576268`
- DebtPool: `0x7aFe578b08ffB14EdD6457f436fe68c3282D2B68`
- LendingCore: `0x42D489D093d00522a77405E6cEaE2F4B89956C25`

Explorer verification artifact:
- `dualvm/deployments/polkadot-hub-testnet-verification.json`
- `dualvm/deployments/polkadot-hub-testnet-governance-proof.json`
- `dualvm/deployments/polkadot-hub-testnet-oracle-proof.json`
- Asset path decision: `docs/dualvm/dualvm_asset_path_decision.md`
- Recent-events snapshot artifact: `dualvm/deployments/polkadot-hub-testnet-recent-events.json`

## Network setup
- Chain: `Polkadot Hub TestNet`
- Chain ID: `420420417`
- ETH RPC: `https://eth-rpc-testnet.polkadot.io/`
- Explorer: `https://blockscout-testnet.polkadot.io/`
- Faucet: `https://faucet.polkadot.io/`
  - Network: `Polkadot testnet (Paseo)`
  - Chain: `Hub (smart contracts)`

## Demo sequence
### A. Borrow path
1. Fund the demo wallet with PAS.
2. Wrap PAS into WPAS.
3. Mint/seed USDC-test liquidity into the DebtPool.
4. Deposit WPAS as collateral.
5. Borrow USDC-test from LendingCore.
6. Show resulting balances and on-chain txs.

### B. Repay path
1. Start from an open borrow position.
2. Approve LendingCore to spend USDC-test.
3. Repay part of the debt.
4. Show before/after debt values and transaction hashes.

### C. Liquidation path
1. Start from an unhealthy borrower position.
2. Lower the oracle price to push the position below threshold.
3. Approve the liquidator’s USDC-test.
4. Execute liquidation.
5. Show before/after debt and collateral transfer.
6. Explicitly note that the bad-debt accounting bug was fixed and proven live.

## Live proof artifacts
- Borrow smoke: `dualvm/scripts/liveSmoke.ts`
- Repay smoke: `dualvm/scripts/liveRepaySmoke.ts`
- Oracle smoke: `dualvm/scripts/liveOracleSmoke.ts`
- Watch/monitor script: `dualvm/scripts/liquidationWatch.mjs`
- Liquidator operator script: `dualvm/scripts/executeLiquidation.ts`
- Liquidation smoke: `dualvm/scripts/liveLiquidationSmoke.ts`

Fresh current proof tx set from `dualvm/deployments/polkadot-hub-testnet-recent-events.json`:
- Collateral deposit: https://blockscout-testnet.polkadot.io/tx/0x5bb5a89323efb7bdb56656b20c68ea01457ddfe9506f2534c116a6ac2863a602
- Borrow: https://blockscout-testnet.polkadot.io/tx/0x658ce8b5e631c3e77d970678e14da986a87a464eca274b1a8585baa65d846ba0
- Repay: https://blockscout-testnet.polkadot.io/tx/0x924ef9d6e5e5e69de37ffcaaf6c81593b1bc496a03ec049802d80392f247e43a
- Liquidation: https://blockscout-testnet.polkadot.io/tx/0xe8d1f4e36cbbb4c829f2b4d8ee19afc48acc2975e7a29804db9b28099932cef5
- Snapshot generated at: `2026-03-15T20:16:48.142Z`

Note: the liquidation tx above is the fresh live proof anchor. The `liveLiquidationSmoke.ts` script remains an operator-grade script and should not be treated as a judge-click-safe one-button demo path without operator supervision.


## Truthful limitations to state publicly
- single market only
- manual oracle with configurable bounds and max-move circuit breaker
- mock debt asset
- operational live roles are now split with delayed minter/risk actions
- ultimate AccessManager admin is still a single EOA
- current frontend is primarily a read shell, with short-lived cache plus recent-events snapshot fallback rather than a full backend/indexer
- PVM parity exists, but live cross-VM execution is not yet proven

## What not to claim
Do not claim:
- production-ready protocol
- production-grade oracle network
- true multi-market support
- XCM in the critical lending path
- live cross-VM PVM execution if that is not what is deployed
- hardened governance if one EOA still controls multiple sensitive roles

## Current remaining closure items
- keep the operational role separation plus single-admin truth stated clearly
- keep using `docs/dualvm/dualvm_pvm_posture.md` as the single source of truth for Track 2 wording
- treat the current watcher/operator scripts and event-snapshot cache as the baseline ops layer; future production work would deepen monitoring, alerting, and indexing
