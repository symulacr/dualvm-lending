# DualVM Lending 2026 — Public-RPC-First Final Build Specification

Historical note: this file preserves the final public-RPC-first planning position that was used before the current implementation converged. It is still useful for product-shape intent, but it is not the operational source of truth for tonight's build. For current network, explorer, faucet, live addresses, and truthful Track 2 wording, use `README.md`, `docs/dualvm/dualvm_current_state_addendum.md`, and `docs/dualvm/dualvm_pvm_posture.md`. Treat the Passet Hub endpoint assumptions below as historical unless those current-state files explicitly repeat them.

## 1. Executive verdict

This is a viable hackathon product only if it stays narrow. The earlier concept became credible the moment it stopped pretending that “DualVM” was the product. DualVM is not the user story. It is the implementation strategy. The user story is much simpler and much stronger: one isolated lending market on Polkadot Hub testnet where a user deposits one collateral asset, borrows one stable debt asset, and can be liquidated if the position becomes unsafe.

That narrow shape is good mission planning. It gives judges a clean demo, gives an AI coding agent a bounded system to build, and gives the team a believable path from hackathon submission to a real protocol. It also matches current Polkadot guidance. The docs still position REVM as the easiest path for Ethereum-compatible applications, while PVM is best used where it adds real value and where its different execution model is worth the extra complexity. The docs also still show a moving testnet and tooling picture. A build that assumes every advanced feature is perfectly mature is not robust. The right move is to center the MVP on the most stable path and use DualVM as a focused differentiator rather than as a slogan.

The bad news is that earlier mission planning still carried three damaging instincts. First, it mixed live-network decisions, old examples, and hackathon hopes into a single plan. That is how you end up with the wrong chain ID, the wrong endpoint, and false certainty about what the canonical testnet is. Second, it left product-defining choices open, especially around the collateral asset, debt asset, and oracle behavior. A coding agent cannot build around unresolved decisions. Third, it assumed that because the project could theoretically support native assets, precompiles, and XCM, the MVP should do all of them. That is classic hackathon overreach.

This final specification removes those failures. The MVP is an isolated market. The core is REVM. The network is public-RPC-first. The primary chain is Passet Hub on the official public endpoint. The tokens are a wrapper collateral asset and a team-controlled mock stable for deterministic metadata and clean UX. The oracle is manual and explicit. XCM is removed from the MVP critical path. PVM still exists, but in a bounded, stateless role that is meaningful for Track 2 without endangering the solvency-critical path.

If built exactly this way, DualVM Lending is not the loudest concept in the field. It is something better: a project with a serious chance to work under real constraints on a small VPS, against public infrastructure, with an agentic build loop and a real submission deadline.

## 2. Product thesis and why it can win

DualVM Lending should be pitched as a production-minded lending primitive for Polkadot Hub, not as a general lending platform. The problem it solves is immediate and legible. Users lock collateral, access stable liquidity, and interact through a familiar DeFi pattern. Judges can understand it in under a minute. That matters because hackathon judging is never just about raw technical cleverness. Your archived rules snapshot emphasizes open source, active commit history during the event, on-chain identity, documentation, UI and UX, demoability, and clear track relevance. A project that is technically interesting but difficult to test or explain will underperform a narrower build that feels real.

For Track 1, this fits cleanly as a stablecoin-enabled DeFi application. For Track 2, it fits as a genuine PVM experiment if the PVM risk engine is real and deployed, not hand-waved. For the OpenZeppelin sponsor track, it fits if the architecture clearly relies on OpenZeppelin primitives such as AccessManager, Pausable, ReentrancyGuard, SafeERC20, and, if an ERC-4626-style vault is used, careful handling of the empty-vault inflation problem. That combination is exactly the kind of multi-track surface area the hackathon allows, and the organizer Q&A says a project may apply to multiple tracks and there is no prize limit if it qualifies.

The project also benefits from a hidden competitive pattern. Large numbers of hackathon submissions cluster around broad DeFi, token, or wallet ideas, but stronger winners usually look like opinionated primitives with one strong mechanism and one clear user path. The right way to beat a crowded field is not to appear larger. It is to appear more finished, more disciplined, and more truthful. This specification is designed to make the final submission look more reliable than larger but shakier projects.

