# DualVM Lending — DoraHacks Submission

## Project Name
DualVM Lending

## One-Liner
A production-minded isolated lending market on Polkadot Hub TestNet combining REVM custody with a live PVM risk engine and OpenZeppelin Governor governance.

## Project Description

DualVM Lending is a fully functional lending protocol deployed on Polkadot Hub TestNet. Users deposit wrapped PAS (WPAS) as collateral and borrow USDC-test from an ERC-4626 liquidity pool. The protocol features a complete lending lifecycle: deposit, borrow, repay, and liquidation — all proven live on-chain with explorer-verified transactions.

What makes this project distinctive is its honest, live integration of Polkadot's dual-VM architecture:

- The **risk engine** is a PVM-compiled smart contract (compiled via `resolc`) that serves the product-path LendingCore with deterministic risk parameters through cross-VM calls
- A **4-stage interop proof package** independently verifies REVM↔PVM cross-VM capability: echo, quote, roundtrip settlement, and XCM precompile interaction
- **Governor-based governance** using 5 composed OpenZeppelin Governor extensions controls the entire protocol through a propose/vote/queue/execute lifecycle

The protocol is public-testnet-validated with 12 deployed contracts (11 explorer-verified on Blockscout), 81 passing Hardhat tests, and a browser-based frontend with full read/write capability.

## GitHub Repository
https://github.com/parity-asia/hackathon-2026-03-polkadot-solidity/dualvm

## Hosted Frontend
*(To be filled with Vercel URL after deployment)*

## Track 1: EVM Smart Contract — DeFi / Stablecoin-Enabled DApp

### What We Built
A complete lending market on Polkadot Hub TestNet with:

- **LendingCore**: Immutable market version handling collateral deposits, borrowing, repayment, and liquidation with configurable parameters (max LTV 70%, liquidation threshold 80%, liquidation bonus 5%)
- **DebtPool**: ERC-4626 LP vault where liquidity providers earn yield from borrower interest. Includes OpenZeppelin's inflation-attack protection.
- **ManualOracle**: Governed price feed with circuit breaker (min/max price bounds, maximum price delta per update, staleness rejection)
- **RiskAdapter**: Quote ticket publication and consumption, bridging the REVM market with the PVM risk engine
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

### PVM Integration (Live, Not Decorative)

The PVM risk engine is a **production-path component**, not a proof-of-concept:

1. **PvmQuoteProbe** is compiled via `resolc` (Polkadot's Solidity-to-PolkaVM compiler) and deployed on-chain at `0x9a78F65b00E0AeD0830063eD0ea66a0B5d8876DE`
2. **RiskAdapter** in the product-path LendingCore calls this PVM contract for risk quotes (borrow rate, max LTV, liquidation threshold)
3. PVM code hash `0xba8fe2a621062a30bba558a3846d0a18bfb2e9a09bfaed656b123e698b59af5b` verified via `revive.accountInfoOf`

### Interop Proof Package (4 Stages)

| Stage | What It Proves | TX Hash |
|-------|----------------|---------|
| Echo | REVM sends bytes32 to PVM, receives identical bytes back | [0x282f3253...](https://blockscout-testnet.polkadot.io/tx/0x282f32532f1bc337266e7a0d849edb1153449be7fad9d4b9feacec8aded641d0) |
| Quote | PVM returns deterministic risk params (700bps borrow rate, 7500bps maxLTV) | [0x4f55eac1...](https://blockscout-testnet.polkadot.io/tx/0x4f55eac1f75b6540e3d81d3618a8857574551809fce2b08bfc4e11a4b15b5698) |
| Roundtrip Settlement | REVM stores debt state derived from PVM-computed borrow rate | [0x4284ace5...](https://blockscout-testnet.polkadot.io/tx/0x4284ace5171ead5bea7c5795ee78528ac815b5d65d450b6f85de06b56ebe2ad5) |
| XCM Precompile | `weighMessage` call returns refTime=979880000, proofSize=10943 | [0xc147ac14...](https://blockscout-testnet.polkadot.io/tx/0xc147ac140cc9591bcdd444478ed27d72ce4fd05312d5f8ef16f4e6dfe7439cc0) |

### Precompile Usage
**CrossChainQuoteEstimator** at `0x5bC4e5BbF72b67Acb202546e88849dAcF8985A7F` calls the XCM precompile at `0x00000000000000000000000000000000000A0000` to estimate cross-chain risk quote costs via `weighMessage`. This demonstrates real Polkadot-native precompile access for potential cross-chain risk computation.

### Honest Limitations
- PVM callback probe (Stage 2) reverts on-chain due to platform-level cross-VM callback limitations — we document this transparently rather than hiding it
- PvmQuoteProbe cannot be Blockscout-verified (compiled via `resolc` for PolkaVM, not standard Solidity) — PVM code hash confirmed via substrate API

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
| **SafeERC20** | LendingCore | Safe token transfers in all fund flows |
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
LendingCore / DebtPool / Oracle / Registry
```

**Deployer has ZERO residual roles** after bootstrap — verified by on-chain role checks and tests.

### Live Governance Proof
| Operation | TX Hash |
|-----------|---------|
| Version Activation via Governor | [0x3278a9ee...](https://blockscout-testnet.polkadot.io/tx/0x3278a9ee913be2f47907ae2921f8a1be2ec0d4525ee3b58e7092b1e2801a22eb) |
| Deployer Admin Renunciation | [0x61c09d53...](https://blockscout-testnet.polkadot.io/tx/0x61c09d5353c0d3c0246f818a413780517e7b7d5510022330fb822ac67c41e863) |
| Migration via Governance Proposal | [0x12fa628a...](https://blockscout-testnet.polkadot.io/tx/0x12fa628ab6da2926f064af85ec9e97c59de6d6ebb72f502a83ce3f75a270e7e2) |

## Technical Details

- **Network**: Polkadot Hub TestNet (chain ID 420420417)
- **Contracts**: 12 deployed (11 explorer-verified on Blockscout)
- **Tests**: 81 Hardhat tests passing
- **Frontend**: React 18 + Vite + wagmi v2 + RainbowKit
- **Manifest**: `dualvm/deployments/polkadot-hub-testnet-canonical.json`

## Team
Solo developer submission.
