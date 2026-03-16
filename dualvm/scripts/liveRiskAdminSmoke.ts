import hre from "hardhat";
import {
  managedSetOracleCircuitBreaker,
  managedSetOraclePrice,
  managedSetRiskEngine,
  type ManagedCallContext,
} from "../lib/ops/managedAccess";
import { WAD } from "../lib/config/marketConfig";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { requireEnv } from "../lib/runtime/env";
import { formatWad } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

export async function main() {
  const manifest = loadDeploymentManifest();
  const provider = ethers.provider;

  const admin = new ethers.Wallet(requireEnv("ADMIN_PRIVATE_KEY"), provider);
  const riskAdmin = new ethers.Wallet(requireEnv("RISK_PRIVATE_KEY"), provider);

  const accessManager = (await ethers.getContractFactory("DualVMAccessManager", riskAdmin)).attach(manifest.contracts.accessManager) as any;
  const lendingCore = (await ethers.getContractFactory("LendingCore", admin)).attach(manifest.contracts.lendingCore) as any;
  const oracle = (await ethers.getContractFactory("ManualOracle", riskAdmin)).attach(manifest.contracts.oracle) as any;
  const riskEngineFactory = await ethers.getContractFactory("PvmRiskEngine", admin);
  const managedRiskContext: ManagedCallContext = {
    accessManager,
    signer: riskAdmin,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.riskAdmin ?? 0,
  };

  const originalRiskEngine = manifest.contracts.riskEngine;
  const originalOracleState = {
    price: await oracle.priceWad(),
    minPriceWad: await oracle.minPriceWad(),
    maxPriceWad: await oracle.maxPriceWad(),
    maxPriceChangeBps: await oracle.maxPriceChangeBps(),
  };
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

  await managedSetOracleCircuitBreaker(
    managedRiskContext,
    oracle,
    1n * WAD,
    20_000n * WAD,
    10_000n,
    "risk admin widen circuit breaker",
  );
  await managedSetRiskEngine(
    managedRiskContext,
    lendingCore,
    await tempRiskEngine.getAddress(),
    "risk admin set temporary risk engine",
  );
  await managedSetOraclePrice(managedRiskContext, oracle, 900n * WAD, "risk admin set temporary oracle price");

  const [temporaryRiskEngine, temporaryOracleState] = await Promise.all([
    lendingCore.riskEngine(),
    Promise.all([oracle.priceWad(), oracle.minPriceWad(), oracle.maxPriceWad(), oracle.maxPriceChangeBps()]),
  ]);

  await managedSetRiskEngine(managedRiskContext, lendingCore, originalRiskEngine, "risk admin restore risk engine");
  await managedSetOraclePrice(managedRiskContext, oracle, originalOracleState.price, "risk admin restore oracle price");
  await managedSetOracleCircuitBreaker(
    managedRiskContext,
    oracle,
    originalOracleState.minPriceWad,
    originalOracleState.maxPriceWad,
    originalOracleState.maxPriceChangeBps,
    "risk admin restore circuit breaker",
  );

  const [restoredRiskEngine, restoredOracleState] = await Promise.all([
    lendingCore.riskEngine(),
    Promise.all([oracle.priceWad(), oracle.minPriceWad(), oracle.maxPriceWad(), oracle.maxPriceChangeBps()]),
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
          temporaryPrice: formatWad(temporaryOracleState[0]),
          temporaryMinPrice: formatWad(temporaryOracleState[1]),
          temporaryMaxPrice: formatWad(temporaryOracleState[2]),
          widenedBreakerBps: temporaryOracleState[3].toString(),
          restoredRiskEngine,
          restoredPrice: formatWad(restoredOracleState[0]),
          restoredMinPrice: formatWad(restoredOracleState[1]),
          restoredMaxPrice: formatWad(restoredOracleState[2]),
          restoredBreakerBps: restoredOracleState[3].toString(),
          riskEngineRestored: restoredRiskEngine.toLowerCase() === originalRiskEngine.toLowerCase(),
          oracleRestored: restoredOracleState[0] === originalOracleState.price,
          breakerRestored:
            restoredOracleState[1] === originalOracleState.minPriceWad
            && restoredOracleState[2] === originalOracleState.maxPriceWad
            && restoredOracleState[3] === originalOracleState.maxPriceChangeBps,
        },
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/liveRiskAdminSmoke.ts", main);
