# DualVM Progress Log

## Current state
- Live deployment exists on Polkadot Hub TestNet.
- Contracts are verified on Blockscout.
- Live borrow, repay, and liquidation proofs exist.
- Bad-debt liquidation accounting bug is fixed and proven live.
- Operational roles are split and delayed in practice for minter/risk actions.
- Frontend observer mode shows balances, utilization, tracked-address health factor, recent events, oracle circuit-breaker settings, and explicit asset-path truth.
- The live oracle is now a hardened manual oracle with min/max price bounds and a max-move circuit breaker.
- The asset path is explicitly documented: WPAS is the live collateral path and USDC-test remains the intentional final hackathon debt asset.
- Watchlist-based monitoring and a guarded liquidator operator script now exist.
- PVM posture is frozen as parity / bounded computation, not proven live cross-VM execution.
- Agent workflow artifacts now exist in the project root (`SPEC.md`, `features.json`, `progress.md`, `init.sh`).

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
