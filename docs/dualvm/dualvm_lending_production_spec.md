# DualVM Lending — Corrected Production-Oriented MVP Specification

Historical note: this file remains valuable as the architectural correction and rationale document, but it is not the current operational authority for the live DualVM Lending deployment. For the current network, deployment manifest, explorer verification, and active submission wording, use `README.md`, `docs/dualvm/dualvm_current_state_addendum.md`, and `docs/dualvm/dualvm_spec_parity_checklist.md`. Read the endpoint and chain assumptions here as historical design context unless the current-state files confirm them.

## Executive judgment

The earlier DualVM Lending drafts had one excellent instinct and several dangerous assumptions. The excellent instinct was architectural: keep custody, accounting, and user-facing logic on REVM, and use PolkaVM only for a narrow, deterministic computation path. Current Polkadot docs explicitly say most developers should start with REVM for simplicity and full Ethereum compatibility, while PVM is best reserved for performance-intensive workloads and is still early-stage with more limited tooling. XCM is also intentionally low-level: the XCM precompile exposes `execute`, `send`, and `weighMessage`, but the docs warn that it provides only barebones functionality and that abstractions must be built on top. That means “DualVM” is not the product. It is the implementation strategy.  

The dangerous assumptions were more serious. First, the old plan hard-coded toolchain and network values that are already stale. Current Polkadot Hardhat docs use `services.polkadothub-rpc.com/testnet` with chain ID `420420417` for the testnet path, and the current PVM setup guide points to `@parity/hardhat-polkadot@0.2.7` and `@parity/resolc@1.0.0`, not the older stack used in the prior draft. Second, the prior spec never fully resolved whether it was lending one asset against itself or building a real isolated market. A same-asset vault may compile, but it is not a credible stablecoin-enabled lending product. Third, the old plan treated native and asset-pallet tokens too casually. The ERC20 precompile maps Assets-pallet asset IDs to deterministic derived addresses, and it does **not** expose `name()`, `symbol()`, or `decimals()`. That becomes a real systems bug the moment you rely on generic ERC20 discovery in the UI, the vault, or the planner.

This corrected spec keeps the original good idea and removes the brittle parts. The product is an **isolated lending market** on Polkadot Hub. Borrowers post one collateral asset, then borrow one stable debt asset. REVM owns the vaults, positions, liquidation state, and share accounting. PVM owns only a small pure-function risk engine. XCM is not on the MVP critical path; it is a post-MVP extension once route templates and fee budgets are proven on testnet. The result is more realistic, more auditable, and far easier for an agentic coding harness to build.

## Product purpose

The product should solve one real problem: let a user lock a Polkadot-native or Hub-native collateral asset and borrow a stable asset from a pool funded by LPs. For hackathon purposes, this must be an **isolated single-market system**, not a generalized money market. One market is enough to show custody, debt accounting, liquidation, share issuance, risk pricing, and the DualVM story.

The recommended pairing is:

- **Collateral asset:** wrapped PAS or another explicitly configured asset.
- **Debt asset:** a stable asset. On testnet, this may be a mock ERC20 with correct metadata. On Hub-native production paths, this should be a registered asset reached through the ERC20 precompile or a metadata-preserving adapter.

This is the first hidden correction: if the debt asset is sourced from the ERC20 precompile, you cannot treat it like a normal ERC20 in every place. The Polkadot docs state that each Assets-pallet asset is mapped to a unique precompile address based on its asset ID, and the precompile omits `name`, `symbol`, and `decimals`. OpenZeppelin’s current ERC4626 implementation will try to read `decimals()` from the underlying asset and fall back to `18` if that read fails. That fallback is safe for compilation, but it is unsafe for assets that actually use 6 or 10 decimals. So the spec must forbid “drop an asset-precompile address directly into ERC4626 and hope it works.” Either wrap the chosen asset with a tiny metadata adapter, or use a mock stable with metadata for the MVP and reserve direct precompile integration for phase two.

## Corrected architecture

The build should use five core components.

### 1. Collateral adapter

