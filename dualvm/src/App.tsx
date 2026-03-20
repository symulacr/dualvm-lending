import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { ActionPanel } from "./components/ActionPanel";
import { Dashboard } from "./components/Dashboard";
import { loadMarketSnapshot } from "./lib/readModel/marketSnapshot";
import type { MarketSnapshot } from "./lib/readModel/types";
import { useFaucet } from "./hooks/useFaucet";

export default function App() {
  const { address, isConnected } = useAccount();
  const faucet = useFaucet();
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackedAddress, setTrackedAddress] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [txStatus, setTxStatus] = useState<"idle" | "pending" | "confirming" | "confirmed" | "error">("idle");
  const [txHistory, setTxHistory] = useState<Array<{ label: string; hash: string; status: string }>>([]);

  // Set tracked address when wallet connects
  useEffect(() => {
    if (address && !trackedAddress) setTrackedAddress(address);
  }, [address, trackedAddress]);

  // Fetch market snapshot
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    loadMarketSnapshot(trackedAddress || undefined, { forceRefresh: refreshKey > 0 })
      .then((data) => {
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trackedAddress, refreshKey]);

  const handleWriteSuccess = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <>
      <Header
        txStatus={txStatus}
        oraclePrice={snapshot?.oraclePrice}
        faucetState={faucet.state}
        onFaucetClaim={faucet.claim}
        isConnected={isConnected}
      />
      <main className="app-main">
        <ActionPanel
          snapshot={snapshot}
          trackedAddress={trackedAddress}
          onWriteSuccess={handleWriteSuccess}
        />
        <Dashboard
          snapshot={snapshot}
          isLoading={isLoading}
          error={error}
          txHistory={txHistory}
        />
      </main>
      <Footer
        trackedAddress={trackedAddress}
        onTrackedAddressChange={setTrackedAddress}
      />
    </>
  );
}
