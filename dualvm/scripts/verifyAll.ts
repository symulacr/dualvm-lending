import hre from "hardhat";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { POLKADOT_HUB_TESTNET } from "../lib/config/marketConfig";
import { runEntrypoint } from "../lib/runtime/entrypoint";

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

export async function main() {
  const manifest = loadDeploymentManifest();
  const authority = manifest.governance?.admin ?? manifest.roles.riskAdmin;
  const oracleConfig = manifest.config.oracle?.circuitBreaker;
  if (!oracleConfig) {
    throw new Error("Manifest is missing oracle circuit-breaker configuration");
  }

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
      BigInt(manifest.config.oraclePriceWad),
      manifest.config.oracleMaxAgeSeconds,
      BigInt(oracleConfig.minPriceWad),
      BigInt(oracleConfig.maxPriceWad),
      BigInt(oracleConfig.maxPriceChangeBps),
    ]),
  );
  results.push(
    await verify("PvmRiskEngine", manifest.contracts.riskEngine, [
      BigInt(manifest.config.riskEngine.baseRateBps),
      BigInt(manifest.config.riskEngine.slope1Bps),
      BigInt(manifest.config.riskEngine.slope2Bps),
      BigInt(manifest.config.riskEngine.kinkBps),
      BigInt(manifest.config.riskEngine.healthyMaxLtvBps),
      BigInt(manifest.config.riskEngine.stressedMaxLtvBps),
      BigInt(manifest.config.riskEngine.healthyLiquidationThresholdBps),
      BigInt(manifest.config.riskEngine.stressedLiquidationThresholdBps),
      BigInt(manifest.config.riskEngine.staleBorrowRatePenaltyBps),
      BigInt(manifest.config.riskEngine.stressedCollateralRatioBps),
    ]),
  );
  results.push(
    await verify("DebtPool", manifest.contracts.debtPool, [
      manifest.contracts.usdc,
      manifest.contracts.accessManager,
      BigInt(manifest.config.pool.supplyCap),
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
        borrowCap: BigInt(manifest.config.core.borrowCap),
        minBorrowAmount: BigInt(manifest.config.core.minBorrowAmount),
        reserveFactorBps: BigInt(manifest.config.core.reserveFactorBps),
        maxLtvBps: BigInt(manifest.config.core.maxLtvBps),
        liquidationThresholdBps: BigInt(manifest.config.core.liquidationThresholdBps),
        liquidationBonusBps: BigInt(manifest.config.core.liquidationBonusBps),
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

runEntrypoint("scripts/verifyAll.ts", main);
