import hre from "hardhat";
import {
  managedMintUsdc,
  managedSetOracleCircuitBreaker,
  managedSetOraclePrice,
  managedSetRiskEngine,
  type ManagedCallContext,
} from "../lib/ops/managedAccess";
import { openBorrowPosition, seedDebtPoolLiquidity, waitForDebtToAccrue } from "../lib/ops/liveScenario";
import { ORACLE_CIRCUIT_BREAKER_DEFAULTS, WAD } from "../lib/config/marketConfig";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { requireEnv } from "../lib/runtime/env";
import { formatWad, waitForTransaction } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

async function normalizeOracleToBaseline(
  context: ManagedCallContext,
  oracle: any,
  targetPriceWad: bigint,
) {
  await managedSetOracleCircuitBreaker(
    context,
    oracle,
    1n * WAD,
    20_000n * WAD,
    10_000n,
    "prepare oracle baseline restore range",
  );

  let price = BigInt(await oracle.priceWad());
  if (price === 0n) {
    await managedSetOraclePrice(context, oracle, targetPriceWad, "seed oracle baseline price");
    return;
  }

  while (price < targetPriceWad) {
    const nextPrice = price * 2n > targetPriceWad ? targetPriceWad : price * 2n;
    await managedSetOraclePrice(context, oracle, nextPrice, `restore oracle price to ${formatWad(nextPrice)}`);
    price = nextPrice;
  }

  while (price > targetPriceWad) {
    const halvedPrice = price / 2n;
    const nextPrice = halvedPrice < targetPriceWad ? targetPriceWad : halvedPrice;
    await managedSetOraclePrice(context, oracle, nextPrice, `restore oracle price to ${formatWad(nextPrice)}`);
    price = nextPrice;
  }
}

