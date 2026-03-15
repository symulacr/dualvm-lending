# DualVM Asset Path Decision

This document closes the asset-realism question for the current hackathon build.

## Final decision
The live debt asset remains **USDC-test**, a team-controlled mock ERC-20, by deliberate design.

This is not an accidental shortcut. It is the chosen final hackathon asset path because it is more honest and more reliable than pretending a production-grade stable asset integration exists when it does not.

## Why the mock asset remains the correct current choice
### 1. Metadata truth
The original DualVM specs correctly identified that the Polkadot ERC-20 asset precompile does not expose normal ERC-20 metadata in the same way typical EVM tooling expects. The current MVP depends on:
- clean ERC-20 UX
- predictable ERC-4626-style accounting
- clear demo narration

A mock ERC-20 with explicit metadata tells the truth more reliably than forcing a half-supported asset path into the critical lending flow.

### 2. Oracle truth
The system now has a hardened manual oracle with circuit-breaker controls, but it is still not a production multi-source oracle network. Pairing a non-production oracle with a supposedly real stable asset path would create synthetic realism rather than honest realism.

### 3. Submission truth
For hackathon judging, a narrower but honest asset path is stronger than a broader but misleading one. The product story remains:
- real collateral flow
- real debt accounting
- real liquidation logic
- explicit test asset on the debt side

## What is real today
- `WPAS` is the live collateral asset path.
- `USDC-test` is the live debt and LP asset path.
- Both are deployed on the current Polkadot Hub TestNet live deployment.

## What this means for public wording
Allowed wording:
- “USDC-test mock stablecoin”
- “metadata-stable debt asset for the MVP”
- “production-minded MVP with explicit mock debt asset”

Do not say:
- “production stablecoin integration”
- “real stablecoin market”
- “native-asset universality”
- “generalized asset support”

## Upgrade path
A more production-oriented debt asset path should come only after:
1. asset selection is frozen
2. metadata handling is safe
3. oracle quality is improved beyond the current manual/circuit-breaker model
4. the UI and accounting path are adapted explicitly rather than heuristically

## Canonical implication
For the current DualVM build, asset realism is satisfied by explicit documentation and asset-registry truth, not by forcing a fake production asset path into the live system.
