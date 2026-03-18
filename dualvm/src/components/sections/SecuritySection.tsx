export function SecuritySection() {
  return (
    <section className="panel-card">
      <div className="section-header"><h2>Security</h2></div>
      <p>AccessManager is the authority boundary with non-zero execution delays for risk, treasury, and minter roles. All token transfers use SafeERC20. Borrow and withdraw paths require a fresh oracle; repay is always available. The oracle circuit breaker bounds price updates by min/max limits and a configurable max-change threshold. ReentrancyGuard protects all fund flows. Emergency pause is available via the EMERGENCY role (delay=0).</p>
    </section>
  );
}
