import { formatTimestamp } from "../../lib/format";

interface HeroSectionProps {
  generatedAt: string;
  hasLiveDeployment: boolean;
}

export function HeroSection({ generatedAt, hasLiveDeployment }: HeroSectionProps) {
  return (
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
          {hasLiveDeployment ? "Polkadot Hub TestNet manifest" : "Local dry-run manifest"}
        </span>
        <span className="status-pill status-pill-muted">Generated {formatTimestamp(generatedAt)}</span>
      </div>
    </section>
  );
}
