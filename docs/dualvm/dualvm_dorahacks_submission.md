# DualVM Lending DoraHacks Submission Package

## Paste-ready short summary
DualVM Lending is a public-RPC-first isolated lending market on Polkadot Hub TestNet. It demonstrates a live DeFi flow with verified contracts, a hosted frontend, public Blockscout proof, OpenZeppelin-based access control and safety primitives, and a bounded PVM-aligned risk-computation module. The MVP is intentionally narrow: one collateral asset (`WPAS`), one debt asset (`USDC-test`), one market, one liquidation path, no XCM in the critical path, and no fake production claims. The deployed solvency path is REVM-centric today; Track 2 is presented honestly through the real risk-engine module and generated PVM artifact, not by claiming unproven live cross-VM execution.

## Live links
- Public repo: `https://github.com/symulacr/dualvm-lending`
- Hosted frontend: `http://eyawa.me/dualvm-lending/`
- Explorer root: `https://blockscout-testnet.polkadot.io/`
- Verification artifact: `dualvm/deployments/polkadot-hub-testnet-verification.json`
- Manifest: `dualvm/deployments/polkadot-hub-testnet.json`
- Recent live proof snapshot: `dualvm/deployments/polkadot-hub-testnet-recent-events.json`

## Track mapping
### Track 1
- Stablecoin-enabled DeFi application
- Live public-testnet lending flow with collateral deposit, borrow, repay, and liquidation

### Track 2
- Exact code location: `dualvm/contracts/pvm/PvmRiskEngine.sol`
- Exact artifact path: `dualvm/pvm-artifacts/PvmRiskEngine.json`
- Exact claim: bounded PVM parity / computation posture
- Exact non-claim: the current deployed solvency path is not presented as proven live REVM -> PVM execution

### OpenZeppelin sponsor fit
- `AccessManager`
- `Pausable`
- `ReentrancyGuard`
- `SafeERC20`
- ERC-4626-style debt pool with explicit reserve segregation and loss accounting

## Architecture at one glance
```text
Browser / Judge
  -> hosted frontend (observer-first)
  -> public ETH RPC on Polkadot Hub TestNet
  -> verified Solidity contracts on REVM
     - WPAS
     - USDCMock
     - DebtPool
     - LendingCore
     - ManualOracle
     - DualVMAccessManager
     - PvmRiskEngine
  -> Blockscout proof links

Write-path truth tonight:
  browser UI = read-first and proof-first
  write transactions = operator-run demo scripts + explorer tx links
```

## Current live proof links
- Collateral deposit: `https://blockscout-testnet.polkadot.io/tx/0x5bb5a89323efb7bdb56656b20c68ea01457ddfe9506f2534c116a6ac2863a602`
- Borrow: `https://blockscout-testnet.polkadot.io/tx/0x658ce8b5e631c3e77d970678e14da986a87a464eca274b1a8585baa65d846ba0`
- Repay: `https://blockscout-testnet.polkadot.io/tx/0x924ef9d6e5e5e69de37ffcaaf6c81593b1bc496a03ec049802d80392f247e43a`
- Liquidation: `https://blockscout-testnet.polkadot.io/tx/0xe8d1f4e36cbbb4c829f2b4d8ee19afc48acc2975e7a29804db9b28099932cef5`

## Demo screenshot assets
- Frontend home: `docs/dualvm/screenshots/frontend-home.png`
- Borrow transaction page: `docs/dualvm/screenshots/borrow-tx.png`
- Liquidation transaction page: `docs/dualvm/screenshots/liquidation-tx.png`
- Final media mode tonight: screenshot-only package (no narrated video included in the repo)

## Known limitations
- single market only
- manual oracle, even though it is now hardened with bounds and a max-move circuit breaker
- mock debt asset (`USDC-test`), intentionally honest rather than fake-realistic
- browser UI is observer-first; it does not yet submit lending transactions directly
- ultimate AccessManager admin remains a single EOA
- Track 2 is parity-oriented, not a proven live cross-VM execution claim
- no production indexer / backend / liquidation service

## Roadmap after submission
1. replace single-admin control with multisig or timelocked governance
2. move from manual oracle to a multi-source oracle path
3. replace the mock debt asset with a metadata-safe real asset integration
4. deepen frontend from observer-first into wallet-submitting flows
5. expand monitoring and indexing beyond snapshot + operator tooling
6. implement and prove true live cross-VM PVM execution if Track 2 is to become stronger than parity

## External submission checklist
The repo can prove these today:
- public repo exists
- hosted frontend exists
- verified contracts exist
- live proof tx links exist
- screenshot assets exist
- documentation exists

The repo cannot prove these because they are external team/operator tasks:
- Polkadot on-chain identity completion
- DoraHacks account / Discord identity verification status
- final narrated demo video upload

Those external items should be marked complete by the submitting team, not guessed by the codebase.

External blocker evidence captured during finalization:
- `docs/dualvm/submission_evidence/external_submission_blockers.md`
- `docs/dualvm/submission_evidence/dorahacks-event-screen.png`
- `docs/dualvm/submission_evidence/dorahacks-login-blocker.png`
- `docs/dualvm/submission_evidence/discord-login-blocker.png`
- `docs/dualvm/submission_evidence/polkassembly-identity-screen.png`
