import { formatUnits } from "viem";

export function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatTokenAmount(value: bigint, decimals = 18) {
  const normalized = Number.parseFloat(formatUnits(value, decimals));
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(normalized);
}

export function formatTimestamp(isoLike: string | number) {
  const date = new Date(isoLike);
  return date.toLocaleString();
}
