import { FormEvent, useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { MetricCard } from "./components/MetricCard";
import { formatAddress, formatTimestamp } from "./lib/format";
import { assetRegistry } from "./lib/assetRegistry";
import { deploymentManifest, hasLivePolkadotHubTestnetDeployment } from "./lib/manifest";
import { loadMarketSnapshot, type MarketSnapshot } from "./lib/readModel";

const DEFAULT_OBSERVER_ADDRESS = "0x31FA19B35fdBD96f381A0be838799ca40978D080";

const judgeFlow = [
  "Wrap PAS into WPAS.",
  "LP deposits USDC-test into the debt pool.",
  "Borrower deposits WPAS collateral into LendingCore.",
  "Borrower draws stable debt.",
  "Borrower repays or the oracle moves and health factor falls.",
  "Liquidation closes unsafe debt when required.",
];

const scopeGuardrails = [
  "One isolated market only.",
  "REVM is the solvency source of truth.",
  "PVM is a bounded parity-oriented computation module.",
  "Oracle reads are freshness-gated and now include a configurable circuit breaker.",
  "No XCM in the MVP critical path.",
  "Public-RPC-first deployment; no local Polkadot node requirement.",
];

export default function App() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [observerInput, setObserverInput] = useState(DEFAULT_OBSERVER_ADDRESS);
  const [trackedAddress, setTrackedAddress] = useState(DEFAULT_OBSERVER_ADDRESS);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
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

    void run();
    return () => {
      cancelled = true;
    };
  }, [trackedAddress, refreshKey]);

  const contractRows = useMemo(
    () =>
      Object.entries(deploymentManifest.contracts).map(([name, address]) => ({
        name,
        address,
      })),
    [],
  );

  const readStatus = hasLivePolkadotHubTestnetDeployment
    ? isLoading
      ? "Loading live Polkadot Hub TestNet reads"
      : readError
        ? `Read failed: ${readError}`
        : snapshot
          ? "Live Polkadot Hub TestNet reads enabled"
          : "No live data returned"
    : "Dry-run manifest only. Deploy to Polkadot Hub TestNet to enable live reads.";

  function handleTrackAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isAddress(observerInput)) {
      setTrackedAddress(observerInput);
      setRefreshKey((current) => current + 1);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">DualVM Lending</p>
          <h1>Public-RPC-first isolated lending market</h1>
          <p className="lede">
            This build follows the corrected DualVM specs: one WPAS collateral market, one USDC-test debt
            pool, REVM for custody and solvency, and a bounded PVM-aligned risk module that is kept truthful by
            not claiming proven live cross-VM execution in the deployed solvency path.
          </p>
        </div>
        <div className="hero-badges">
          <span className="status-pill">
            {hasLivePolkadotHubTestnetDeployment ? "Polkadot Hub TestNet manifest" : "Local dry-run manifest"}
          </span>
          <span className="status-pill status-pill-muted">Generated {formatTimestamp(deploymentManifest.generatedAt)}</span>
        </div>
      </section>

      <section className="panel-grid panel-grid-two">
        <article className="panel-card">
          <div className="section-header">
            <h2>Network and faucet</h2>
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Primary RPC</dt>
              <dd>
                <a href={deploymentManifest.polkadotHubTestnet.rpcUrl} target="_blank" rel="noreferrer">
                  {deploymentManifest.polkadotHubTestnet.rpcUrl}
                </a>
              </dd>
            </div>
            <div>
              <dt>Fallback RPC</dt>
              <dd>{deploymentManifest.polkadotHubTestnet.fallbackRpcUrl}</dd>
            </div>
            <div>
              <dt>Chain ID</dt>
              <dd>{deploymentManifest.polkadotHubTestnet.chainId}</dd>
            </div>
            <div>
              <dt>Explorer</dt>
              <dd>
                <a href={deploymentManifest.polkadotHubTestnet.explorerUrl} target="_blank" rel="noreferrer">
                  Open Blockscout
                </a>
              </dd>
            </div>
            <div>
              <dt>Faucet</dt>
              <dd>
                <a href={deploymentManifest.polkadotHubTestnet.faucetUrl} target="_blank" rel="noreferrer">
                  Get PAS from the official faucet
                </a>
              </dd>
            </div>
            <div>
              <dt>Manifest mode</dt>
              <dd>{deploymentManifest.networkName}</dd>
            </div>
          </dl>
        </article>

        <article className="panel-card">
          <div className="section-header">
            <h2>Locked scope</h2>
          </div>
          <ul className="bullet-list">
            {scopeGuardrails.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="panel-card">
        <div className="section-header section-header-spread">
          <h2>Deployment manifest</h2>
          <p className="helper-text">
            These addresses drive the observer UI. The current frontend intentionally stays read-first and links to
            Blockscout for proof rather than pretending there is a hidden backend.
          </p>
        </div>
        <div className="address-grid">
          {contractRows.map((row) => (
            <article className="address-card" key={row.name}>
              <p className="address-label">{row.name}</p>
              <p className="address-value" title={row.address}>
                {formatAddress(row.address)}
              </p>
            </article>
          ))}
        </div>
      </section>


      <section className="panel-card">
        <div className="section-header section-header-spread">
          <h2>Asset path</h2>
          <p className="helper-text">
            The live system now makes the collateral and debt asset truth explicit instead of implying broader market realism than the MVP actually has.
          </p>
        </div>
        <div className="address-grid">
          {assetRegistry.map((asset) => (
            <article className="address-card" key={asset.symbol}>
              <p className="address-label">{asset.symbol}</p>
              <p className="address-value">{asset.name}</p>
              <p className="helper-text">Role: {asset.role}</p>
              <p className="helper-text">Source: {asset.source}</p>
              <p className="helper-text">Truth: {asset.truthModel}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel-card">
        <div className="section-header section-header-spread">
          <h2>Read layer</h2>
          <p className="helper-text">{readStatus}</p>
        </div>
        {snapshot ? (
          <div className="metric-grid">
            <MetricCard label="Pool total assets" value={snapshot.totalAssets} />
            <MetricCard label="Available liquidity" value={snapshot.availableLiquidity} />
            <MetricCard label="Outstanding principal" value={snapshot.outstandingPrincipal} />
            <MetricCard label="Reserve balance" value={snapshot.reserveBalance} />
            <MetricCard label="Utilization" value={snapshot.utilization} />
            <MetricCard label="Borrow cap" value={snapshot.borrowCap} />
            <MetricCard label="Minimum borrow" value={snapshot.minBorrowAmount} />
            <MetricCard label="Liquidation bonus" value={snapshot.liquidationBonusBps} />
            <MetricCard label="Oracle price" value={snapshot.oraclePrice} />
            <MetricCard label="Oracle freshness" value={snapshot.oracleFresh} />
            <MetricCard label="Oracle max age" value={snapshot.oracleMaxAge} />
            <MetricCard label="Oracle last update" value={snapshot.oracleLastUpdated} />
            <MetricCard label="Oracle min price" value={snapshot.oracleMinPrice} />
            <MetricCard label="Oracle max price" value={snapshot.oracleMaxPrice} />
            <MetricCard label="Oracle max move" value={snapshot.oracleMaxPriceChange} />
          </div>
        ) : (
          <div className="empty-state">
            <p>
              The UI is ready for live Polkadot Hub TestNet reads, but the current manifest was generated from a local
              dry-run deployment. Run the deploy script against Polkadot Hub TestNet and keep the generated
              `deployments/polkadot-hub-testnet.json` file to activate these cards.
            </p>
          </div>
        )}
      </section>

      <section className="panel-grid panel-grid-two">
        <article className="panel-card observer-panel">
          <div className="section-header section-header-spread">
            <h2>Observer mode</h2>
            <p className="helper-text observer-note">Observer-only UI. Paste any address to inspect debt, borrow headroom, and health factor.</p>
          </div>
          <form className="observer-form" onSubmit={handleTrackAddress}>
            <input
              className="observer-input"
              value={observerInput}
              onChange={(event) => setObserverInput(event.target.value)}
              placeholder="0x address to inspect"
            />
            <button className="action-button" type="submit" disabled={!isAddress(observerInput)}>
              Track address
            </button>
            <button className="action-button action-button-secondary" type="button" onClick={() => setRefreshKey((current) => current + 1)}>
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

        <article className="panel-card">
          <div className="section-header">
            <h2>Judge-facing demo flow</h2>
          </div>
          <ol className="ordered-list">
            {judgeFlow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>
      </section>

      <section className="panel-card">
        <div className="section-header section-header-spread">
          <h2>Recent activity</h2>
          <p className="helper-text">Latest LendingCore events from the live deployment over the recent block window.</p>
        </div>
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
                  <a
                    href={`${deploymentManifest.polkadotHubTestnet.explorerUrl}/tx/${event.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
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

      <section className="panel-card">
        <div className="section-header">
          <h2>Security posture</h2>
        </div>
        <ul className="bullet-list">
          <li>AccessManager is the authority boundary for admin actions.</li>
          <li>DebtPool reserve accounting separates LP assets from treasury reserves.</li>
          <li>Borrow and withdraw paths require a fresh oracle.</li>
          <li>Repay remains available even when the oracle is stale.</li>
          <li>Oracle updates are now bounded by min/max price limits and a configurable max-change circuit breaker.</li>
          <li>Bad-debt liquidation accounting is fixed so only remaining principal is written against pool loss accounting.</li>
          <li>The current live UI is intentionally observer-only and does not pretend hidden automation or off-chain trust.</li>
        </ul>
      </section>
    </main>
  );
}
