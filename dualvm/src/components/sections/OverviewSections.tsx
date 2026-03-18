interface OverviewSectionsProps {
  network: {
    rpcUrl: string;
    chainId: number;
    explorerUrl: string;
    faucetUrl: string;
  };
}

export function OverviewSections({ network }: OverviewSectionsProps) {
  return (
    <section className="panel-card">
      <div className="section-header">
        <h2>Network</h2>
      </div>
      <dl className="detail-grid">
        <div><dt>Chain ID</dt><dd>{network.chainId}</dd></div>
        <div><dt>RPC</dt><dd><a href={network.rpcUrl} target="_blank" rel="noreferrer">{network.rpcUrl}</a></dd></div>
        <div><dt>Explorer</dt><dd><a href={network.explorerUrl} target="_blank" rel="noreferrer">Blockscout</a></dd></div>
        <div><dt>Faucet</dt><dd><a href={network.faucetUrl} target="_blank" rel="noreferrer">Polkadot Faucet</a></dd></div>
      </dl>
    </section>
  );
}