## 3. Runtime model: what runs where

The runtime map is intentionally simple.

On Parity-operated public infrastructure run the things your team does not manage:

- the actual Passet Hub blockchain,
- the public RPC and ETH-RPC endpoints,
- the public Blockscout explorer used for verified contracts and transaction traces,
- the official faucet that drips PAS for the smart-contracts test chain.

On your side, the only mandatory hosted application is the frontend that judges open in a browser. That frontend can be deployed to Vercel’s free tier. There is no local Polkadot node at any point, no node binary to manage, no chain sync, no private archive service, and no custom devnet. This is not merely a convenience preference. It is a product constraint and a judging advantage because the same public infrastructure used by the team is the infrastructure judges can inspect.

The only thing that may still run locally during development is ordinary contract testing and frontend development tooling. Those are standard software-development tasks, not Polkadot node operations. No step in this specification requires starting a local Polkadot chain or syncing a local Polkadot Hub node.

## 4. Infrastructure reality: public RPC first, official endpoint first

The most important operational decision is also the easiest to underestimate: this product must be buildable without running a local Polkadot Hub network at any point.

The primary EVM endpoint for this specification is the official Passet Hub Ethereum RPC endpoint:

- `https://testnet-passet-hub-eth-rpc.polkadot.io`
- Chain ID: `420420422`

That should be the canonical network in the repository, the README, the deployment tooling, the UI instructions, and the DoraHacks submission. The older and still-documented example endpoint in the current Hardhat docs, `https://services.polkadothub-rpc.com/testnet` with chain ID `420420417`, may be documented as a compatibility fallback if a specific tool has not yet caught up. It must not be the primary judge-facing assumption. If both networks are treated as equally canonical, the project inherits ambiguity before the first transaction is signed.

Public RPC is convenient, but not magical. The official forum thread around Passet Hub includes complaints about ETH-RPC rate limiting, and that issue was acknowledged publicly. That means the design cannot be public-RPC-first and public-RPC-naive. Reads should be conservative. Static values should be cached. The UI should not poll aggressively. Integration tests should be sparse and scenario-driven instead of exhaustive.

A second reality must be respected. The official Polkadot guidance for running a production-style Polkadot Hub RPC node requires far more hardware than the target VPS provides. That is not an argument for trying harder. It is the reason the system should not attempt self-hosted chain infrastructure in the first place.

## 5. Locked MVP decisions

This section is intentionally rigid. Anything left open here is a future failure.

The collateral asset is **WPAS**, a simple wrapped version of the Passet Hub native test token PAS. This keeps the collateral path familiar to EVM tooling and avoids relying on asset-precompile metadata in the first version. The wrapper exists because a lending system is easier to compose, test, and explain when both collateral and debt sides use ordinary ERC-20 semantics.

The debt asset is **USDC-test**, a mock ERC-20 stable deployed by the team with 18 decimals and explicit metadata. This is not a philosophical choice. It is a buildability choice. The ERC-20 precompile on Polkadot omits `name`, `symbol`, and `decimals`, and that missing metadata will cause avoidable UI and vault-accounting pain if it is pulled into the MVP. Direct native-asset or asset-precompile integration belongs in a later phase, not in the hackathon critical path.

The oracle is a governed manual price feed. It stores three essential pieces of state: the current price, the last update timestamp, and a freshness window in seconds. If the price is older than the allowed freshness window, borrowing and liquidation-sensitive functions revert. That is the entire oracle. This is enough for a hackathon MVP, easy for an agent to build, and honest about what it is. It is not a production oracle network. It is a controlled testnet seam.

The product supports exactly one isolated market in the first submission. One collateral asset. One debt asset. One interest-rate model. One liquidation path. No cross-collateral mode. No multiple debt assets. No market factory.

XCM is not on the MVP critical path. The project can discuss XCM expansion in the roadmap, but the live submission does not depend on cross-chain transfers. This is not a retreat from Polkadot-native thinking. It is the correct response to the real complexity of XCM encoding, fee estimation, and asynchronous settlement.

PVM is included, but only as a narrow stateless module. The lending protocol must remain correct and testable even if the PVM component is temporarily excluded or exposed only through an auxiliary view path. That rule prevents the entire submission from collapsing around one immature integration point.

