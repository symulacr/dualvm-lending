# Sentinel TreasuryOS 2.0 — Corrected Production-Ready Hackathon Specification

## Executive judgment

The original Sentinel TreasuryOS specification had the best product instinct in the entire project line. It did **not** treat PolkaVM as a trophy. It did **not** make XCM the center of the MVP. It did **not** hand custody to an autonomous agent. And it did **not** pretend a one-week hackathon build should contain fake governance theater or “full automation.” The core shape — immutable treasury kernel, constrained policy layer, AI as advisor rather than operator — is still the right architecture.

What broke the first version was not the concept. It was a cluster of missing owners around integration details. Current Polkadot docs confirm the most important pressure points. The XCM precompile is intentionally barebones and requires developers to build their own abstractions. The ERC20 precompile maps Assets-pallet asset IDs to deterministic derived addresses, not to ordinary token deployments, and it omits `name`, `symbol`, and `decimals`. Polkadot’s own smart-contract docs continue to recommend REVM as the default path for most teams, while treating PVM as an optional path for performance-intensive workloads with more limited tooling. OpenZeppelin’s current access-control guidance also matters here: `AccessManager` is the system-level production option, whereas `Ownable` is explicitly described as a convenience likely to be outgrown in real systems.

This corrected spec keeps the original architecture and closes the gaps. Sentinel is a treasury operating system for DAOs, collectives, grant programs, and teams that hold stable assets on Polkadot Hub. An off-chain planner proposes actions; a local preflight mirror explains failures before signing; an on-chain policy engine enforces hard constraints; and an execution layer handles either local transfers or one small set of pre-approved XCM routes. The product is advisory and policy-driven, not autonomous custody.

## What the product is and is not

Sentinel should help a treasury do three things safely:

1. maintain balances and quotas across approved assets,
2. execute governed payroll or grant disbursements,
3. rebalance between pre-approved local or cross-chain destinations.

The MVP should **not** attempt arbitrary portfolio management, dynamic route discovery, autonomous market-making, or free-form XCM composition. The product is not “AI controls the treasury.” The product is “AI drafts a proposal, humans sign, and policy decides.”

That distinction matters for both security and judging. It gives a clear user story, a clear risk boundary, and a clear demo: one treasury, one proposal, one preflight explanation, one on-chain approval path, one watcher view, and at most one XCM route.

## The four confirmed gaps and the architectural fixes

### Gap 1 — XCM encoding had no owner

Your correction is right. The XCM precompile exposes low-level `execute`, `send`, and `weighMessage`, and the docs explicitly say developers must build abstractions on top. Therefore the route layer cannot be treated as an implementation detail. It must be a first-class workstream.

**Correction:** add a `RouteBook` and make it a Day 1 gate. Every supported route is a committed fixture with:

- destination description,
- encoded destination bytes,
- encoded message bytes,
- `weighMessage` output,
- fee asset,
- maximum allowed refTime/proofSize with a safety margin,
- semantic label such as `PayrollToChainA` or `RebalanceToHubB`.

`XcmAdapter` never accepts arbitrary bytes from the planner or the UI. It only executes a referenced route template plus parameter slots that the route designer intended to vary.

### Gap 2 — ERC20 precompile addresses are derived, not canonical

This is also correct. Polkadot’s ERC20 precompile docs state that assets are mapped to deterministic precompile addresses based on asset ID, and even provide the address format and examples.

**Correction:** create an `AssetRegistry` whose canonical key is `assetId`, not token address. The registry stores:

- asset ID,
- derived precompile address,
- symbol,
- decimals,
- category,
- fee-eligible flag,
- quota bucket,
- route eligibility.

All contracts, watchers, and UI components resolve assets through this registry. This avoids a silent class of bugs where two layers disagree about the “same” asset because one stores an address and another stores an ID.

### Gap 3 — Watcher was marked optional

A treasury UX without live state is a mockup. The watcher is not a nice-to-have.

