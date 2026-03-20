/**
 * Seed Market Script
 * Refreshes oracle, mints USDC, deposits into debt pool, and wraps PAS for relayer.
 * Run AFTER governance-setup.mjs has completed.
 *
 * Usage: node scripts/seed-market.mjs
 * Requires .env with PRIVATE_KEY set.
 */

import { config } from "dotenv";
config();

import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";

// ── Config ───────────────────────────────────────────────────────────────────
const RPC_URL = process.env.POLKADOT_HUB_TESTNET_RPC_URL ?? "https://eth-rpc-testnet.polkadot.io/";
const deployerKey = process.env.PRIVATE_KEY;
if (!deployerKey) { console.error("PRIVATE_KEY missing in .env"); process.exit(1); }

const chain = {
  id: 420420417,
  name: "Polkadot Hub TestNet",
  nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const deployerAccount = privateKeyToAccount(deployerKey);
const deployerWallet = createWalletClient({ account: deployerAccount, chain, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

// ── Addresses ────────────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(new URL("../deployments/deploy-manifest.json", import.meta.url), "utf8"));
const ADDRESSES = {
  oracle: manifest.manualOracle,
  usdc: manifest.usdcMock,
  debtPool: manifest.debtPool,
  wpas: manifest.wpas,
};

// Wallet 1 = relayer (read from FAUCET_RELAYER_PRIVATE_KEY env var or faucet-wallets.txt)
const WALLET1_KEY = process.env.FAUCET_RELAYER_PRIVATE_KEY;
if (!WALLET1_KEY) throw new Error("Set FAUCET_RELAYER_PRIVATE_KEY in .env");
const wallet1Account = privateKeyToAccount(WALLET1_KEY);
const wallet1Client = createWalletClient({ account: wallet1Account, chain, transport: http(RPC_URL) });

// ── Amounts ──────────────────────────────────────────────────────────────────
const ORACLE_PRICE_WAD = 1000000000000000000000n; // 1000 WAD
const USDC_MINT_AMOUNT = 500000000000000000000000n; // 500K (18 decimals)
const WPAS_DEPOSIT_VALUE = parseEther("1000"); // 1000 PAS

// ── ABI fragments ────────────────────────────────────────────────────────────
const oracleAbi = parseAbi(["function setPrice(uint256 newPriceWad)"]);
const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
const debtPoolAbi = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function totalAssets() view returns (uint256)",
]);
const wpasAbi = parseAbi(["function depositTo(address account) payable"]);

// ── Helpers ──────────────────────────────────────────────────────────────────
const ts = () => new Date().toISOString();

async function waitForTx(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`TX reverted: ${hash}`);
  return receipt;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[${ts()}] Deployer: ${deployerAccount.address}`);
  console.log(`[${ts()}] Relayer:  ${WALLET1_ADDRESS}`);

  // 1. Refresh oracle price
  console.log(`\n[${ts()}] Step 1: Setting oracle price to 1000 WAD...`);
  const oracleTx = await deployerWallet.writeContract({
    address: ADDRESSES.oracle,
    abi: oracleAbi,
    functionName: "setPrice",
    args: [ORACLE_PRICE_WAD],
  });
  await waitForTx(oracleTx);
  console.log(`[${ts()}]   TX: ${oracleTx}`);

  // 2. Mint USDC to deployer
  console.log(`\n[${ts()}] Step 2: Minting 500K USDC to deployer...`);
  const mintTx = await deployerWallet.writeContract({
    address: ADDRESSES.usdc,
    abi: erc20Abi,
    functionName: "mint",
    args: [deployerAccount.address, USDC_MINT_AMOUNT],
  });
  await waitForTx(mintTx);
  console.log(`[${ts()}]   TX: ${mintTx}`);

  const usdcBalance = await publicClient.readContract({
    address: ADDRESSES.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [deployerAccount.address],
  });
  console.log(`[${ts()}]   USDC balance: ${usdcBalance}`);

  // 3. Approve USDC to debtPool
  console.log(`\n[${ts()}] Step 3: Approving USDC to debt pool...`);
  const approveTx = await deployerWallet.writeContract({
    address: ADDRESSES.usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [ADDRESSES.debtPool, USDC_MINT_AMOUNT],
  });
  await waitForTx(approveTx);
  console.log(`[${ts()}]   TX: ${approveTx}`);

  // 4. Deposit into debtPool
  console.log(`\n[${ts()}] Step 4: Depositing 500K USDC into debt pool...`);
  const depositTx = await deployerWallet.writeContract({
    address: ADDRESSES.debtPool,
    abi: debtPoolAbi,
    functionName: "deposit",
    args: [USDC_MINT_AMOUNT, deployerAccount.address],
  });
  await waitForTx(depositTx);
  console.log(`[${ts()}]   TX: ${depositTx}`);

  const totalAssets = await publicClient.readContract({
    address: ADDRESSES.debtPool,
    abi: debtPoolAbi,
    functionName: "totalAssets",
    args: [],
  });
  console.log(`[${ts()}]   Debt pool total assets: ${totalAssets}`);

  // 5. Pre-wrap WPAS for relayer (wallet 1)
  console.log(`\n[${ts()}] Step 5: Wrapping 1000 PAS as WPAS for relayer...`);
  const wrapTx = await wallet1Client.writeContract({
    address: ADDRESSES.wpas,
    abi: wpasAbi,
    functionName: "depositTo",
    args: [WALLET1_ADDRESS],
    value: WPAS_DEPOSIT_VALUE,
  });
  await waitForTx(wrapTx);
  console.log(`[${ts()}]   TX: ${wrapTx}`);

  const wpasBalance = await publicClient.readContract({
    address: ADDRESSES.wpas,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [WALLET1_ADDRESS],
  });
  console.log(`[${ts()}]   Relayer WPAS balance: ${wpasBalance}`);

  console.log(`\n[${ts()}] ✅ Market seeding complete!`);
}

main().catch((err) => {
  console.error(`\n[${ts()}] ❌ Fatal:`, err.message ?? err);
  process.exit(1);
});
