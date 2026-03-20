import { useMemo } from "react";
import { deploymentManifest } from "../lib/manifest";
import type { MarketSnapshot } from "../lib/readModel/types";

const explorerBase = deploymentManifest.polkadotHubTestnet.explorerUrl.replace(/\/$/, "");

function dotColor(label: string): string {
  if (label.toLowerCase().includes("collateral")) return "var(--c-success)";
  if (label.toLowerCase().includes("borrow")) return "var(--c-accent)";
  if (label.toLowerCase().includes("repaid")) return "var(--c-text-tertiary)";
  if (label.toLowerCase().includes("liquidat")) return "var(--c-warning)";
  return "var(--c-text-tertiary)";
}

export function RecentActivityFeed({ snapshot, isLoading, address }: { snapshot: MarketSnapshot | null; isLoading: boolean; address?: string }) {
  const loading = isLoading && !snapshot;
  const allItems = snapshot?.recentActivity ?? [];
  const window = snapshot?.recentActivityWindow ?? "";

  const items = useMemo(() => {
    if (!address) return allItems.slice(0, 10);
    const lowerAddr = address.toLowerCase();
    return allItems
      .filter((item) => item.involvedAddresses?.some((a) => a === lowerAddr) ?? false)
      .slice(0, 10);
  }, [allItems, address]);

  return (
    <section>
      <div className="section-eyebrow">
        Recent activity
        {window && <span style={{ fontWeight: "var(--fw-regular)", textTransform: "none", letterSpacing: 0 }}>{window}</span>}
      </div>

      {snapshot?.recentActivityWarning && (
        <div className="text-warn-sm">{snapshot.recentActivityWarning}</div>
      )}
      {snapshot?.recentActivitySource === "snapshot" && (
        <div className="text-warn-sm">Showing cached snapshot — live query failed.</div>
      )}

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[80, 65, 50].map((w, i) => (
            <div key={i} className="skeleton" style={{ height: 12, width: `${w}%`, borderRadius: 4 }} />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="empty-text">
          {address ? "No activity for your wallet in this block range." : "No activity in the scanned block range."}
        </div>
      )}

      {!loading && items.map((item) => (
        <div className="activity-row" key={item.txHash}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor(item.label), flexShrink: 0 }} />
          <span className="activity-event">{item.label}</span>
          <span className="activity-detail" style={{ flex: 1 }}>{item.detail}</span>
          <span className="activity-block">{item.blockNumber}</span>
          <a href={`${explorerBase}/tx/${item.txHash}`} target="_blank" rel="noreferrer" className="activity-link">↗</a>
        </div>
      ))}
    </section>
  );
}
