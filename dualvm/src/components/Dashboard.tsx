import type { MarketSnapshot } from "../lib/readModel/types";
import { formatAddress } from "../lib/format";
import { deploymentManifest } from "../lib/manifest";

interface DashboardProps {
  snapshot: MarketSnapshot | null;
  isLoading: boolean;
  error: string | null;
  txHistory: Array<{ label: string; hash: string; status: string }>;
}

/** Split "0 USDC-test" → { num: "0", unit: "USDC-test" } */
function splitValue(v: string): { num: string; unit: string } {
  const idx = v.indexOf(" ");
  if (idx === -1) return { num: v, unit: "" };
  return { num: v.slice(0, idx), unit: v.slice(idx + 1) };
}

function healthClass(numeric: number | null): string {
  if (numeric === null || numeric > 1.5) return "health-safe";
  if (numeric >= 1.0) return "health-warning";
  return "health-danger";
}

function Metric({ value, sub, className }: { value: string; sub: string; className?: string }) {
  const { num, unit } = splitValue(value);
  const subText = unit ? `${sub} · ${unit}` : sub;
  return (
    <div className="dashboard-metric">
      <span className={`dashboard-value ${className ?? ""}`}>{num}</span>
      <span className="dashboard-sub">{subText}</span>
    </div>
  );
}

function Skeleton() {
  return <span className="skeleton">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>;
}

export function Dashboard({
  snapshot,
  isLoading,
  error,
  txHistory,
}: DashboardProps) {
  const explorerBase = deploymentManifest.polkadotHubTestnet.explorerUrl.replace(/\/$/, "");
  const obs = snapshot?.observer ?? null;
  const loading = isLoading && !snapshot;

  // Merge user txHistory (first) + on-chain activity, cap at 5
  const feed = [
    ...txHistory.map((tx) => ({
      key: tx.hash,
      label: tx.label,
      detail: tx.status,
      href: `${explorerBase}/tx/${tx.hash}`,
    })),
    ...(snapshot?.recentActivity ?? []).map((e) => ({
      key: e.txHash,
      label: e.label,
      detail: e.detail,
      href: `${explorerBase}/tx/${e.txHash}`,
    })),
  ].slice(0, 5);

  if (error) {
    return (
      <div className="dashboard-panel">
        <p style={{ color: "var(--red, #e74c3c)" }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="dashboard-panel">
      {/* ── Market Vitals ── */}
      <section className="dashboard-section">
        <p className="dashboard-label">Market Vitals</p>
        <div className="dashboard-grid">
          {loading ? (
            <>
              <div className="dashboard-metric"><Skeleton /><span className="dashboard-sub">TVL</span></div>
              <div className="dashboard-metric"><Skeleton /><span className="dashboard-sub">Utilization</span></div>
              <div className="dashboard-metric"><Skeleton /><span className="dashboard-sub">Oracle Price</span></div>
            </>
          ) : (
            <>
              <Metric value={snapshot?.totalAssets ?? "—"} sub="TVL" />
              <Metric value={snapshot?.utilization ?? "—"} sub="Utilization" />
              <Metric
                value={(() => {
                  const raw = snapshot?.oraclePrice ?? "—";
                  const { num } = splitValue(raw);
                  return num;
                })()}
                sub={(() => {
                  const raw = snapshot?.oraclePrice ?? "";
                  const { unit } = splitValue(raw);
                  // "USDC-test / WPAS" → "USDC / WPAS"
                  const clean = unit.replace(/-test/g, "");
                  return clean ? `Oracle · ${clean}` : "Oracle Price";
                })()}
              />
            </>
          )}
        </div>
      </section>

      {/* ── Your Position ── */}
      <section className="dashboard-section">
        <p className="dashboard-label">Your Position</p>
        <div className="dashboard-grid">
          {loading ? (
            <>
              <div className="dashboard-metric"><Skeleton /><span className="dashboard-sub">Debt</span></div>
              <div className="dashboard-metric"><Skeleton /><span className="dashboard-sub">Borrow Capacity</span></div>
              <div className="dashboard-metric"><Skeleton /><span className="dashboard-sub">Health Factor</span></div>
            </>
          ) : (
            <>
              <Metric value={obs?.currentDebt ?? "—"} sub="Debt" />
              <Metric value={obs?.availableToBorrow ?? "—"} sub="Borrow Capacity" />
              <Metric
                value={(() => {
                  const hf = obs?.healthFactor ?? "—";
                  const numeric = obs?.healthFactorNumeric ?? null;
                  if (hf === "∞" || hf === "Infinity" || numeric === null || numeric === Infinity) return "--";
                  return hf;
                })()}
                sub={(() => {
                  const hf = obs?.healthFactor ?? "—";
                  const numeric = obs?.healthFactorNumeric ?? null;
                  if (hf === "∞" || hf === "Infinity" || numeric === null || numeric === Infinity) return "No Debt";
                  return "Health Factor";
                })()}
                className={obs ? healthClass(obs.healthFactorNumeric) : ""}
              />
            </>
          )}
        </div>

      </section>

      {/* ── Activity Feed ── */}
      <section className="dashboard-section">
        <p className="dashboard-label">Activity</p>
        {feed.length > 0 ? (
          <div className="activity-feed">
            {feed.map((item) => (
              <div className="activity-item" key={item.key}>
                <span style={{ fontSize: "11px", textTransform: "uppercase", opacity: 0.7 }}>
                  {item.label}
                </span>
                <span style={{ flex: 1 }}>{item.detail}</span>
                <a href={item.href} target="_blank" rel="noreferrer" style={{ fontSize: "11px" }}>
                  {formatAddress(item.key)}
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state-prominent">No activity yet — try a deposit</div>
        )}
      </section>
    </div>
  );
}
