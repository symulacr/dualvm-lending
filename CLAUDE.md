# DualVM project memory

## Scope and source priority
1. `docs/dualvm/dualvm_lending_final_spec_public_rpc.md` is still the main product-shape spec, but its Passet Hub endpoint assumptions are stale relative to the live official docs.
2. `docs/dualvm/dualvm_lending_production_spec.md` remains the architectural correction and rationale document.
3. `docs/dorahacks_submission_playbook_polkadot_2026.md` still governs submission framing, judging posture, and repo/demo expectations, but its explicit Passet Hub endpoint references are also stale.
4. Current live network source of truth for implementation is `https://docs.polkadot.com/smart-contracts/connect/`.
5. Ignore `docs/sentinelos/` for DualVM planning unless explicitly requested.

## Locked product decisions
- Build one isolated lending market only.
- REVM owns custody, accounting, and solvency checks.
- PVM is a narrow stateless risk engine or a parity/fallback module if direct cross-VM invocation proves brittle.
- Current primary network: Polkadot Hub TestNet ETH-RPC `https://eth-rpc-testnet.polkadot.io/`, chain ID `420420417`.
- Current fallback RPC: `https://services.polkadothub-rpc.com/testnet/` on the same chain ID `420420417`.
- Current explorer: `https://blockscout-testnet.polkadot.io/`.
- Faucet: `https://faucet.polkadot.io/` with Network `Polkadot testnet (Paseo)` and Chain `Hub (smart contracts)`.
- Collateral asset: `WPAS`.
- Debt asset: `USDC-test`, a team-controlled mock ERC-20 with explicit metadata and 18 decimals.
- Oracle: governed manual price feed with freshness enforcement.
- XCM is out of the MVP critical path.
- Infrastructure is public-RPC-first with a Vercel-hosted frontend and no local Polkadot node requirement.

## Security and protocol guardrails
- Prefer OpenZeppelin `AccessManager` over a single-owner pattern.
- Sensitive risk/admin changes should be delayed.
- If ERC-4626 is used for the debt pool, preserve OpenZeppelin's inflation-attack protections; initial seeding is a local policy choice, not a direct OZ requirement.
- Core MVP parameters should include at least: collateral factor / max LTV, liquidation threshold, liquidation bonus, reserve factor, supply cap, minimum borrow size, and a kinked utilization model.
- The cited Compound docs directly support collateral factors, supply caps, minimum borrow size, and kinked utilization. They do not directly support a borrow-cap claim from those exact citations.
- Oracle policy must include stale-data rejection or pause behavior. A manual oracle is acceptable for the hackathon MVP but must never be presented as a production oracle network.

## Submission posture
- Pitch the product as a production-minded, public-testnet-validated MVP, not as production-ready.
- Track 1 story: stablecoin-enabled DeFi application.
- Track 2 story: truthful PVM risk computation, not decorative PVM theater.
- OpenZeppelin story: real use of `AccessManager`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, and deliberate ERC-4626 edge-case handling if used.
- README, demo, and submission text must all tell the same story.
- Emphasize live deployment, explorer verification, demoability, documentation, active commit history, and explicit scope discipline.

## Source-verified caveats
- A faucet attempt visible on Paseo Asset Hub via `polkadotXcm.limitedTeleportAssets` failed with `polkadotXcm.SendFailure`; do not assume a faucet explorer link means funds arrived.
- The current official smart-contract testnet is observed through `eth-rpc-testnet.polkadot.io` / `blockscout-testnet.polkadot.io`, not the older unresolved `testnet-passet-hub-*` hosts.
- The faucet accepts both `0x...` and SS58 addresses, but stale bookmarked URLs with `?parachain=1111` can silently force the wrong teleport route.
- Public ETH-RPC rate limiting has been reported publicly; frontend reads should be conservative and integration tests should be sparse.
- The Polkadot ERC-20 precompile does not implement `name()`, `symbol()`, or `decimals()`. Do not use raw precompile assets in metadata-sensitive UI or ERC-4626 flows without an adapter/wrapper.
- The XCM precompile is intentionally barebones (`execute`, `send`, `weighMessage`) and requires SCALE-encoded payloads plus app-level abstractions.
- DoraHacks rules/details pages are dynamic and can drift; preserve your own archived snapshot or screenshots if submission rules matter to the plan.
- Claude auto memory is machine-local and not a substitute for checked-in project context.

## Planning instructions
- Reconfirm the official `smart-contracts/connect` page before live deployment in case endpoints drift again.
- Use this file as persistent planning context before touching code or writing a project plan.
- Do not broaden scope into multi-market lending, raw asset-precompile debt assets, XCM-critical flows, or autonomous protocol claims during the hackathon MVP.