**Correction:** the watcher becomes a must-ship component with a deliberately narrow scope. It exposes:

- current treasury balances by registered asset,
- quota utilization by policy bucket,
- pending and completed executions,
- the last five contract events.

That is enough to prove reality without overbuilding indexer infrastructure.

### Gap 4 — AI planner had no pre-flight rejection path

An advisory system that only explains failure after an on-chain revert is not useful.

**Correction:** build a deterministic JavaScript preflight mirror of the core policy invariants. Before a user signs or submits, the planner calls preflight and shows a human-readable explanation such as “stablecoin quota exceeded,” “route disabled,” “amount below payroll minimum,” or “stale route weight quote.” The contract still enforces the real rule; preflight exists to improve comprehension and reduce failed transactions.

## Additional hidden gaps

The original document still had several hidden faults beyond those four.

### Hidden gap 5 — Asset metadata was assumed to exist on ERC20 precompiles

Polkadot’s ERC20 precompile does not implement `name()`, `symbol()`, or `decimals()`. Any UI, watcher, planner, or generic token helper that assumes those calls exist will either revert or silently mislabel balances.

**Correction:** `AssetRegistry` must be the source of display metadata. The UI and watcher should never discover asset metadata by probing the precompile directly.

### Hidden gap 6 — XCM settlement was treated as synchronous

A local transfer updates balances immediately. An XCM `send` initiates a cross-chain message, which means the treasury must track **pending** operations until they are confirmed or timed out. If you deduct quota only on final settlement, users can oversubscribe the same route. If you deduct balances as if settlement were final, the dashboard lies.

**Correction:** add an `ExecutionLedger` or `Outbox` table. Every XCM action gets a request ID, status, route ID, reserved amount, and timestamps. Quotas reserve funds on submission and release them on success, failure, or expiry. The watcher must display pending items distinctly from settled balances.

### Hidden gap 7 — Route fee budgeting was never formalized

The XCM precompile includes `weighMessage` for a reason. A route that only stores bytes but not a validated weight budget is incomplete.

**Correction:** each `RouteBook` entry stores the most recent `weighMessage` output plus a governance-defined margin. Preflight surfaces the expected weight budget and the selected fee asset. On-chain policy refuses execution if the route’s stored budget is missing or disabled.

### Hidden gap 8 — Proposal authorization lacked replay protection

An AI proposal without nonces, deadlines, and domain separation is not a proposal system; it is a replay surface.

**Correction:** all proposed actions use typed structured data with explicit chain ID, treasury address, route ID, asset IDs, amount, recipient, nonce, and deadline. Use OpenZeppelin’s cryptography stack for EIP-712-style hashing and signature validation, and use their nonce utilities to prevent replay. If smart-account signers are allowed later, `SignatureChecker` supports both EOAs and ERC-1271 wallets.

### Hidden gap 9 — Role separation was underspecified

A treasury product fails operationally when the same role can pause, change quotas, add routes, and move assets.

**Correction:** split roles using `AccessManager`:

- **Pause Guardian:** may pause execution paths.
- **Policy Admin:** may change quotas, limits, and registry flags with delays.
- **Route Admin:** may add or disable route templates with delays.
- **Treasury Executor:** may execute approved proposals only.
- **Watcher Maintainer:** off-chain only; no on-chain privileges.

If governance is added later, use a timelock. OpenZeppelin recommends timelocks for governance decisions and notes that the timelock should hold funds, ownership, and access-control roles.

## Locked architecture

The corrected Sentinel stack has seven components.

### 1. TreasuryKernel (REVM)

The immutable kernel holds assets and exposes a minimal execution surface. It does not contain AI logic. It does not encode raw XCM. It only executes proposals that have survived policy checks.

### 2. PolicyEngine (REVM)

This contract enforces hard invariants:

- asset allowlist,
- per-asset quotas,
- per-route quotas,
- maximum single transfer size,
- stable-only payroll buckets,
- deadline and nonce checks,
- emergency pause checks.

