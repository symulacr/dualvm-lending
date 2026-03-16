interface OverviewSectionsProps {
  demoModeNotes: readonly string[];
  writePathTruth: readonly string[];
  scopeGuardrails: readonly string[];
  network: {
    rpcUrl: string;
    fallbackRpcUrl: string;
    chainId: number;
    explorerUrl: string;
    faucetUrl: string;
  };
  networkName: string;
}

export function OverviewSections({
  demoModeNotes,
  writePathTruth,
  scopeGuardrails,
  network,
  networkName,
}: OverviewSectionsProps) {
  return (
    <>
      <section className="panel-grid panel-grid-two">
        <article className="panel-card">
          <div className="section-header">
            <h2>Frontend demo mode</h2>
          </div>
          <ul className="bullet-list">
            {demoModeNotes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="panel-card">
          <div className="section-header">
            <h2>Write-path truth</h2>
          </div>
          <ul className="bullet-list">
            {writePathTruth.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
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
                <a href={network.rpcUrl} target="_blank" rel="noreferrer">
                  {network.rpcUrl}
                </a>
              </dd>
            </div>
            <div>
              <dt>Fallback RPC</dt>
              <dd>{network.fallbackRpcUrl}</dd>
            </div>
            <div>
              <dt>Chain ID</dt>
              <dd>{network.chainId}</dd>
            </div>
            <div>
              <dt>Explorer</dt>
              <dd>
                <a href={network.explorerUrl} target="_blank" rel="noreferrer">
                  Open Blockscout
                </a>
              </dd>
            </div>
            <div>
              <dt>Faucet</dt>
              <dd>
                <a href={network.faucetUrl} target="_blank" rel="noreferrer">
                  Get PAS from the official faucet
                </a>
              </dd>
            </div>
            <div>
              <dt>Manifest mode</dt>
              <dd>{networkName}</dd>
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
    </>
  );
}
