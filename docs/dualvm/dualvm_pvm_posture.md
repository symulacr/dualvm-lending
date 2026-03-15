# DualVM Final PVM Posture

This file freezes the truthful Track 2 / PVM wording for the current DualVM Lending build.

## Final decision
DualVM Lending stops at **PVM parity / bounded computation posture** for the current hackathon build.

It does **not** claim proven live cross-VM PVM execution in the deployed solvency-critical path.

## What is true today
- The protocol is live on Polkadot Hub TestNet.
- The lending system is real and smoke-tested on-chain.
- The risk engine logic exists as a bounded stateless module.
- A PVM artifact is generated for the risk engine.
- The live deployed LendingCore calls a RiskEngine contract and persists risk-derived values.
- The current live deployment does **not** prove that the lending protocol depends on a live cross-VM REVM -> PVM invocation path.

## Canonical wording
Use this wording in README, demo, and submission text:

> DualVM Lending is a public-RPC-first isolated lending market on Polkadot Hub TestNet. It uses Solidity and OpenZeppelin security patterns for custody and accounting on REVM, with a bounded PVM-aligned risk-computation module. The current live deployment demonstrates the lending MVP on-chain and preserves an honest Track 2 story through real PVM parity artifacts and risk-engine design, without claiming proven live cross-VM execution in the solvency-critical path.

## Wording rules
### Allowed claims
- bounded PVM risk-computation module
- PVM artifact generation exists
- Track 2 parity story
- REVM-centered solvency and custody
- no claim that the system depends on cross-VM execution for correctness

### Forbidden claims
Do not say:
- the live deployment is a proven cross-VM lending protocol
- the current deployed solvency path executes through PVM live
- PVM is already the authoritative execution path for liquidations or borrow checks
- the product is fully DualVM in deployed execution semantics if that has not been proven on-chain

## Future upgrade path
If true live cross-VM invocation is implemented and proven later, this file should be replaced with a new current-state statement and the README/submission guide should be updated in the same change.
