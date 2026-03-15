# Sentinel TreasuryOS 2.2 — Public-RPC-First Final Build Specification

## 1. Executive verdict

Sentinel remains the strongest product concept in the entire project line. The architecture is fundamentally right: an immutable or tightly scoped treasury kernel, a constrained on-chain policy layer, and an AI system that acts only as an advisor and proposal generator rather than as an autonomous custodian. That shape is good not because it sounds sophisticated, but because it maps to how treasury software should actually behave. It preserves human control, gives policy a hard execution boundary, and turns AI into a force multiplier rather than a trust assumption.

The first Sentinel spec succeeded because it avoided nearly every trap that broke the earlier lending drafts. It did not overclaim PVM. It did not make raw XCM bytes the center of the story. It did not let an AI agent move funds directly. It did not pad the roadmap with fake milestones. Those instincts were correct and survive unchanged.

What needed fixing was operational ownership. The previous spec left too much crucial work in the category of “we will probably handle this later.” That is how agent builds fail. XCM encoding had no human owner. Asset IDs and precompile addresses were not made canonical in the data model. The monitoring layer was treated as if it implied a separate service. The planner did not explain rejections before the user signed. The stable-asset decision was still open. Those are not polish issues. They are build blockers.

This final version corrects them and adds the remaining hidden gaps that would still have caused trouble on a small VPS using public RPC. Most importantly, it turns Sentinel into a public-RPC-first, feature-gated product. The MVP assumes no local Polkadot chain, no self-hosted archive node, and no heavy backend stack. It assumes public testnet deployment on official Passet Hub infrastructure, a team-controlled mock stablecoin for deterministic metadata, and one mandatory human-prepared XCM route fixture before agent work begins. If that fixture does not exist, the spec defines a graceful fallback path instead of letting the whole project collapse.

That is good mission planning. A hackathon build should not be judged by the number of systems it names. It should be judged by whether the named systems can be built, tested, explained, and demonstrated under the constraints that actually exist.

## 2. Product thesis and why it matters

Sentinel TreasuryOS is treasury execution software for DAOs, collectives, grant operators, and small on-chain teams that hold stable assets and need operational discipline. The product is not a general AI agent, not a cross-chain route marketplace, and not a governance token wrapper. It is a safer treasury operator.

The core problem is simple. Treasuries routinely need to review balances, create payments, schedule disbursements, rebalance between allowed destinations, and document why a transfer was approved. Today those tasks are often spread across wallets, spreadsheets, ad hoc scripts, and human memory. Sentinel turns them into a governed flow: the planner suggests, the preflight explains, the user signs, and the policy layer either permits or rejects.

That maps unusually well to the Polkadot Solidity Hackathon. For Track 1 it is an AI-powered decentralized application that is also stablecoin-enabled. For Track 2 it can become a real Polkadot-native submission by using native assets or the XCM precompile through a tightly controlled adapter and route book. For the OpenZeppelin sponsor track it has a natural security story: role-separated access control, paused emergency paths, typed signed proposals, and documented contract composition that goes far beyond deploying a token.

It also follows a pattern that past strong hackathon winners share: hard infrastructure disguised as a simple product. Sentinel looks like treasury software, but underneath it is a portable execution kernel plus a policy engine plus a route management system. That is exactly the kind of primitive that can survive beyond a hackathon if it is built honestly.

## 3. What is good and what is bad about the mission planning

The good part of the mission planning is conceptual discipline. The final purpose is strong. It serves a real operational need. It has a user flow judges can understand. It gives AI a meaningful but bounded role. It creates a credible path to grants or follow-on funding because it looks like reusable treasury infrastructure, not like a one-off event gimmick.

The bad part, if left unchecked, is still classic hackathon scope inflation. Treasury systems tempt builders to add governance, scheduling, accounting, payroll, vesting, reporting, cross-chain routing, and AI autonomy all at once. That is exactly how a submission becomes impressive on paper and brittle in reality. The mission planning must stay anchored to a single promise: one treasury, one stable asset, one proposal format, one local execution path, and at most one pre-verified XCM route. Every additional ambition should be treated as roadmap until the basic loop is live.

A second weakness is operational romanticism around agentic coding. An instruction like “let a coding agent run nonstop for 12–24 hours and build everything” sounds productive, but modern best practice says the opposite. Long-running agents work best with harnesses, phase boundaries, project memory, acceptance tests, and explicit human gates. Sentinel especially needs this because one critical piece of the system, the XCM route fixture, is not agent work. It is human preparation work on a live testnet.

