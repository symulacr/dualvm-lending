import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { executeManagedCall } from "./accessManagerOps";
import { ORACLE_CIRCUIT_BREAKER_DEFAULTS, WAD } from "./marketConfig";

const { ethers } = hre;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function formatUnits(value: bigint) {
  return ethers.formatUnits(value, 18);
}

async function waitFor(txPromise: Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }>, label: string) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${receipt.hash ?? tx.hash ?? "mined"}`);
}

async function main() {
  const manifestPath = path.join(process.cwd(), "deployments", "polkadot-hub-testnet.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
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
  const usdcLender = usdcAdmin.connect(lender) as any;
  const usdcLiquidator = usdcAdmin.connect(liquidator) as any;
  const oracle = (await ethers.getContractFactory("ManualOracle", riskAdmin)).attach(manifest.contracts.oracle) as any;
  const debtPoolLender = (await ethers.getContractFactory("DebtPool", lender)).attach(manifest.contracts.debtPool) as any;
  const debtPoolAdmin = debtPoolLender.connect(admin) as any;
  const lendingCoreAdmin = (await ethers.getContractFactory("LendingCore", admin)).attach(manifest.contracts.lendingCore) as any;
  const lendingCoreBorrower = lendingCoreAdmin.connect(borrower) as any;
  const lendingCoreLiquidator = lendingCoreAdmin.connect(liquidator) as any;
  const riskEngineFactory = await ethers.getContractFactory("PvmRiskEngine", admin);

  const minterDelay = manifest.governance?.executionDelaySeconds?.minter ?? 0;
  const riskDelay = manifest.governance?.executionDelaySeconds?.riskAdmin ?? 0;
  const originalRiskEngine = manifest.contracts.riskEngine;
  const originalBreaker = {
    minPriceWad: await oracle.minPriceWad(),
    maxPriceWad: await oracle.maxPriceWad(),
    maxPriceChangeBps: await oracle.maxPriceChangeBps(),
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
  await executeManagedCall(
    accessManagerRisk,
    riskAdmin,
    lendingCoreAdmin,
    "setRiskEngine",
    [await tempRiskEngine.getAddress()],
    "set temporary high-rate risk engine",
    riskDelay,
  );
  await executeManagedCall(
    accessManagerRisk,
    riskAdmin,
    oracle,
    "setPrice",
    [1_000n * WAD],
    "reset oracle price",
    riskDelay,
  );
  await executeManagedCall(
    accessManagerRisk,
    riskAdmin,
    oracle,
    "setCircuitBreaker",
    [ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad, ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad, 10_000n],
    "widen oracle circuit breaker for liquidation smoke",
    riskDelay,
  );

  const lenderSeed = ethers.parseUnits("20000", 18);
  const liquidatorSeed = ethers.parseUnits("10000", 18);
  const collateralPas = ethers.parseUnits("20", 18);
  const borrowAmount = ethers.parseUnits("10000", 18);

  await executeManagedCall(accessManagerMinter, minter, usdcAdmin, "mint", [lender.address, lenderSeed], "mint lender usdc-test", minterDelay);
  await executeManagedCall(accessManagerMinter, minter, usdcAdmin, "mint", [liquidator.address, liquidatorSeed], "mint liquidator usdc-test", minterDelay);
  await waitFor(usdcLender.approve(await debtPoolAdmin.getAddress(), ethers.MaxUint256), "lender approve debt pool");
  await waitFor(debtPoolLender.deposit(lenderSeed, lender.address), "lender deposit pool liquidity");

  await waitFor(wpas.deposit({ value: collateralPas }), "borrower wrap pas into wpas");
  await new Promise(resolve => setTimeout(resolve, 3000));
  await waitFor(wpas.approve(await lendingCoreAdmin.getAddress(), ethers.MaxUint256), "borrower approve collateral");
  await new Promise(resolve => setTimeout(resolve, 3000));
  await waitFor(lendingCoreBorrower.depositCollateral(collateralPas), "borrower deposit collateral");
  await new Promise(resolve => setTimeout(resolve, 3000));
  await waitFor(lendingCoreBorrower.borrow(borrowAmount), "borrower draw stable debt");

  await new Promise(resolve => setTimeout(resolve, 15000));
  await executeManagedCall(
    accessManagerRisk,
    riskAdmin,
    oracle,
    "setPrice",
    [21n * WAD],
    "drop oracle price",
    riskDelay,
  );
  await waitFor(usdcLiquidator.approve(await lendingCoreAdmin.getAddress(), ethers.MaxUint256), "liquidator approve core");

  const [debtBefore, principalBefore, liquidatorCollateralBefore] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    debtPoolAdmin.outstandingPrincipal(),
    wpas.balanceOf(liquidator.address),
  ]);

  await waitFor(lendingCoreLiquidator.liquidate(borrower.address, ethers.MaxUint256), "liquidator execute liquidation");

  const [debtAfter, principalAfter, liquidatorCollateralAfter, riskEngineAfter] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    debtPoolAdmin.outstandingPrincipal(),
    wpas.balanceOf(liquidator.address),
    lendingCoreAdmin.riskEngine(),
  ]);

  await executeManagedCall(
    accessManagerRisk,
    riskAdmin,
    lendingCoreAdmin,
    "setRiskEngine",
    [originalRiskEngine],
    "restore original risk engine",
    riskDelay,
  );
  await executeManagedCall(
    accessManagerRisk,
    riskAdmin,
    oracle,
    "setPrice",
    [1_000n * WAD],
    "restore oracle price",
    riskDelay,
  );
  await executeManagedCall(
    accessManagerRisk,
    riskAdmin,
    oracle,
    "setCircuitBreaker",
    [
      originalBreaker.minPriceWad,
      originalBreaker.maxPriceWad,
      originalBreaker.maxPriceChangeBps,
    ],
    "restore oracle circuit breaker",
    riskDelay,
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
          debtBefore: formatUnits(debtBefore),
          principalBefore: formatUnits(principalBefore),
          debtExceedsPrincipalBefore: debtBefore > principalBefore,
          debtAfter: formatUnits(debtAfter),
          principalAfter: formatUnits(principalAfter),
          liquidatorCollateralGain: formatUnits(BigInt(liquidatorCollateralAfter) - BigInt(liquidatorCollateralBefore)),
          riskEngineWasTemporaryDuringRun: riskEngineAfter.toLowerCase() === (await tempRiskEngine.getAddress()).toLowerCase(),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
