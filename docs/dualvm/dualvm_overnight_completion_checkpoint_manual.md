# DualVM Lending — Overnight Completion Audit, Checkpoint Plan, and Submission Readiness Manual

## Purpose of this document

This document is the working reference for finishing **DualVM Lending** in one disciplined overnight push without lying to yourselves, without drifting into fake completeness, and without wasting scarce hours on features that look impressive but do not improve hackathon scoring. It is not a pitch deck. It is not a dream roadmap. It is a brutal completion manual.

The goal is simple: use the current repo truth, the official Polkadot Solidity Hackathon 2026 rules, and current Polkadot Hub documentation to decide what is already good, what is still weak, what is dangerous to claim, and what must be completed before submission. The project does not need to become production-ready tonight. It does need to become **submission-ready, judge-credible, technically honest, and demo-safe**.

This document assumes the current implementation state described in the forensic handoff: live public-testnet deployment exists, contracts are verified, core flows have some live proof, the debt asset is still mock, the oracle is still manual, the frontend is still mostly observer-only, and the live DualVM claim is not fully proven as a judge-visible REVM-to-PVM execution story. The repo already contains contracts, scripts, manifests, proofs, and a frontend shell, but it is still missing several things that matter for both judging and long-term credibility.

It also assumes the runtime model you locked in: **no local Polkadot node, no chain sync, no private infra, no giant server**. The entire build, test, deploy, verify, and demo process should work against public Polkadot Hub infrastructure and a small Linux VPS. That is the right choice. Official node guidance for a serious Polkadot Hub RPC node is far beyond a 4 CPU / 8 GB RAM box, so self-hosting chain infra would be an own goal. Public RPC is not just acceptable here; it is the only reasonable path for this sprint.

## Executive verdict

### Is the project fully complete right now?

**No.**

It is beyond the concept stage and beyond the empty-demo stage, which is a real achievement. But it is not fully complete by hackathon judging standards, and it is nowhere near production-ready by real DeFi standards. The correct framing is:

- **MVP credibility:** partially achieved
- **Submission-critical readiness:** not yet achieved
- **Production-oriented hardening:** not achieved
- **Hackathon fullness across Track 1, Track 2, and OpenZeppelin sponsor expectations:** still incomplete

That is not a reason to panic. It is a reason to stop pretending the remaining work is optional.

### What is already genuinely strong

The project already appears to have the pieces many hackathon teams never reach:

- a live public testnet deployment
- verified contracts
- a bounded lending design instead of a fake generalized protocol
- smoke-tested borrow, repay, and liquidation flows
- a manual oracle that is at least hardened, not just a naked mutable number
- role separation better than a raw single-owner contract
- a public-RPC-first operational model
- a clear DeFi use case that fits Track 1
- at least some PVM architecture surface that could fit Track 2 if it is truly evidenced
- real OpenZeppelin composition instead of trivial token theater

That matters because the hackathon explicitly wants open source, active contribution history, documentation, demoability, UI/UX, roadmap clarity, and track relevance. You are not starting from zero.

### What is still dangerous

The project will still underperform or get penalized if any of the following remain unresolved at submission time:

- the network story stays ambiguous
- the frontend remains read-only while the README implies a usable dApp
- the Track 2 PVM story is asserted more strongly than it is proven
- the repo still contains stale or conflicting docs that judges can read before the correct one
- the demo depends on brittle live scripts that mutate state and may not reset cleanly
- the submission does not include a hosted frontend or a crystal-clear reproducible guide
- the repo has weak CI, weak test breadth, and unclear environment setup
- on-chain identity, public repo readiness, and visible commit history are not buttoned up

Tonight is about closing those gaps in the right order.

## What the hackathon actually rewards

The official hackathon surface is narrower than people emotionally remember. The event is built around two prize tracks: **Track 1** for Solidity and EVM-compatible applications on Polkadot Hub, especially DeFi, stablecoin-enabled dapps, and AI-powered dapps; and **Track 2** for PVM work, native assets, and precompile-based access to Polkadot-native functionality. The OpenZeppelin sponsor bounty separately rewards secure, non-trivial use of OpenZeppelin libraries on Polkadot Hub. Multiple tracks can be entered, and organizers explicitly said a project may win multiple prizes if it qualifies.

The judging and winner criteria are also brutally practical. Projects must be open-source, show valid hackathon-period commit history, and have team identity verification. Winners must also show Polkadot on-chain identity, good documentation, demo video or screenshots, a hosted deployment or local installation guide, decent UI/UX, a clear roadmap, and valid track relevance. This means the hackathon is not scoring only the contracts. It is scoring whether the whole project feels testable, understandable, and worth accelerating.

