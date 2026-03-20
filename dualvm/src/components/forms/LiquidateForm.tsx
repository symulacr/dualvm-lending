import { FormEvent, useEffect, useRef, useState } from "react";
import { createPublicClient, http, isAddress, parseUnits } from "viem";
import { useAccount, useGasPrice } from "wagmi";
import { useWriteFlow, useElapsedSeconds } from "../../hooks/useWriteFlow";
import { deploymentManifest } from "../../lib/manifest";
import { erc20ApproveAbi, lendingCoreWriteAbi } from "../../lib/abi";
import { benchStart, benchMark, benchEnd, benchAbort } from "../../lib/txBench";
import { extractNumeric } from "../../lib/format";
import { loadObserverSnapshot } from "../../lib/readModel/observer";
import type { MarketSnapshot, ObserverSnapshot } from "../../lib/readModel/types";

const { contracts } = deploymentManifest;

export function LiquidateForm({ snapshot, onWriteSuccess }: { snapshot: MarketSnapshot | null; onWriteSuccess: (delta?: { debtDelta?: bigint; collateralDelta?: bigint }) => void }) {
  const { address, isConnected } = useAccount();
  const [borrower, setBorrower] = useState("");
  const [amount, setAmount] = useState("");
  const approveFlow = useWriteFlow();
  const actionFlow = useWriteFlow();
  const notified = useRef(false);
  const [lookupResult, setLookupResult] = useState<ObserverSnapshot | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const { data: gasPrice } = useGasPrice();
  const gasEstimate = gasPrice ? (Number(gasPrice) * 200_000 / 1e18).toFixed(4) : "—";

  const parsed = parseFloat(amount);
  const valid = !Number.isNaN(parsed) && parsed > 0;
  const validAddr = borrower.length > 0 && isAddress(borrower);
  const isApproved = approveFlow.status === "confirmed";
  const flow = !isApproved ? approveFlow : actionFlow;
  const elapsed = useElapsedSeconds(flow.status === "confirming");
  const busy = flow.status === "pending" || flow.status === "confirming";

  const bonusBps = snapshot?.liquidationBonusBps ? extractNumeric(snapshot.liquidationBonusBps) : null;
  const bonusPct = bonusBps ? `${(Number(bonusBps) / 100).toFixed(0)}%` : null;

  const autoFired = useRef(false);

  useEffect(() => { if (actionFlow.status === "confirmed" && !notified.current) { notified.current = true; onWriteSuccess(); benchMark("data_refreshed"); benchEnd(); } }, [actionFlow.status, onWriteSuccess]);
  useEffect(() => { if (actionFlow.status === "error" || approveFlow.status === "error") benchAbort(flow.error ?? "unknown"); }, [actionFlow.status, approveFlow.status, flow.error]);

  // Auto-trigger liquidate after approve confirms
  useEffect(() => {
    if (approveFlow.status === "confirmed" && !autoFired.current && valid && validAddr && address) {
      autoFired.current = true;
      benchMark("step2_start");
      actionFlow.write({ address: contracts.lendingEngine as `0x${string}`, abi: lendingCoreWriteAbi, functionName: "liquidate", args: [borrower as `0x${string}`, parseUnits(amount, 18)] });
    }
  }, [approveFlow.status, valid, validAddr, address, borrower, amount, actionFlow]);

  async function handleLookup() {
    if (!validAddr) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const client = createPublicClient({ transport: http(deploymentManifest.polkadotHubTestnet.rpcUrl) });
      const result = await loadObserverSnapshot(client, borrower);
      setLookupResult(result);
      if (!result) setLookupError("No position found for this address.");
    } catch {
      setLookupError("Failed to look up position.");
    } finally {
      setLookupLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !validAddr || !address) return;
    benchStart("liquidate");
    benchMark("form_validated");
    approveFlow.write({ address: contracts.usdc as `0x${string}`, abi: erc20ApproveAbi, functionName: "approve", args: [contracts.lendingEngine, parseUnits(amount, 18)] });
  }

  const actionLabel = approveFlow.status === "confirmed" ? "Liquidating…" : "Approve & Liquidate";
  const btnText = busy ? (approveFlow.status === "pending" || approveFlow.status === "confirming" ? "Approving…" : "Liquidating…") : valid && validAddr ? `${actionLabel}` : "Enter borrower address and repay amount";

  return (
    <div className="form-container">
      <div className="form-title">Liquidate undercollateralized position</div>
      <div className="form-desc">Repay an undercollateralized borrower's debt at a discount. Receive their collateral plus a liquidation bonus.</div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center", marginBottom: 8 }}>
          <input type="text" className="action-input" placeholder="Borrower 0x address" value={borrower} onChange={e => { setBorrower(e.target.value); setLookupResult(null); setLookupError(null); }} disabled={busy} style={{ flex: 1 }} />
          <button type="button" className="btn-ghost" style={{ fontSize: "var(--text-xs)", padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => { if (address) { setBorrower(address); setLookupResult(null); setLookupError(null); } }} disabled={!address || busy}>
            Use my address
          </button>
          <button type="button" className="btn-ghost" style={{ fontSize: "var(--text-sm)", padding: "6px 10px", whiteSpace: "nowrap" }} onClick={handleLookup} disabled={!validAddr || lookupLoading}>
            {lookupLoading ? "Looking up…" : "Look up"}
          </button>
        </div>
        {borrower.length > 0 && !validAddr && <div className="form-constraint" style={{ color: "var(--c-danger)" }}>Not a valid address.</div>}
        {lookupResult && (
          <div className="lookup-card">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-1)" }}>
              <span style={{ fontWeight: "var(--fw-medium)" }}>Health factor:</span>
              <span style={{ color: lookupResult.healthFactorNumeric !== null && lookupResult.healthFactorNumeric < 1.0 ? "var(--c-danger)" : "var(--c-success)", fontWeight: "var(--fw-semibold)" }}>
                {lookupResult.healthFactorNumeric === null ? "∞" : lookupResult.healthFactor}
              </span>
            </div>
            <div style={{ marginBottom: "var(--sp-1)" }}>Debt: {lookupResult.currentDebt}</div>
            <div style={{ fontWeight: "var(--fw-medium)", color: lookupResult.healthFactorNumeric !== null && lookupResult.healthFactorNumeric < 1.0 ? "var(--c-danger)" : "var(--c-success)" }}>
              {lookupResult.healthFactorNumeric !== null && lookupResult.healthFactorNumeric < 1.0 ? "Is liquidatable" : "Healthy — do not liquidate"}
            </div>
          </div>
        )}
        {lookupError && <div className="form-constraint" style={{ color: "var(--c-warning)" }}>{lookupError}</div>}
        <div className="form-input-row">
          <div className="form-input-wrap">
            <input type="text" inputMode="decimal" className="action-input" placeholder="USDC-test repay amount" value={amount} onChange={e => { setAmount(e.target.value); notified.current = false; autoFired.current = false; approveFlow.reset(); actionFlow.reset(); }} disabled={busy} />
            <span className="form-input-unit">USDC-test</span>
          </div>
        </div>
        {bonusPct && <div className="form-constraint">You receive a {bonusPct} bonus on repaid collateral.</div>}
        {isConnected && <div className="form-gas-row"><span>Estimated gas</span><span>~{gasEstimate} PAS</span></div>}
        <button className="form-cta btn-primary" type="submit" disabled={!valid || !validAddr || !isConnected || busy}>{btnText}</button>
      </form>
      {flow.status === "confirming" && (
        <p className="action-status confirming" style={elapsed > 30 ? { color: "var(--c-warning)" } : undefined}>
          {elapsed > 30 ? "Still confirming — network may be slow " : "Waiting for confirmation… "}
          <span className={`tx-elapsed${elapsed > 30 ? " slow" : ""}`}>[{elapsed}s]</span>
        </p>
      )}
      {actionFlow.status === "confirmed" && <p className="action-status confirmed">Confirmed ✓</p>}
      {(approveFlow.status === "error" || actionFlow.status === "error") && <p className="action-status error">{approveFlow.error || actionFlow.error || "Transaction failed"}</p>}
    </div>
  );
}
