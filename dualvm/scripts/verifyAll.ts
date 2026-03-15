import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import {
  CORE_DEFAULTS,
  ORACLE_CIRCUIT_BREAKER_DEFAULTS,
  ORACLE_DEFAULTS,
  POLKADOT_HUB_TESTNET,
  POOL_DEFAULTS,
  RISK_ENGINE_DEFAULTS,
} from "./marketConfig";

async function verify(name: string, address: string, constructorArguments: unknown[], contract?: string) {
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
      ...(contract ? { contract } : {}),
    });
    return { name, address, status: "verified" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Already Verified") || message.includes("already verified")) {
      return { name, address, status: "already-verified" as const };
    }
    return { name, address, status: "failed" as const, error: message };
  }
}

async function main() {
  const manifestPath = path.join(process.cwd(), "deployments", "polkadot-hub-testnet.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const authority = manifest.governance?.admin ?? manifest.roles.riskAdmin;

  const results = [];
  results.push(
    await verify(
      "DualVMAccessManager",
      manifest.contracts.accessManager,
      [authority],
      "contracts/DualVMAccessManager.sol:DualVMAccessManager",
    ),
  );
  results.push(await verify("WPAS", manifest.contracts.wpas, []));
  results.push(await verify("USDCMock", manifest.contracts.usdc, [manifest.contracts.accessManager]));
  results.push(
    await verify("ManualOracle", manifest.contracts.oracle, [
      manifest.contracts.accessManager,
      BigInt(ORACLE_DEFAULTS.initialPriceWad),
      ORACLE_DEFAULTS.maxAgeSeconds,
      BigInt(ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad),
      BigInt(ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad),
      BigInt(ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps),
    ]),
  );
  results.push(
    await verify("PvmRiskEngine", manifest.contracts.riskEngine, [
      BigInt(RISK_ENGINE_DEFAULTS.baseRateBps),
      BigInt(RISK_ENGINE_DEFAULTS.slope1Bps),
      BigInt(RISK_ENGINE_DEFAULTS.slope2Bps),
      BigInt(RISK_ENGINE_DEFAULTS.kinkBps),
      BigInt(RISK_ENGINE_DEFAULTS.healthyMaxLtvBps),
      BigInt(RISK_ENGINE_DEFAULTS.stressedMaxLtvBps),
      BigInt(RISK_ENGINE_DEFAULTS.healthyLiquidationThresholdBps),
      BigInt(RISK_ENGINE_DEFAULTS.stressedLiquidationThresholdBps),
      BigInt(RISK_ENGINE_DEFAULTS.staleBorrowRatePenaltyBps),
      BigInt(RISK_ENGINE_DEFAULTS.stressedCollateralRatioBps),
    ]),
  );
  results.push(
    await verify("DebtPool", manifest.contracts.debtPool, [
      manifest.contracts.usdc,
      manifest.contracts.accessManager,
      BigInt(POOL_DEFAULTS.supplyCap),
    ]),
  );
  results.push(
    await verify("LendingCore", manifest.contracts.lendingCore, [
      manifest.contracts.accessManager,
      manifest.contracts.wpas,
      manifest.contracts.usdc,
      manifest.contracts.debtPool,
      manifest.contracts.oracle,
      manifest.contracts.riskEngine,
      manifest.roles.treasury,
      {
        borrowCap: BigInt(CORE_DEFAULTS.borrowCap),
        minBorrowAmount: BigInt(CORE_DEFAULTS.minBorrowAmount),
        reserveFactorBps: BigInt(CORE_DEFAULTS.reserveFactorBps),
        maxLtvBps: BigInt(CORE_DEFAULTS.maxLtvBps),
        liquidationThresholdBps: BigInt(CORE_DEFAULTS.liquidationThresholdBps),
        liquidationBonusBps: BigInt(CORE_DEFAULTS.liquidationBonusBps),
      },
    ]),
  );

  console.log(
    JSON.stringify(
      {
        network: POLKADOT_HUB_TESTNET,
        results,
      },
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
