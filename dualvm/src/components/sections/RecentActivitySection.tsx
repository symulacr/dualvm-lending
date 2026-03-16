import { formatAddress } from "../../lib/format";
import type { MarketSnapshot } from "../../lib/readModel";

interface RecentActivitySectionProps {
  snapshot: MarketSnapshot | null;
  explorerUrl: string;
}

export function RecentActivitySection({ snapshot, explorerUrl }: RecentActivitySectionProps) {
  return (
    <section className="panel-card">
      <div className="section-header section-header-spread">
        <h2>Recent activity</h2>
        <p className="helper-text">
          {snapshot?.recentActivitySource === "snapshot"
            ? `Showing snapshot fallback. ${snapshot.recentActivityWarning ?? "Live RPC activity query is currently unavailable."}`
            : `Latest LendingCore events from ${snapshot?.recentActivityWindow ?? "the recent block window"}.`}
        </p>
      </div>
      {snapshot?.recentActivitySource === "snapshot" ? (
        <div className="empty-state">
          <p>{snapshot.recentActivityWarning}</p>
        </div>
      ) : null}
      {snapshot?.recentActivity.length ? (
        <div className="activity-list">
          {snapshot.recentActivity.map((event) => (
            <article className="activity-card" key={`${event.txHash}-${event.label}`}>
              <div>
                <p className="activity-label">{event.label}</p>
                <p className="activity-detail">{event.detail}</p>
              </div>
              <div className="activity-meta">
                <span>Block {event.blockNumber}</span>
                <a href={`${explorerUrl}/tx/${event.txHash}`} target="_blank" rel="noreferrer">
                  {formatAddress(event.txHash)}
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No recent events were returned from the configured block window.</p>
        </div>
      )}
    </section>
  );
}