## 6. Architecture

The architecture should contain seven core components.

### 6.1 WPAS

WPAS is the wrapped collateral token. Its job is operational, not innovative. It provides ERC-20-compatible collateral semantics for the native PAS test token. It should be minimal, auditable, and boring. That is a compliment. The less creativity there is in the wrapper, the better.

### 6.2 USDC-test

USDC-test is the debt asset used for supply and borrowing. It should have normal ERC-20 metadata and no hidden complexity. Its purpose is not to simulate a real stablecoin ecosystem. Its purpose is to eliminate metadata ambiguity and let the lending logic stay front and center.

### 6.3 Debt Pool

The debt pool is where liquidity providers deposit USDC-test and receive pool shares. This can be implemented as an ERC-4626-style vault or as an explicit pool-share model. If ERC-4626 is used, the spec must require one of two inflation-attack defenses: either the vault is seeded with initial liquidity on deployment, or the implementation retains OpenZeppelin’s current virtual-offset protection and does not override it in a way that reopens the empty-vault donation attack. This is mandatory, not optional. A lending protocol that ignores the empty-vault edge case is not production-ready even as a hackathon prototype.

### 6.4 Lending Core

The Lending Core is the actual product. It tracks collateral balances, debt balances, accrued interest, borrow limits, health factors, repayments, and liquidation eligibility. It is also the component that judges will most intuitively understand. The core must be the source of truth for solvency.

The mission-planning improvement here is subtle but important: the core should not “ask PVM whether a user is solvent” and blindly trust the answer. The core should own solvency checks. PVM may provide rate quotes or secondary risk outputs, but REVM must remain capable of enforcing protocol correctness on its own terms. That keeps the product robust if the PVM side changes, lags, or is temporarily excluded.

### 6.5 Oracle Adapter

The Oracle Adapter is deliberately plain. It serves the current collateral price and enforces freshness. It should also expose the freshness window itself so the UI can surface when borrowing is disabled due to stale data. That turns a common failure mode into a transparent user experience rather than a mysterious revert.

### 6.6 PVM Risk Engine

The PVM Risk Engine must be stateless, deterministic, and bounded. Good inputs include utilization, target reserve factor, utilization kink, collateral ratio bucket, and possibly oracle health flags. Good outputs include an interest-rate quote, a borrow-cap suggestion, or a risk-tier classification. Bad outputs are anything that requires large storage, dynamic deployment patterns, or opaque trust assumptions.

This is where earlier drafts overclaimed. Current Polkadot documentation supports the view that PVM can add value for compute-oriented tasks, but it does not justify building the solvency-critical heart of a lending protocol around poorly documented cross-VM assumptions. Therefore the PVM module should be framed as an advanced computation component, not as the only place where protocol math lives.

A further correction is necessary. If direct cross-VM invocation from the REVM core turns out to be brittle, under-documented, or hard to verify within the hackathon timeline, the project should still ship with the PVM engine as a separately deployed parity module whose outputs are compared and displayed in the UI or consumed by off-chain quoting logic. In that fallback mode, the submission still has a truthful Track 2 story: the same risk logic exists in PVM, is deployed on-chain, and is used for rate visibility or policy recommendation, but custody and solvency do not depend on an unproven call path.

### 6.7 Frontend read layer

The user-facing application should be a frontend deployed on Vercel. It reads directly from the public Passet Hub RPC endpoint and links out to Blockscout for transaction traces and contract verification. There is no standalone watcher daemon in the MVP, no dedicated backend required for judges, and no private indexing stack.

A thin read layer inside the frontend is still required. It should surface pool totals, user balances, health factors, recent liquidations, and the latest important events by making conservative public-RPC reads and caching them sensibly in the browser. The principle is simple: operational observability is mandatory, but it must be delivered without introducing a self-hosted service that contradicts the public-RPC-first constraint.

## 7. Why the mission planning is good, and where it is still weak

The good part of this mission planning is that it now respects the difference between a demoable protocol and a fantasy deck. It picks one market. It controls the assets. It makes the oracle explicit. It stops promising XCM in the MVP. It assumes public RPC. Those are all signs of mature planning.

