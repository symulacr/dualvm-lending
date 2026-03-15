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

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "deployments", "polkadot-hub-testnet.json"), "utf8"),
  );
  const provider = ethers.provider;

  const admin = new ethers.Wallet(requireEnv("ADMIN_PRIVATE_KEY"), provider);
  const riskAdmin = new ethers.Wallet(requireEnv("RISK_PRIVATE_KEY"), provider);

  const accessManager = (await ethers.getContractFactory("DualVMAccessManager", riskAdmin)).attach(manifest.contracts.accessManager) as any;
  const lendingCore = (await ethers.getContractFactory("LendingCore", admin)).attach(manifest.contracts.lendingCore) as any;
  const oracle = (await ethers.getContractFactory("ManualOracle", riskAdmin)).attach(manifest.contracts.oracle) as any;
  const riskEngineFactory = await ethers.getContractFactory("PvmRiskEngine", admin);

  const originalRiskEngine = manifest.contracts.riskEngine;
  const originalPrice = await oracle.priceWad();
  const riskDelay = manifest.governance?.executionDelaySeconds?.riskAdmin ?? 0;

  const tempRiskEngine = await riskEngineFactory.deploy(
    9_999n,
    1_111n,
    2_222n,
    8_000n,
    7_500n,
    6_500n,
    8_500n,
    7_800n,
    333n,
    14_000n,
  );
  await tempRiskEngine.waitForDeployment();

  await executeManagedCall(
    accessManager,
    riskAdmin,
    oracle,
    "setCircuitBreaker",
    [1n * WAD, 20_000n * WAD, 10_000n],
    "risk admin widen circuit breaker",
    riskDelay,
  );
  await executeManagedCall(
    accessManager,
    riskAdmin,
    lendingCore,
    "setRiskEngine",
    [await tempRiskEngine.getAddress()],
    "risk admin set temporary risk engine",
    riskDelay,
  );
  await executeManagedCall(
    accessManager,
    riskAdmin,
    oracle,
    "setPrice",
    [900n * WAD],
    "risk admin set temporary oracle price",
    riskDelay,
  );

  const [temporaryRiskEngine, temporaryPrice, widenedBreaker] = await Promise.all([
    lendingCore.riskEngine(),
    oracle.priceWad(),
    oracle.maxPriceChangeBps(),
  ]);

  await executeManagedCall(
    accessManager,
    riskAdmin,
    lendingCore,
    "setRiskEngine",
    [originalRiskEngine],
    "risk admin restore risk engine",
    riskDelay,
  );
  await executeManagedCall(
    accessManager,
    riskAdmin,
    oracle,
    "setPrice",
    [originalPrice],
    "risk admin restore oracle price",
    riskDelay,
  );
  await executeManagedCall(
    accessManager,
    riskAdmin,
    oracle,
    "setCircuitBreaker",
    [
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps,
    ],
    "risk admin restore circuit breaker",
    riskDelay,
  );

  const [restoredRiskEngine, restoredPrice, restoredBreaker] = await Promise.all([
    lendingCore.riskEngine(),
    oracle.priceWad(),
    oracle.maxPriceChangeBps(),
  ]);

  console.log(
    JSON.stringify(
      {
        roles: {
          admin: admin.address,
          riskAdmin: riskAdmin.address,
        },
        governance: manifest.governance,
        checks: {
          temporaryRiskEngine,
          temporaryPrice: formatUnits(temporaryPrice),
          widenedBreakerBps: widenedBreaker.toString(),
          restoredRiskEngine,
          restoredPrice: formatUnits(restoredPrice),
          restoredBreakerBps: restoredBreaker.toString(),
          riskEngineRestored: restoredRiskEngine.toLowerCase() === originalRiskEngine.toLowerCase(),
          oracleRestored: restoredPrice === originalPrice,
          breakerRestored: restoredBreaker === ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps,
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
