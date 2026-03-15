# DoraHacks Submission Playbook — Polkadot Solidity Hackathon 2026

Historical note: this playbook preserves the hackathon scoring and packaging guidance, but any endpoint, chain, explorer, or faucet examples inside it are only as current as the public sources available when it was drafted. For DualVM Lending, the operational source of truth is the top-level `README.md` plus `docs/dualvm/dualvm_current_state_addendum.md`. Do not let older Passet Hub wording in this playbook override the current live Polkadot Hub TestNet deployment facts.

## 1. What the judges are really rewarding

The official hackathon structure makes one thing clear: this is not just a coding contest. The rules and winner criteria reward projects that are technically real, operationally testable, and easy for judges to evaluate. Your archived rules snapshot states that all projects must be open source, that more than 70% similarity to an existing fork is disqualifying, that all team members must verify identity through the Polkadot Official Discord, that commit history must clearly show active work during the event, and that only code contributed during the hackathon is considered for scoring. It also says winner selection looks at on-chain identity, documentation, UI and UX, demoability, track relevance, and evidence of future commitment.

That means the submission package is part of the product. A brilliant protocol that is hard to run, impossible to inspect, or poorly explained is weaker than a smaller project that is live, verified, documented, and narrated clearly.

For the Polkadot Solidity Hackathon, the best framing is usually:

- a strong Track 1 story,
- one truthful Track 2 element,
- a visible OpenZeppelin architecture,
- a polished README and demo path,
- and a live deployment on the target testnet.

DualVM Lending and Sentinel TreasuryOS fit that pattern differently. DualVM Lending leads with DeFi and uses PVM as a focused technical differentiator. Sentinel leads with AI-assisted treasury execution and uses Polkadot-native routing as the advanced edge. Both can compete well if they are packaged correctly.

## 2. Runtime map: what actually runs where

The cleanest runtime map for both projects is this:

On Parity-operated public infrastructure live the chain, the public RPC and ETH-RPC endpoints, the Blockscout explorer, and the faucet. On your side, the only mandatory hosted component is the frontend deployed on Vercel. There is no local Polkadot node at any point, no chain sync, no self-hosted archive service, and no hidden backend requirement for judges.

That deployment shape is a submission advantage, not a compromise. The official Polkadot guidance for running a production-style Polkadot Hub RPC node is far beyond the capacity of a 4 CPU, 8 GB RAM VPS, so public infrastructure is the right default. It also makes the judge experience cleaner. Judges can inspect the same public chain, explorer, and faucet setup you used. They do not need to trust a private network or reproduce a local chain.

The README for each project should therefore say explicitly that the application is public-testnet-first. It should name the official Passet Hub endpoint and chain ID, explain how to get PAS from the faucet, and explain that the frontend is the only hosted component you operate. If you include a compatibility fallback endpoint, present it as a backup rather than as part of the main story.

## 3. What should be in the repository

The repository is the canonical artifact. DoraHacks requires a GitHub, GitLab, or Bitbucket link, and judges will look at structure, freshness, and signs of real engineering work. A strong hackathon repo should contain:

- contracts and contract-specific docs,
- deployment configuration for the target public testnet,
- a minimal frontend or demo interface,
- no unnecessary infrastructure folders that imply hidden complexity,
- a top-level README that tells the story in under five minutes,
- architecture notes,
- a short project memory or operator note if the build used an AI coding harness,
- screenshots or demo assets if the hosted deployment is fragile.

A weak repo is one where the reader cannot tell what is core product logic, what is boilerplate, what was generated, and how to actually run the system.

A particularly strong pattern for agent-built hackathon repositories is to include a short project memory file that explains the locked product decisions, current network settings, and command flow. This helps judges and future collaborators understand how the system is organized without reading the entire codebase.

## 4. What not to oversell

This is the most important pitch correction.

Do not claim “production-ready” unless the system has earned that phrase. On a hackathon timescale, the honest and strong phrase is usually “production-minded MVP,” “public-testnet-validated prototype,” or “security-first alpha.” Those phrases signal ambition without sounding careless.

Do not claim arbitrary cross-chain support if you only implemented one pre-verified route.

