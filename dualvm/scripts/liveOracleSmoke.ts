import {
  managedSetOracleCircuitBreaker,
  managedSetOraclePrice,
  type ManagedCallContext,
} from "../lib/ops/managedAccess";
import { WAD } from "../lib/config/marketConfig";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { loadActors } from "../lib/runtime/actors";
import { attachManifestContract } from "../lib/runtime/contracts";
import { formatWad } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

export async function main() {
  const manifest = loadDeploymentManifest();
  const { riskAdmin } = loadActors(["riskAdmin"] as const);

  const [accessManager, oracle] = await Promise.all([
    attachManifestContract(manifest, "accessManager", "DualVMAccessManager", riskAdmin),
    attachManifestContract(manifest, "oracle", "ManualOracle", riskAdmin),
  ]);
  const managedRiskContext: ManagedCallContext = {
    accessManager,
    signer: riskAdmin,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.riskAdmin ?? 0,
  };

  const before = {
    price: await oracle.priceWad(),
    minPriceWad: await oracle.minPriceWad(),
    maxPriceWad: await oracle.maxPriceWad(),
    maxPriceChangeBps: await oracle.maxPriceChangeBps(),
  };

  await managedSetOracleCircuitBreaker(
    managedRiskContext,
    oracle,
    1n * WAD,
    20_000n * WAD,
    10_000n,
    "oracle smoke widen circuit breaker",
  );
  await managedSetOraclePrice(managedRiskContext, oracle, 950n * WAD, "oracle smoke set intermediate price");
  await managedSetOraclePrice(managedRiskContext, oracle, 1_000n * WAD, "oracle smoke restore baseline price");
  await managedSetOracleCircuitBreaker(
    managedRiskContext,
    oracle,
    before.minPriceWad,
    before.maxPriceWad,
    before.maxPriceChangeBps,
    "oracle smoke restore circuit breaker",
  );

  const after = {
    price: await oracle.priceWad(),
    minPriceWad: await oracle.minPriceWad(),
    maxPriceWad: await oracle.maxPriceWad(),
    maxPriceChangeBps: await oracle.maxPriceChangeBps(),
  };

  console.log(
    JSON.stringify(
      {
        riskAdmin: riskAdmin.address,
        governance: manifest.governance,
        checks: {
          beforePrice: formatWad(before.price),
          beforeMinPrice: formatWad(before.minPriceWad),
          beforeMaxPrice: formatWad(before.maxPriceWad),
          beforeMaxPriceChangeBps: before.maxPriceChangeBps.toString(),
          afterPrice: formatWad(after.price),
          afterMinPrice: formatWad(after.minPriceWad),
          afterMaxPrice: formatWad(after.maxPriceWad),
          afterMaxPriceChangeBps: after.maxPriceChangeBps.toString(),
          restoredPrice: after.price === before.price,
          restoredCircuitBreaker:
            after.minPriceWad === before.minPriceWad
            && after.maxPriceWad === before.maxPriceWad
            && after.maxPriceChangeBps === before.maxPriceChangeBps,
        },
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/liveOracleSmoke.ts", main);
