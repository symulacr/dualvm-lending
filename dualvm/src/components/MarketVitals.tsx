import { InfoIcon } from "./InfoIcon";
import { extractNumeric } from "../lib/format";
import type { MarketSnapshot } from "../lib/readModel/types";

function stripSuffix(v: string, suffix: string): string {
  return v.replace(suffix, "").trim();
}

function safeNum(v: string | undefined): string {
  if (!v) return "—";
  const n = extractNumeric(v, "dash");
  return n || "—";
}

export function MarketVitals({ snapshot, isLoading }: { snapshot: MarketSnapshot | null; isLoading: boolean }) {
  const loading = isLoading && !snapshot;

  const tvl = safeNum(snapshot?.totalAssets);
  const util = snapshot?.utilization ?? "—";
  const utilNum = parseFloat((util ?? "").replace("%", ""));
  const utilColor = utilNum > 95 ? "var(--c-danger)" : utilNum > 80 ? "var(--c-warning)" : undefined;

  const oracleRaw = snapshot?.oraclePrice ?? "";
  const oracleNum = safeNum(oracleRaw);
  const oracleStale = snapshot?.oracleFresh === "stale";
  const oracleLastUpdated = snapshot?.oracleLastUpdated ?? "";

  return (
    <section>
      <div className="section-eyebrow">
        Market vitals
        <InfoIcon tooltip="Live metrics from the on-chain lending pool." />
      </div>
      <div className="metrics-grid">
        {/* TVL */}
        <div className="metric-card-bg">
          <div className="metric-label">TVL <InfoIcon tooltip="Total USDC-test supplied by all liquidity providers to this lending pool." /></div>
          <div className="metric-value">{loading ? "—" : tvl}</div>
          {tvl !== "—" && <div className="metric-sub">USDC-test</div>}
        </div>

        {/* Utilization */}
        <div className="metric-card-bg">
          <div className="metric-label">Utilization <InfoIcon tooltip="Percentage of supplied liquidity currently borrowed. Higher utilization drives higher borrow rates." /></div>
          <div className="metric-value" style={utilColor ? { color: utilColor } : undefined}>{loading ? "—" : util}</div>
          <div className="metric-sub">of pool in use</div>
        </div>

        {/* Oracle */}
        <div className="metric-card-bg">
          <div className="metric-label">
            Oracle price
            <InfoIcon tooltip={`WPAS/USDC-test exchange rate used to calculate your collateral value and liquidation threshold.${oracleLastUpdated ? ` Last updated: ${oracleLastUpdated}` : ""}`} />
            {oracleStale && <span className="stale-badge">Stale</span>}
          </div>
          <div className="metric-value" style={oracleStale ? { color: "var(--c-warning)" } : undefined}>
            {loading ? "—" : oracleNum}
          </div>
          <div className="metric-sub">{oracleNum !== "—" ? "USDC-test per WPAS" : "price unavailable"}</div>
        </div>
      </div>
    </section>
  );
}
