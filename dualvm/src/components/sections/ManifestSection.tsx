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
