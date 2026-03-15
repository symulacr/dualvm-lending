# DualVM Lending

DualVM Lending is a public-RPC-first isolated lending market on Polkadot Hub TestNet. It uses Solidity and OpenZeppelin primitives for custody, accounting, and access control on REVM, while keeping a bounded PVM risk-computation path available for Track 2 parity work.

This repository currently contains a live public-testnet deployment, smoke-tested lending flows, and a documented gap-closure plan.

## Current live network
- Network: `Polkadot Hub TestNet`
- Chain ID: `420420417`
- ETH RPC: `https://eth-rpc-testnet.polkadot.io/`
- Fallback RPC: `https://services.polkadothub-rpc.com/testnet/`
- Explorer: `https://blockscout-testnet.polkadot.io/`
- Faucet: `https://faucet.polkadot.io/`
  - Network: `Polkadot testnet (Paseo)`
  - Chain: `Hub (smart contracts)`

## Current live deployment
- AccessManager: [`0x06Ca684578a01d6978654A4572B6A00Abe934575`](https://blockscout-testnet.polkadot.io/address/0x06Ca684578a01d6978654A4572B6A00Abe934575#code)
- WPAS: [`0x0Dece14653B651Ee10df0bBcb286C9170A24e1bc`](https://blockscout-testnet.polkadot.io/address/0x0Dece14653B651Ee10df0bBcb286C9170A24e1bc#code)
- USDCMock: [`0x789cf6A8B73Eab267C6B0eEa0E38fbE2AcD0Caf4`](https://blockscout-testnet.polkadot.io/address/0x789cf6A8B73Eab267C6B0eEa0E38fbE2AcD0Caf4#code)
- ManualOracle: [`0x7627582B2183bf8327f0ead9aA1D352201c7De06`](https://blockscout-testnet.polkadot.io/address/0x7627582B2183bf8327f0ead9aA1D352201c7De06#code)
- PvmRiskEngine: [`0xe46b428cd93faD2601070E27ca9e6197f1576268`](https://blockscout-testnet.polkadot.io/address/0xe46b428cd93faD2601070E27ca9e6197f1576268#code)
- DebtPool: [`0x7aFe578b08ffB14EdD6457f436fe68c3282D2B68`](https://blockscout-testnet.polkadot.io/address/0x7aFe578b08ffB14EdD6457f436fe68c3282D2B68#code)
- LendingCore: [`0x42D489D093d00522a77405E6cEaE2F4B89956C25`](https://blockscout-testnet.polkadot.io/address/0x42D489D093d00522a77405E6cEaE2F4B89956C25#code)

Verification artifact:
- `dualvm/deployments/polkadot-hub-testnet-verification.json`
- Governance proof artifact: `dualvm/deployments/polkadot-hub-testnet-governance-proof.json`
- Oracle proof artifact: `dualvm/deployments/polkadot-hub-testnet-oracle-proof.json`
- Recent-events snapshot artifact: `dualvm/deployments/polkadot-hub-testnet-recent-events.json`

## What is proven live today
- LP liquidity seed into the debt pool
- PAS -> WPAS wrapping
- collateral deposit into LendingCore
- borrow flow
- repay flow
- liquidation flow, including a bad-debt path after the accounting fix
- hardened oracle upgrade and circuit-breaker proof

Live scripts:
- Borrow smoke: `dualvm/scripts/liveSmoke.ts`
- Repay smoke: `dualvm/scripts/liveRepaySmoke.ts`
- Liquidation smoke: `dualvm/scripts/liveLiquidationSmoke.ts`

## Architecture in one paragraph
- `WPAS` wraps native PAS into ERC-20 semantics.
- `USDCMock` is the metadata-stable debt asset for the MVP.
- `DebtPool` is an ERC-4626-style liquidity pool for LPs.
- `LendingCore` stores collateral and debt positions, enforces solvency, and drives borrow/repay/liquidation.
- `ManualOracle` provides controlled testnet price updates with freshness checks plus a configurable circuit breaker.
- `DualVMAccessManager` gates admin functions.
- `PvmRiskEngine` provides a bounded risk-computation module; the current live path is still REVM-centric and should not be described as proven live cross-VM execution.
- Final PVM wording is frozen in `docs/dualvm/dualvm_pvm_posture.md`.

## Current truth and limitations
This is a production-minded MVP, not a production-ready protocol.

Important current limits:
- single isolated market only
- manual oracle with configurable bounds and max-move circuit breaker
- operational roles are now split across distinct addresses
- risk, treasury, and minter actions now execute with 5-second AccessManager delays
- ultimate AccessManager admin is still a single EOA rather than a multisig
- frontend is primarily an observer/read shell today
- the observer layer now uses a short-TTL cache and a recent-events snapshot fallback for resilience against public-RPC hiccups
- the PVM story is parity-oriented, not yet proven as live cross-VM execution
- no XCM in the critical lending path

## Repository map
- Live app and contracts: `dualvm/`
- Historical specs and current documentation: `docs/dualvm/`
- Current-state addendum: `docs/dualvm/dualvm_current_state_addendum.md`
- Spec parity checklist: `docs/dualvm/dualvm_spec_parity_checklist.md`
- Gap closure plan: `docs/dualvm/dualvm_gap_closure_plan.md`
- Workflow artifacts: `dualvm/SPEC.md`, `dualvm/features.json`, `dualvm/progress.md`, `dualvm/init.sh`
- Asset path decision: `docs/dualvm/dualvm_asset_path_decision.md`

## Local developer commands
From `dualvm/`:
- `npm test`
- `npm run build`
- `npm run deploy:testnet`
- `npm run verify:testnet`
- `npm run repay-smoke:testnet`
- `npm run risk-smoke:testnet`
- `npm run oracle-smoke:testnet`
- `npm run minter-smoke:testnet`
- `npm run watch:testnet`
- `npm run index-events:testnet`
- `npm run liquidate:testnet`
- `./init.sh`

## Demo path
1. Fund a wallet with PAS from the official faucet.
2. Wrap PAS into WPAS.
3. Seed the DebtPool with USDC-test.
4. Deposit WPAS collateral into LendingCore.
5. Borrow USDC-test.
6. Repay or push the position underwater and liquidate.
7. Confirm state on Blockscout and in the frontend/read layer.

## Submission framing
The strongest honest framing is:

> DualVM Lending is a public-RPC-first isolated lending market on Polkadot Hub TestNet. It uses Solidity and OpenZeppelin security patterns for custody and accounting on REVM, with a bounded PVM-aligned risk-computation module. The current live deployment demonstrates the lending MVP on-chain and preserves an honest Track 2 story through real PVM parity artifacts and risk-engine design, without claiming proven live cross-VM execution in the solvency-critical path.

For a more detailed demo and submission guide, see:
- `docs/dualvm/dualvm_submission_demo_guide.md`
- `docs/dualvm/dualvm_pvm_posture.md`
