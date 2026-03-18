import { MetricCard } from "../MetricCard";
import type { MarketSnapshot } from "../../lib/readModel";

interface ReadLayerSectionProps {
  readStatus: string;
  snapshot: MarketSnapshot | null;
}

export function ReadLayerSection({ readStatus, snapshot }: ReadLayerSectionProps) {
  return (
    <section className="panel-card">
      <div className="section-header section-header-spread">
        <h2>Read layer</h2>
        <p className="helper-text">{readStatus}</p>
      </div>
      {snapshot ? (
        <div className="metric-grid">
          <MetricCard label="Pool total assets" value={snapshot.totalAssets} />
          <MetricCard label="Available liquidity" value={snapshot.availableLiquidity} />
          <MetricCard label="Outstanding principal" value={snapshot.outstandingPrincipal} />
          <MetricCard label="Reserve balance" value={snapshot.reserveBalance} />
          <MetricCard label="Utilization" value={snapshot.utilization} />
          <MetricCard label="Borrow cap" value={snapshot.borrowCap} />
          <MetricCard label="Minimum borrow" value={snapshot.minBorrowAmount} />
          <MetricCard label="Liquidation bonus" value={snapshot.liquidationBonusBps} />
          <MetricCard label="Oracle price" value={snapshot.oraclePrice} />
          <MetricCard label="Oracle freshness" value={snapshot.oracleFresh} />
          <MetricCard label="Oracle max age" value={snapshot.oracleMaxAge} />
          <MetricCard label="Oracle last update" value={snapshot.oracleLastUpdated} />
          <MetricCard label="Oracle min price" value={snapshot.oracleMinPrice} />
          <MetricCard label="Oracle max price" value={snapshot.oracleMaxPrice} />
          <MetricCard label="Oracle max move" value={snapshot.oracleMaxPriceChange} />
          {snapshot.activeVersionId ? (
            <MetricCard label="Active market version" value={snapshot.activeVersionId} />
          ) : null}
          {snapshot.latestVersionId ? (
            <MetricCard label="Latest market version" value={snapshot.latestVersionId} />
          ) : null}
        </div>
      ) : (
        <div className="empty-state"><p>Live data not loaded. Refresh to retry.</p></div>
      )}
    </section>
  );
}
