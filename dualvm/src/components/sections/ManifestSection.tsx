import { formatAddress } from "../../lib/format";

interface ManifestSectionProps {
  explorerUrl: string;
  contractRows: Array<{ name: string; address: string }>;
}

export function ManifestSection({ explorerUrl, contractRows }: ManifestSectionProps) {
  return (
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
            <a
              className="address-value"
              href={`${explorerUrl.replace(/\/$/, "")}/address/${row.address}`}
              target="_blank"
              rel="noreferrer"
              title={row.address}
            >
              {formatAddress(row.address)}
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
