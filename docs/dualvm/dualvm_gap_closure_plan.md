# DualVM Gap Closure Plan

This document translates the original DualVM specs into a current implementation closure plan.
It assumes the live system now exists on Polkadot Hub TestNet and that the parity checklist in `docs/dualvm/dualvm_spec_parity_checklist.md` is the source of truth for what is DONE, PARTIAL, MISSING, or DRIFTED.

## 1. Purpose of this plan
The original DualVM docs define the intended MVP shape well, but they now diverge from reality in three ways:

1. **Network drift**
   - The specs were written around Passet Hub assumptions.
   - The live system now runs on `Polkadot Hub TestNet` chain ID `420420417`.
2. **Implementation truth**
   - The lending MVP is live and smoke-tested.
   - The docs still talk as if the product is only planned.
3. **Remaining parity gaps**
   - Some MVP items are still partial or missing.
   - Several production-readiness concerns remain far outside hackathon scope.

The goal is not to bloat the system. The goal is to close the most important gaps while preserving honest scope.

## 2. Current live baseline
Current live deployment:
- AccessManager: `0x06Ca684578a01d6978654A4572B6A00Abe934575`
- WPAS: `0x0Dece14653B651Ee10df0bBcb286C9170A24e1bc`
- USDCMock: `0x789cf6A8B73Eab267C6B0eEa0E38fbE2AcD0Caf4`
- Oracle: `0x7627582B2183bf8327f0ead9aA1D352201c7De06`
- RiskEngine: `0xe46b428cd93faD2601070E27ca9e6197f1576268`
- DebtPool: `0x7aFe578b08ffB14EdD6457f436fe68c3282D2B68`
- LendingCore: `0x42D489D093d00522a77405E6cEaE2F4B89956C25`

Live proofs already completed:
- supply path
- collateral deposit path
- borrow path
- bad-debt liquidation path after accounting fix

## 3. Spec-to-implementation delta summary
### Already aligned enough for hackathon MVP
- one isolated market
- WPAS collateral
- USDC-test debt asset
- manual oracle with freshness
- REVM-centered solvency
- DebtPool separation from collateral
- public-RPC-first runtime
- no XCM in the core lending path
- live deployment on public testnet

### Still partial for MVP parity
- none blocking an honest hackathon submission after the current documentation, proof, and governance updates

### Still far from production parity
- ultimate admin remains a single EOA rather than a multisig or timelocked governance system
- multi-source / decentralized oracle path beyond the current hardened manual oracle
- real debt asset / economic realism
- deeper monitoring / alerting beyond the current watcher and guarded liquidator scripts
- indexer-quality observability
- true live cross-VM PVM execution if that remains a goal

## 4. Priority-ordered closure list

### P0 — Must close for truthful hackathon submission
#### 1. Explorer verification
**Why:** both specs and the playbook treat verification as mandatory trust infrastructure.

**Current state:** completed for the current deployment.

**Delivered:**
- verified contracts on Blockscout for the current deployment
- reusable verification flow via `npm run verify:testnet`
- verification artifact at `dualvm/deployments/polkadot-hub-testnet-verification.json`


---

#### 2. README/submission truth refresh
**Why:** the docs now have stale network assumptions and the implementation has moved from plan to live deployment.

**Current state:** parity checklist and memory are current, but judge-facing top-level repo docs are not yet shown to be aligned.

**Deliverable:**
- README that states current network and live addresses
- clear statement of what is real today versus roadmap
- explicit wording on PVM parity if live cross-VM execution is still not the active path

**Verification:**
- README, demo script, and submission text tell the same story

---

#### 3. Live repay proof
**Why:** repayment is part of the spec definition of done and should be proven on the live deployment, not only locally.

**Current state:** completed on the current deployment.

**Delivered:**
- `dualvm/scripts/liveRepaySmoke.ts`
- `npm run repay-smoke:testnet`
- live proof that debt decreased from `200.000261088280060882` to `150.000261088280060882`


## P1 — Should close to improve MVP credibility
#### 4. Frontend observability parity
**Why:** the final spec expects balances, utilization, health factor, and recent events in the UI.

**Current state:** completed in observer mode against the live deployment.

**Delivered:**
- pool balances and utilization in the frontend
- tracked-address debt, borrow headroom, and health factor
- recent LendingCore event list over a recent block window
- explicit observer-only positioning rather than pretending a hidden backend


