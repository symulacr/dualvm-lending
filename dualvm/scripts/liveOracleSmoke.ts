import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { executeManagedCall } from "./accessManagerOps";
import { ORACLE_CIRCUIT_BREAKER_DEFAULTS, WAD } from "./marketConfig";

const { ethers } = hre;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
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

  const riskAdmin = new ethers.Wallet(requireEnv("RISK_PRIVATE_KEY"), provider);
  const accessManager = (await ethers.getContractFactory("DualVMAccessManager", riskAdmin)).attach(manifest.contracts.accessManager) as any;
  const oracle = (await ethers.getContractFactory("ManualOracle", riskAdmin)).attach(manifest.contracts.oracle) as any;
  const riskDelay = manifest.governance?.executionDelaySeconds?.riskAdmin ?? 0;

  const before = {
    price: await oracle.priceWad(),
    maxPriceChangeBps: await oracle.maxPriceChangeBps(),
  };

  await executeManagedCall(
    accessManager,
    riskAdmin,
    oracle,
    "setCircuitBreaker",
    [1n * WAD, 20_000n * WAD, 10_000n],
    "oracle smoke widen circuit breaker",
    riskDelay,
  );
  await executeManagedCall(
    accessManager,
    riskAdmin,
    oracle,
    "setPrice",
    [950n * WAD],
    "oracle smoke set intermediate price",
    riskDelay,
  );
  await executeManagedCall(
    accessManager,
    riskAdmin,
    oracle,
    "setPrice",
    [1_000n * WAD],
    "oracle smoke restore baseline price",
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
    "oracle smoke restore circuit breaker",
    riskDelay,
  );

  const after = {
    price: await oracle.priceWad(),
    maxPriceChangeBps: await oracle.maxPriceChangeBps(),
  };

  console.log(
    JSON.stringify(
      {
        riskAdmin: riskAdmin.address,
        governance: manifest.governance,
        checks: {
          beforePrice: formatUnits(before.price),
          beforeMaxPriceChangeBps: before.maxPriceChangeBps.toString(),
          afterPrice: formatUnits(after.price),
          afterMaxPriceChangeBps: after.maxPriceChangeBps.toString(),
          restoredPrice: after.price === 1_000n * WAD,
          restoredCircuitBreaker: after.maxPriceChangeBps === ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps,
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
