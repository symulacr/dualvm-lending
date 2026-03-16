import hre from "hardhat";
import { deployDualVmSystem } from "../lib/deployment/deploySystem";
import { writeDeploymentManifest } from "../lib/deployment/manifestStore";
import { type DeploymentManifest, type HexAddress } from "../lib/shared/deploymentManifest";
import { LIVE_ROLE_EXECUTION_DELAYS_SECONDS } from "../lib/config/marketConfig";
import { runEntrypoint } from "../lib/runtime/entrypoint";

export async function main() {
  const deployment = await deployDualVmSystem({
    treasury: process.env.TREASURY_ADDRESS,
    emergencyAdmin: process.env.EMERGENCY_ADMIN,
    riskAdmin: process.env.RISK_ADMIN,
    treasuryOperator: process.env.TREASURY_OPERATOR,
    minter: process.env.MINTER,
    initialLiquidity: process.env.INITIAL_LIQUIDITY ? BigInt(process.env.INITIAL_LIQUIDITY) : undefined,
    oraclePriceWad: process.env.INITIAL_ORACLE_PRICE_WAD ? BigInt(process.env.INITIAL_ORACLE_PRICE_WAD) : undefined,
    oracleMaxAgeSeconds: process.env.ORACLE_MAX_AGE_SECONDS ? Number(process.env.ORACLE_MAX_AGE_SECONDS) : undefined,
    adminDelaySeconds: process.env.ADMIN_DELAY_SECONDS ? Number(process.env.ADMIN_DELAY_SECONDS) : undefined,
    emergencyExecutionDelaySeconds: process.env.EMERGENCY_EXECUTION_DELAY_SECONDS
      ? Number(process.env.EMERGENCY_EXECUTION_DELAY_SECONDS)
      : LIVE_ROLE_EXECUTION_DELAYS_SECONDS.emergency,
    riskAdminExecutionDelaySeconds: process.env.RISK_ADMIN_EXECUTION_DELAY_SECONDS
      ? Number(process.env.RISK_ADMIN_EXECUTION_DELAY_SECONDS)
      : LIVE_ROLE_EXECUTION_DELAYS_SECONDS.riskAdmin,
    treasuryExecutionDelaySeconds: process.env.TREASURY_EXECUTION_DELAY_SECONDS
      ? Number(process.env.TREASURY_EXECUTION_DELAY_SECONDS)
      : LIVE_ROLE_EXECUTION_DELAYS_SECONDS.treasury,
    minterExecutionDelaySeconds: process.env.MINTER_EXECUTION_DELAY_SECONDS
      ? Number(process.env.MINTER_EXECUTION_DELAY_SECONDS)
      : LIVE_ROLE_EXECUTION_DELAYS_SECONDS.minter,
    riskQuoteEngineAddress: process.env.RISK_QUOTE_ENGINE_ADDRESS,
  });

  const { network } = hre;
  const manifest: DeploymentManifest = {
    generatedAt: new Date().toISOString(),
    networkName: network.name,
    polkadotHubTestnet: deployment.network,
    roles: deployment.roles as DeploymentManifest["roles"],
    governance: deployment.governance as DeploymentManifest["governance"],
    config: {
      ...deployment.config,
      oraclePriceWad: deployment.config.oraclePriceWad.toString(),
      initialLiquidity: deployment.config.initialLiquidity.toString(),
      pool: {
        supplyCap: deployment.config.pool.supplyCap.toString(),
        initialLiquidity: deployment.config.pool.initialLiquidity.toString(),
      },
      core: {
        borrowCap: deployment.config.core.borrowCap.toString(),
        minBorrowAmount: deployment.config.core.minBorrowAmount.toString(),
        reserveFactorBps: deployment.config.core.reserveFactorBps.toString(),
        maxLtvBps: deployment.config.core.maxLtvBps.toString(),
        liquidationThresholdBps: deployment.config.core.liquidationThresholdBps.toString(),
        liquidationBonusBps: deployment.config.core.liquidationBonusBps.toString(),
      },
      riskEngine: Object.fromEntries(
        Object.entries(deployment.config.riskEngine).map(([key, value]) => [key, value.toString()]),
      ),
      oracle: deployment.config.oracle
        ? {
            circuitBreaker: {
              minPriceWad: deployment.config.oracle.circuitBreaker.minPriceWad.toString(),
              maxPriceWad: deployment.config.oracle.circuitBreaker.maxPriceWad.toString(),
              maxPriceChangeBps: deployment.config.oracle.circuitBreaker.maxPriceChangeBps.toString(),
            },
          }
        : undefined,
    },
    contracts: {
      accessManager: (await deployment.contracts.accessManager.getAddress()) as HexAddress,
      wpas: (await deployment.contracts.wpas.getAddress()) as HexAddress,
      usdc: (await deployment.contracts.usdc.getAddress()) as HexAddress,
      oracle: (await deployment.contracts.oracle.getAddress()) as HexAddress,
      riskEngine: (await deployment.contracts.riskEngine.getAddress()) as HexAddress,
      quoteEngine: (await deployment.contracts.quoteEngine.getAddress()) as HexAddress,
      marketRegistry: (await deployment.contracts.marketRegistry.getAddress()) as HexAddress,
      debtPool: (await deployment.contracts.debtPool.getAddress()) as HexAddress,
      lendingCore: (await deployment.contracts.lendingCore.getAddress()) as HexAddress,
    },
  };

  const outPath = writeDeploymentManifest(manifest);
  console.log(`Deployment manifest written to ${outPath}`);
  console.log(JSON.stringify(manifest, null, 2));
}

runEntrypoint("scripts/deploy.ts", main);
