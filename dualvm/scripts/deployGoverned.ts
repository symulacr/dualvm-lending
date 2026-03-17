import { deployGovernedSystem } from "../lib/deployment/deployGovernedSystem";
import { writeDeploymentManifest } from "../lib/deployment/manifestStore";
import { serializeDeploymentManifest } from "../lib/deployment/serializeManifest";
import type { HexAddress } from "../lib/shared/deploymentManifest";
import { LIVE_ROLE_EXECUTION_DELAYS_SECONDS, WAD } from "../lib/config/marketConfig";
import { runEntrypoint } from "../lib/runtime/entrypoint";

export async function main() {
  const emergencyAdmin = process.env.EMERGENCY_ADMIN;
  const riskAdmin = process.env.RISK_ADMIN;
  const treasuryOperator = process.env.TREASURY_OPERATOR;
  if (!emergencyAdmin || !riskAdmin || !treasuryOperator) {
    throw new Error("EMERGENCY_ADMIN, RISK_ADMIN, and TREASURY_OPERATOR are required for governed deployment");
  }

  const deployment = await deployGovernedSystem({
    treasury: process.env.TREASURY_ADDRESS,
    emergencyAdmin,
    riskAdmin,
    treasuryOperator,
    minter: process.env.MINTER,
    initialLiquidity: process.env.INITIAL_LIQUIDITY ? BigInt(process.env.INITIAL_LIQUIDITY) : undefined,
    oraclePriceWad: process.env.INITIAL_ORACLE_PRICE_WAD ? BigInt(process.env.INITIAL_ORACLE_PRICE_WAD) : undefined,
    oracleMaxAgeSeconds: process.env.ORACLE_MAX_AGE_SECONDS ? Number(process.env.ORACLE_MAX_AGE_SECONDS) : undefined,
    adminDelaySeconds: process.env.ADMIN_DELAY_SECONDS ? Number(process.env.ADMIN_DELAY_SECONDS) : 3600,
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
    governanceTokenSupply: process.env.GOVERNANCE_TOKEN_SUPPLY ? BigInt(process.env.GOVERNANCE_TOKEN_SUPPLY) : 1_000_000n * WAD,
    votingDelaySeconds: process.env.VOTING_DELAY_SECONDS ? Number(process.env.VOTING_DELAY_SECONDS) : 1,
    votingPeriodSeconds: process.env.VOTING_PERIOD_SECONDS ? Number(process.env.VOTING_PERIOD_SECONDS) : 300,
    timelockMinDelaySeconds: process.env.TIMELOCK_MIN_DELAY_SECONDS ? Number(process.env.TIMELOCK_MIN_DELAY_SECONDS) : 60,
    quorumNumerator: process.env.QUORUM_NUMERATOR ? Number(process.env.QUORUM_NUMERATOR) : 4,
  });

  const manifest = await serializeDeploymentManifest(deployment, {
    contracts: {
      governanceToken: (await deployment.governanceRoot.governanceToken.getAddress()) as HexAddress,
      governor: (await deployment.governanceRoot.governor.getAddress()) as HexAddress,
      governanceTimelock: (await deployment.governanceRoot.timelock.getAddress()) as HexAddress,
    },
  });
  const outPath = writeDeploymentManifest(manifest);
  console.log(`Deployment manifest written to ${outPath}`);
  console.log(JSON.stringify(manifest, null, 2));
}

runEntrypoint("scripts/deployGoverned.ts", main);