If the collateral is the chain’s native token, create a minimal wrapper so the rest of the REVM stack can use ERC20 semantics. If the collateral is already an Assets-pallet asset, store the **asset ID** as the canonical identifier and derive the precompile address when needed. Never use the precompile address as the canonical record. This mirrors the Polkadot docs, which define the address as a deterministic transformation of the asset ID.

### 2. Debt vault

The lending pool for the stable debt asset should be an ERC4626 vault **only if the underlying asset exposes safe metadata behavior**. If the underlying stable is a mock ERC20 or a metadata adapter, ERC4626 is a strong fit because it gives standard deposit, redeem, share accounting, and composability. If the underlying asset is a raw ERC20 precompile with missing metadata, wrap it first or replace ERC4626 with an explicit share-token pattern.

This is where the old document needed its largest conceptual correction: the vault should be a vault for the **debt asset**, not for the collateral token. LPs deposit the stable debt asset. Borrowers deposit collateral separately. That makes the product a real lending primitive rather than an ambiguous same-asset loop.

### 3. Lending core

The core contract tracks positions and enforces solvency. Its job is to:

- accept collateral deposits,
- open and increase debt,
- accrue interest,
- accept repayments,
- expose health factor and liquidation state,
- call the PVM risk engine for a rate quote and risk parameters,
- re-check solvency on REVM before finalizing state changes.

The REVM contract must remain the final source of truth. The PVM component may propose a rate or threshold, but the REVM core should still reject stale or insolvent actions locally.

### 4. RiskEngine PVM

The PVM contract should be a **small stateless pure-compute module**. It should accept bounded inputs such as utilization, collateral ratio, collateral volatility bucket, and a route/oracle health flag, then return a rate quote plus max-LTV or liquidation-threshold outputs. This is exactly the kind of performance-oriented, deterministic arithmetic PVM is good at, and it avoids the deployment pitfalls the Polkadot docs describe for PVM factories, runtime code generation, and two-step deployment.

Do not put custody, governance, or storage-heavy logic into this contract. Do not use factories. Do not let the product depend on advanced PVM deployment patterns.

### 5. Oracle and configuration layer

Cross-asset lending requires price information. The earlier drafts treated this too loosely. For the MVP, use a minimal `OracleAdapter` with explicit freshness rules and a pause-on-stale policy. If no production-quality feed exists on the chosen network, use a governed manual oracle for testnet and document that this is a hackathon-only compromise. Chainlink’s own docs emphasize that developers remain responsible for feed quality, risk categorization, and appropriate protocol parameters. In production, this contract becomes the seam where better data feeds or proof systems plug in.

## Security and protocol design corrections

The access model should use OpenZeppelin’s modern access stack, not a single-owner shortcut. Their docs describe `AccessManager` as a full-fledged system-wide access control solution with hierarchical roles and execution delays, and explicitly note that `Ownable` is useful for quick tests but is likely to be outgrown by production systems. That maps perfectly to this project.

Use the following separation:

- **Emergency role:** can pause borrowing and withdrawals.
- **Risk admin role:** can update caps, thresholds, and oracle sources, but only through delays.
- **Liquidator role:** executes liquidations; cannot change parameters.
- **Treasury role:** collects reserve fees; cannot pause or rewrite risk parameters.

If governance is added later, OpenZeppelin recommends a timelock for decisions and further notes that the timelock should hold funds, ownership, and access-control roles. That is a roadmap item, not an MVP dependency.

The protocol itself should borrow three best practices from established lending systems:

- a **kinked utilization model** for borrow rates,
- explicit **supply caps / borrow caps** on the market,
- a **minimum borrow size** to avoid dust positions and pointless liquidations.

Compound III’s official docs are a good reference here: rates are driven by utilization with a “kink,” collateral factors bound borrowing power, and supply caps bound risk exposure.

For the vault, the ERC4626 inflation-attack caveat must be handled deliberately. OpenZeppelin’s docs warn that empty or nearly empty vaults are vulnerable to donation/inflation attacks and explain the mitigation through virtual shares/assets and sensible initialization. The spec should therefore require one of two launch conditions: seed the vault with non-trivial initial liquidity, or use the default virtual-offset behavior with a documented initialization floor and minimum first deposit.

