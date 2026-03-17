import hre from "hardhat";
import type { DeploymentManifest, HexAddress } from "../shared/deploymentManifest";

type Addr = { getAddress(): Promise<string> };
type BigCfg = Record<string, bigint>;

function stringifyRecord(rec: BigCfg): Record<string, string> {
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.toString()]));
}

async function resolveAddr(c: Addr): Promise<HexAddress> {
  return (await c.getAddress()) as HexAddress;
}

export async function serializeDeploymentManifest(
  deployment: { network: any; roles: any; governance: any; config: any; contracts: Record<string, Addr> },
  extras?: { contracts?: Record<string, string> },
): Promise<DeploymentManifest> {
  const cfg = deployment.config;
  const addrEntries = await Promise.all(
    Object.entries(deployment.contracts).map(async ([k, v]) => [k, await resolveAddr(v)] as const),
  );

  return {
    generatedAt: new Date().toISOString(),
    networkName: hre.network.name,
    polkadotHubTestnet: deployment.network,
    roles: deployment.roles,
    governance: deployment.governance,
    config: {
      adminDelaySeconds: cfg.adminDelaySeconds,
      oracleMaxAgeSeconds: cfg.oracleMaxAgeSeconds,
      oraclePriceWad: cfg.oraclePriceWad.toString(),
      initialLiquidity: cfg.initialLiquidity.toString(),
      pool: { supplyCap: cfg.pool.supplyCap.toString(), initialLiquidity: cfg.pool.initialLiquidity.toString() },
      core: stringifyRecord(cfg.core) as DeploymentManifest["config"]["core"],
      riskEngine: stringifyRecord(cfg.riskEngine),
      oracle: cfg.oracle ? { circuitBreaker: stringifyRecord(cfg.oracle.circuitBreaker) as any } : undefined,
    },
    contracts: {
      ...Object.fromEntries(addrEntries),
      ...((extras?.contracts ?? {}) as Record<string, HexAddress>),
    } as unknown as DeploymentManifest["contracts"],
  };
}
