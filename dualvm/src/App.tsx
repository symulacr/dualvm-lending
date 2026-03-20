import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount, useBlockNumber } from "wagmi";
import { TopBar } from "./components/layout/TopBar";
import { Sidebar, type FormId } from "./components/layout/Sidebar";
import { BottomBar } from "./components/layout/BottomBar";
import { MarketVitals } from "./components/MarketVitals";
import { YourPosition } from "./components/YourPosition";
import { RecentActivityFeed } from "./components/RecentActivityFeed";
import { DepositCollateralForm } from "./components/forms/DepositCollateralForm";
import { SupplyLiquidityForm } from "./components/forms/SupplyLiquidityForm";
import { BorrowForm } from "./components/forms/BorrowForm";
import { RepayForm } from "./components/forms/RepayForm";
import { WithdrawCollateralForm } from "./components/forms/WithdrawCollateralForm";
import { LiquidateForm } from "./components/forms/LiquidateForm";
import { loadMarketSnapshot } from "./lib/readModel/marketSnapshot";
import { extractNumeric } from "./lib/format";
import { perf } from "./lib/perf";
import type { MarketSnapshot } from "./lib/readModel/types";

export type PositionDelta = { debtDelta?: bigint; collateralDelta?: bigint };

const FORM_IDS: FormId[] = [
  "deposit-collateral",
  "supply-liquidity",
  "borrow",
  "repay",
  "withdraw-collateral",
  "liquidate",
];

const FORM_LABELS: Record<FormId, string> = {
  "deposit-collateral": "Deposit",
  "supply-liquidity": "Supply",
  "borrow": "Borrow",
  "repay": "Repay",
  "withdraw-collateral": "Withdraw",
  "liquidate": "Liquidate",
};

const REFRESH_EVERY_N_BLOCKS = 3n;
const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("RPC_TIMEOUT")), FETCH_TIMEOUT_MS)),
  ]);
}

export function LiveAge({ timestamp }: { timestamp: Date | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  if (!timestamp) return null;
  const seconds = Math.floor((Date.now() - timestamp.getTime()) / 1000);
  if (seconds < 5) return <span className="live-age">Just updated</span>;
  if (seconds < 60) return <span className="live-age">Updated {seconds}s ago</span>;
  return <span className="live-age">Updated {Math.floor(seconds / 60)}m ago</span>;
}

export default function App() {
  const { address } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const lastRefreshedBlock = useRef<bigint | null>(null);
  const [activeForm, setActiveForm] = useState<FormId>("deposit-collateral");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [positionDelta, setPositionDelta] = useState<PositionDelta | null>(null);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Block-triggered refresh
  useEffect(() => {
    if (!blockNumber) return;
    if (lastRefreshedBlock.current === null || blockNumber - lastRefreshedBlock.current >= REFRESH_EVERY_N_BLOCKS) {
      lastRefreshedBlock.current = blockNumber;
      setRefreshKey((k) => k + 1);
    }
  }, [blockNumber]);

  // Fetch market snapshot
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const refreshId = perf.dataRefresh.start(refreshKey === 0 ? "initial" : "poll");
    fetchWithTimeout(() => loadMarketSnapshot(address ?? undefined, { forceRefresh: refreshKey > 0 }))
      .then((data) => {
        if (!cancelled) { setSnapshot(data); setReadError(null); setLastUpdated(new Date()); setPositionDelta(null); perf.dataRefresh.end(refreshId, { hasData: !!data }); }
      })
      .catch((err) => {
        if (!cancelled) {
          if (err instanceof Error && err.message === "RPC_TIMEOUT") {
            setReadError("RPC_TIMEOUT");
          }
          perf.dataRefresh.end(refreshId, { error: true });
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [address, refreshKey]);

  const handleWriteSuccess = useCallback((delta?: PositionDelta) => {
    if (delta) setPositionDelta(delta);
    perf.ui.stateChange("App", "refreshKey", "write_success");
    setRefreshKey(k => k + 1);
  }, []);

  const obs = snapshot?.observer ?? null;

  function renderGuidance(): string | null {
    if (!snapshot || isLoading) return null;
    const debtNum = obs ? extractNumeric(obs.currentDebt) : "0";
    const hasDebt = debtNum !== "0" && debtNum !== "0.00";
    const availNum = obs ? extractNumeric(obs.availableToBorrow, "dash") : "";
    const hasCollateral = obs !== null && (availNum !== "" && availNum !== "0" && availNum !== "0.00" || hasDebt);

    if (activeForm === "deposit-collateral" && !hasCollateral) {
      return "Start here: deposit PAS to open a position.";
    }
    if (activeForm === "borrow" && hasCollateral && !hasDebt) {
      return `You have collateral. Borrow up to ${obs?.availableToBorrow ?? "0"} USDC-test.`;
    }
    if (activeForm === "repay" && hasDebt) {
      return `Outstanding debt: ${obs?.currentDebt ?? "0"}. Maintain health factor above 1.0.`;
    }
    return null;
  }

  function renderForm() {
    switch (activeForm) {
      case "deposit-collateral": return <DepositCollateralForm snapshot={snapshot} onWriteSuccess={handleWriteSuccess} />;
      case "supply-liquidity": return <SupplyLiquidityForm snapshot={snapshot} onWriteSuccess={handleWriteSuccess} />;
      case "borrow": return <BorrowForm snapshot={snapshot} observer={obs} onWriteSuccess={handleWriteSuccess} />;
      case "repay": return <RepayForm observer={obs} onWriteSuccess={handleWriteSuccess} />;
      case "withdraw-collateral": return <WithdrawCollateralForm observer={obs} onWriteSuccess={handleWriteSuccess} />;
      case "liquidate": return <LiquidateForm snapshot={snapshot} onWriteSuccess={handleWriteSuccess} />;
    }
  }

  return (
    <>
      <TopBar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} theme={theme} setTheme={setTheme} isLoading={isLoading} />
      <div className="action-chip-strip">
        {FORM_IDS.map(id => (
          <button
            key={id}
            className={`action-chip${activeForm === id ? " active" : ""}`}
            onClick={() => setActiveForm(id)}
          >
            {FORM_LABELS[id]}
          </button>
        ))}
      </div>
      <div className="app-layout">
        <Sidebar active={activeForm} onSelect={setActiveForm} observer={obs} isOpen={sidebarOpen} />
        <main className="main-panel">
          {readError === "RPC_TIMEOUT" && (
            <div className="rpc-warning-bar">Network slow — using last known data</div>
          )}
          <MarketVitals snapshot={snapshot} isLoading={isLoading} />
          <YourPosition observer={obs} isLoading={isLoading} lastUpdated={lastUpdated} positionDelta={positionDelta} />
          {renderGuidance() && <div className="form-guidance">{renderGuidance()}</div>}
          {renderForm()}
          <RecentActivityFeed snapshot={snapshot} isLoading={isLoading} address={address} />
        </main>
      </div>
      <BottomBar snapshot={snapshot} />
    </>
  );
}
