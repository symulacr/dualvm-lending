import hre from "hardhat";
import {
  CORE_DEFAULTS,
  ORACLE_CIRCUIT_BREAKER_DEFAULTS,
  ORACLE_DEFAULTS,
  POOL_DEFAULTS,
  RISK_ENGINE_DEFAULTS,
  ROLE_IDS,
} from "../config/marketConfig";

const { ethers } = hre;

function getSelector(contract: { interface: { getFunction(name: string): { selector: string } | null } }, name: string) {
  const fragment = contract.interface.getFunction(name);
  if (!fragment) {
    throw new Error(`Missing function selector for ${name}`);
  }
  return fragment.selector;
}

export interface DeployMarketVersionParams {
  deployer: any;
  authority: string;
  collateralAsset: string;
  debtAsset: string;
  autoWireLendingCore?: boolean;
  riskQuoteEngineAddress?: string;
  oraclePriceWad?: bigint;
  oracleMaxAgeSeconds?: number;
  oracleMinPriceWad?: bigint;
  oracleMaxPriceWad?: bigint;
  oracleMaxPriceChangeBps?: bigint;
  marketConfig?: {
    borrowCap: bigint;
    minBorrowAmount: bigint;
    reserveFactorBps: bigint;
    maxLtvBps: bigint;
    liquidationThresholdBps: bigint;
    liquidationBonusBps: bigint;
  };
  poolSupplyCap?: bigint;
  riskEngineConfig?: {
    baseRateBps: bigint;
    slope1Bps: bigint;
    slope2Bps: bigint;
    kinkBps: bigint;
    healthyMaxLtvBps: bigint;
    stressedMaxLtvBps: bigint;
    healthyLiquidationThresholdBps: bigint;
    stressedLiquidationThresholdBps: bigint;
    staleBorrowRatePenaltyBps: bigint;
    stressedCollateralRatioBps: bigint;
  };
}

export async function deployMarketVersion(params: DeployMarketVersionParams) {
  const oraclePriceWad = params.oraclePriceWad ?? ORACLE_DEFAULTS.initialPriceWad;
  const oracleMaxAgeSeconds = params.oracleMaxAgeSeconds ?? ORACLE_DEFAULTS.maxAgeSeconds;
  const oracleMinPriceWad = params.oracleMinPriceWad ?? ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad;
  const oracleMaxPriceWad = params.oracleMaxPriceWad ?? ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad;
  const oracleMaxPriceChangeBps = params.oracleMaxPriceChangeBps ?? ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps;
  const marketConfig = params.marketConfig ?? CORE_DEFAULTS;
  const poolSupplyCap = params.poolSupplyCap ?? POOL_DEFAULTS.supplyCap;
  const riskEngineConfig = params.riskEngineConfig ?? RISK_ENGINE_DEFAULTS;
  const autoWireLendingCore = params.autoWireLendingCore ?? true;

  const oracleFactory = await ethers.getContractFactory("ManualOracle", params.deployer);
  const oracle = await oracleFactory.deploy(
    params.authority,
    oraclePriceWad,
    oracleMaxAgeSeconds,
    oracleMinPriceWad,
    oracleMaxPriceWad,
    oracleMaxPriceChangeBps,
  );
  await oracle.waitForDeployment();

  // Deploy the DeterministicRiskModel (PVM quote engine) if no address provided
  let quoteEngine: any;
  if (params.riskQuoteEngineAddress) {
    quoteEngine = {
      getAddress: async () => params.riskQuoteEngineAddress,
    };
  } else {
    const quoteEngineFactory = await ethers.getContractFactory("DeterministicRiskModel", params.deployer);
    quoteEngine = await quoteEngineFactory.deploy(
      riskEngineConfig.baseRateBps,
      riskEngineConfig.slope1Bps,
      riskEngineConfig.slope2Bps,
      riskEngineConfig.kinkBps,
      riskEngineConfig.healthyMaxLtvBps,
      riskEngineConfig.stressedMaxLtvBps,
      riskEngineConfig.healthyLiquidationThresholdBps,
      riskEngineConfig.stressedLiquidationThresholdBps,
      riskEngineConfig.staleBorrowRatePenaltyBps,
      riskEngineConfig.stressedCollateralRatioBps,
    );
    await quoteEngine.waitForDeployment();
  }

  // Deploy RiskAdapter as AccessManaged with inline risk model config and optional PVM verification
  const riskAdapterFactory = await ethers.getContractFactory("RiskAdapter", params.deployer);
  const riskEngine = await riskAdapterFactory.deploy(
    params.authority,
    await quoteEngine.getAddress(),
    {
      baseRateBps: riskEngineConfig.baseRateBps,
      slope1Bps: riskEngineConfig.slope1Bps,
      slope2Bps: riskEngineConfig.slope2Bps,
      kinkBps: riskEngineConfig.kinkBps,
      healthyMaxLtvBps: riskEngineConfig.healthyMaxLtvBps,
      stressedMaxLtvBps: riskEngineConfig.stressedMaxLtvBps,
      healthyLiquidationThresholdBps: riskEngineConfig.healthyLiquidationThresholdBps,
      stressedLiquidationThresholdBps: riskEngineConfig.stressedLiquidationThresholdBps,
      staleBorrowRatePenaltyBps: riskEngineConfig.staleBorrowRatePenaltyBps,
      stressedCollateralRatioBps: riskEngineConfig.stressedCollateralRatioBps,
    },
  );
  await riskEngine.waitForDeployment();

  const debtPoolFactory = await ethers.getContractFactory("DebtPool", params.deployer);
  const debtPool = await debtPoolFactory.deploy(params.debtAsset, params.authority, poolSupplyCap);
  await debtPool.waitForDeployment();

  const lendingCoreFactory = await ethers.getContractFactory("LendingCore", params.deployer);
  const lendingCore = await lendingCoreFactory.deploy(
    params.authority,
    params.collateralAsset,
    params.debtAsset,
    await debtPool.getAddress(),
    await oracle.getAddress(),
    await riskEngine.getAddress(),
    marketConfig,
  );
  await lendingCore.waitForDeployment();
  if (autoWireLendingCore) {
    const setLendingCoreTx = await debtPool.setLendingCore(await lendingCore.getAddress());
    await setLendingCoreTx.wait();
  }

  // Wire LENDING_CORE role: grant lendingCore the role and restrict quoteViaTicket on riskEngine.
  // Only performed when the deployer holds AccessManager admin rights (ADMIN_ROLE = 0).
  // In governed deployments where admin has already been transferred to the timelock,
  // the caller must wire this role through governance instead.
  const accessManager = await ethers.getContractAt("DualVMAccessManager", params.authority, params.deployer);
  const ADMIN_ROLE = 0n;
  const [deployerIsAdmin] = await accessManager.hasRole(ADMIN_ROLE, await params.deployer.getAddress());
  if (deployerIsAdmin) {
    await (await accessManager.labelRole(ROLE_IDS.LENDING_CORE, "LENDING_CORE_ROLE")).wait();
    await (await accessManager.grantRole(ROLE_IDS.LENDING_CORE, await lendingCore.getAddress(), 0)).wait();
    await (
      await accessManager.setTargetFunctionRole(
        await riskEngine.getAddress(),
        [getSelector(riskEngine, "quoteViaTicket")],
        ROLE_IDS.LENDING_CORE,
      )
    ).wait();
  }

  return {
    oracle,
    quoteEngine,
    riskEngine,
    debtPool,
    lendingCore,
  };
}
