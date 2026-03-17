import hre from "hardhat";
import {
  CORE_DEFAULTS,
  LIVE_ROLE_EXECUTION_DELAYS_SECONDS,
  ORACLE_CIRCUIT_BREAKER_DEFAULTS,
  ORACLE_DEFAULTS,
  POLKADOT_HUB_TESTNET,
  POOL_DEFAULTS,
  RISK_ENGINE_DEFAULTS,
  ROLE_IDS,
  TARGET_ADMIN_DELAY_SECONDS,
} from "../config/marketConfig";
import { waitForTransaction } from "../runtime/transactions";
import { deployMarketVersion } from "./deployMarketVersion";

export interface DeployDualVmOverrides {
  treasury?: string;
  emergencyAdmin?: string;
  riskAdmin?: string;
  treasuryOperator?: string;
  minter?: string;
  initialLiquidity?: bigint;
  oraclePriceWad?: bigint;
  oracleMaxAgeSeconds?: number;
  oracleMinPriceWad?: bigint;
  oracleMaxPriceWad?: bigint;
  oracleMaxPriceChangeBps?: bigint;
  adminDelaySeconds?: number;
  emergencyExecutionDelaySeconds?: number;
  riskAdminExecutionDelaySeconds?: number;
  treasuryExecutionDelaySeconds?: number;
  minterExecutionDelaySeconds?: number;
  riskQuoteEngineAddress?: string;
}

function selector(contract: { interface: { getFunction(name: string): { selector: string } | null } }, name: string) {
  const fragment = contract.interface.getFunction(name);
  if (!fragment) {
    throw new Error(`Missing function selector for ${name}`);
  }
  return fragment.selector;
}

async function waitFor(txPromise: Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }>) {
  await waitForTransaction(txPromise, "transaction");
}