The weak part is that “DualVM” still risks becoming theater if the PVM wedge is too thin or too decorative. Judges can smell tokenism. A PVM contract deployed only so the team can say “we used PVM” will not improve the project. The fix is not to make PVM bigger. The fix is to make it honest. The PVM component should own a real computation surface, and the submission should explain precisely why that computation lives there and what future scaling it enables. That is enough.

A second weakness is the temptation to promise native-asset or cross-chain lending too early. Those are attractive roadmap ideas, but they are not build-ready assumptions for a hackathon judged on working output. The best version of this project earns trust by not lying about what the MVP is.

A third weakness is packaging overreach. GitHub is mandatory and useful. An npm package can be useful if it ships ABIs or a tiny SDK that the frontend genuinely consumes. Publishing a PyPI package for appearances alone is a poor use of scarce time. The submission should optimize for judged value, not for decorative distribution channels.

## 8. Protocol parameters and economic policy

This MVP should use a single conservative parameter set. The market should define a maximum loan-to-value ratio, a liquidation threshold, a liquidation bonus, a reserve factor, a borrow cap, and a supply cap. Borrow rates should follow a kinked utilization model so that rates rise more aggressively when pool utilization becomes dangerously high.

The exact numbers matter less than the discipline with which they are handled. Parameters must be visible in the UI and adjustable only by delayed administrative action. The project should explain that these are testnet values, not market-calibrated production numbers. Synthetic precision is worse than honest approximation. The submission should not imply that a one-week dataset produced production-grade risk calibration.

A minimum borrow amount should be enforced so the system does not fill with meaningless dust debt. Liquidations should be bounded enough to avoid pathological edge cases but simple enough that they can be demonstrated live.

## 9. Security architecture and OpenZeppelin usage

The best security story here is not novelty. It is disciplined composition.

Administrative permissions should be handled through AccessManager, not a single all-powerful owner. At minimum there should be an emergency pause role, a risk-parameter role with delayed execution, and a treasury-fee role. Sensitive changes should never be instantaneous if they affect solvency or user funds.

Runtime protections should include reentrancy protection around state-changing fund flows, pausing around emergency cases, and safe token transfer handling. The contracts should prefer explicit invariants over clever abstractions. Auditors and judges both reward systems that are easy to reason about.

If ERC-4626 is used for the debt pool, the specification must explicitly mention virtual shares or initial seeding. That detail alone will distinguish this project from many hackathon entries that import a standard without understanding its edge cases.

The security documentation should also include the honest limits of the system: manual oracle, one market, no cross-chain finality assumptions in the MVP, no governance token, and no claim of production-grade audit status.

## 10. Testing and validation on a small VPS

The test plan must match the machine and the network reality.

Local unit tests should cover pure accounting, interest-rate math, liquidation thresholds, stale-oracle rejection, access control, and pause behavior. These are fast and can run in a normal local EVM test runner without starting any Polkadot node.

Public-RPC integration tests should cover deployment, token wrapping, supplying liquidity, posting collateral, borrowing, repaying, and liquidation on the official Passet Hub endpoint. These tests should be sparse and scenario-driven. They should not flood public RPC, and they should assume the chain, explorer, and faucet are external public services rather than team-operated infrastructure.

A main demo scenario should be rehearsed until it is reliable: deploy contracts, mint USDC-test, wrap PAS into WPAS, deposit pool liquidity, open a borrow position, make the oracle price fall, trigger liquidation, and show the explorer and UI state changes. That scenario is what judges will remember.

Contract verification on the explorer is mandatory. A project that claims seriousness but leaves its contracts unverified makes the judges do extra trust work. That is a self-inflicted wound.

## 11. Agentic build plan: how a coding agent should actually use this spec

A coding agent should not be instructed to “build the whole product end to end” in one run. That is not how long-running coding agents succeed. Modern best practice is to provide a persistent project memory file, a narrow phase objective, explicit acceptance criteria, and a place to record open issues between sessions. Small initializer prompts, structured progress tracking, and repeatable handoffs outperform one-shot autonomous marathon prompts.

This specification is therefore meant to be consumed in phases.

Phase one is project scaffolding, contract list creation, and deployment config locked to public RPC.