Do not claim AI autonomy if the planner only drafts proposals and the chain enforces policy.

Do not claim native-asset universality if the MVP uses mock tokens for metadata clarity.

Do not claim a generalized lending platform or treasury operating system if the live product only supports one market or one treasury instance.

These are not marketing concessions. They are trust-preserving choices. Judges will forgive modest scope much more easily than they will forgive inflated claims.

## 5. How to frame DualVM Lending

The strongest framing for DualVM Lending is:

DualVM Lending is an isolated lending market on Polkadot Hub testnet built around a public-RPC-first architecture. It uses Solidity and OpenZeppelin for custody, access control, and accounting on REVM, while adding a real PVM risk-computation wedge for Track 2. The MVP is intentionally one-market and one-stable so it can be verified, demonstrated, and reasoned about clearly.

That tells the judge three things quickly: the project is live, the project actually uses Polkadot-native smart-contract capabilities, and the project is disciplined rather than inflated.

In the submission text, the main scenario should be spelled out in concrete sequence:

1. User wraps PAS into WPAS.
2. Liquidity provider deposits USDC-test.
3. Borrower posts WPAS collateral.
4. Borrower draws stable debt.
5. Price feed changes.
6. Health factor falls.
7. Liquidation becomes possible.
8. UI and explorer show the resulting state.

That scenario is the demo. Everything in the repo, the README, and the video should reinforce it.

For Track 2, explain exactly what the PVM component does. If PVM is used for risk quotes or parity checking rather than for solvency-critical execution, say so clearly. Honesty is stronger than pretending the system depends on a more advanced cross-VM pattern than it really does.

For the OpenZeppelin sponsor track, highlight AccessManager, Pausable, ReentrancyGuard, SafeERC20, and the handling of ERC-4626 inflation-attack risk if an ERC-4626-style vault is used. Judges in a sponsor track want to see that the libraries shaped the design, not that they were imported casually.

## 6. How to frame Sentinel TreasuryOS

The strongest framing for Sentinel is:

Sentinel TreasuryOS is an AI-assisted treasury execution layer on Polkadot Hub. The AI drafts typed proposals, the user signs, the on-chain policy engine decides, and the system supports local treasury actions plus carefully constrained Polkadot-native routing where route fixtures have been pre-verified. The product is designed around human control, public-testnet reality, and explicit policy rather than autonomous custody.

That pitch works because it gives the AI story a safety boundary. It is also easy for judges to grasp.

The main live scenario for Sentinel should be concrete:

1. Treasury holds mock stablecoin.
2. Planner drafts a payroll or rebalance proposal.
3. Preflight explains why the proposal passes.
4. Signer approves.
5. Policy engine validates nonce, deadline, quotas, and route.
6. Treasury executes.
7. The frontend monitoring layer updates balances and execution history.
8. If XCM is included, the UI shows pending or outbox state instead of pretending immediate final settlement.

The submission should make a virtue of this restraint. Sentinel is not “an autonomous AI treasury.” It is “a treasury OS that makes AI useful without making AI trusted.” That distinction is both safer and more persuasive.

For Track 2, only claim XCM execution if at least one verified route fixture exists and is demonstrated. If it does not, consider Track 2 only if another real Polkadot-native component exists and can be justified honestly. A failed or hypothetical XCM path is worse than a narrower but true submission.

For the OpenZeppelin sponsor track, emphasize role separation, delayed administrative powers, proposal validation, and the policy-first composition of the contracts.

## 7. README structure that judges can scan fast

A high-performing hackathon README should answer five questions quickly:

What is it?  
Why does it matter?  
How is it built?  
How do I run it?  
How do I verify it works?

The best README structure for these projects is:

- one-paragraph product summary,
- tracks applied to and why,
- architecture overview,
- main scenario walkthrough,
- deployed contract addresses and explorer links,
- public RPC and wallet setup,
- quickstart for frontend and deployment,
- screenshots or GIFs,
- testing notes,
- security notes and known limitations,
- roadmap after the hackathon.

Do not bury the live demo instructions halfway down the page. Put them near the top. The faster a judge can see the product, the better.