A third weakness is infrastructure fantasy. A 4 CPU, 8 GB RAM VPS is enough for a coding harness and frontend development. It is not a comfortable environment for running Polkadot Hub infrastructure. The build must assume public RPC and should not quietly reintroduce heavy infra obligations later.

## 4. Runtime model: what runs where

The runtime map is deliberately minimal.

On Parity-operated public infrastructure live the things the project consumes but does not operate:

- the Passet Hub blockchain itself,
- the public RPC and ETH-RPC endpoints,
- the public Blockscout explorer for contract verification and transaction traces,
- the official faucet that provides PAS for the smart-contracts test chain.

On your infrastructure, the only mandatory hosted application is the frontend that judges visit. That frontend can live on Vercel’s free tier. There is no local Polkadot node at any point, no private chain, no self-hosted archive service, no chain sync, and no requirement to run infrastructure that exceeds a small VPS budget.

This distinction matters because it changes how the system should be engineered. The product cannot depend on background jobs that assume private node access. It cannot depend on local-chain-only test harnesses. It must behave well with public RPC, explorer links, and a browser-first demo path.

## 5. Infrastructure model: public RPC only, official endpoint first

The MVP must assume public testnet infrastructure, and it must do so consistently from the first commit onward.

The primary EVM endpoint for this specification is the official Passet Hub Ethereum RPC endpoint:

- `https://testnet-passet-hub-eth-rpc.polkadot.io`
- Chain ID: `420420422`

That should be the primary endpoint in the repository, the README, the frontend configuration, and the DoraHacks submission. The older `https://services.polkadothub-rpc.com/testnet` endpoint with chain ID `420420417`, which still appears in current Hardhat examples, may be documented as a compatibility fallback for development if a tool lags behind the newer official endpoint. It should not be the primary network narrative for the submission.

This public-RPC-only stance is not optional. The official Polkadot guidance for running a production-style Polkadot Hub RPC node calls for far more hardware than the target VPS provides. The project should benefit from that guidance, not fight it.

Public RPC introduces its own design obligations. Reads must be sparse and cache-friendly. The monitoring layer must not attempt full archival indexing. The frontend must tolerate temporary lag. Transaction flows must surface pending state clearly, especially for XCM-related actions whose effects are asynchronous. A temporary user-facing warning is better than silently guessing execution results.

## 6. Locked MVP decisions

The stable asset for the MVP is a team-deployed mock stablecoin with correct ERC-20 metadata. This decision is mandatory. It is the same kind of buildability choice made in the corrected DualVM spec. It avoids the missing metadata functions in the ERC-20 precompile and eliminates the need for metadata wrappers in the first version. The point of Sentinel’s MVP is not to prove native-asset support everywhere. It is to prove safe treasury operation.

The treasury supports exactly one treasury kernel instance in the first version. Multi-tenant treasury software is a later expansion, not an MVP requirement.

The MVP includes exactly one local execution path and one optional XCM route. The local path is mandatory. The XCM path exists only if a human-prepared and verified route fixture is committed before agent build work begins. If no verified route fixture exists, the project must degrade gracefully to a local-only treasury execution product and should either not claim Track 2 live functionality or should frame Track 2 around a different real Polkadot-native component. This feature gate is crucial because it converts XCM from a hidden assumption into an explicit build dependency.

The AI planner is advisory only. It may suggest actions and create typed proposals, but it may not sign, execute, or bypass policy. The JS preflight is a UX layer only. The on-chain policy engine is authoritative.

## 7. Mandatory human gate before agent work begins

This is the most important correction in the entire Sentinel plan.

The XCM precompile is intentionally barebones. The docs explicitly state that while it provides a lot of flexibility, it does not provide abstractions to hide the XCM details. Those abstractions have to be built on top. Therefore the system cannot treat XCM route construction as something a coding agent will “figure out” after the contracts already exist.

Before the agent begins the XCM-related implementation, a human must produce and commit at least one verified route fixture. That fixture should be created and tested against public testnet infrastructure using real tooling. It must include the encoded destination bytes, encoded message bytes, fee asset assumptions, weight measurements or budgets, semantic route label, and evidence that it was tested on the target network. Only once that fixture exists should the agent implement RouteBook or XcmAdapter against it.