Phase two is token contracts, oracle, and debt-pool mechanics.

Phase three is the lending core and liquidations.

Phase four is the PVM risk component or its fallback parity deployment.

Phase five is the Vercel-hosted frontend and its thin client-side read layer.

Phase six is deployment, verification, demo rehearsal, and submission packaging.

A short project memory file should tell the agent which network is primary, which asset choices are locked, which features are explicitly out of scope, how to run the tests, and what the next acceptance gate is. That is much more effective than a giant master prompt.

GitHub is mandatory. An npm package is optional and only justified if it cleanly packages ABIs, addresses, or a small client SDK. Publishing to PyPI should not be on the critical path unless the team intentionally builds a reusable Python ops tool and can defend why it matters to judges.

## 12. Submission framing for DoraHacks

The final pitch should not be “we built a huge multi-chain lending stack.” It should be:

DualVM Lending is a public-RPC-first isolated lending market on Polkadot Hub testnet. It uses standard Solidity and OpenZeppelin security patterns for custody and accounting on REVM, plus a real PVM risk engine for advanced rate and risk computation. The MVP is intentionally narrow so it is testable, verifiable, and demonstrable on a live public testnet with no local chain dependency.

That sentence alone is stronger than many inflated hackathon descriptions.

The README, demo video, and DoraHacks form should each show the same three claims:

- the product works live on the official public testnet,
- the architecture is secure and intentionally scoped,
- the roadmap to native assets and richer cross-chain functionality exists, but the submission does not fake what it has not built.

That honesty is not a weakness. It is part of the winning strategy.

## 13. Explicit non-goals

The MVP does not support multiple collateral types.

It does not support multiple debt assets.

It does not support XCM or raw precompile assets in the critical path.

It does not claim a production oracle network.

It does not claim autonomous market-making, cross-chain settlement, or governance-token launch.

It does not require a local Polkadot network, local node binary, or synced local chain.

If a feature is not necessary to prove the isolated market, it is out of scope.

## 14. Curated sources and reading order

Read these in this order before building:

1. Polkadot Hardhat documentation for the current network and toolchain examples.  
   `https://docs.polkadot.com/smart-contracts/dev-environments/hardhat/`

2. Polkadot Dual VM overview, to understand when REVM and PVM should be used.  
   `https://docs.polkadot.com/smart-contracts/for-eth-devs/dual-vm-stack/`

3. Official Passet Hub forum announcement for the canonical public endpoints, explorer, faucet, and chain ID.  
   `https://forum.polkadot.network/t/testnets-paseo-officially-becomes-the-polkadot-testnet-temporary-passet-hub-chain-for-smart-contracts-testing/13209`

4. Polkadot Hub RPC node requirements, not to self-host on this VPS, but to understand why public RPC is the right default here.  
   `https://docs.polkadot.com/node-infrastructure/run-a-node/polkadot-hub-rpc/`

5. OpenZeppelin AccessManager documentation.  
   `https://docs.openzeppelin.com/contracts/5.x/api/access`

6. OpenZeppelin ERC-4626 documentation, especially the inflation-attack discussion.  
   `https://docs.openzeppelin.com/contracts/5.x/erc4626`

7. DoraHacks Polkadot Solidity Hackathon page and your archived rules snapshot.  
   `https://dorahacks.io/hackathon/polkadot-solidity-hackathon`

8. Long-running coding-agent harness guidance and project memory patterns.  
   `https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents`  
   `https://docs.anthropic.com/en/docs/claude-code/memory`

9. Vercel deployment and frontend support documentation.  
   `https://vercel.com/docs/deployments`  
   `https://vercel.com/docs/frameworks/frontend`

## 15. Final build verdict

This project is ready to be built if, and only if, the team obeys the scope. The design is strong when it is modest. It becomes weak the moment it tries to become a generalized protocol, a cross-chain protocol, and a fully autonomous protocol at the same time.

The winning version of DualVM Lending is a disciplined one-market system on the official public testnet, verified on-chain, explained clearly, built with honest assumptions, and packaged like a real protocol primitive rather than a hackathon sketch. That is the version an AI coding agent can actually deliver, and that is the version most likely to outperform a louder but less coherent field.