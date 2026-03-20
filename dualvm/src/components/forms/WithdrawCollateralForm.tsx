import { FormEvent, useEffect, useRef, useState } from "react";
import { parseEther } from "viem";
import { useAccount, useGasPrice } from "wagmi";
import { useWriteFlow, useElapsedSeconds } from "../../hooks/useWriteFlow";
import { deploymentManifest } from "../../lib/manifest";
import { lendingCoreWriteAbi } from "../../lib/abi";
import { benchStart, benchMark, benchEnd, benchAbort } from "../../lib/txBench";
import type { ObserverSnapshot } from "../../lib/readModel/types";

const { contracts } = deploymentManifest;

export function WithdrawCollateralForm({ observer, onWriteSuccess }: { observer: ObserverSnapshot | null; onWriteSuccess: (delta?: { debtDelta?: bigint; collateralDelta?: bigint }) => void }) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const flow = useWriteFlow();
  const notified = useRef(false);
  const elapsed = useElapsedSeconds(flow.status === "confirming");

  const { data: gasPrice } = useGasPrice();
  const gasEstimate = gasPrice ? (Number(gasPrice) * 150_000 / 1e18).toFixed(4) : "—";

  const parsed = parseFloat(amount);
  const valid = !Number.isNaN(parsed) && parsed > 0;
  const busy = flow.status === "pending" || flow.status === "confirming";
  const lowHf = observer?.healthFactorNumeric !== null && observer?.healthFactorNumeric !== undefined && observer.healthFactorNumeric < 1.5;

  useEffect(() => { if (flow.status === "confirmed" && !notified.current) { notified.current = true; onWriteSuccess(); benchMark("data_refreshed"); benchEnd(); } }, [flow.status, onWriteSuccess]);
  useEffect(() => { if (flow.status === "error") benchAbort(flow.error ?? "unknown"); }, [flow.status, flow.error]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !address) return;
    benchStart("withdraw");
    benchMark("form_validated");
    flow.write({ address: contracts.lendingEngine as `0x${string}`, abi: lendingCoreWriteAbi, functionName: "withdrawCollateral", args: [parseEther(amount)] });
  }

  const btnText = busy ? "Confirm in wallet…" : valid ? `Withdraw ${amount} WPAS` : "Enter WPAS amount to withdraw";

  return (
    <div className="form-container">
      <div className="form-title">Withdraw WPAS collateral</div>
      <div className="form-desc">Reclaim WPAS. Only allowed if the withdrawal keeps health factor ≥ 1.0.</div>
      <div className="form-hint">Deposited collateral: see position above</div>
      <form onSubmit={handleSubmit}>
        <div className="form-input-row">
          <div className="form-input-wrap">
            <input type="text" inputMode="decimal" className="action-input" placeholder="WPAS amount to withdraw" value={amount} onChange={e => { setAmount(e.target.value); notified.current = false; flow.reset(); }} disabled={busy} />
            <span className="form-input-unit">WPAS</span>
          </div>
        </div>
        {lowHf && <div className="form-constraint violated">⚠ Health factor is low — withdrawal may revert.</div>}
        {isConnected && <div className="form-gas-row"><span>Estimated gas</span><span>~{gasEstimate} PAS</span></div>}
        <button className="form-cta btn-primary" type="submit" disabled={!valid || !isConnected || busy}>{btnText}</button>
      </form>
      {flow.status === "confirming" && (
        <p className="action-status confirming" style={elapsed > 30 ? { color: "var(--c-warning)" } : undefined}>
          {elapsed > 30 ? "Still confirming — network may be slow " : "Waiting for confirmation… "}
          <span className={`tx-elapsed${elapsed > 30 ? " slow" : ""}`}>[{elapsed}s]</span>
        </p>
      )}
      {flow.status === "confirmed" && <p className="action-status confirmed">Confirmed ✓</p>}
      {flow.status === "error" && <p className="action-status error">{flow.error ?? "Transaction failed"}</p>}
    </div>
  );
}