That should completely shape tonight’s priorities. If a task improves internal elegance but not demo reliability, repo clarity, scoring visibility, or track conformity, it should lose to tasks that do.

## The most important brutal correction

The project must stop aiming at two incompatible goals at once:

1. looking like a production DeFi protocol, and  
2. finishing as a hackathon submission tonight.

You cannot do both in one night.

Tonight’s correct mission is not “finish production.” It is:

**Make DualVM Lending impossible to dismiss as fake, incomplete, or misleading.**

That means:
- make the repo truthful
- make the demo smooth
- make the tracked claims provable
- make the scoring surfaces visible
- make the weak points documented rather than hidden

That is how you beat teams that are louder but sloppier.

## Current status by scoring pillar

## 1. MVP credibility

### Current status: **yellow**

The MVP is credible in architecture, but not yet fully credible in user experience and proof surface.

Why it is credible:
- the market is isolated and narrow rather than vague
- there is a live deployed system
- the debt accounting issue around bad debt appears to have been found and corrected
- borrow, repay, and liquidation are not just diagrammed, they are at least partly proven
- public RPC is sufficient for demo access

Why it is still weak:
- the frontend does not yet look like a complete lending product
- browser-based write flows are not clearly proven
- the debt asset is still an intentional mock
- the oracle is still centralized and manual
- the live PVM claim is still weaker than the name “DualVM Lending” implies

Interpretation: the protocol can plausibly be demoed, but the user journey may still feel like a protocol shell plus operator scripts instead of a finished dApp.

## 2. Submission-critical readiness

### Current status: **red**

This is the area most likely to sabotage an otherwise solid project.

Critical items that must be explicitly confirmed before submission:

- public open-source repository
- active and visible commit history during the hackathon window
- on-chain identity ready
- hosted frontend or extremely clean local demo guide
- demo video or screenshots
- README that matches current truth rather than stale ambition
- clear explanation of which track claims are real
- explorer verification links
- reproducible deployment and test instructions
- no contradictory network documentation

This pillar is often what separates shortlisted projects from “technically interesting but not clean enough.”

## 3. Production-oriented hardening

### Current status: **red**

This project is not production-ready, and if it claims to be, that becomes a weakness.

Still missing or weak:
- root admin remains too centralized
- oracle remains manual
- debt asset remains mock
- no always-on liquidator service
- no robust indexer or backend data plane
- no comprehensive CI and security pipeline
- no evidence of a production-grade incident process
- no real stablecoin integration
- no real decentralized oracle integration

The right move tonight is not to solve all of that. The right move is to harden enough for credibility and document the rest honestly.

## 4. Hackathon fullness

### Current status: **yellow to red**

The project is technically substantial, but “fullness” is more than raw code.

A complete hackathon entry needs:
- a coherent narrative
- a working product slice
- a polished demo path
- clear track fit
- a roadmap that sounds real
- a submission package judges can understand in minutes

The current repo may still feel more like an engineer’s workspace than a judge-facing product package. That must change tonight.

## Hidden gaps you should assume still exist

Even if Codex says “finished,” assume the following are still dangerous until you personally verify them:

### Gap A — network truth drift

The historical documents and the current runtime assumptions are not perfectly aligned. If the repo still contains conflicting references to Passet Hub, Polkadot Hub TestNet, different chain IDs, or different explorers, that is not a harmless doc issue. It creates broken wallets, failed deploys, and confused judges. The first checkpoint tonight is to freeze one canonical network story and remove or clearly label every stale variant.

### Gap B — Track 2 claim drift

The project name and architecture say “DualVM,” but the forensic handoff is explicit that the live risk path does not yet prove live cross-VM execution strongly enough. That is the biggest truth gap in the entire project. If the explorer trace, live call path, and README do not clearly show the PVM role, then Track 2 relevance is weaker than desired. If you cannot prove the live REVM-to-PVM story tonight, you must narrow the Track 2 claim rather than bluff it.

### Gap C — UI/UX underinvestment

The hackathon does not score contracts in isolation. It explicitly says UI/UX matters. An observer dashboard is useful, but it is not the same thing as a usable lending dApp. If there is no browser wallet write path for at least the happy-path actions, the judges may conclude the protocol is real but the product is unfinished. That does not kill submission, but it lowers upside.

### Gap D — dangerous proof scripts

Smoke scripts that mutate oracle state or other risk parameters are good for internal validation and bad for casual live demos. If these scripts can leave the system in a half-restored state, they are operationally dangerous. You need a clean demo mode, not just a pile of operator scripts.

