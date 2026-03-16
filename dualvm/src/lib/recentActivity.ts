export interface RecentActivity {
  label: string;
  detail: string;
  txHash: string;
  blockNumber: string;
}

export interface ParsedFallbackRecentActivity {
  generatedAt: string;
  fromBlock: string;
  toBlock: string;
  items: RecentActivity[];
}

export interface RecentActivityFeed {
  source: "live" | "snapshot";
  fromBlock: string;
  toBlock: string;
  generatedAt?: string;
  warning: string | null;
  items: RecentActivity[];
}

export function isRecentActivity(value: unknown): value is RecentActivity {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.label === "string"
    && typeof record.detail === "string"
    && typeof record.txHash === "string"
    && typeof record.blockNumber === "string"
  );
}

export function parseFallbackRecentActivity(value: unknown): ParsedFallbackRecentActivity {
  if (typeof value !== "object" || value === null) {
    throw new Error("Recent-events snapshot is malformed");
  }

  const record = value as Record<string, unknown>;
  if (typeof record.generatedAt !== "string") {
    throw new Error("Recent-events snapshot is missing generatedAt");
  }
  if (typeof record.fromBlock !== "number") {
    throw new Error("Recent-events snapshot is missing numeric fromBlock");
  }
  if (typeof record.toBlock !== "number") {
    throw new Error("Recent-events snapshot is missing numeric toBlock");
  }
  if (!Array.isArray(record.items) || !record.items.every(isRecentActivity)) {
    throw new Error("Recent-events snapshot contains invalid activity rows");
  }

  return {
    generatedAt: record.generatedAt,
    fromBlock: String(record.fromBlock),
    toBlock: String(record.toBlock),
    items: record.items,
  };
}

export function formatRecentActivityWindow(fromBlock: string, toBlock: string) {
  return `Blocks ${fromBlock} → ${toBlock}`;
}