export async function main() {
  const manifest = loadDeploymentManifest();
  const provider = ethers.provider;

  const admin = new ethers.Wallet(requireEnv("ADMIN_PRIVATE_KEY"), provider);
  const minter = new ethers.Wallet(requireEnv("MINTER_PRIVATE_KEY"), provider);
  const riskAdmin = new ethers.Wallet(requireEnv("RISK_PRIVATE_KEY"), provider);
  const lender = new ethers.Wallet(requireEnv("LENDER_PRIVATE_KEY"), provider);
  const borrower = new ethers.Wallet(requireEnv("BORROWER_PRIVATE_KEY"), provider);
  const liquidator = new ethers.Wallet(requireEnv("LIQUIDATOR_PRIVATE_KEY"), provider);

  const accessManagerMinter = (await ethers.getContractFactory("DualVMAccessManager", minter)).attach(manifest.contracts.accessManager) as any;
  const accessManagerRisk = (await ethers.getContractFactory("DualVMAccessManager", riskAdmin)).attach(manifest.contracts.accessManager) as any;
  const wpas = (await ethers.getContractFactory("WPAS", borrower)).attach(manifest.contracts.wpas) as any;
  const usdcAdmin = (await ethers.getContractFactory("USDCMock", admin)).attach(manifest.contracts.usdc) as any;
  const usdcLiquidator = usdcAdmin.connect(liquidator) as any;
  const oracle = (await ethers.getContractFactory("ManualOracle", riskAdmin)).attach(manifest.contracts.oracle) as any;
  const debtPoolLender = (await ethers.getContractFactory("DebtPool", lender)).attach(manifest.contracts.debtPool) as any;
  const debtPoolAdmin = debtPoolLender.connect(admin) as any;
  const lendingCoreAdmin = (await ethers.getContractFactory("LendingCore", admin)).attach(manifest.contracts.lendingCore) as any;
  const lendingCoreBorrower = lendingCoreAdmin.connect(borrower) as any;
  const lendingCoreLiquidator = lendingCoreAdmin.connect(liquidator) as any;
  const riskEngineFactory = await ethers.getContractFactory("PvmRiskEngine", admin);

  const managedMinterContext: ManagedCallContext = {
    accessManager: accessManagerMinter,
    signer: minter,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.minter ?? 0,
  };
  const managedRiskContext: ManagedCallContext = {
    accessManager: accessManagerRisk,
    signer: riskAdmin,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.riskAdmin ?? 0,
  };

  const originalRiskEngine = manifest.contracts.riskEngine;
  const baselineOraclePrice = 1_000n * WAD;
  const baselineBreaker = {
    minPriceWad: ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
    maxPriceWad: ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
    maxPriceChangeBps: ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps,
  };

  const tempRiskEngine = await riskEngineFactory.deploy(
    15_000_000_000n,
    0n,
    0n,
    8_000n,
    7_500n,
    6_500n,
    8_500n,
    7_800n,
    0n,
    14_000n,
  );
  await tempRiskEngine.waitForDeployment();
  await managedSetRiskEngine(
    managedRiskContext,
    lendingCoreAdmin,
    await tempRiskEngine.getAddress(),
    "set temporary high-rate risk engine",
  );
  await normalizeOracleToBaseline(managedRiskContext, oracle, baselineOraclePrice);

  const lenderSeed = ethers.parseUnits("20000", 18);
  const liquidatorSeed = ethers.parseUnits("10000", 18);
  const collateralPas = ethers.parseUnits("20", 18);
  const borrowAmount = ethers.parseUnits("10000", 18);

  await seedDebtPoolLiquidity(managedMinterContext, usdcAdmin, debtPoolLender, lender.address, lenderSeed, "lender");
  await managedMintUsdc(managedMinterContext, usdcAdmin, liquidator.address, liquidatorSeed, "mint liquidator usdc-test");
  await openBorrowPosition({
    wpas,
    lendingCore: lendingCoreBorrower,
    collateralPas,
    borrowAmount,
    labelPrefix: "borrower",
  });

  await waitForDebtToAccrue(
    lendingCoreAdmin,
    borrower.address,
    borrowAmount,
    "wait for liquidation scenario debt growth",
  );
  await managedSetOraclePrice(managedRiskContext, oracle, 21n * WAD, "drop oracle price");
  await waitForTransaction(usdcLiquidator.approve(await lendingCoreAdmin.getAddress(), ethers.MaxUint256), "liquidator approve core");

  const [debtBefore, principalBefore, liquidatorCollateralBefore] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    debtPoolAdmin.outstandingPrincipal(),
    wpas.balanceOf(liquidator.address),
  ]);

  await waitForTransaction(lendingCoreLiquidator.liquidate(borrower.address, ethers.MaxUint256), "liquidator execute liquidation");

  const [debtAfter, principalAfter, liquidatorCollateralAfter, riskEngineAfter] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    debtPoolAdmin.outstandingPrincipal(),
    wpas.balanceOf(liquidator.address),
    lendingCoreAdmin.riskEngine(),
  ]);

  await managedSetRiskEngine(managedRiskContext, lendingCoreAdmin, originalRiskEngine, "restore original risk engine");
  await normalizeOracleToBaseline(managedRiskContext, oracle, baselineOraclePrice);
  await managedSetOracleCircuitBreaker(
    managedRiskContext,
    oracle,
    baselineBreaker.minPriceWad,
    baselineBreaker.maxPriceWad,
    baselineBreaker.maxPriceChangeBps,
    "restore oracle circuit breaker",
  );

  console.log(
    JSON.stringify(
      {
        roles: {
          admin: admin.address,
          minter: minter.address,
          riskAdmin: riskAdmin.address,
          lender: lender.address,
          borrower: borrower.address,
          liquidator: liquidator.address,
        },
        deployment: manifest.contracts,
        governance: manifest.governance,
        temporaryRiskEngine: await tempRiskEngine.getAddress(),
        checks: {
          debtBefore: formatWad(debtBefore),
          principalBefore: formatWad(principalBefore),
          debtExceedsPrincipalBefore: debtBefore > principalBefore,
          debtAfter: formatWad(debtAfter),
          principalAfter: formatWad(principalAfter),
          liquidatorCollateralGain: formatWad(BigInt(liquidatorCollateralAfter) - BigInt(liquidatorCollateralBefore)),
          riskEngineWasTemporaryDuringRun: riskEngineAfter.toLowerCase() === (await tempRiskEngine.getAddress()).toLowerCase(),
        },
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/liveLiquidationSmoke.ts", main);