export async function deployDualVmSystem(overrides: DeployDualVmOverrides = {}) {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();

  const deployerAddress = await deployer.getAddress();
  const treasury = overrides.treasury ?? deployerAddress;
  const emergencyAdmin = overrides.emergencyAdmin ?? deployerAddress;
  const riskAdmin = overrides.riskAdmin ?? deployerAddress;
  const treasuryOperator = overrides.treasuryOperator ?? deployerAddress;
  const minter = overrides.minter ?? deployerAddress;
  const initialLiquidity = overrides.initialLiquidity ?? POOL_DEFAULTS.initialLiquidity;
  const oraclePriceWad = overrides.oraclePriceWad ?? ORACLE_DEFAULTS.initialPriceWad;
  const oracleMaxAgeSeconds = overrides.oracleMaxAgeSeconds ?? ORACLE_DEFAULTS.maxAgeSeconds;
  const oracleMinPriceWad = overrides.oracleMinPriceWad ?? ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad;
  const oracleMaxPriceWad = overrides.oracleMaxPriceWad ?? ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad;
  const oracleMaxPriceChangeBps =
    overrides.oracleMaxPriceChangeBps ?? ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps;
  const adminDelaySeconds = overrides.adminDelaySeconds ?? TARGET_ADMIN_DELAY_SECONDS;
  const emergencyExecutionDelaySeconds = overrides.emergencyExecutionDelaySeconds ?? 0;
  const riskAdminExecutionDelaySeconds = overrides.riskAdminExecutionDelaySeconds ?? 0;
  const treasuryExecutionDelaySeconds = overrides.treasuryExecutionDelaySeconds ?? 0;
  const minterExecutionDelaySeconds = overrides.minterExecutionDelaySeconds ?? 0;
  const riskQuoteEngineAddress = overrides.riskQuoteEngineAddress;

  const accessManagerFactory = await ethers.getContractFactory("DualVMAccessManager");
  const accessManager = await accessManagerFactory.deploy(deployerAddress);
  await accessManager.waitForDeployment();

  const wpasFactory = await ethers.getContractFactory("WPAS");
  const wpas = await wpasFactory.deploy();
  await wpas.waitForDeployment();

  const usdcFactory = await ethers.getContractFactory("USDCMock");
  const usdc = await usdcFactory.deploy(await accessManager.getAddress());
  await usdc.waitForDeployment();

  const { oracle, quoteEngine, riskEngine, debtPool, lendingCore } = await deployMarketVersion({
    deployer,
    authority: await accessManager.getAddress(),
    collateralAsset: await wpas.getAddress(),
    debtAsset: await usdc.getAddress(),
    riskQuoteEngineAddress,
    oraclePriceWad,
    oracleMaxAgeSeconds,
    oracleMinPriceWad,
    oracleMaxPriceWad,
    oracleMaxPriceChangeBps,
    poolSupplyCap: POOL_DEFAULTS.supplyCap,
    marketConfig: CORE_DEFAULTS,
    riskEngineConfig: RISK_ENGINE_DEFAULTS,
  });

  const marketRegistryFactory = await ethers.getContractFactory("MarketVersionRegistry");
  const marketRegistry = await marketRegistryFactory.deploy(await accessManager.getAddress());
  await marketRegistry.waitForDeployment();

  await waitFor(
    marketRegistry.registerVersion(
      await lendingCore.getAddress(),
      await debtPool.getAddress(),
      await oracle.getAddress(),
      await riskEngine.getAddress(),
    ),
  );
  await waitFor(marketRegistry.activateVersion(1));

  await waitFor(accessManager.labelRole(ROLE_IDS.EMERGENCY, "EMERGENCY_ROLE"));
  await waitFor(accessManager.labelRole(ROLE_IDS.RISK_ADMIN, "RISK_ADMIN_ROLE"));
  await waitFor(accessManager.labelRole(ROLE_IDS.TREASURY, "TREASURY_ROLE"));
  await waitFor(accessManager.labelRole(ROLE_IDS.MINTER, "MINTER_ROLE"));

  await waitFor(accessManager.grantRole(ROLE_IDS.EMERGENCY, emergencyAdmin, emergencyExecutionDelaySeconds));
  await waitFor(accessManager.grantRole(ROLE_IDS.RISK_ADMIN, riskAdmin, riskAdminExecutionDelaySeconds));
  await waitFor(accessManager.grantRole(ROLE_IDS.TREASURY, treasuryOperator, treasuryExecutionDelaySeconds));
  await waitFor(accessManager.grantRole(ROLE_IDS.MINTER, minter, minterExecutionDelaySeconds));

  await waitFor(
    accessManager.setTargetFunctionRole(
      await lendingCore.getAddress(),
      [selector(lendingCore, "pause"), selector(lendingCore, "unpause")],
      ROLE_IDS.EMERGENCY,
    ),
  );

  await waitFor(
    accessManager.setTargetFunctionRole(
      await debtPool.getAddress(),
      [selector(debtPool, "pause"), selector(debtPool, "unpause")],
      ROLE_IDS.EMERGENCY,
    ),
  );
  await waitFor(
    accessManager.setTargetFunctionRole(await debtPool.getAddress(), [selector(debtPool, "claimReserves")], ROLE_IDS.TREASURY),
  );

  await waitFor(
    accessManager.setTargetFunctionRole(
      await oracle.getAddress(),
      [selector(oracle, "setPrice"), selector(oracle, "setMaxAge"), selector(oracle, "setCircuitBreaker")],
      ROLE_IDS.RISK_ADMIN,
    ),
  );
  await waitFor(
    accessManager.setTargetFunctionRole(
      await oracle.getAddress(),
      [selector(oracle, "pause"), selector(oracle, "unpause")],
      ROLE_IDS.EMERGENCY,
    ),
  );

  // Note: LENDING_CORE role wiring (grantRole + setTargetFunctionRole for quoteViaTicket) is now
  // handled inside deployMarketVersion, so it does not need to be repeated here.

  await waitFor(accessManager.setTargetFunctionRole(await usdc.getAddress(), [selector(usdc, "mint")], ROLE_IDS.MINTER));
  await waitFor(
    accessManager.setTargetFunctionRole(
      await marketRegistry.getAddress(),
      [selector(marketRegistry, "registerVersion"), selector(marketRegistry, "activateVersion")],
      ROLE_IDS.RISK_ADMIN,
    ),
  );

  if (adminDelaySeconds > 0) {
    await waitFor(accessManager.setTargetAdminDelay(await lendingCore.getAddress(), adminDelaySeconds));
    await waitFor(accessManager.setTargetAdminDelay(await debtPool.getAddress(), adminDelaySeconds));
    await waitFor(accessManager.setTargetAdminDelay(await oracle.getAddress(), adminDelaySeconds));
    await waitFor(accessManager.setTargetAdminDelay(await usdc.getAddress(), adminDelaySeconds));
    await waitFor(accessManager.setTargetAdminDelay(await marketRegistry.getAddress(), adminDelaySeconds));
  }

  if (initialLiquidity > 0n) {
    await waitFor(usdc.mint(deployerAddress, initialLiquidity));
    await waitFor(usdc.approve(await debtPool.getAddress(), initialLiquidity));
    await waitFor(debtPool.deposit(initialLiquidity, deployerAddress));
  }

  return {
    network: POLKADOT_HUB_TESTNET,
    deployer,
    roles: {
      treasury,
      emergencyAdmin,
      riskAdmin,
      treasuryOperator,
      minter,
    },
    governance: {
      admin: deployerAddress,
      executionDelaySeconds: {
        emergency: emergencyExecutionDelaySeconds,
        riskAdmin: riskAdminExecutionDelaySeconds,
        treasury: treasuryExecutionDelaySeconds,
        minter: minterExecutionDelaySeconds,
      },
    },
    config: {
      adminDelaySeconds,
      oracleMaxAgeSeconds,
      oraclePriceWad,
      oracle: {
        circuitBreaker: {
          minPriceWad: oracleMinPriceWad,
          maxPriceWad: oracleMaxPriceWad,
          maxPriceChangeBps: oracleMaxPriceChangeBps,
        },
      },
      initialLiquidity,
      pool: POOL_DEFAULTS,
      core: CORE_DEFAULTS,
      riskEngine: RISK_ENGINE_DEFAULTS,
    },
    contracts: {
      accessManager,
      wpas,
      usdc,
      oracle,
      riskEngine,
      quoteEngine,
      marketRegistry,
      debtPool,
      lendingCore,
    },
  };
}

export const LIVE_ROLE_EXECUTION_DELAYS = LIVE_ROLE_EXECUTION_DELAYS_SECONDS;
