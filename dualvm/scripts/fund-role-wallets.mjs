/**
 * Fund role wallets from the deployer wallet.
 * Usage: node scripts/fund-role-wallets.mjs
 * Requires .env with PRIVATE_KEY set.
 */

import { config } from "dotenv";
config();

const rpcUrl = process.env.POLKADOT_HUB_TESTNET_RPC_URL ?? "https://eth-rpc-testnet.polkadot.io/";
const deployerKey = process.env.PRIVATE_KEY;
if (!deployerKey) {
  console.error("PRIVATE_KEY is required in .env");
  process.exit(1);
}

// Collect unique role wallet addresses that need funding
const roleAddresses = new Set();
for (const envVar of [
  "EMERGENCY_PRIVATE_KEY", "RISK_PRIVATE_KEY", "TREASURY_PRIVATE_KEY",
  "MINTER_PRIVATE_KEY", "LENDER_PRIVATE_KEY", "BORROWER_PRIVATE_KEY",
  "LIQUIDATOR_PRIVATE_KEY",
]) {
  const key = process.env[envVar];
  if (key && key !== deployerKey) {
    // Derive address from private key
    const { Wallet } = await import("ethers");
    const wallet = new Wallet(key);
    roleAddresses.add(wallet.address);
  }
}

const FUND_AMOUNT_WEI = "100000000000000000000"; // 100 PAS each

async function rpcCall(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`RPC ${method} failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function getBalance(address) {
  const result = await rpcCall("eth_getBalance", [address, "latest"]);
  return BigInt(result);
}

async function getNonce(address) {
  const result = await rpcCall("eth_getTransactionCount", [address, "latest"]);
  return Number(result);
}

// Use ethers to sign and send transactions
const { Wallet, JsonRpcProvider, parseEther } = await import("ethers");
const provider = new JsonRpcProvider(rpcUrl, 420420417);
const deployer = new Wallet(deployerKey, provider);

console.log(`Deployer: ${deployer.address}`);
const deployerBalance = await getBalance(deployer.address);
console.log(`Deployer balance: ${deployerBalance / 10n ** 18n} PAS`);

for (const address of roleAddresses) {
  const balance = await getBalance(address);
  if (balance >= BigInt(FUND_AMOUNT_WEI) / 2n) {
    console.log(`${address} already has ${balance / 10n ** 18n} PAS, skipping`);
    continue;
  }
  
  console.log(`Funding ${address} with 100 PAS...`);
  try {
    const tx = await deployer.sendTransaction({
      to: address,
      value: BigInt(FUND_AMOUNT_WEI),
    });
    const receipt = await tx.wait();
    console.log(`  TX: ${receipt.hash}`);
    // Brief delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  } catch (err) {
    console.error(`  Failed to fund ${address}: ${err.message}`);
  }
}

console.log("Done funding role wallets");
