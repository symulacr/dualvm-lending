import type { AssetRegistryEntry } from "../../lib/assetRegistry";

interface AssetPathSectionProps {
  assets: AssetRegistryEntry[];
}

export function AssetPathSection({ assets }: AssetPathSectionProps) {
  return (
    <section className="panel-card">
      <div className="section-header section-header-spread">
        <h2>Asset path</h2>
        <p className="helper-text">
          The live system now makes the collateral and debt asset truth explicit instead of implying broader market realism than the MVP actually has.
        </p>
      </div>
      <div className="address-grid">
        {assets.map((asset) => (
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
  );
}
