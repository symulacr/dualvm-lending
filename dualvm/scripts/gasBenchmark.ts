/**
 * gasBenchmark.ts
 *
 * Measures actual gas usage and block inclusion time for all core operations
 * on V2 contracts on Polkadot Hub TestNet.
 *
 * Operations measured:
 *   1. depositCollateral — LendingRouterV2.depositCollateralFromPAS (PAS→WPAS+deposit in 1 TX)
 *   2. borrow            — LendingCoreV2.borrow
 *   3. repay             — LendingCoreV2.repay
 *   4. liquidate         — LendingCoreV2.liquidate
 *   5. supply            — DebtPool.deposit (LP supplies USDC-test)
 *   6. withdraw          — DebtPool.withdraw (LP withdraws USDC-test)
 *
 * For ops 1–4: fetches gasUsed from existing liveV2Smoke-results.json tx receipts
 * (avoids re-running expensive managed-access operations).
 * For ops 5–6: runs fresh transactions using the deployer wallet to get live gas + timing.
 *
 * Saves results to deployments/gas-benchmarks.json.
 */

import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { runEntrypoint } from "../lib/runtime/entrypoint";
import { requireEnv } from "../lib/runtime/env";

const { ethers } = hre;

const LEND_SMOKE_RESULTS_FILE = "deployments/liveV2Smoke-results.json";
const OUTPUT_FILE = "deployments/gas-benchmarks.json";

interface ReceiptGasRecord {
  txHash: string;
  gasUsed: string;
  blockNumber: number;
  explorerUrl: string;
  inclusionMs?: number;
}

async function fetchReceiptGas(txHash: string, explorerBase: string): Promise<ReceiptGasRecord | null> {
  try {
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (!receipt) return null;
    return {
      txHash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
      explorerUrl: `${explorerBase}/tx/${txHash}`,
    };
  } catch {
    return null;
  }
}

/**
 * Submit a transaction and measure wall-clock time from submission to receipt confirmation.
 */
async function sendAndMeasure(
  label: string,
  txPromise: Promise<any>,
  explorerBase: string,
): Promise<ReceiptGasRecord> {
  const submitTime = Date.now();
  const tx = await txPromise;
  console.log(`  ${label}: submitted ${tx.hash}`);
  const receipt = await tx.wait();
  const receiptTime = Date.now();
  const inclusionMs = receiptTime - submitTime;
  console.log(`  ${label}: mined in block ${receipt.blockNumber}, gas=${receipt.gasUsed}, inclusion=${inclusionMs}ms`);
  return {
    txHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    blockNumber: receipt.blockNumber,
    explorerUrl: `${explorerBase}/tx/${receipt.hash}`,
    inclusionMs,
  };
}

