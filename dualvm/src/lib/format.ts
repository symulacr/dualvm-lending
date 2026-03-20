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

/**
 * Format an on-chain health factor (18-decimal WAD) to a human-readable string.
 * Returns "∞" for effectively-infinite values (no debt).
 */
export function formatHealthFactor(value: string | bigint): string {
  const raw = typeof value === "string" ? BigInt(value) : value;
  if (raw === 0n) return "0.00";
  if (raw > 10n ** 30n) return "∞";
  return Number.parseFloat(formatUnits(raw, 18)).toFixed(2);
}

/**
 * Convert basis-points (e.g. 7500) to a percentage string (e.g. "75.00%").
 */
export function formatPercent(bps: string | number): string {
  const numeric = typeof bps === "string" ? Number(bps) : bps;
  return `${(numeric / 100).toFixed(2)}%`;
}