If this pre-agent human step is not completed, the XCM feature is not build-ready. The correct response is not to hope. The correct response is to disable XCM from the MVP and continue with a local-only build that remains honest.

This human-gated route-fixture rule is exactly what turns Sentinel from a clever architecture into a buildable one.

## 8. Architecture

The system should be built from eight major components.

### 8.1 TreasuryKernel

TreasuryKernel is the fund-holding and execution-owning core. It should be intentionally small. It knows what assets it can hold, what modules may request execution, and which policy engine governs approvals. It should not contain route discovery logic, AI logic, or broad business logic. The kernel exists to make fund custody legible.

### 8.2 AssetRegistry

AssetRegistry is mandatory. Its canonical key is the asset ID, not the token address. This is one of the most important hidden correctness fixes. The Polkadot ERC-20 precompile derives addresses from asset IDs and does not behave like an ordinary deployed token address with full metadata. If a system stores only addresses, different layers will eventually disagree about what the asset is.

The registry therefore stores the asset ID, derived address if relevant, display symbol, decimals, category, policy bucket, fee eligibility, and route eligibility. Even if the MVP uses only a mock stablecoin, building the registry this way prepares the system for the real Polkadot-native phase and prevents a later migration headache.

### 8.3 PolicyEngine

PolicyEngine is where the product becomes useful. It enforces allowlists, per-asset quotas, route permissions, recipient restrictions, per-transaction maximums, minimum payroll thresholds, nonce usage, deadline enforcement, and any treasury-specific policy you want judges to see. The engine should be explicit and readable. A user should be able to understand why a proposal passed or failed.

The planning correction here is to resist overdesign. This is not a policy language platform. It is a fixed set of high-value invariants that can be demonstrated and tested.

### 8.4 Proposal standard and signature flow

Every proposal should be typed and signed. It should include chain-specific domain separation, the treasury instance, action type, asset, amount, route reference if relevant, nonce, and deadline. Replay protection is not optional. The smallest secure treasury product still needs typed intent and replay resistance.

This proposal format is also what makes the AI planner honest. The planner is not free-form. It emits a specific typed action request that a human can inspect and that the contracts can validate.

### 8.5 Preflight service

The preflight mirror is a deterministic off-chain reflection of the core on-chain policy checks. Its job is not to replace on-chain truth. Its job is to explain failure before gas is spent. This is a huge UX gain, but it carries a well-known risk: drift. The off-chain mirror can diverge from the Solidity implementation over time.

That risk must be stated explicitly in the spec. Preflight passing does not guarantee on-chain success. The chain is authoritative. The preflight exists to reduce user confusion and avoid obviously doomed transactions. Every change to PolicyEngine should trigger a corresponding review of preflight logic.

### 8.6 RouteBook

RouteBook is the abstraction that makes XCM sane. It is not a dynamic route planner. It is a registry of pre-validated routes. Each route fixture should include a semantic label, encoded destination data, encoded message body, fee assumptions, measured or estimated weight, expiry or version information, and whether the route is currently enabled.

No raw arbitrary bytes from the UI or planner may flow directly into the XCM precompile. RouteBook is the only source of XCM payloads. This is how the product stays auditable.

### 8.7 XcmAdapter and ExecutionLedger

XcmAdapter is the narrow contract interface that takes a route reference from RouteBook and executes the corresponding XCM precompile action. It must not attempt to generalize XCM into an arbitrary execution environment. It should only know how to run route templates that already exist.

ExecutionLedger or Outbox is equally important. Cross-chain sends are asynchronous. They should never be represented as “done” the moment the treasury submits a transaction. The system must record a pending state, surface that pending state in the monitoring layer and UI, and later reconcile completion or failure as information becomes available. This is one of the strongest improvements in the Sentinel line because it treats XCM like a real distributed operation rather than a synchronous local transfer.

### 8.8 Frontend monitoring layer and dashboard

The monitoring layer is mandatory, but it does not need to be a standalone backend service. A treasury dashboard without live state is a screenshot, not a product. For the MVP, the required monitoring should be implemented as a thin read layer inside the frontend deployed on Vercel. It should surface balances, quota usage, pending executions, completed executions, and a recent event list by reading from the configured public RPC endpoint and rendering that state for the user.

This is an important correction to earlier wording. “Watcher” describes the product capability, not a requirement to run a persistent daemon. Explorers remain useful for verification and trace links, but the frontend should read chain state directly through public RPC rather than treating Blockscout as the source of truth. That keeps the deployment model aligned with the no-server, no-local-node constraint.

