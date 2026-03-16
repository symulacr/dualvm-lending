import fs from "node:fs";
import path from "node:path";
import { JsonRpcProvider, Contract } from "ethers";

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "deployments", "polkadot-hub-testnet-canonical.json"), "utf8"));
const provider = new JsonRpcProvider(manifest.polkadotHubTestnet.rpcUrl);
const lendingCore = new Contract(
  manifest.contracts.lendingCore,
  [
    "event CollateralDeposited(address indexed account, uint256 amount)",
    "event Borrowed(address indexed account, uint256 amount, uint256 borrowRateBps)",
    "event Repaid(address indexed account, uint256 amount, uint256 principalPaid, uint256 interestPaid)",
    "event Liquidated(address indexed borrower, address indexed liquidator, uint256 repaid, uint256 collateralSeized, uint256 badDebtWrittenOff)"
  ],
  provider,
);

function short(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatAmount(value) {
  return (Number(value) / 1e18).toFixed(2);
}

async function main() {
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = latestBlock > 5000 ? latestBlock - 5000 : 0;
  const events = [];

  const collateralEvents = await lendingCore.queryFilter(lendingCore.filters.CollateralDeposited(), fromBlock, latestBlock);
  for (const event of collateralEvents) {
    events.push({
      label: "Collateral deposited",
      detail: `${short(event.args.account)} deposited ${formatAmount(event.args.amount)} WPAS`,
      txHash: event.transactionHash,
      blockNumber: String(event.blockNumber),
    });
  }

  const borrowedEvents = await lendingCore.queryFilter(lendingCore.filters.Borrowed(), fromBlock, latestBlock);
  for (const event of borrowedEvents) {
    events.push({
      label: "Borrowed",
      detail: `${short(event.args.account)} borrowed ${formatAmount(event.args.amount)} USDC-test`,
      txHash: event.transactionHash,
      blockNumber: String(event.blockNumber),
    });
  }

  const repaidEvents = await lendingCore.queryFilter(lendingCore.filters.Repaid(), fromBlock, latestBlock);
  for (const event of repaidEvents) {
    events.push({
      label: "Repaid",
      detail: `${short(event.args.account)} repaid ${formatAmount(event.args.amount)} USDC-test`,
      txHash: event.transactionHash,
      blockNumber: String(event.blockNumber),
    });
  }

  const liquidatedEvents = await lendingCore.queryFilter(lendingCore.filters.Liquidated(), fromBlock, latestBlock);
  for (const event of liquidatedEvents) {
    events.push({
      label: "Liquidated",
      detail: `${short(event.args.borrower)} liquidated by ${short(event.args.liquidator)}`,
      txHash: event.transactionHash,
      blockNumber: String(event.blockNumber),
    });
  }

  events.sort((left, right) => Number(right.blockNumber) - Number(left.blockNumber));

  const output = {
    generatedAt: new Date().toISOString(),
    fromBlock,
    toBlock: latestBlock,
    items: events.slice(0, 20),
  };

  const outPath = path.join(process.cwd(), "deployments", "polkadot-hub-testnet-recent-events.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ outPath, count: output.items.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