---

#### 5. Governance truth gap
**Why:** the original live deployment collapsed operational roles into one EOA; that gap has now been reduced, but ultimate admin control is still centralized.

**Current state:** operational roles are split and delayed in practice for risk, treasury, and minter actions.

**Delivered:**
- distinct live operational role addresses in `dualvm/deployments/polkadot-hub-testnet.json`
- governance proof artifact at `dualvm/deployments/polkadot-hub-testnet-governance-proof.json`
- live delayed minter and risk-admin proofs via smoke scripts


---

#### 6. Spec-internal drift cleanup
**Why:** the production spec and final spec still contain stale Passet Hub wording and, in places, stronger expectations than the live system now satisfies.

**Current state:** parity checklist documents the drift, but the original spec files remain historically written.

**Deliverable:**
- either add an explicit addendum to the existing specs
- or prepend a short note that the parity checklist supersedes old endpoint assumptions

**Verification:**
- a new reader cannot confuse Passet Hub with the current live deployment target

## P2 — Important architectural decisions, but not required to submit honestly
#### 7. Decide the real PVM posture
**Why:** this is the main architectural truth gap.

**Current state:** decision made.

**Final decision:**
- choose **Option A** for the current hackathon build
- freeze the wording at parity / bounded computation posture
- do not claim proven live cross-VM PVM execution in the deployed solvency path
- use `docs/dualvm/dualvm_pvm_posture.md` as the canonical wording source

**Verification:**
- README, submission guide, addendum, and parity checklist all align with the same parity-only PVM truth


#### 8. Agent-executable repository completeness
**Why:** the production-oriented spec wanted `features.json`, `progress.md`, `init.sh`, and `SPEC.md`-style artifacts.

**Current state:** completed for the current repository workflow layer.

**Delivered:**
- `dualvm/SPEC.md`
- `dualvm/features.json`
- `dualvm/progress.md`
- `dualvm/init.sh`
- existing `CLAUDE.md`, deploy scripts, smoke scripts, and parity docs now form a coherent restart surface


## P3 — Production-only concerns
These should be recorded, not smuggled into MVP scope.

### 9. Oracle hardening
- current hardened manual oracle now includes min/max price bounds and a max-move circuit breaker
- live upgrade and delayed oracle-admin proof exist in `dualvm/deployments/polkadot-hub-testnet-oracle-proof.json`
- the remaining production concern is oracle decentralization / multi-source feeds, not the absence of any circuit breaker

### 10. Economic realism
- the live system now carries an explicit asset-path decision via `docs/dualvm/dualvm_asset_path_decision.md`
- the remaining production concern is a real debt-asset integration beyond the current explicit mock-stable path

### 11. Liquidation and ops automation
- baseline operator tooling now exists through `dualvm/scripts/liquidationWatch.mjs` and `dualvm/scripts/executeLiquidation.ts`
- the remaining production concern is richer monitoring, alerting, and service-grade automation rather than the complete absence of operator tooling

### 12. RPC and indexing resilience
- the frontend read layer now uses a short-TTL cache
- recent events can be snapshotted into `dualvm/deployments/polkadot-hub-testnet-recent-events.json` via `npm run index-events:testnet`
- the remaining production concern is a deeper indexer/service layer, not the complete absence of any resilience work

## 5. Recommended next sequence
This closure plan has now been executed for the current hackathon scope.

If further work continues, the next sequence is no longer a gap-closure sequence but a broader production-expansion sequence:
1. move from single-admin governance to multisig/timelocked governance
2. move from the hardened manual oracle to a multi-source oracle architecture
3. move from explicit mock debt-asset truth to a real debt-asset integration
4. deepen automation and indexing beyond the current baseline scripts and snapshot cache

## 6. What not to do next
To preserve scope discipline, do **not** do these next unless requirements change:
- do not add XCM to the core flow
- do not add multiple markets
- do not replace the mock stablecoin path in the same pass
- do not chase a production oracle redesign before submission polish
- do not claim governance strength that the live deployment does not yet have

## 7. Exit condition for “good enough hackathon parity”
The system is good enough for a disciplined submission when all of these are true:
- live deploy is current and reproducible
- supply, borrow, repay, and liquidation are all proven live
- explorer verification is complete
- README/demo/submission text reflect the real implementation
- PVM wording is truthful
- remaining governance/oracle limitations are documented rather than hidden