## Frontend, watcher, and infrastructure

The frontend should use a standard EVM stack: Next.js or React with Wagmi v3, Viem, and a small asset registry JSON. Polkadot’s docs already show Wagmi integration patterns for Hub contracts, so there is no need to invent a custom frontend stack.

The watcher is **must-ship**, not optional. It should expose exactly four outputs:

- current collateral and debt balances,
- market utilization,
- user health factor,
- latest contract events and liquidation notices.

A small indexer or polling service is enough for the MVP. The point is not perfect observability; it is making the product feel real instead of static.

For infrastructure, do not assume a small VPS can also host a production-grade Polkadot Hub RPC. The official node guide lists 64 GB RAM minimum and roughly 1.2 TB NVMe for archive use, with 200 GB even for pruned operation. So the build plan must separate two concerns: use hosted RPC or the official testnet endpoint during development, and only self-host an RPC if the team actually provisions the required machine class. A cheap VPS is a good place to run the agent harness, the web app, and CI jobs. It is not automatically a good place to run a Hub RPC.

## Agent-executable delivery model

A 12–24 hour autonomous coding run is realistic for the **hackathon MVP**, not for a production-ready protocol. Anthropic’s long-running-agent guidance is explicit: agents fail when asked to one-shot a complex app, and do better with an initializer session, a feature list where every feature begins as failing, and subsequent sessions that work on one feature at a time while leaving clear artifacts and git commits.

So the repository must contain:

- `SPEC.md` — this document,
- `CLAUDE.md` — project memory and operating rules,
- `features.json` — granular feature list with pass/fail flags,
- `progress.md` — short handoff log,
- `init.sh` — one command to install, test, and run the app.

That structure works well with Claude Code and is also understandable to any agentic CLI that can read files, run shell commands, and commit to git. The harness should stop after each passing feature, not loop endlessly toward a vague notion of “finished.”

## Definition of done

The MVP is done when it can do the following on the current Polkadot testnet:

1. LP deposits the stable debt asset and receives vault shares.
2. Borrower deposits collateral and opens a debt position.
3. LendingCore calls RiskEngine PVM and persists the returned rate path.
4. Repayment reduces debt correctly.
5. Liquidation works when the health factor falls below threshold.
6. Contracts are verified on the explorer.
7. The UI shows balances, utilization, health factor, and recent events.
8. The repository contains agent-readable instructions and a reproducible demo flow.

That is enough to submit a credible hackathon build and also enough to prove the architecture is viable.

## Curated reading and reference links

- Polkadot Dual VM stack: https://docs.polkadot.com/smart-contracts/for-eth-devs/dual-vm-stack/
- Polkadot contract deployment differences: https://docs.polkadot.com/smart-contracts/for-eth-devs/contract-deployment/
- Polkadot Hardhat guide: https://docs.polkadot.com/smart-contracts/dev-environments/hardhat/
- Polkadot ERC20 precompile: https://docs.polkadot.com/smart-contracts/precompiles/erc20/
- Polkadot XCM precompile: https://docs.polkadot.com/smart-contracts/precompiles/xcm/
- Polkadot Hub RPC guide: https://docs.polkadot.com/node-infrastructure/run-a-node/polkadot-hub-rpc/
- OpenZeppelin Access docs: https://docs.openzeppelin.com/contracts/5.x/api/access
- OpenZeppelin ERC4626 guide: https://docs.openzeppelin.com/contracts/5.x/erc4626
- OpenZeppelin governance/timelock guide: https://docs.openzeppelin.com/contracts/5.x/governance
- Compound III collateral docs: https://docs.compound.finance/collateral-and-borrowing/
- Compound III interest-rate docs: https://docs.compound.finance/interest-rates/
- Chainlink feed risk guidance: https://docs.chain.link/data-feeds/selecting-data-feeds
- Anthropic long-running agent harnesses: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Claude Code overview: https://code.claude.com/docs/en/overview
