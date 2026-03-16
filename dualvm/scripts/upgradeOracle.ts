import hre from "hardhat";
import { managedSetOracle, type ManagedCallContext } from "../lib/ops/managedAccess";
import { ROLE_IDS, ORACLE_CIRCUIT_BREAKER_DEFAULTS } from "../lib/config/marketConfig";
import { loadDeploymentManifest, writeDeploymentManifest } from "../lib/deployment/manifestStore";
import { requireEnv } from "../lib/runtime/env";
import { waitForTransaction } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

export async function main() {
  const manifest = loadDeploymentManifest();
  const provider = ethers.provider;

  const admin = new ethers.Wallet(requireEnv("ADMIN_PRIVATE_KEY"), provider);
  const riskAdmin = new ethers.Wallet(requireEnv("RISK_PRIVATE_KEY"), provider);
  const accessManagerAdmin = (await ethers.getContractFactory("DualVMAccessManager", admin)).attach(manifest.contracts.accessManager) as any;
  const accessManagerRisk = accessManagerAdmin.connect(riskAdmin) as any;
  const oldOracle = (await ethers.getContractFactory("ManualOracle", admin)).attach(manifest.contracts.oracle) as any;
  const lendingCore = (await ethers.getContractFactory("LendingCore", admin)).attach(manifest.contracts.lendingCore) as any;

  const [currentPrice, currentMaxAge] = await Promise.all([oldOracle.priceWad(), oldOracle.maxAge()]);
  const oracleFactory = await ethers.getContractFactory("ManualOracle", admin);
  const newOracle = await oracleFactory.deploy(
    manifest.contracts.accessManager,
    currentPrice,
    currentMaxAge,
    ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
    ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
    ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps,
  );
  await newOracle.waitForDeployment();

  const setPriceSelector = newOracle.interface.getFunction("setPrice")?.selector;
  const setMaxAgeSelector = newOracle.interface.getFunction("setMaxAge")?.selector;
  const setCircuitBreakerSelector = newOracle.interface.getFunction("setCircuitBreaker")?.selector;
  const pauseSelector = newOracle.interface.getFunction("pause")?.selector;
  const unpauseSelector = newOracle.interface.getFunction("unpause")?.selector;
  if (!setPriceSelector || !setMaxAgeSelector || !setCircuitBreakerSelector || !pauseSelector || !unpauseSelector) {
    throw new Error("Failed to resolve hardened oracle selectors");
  }

  await waitForTransaction(
    accessManagerAdmin.setTargetFunctionRole(
      await newOracle.getAddress(),
      [setPriceSelector, setMaxAgeSelector, setCircuitBreakerSelector],
      ROLE_IDS.RISK_ADMIN,
    ),
    "configure oracle risk role",
  );
  await waitForTransaction(
    accessManagerAdmin.setTargetFunctionRole(
      await newOracle.getAddress(),
      [pauseSelector, unpauseSelector],
      ROLE_IDS.EMERGENCY,
    ),
    "configure oracle emergency role",
  );
  await waitForTransaction(
    accessManagerAdmin.setTargetAdminDelay(await newOracle.getAddress(), manifest.config.adminDelaySeconds),
    "set oracle admin delay",
  );

  const managedRiskContext: ManagedCallContext = {
    accessManager: accessManagerRisk,
    signer: riskAdmin,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.riskAdmin ?? 0,
  };
  await managedSetOracle(managedRiskContext, lendingCore, await newOracle.getAddress(), "set hardened oracle on lending core");

  manifest.contracts.oracle = await newOracle.getAddress();
  manifest.config.oracle = {
    ...(manifest.config.oracle ?? {}),
    circuitBreaker: {
      minPriceWad: ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad.toString(),
      maxPriceWad: ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad.toString(),
      maxPriceChangeBps: ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps.toString(),
    },
  };
  const manifestPath = writeDeploymentManifest(manifest);

  console.log(JSON.stringify({ newOracle: await newOracle.getAddress(), manifest: manifestPath }, null, 2));
}

runEntrypoint("scripts/upgradeOracle.ts", main);
