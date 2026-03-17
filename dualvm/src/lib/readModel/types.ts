import type { RecentActivity } from "../recentActivity";

export interface ObserverSnapshot {
  address: string;
  currentDebt: string;
  availableToBorrow: string;
  healthFactor: string;
}

export interface MarketSnapshot {
  totalAssets: string;
  availableLiquidity: string;
  outstandingPrincipal: string;
  reserveBalance: string;
  utilization: string;
  borrowCap: string;
  minBorrowAmount: string;
  liquidationBonusBps: string;
  oraclePrice: string;
  oracleFresh: string;
  oracleMaxAge: string;
  oracleLastUpdated: string;
  oracleMinPrice: string;
  oracleMaxPrice: string;
  oracleMaxPriceChange: string;
  activeVersionId: string | null;
  latestVersionId: string | null;
  observer: ObserverSnapshot | null;
  recentActivity: RecentActivity[];
  recentActivitySource: "live" | "snapshot";
  recentActivityWindow: string;
  recentActivityWarning: string | null;
}