### Gap E — repo hygiene and reproducibility

If the repo still lacks an environment example file, a clean bootstrap path, CI, a consistent docs landing page, and a single canonical README, it will feel messy. Messy repos scare judges because they signal unfinished thinking.

### Gap F — local secrets

Wallet text files that are gitignored but still live in the workspace are not a theoretical concern. They are a real risk when an agent is operating all night. One accidental move, rename, or commit and the repo becomes contaminated.

### Gap G — insufficient tests on real risk branches

One local test file and a handful of live smokes are better than nothing, but probably not enough. The missing branches likely include withdrawal edge cases, pause behavior, reserve claims, stale-oracle behavior in every affected path, and residual-debt conditions after partial liquidation. Those gaps matter because lending protocols fail in branches, not in happy-path borrow demos.

### Gap H — submission asset fragmentation

If the README, DoraHacks description, demo video, architecture note, and live frontend say slightly different things, judges will punish the confusion even if no one says so out loud. One canonical message must drive all surfaces.

## Tonight’s staged completion plan

This is the correct work order. Do not skip ahead.

## Checkpoint 0 — Freeze truth

**Goal:** eliminate ambiguity before writing more code.

Tasks:
- decide the one canonical live network for tonight
- verify the frontend, manifests, explorer links, faucet instructions, and deployment scripts all point to it
- mark all stale docs as historical or remove them from the judge-facing path
- decide the precise Track 1 claim, Track 2 claim, and OpenZeppelin claim you can defend

Pass only if:
- one network story exists
- one explorer exists
- one faucet instruction exists
- one README entry point exists
- one sentence explains Track 2 honestly

Fail if:
- the repo still makes a judge choose between conflicting truths
- the team still says “we will decide later”

This checkpoint is mandatory. If you skip it, every later improvement sits on sand.

## Checkpoint 1 — Clean boot on the real VPS

**Goal:** prove the repo can be used by a fresh machine and a fresh agent session.

Tasks:
- verify dependency install from scratch
- verify local build passes
- verify local tests pass
- verify no hidden local-only path dependencies exist
- add or update the project memory file that tells the agent the architecture, network, environment variables, out-of-scope features, and definition of done

Pass only if:
- a fresh session can install, build, and run the documented test and app steps
- the agent can start from the repo without reading your mind

Fail if:
- the setup depends on state that exists only on your current machine
- critical environment variables are undocumented
- the agent has no canonical memory file

This is where modern long-running agent best practice matters. Incremental work with persistent project memory beats a giant one-shot command every time.

## Checkpoint 2 — Contract truth and test truth

**Goal:** make the protocol core defensible.

Tasks:
- re-run and verify the full local test suite
- add missing tests for the highest-risk branches that are still uncovered
- confirm the bad-debt accounting fix is still green
- confirm stale oracle behavior, pause behavior, withdrawal safety, and admin gating are tested
- ensure the tests map clearly to the protocol claims in the README

Pass only if:
- every important contract claim has either a local test, a live smoke, or both
- the tests cover the failure paths that matter to lending

Fail if:
- you only have happy-path proof
- the README claims behavior that no test or smoke backs up

Priority rule: one additional high-value test is better than three low-value cosmetic refactors.

## Checkpoint 3 — Live public-testnet proof package

**Goal:** make the real chain state part of the submission evidence.

Tasks:
- verify current deployment addresses and explorer pages
- confirm the main happy-path flows still succeed on live public RPC
- capture fresh event or transaction evidence for deposit, borrow, repay, and liquidation if those are part of the demo
- generate current proof artifacts and recent event snapshots
- document exactly which flows are live-proven and which are only locally proven

Pass only if:
- a reviewer can click from README to explorer and see current truth
- the live proof artifacts are fresh and match the current repo

Fail if:
- deployment addresses are stale
- explorer links are missing
- the chain evidence does not match current docs

Important rule: do not run random destructive live scripts during this stage. Use dedicated demo accounts and keep the live state clean.

## Checkpoint 4 — Judge-usable frontend

**Goal:** lift the product from “protocol with scripts” to “demoable dApp.”

Tasks:
- decide the minimum browser actions that must exist tonight
- best target: wallet connect, collateral deposit, borrow preview, borrow submit, repay submit, live health factor display
- if liquidation cannot be safely productized tonight, keep it operator-only and say so
- make errors human-readable
- surface network, contract addresses, and scope limitations clearly
- ensure the frontend handles public RPC slowness gracefully enough for judging

Pass only if:
- a judge can open the hosted frontend and understand what to do
- at least one meaningful write flow exists from the browser, or the submission very clearly says the frontend is observer-first and the demo uses a documented operator path

