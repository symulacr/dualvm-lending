import { managedSetOracleCircuitBreaker, managedSetOraclePrice } from "../lib/ops/managedAccess";
import { WAD } from "../lib/config/marketConfig";
import { createSmokeContext, buildManagedContext } from "../lib/runtime/smokeContext";
import { formatWad } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

export async function main() {
  const { manifest, actors, attach } = await createSmokeContext(["riskAdmin"] as const);
  const { riskAdmin } = actors;

  const [accessManager, oracle] = await Promise.all([
    attach("accessManager", "DualVMAccessManager", riskAdmin),
    attach("oracle", "ManualOracle", riskAdmin),
  ]);
  const ctx = buildManagedContext(manifest, accessManager, riskAdmin, "riskAdmin");

  const before = {
    price: await oracle.priceWad(),
    minPriceWad: await oracle.minPriceWad(),
    maxPriceWad: await oracle.maxPriceWad(),
    maxPriceChangeBps: await oracle.maxPriceChangeBps(),
  };

  await managedSetOracleCircuitBreaker(ctx, oracle, 1n * WAD, 20_000n * WAD, 10_000n, "oracle smoke widen circuit breaker");
  await managedSetOraclePrice(ctx, oracle, 950n * WAD, "oracle smoke set intermediate price");
  await managedSetOraclePrice(ctx, oracle, 1_000n * WAD, "oracle smoke restore baseline price");
  await managedSetOracleCircuitBreaker(ctx, oracle, before.minPriceWad, before.maxPriceWad, before.maxPriceChangeBps, "oracle smoke restore circuit breaker");

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