## 8. Demo video strategy

Every submission needs a demo video or screenshots according to your archived rules. A good demo video is not a random screen recording. It is a script. Because the live demo is judge-facing, the safest operational model is a Vercel-hosted frontend that talks straight to public RPC and sends users to Blockscout for proofs.

For both projects, target a short, highly intentional video that proves the main scenario. Do not waste time on splash screens or generic introductions. Show the deployed environment, the wallet network, the explorer, the key transaction sequence, and the UI state changes. Narration should be brief and concrete.

For DualVM Lending, the video should show supply, collateral deposit, borrow, price change, and liquidation.

For Sentinel, the video should show proposal generation, preflight explanation, signing, execution, and monitoring-layer update.

The most persuasive moment in both demos is the explorer-confirmed transaction paired with the app state update. That is the point where a hackathon project stops being theoretical.

## 9. Commit history and AI-assistance hygiene

Because the hackathon requires valid commit history that shows active work during the event, repository hygiene matters. Even if an AI coding harness is used, the repository should still look like intentional engineering work.

That means:

- use meaningful commits,
- keep progress visible over time,
- avoid dumping the whole project in one giant final commit,
- preserve docs and architecture changes in version control,
- keep generated artifacts out of the repo unless they are necessary.

If AI assistance was used heavily, the safest public posture is not to hide it. Instead, show that AI was used within a controlled engineering process. A small project memory file, issue log, or progress note can make the build process feel disciplined rather than mysterious.

## 10. npm, PyPI, and deployment discipline

For hackathon scoring, GitHub matters far more than package registries. Publishing to npm or PyPI only helps if it corresponds to something real and reusable.

An npm package makes sense if it contains ABIs, typed clients, route manifests, or a minimal SDK that the frontend and integrators can actually use.

A PyPI package only makes sense if you genuinely built a Python watcher, ops tool, or automation interface that is worth reusing.

Publishing to both npm and PyPI just to look complete is usually scope creep. It adds operational work, versioning overhead, and support burden without improving the judge experience. On this timeline, only publish a package if it strengthens the product story.

## 11. Submission text for tracks and judging criteria

Your DoraHacks text should explicitly map the submission to the judging framework.

For Track 1, focus on the end-user application and why the product is stablecoin-enabled, AI-powered, or both.

For Track 2, name the exact Polkadot-native capability used. Do not say “we use PVM and XCM” in a vague way. Say what the PVM component computes or what the XCM route does.

For the OpenZeppelin sponsor track, describe the contract architecture in terms of real primitives and why those choices were made.

The strongest application text uses this structure:

- project purpose,
- why Polkadot Hub specifically,
- which tracks it targets,
- what is live today,
- what is intentionally out of scope,
- what the post-hackathon roadmap looks like.

This is stronger than generic language like “scalable,” “innovative,” or “full-stack.” Judges see those words constantly. They remember specific architecture and truthful scope.

## 12. Final checklist before submission

Before submitting, confirm all of the following:

The repository is public.  
All team members have completed the required identity steps.  
On-chain identity is set up where required by the rules.  
The deployed contracts are verified on the explorer.  
The README contains real run instructions.  
The demo video or screenshots exist and are easy to find.  
The project clearly states its target track mappings.  
The live demo path uses the public testnet and the documented RPC.  
The known limitations are stated honestly.  
The roadmap exists and is believable.  
The submission text uses the same story as the README and the demo.

If any one of those is missing, fix it before polishing anything else.

## 13. The winning posture

Against a field of many submissions, the strongest projects usually win by feeling more real, not more grandiose. A judge should finish your repo and think: this team made hard choices, built the important path completely, documented it clearly, and understands what they built.

That is the posture these specs are designed to create.

DualVM Lending wins by being a clean, verifiable one-market lending primitive with a real but disciplined PVM wedge.

Sentinel TreasuryOS wins by being a believable treasury operating layer where AI is helpful, policy is authoritative, and Polkadot-native capability is used without hand-waving.

If you keep the story tight, the network assumptions honest, and the demo unforgettable, you will look stronger than many louder projects that attempted more and finished less.