It should be deterministic and boring.

### 3. AssetRegistry (REVM)

Canonical store for asset IDs, derived precompile addresses, metadata, categories, and fee eligibility. This is mandatory because the precompiles are deterministic projections of asset IDs and do not expose normal metadata.

### 4. RouteBook + XcmAdapter (REVM)

`RouteBook` stores only pre-approved route fixtures. `XcmAdapter` executes those fixtures and nothing else. Arbitrary bytes from a planner, UI, or signer are banned.

### 5. ProposalVerifier (REVM)

Verifies typed signed proposals, increments nonces, and feeds validated payloads into `PolicyEngine`. This is where typed data, deadlines, and replay prevention live.

### 6. Planner + Preflight (off-chain)

The planner may use an LLM or rule engine to suggest payroll batches and rebalances, but it must output a typed proposal structure. Preflight runs before signing and renders human-readable reasons for failure.

### 7. Watcher (off-chain)

Indexes balances, quotas, pending executions, and recent logs. Without it, the product is not credible.

## Scope discipline for the MVP

The must-ship MVP should be frozen to:

- one treasury,
- two registered assets maximum,
- one local execution path,
- one XCM route maximum,
- one payroll batch flow,
- one rebalance flow,
- one watcher page,
- one preflight explanation layer.

Everything else is roadmap. That includes autonomous scheduling, route discovery, smart governance, dynamic multi-chain netting, or more than one XCM route family.

## Build and testing plan for agentic coding

This product is suitable for a long-running coding agent **only if** the harness is feature-gated. Anthropic’s long-running-agent guidance is very clear: do not ask the agent to one-shot the app. Use an initializer session, a failing feature list, and one-feature-at-a-time progress with git commits and handoff artifacts. Claude Code’s current docs also confirm that `CLAUDE.md` is the project-level memory file it reads at the start of each session.

The repository therefore needs:

- `SPEC.md` — this document,
- `CLAUDE.md` — coding rules and architecture constraints,
- `features.json` — every feature starts as failing,
- `routes/` — committed route fixtures and weight budgets,
- `assets.json` — committed asset registry seed,
- `progress.md` — session handoffs,
- `init.sh` — one command to install and run.

A 12–24 hour autonomous VPS run is realistic for the hackathon MVP, especially because the architecture is narrow. It is **not** a substitute for economic review, audit, or production operations.

## Definition of done

Sentinel MVP is done when it can:

1. register approved assets by asset ID,
2. resolve derived precompile addresses and metadata from the registry,
3. show live treasury balances and quotas in the watcher,
4. generate a typed proposal off-chain,
5. explain rejection in preflight before signing,
6. submit and execute one approved local action,
7. submit one approved XCM action using a committed route fixture,
8. track the XCM action in the outbox as pending then completed,
9. verify contracts and produce a short demo.

## Curated reading and reference links

- Polkadot Dual VM stack: https://docs.polkadot.com/smart-contracts/for-eth-devs/dual-vm-stack/
- Polkadot XCM precompile: https://docs.polkadot.com/smart-contracts/precompiles/xcm/
- Polkadot ERC20 precompile: https://docs.polkadot.com/smart-contracts/precompiles/erc20/
- Polkadot Hardhat guide: https://docs.polkadot.com/smart-contracts/dev-environments/hardhat/
- Polkadot Hub overview: https://docs.polkadot.com/reference/polkadot-hub/
- OpenZeppelin access docs: https://docs.openzeppelin.com/contracts/5.x/api/access
- OpenZeppelin utilities docs: https://docs.openzeppelin.com/contracts/5.x/api/utils
- OpenZeppelin cryptography docs: https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography
- OpenZeppelin governance/timelock guide: https://docs.openzeppelin.com/contracts/5.x/governance
- Anthropic long-running harness guide: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Claude Code overview: https://code.claude.com/docs/en/overview
- Claude Code common workflows: https://code.claude.com/docs/en/common-workflows
