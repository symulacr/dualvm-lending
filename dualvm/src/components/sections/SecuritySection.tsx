export function SecuritySection() {
  return (
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
  );
}
