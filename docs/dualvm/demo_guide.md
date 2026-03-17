# DualVM Lending — Demo Guide

This guide walks through the complete DualVM Lending demo flow on Polkadot Hub TestNet. A recorded demo video is available at `docs/dualvm/demo-video.webm`.

## Prerequisites

- MetaMask or any injected wallet configured for Polkadot Hub TestNet (chain ID `420420417`)
- PAS tokens from the [faucet](https://faucet.polkadot.io/) (Network: Polkadot testnet Paseo, Chain: Hub smart contracts)
- Frontend URL: [https://dualvm-lending.vercel.app](https://dualvm-lending.vercel.app)

## Demo Flow (3-5 minutes)

### Step 1: Open the Frontend

Navigate to [https://dualvm-lending.vercel.app](https://dualvm-lending.vercel.app).

The landing page shows:
- Project title and description
- Network configuration (RPC, explorer, faucet links)
- Full deployment manifest with all 12 contract addresses
- Market snapshot with live on-chain data
- Lending operation forms (when wallet is connected)

**Screenshot:** `docs/dualvm/screenshots/frontend-home-full.png`

### Step 2: Connect Wallet via RainbowKit

Click **Connect Wallet** in the top-right corner. The RainbowKit modal appears with wallet options:
- MetaMask
- Rainbow
- WalletConnect
- Base Account

Select MetaMask (or your preferred wallet). Approve the connection and switch to Polkadot Hub TestNet (chain ID 420420417) if prompted.

**Screenshot:** `docs/dualvm/screenshots/wallet-connect-modal.png`

### Step 3: Market Snapshot Loading

Once connected, the frontend loads live market data from the canonical deployment:
- **Pool total assets**: Total USDC-test deposited by LPs
- **Utilization**: Current pool utilization percentage
- **Oracle price**: Current PAS/USDC price from ManualOracle
- **Oracle freshness**: Time since last price update
- **Available liquidity**: USDC-test available for borrowing
- **Outstanding principal**: Total borrowed USDC-test

The observer section also shows tracked address data including health factor and available-to-borrow calculations.

### Step 4: Deposit Collateral (PAS Wrap + Deposit)

1. In the **Deposit Collateral** section, enter the PAS amount to deposit
2. The frontend executes a multi-step transaction:
   - **Wrap PAS → WPAS**: Calls `WPAS.deposit{value: amount}()` to wrap native PAS
   - **Approve**: Calls `WPAS.approve(LendingCore, amount)`
   - **Deposit**: Calls `LendingCore.depositCollateral(amount)`
3. Watch the transaction status indicator show pending → confirmed
4. The Blockscout TX link appears for verification

### Step 5: Borrow USDC-test

1. In the **Borrow** section, enter the USDC-test amount to borrow
2. The frontend calls `LendingCore.borrow(amount)`
3. USDC-test is transferred from the DebtPool to your wallet
4. Your position now shows active debt

**Live proof TX:** [Borrow TX on Blockscout](https://blockscout-testnet.polkadot.io/tx/0x5a9edd08efd8aec5e1ccbe0295b97e03cebc1b75588acf19a2738a109deba532)

### Step 6: Repay Partial Debt

1. In the **Repay** section, enter a partial repayment amount
2. The frontend executes:
   - **Approve**: Calls `USDCMock.approve(LendingCore, amount)`
   - **Repay**: Calls `LendingCore.repay(amount)`
3. Interest is paid first, then principal is reduced
4. Your debt balance decreases after the transaction

**Live proof TX:** [Repay TX on Blockscout](https://blockscout-testnet.polkadot.io/tx/0x02825742b3d9cdc5e8c27b1ae30948d73885188c2e43a0de5c6105606c441dde)

### Step 7: Health Factor Change

After repaying, observe the health factor in the observer section:
- **Before repayment**: Lower health factor (more leveraged)
- **After repayment**: Higher health factor (safer position)
- The `availableToBorrow` value also increases after repayment

Enter your address in the observer input and click **Track address** to see live position data.

### Step 8: Explorer Verification

Click any Blockscout TX link to verify transactions on the explorer:
- Transaction status (Success/Revert)
- Method called (e.g., `borrow`, `repay`, `depositCollateral`)
- Token transfers (WPAS, USDC-test movements)
- Gas used and block number

Key explorer links:
| Operation | Explorer Link |
|-----------|---------------|
| Borrow | [0x5a9edd08...](https://blockscout-testnet.polkadot.io/tx/0x5a9edd08efd8aec5e1ccbe0295b97e03cebc1b75588acf19a2738a109deba532) |
| Repay | [0x02825742...](https://blockscout-testnet.polkadot.io/tx/0x02825742b3d9cdc5e8c27b1ae30948d73885188c2e43a0de5c6105606c441dde) |
| Liquidation | [0xeec68ce0...](https://blockscout-testnet.polkadot.io/tx/0xeec68ce067523113520a888e9344860ea9d9421c135a6db6823da56ebe12048b) |

**Screenshot:** `docs/dualvm/screenshots/borrow-tx.png`

### Step 9: PVM Interop Proof

Navigate to the PVM probe TX links to verify cross-VM interop:

| Stage | What It Proves | TX Link |
|-------|----------------|---------|
| Echo | REVM→PVM→REVM data roundtrip | [0x282f3253...](https://blockscout-testnet.polkadot.io/tx/0x282f32532f1bc337266e7a0d849edb1153449be7fad9d4b9feacec8aded641d0) |
| Quote | PVM deterministic risk computation | [0x4f55eac1...](https://blockscout-testnet.polkadot.io/tx/0x4f55eac1f75b6540e3d81d3618a8857574551809fce2b08bfc4e11a4b15b5698) |
| XCM weighMessage | Precompile interaction proof | [0xc147ac14...](https://blockscout-testnet.polkadot.io/tx/0xc147ac140cc9591bcdd444478ed27d72ce4fd05312d5f8ef16f4e6dfe7439cc0) |

The PVM risk engine at `0x9a78F65b00E0AeD0830063eD0ea66a0B5d8876DE` is compiled via `resolc` (Polkadot's Solidity-to-PolkaVM compiler) and serves the product-path LendingCore with live risk parameters.

## Screenshots Reference

| Screenshot | Description |
|-----------|-------------|
| `frontend-home-full.png` | Full-page frontend with all sections |
| `frontend-home.png` | Frontend landing hero section |
| `frontend-interactive-elements.png` | Annotated interactive elements |
| `frontend-lending-forms.png` | Write-path lending operation forms |
| `frontend-observer-section.png` | Observer and tracked address section |
| `wallet-connect-modal.png` | RainbowKit wallet connect modal |
| `borrow-tx.png` | Blockscout borrow transaction |
| `liquidation-tx.png` | Blockscout liquidation transaction |

## Demo Video

A recorded browser walkthrough is saved at `docs/dualvm/demo-video.webm` (3.4 MB, WebM format). The video shows:
1. Opening the Vercel-hosted frontend
2. Clicking Connect Wallet (RainbowKit modal)
3. Navigating through the market data and contract manifest
4. Viewing the LendingCore contract on Blockscout
5. Viewing the borrow TX proof on Blockscout
6. Viewing the PVM echo probe TX on Blockscout
7. Viewing the XCM precompile proof TX on Blockscout
8. Returning to the frontend

> **Note:** The demo video is a headless browser recording showing page navigation. For a full interactive demo with wallet transactions, connect MetaMask to the live frontend and follow the steps above. The on-chain proof TX links verify all operations were executed successfully on the public testnet.
