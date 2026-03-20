# DualVM Lending — DoraHacks Submission

## Project Name
DualVM Lending

## One-Liner
A production-minded isolated lending market on Polkadot Hub TestNet combining REVM custody with a live PVM risk engine and OpenZeppelin Governor governance.

## Project Description

DualVM Lending is a fully functional lending protocol deployed on Polkadot Hub TestNet. Users deposit wrapped PAS (WPAS) as collateral and borrow USDC-test from an ERC-4626 liquidity pool. The protocol features a complete lending lifecycle: deposit, borrow, repay, and liquidation — all proven live on-chain with explorer-verified transactions.

What makes this project distinctive is its honest, live integration of Polkadot's dual-VM architecture:

- The **risk engine** is a PVM-compiled **DeterministicRiskModel** (compiled via `resolc`) that serves as the PRIMARY risk computation source through **RiskGateway**, with REVM inline math as the fallback. The PVM model accepts governance policy overrides and produces different output when policies are active.
- **Provable XCM execution** via `XcmLiquidationNotifier` using `ClearOrigin + SetTopic(correlationId)` — verified on-chain with end-to-end correlationId propagation from lending events through to XCM topics
- **Governor-based governance** using 5 composed OpenZeppelin Governor extensions controls the entire protocol through a propose/vote/queue/execute lifecycle

The protocol is public-testnet-validated with 12 deployed contracts (11 explorer-verified on Blockscout), 300 passing Foundry tests, and a browser-based frontend with full read/write capability.

## GitHub Repository
https://github.com/symulacr/dualvm-lending

