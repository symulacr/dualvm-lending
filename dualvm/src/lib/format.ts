import { formatUnits } from "viem";

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatTokenAmount(value: bigint, decimals: number = 18): string {
  const normalized = Number.parseFloat(formatUnits(value, decimals));
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(normalized);
}

export function formatTimestamp(isoLike: string | number): string {
  const date = new Date(isoLike);
  return date.toLocaleString();
}