export async function main() {
  const manifest = loadDeploymentManifest();
  const explorerBase = manifest.polkadotHubTestnet.explorerUrl.replace(/\/$/, "");

  console.log("=== Gas Benchmark ===");
  console.log(`Network: ${manifest.polkadotHubTestnet.name} (chain ${manifest.polkadotHubTestnet.chainId})`);

  const deployerKey = requireEnv("PRIVATE_KEY");
  const deployer = new ethers.Wallet(deployerKey, ethers.provider);
  console.log(`Deployer: ${deployer.address}`);

  // ─── Load existing V2 smoke TX hashes ────────────────────────────────────
  const smokePath = path.join(process.cwd(), LEND_SMOKE_RESULTS_FILE);
  if (!fs.existsSync(smokePath)) {
    throw new Error(`Missing ${LEND_SMOKE_RESULTS_FILE} — run scripts/liveV2Smoke.ts first`);
  }
  const smokeResults = JSON.parse(fs.readFileSync(smokePath, "utf-8")) as Record<string, any>;

  const step1Hash: string = smokeResults?.step1_depositCollateral?.txHash ?? "";
  const step2Hash: string = smokeResults?.step2_borrow?.txHash ?? "";
  const step3Hash: string = smokeResults?.step3_repay?.txHash ?? "";
  const step4Hash: string =
    smokeResults?.step4_liquidation?.liquidationTxHash ??
    smokeResults?.step4_liquidation?.txHash ??
    "";

  console.log("\n── Fetching gasUsed from existing V2 smoke receipts ──");

  const [depColRec, borrowRec, repayRec, liquidateRec] = await Promise.all([
    step1Hash.startsWith("0x") ? fetchReceiptGas(step1Hash, explorerBase) : Promise.resolve(null),
    step2Hash.startsWith("0x") ? fetchReceiptGas(step2Hash, explorerBase) : Promise.resolve(null),
    step3Hash.startsWith("0x") ? fetchReceiptGas(step3Hash, explorerBase) : Promise.resolve(null),
    step4Hash.startsWith("0x") ? fetchReceiptGas(step4Hash, explorerBase) : Promise.resolve(null),
  ]);

  console.log(`  depositCollateral: gas=${depColRec?.gasUsed ?? "N/A"} (tx ${step1Hash.slice(0, 12)}...)`);
  console.log(`  borrow:            gas=${borrowRec?.gasUsed ?? "N/A"} (tx ${step2Hash.slice(0, 12)}...)`);
  console.log(`  repay:             gas=${repayRec?.gasUsed ?? "N/A"} (tx ${step3Hash.slice(0, 12)}...)`);
  console.log(`  liquidate:         gas=${liquidateRec?.gasUsed ?? "N/A"} (tx ${step4Hash.slice(0, 12)}...)`);

  // ─── Run fresh supply and withdraw on DebtPoolV2 ─────────────────────────
  console.log("\n── Running fresh supply + withdraw on DebtPoolV2 ──");

  const DEBT_POOL_V2_ADDR = manifest.contracts.debtPoolV2;
  const USDC_ADDR = manifest.contracts.usdc;
  if (!DEBT_POOL_V2_ADDR) throw new Error("debtPoolV2 not in manifest");

  const ERC4626_ABI = [
    "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
    "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
    "function balanceOf(address owner) view returns (uint256)",
    "function totalAssets() view returns (uint256)",
    "function convertToAssets(uint256 shares) view returns (uint256)",
    "function previewDeposit(uint256 assets) view returns (uint256)",
    "function maxWithdraw(address owner) view returns (uint256)",
  ];
  const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address owner) view returns (uint256)",
  ];

  const debtPoolV2 = new ethers.Contract(DEBT_POOL_V2_ADDR, ERC4626_ABI, deployer);
  const usdc = new ethers.Contract(USDC_ADDR, ERC20_ABI, deployer);

  // Check deployer balances
  const [usdcBalance, deployerShares, maxWithdraw] = await Promise.all([
    usdc.balanceOf(deployer.address),
    debtPoolV2.balanceOf(deployer.address),
    debtPoolV2.maxWithdraw(deployer.address),
  ]);

  console.log(`  Deployer USDC balance:     ${ethers.formatUnits(usdcBalance, 18)}`);
  console.log(`  Deployer DebtPoolV2 shares: ${ethers.formatUnits(deployerShares, 18)}`);
  console.log(`  Max withdrawable:           ${ethers.formatUnits(maxWithdraw, 18)}`);

  // Supply: deposit 10 USDC
  const SUPPLY_AMOUNT = ethers.parseUnits("10", 18);
  let supplyRec: ReceiptGasRecord;

  if (usdcBalance < SUPPLY_AMOUNT) {
    throw new Error(`Insufficient USDC for supply benchmark: have ${ethers.formatUnits(usdcBalance, 18)}, need 10`);
  }

  // Ensure approval
  const currentAllowance: bigint = await usdc.allowance(deployer.address, DEBT_POOL_V2_ADDR);
  if (currentAllowance < SUPPLY_AMOUNT) {
    console.log("  Approving USDC for DebtPoolV2...");
    const approveTx = await usdc.approve(DEBT_POOL_V2_ADDR, ethers.MaxUint256);
    await approveTx.wait();
    console.log("  Approved.");
  }

  // Benchmark supply (deposit)
  supplyRec = await sendAndMeasure(
    "supply (DebtPool.deposit)",
    debtPoolV2.deposit(SUPPLY_AMOUNT, deployer.address),
    explorerBase,
  );

  // Benchmark withdraw (withdraw 10 USDC)
  const WITHDRAW_AMOUNT = ethers.parseUnits("10", 18);
  const withdrawableAfterSupply: bigint = await debtPoolV2.maxWithdraw(deployer.address);

  if (withdrawableAfterSupply < WITHDRAW_AMOUNT) {
    throw new Error(
      `Insufficient withdrawable assets: have ${ethers.formatUnits(withdrawableAfterSupply, 18)}, need 10`,
    );
  }

  const withdrawRec = await sendAndMeasure(
    "withdraw (DebtPool.withdraw)",
    debtPoolV2.withdraw(WITHDRAW_AMOUNT, deployer.address, deployer.address),
    explorerBase,
  );

  // ─── Block inclusion time baseline via supply + withdraw ──────────────────
  // Use the measured inclusion times as the representative block inclusion data
  const inclusionMsSamples = [supplyRec.inclusionMs, withdrawRec.inclusionMs].filter(
    (ms): ms is number => ms !== undefined,
  );
  const avgInclusionMs =
    inclusionMsSamples.length > 0
      ? Math.round(inclusionMsSamples.reduce((a, b) => a + b, 0) / inclusionMsSamples.length)
      : null;

  // ─── Build and save results ───────────────────────────────────────────────
  const results = {
    generatedAt: new Date().toISOString(),
    network: manifest.polkadotHubTestnet.name,
    chainId: manifest.polkadotHubTestnet.chainId,
    note: "gasUsed sourced from on-chain tx receipts. Ops 1-4 from liveV2Smoke-results.json; ops 5-6 run fresh. Block inclusion measured wall-clock from tx.submit() to tx.wait().",
    blockInclusion: {
      supply_ms: supplyRec.inclusionMs,
      withdraw_ms: withdrawRec.inclusionMs,
      avg_ms: avgInclusionMs,
      note: "Wall-clock time from tx submission to receipt confirmation (public RPC latency included)",
    },
    benchmarks: {
      depositCollateral: {
        operation: "LendingRouterV2.depositCollateralFromPAS (PAS→WPAS+deposit, 1 TX)",
        gasUsed: depColRec?.gasUsed ?? null,
        txHash: step1Hash,
        explorerUrl: depColRec?.explorerUrl ?? null,
        source: "liveV2Smoke-results.json",
      },
      borrow: {
        operation: "LendingCoreV2.borrow",
        gasUsed: borrowRec?.gasUsed ?? null,
        txHash: step2Hash,
        explorerUrl: borrowRec?.explorerUrl ?? null,
        source: "liveV2Smoke-results.json",
      },
      repay: {
        operation: "LendingCoreV2.repay",
        gasUsed: repayRec?.gasUsed ?? null,
        txHash: step3Hash,
        explorerUrl: repayRec?.explorerUrl ?? null,
        source: "liveV2Smoke-results.json",
      },
      liquidate: {
        operation: "LendingCoreV2.liquidate",
        gasUsed: liquidateRec?.gasUsed ?? null,
        txHash: step4Hash,
        explorerUrl: liquidateRec?.explorerUrl ?? null,
        source: "liveV2Smoke-results.json",
      },
      supply: {
        operation: "DebtPool.deposit (LP supplies USDC-test to ERC-4626 vault)",
        gasUsed: supplyRec.gasUsed,
        txHash: supplyRec.txHash,
        explorerUrl: supplyRec.explorerUrl,
        inclusionMs: supplyRec.inclusionMs,
        source: "fresh benchmark run",
      },
      withdraw: {
        operation: "DebtPool.withdraw (LP redeems USDC-test from ERC-4626 vault)",
        gasUsed: withdrawRec.gasUsed,
        txHash: withdrawRec.txHash,
        explorerUrl: withdrawRec.explorerUrl,
        inclusionMs: withdrawRec.inclusionMs,
        source: "fresh benchmark run",
      },
    },
  };

  const outPath = path.join(process.cwd(), OUTPUT_FILE);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Gas benchmarks saved to ${OUTPUT_FILE}`);

  console.log("\n── Summary ──");
  console.log("Operation           | Gas Used");
  console.log("--------------------|----------");
  for (const [op, data] of Object.entries(results.benchmarks)) {
    const gas = (data as any).gasUsed ?? "N/A";
    console.log(`${op.padEnd(20)}| ${gas}`);
  }
  console.log(`\nBlock inclusion: ~${avgInclusionMs}ms avg (supply: ${supplyRec.inclusionMs}ms, withdraw: ${withdrawRec.inclusionMs}ms)`);
}

runEntrypoint("scripts/gasBenchmark.ts", main);
