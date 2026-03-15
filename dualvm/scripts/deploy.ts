import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { deployDualVmSystem } from "./deploySystem";
import { LIVE_ROLE_EXECUTION_DELAYS_SECONDS } from "./marketConfig";

function bigintReplacer(_: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function main() {
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
  });

  const { network } = hre;
  const manifest = {
    generatedAt: new Date().toISOString(),
    networkName: network.name,
    polkadotHubTestnet: deployment.network,
    roles: deployment.roles,
    governance: deployment.governance,
    config: deployment.config,
    contracts: {
      accessManager: await deployment.contracts.accessManager.getAddress(),
      wpas: await deployment.contracts.wpas.getAddress(),
      usdc: await deployment.contracts.usdc.getAddress(),
      oracle: await deployment.contracts.oracle.getAddress(),
      riskEngine: await deployment.contracts.riskEngine.getAddress(),
      debtPool: await deployment.contracts.pool.getAddress(),
      lendingCore: await deployment.contracts.core.getAddress(),
    },
  };

  const outDir = path.join(process.cwd(), "deployments");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "polkadot-hub-testnet.json");
  writeFileSync(outPath, JSON.stringify(manifest, bigintReplacer, 2));

  console.log(`Deployment manifest written to ${outPath}`);
  console.log(JSON.stringify(manifest, bigintReplacer, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