## 9. Hidden gaps that must stay closed

Several hidden gaps are easy to reintroduce accidentally.

The first is asset metadata. The ERC-20 precompile does not expose standard metadata functions. Any future step toward native assets must keep metadata in AssetRegistry rather than assuming the token contract can answer it.

The second is weight budgeting. A route fixture should include measured or estimated weight with a safety margin. Reusing a stale route fixture without revisiting its weight assumptions is a subtle but serious failure mode.

The third is fee-asset depletion. An execution route can be theoretically valid but operationally unusable if the treasury lacks the fee asset or the fee assumptions no longer hold. PolicyEngine and the UI should make this visible.

The fourth is public RPC fragility. Because the build relies on public endpoints, retry logic, exponential backoff, client-side caching, and human-readable warnings are part of the product, not incidental operational details.

The fifth is temporary testnet status. Passet Hub is temporary, and contracts deployed there will not migrate automatically when the environment is decommissioned. The spec should therefore treat all deployment artifacts as testnet-specific and separate from any future production rollout plan.

The sixth is one-shot AI execution pressure. The product should not offer scheduled autonomous execution in the MVP. A planner that drafts typed proposals is enough. Scheduled or unattended execution introduces a different risk category and should remain out of scope.

The seventh is packaging vanity. GitHub matters. A clean hosted frontend matters. An npm package can matter if it is a real SDK. A PyPI package is a distraction unless the team intentionally built a useful Python artifact and can explain why it belongs.

## 10. OpenZeppelin and security posture

Sentinel’s strongest sponsor-track angle is not that it uses OpenZeppelin. Many projects do. Its strength is that OpenZeppelin usage is structural.

Use AccessManager rather than a single owner to separate emergency pause authority, route administration, policy administration, and treasury operation. High-risk changes should use delays. That makes the policy layer feel like real treasury software, not like a demo contract with one privileged EOA.

Use pause controls around high-risk execution flows. Use typed signature validation logic that respects both EOAs and smart contract wallets where practical. Use explicit state transitions for proposals and execution records.

Just as important, document what the security model does not claim. Sentinel is not a fully audited custody platform. The AI planner is not trusted execution. The public-RPC environment is not guaranteed. The XCM path is not arbitrary. These honest boundaries make the project more believable to judges, not less.

## 11. Testing strategy under real constraints

Testing must be designed around what is actually possible on a small Linux VPS and a public testnet.

Local tests should cover policy invariants, typed proposal validation, nonce and deadline behavior, access control, pause behavior, asset registry logic, and outbox state transitions. None of that requires a Polkadot-specific local chain or a local Polkadot node.

Public testnet tests should cover deployment, asset registration inside the app, one local payment flow, and, if the fixture exists, one XCM route flow. Those tests should be scenario-based rather than exhaustive and should assume the chain, explorer, and faucet are external public services.

The main demo scenario should be rehearsed until it is boring. A safe treasury holds mock stablecoin, a planner drafts a payroll or rebalance proposal, preflight explains why it passes, the user signs, PolicyEngine approves, TreasuryKernel executes, the frontend monitoring layer updates, and the explorer link confirms the transaction. If the XCM route exists, the demo should show the pending state and explain asynchronous settlement rather than pretending immediate completion.

A smaller but important detail: the repository should include a deterministic way to run the UI against public RPC using minimal environment variables. Judges and builders should not need secret local-chain knowledge to test the product.

## 12. Agentic build plan and harness design

This specification is written for a coding harness, not for manual development alone. That means the execution model matters.

The correct build pattern is incremental. A short project memory file should define the product purpose, locked decisions, network settings, out-of-scope features, current phase, and acceptance criteria. Each agent run should work on one phase at a time and update the project memory when complete. This follows modern best practice for long-running coding agents, where project memory and narrow phase objectives produce better outcomes than monolithic “build everything” prompts.

The recommended phase order is:

1. Repository scaffolding, environment assumptions, and deployment config for public RPC.
2. TreasuryKernel, mock stablecoin, and AssetRegistry.
3. PolicyEngine and typed proposal flow.
4. Local execution path and frontend monitoring layer.
5. Preflight logic and dashboard.
6. RouteBook integration only if a verified fixture already exists.
7. XcmAdapter and ExecutionLedger if and only if the route gate is satisfied.
8. Explorer verification, documentation, demo assets, and submission packaging.

