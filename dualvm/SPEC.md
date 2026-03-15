# DualVM Lending Spec Pointer

This project root spec file exists so agent and human workflows can discover the current system definition quickly.

Canonical source order:
1. `../docs/dualvm/dualvm_spec_parity_checklist.md`
2. `../docs/dualvm/dualvm_gap_closure_plan.md`
3. `../docs/dualvm/dualvm_current_state_addendum.md`
4. `../docs/dualvm/dualvm_pvm_posture.md`
5. Historical context only:
   - `../docs/dualvm/dualvm_lending_final_spec_public_rpc.md`
   - `../docs/dualvm/dualvm_lending_production_spec.md`

Current implementation truth:
- live on Polkadot Hub TestNet (`420420417`)
- public-RPC-first
- one isolated market
- WPAS collateral
- USDC-test debt asset
- manual oracle
- live supply / borrow / repay / liquidation proofs exist
- explorer verification complete
- operational roles split with delayed minter/risk actions
- PVM posture frozen at parity / bounded computation, not proven live cross-VM execution
