# DualVM Progress Log

## Current state
- Live deployment exists on Polkadot Hub TestNet.
- Contracts are verified on Blockscout for the earlier public deployment; the newer versioned deployment is live but not yet verified in this session.
- Live borrow, repay, and liquidation proofs exist.
- Bad-debt liquidation accounting bug is fixed and proven live.
- Operational roles are split and delayed in practice for the earlier deployment; the latest versioned proof deployment uses zero delays for direct execution proof.
- Frontend observer mode shows balances, utilization, tracked-address health factor, recent events, oracle circuit-breaker settings, and explicit asset-path truth.
- The product path now has `oracleEpoch`, `configEpoch`, ticketed `RiskAdapter` quote consumption, and a live external PVM quote engine.
- A `MarketVersionRegistry` now exists and version activation is the governance boundary for market replacement.
- A fresh versioned market deployment exists in `deployments/polkadot-hub-testnet-versioned.json`.
- VM interop proof exists in `docs/dualvm/dualvm_vm_interop_proof.md`.
- Versioned market proof exists in `docs/dualvm/dualvm_versioned_market_proof.md`.
- Agent workflow artifacts exist in the project root (`PLAN.md`, `SPEC.md`, `features.json`, `progress.md`, `init.sh`).

## Most important open gaps
1. Ultimate AccessManager admin is still a single EOA rather than a multisig or timelocked governance layer
2. Multi-source / decentralized oracle path beyond the current hardened manual oracle
3. RPC and indexing resilience

## Canonical docs
- `SPEC.md`
- `../docs/dualvm/dualvm_spec_parity_checklist.md`
- `../docs/dualvm/dualvm_gap_closure_plan.md`
- `../docs/dualvm/dualvm_current_state_addendum.md`
- `../docs/dualvm/dualvm_pvm_posture.md`
- `../docs/dualvm/dualvm_asset_path_decision.md`
