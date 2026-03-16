import { FormEvent } from "react";
import { isAddress } from "viem";
import { MetricCard } from "../MetricCard";
import { formatAddress } from "../../lib/format";
import type { MarketSnapshot } from "../../lib/readModel";

interface ObserverSectionProps {
  snapshot: MarketSnapshot | null;
  observerInput: string;
  setObserverInput: (value: string) => void;
  onTrackAddress: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
}

export function ObserverSection({
  snapshot,
  observerInput,
  setObserverInput,
  onTrackAddress,
  onRefresh,
}: ObserverSectionProps) {
  return (
    <article className="panel-card observer-panel">
      <div className="section-header section-header-spread">
        <h2>Observer mode</h2>
        <p className="helper-text observer-note">
          Observer-only UI. Paste any address to inspect debt, borrow headroom, and health factor.
        </p>
      </div>
      <form className="observer-form" onSubmit={onTrackAddress}>
        <input
          className="observer-input"
          value={observerInput}
          onChange={(event) => setObserverInput(event.target.value)}
          placeholder="0x address to inspect"
        />
        <button className="action-button" type="submit" disabled={!isAddress(observerInput)}>
          Track address
        </button>
        <button className="action-button action-button-secondary" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </form>
      {snapshot?.observer ? (
        <div className="metric-grid observer-grid">
          <MetricCard label="Tracked address" value={formatAddress(snapshot.observer.address)} />
          <MetricCard label="Current debt" value={snapshot.observer.currentDebt} />
          <MetricCard label="Available to borrow" value={snapshot.observer.availableToBorrow} />
          <MetricCard label="Health factor" value={snapshot.observer.healthFactor} />
        </div>
      ) : (
        <div className="empty-state">
          <p>No valid address is currently being tracked.</p>
        </div>
      )}
    </article>
  );
}
