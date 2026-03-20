import { useAccount } from "wagmi";
import { InfoIcon } from "./InfoIcon";
import { LiveAge } from "../App";
import { extractNumeric } from "../lib/format";
import type { ObserverSnapshot } from "../lib/readModel/types";

function safeNum(v: string | undefined): string {
  if (!v) return "—";
  const n = extractNumeric(v, "dash");
  return n || "—";
}

function applyDelta(formatted: string | undefined, delta: bigint | undefined): string {
  const base = safeNum(formatted);
  if (!delta || base === "—") return base;
  const baseNum = parseFloat(base);
  const deltaNum = Number(delta) / 1e18;
  const result = baseNum + deltaNum;
  if (result < 0) return "0.00";
  return result.toFixed(2);
}

function hfColor(numeric: number | null): string {
  if (numeric === null) return "var(--c-success)";
  if (numeric > 2.0) return "var(--c-success)";
  if (numeric >= 1.5) return "var(--c-warning)";
  if (numeric >= 1.0) return "var(--c-warning)";
  return "var(--c-danger)";
}

function hfBorderColor(numeric: number | null): string {
  if (numeric === null) return "var(--c-success-border)";
  if (numeric > 2.0) return "var(--c-success-border)";
  if (numeric >= 1.5) return "var(--c-warning-border)";
  if (numeric >= 1.0) return "var(--c-warning-border)";
  return "var(--c-danger-border)";
}

export function YourPosition({ observer, isLoading, lastUpdated, positionDelta }: { observer: ObserverSnapshot | null; isLoading: boolean; lastUpdated?: Date | null; positionDelta?: { debtDelta?: bigint; collateralDelta?: bigint } | null }) {
  const { isConnected } = useAccount();
  const loading = isLoading && !observer;

  if (!isConnected) {
    return (
      <section>
        <div className="section-eyebrow">
          Your position
          <InfoIcon tooltip="Your live collateral, debt, and account health. Requires wallet connection and at least one deposit." />
        </div>
        <div className="position-card" style={{ textAlign: "center", padding: "20px 12px", color: "var(--c-text-secondary)" }}>
          Connect your wallet to see your position.
        </div>
      </section>
    );
  }

  const debt = positionDelta?.debtDelta ? applyDelta(observer?.currentDebt, positionDelta.debtDelta) : safeNum(observer?.currentDebt);
  const capacity = safeNum(observer?.availableToBorrow);
  const hf = observer?.healthFactor ?? "—";
  const hfNum = observer?.healthFactorNumeric ?? null;
  const isInfinite = hfNum === null && observer !== null;
  const hfDisplay = isInfinite ? "∞" : hf;
  const debtIsZero = debt === "0" || debt === "0.00";
  const capIsZero = capacity === "0" || capacity === "0.00";

  return (
    <section>
      <div className={`section-eyebrow${isLoading && observer ? " refreshing" : ""}`}>
        Your position
        <InfoIcon tooltip="Your live collateral, debt, and account health. Requires wallet connection and at least one deposit." />
        {isLoading && observer ? <span className="live-age">Updating…</span> : <LiveAge timestamp={lastUpdated ?? null} />}
      </div>
      <div className="metrics-grid">
        {/* Debt */}
        <div className="position-card">
          <div className="metric-label">Debt <InfoIcon tooltip="Total USDC-test you owe including accrued interest. Grows every block while you have an open borrow." /></div>
          <div className="metric-value">{loading ? "—" : debt}</div>
          <div className="metric-sub">USDC-test</div>
        </div>

        {/* Borrow capacity */}
        <div className="position-card">
          <div className="metric-label">Borrow capacity <InfoIcon tooltip="Maximum additional USDC-test you can borrow given your collateral and the current loan-to-value limit." /></div>
          <div className="metric-value">{loading ? "—" : capacity}</div>
          <div className="metric-sub">
            USDC-test
            {!loading && capIsZero && debtIsZero && <><br />Deposit collateral to unlock</>}
            {!loading && capIsZero && !debtIsZero && <><br />Position at max LTV</>}
          </div>
        </div>

        {/* Health factor */}
        <div className="position-card" style={{ borderColor: observer ? hfBorderColor(hfNum) : undefined }}>
          <div className="metric-label">Health factor <InfoIcon tooltip="Ratio of collateral value to liquidation threshold. Below 1.0 triggers liquidation. Higher is safer." /></div>
          <div className="metric-value" style={{ color: observer ? hfColor(hfNum) : undefined }}>
            {loading ? "—" : hfDisplay}
          </div>
          <div className="metric-sub">
            {isInfinite ? "No debt" : "Health factor"}
            {observer?.liquidationPrice && (
              <><br />Liquidated if oracle ≤ {observer.liquidationPrice} USDC-test</>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