GitHub is mandatory. An npm package is optional and only worth shipping if it provides a small reusable SDK, route manifest package, or ABI bundle that the frontend and external integrators actually use. PyPI should stay out of scope unless a real Python-based ops tool exists and is genuinely useful.

## 13. Submission framing and how to beat a crowded field

The submission should be framed around discipline, not maximalism. Against a crowded field of hackathon projects, the strongest submissions usually win by feeling more real, not more grandiose. A judge should finish your repo and think: this team made hard choices, built the important path completely, documented it clearly, and understands what they built.

For Sentinel the core claim is:

Sentinel TreasuryOS is an AI-assisted treasury execution system on Polkadot Hub that keeps humans in control, enforces policy on-chain, and supports both local treasury actions and carefully constrained Polkadot-native routing.

That is already enough to sound differentiated.

The archived rules snapshot emphasizes open source, active commit history, on-chain identity, demoability, documentation, UI and UX, and future commitment. The submission therefore needs to look like a real product package, not just a contract repository. The README should tell the story cleanly. The demo should show the planner, the preflight, the signature step, the execution result, and the updated dashboard. The architecture doc should explain why the AI is advisory rather than autonomous. The track application text should map features explicitly to Track 1, Track 2, and the OpenZeppelin sponsor track.

Do not claim “production-ready” without qualifiers. A much better phrase is “production-minded, public-testnet-validated MVP.” That is more credible and still strong.

## 14. Explicit non-goals

The MVP does not include autonomous execution.

It does not include arbitrary XCM composition.

It does not include multi-treasury tenancy.

It does not include multiple stablecoins.

It does not depend on asset-precompile metadata.

It does not depend on a local Polkadot network, local node binary, or synced local chain.

It does not promise migration from temporary Passet Hub deployments.

If a feature makes the system harder to explain than to use, it is probably outside the MVP.

## 15. Curated sources and reading order

These are the most important sources to read before implementation:

1. Polkadot Hardhat documentation for current examples and limitations.  
   `https://docs.polkadot.com/smart-contracts/dev-environments/hardhat/`

2. Dual VM overview, to keep REVM and PVM roles honest.  
   `https://docs.polkadot.com/smart-contracts/for-eth-devs/dual-vm-stack/`

3. XCM precompile documentation, especially the warning that it is barebones and requires abstractions on top.  
   `https://docs.polkadot.com/smart-contracts/precompiles/xcm/`

4. ERC-20 precompile documentation, to understand asset-ID-based addressing and the missing metadata functions.  
   `https://docs.polkadot.com/smart-contracts/precompiles/erc20/`

5. Official Passet Hub announcement with canonical endpoints, explorer, faucet, and chain ID.  
   `https://forum.polkadot.network/t/testnets-paseo-officially-becomes-the-polkadot-testnet-temporary-passet-hub-chain-for-smart-contracts-testing/13209`

6. Polkadot Hub RPC node requirements, to understand why public RPC is the correct choice on a small VPS.  
   `https://docs.polkadot.com/node-infrastructure/run-a-node/polkadot-hub-rpc/`

7. OpenZeppelin access-control documentation.  
   `https://docs.openzeppelin.com/contracts/5.x/api/access`

8. DoraHacks Polkadot Solidity Hackathon page plus your archived rules snapshot.  
   `https://dorahacks.io/hackathon/polkadot-solidity-hackathon`

9. Long-running coding-agent harness guidance and project memory.  
   `https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents`  
   `https://docs.anthropic.com/en/docs/claude-code/memory`

10. Vercel deployment and frontend support documentation.  
    `https://vercel.com/docs/deployments`  
    `https://vercel.com/docs/frameworks/frontend`

## 16. Final build verdict

Sentinel is build-ready when the team stops treating every optional extension as mandatory. The product is strongest when it is modest, explainable, and policy-centric. Its architectural instinct is already excellent. The remaining work is execution discipline.

If built according to this specification, Sentinel can be one of the most credible submissions in the hackathon: a live public-testnet treasury operator with an AI planner that actually helps, on-chain rules that actually matter, a dashboard that reflects real state, and a Polkadot-native path that is real where it exists and explicitly gated where it does not. That combination is rare in hackathons because it requires saying no more often than saying yes.

That is exactly why it can win.