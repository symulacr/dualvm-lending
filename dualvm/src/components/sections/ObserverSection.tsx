import { FormEvent } from "react";
import { isAddress } from "viem";
import { MetricCard } from "../MetricCard";
import { formatAddress } from "../../lib/format";
import type { MarketSnapshot, ObserverSnapshot } from "../../lib/readModel";

interface ObserverSectionProps {
  snapshot: MarketSnapshot | null;
  observerInput: string;
  setObserverInput: (value: string) => void;
  onTrackAddress: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
}

type HfStatus = "safe" | "caution" | "at-risk" | "liquidatable";

function getHfStatus(numeric: number | null): HfStatus {
  if (numeric === null) return "safe"; // infinite → safe
  if (numeric > 2.0) return "safe";
  if (numeric >= 1.5) return "caution";
  if (numeric >= 1.0) return "at-risk";
  return "liquidatable";
}

const HF_LABELS: Record<HfStatus, string> = {
  safe: "Safe",
  caution: "Caution",
  "at-risk": "At Risk",
  liquidatable: "Liquidatable",
};

function HealthFactorDisplay({ observer }: { observer: ObserverSnapshot }) {
  const status = getHfStatus(observer.healthFactorNumeric);
  return (
    <article className="metric-card">
      <p className="metric-label">Health factor</p>
      <p className={`metric-value hf-value hf-${status}`}>
        {observer.healthFactor}
        <span className={`hf-badge hf-badge-${status}`}>{HF_LABELS[status]}</span>
      </p>
      {observer.liquidationPrice !== null && (
        <p className="hf-liq-price">Liquidation at PAS = ${observer.liquidationPrice}</p>
      )}
    </article>
  );
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
        <p className="helper-text observer-note">Paste any address to inspect health factor and borrow capacity.</p>
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
          <HealthFactorDisplay observer={snapshot.observer} />
        </div>
      ) : (
        <div className="empty-state">
          <p>No valid address is currently being tracked.</p>
        </div>
      )}
    </article>
  );
}
