import fs from "node:fs";
import path from "node:path";
import { JsonRpcProvider, Contract, formatUnits } from "ethers";

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "deployments", "polkadot-hub-testnet.json"), "utf8"));
const watchlist = JSON.parse(fs.readFileSync(path.join(process.cwd(), "ops", "watchlist.json"), "utf8"));

const provider = new JsonRpcProvider(manifest.polkadotHubTestnet.rpcUrl);
const lendingCore = new Contract(
  manifest.contracts.lendingCore,
  [
    "function currentDebt(address) view returns (uint256)",
    "function healthFactor(address) view returns (uint256)",
    "function availableToBorrow(address) view returns (uint256)",
    "function positions(address) view returns (uint256 collateralAmount, uint256 principalDebt, uint256 accruedInterest, uint256 borrowRateBps, uint256 maxLtvBpsSnapshot, uint256 liquidationThresholdBpsSnapshot, uint256 lastAccruedAt, uint256 lastRiskUpdateAt)"
  ],
  provider,
);
const oracle = new Contract(
  manifest.contracts.oracle,
  [
    "function priceWad() view returns (uint256)",
    "function isFresh() view returns (bool)"
  ],
  provider,
);

function formatHealthFactor(value) {
  if (value === 0n) return "0.00";
  if (value > 10n ** 30n) return "∞";
  return formatUnits(value, 18);
}

async function main() {
  const [oraclePrice, oracleFresh] = await Promise.all([oracle.priceWad(), oracle.isFresh()]);
  const results = [];
  for (const address of watchlist.addresses) {
    const [debt, healthFactor, availableToBorrow, position] = await Promise.all([
      lendingCore.currentDebt(address),
      lendingCore.healthFactor(address),
      lendingCore.availableToBorrow(address),
      lendingCore.positions(address),
    ]);
    results.push({
      address,
      collateralAmount: formatUnits(position.collateralAmount, 18),
      principalDebt: formatUnits(position.principalDebt, 18),
      accruedInterest: formatUnits(position.accruedInterest, 18),
      currentDebt: formatUnits(debt, 18),
      availableToBorrow: formatUnits(availableToBorrow, 18),
      healthFactor: formatHealthFactor(healthFactor),
      liquidatable: debt > 0n && healthFactor < 10n ** 18n,
    });
  }
  console.log(JSON.stringify({
    network: manifest.polkadotHubTestnet,
    oracle: {
      priceWad: oraclePrice.toString(),
      fresh: oracleFresh,
    },
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
