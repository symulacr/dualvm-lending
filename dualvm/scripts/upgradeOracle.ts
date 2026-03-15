import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { executeManagedCall } from "./accessManagerOps";
import { ORACLE_CIRCUIT_BREAKER_DEFAULTS } from "./marketConfig";

const { ethers } = hre;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function bigintReplacer(_: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
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

  await waitFor(
    accessManagerAdmin.setTargetFunctionRole(
      await newOracle.getAddress(),
      [setPriceSelector, setMaxAgeSelector, setCircuitBreakerSelector],
      2,
    ),
    "configure oracle risk role",
  );
  await waitFor(
    accessManagerAdmin.setTargetFunctionRole(await newOracle.getAddress(), [pauseSelector, unpauseSelector], 1),
    "configure oracle emergency role",
  );
  await waitFor(
    accessManagerAdmin.setTargetAdminDelay(await newOracle.getAddress(), manifest.config.adminDelaySeconds),
    "set oracle admin delay",
  );

  const riskDelay = manifest.governance?.executionDelaySeconds?.riskAdmin ?? 0;
  await executeManagedCall(
    accessManagerRisk,
    riskAdmin,
    lendingCore,
    "setOracle",
    [await newOracle.getAddress()],
    "set hardened oracle on lending core",
    riskDelay,
  );

  manifest.contracts.oracle = await newOracle.getAddress();
  manifest.config.oracle = {
    ...(manifest.config.oracle ?? {}),
    circuitBreaker: ORACLE_CIRCUIT_BREAKER_DEFAULTS,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, bigintReplacer, 2));

  console.log(JSON.stringify({ newOracle: await newOracle.getAddress(), manifest: manifestPath }, bigintReplacer, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