Fail if:
- the frontend remains a pretty observer shell while the README talks like a full dApp
- wallet or network setup is confusing
- the error states are raw and ugly

This checkpoint is a huge score multiplier. Do not underrate it.

## Checkpoint 5 — Track 2 proof or Track 2 downgrade

**Goal:** prevent fake DualVM claims.

Tasks:
- verify whether the live risk engine path is really PVM-backed in a way you can demonstrate
- capture the explorer trace, contract proof, or transaction narrative that proves it
- if the PVM path is not judge-visible and defensible, narrow the wording immediately
- if needed, create a separate clearly-scoped Track 2 proof script or auxiliary demo that shows the PVM component honestly

Pass only if:
- you can answer “where exactly is PVM used?” in one sentence and one proof link

Fail if:
- the answer is “it is in the architecture somewhere”
- the repo still implies fully-proven cross-VM execution without clear evidence

This is the most important truth checkpoint. Failing it does not kill the project, but it does change how you should submit it.

## Checkpoint 6 — Security and operations hardening for submission, not mainnet

**Goal:** remove the most embarrassing avoidable risks.

Tasks:
- remove local secret material from any risky repo-adjacent location
- make sure no private keys or seed phrases can be committed
- add at least a minimal CI path for install, test, and build
- make the admin model explicit in docs
- state clearly that the oracle is manual and the debt asset is mock
- verify any pause, delay, or role control claims against live manifests
- document all dangerous live scripts and their safe usage rules

Pass only if:
- a reviewer sees a cautious system, not a reckless one
- no fake production claims remain

Fail if:
- the repo still looks like it might accidentally leak secrets
- the docs oversell the governance or oracle model
- there is still no machine-checkable build path

## Checkpoint 7 — Submission package completion

**Goal:** produce everything the judges actually consume.

Tasks:
- final README
- architecture section with simple diagrams in prose or images
- live links: frontend, explorer, repo
- known limitations section
- roadmap section
- demo video or screenshot sequence
- DoraHacks summary text aligned to Track 1, Track 2, and OpenZeppelin wording
- proof of identity readiness and public repo readiness

Pass only if:
- another person can understand the project in five minutes from the repo and links alone

Fail if:
- vital information still lives only in chat logs, agent memory, or internal notes

## Checkpoint 8 — Final scoring rehearsal

**Goal:** score the project against the real rubric before the judges do.

For each category, answer “yes,” “partly,” or “no”:

- open-source and public
- valid commit history during event
- on-chain identity ready
- hosted deployment available
- demo video/screenshots ready
- clean documentation
- understandable UI/UX
- Track 1 relevance obvious
- Track 2 relevance proven, not implied
- OpenZeppelin non-trivial usage obvious
- roadmap believable
- live proof links current

If any of the first six are not “yes,” you are not done.

## The subagent and workstream model for tonight

Do not run one giant autonomous instruction. Split the work into focused roles.

## Workstream A — Repo Truth Keeper

Mission:
- freeze network truth
- remove stale docs from the judge path
- maintain the canonical README
- update project memory files
- keep scope boundaries explicit

This role owns consistency. No other agent should edit the public README without this role reconciling the final narrative.

## Workstream B — Contract Finisher

Mission:
- close the highest-risk missing tests
- verify access control, oracle safety, withdrawal logic, liquidation dust behavior, and reserve accounting
- refuse cosmetic changes unless they unblock a test or a demo

This role does not get distracted by style. It owns correctness.

## Workstream C — PVM Verifier

Mission:
- determine whether the Track 2 claim is fully defensible
- capture the strongest evidence possible
- if the proof is weak, rewrite the claim rather than inventing confidence

This role exists because Track 2 can either increase your upside or damage your credibility.

## Workstream D — Frontend Closer

Mission:
- deliver a hosted, judge-usable frontend
- add or improve wallet connection and the minimum write flows
- make error states intelligible
- keep the UI focused on one successful lending narrative

This role is responsible for score lift, not protocol theory.

## Workstream E — Testnet Proof Operator

Mission:
- run fresh smoke validations
- generate fresh artifacts
- capture explorer links and recent events
- avoid polluting the live system with chaotic manual experiments

This role must use dedicated test accounts and treat the chain as a demo environment, not a playground.

## Workstream F — Submission Packager

Mission:
- produce the DoraHacks description
- write the demo script
- compile screenshots and video
- ensure README, frontend copy, and submission text tell the same story
- confirm on-chain identity and repo visibility requirements are satisfied

This role is how technical work becomes judged work.

## The correct overnight loop

