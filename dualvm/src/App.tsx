import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  DEFAULT_OBSERVER_ADDRESS,
  demoModeNotes,
  humanizeReadError,
  judgeFlow,
  scopeGuardrails,
  writePathTruth,
} from "./appCopy";
import { AssetPathSection } from "./components/sections/AssetPathSection";
import { DemoFlowSection } from "./components/sections/DemoFlowSection";
import { HeroSection } from "./components/sections/HeroSection";
import { ManifestSection } from "./components/sections/ManifestSection";
import { ObserverSection } from "./components/sections/ObserverSection";
import { OverviewSections } from "./components/sections/OverviewSections";
import { ReadLayerSection } from "./components/sections/ReadLayerSection";
import { RecentActivitySection } from "./components/sections/RecentActivitySection";
import { SecuritySection } from "./components/sections/SecuritySection";
import { assetRegistry } from "./lib/assetRegistry";
import { deploymentManifest, hasLivePolkadotHubTestnetDeployment } from "./lib/manifest";
import { loadMarketSnapshot, type MarketSnapshot } from "./lib/readModel";

export default function App() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [observerInput, setObserverInput] = useState(DEFAULT_OBSERVER_ADDRESS);
  const [trackedAddress, setTrackedAddress] = useState(DEFAULT_OBSERVER_ADDRESS);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function refreshMarketSnapshot() {
      if (!hasLivePolkadotHubTestnetDeployment) {
        return;
      }

      setIsLoading(true);
      setReadError(null);
      try {
        const nextSnapshot = await loadMarketSnapshot(trackedAddress);
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      } catch (error) {
        if (!cancelled) {
          setReadError(error instanceof Error ? error.message : "Unknown read-layer error");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void refreshMarketSnapshot();
    return () => {
      cancelled = true;
    };
  }, [trackedAddress, refreshKey]);

  const contractRows = useMemo(
    () => Object.entries(deploymentManifest.contracts).map(([name, address]) => ({ name, address })),
    [],
  );

  const readStatus = hasLivePolkadotHubTestnetDeployment
    ? isLoading
      ? "Loading live Polkadot Hub TestNet reads"
      : readError
        ? `Read failed: ${humanizeReadError(readError)}`
        : snapshot
          ? "Live Polkadot Hub TestNet reads enabled"
          : "No live data returned"
    : "Dry-run manifest only. Deploy to Polkadot Hub TestNet to enable live reads.";

  function handleTrackAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTrackedAddress(observerInput);
    setRefreshKey((current) => current + 1);
  }

  function refreshObserver() {
    setRefreshKey((current) => current + 1);
  }

  return (
    <main className="page-shell">
      <header className="app-header">
        <span className="app-header-title">DualVM Lending</span>
        <ConnectButton />
      </header>

      <HeroSection
        generatedAt={deploymentManifest.generatedAt}
        hasLiveDeployment={hasLivePolkadotHubTestnetDeployment}
      />

      <OverviewSections
        demoModeNotes={demoModeNotes}
        writePathTruth={writePathTruth}
        scopeGuardrails={scopeGuardrails}
        network={deploymentManifest.polkadotHubTestnet}
        networkName={deploymentManifest.networkName}
      />

      <ManifestSection
        explorerUrl={deploymentManifest.polkadotHubTestnet.explorerUrl}
        contractRows={contractRows}
      />

      <AssetPathSection assets={assetRegistry} />

      <ReadLayerSection readStatus={readStatus} snapshot={snapshot} />

      <section className="panel-grid panel-grid-two">
        <ObserverSection
          snapshot={snapshot}
          observerInput={observerInput}
          setObserverInput={setObserverInput}
          onTrackAddress={handleTrackAddress}
          onRefresh={refreshObserver}
        />
        <DemoFlowSection judgeFlow={judgeFlow} />
      </section>

      <RecentActivitySection
        snapshot={snapshot}
        explorerUrl={deploymentManifest.polkadotHubTestnet.explorerUrl}
      />

      <SecuritySection />
    </main>
  );
}