## Hosted Frontend
- **Primary (Vercel):** [https://dualvm-lending.vercel.app](https://dualvm-lending.vercel.app)
- **Backup (GitHub Pages):** [http://eyawa.me/dualvm-lending/](http://eyawa.me/dualvm-lending/)

## Demo Video
A browser walkthrough demo video is included in the repository at `docs/dualvm/demo-video.webm` (WebM format). The video shows the complete flow: frontend navigation, wallet connect modal (RainbowKit), market data display, explorer verification of lending TXs, and PVM interop proof TXs on Blockscout. See `docs/dualvm/demo_guide.md` for the full annotated demo walkthrough with screenshots.

## Demo Screenshots
All screenshots are in `docs/dualvm/screenshots/`:
- `frontend-home-full.png` — Full frontend with market data, deployment manifest, lending forms
- `wallet-connect-modal.png` — RainbowKit wallet connect (MetaMask, Rainbow, WalletConnect)
- `frontend-lending-forms.png` — Write-path deposit/borrow/repay/liquidate forms
- `frontend-observer-section.png` — Position observer and health factor tracking
- `borrow-tx.png` — Blockscout borrow transaction proof
- `liquidation-tx.png` — Blockscout liquidation transaction proof

## Track 1: EVM Smart Contract — DeFi / Stablecoin-Enabled DApp

### What We Built
A complete lending market on Polkadot Hub TestNet with:

- **LendingEngine**: Immutable market version handling collateral deposits, borrowing, repayment, and liquidation with configurable parameters (max LTV 70%, liquidation threshold 80%, liquidation bonus 5%)
- **DebtPool**: ERC-4626 LP vault where liquidity providers earn yield from borrower interest. Includes OpenZeppelin's inflation-attack protection.
- **ManualOracle**: Governed price feed with circuit breaker (min/max price bounds, maximum price delta per update, staleness rejection)
- **RiskGateway**: Routes risk queries to the PVM DeterministicRiskModel (primary) with REVM fallback, bridging the market with the PVM risk engine
- **MarketVersionRegistry**: On-chain version activation boundary for replacing entire market versions through governance

### Live Proof
| Operation | Explorer Link |
|-----------|---------------|
| Borrow | [0x5a9edd08...](https://blockscout-testnet.polkadot.io/tx/0x5a9edd08efd8aec5e1ccbe0295b97e03cebc1b75588acf19a2738a109deba532) |
| Repay | [0x02825742...](https://blockscout-testnet.polkadot.io/tx/0x02825742b3d9cdc5e8c27b1ae30948d73885188c2e43a0de5c6105606c441dde) |
| Liquidation | [0xeec68ce0...](https://blockscout-testnet.polkadot.io/tx/0xeec68ce067523113520a888e9344860ea9d9421c135a6db6823da56ebe12048b) |
| Migration (v1→v2) | [0x6d959dc9...](https://blockscout-testnet.polkadot.io/tx/0x6d959dc9bc4ccf8ba2b815f6ad996ef5026f40e90c5e932542adfccaba45d78f) |

### Key Market Parameters
- Collateral asset: WPAS (wrapped PAS)
- Debt asset: USDC-test (18 decimals)
- Kinked utilization model: 2% base → 10% at kink (80%) → 40% at 100%
- Supply cap: 5M USDC, Borrow cap: 4M USDC, Min borrow: 100 USDC

## Track 2: PVM Smart Contract — PVM Experiments & Precompiles

### PVM-Primary Risk Architecture

The PVM risk engine is a **production-path primary component** — not a proof-of-concept or fallback:

1. **RiskGateway** at `0x5c66f69a04f3a460b1fabf971b8b4d2d18141bd4` routes all risk queries to the PVM-deployed **DeterministicRiskModel** as the PRIMARY risk computation source. REVM inline math serves as the fallback only when PVM is unavailable.
2. **DeterministicRiskModel** is compiled via `resolc` (Polkadot's Solidity-to-PolkaVM compiler) and deployed on-chain at `0x1e6903a816be0bc013291bbed547df45bdc9e86c`. This is real PVM bytecode, not EVM bytecode.
3. **QuoteInput** carries 7 fields including 3 governance policy overrides (`policyMaxLtvBps`, `policyLiqThresholdBps`, `policyBorrowRateFloorBps`). DeterministicRiskModel applies these overrides, producing output that **differs from the REVM fallback** when governance policies are active — proving the PVM computation is substantive, not decorative.
4. **GovernancePolicyStore** at `0x0c8c0c8e2180c90798822ab85de176fe4d8c86cf` persists governance-set risk policy overrides that flow through the QuoteInput pipeline.

### XCM Integration

**XcmLiquidationNotifier** at `0x9ce976675c3a859f2ad57d7976e6363fda22e825` uses XCM `execute()` for provable local XCM execution with `ClearOrigin + SetTopic(correlationId)`. This replaced the broken `send()` approach (which fails on ETH-RPC testnet due to absent relay infrastructure).

The correlationId propagates end-to-end: **LendingEngine** events → **LiquidationHookRegistry** → **XcmNotifierAdapter** → **XcmLiquidationNotifier** → XCM `SetTopic`. This creates an auditable, on-chain correlation trail between lending events and XCM notifications.

### On-Chain Verification (6/6 Pass)

| Test | Result | Evidence |
|------|--------|----------|
| PVM quote (no policy) | borrowRate=700, maxLtv=7500, liqThreshold=8500 | `cast call` on `0x1e6903a...` |
| PVM quote (with policy 6000,8000,500) | maxLtv=6000, liqThreshold=8000 | Governance overrides applied by PVM |
| RiskGateway.quoteEngine() | Points to PVM DeterministicRiskModel | `0x1e6903a...` |
| XCM weighMessage (ClearOrigin+SetTopic) | refTime=1,810,000 | Valid XCM V5 program |
| XCM execute | TX [0xa05693ff...](https://blockscout-testnet.polkadot.io/tx/0xa05693ff9b9af12fbf38f5f786240486137194923160d953fb1607a1f212ef8a) block 6595576 | On-chain proof, status=success |
| executeLocalNotification | TX [0xb35f468a...](https://blockscout-testnet.polkadot.io/tx/0xb35f468a3d235e05df38e361e461710b79da14246f5815c9ba0fc5c9f18092d9) block 6595577 | LocalXcmExecuted event with correlationId |

### Key Deployment Addresses

| Contract | Address |
|----------|---------|
| DeterministicRiskModel (PVM) | `0x1e6903a816be0bc013291bbed547df45bdc9e86c` |
| RiskGateway | `0x5c66f69a04f3a460b1fabf971b8b4d2d18141bd4` |
| LendingEngine | `0x11bf643d87b3f754b0852ff5243e795815765e7d` |
| XcmLiquidationNotifier | `0x9ce976675c3a859f2ad57d7976e6363fda22e825` |
| GovernancePolicyStore | `0x0c8c0c8e2180c90798822ab85de176fe4d8c86cf` |

### Platform Limitations (Honest)
- **PVM→REVM callbacks**: StackUnderflow error (pallet-revive platform limitation). The architecture works around this via adapter patterns — RiskGateway calls PVM, but PVM cannot call back into REVM contracts.
- **XCM send() to relay chain**: Fails on ETH-RPC testnet (no relay infrastructure). Replaced with `execute()` for provable local XCM execution, which succeeds on-chain.
- These are **documented, not hidden**. The architecture was designed around known platform constraints rather than pretending they don't exist.

## OpenZeppelin Sponsor Track — Non-Trivial OZ Composition

### Contracts Used

| OZ Contract | Where Used | Why |
|-------------|-----------|-----|
| **AccessManager** | System-wide | Role-function mapping with execution delays (riskAdmin=60s, treasury=60s, minter=60s) |
| **Governor** | DualVMGovernor | Full propose/vote/queue/execute lifecycle with 5 composed extensions |
| **GovernorCountingSimple** | DualVMGovernor | For/Against/Abstain vote counting |
| **GovernorVotes** | DualVMGovernor | Voting power from GovernanceToken |
| **GovernorVotesQuorumFraction** | DualVMGovernor | 4% quorum of total supply |
| **GovernorTimelockControl** | DualVMGovernor | TimelockController integration |
| **TimelockController** | Governance timelock | 60s minimum delay, holds AccessManager admin |
| **ERC20Votes + ERC20Permit** | GovernanceToken | Delegated voting power, gasless approvals |
| **ERC4626** | DebtPool | LP vault with virtual offset inflation-attack protection |
| **SafeERC20** | LendingEngine | Safe token transfers in all fund flows |
| **Pausable** | Core, Pool, Oracle | Emergency pause capability |
| **ReentrancyGuard** | Core, Pool | Protection on all state-changing fund flows |

### Governance Chain of Trust
```
GovernanceToken (ERC20Votes)
    ↓ voting power
DualVMGovernor (5 extensions)
    ↓ proposals
TimelockController (60s delay)
    ↓ admin role
AccessManager (non-zero delays)
    ↓ role-function mapping
LendingEngine / DebtPool / Oracle / Registry
```

**Deployer has ZERO residual roles** after bootstrap — verified by on-chain role checks and tests.

### Live Governance Proof
| Operation | TX Hash |
|-----------|---------|
| Version Activation via Governor | [0x3278a9ee...](https://blockscout-testnet.polkadot.io/tx/0x3278a9ee913be2f47907ae2921f8a1be2ec0d4525ee3b58e7092b1e2801a22eb) |
| Deployer Admin Renunciation | [0x61c09d53...](https://blockscout-testnet.polkadot.io/tx/0x61c09d5353c0d3c0246f818a413780517e7b7d5510022330fb822ac67c41e863) |
| Migration via Governance Proposal | [0x12fa628a...](https://blockscout-testnet.polkadot.io/tx/0x12fa628ab6da2926f064af85ec9e97c59de6d6ebb72f502a83ce3f75a270e7e2) |

## Track Selection

This project targets **all 3 prize tracks**:

| Track | Category | Justification |
|-------|----------|---------------|
| **Track 1: EVM Smart Contract** | DeFi / Stablecoin-enabled dApp | Complete lending market with deposit, borrow, repay, liquidation, ERC-4626 LP vault, oracle, kinked interest rate model — all live on Polkadot Hub TestNet |
| **Track 2: PVM Smart Contract** | PVM experiments + precompiles | PVM DeterministicRiskModel as PRIMARY risk engine (resolc-compiled), governance-aware policy overrides via 7-field QuoteInput, RiskGateway routing with REVM fallback, provable XCM execution (`execute` with ClearOrigin+SetTopic), 6/6 on-chain verification tests passing |
| **OpenZeppelin Sponsor** | Non-trivial OZ composition | 12+ OZ contracts composed: AccessManager + Governor (5 extensions) + TimelockController + ERC20Votes + ERC4626 + SafeERC20 + Pausable + ReentrancyGuard, with deployer admin renunciation and non-zero role execution delays |

## Technical Details

- **Network**: Polkadot Hub TestNet (chain ID 420420417)
- **Contracts**: 12 deployed (11 explorer-verified on Blockscout)
- **Tests**: 300 Foundry tests passing
- **Frontend**: React 18 + Vite + wagmi v2 + RainbowKit
- **Manifest**: `dualvm/deployments/polkadot-hub-testnet-canonical.json`
- **Explorer**: [Blockscout](https://blockscout-testnet.polkadot.io/)
- **CI**: GitHub Actions with typecheck, lint, and testnet smoke steps

## Team
Solo developer submission.
