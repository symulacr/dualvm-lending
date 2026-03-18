import type { MarketSnapshot } from "../lib/readModel";

interface CompactMarketSnapshotProps {
  snapshot: MarketSnapshot | null;
  isLoading: boolean;
}

export function CompactMarketSnapshot({ snapshot, isLoading }: CompactMarketSnapshotProps) {
  if (!snapshot && !isLoading) return null;

  const items = snapshot
    ? [
        { label: "Pool TVL", value: snapshot.totalAssets },
        { label: "Utilization", value: snapshot.utilization },
        { label: "Oracle price", value: snapshot.oraclePrice },
      ]
    : [];

  return (
    <div className="compact-snapshot">
      {isLoading && !snapshot ? (
        <span className="compact-snapshot-label">Loading market data…</span>
      ) : (
        items.map((item, idx) => (
          <div key={item.label} style={{ display: "contents" }}>
            {idx > 0 && <div className="compact-snapshot-divider" />}
            <div className="compact-snapshot-item">
              <span className="compact-snapshot-label">{item.label}</span>
              <span className="compact-snapshot-value">{item.value}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
