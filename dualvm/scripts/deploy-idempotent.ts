/**
 * deploy-idempotent.ts
 *
 * Idempotent deployment script that:
 *  1. Reads the existing manifest to determine what is already deployed
 *  2. Compares desired state vs current state (checks on-chain bytecode)
 *  3. Only deploys contracts that are missing or have no live bytecode
 *  4. Saves a manifest checkpoint after each successful deployment
 *  5. Can resume from the last checkpoint on re-run
 *
 * Usage:
 *   hardhat run scripts/deploy-idempotent.ts --network polkadotHubTestnet
 *
 * Environment variables (same as deploy.ts):
 *   PRIVATE_KEY, TREASURY_ADDRESS, EMERGENCY_ADMIN, RISK_ADMIN,
 *   TREASURY_OPERATOR, MINTER, INITIAL_LIQUIDITY, INITIAL_ORACLE_PRICE_WAD,
 *   ORACLE_MAX_AGE_SECONDS, ADMIN_DELAY_SECONDS, RISK_QUOTE_ENGINE_ADDRESS
 */
import hre from "hardhat";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CORE_DEFAULTS,
  LIVE_ROLE_EXECUTION_DELAYS_SECONDS,
  ORACLE_CIRCUIT_BREAKER_DEFAULTS,
  ORACLE_DEFAULTS,
  POOL_DEFAULTS,
  RISK_ENGINE_DEFAULTS,
  ROLE_IDS,
  TARGET_ADMIN_DELAY_SECONDS,
} from "../lib/config/marketConfig";
import { runIdempotentSteps, type IdempotentDeployStep } from "../lib/deployment/idempotentDeploy";
import { getDeploymentManifestPath } from "../lib/deployment/manifestStore";
import { bigintReplacer, type DeploymentManifest } from "../lib/shared/deploymentManifest";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

// ─── Checkpoint helpers ────────────────────────────────────────────────────

/** Checkpoint file path alongside the canonical manifest */
function getCheckpointPath(cwd = process.cwd()): string {
  const manifestPath = getDeploymentManifestPath(cwd);
  return path.join(path.dirname(manifestPath), "deploy-idempotent-checkpoint.json");
}

function loadCheckpoint(cwd = process.cwd()): Record<string, string> {
  const p = getCheckpointPath(cwd);
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      return raw as Record<string, string>;
    }
  } catch {
    // Corrupt checkpoint — start fresh
  }
  return {};
}

function saveCheckpoint(checkpoint: Record<string, string>, cwd = process.cwd()): void {
  const p = getCheckpointPath(cwd);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(checkpoint, null, 2));
}

// ─── Manifest helpers ──────────────────────────────────────────────────────

function loadManifestOrEmpty(manifestPath: string): Partial<DeploymentManifest> {
  if (!existsSync(manifestPath)) return {};
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<DeploymentManifest>;
  } catch {
    return {};
  }
}

function writeManifestPartial(manifest: Partial<DeploymentManifest>, manifestPath: string): void {
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, bigintReplacer, 2));
}

// ─── Selector helper ───────────────────────────────────────────────────────

function selector(contract: { interface: { getFunction(name: string): { selector: string } | null } }, name: string) {
  const fragment = contract.interface.getFunction(name);
  if (!fragment) throw new Error(`Missing selector for ${name}`);
  return fragment.selector;
}

async function waitFor(txPromise: Promise<any>) {
  const tx = await txPromise;
  await tx.wait();
}

// ─── Main ──────────────────────────────────────────────────────────────────

