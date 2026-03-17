import { deployDualVmSystem } from "../lib/deployment/deploySystem";
import { writeDeploymentManifest } from "../lib/deployment/manifestStore";
import { serializeDeploymentManifest } from "../lib/deployment/serializeManifest";
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

  const manifest = await serializeDeploymentManifest(deployment);
  const outPath = writeDeploymentManifest(manifest);
  console.log(`Deployment manifest written to ${outPath}`);
  console.log(JSON.stringify(manifest, null, 2));
}

runEntrypoint("scripts/deploy.ts", main);
