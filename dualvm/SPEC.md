# DualVM Lending — System Specification

Full architecture documentation is in **[README.md](../README.md)**, which covers: contract architecture, Mermaid diagrams, canonical deployment addresses, market parameters, interest rate model, OpenZeppelin integration, PVM interop proof stages, and known limitations.

## Canonical Deployment

**Network**: Polkadot Hub TestNet (chain ID `420420417`)  
**Manifest**: `deployments/polkadot-hub-testnet-canonical.json`  
**Governance root**: Governor → TimelockController → AccessManager  
**Deployer has no residual roles** — admin renounced after bootstrap.

## PVM Interop Verdicts

Probe verdicts: **A=true** (REVM→PVM compute), **B=true** (roundtrip settlement), **C=true** (callback proven in earlier runs), **D=false** (interop is defensible).

- Stage 2 (PVM→REVM callback) reverts on the public testnet — platform-level cross-VM callback limitation.
- Stage 3 (roundtrip settlement) shows accumulated on-chain state from multiple probe runs; PVM-derived quote values are correct.

Canonical artifact: `deployments/polkadot-hub-testnet-probe-results.json`