export async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  // Config from environment (same defaults as deploy.ts)
  const treasury = process.env.TREASURY_ADDRESS ?? deployerAddress;
  const emergencyAdmin = process.env.EMERGENCY_ADMIN ?? deployerAddress;
  const riskAdmin = process.env.RISK_ADMIN ?? deployerAddress;
  const treasuryOperator = process.env.TREASURY_OPERATOR ?? deployerAddress;
  const minter = process.env.MINTER ?? deployerAddress;
  const initialLiquidity = process.env.INITIAL_LIQUIDITY ? BigInt(process.env.INITIAL_LIQUIDITY) : POOL_DEFAULTS.initialLiquidity;
  const oraclePriceWad = process.env.INITIAL_ORACLE_PRICE_WAD ? BigInt(process.env.INITIAL_ORACLE_PRICE_WAD) : ORACLE_DEFAULTS.initialPriceWad;
  const oracleMaxAgeSeconds = process.env.ORACLE_MAX_AGE_SECONDS ? Number(process.env.ORACLE_MAX_AGE_SECONDS) : ORACLE_DEFAULTS.maxAgeSeconds;
  const adminDelaySeconds = process.env.ADMIN_DELAY_SECONDS ? Number(process.env.ADMIN_DELAY_SECONDS) : TARGET_ADMIN_DELAY_SECONDS;
  const riskQuoteEngineAddress = process.env.RISK_QUOTE_ENGINE_ADDRESS;

  const manifestPath = getDeploymentManifestPath();
  const checkpoint = loadCheckpoint();

  // Load whatever manifest exists (may be empty on first run)
  const manifest = loadManifestOrEmpty(manifestPath);
  const existingContracts: Record<string, string | undefined> = {
    ...(manifest.contracts as Record<string, string | undefined> | undefined ?? {}),
    // Checkpoint addresses override (written after each step in a previous interrupted run)
    ...checkpoint,
  };

  console.log(`Manifest path:    ${manifestPath}`);
  console.log(`Checkpoint path:  ${getCheckpointPath()}`);
  console.log(`Deployer address: ${deployerAddress}`);
  console.log(`Contracts already in manifest/checkpoint: ${Object.keys(existingContracts).join(", ") || "none"}`);
  console.log("");

  // ─── Mutable deployment state (populated as steps complete) ─────────────
  // These refs are filled in during deployment so later steps can reference
  // addresses even when the earlier step was skipped.
  const deployed: Record<string, any> = {};

  // Helper: resolve address from existing contracts or deployed map
  function resolveAddr(key: string): string {
    const existing = existingContracts[key];
    if (existing) return existing;
    if (deployed[key]) return deployed[key];
    throw new Error(`Address for '${key}' not yet available — check step ordering`);
  }

  // ─── Define the desired deployment plan ──────────────────────────────────

  const steps: IdempotentDeployStep[] = [
    {
      key: "accessManager",
      label: "DualVMAccessManager",
      artifactName: "DualVMAccessManager",
      deploy: async () => {
        const factory = await ethers.getContractFactory("DualVMAccessManager", deployer);
        const contract = await factory.deploy(deployerAddress);
        await contract.waitForDeployment();
        const addr = await contract.getAddress();
        deployed.accessManager = contract;
        return addr;
      },
    },
    {
      key: "wpas",
      label: "WPAS (Wrapped PAS)",
      artifactName: "WPAS",
      deploy: async () => {
        const factory = await ethers.getContractFactory("WPAS", deployer);
        const contract = await factory.deploy();
        await contract.waitForDeployment();
        const addr = await contract.getAddress();
        deployed.wpas = contract;
        return addr;
      },
    },
    {
      key: "usdc",
      label: "USDCMock (USDC-test)",
      artifactName: "USDCMock",
      deploy: async () => {
        const factory = await ethers.getContractFactory("USDCMock", deployer);
        const contract = await factory.deploy(resolveAddr("accessManager"));
        await contract.waitForDeployment();
        const addr = await contract.getAddress();
        deployed.usdc = contract;
        return addr;
      },
    },
    {
      key: "oracle",
      label: "ManualOracle",
      artifactName: "ManualOracle",
      deploy: async () => {
        const factory = await ethers.getContractFactory("ManualOracle", deployer);
        const contract = await factory.deploy(
          resolveAddr("accessManager"),
          oraclePriceWad,
          oracleMaxAgeSeconds,
          ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
          ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
          ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps,
        );
        await contract.waitForDeployment();
        const addr = await contract.getAddress();
        deployed.oracle = contract;
        return addr;
      },
    },
    {
      key: "quoteEngine",
      label: "DeterministicRiskModel (quote engine)",
      artifactName: "DeterministicRiskModel",
      deploy: async () => {
        if (riskQuoteEngineAddress) {
          console.log(`  [ENV] Using RISK_QUOTE_ENGINE_ADDRESS: ${riskQuoteEngineAddress}`);
          return riskQuoteEngineAddress;
        }
        const factory = await ethers.getContractFactory("DeterministicRiskModel", deployer);
        const contract = await factory.deploy(
          RISK_ENGINE_DEFAULTS.baseRateBps,
          RISK_ENGINE_DEFAULTS.slope1Bps,
          RISK_ENGINE_DEFAULTS.slope2Bps,
          RISK_ENGINE_DEFAULTS.kinkBps,
          RISK_ENGINE_DEFAULTS.healthyMaxLtvBps,
          RISK_ENGINE_DEFAULTS.stressedMaxLtvBps,
          RISK_ENGINE_DEFAULTS.healthyLiquidationThresholdBps,
          RISK_ENGINE_DEFAULTS.stressedLiquidationThresholdBps,
          RISK_ENGINE_DEFAULTS.staleBorrowRatePenaltyBps,
          RISK_ENGINE_DEFAULTS.stressedCollateralRatioBps,
        );
        await contract.waitForDeployment();
        const addr = await contract.getAddress();
        deployed.quoteEngine = contract;
        return addr;
      },
    },
    {
      key: "riskEngine",
      label: "RiskAdapter",
      artifactName: "RiskAdapter",
      deploy: async () => {
        const factory = await ethers.getContractFactory("RiskAdapter", deployer);
        const contract = await factory.deploy(
          resolveAddr("accessManager"),
          resolveAddr("quoteEngine"),
          {
            baseRateBps: RISK_ENGINE_DEFAULTS.baseRateBps,
            slope1Bps: RISK_ENGINE_DEFAULTS.slope1Bps,
            slope2Bps: RISK_ENGINE_DEFAULTS.slope2Bps,
            kinkBps: RISK_ENGINE_DEFAULTS.kinkBps,
            healthyMaxLtvBps: RISK_ENGINE_DEFAULTS.healthyMaxLtvBps,
            stressedMaxLtvBps: RISK_ENGINE_DEFAULTS.stressedMaxLtvBps,
            healthyLiquidationThresholdBps: RISK_ENGINE_DEFAULTS.healthyLiquidationThresholdBps,
            stressedLiquidationThresholdBps: RISK_ENGINE_DEFAULTS.stressedLiquidationThresholdBps,
            staleBorrowRatePenaltyBps: RISK_ENGINE_DEFAULTS.staleBorrowRatePenaltyBps,
            stressedCollateralRatioBps: RISK_ENGINE_DEFAULTS.stressedCollateralRatioBps,
          },
        );
        await contract.waitForDeployment();
        const addr = await contract.getAddress();
        deployed.riskEngine = contract;
        return addr;
      },
    },
    {
      key: "debtPool",
      label: "DebtPool",
      artifactName: "DebtPool",
      deploy: async () => {
        const factory = await ethers.getContractFactory("DebtPool", deployer);
        const contract = await factory.deploy(
          resolveAddr("usdc"),
          resolveAddr("accessManager"),
          POOL_DEFAULTS.supplyCap,
        );
        await contract.waitForDeployment();
        const addr = await contract.getAddress();
        deployed.debtPool = contract;
        return addr;
      },
    },
    {
      key: "lendingCore",
      label: "LendingCore",
      artifactName: "LendingCore",
      deploy: async () => {
        const factory = await ethers.getContractFactory("LendingCore", deployer);
        const contract = await factory.deploy(
          resolveAddr("accessManager"),
          resolveAddr("wpas"),
          resolveAddr("usdc"),
          resolveAddr("debtPool"),
          resolveAddr("oracle"),
          resolveAddr("riskEngine"),
          CORE_DEFAULTS,
        );
        await contract.waitForDeployment();
        const addr = await contract.getAddress();
        deployed.lendingCore = contract;
        return addr;
      },
    },
    {
      key: "marketRegistry",
      label: "MarketVersionRegistry",
      artifactName: "MarketVersionRegistry",
      deploy: async () => {
        const factory = await ethers.getContractFactory("MarketVersionRegistry", deployer);
        const contract = await factory.deploy(resolveAddr("accessManager"));
        await contract.waitForDeployment();
        const addr = await contract.getAddress();
        deployed.marketRegistry = contract;
        return addr;
      },
    },
  ];

  // ─── Run idempotent steps ─────────────────────────────────────────────────

  const addresses = await runIdempotentSteps(steps, {
    manifestContracts: existingContracts,
    getCode: (addr) => ethers.provider.getCode(addr),
    onDeployed: async (key, address) => {
      // 1. Update in-memory checkpoint
      checkpoint[key] = address;
      // 2. Persist checkpoint to disk immediately
      saveCheckpoint(checkpoint);
      console.log(`  [CHECKPOINT] ${key} = ${address}`);
    },
  });

  // ─── Post-deployment wiring (only when contracts are newly deployed) ─────
  // These operations are idempotent but we only need to run them when
  // the core contracts were (re)deployed. Skip if everything was skipped.

  console.log("\n[WIRE] Setting up roles and permissions…");

  const accessManagerContract = deployed.accessManager ??
    (await ethers.getContractAt("DualVMAccessManager", addresses.accessManager, deployer));
  const debtPoolContract = deployed.debtPool ??
    (await ethers.getContractAt("DebtPool", addresses.debtPool, deployer));
  const lendingCoreContract = deployed.lendingCore ??
    (await ethers.getContractAt("LendingCore", addresses.lendingCore, deployer));
  const oracleContract = deployed.oracle ??
    (await ethers.getContractAt("ManualOracle", addresses.oracle, deployer));
  const riskEngineContract = deployed.riskEngine ??
    (await ethers.getContractAt("RiskAdapter", addresses.riskEngine, deployer));
  const usdcContract = deployed.usdc ??
    (await ethers.getContractAt("USDCMock", addresses.usdc, deployer));
  const marketRegistryContract = deployed.marketRegistry ??
    (await ethers.getContractAt("MarketVersionRegistry", addresses.marketRegistry, deployer));

  // Check if deployer is still admin before attempting role wiring
  const ADMIN_ROLE = 0n;
  const [deployerIsAdmin] = await accessManagerContract.hasRole(ADMIN_ROLE, deployerAddress);

  if (deployerIsAdmin) {
    // Wire DebtPool ↔ LendingCore
    const currentLendingCore = await debtPoolContract.lendingCore().catch(() => ethers.ZeroAddress);
    if (currentLendingCore.toLowerCase() !== addresses.lendingCore.toLowerCase()) {
      console.log("[WIRE] DebtPool.setLendingCore…");
      await waitFor(debtPoolContract.setLendingCore(addresses.lendingCore));
    }

    // Role labels (idempotent)
    await waitFor(accessManagerContract.labelRole(ROLE_IDS.EMERGENCY, "EMERGENCY_ROLE"));
    await waitFor(accessManagerContract.labelRole(ROLE_IDS.RISK_ADMIN, "RISK_ADMIN_ROLE"));
    await waitFor(accessManagerContract.labelRole(ROLE_IDS.TREASURY, "TREASURY_ROLE"));
    await waitFor(accessManagerContract.labelRole(ROLE_IDS.MINTER, "MINTER_ROLE"));
    await waitFor(accessManagerContract.labelRole(ROLE_IDS.LENDING_CORE, "LENDING_CORE_ROLE"));

    // Grant roles
    await waitFor(accessManagerContract.grantRole(ROLE_IDS.EMERGENCY, emergencyAdmin, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.emergency));
    await waitFor(accessManagerContract.grantRole(ROLE_IDS.RISK_ADMIN, riskAdmin, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.riskAdmin));
    await waitFor(accessManagerContract.grantRole(ROLE_IDS.TREASURY, treasuryOperator, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.treasury));
    await waitFor(accessManagerContract.grantRole(ROLE_IDS.MINTER, minter, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.minter));
    await waitFor(accessManagerContract.grantRole(ROLE_IDS.LENDING_CORE, addresses.lendingCore, 0));

    // Function role mappings
    await waitFor(accessManagerContract.setTargetFunctionRole(
      addresses.lendingCore,
      [selector(lendingCoreContract, "pause"), selector(lendingCoreContract, "unpause")],
      ROLE_IDS.EMERGENCY,
    ));
    await waitFor(accessManagerContract.setTargetFunctionRole(
      addresses.debtPool,
      [selector(debtPoolContract, "pause"), selector(debtPoolContract, "unpause")],
      ROLE_IDS.EMERGENCY,
    ));
    await waitFor(accessManagerContract.setTargetFunctionRole(
      addresses.debtPool,
      [selector(debtPoolContract, "claimReserves")],
      ROLE_IDS.TREASURY,
    ));
    await waitFor(accessManagerContract.setTargetFunctionRole(
      addresses.oracle,
      [selector(oracleContract, "setPrice"), selector(oracleContract, "setMaxAge"), selector(oracleContract, "setCircuitBreaker")],
      ROLE_IDS.RISK_ADMIN,
    ));
    await waitFor(accessManagerContract.setTargetFunctionRole(
      addresses.oracle,
      [selector(oracleContract, "pause"), selector(oracleContract, "unpause")],
      ROLE_IDS.EMERGENCY,
    ));
    await waitFor(accessManagerContract.setTargetFunctionRole(
      addresses.riskEngine,
      [selector(riskEngineContract, "quoteViaTicket")],
      ROLE_IDS.LENDING_CORE,
    ));
    await waitFor(accessManagerContract.setTargetFunctionRole(
      addresses.usdc,
      [selector(usdcContract, "mint")],
      ROLE_IDS.MINTER,
    ));
    await waitFor(accessManagerContract.setTargetFunctionRole(
      addresses.marketRegistry,
      [selector(marketRegistryContract, "registerVersion"), selector(marketRegistryContract, "activateVersion")],
      ROLE_IDS.RISK_ADMIN,
    ));

    // Admin delay
    if (adminDelaySeconds > 0) {
      for (const addr of [addresses.lendingCore, addresses.debtPool, addresses.oracle, addresses.usdc, addresses.marketRegistry]) {
        await waitFor(accessManagerContract.setTargetAdminDelay(addr, adminDelaySeconds));
      }
    }

    // Register market version 1 if not yet registered
    const latestVersionId = await marketRegistryContract.latestVersionId();
    if (latestVersionId === 0n) {
      await waitFor(marketRegistryContract.registerVersion(
        addresses.lendingCore,
        addresses.debtPool,
        addresses.oracle,
        addresses.riskEngine,
      ));
      await waitFor(marketRegistryContract.activateVersion(1));
    }

    // Seed initial liquidity
    if (initialLiquidity > 0n) {
      await waitFor(usdcContract.mint(deployerAddress, initialLiquidity));
      await waitFor(usdcContract.approve(addresses.debtPool, initialLiquidity));
      await waitFor(debtPoolContract.deposit(initialLiquidity, deployerAddress));
    }

    console.log("[WIRE] Roles and permissions configured.");
  } else {
    console.log("[WIRE] Deployer is not AccessManager admin — skipping role wiring.");
  }

  // ─── Build and write final manifest ────────────────────────────────────

  const finalManifest: Partial<DeploymentManifest> = {
    ...(loadManifestOrEmpty(manifestPath)),
    generatedAt: new Date().toISOString(),
    networkName: hre.network.name,
    roles: {
      treasury: treasury as `0x${string}`,
      emergencyAdmin: emergencyAdmin as `0x${string}`,
      riskAdmin: riskAdmin as `0x${string}`,
      treasuryOperator: treasuryOperator as `0x${string}`,
      minter: minter as `0x${string}`,
    },
    contracts: {
      ...((loadManifestOrEmpty(manifestPath).contracts) ?? {}),
      ...Object.fromEntries(Object.entries(addresses).map(([k, v]) => [k, v as `0x${string}`])),
    } as DeploymentManifest["contracts"],
  };

  writeManifestPartial(finalManifest, manifestPath);
  console.log(`\n[MANIFEST] Written to ${manifestPath}`);
  console.log(JSON.stringify(addresses, null, 2));

  // Clear checkpoint on successful completion
  saveCheckpoint({});
  console.log("[CHECKPOINT] Cleared (run complete).");
}

runEntrypoint("scripts/deploy-idempotent.ts", main);