The working loop for the night is good in spirit, but it needs more discipline than “go infinite.”

Use this loop instead:

1. pick the next failing checkpoint item, not the next interesting idea  
2. inspect current code and docs before editing  
3. implement the smallest change that can make the item pass  
4. run the narrowest relevant test first, then the broader suite if it passes  
5. if the change touches live behavior, run the appropriate public-testnet smoke validation  
6. update the docs or memory file in the same pass  
7. commit only when the item is green and evidenced  
8. if it fails, revert to the last green checkpoint and try a narrower fix  
9. do not let the agent wander into unrelated refactors  
10. repeat

The project should advance through **green checkpoints**, not through hours spent.

## What absolutely must be true before you submit

You can submit even if the project is not production-ready. You cannot submit safely if these remain unresolved:

- the README is still misleading
- the network story is still ambiguous
- the project is not clearly public and open-source
- the frontend is not hosted or the local guide is not clean
- the demo assets are missing
- Track 2 is claimed without evidence
- on-chain identity is not ready
- the final repo still contains stale “future system” language that contradicts the current build

## What you should cut if time runs out

If time becomes critical, cut in this order:

1. any decorative packaging such as unnecessary npm or PyPI publication  
2. any non-essential refactor  
3. any attempt to widen the market design  
4. any speculative XCM or native-asset expansion  
5. any fake production hardening that cannot be proven  
6. any roadmap item masquerading as MVP work

Do **not** cut:
- README truth
- live proof links
- demo assets
- frontend clarity
- test coverage on core risk paths
- identity and submission requirements

## Recommended final submission framing

Your strongest honest framing is something like this:

DualVM Lending is a public-RPC-first isolated lending market on Polkadot Hub testnet. It gives judges a live, testable DeFi flow with verified contracts, real public-chain deployment, OpenZeppelin-based security composition, and a bounded PVM-oriented risk component. The MVP is intentionally narrow so the product is explainable, reproducible, and demo-safe. It does not claim mainnet readiness or pretend a mock stablecoin and manual oracle are production integrations.

That is a much better story than pretending you shipped a fully mature DeFi stack.

## Final readiness matrix

| Area | Status now | Must be green tonight | Notes |
| --- | --- | --- | --- |
| Live deployment exists | likely yes | yes | keep explorer links current |
| Verified contracts | likely yes | yes | link directly in README |
| Borrow / repay / liquidation proof | likely yes | yes | refresh evidence |
| Frontend hosted | uncertain | yes | major scoring surface |
| Browser write flow | uncertain / likely weak | strongly recommended | huge UI/UX lift |
| Track 1 fit | yes | yes | easy to defend |
| Track 2 fit | uncertain | yes or narrow claim | do not bluff |
| OpenZeppelin track fit | yes if explained | yes | document non-trivial usage |
| Open-source repo and commit history | uncertain | yes | submission blocker |
| On-chain identity | uncertain | yes | winner requirement |
| Demo video / screenshots | uncertain | yes | submission blocker |
| Clean README / docs | uncertain | yes | first judge touchpoint |
| CI and reproducibility | weak | recommended | good trust signal |
| Production readiness | no | not required | document honestly |

## Final answer to the question “are we complete?”

**Not yet.**  
But the project is close enough that one disciplined night can make it an excellent submission.

The key is to stop measuring progress by how much code the agent writes and start measuring it by which checkpoint turned green. If by dawn you have:

- one frozen network truth
- one canonical README
- one hosted frontend
- one clean judge demo path
- one honest Track 2 story
- one fresh live proof bundle
- one public repo with current commits
- one completed identity and submission package

then the project will be **strong, credible, and competitive**, even though it will still not be production-ready.

That is the correct target.

## Suggested reading and source set for tonight

Use these as the only trusted references while finishing:

- official DoraHacks Polkadot Solidity Hackathon page and archived criteria snapshot
- official Polkadot Hub documentation for Hardhat, dual VM stack, ERC20 precompile, XCM precompile, and Hub overview
- official Polkadot Hub RPC node guidance, only to remind yourselves why public RPC is the right choice for this VPS
- OpenZeppelin Contracts 5.x access-control documentation, especially AccessManager
- the current DualVM forensic handoff
- the latest current-state or parity-check documents in the repo
- your final README draft and deployment manifests

Do not let old speculative specs outrank current evidence.

## Last instruction for the overnight run

Every time the agent or a teammate says “done,” ask three questions:

1. where is the evidence?  
2. can a judge see it in under one minute?  
3. does the repo say the same thing as the code and the live chain?

If any answer is no, the task is not done.

That single habit will do more for your submission quality tonight than any extra fancy feature.