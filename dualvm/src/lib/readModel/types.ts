import type { RecentActivity } from "../recentActivity";

export interface ObserverSnapshot {
  address: string;
  currentDebt: string;
  availableToBorrow: string;
  healthFactor: string;
  /** Numeric health factor for color coding (null if no position or infinite) */
  healthFactorNumeric: number | null;
  /** Liquidation price in USDC-test per WPAS (null if no position) */
  liquidationPrice: string | null;
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
