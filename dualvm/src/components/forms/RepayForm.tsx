import { FormEvent, useEffect, useRef, useState } from "react";
import { parseUnits, erc20Abi } from "viem";
import { useAccount, useReadContract, useGasPrice } from "wagmi";
import { useWriteFlow, useElapsedSeconds } from "../../hooks/useWriteFlow";
import { deploymentManifest } from "../../lib/manifest";
import { erc20ApproveAbi, lendingCoreWriteAbi } from "../../lib/abi";
import { benchStart, benchMark, benchEnd, benchAbort } from "../../lib/txBench";
import { extractNumeric } from "../../lib/format";
import type { ObserverSnapshot } from "../../lib/readModel/types";

const { contracts } = deploymentManifest;

export function RepayForm({ observer, onWriteSuccess }: { observer: ObserverSnapshot | null; onWriteSuccess: (delta?: { debtDelta?: bigint; collateralDelta?: bigint }) => void }) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const approveFlow = useWriteFlow();
  const actionFlow = useWriteFlow();
  const notified = useRef(false);

  const { data: gasPrice } = useGasPrice();
  const gasEstimate = gasPrice ? (Number(gasPrice) * 200_000 / 1e18).toFixed(4) : "—";

  const { data: usdcRaw } = useReadContract({
    address: contracts.usdc as `0x${string}`, abi: erc20Abi, functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const usdcBal = usdcRaw ? (Number(usdcRaw) / 1e18).toFixed(2) : "—";
  const debtStr = observer?.currentDebt ?? "—";
  const debtNum = extractNumeric(debtStr);
  const parsed = parseFloat(amount);
  const valid = !Number.isNaN(parsed) && parsed > 0;
  const isApproved = approveFlow.status === "confirmed";
  const flow = !isApproved ? approveFlow : actionFlow;
  const elapsed = useElapsedSeconds(flow.status === "confirming");
  const busy = flow.status === "pending" || flow.status === "confirming";
  const exceedsDebt = valid && parseFloat(debtNum) > 0 && parsed > parseFloat(debtNum);

  const autoFired = useRef(false);

  useEffect(() => { if (actionFlow.status === "confirmed" && !notified.current) { notified.current = true; onWriteSuccess({ debtDelta: -parseUnits(amount, 18) }); benchMark("data_refreshed"); benchEnd(); } }, [actionFlow.status, onWriteSuccess, amount]);
  useEffect(() => { if (actionFlow.status === "error" || approveFlow.status === "error") benchAbort(flow.error ?? "unknown"); }, [actionFlow.status, approveFlow.status, flow.error]);

  // Auto-trigger repay after approve confirms
  useEffect(() => {
    if (approveFlow.status === "confirmed" && !autoFired.current && valid && address) {
      autoFired.current = true;
      benchMark("step2_start");
      actionFlow.write({ address: contracts.lendingEngine as `0x${string}`, abi: lendingCoreWriteAbi, functionName: "repay", args: [parseUnits(amount, 18)] });
    }
  }, [approveFlow.status, valid, address, amount, actionFlow]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !address) return;
    benchStart("repay");
    benchMark("form_validated");
    approveFlow.write({ address: contracts.usdc as `0x${string}`, abi: erc20ApproveAbi, functionName: "approve", args: [contracts.lendingEngine, parseUnits(amount, 18)] });
  }

  const maxVal = debtNum !== "0" && debtNum !== "0.00" ? debtNum : null;
  const actionLabel = approveFlow.status === "confirmed" ? "Repaying…" : "Approve & Repay";
  const btnText = busy ? (approveFlow.status === "pending" || approveFlow.status === "confirming" ? "Approving…" : "Repaying…") : valid ? `${actionLabel} ${amount} USDC-test` : "Enter USDC-test amount to repay";

  return (
    <div className="form-container">
      <div className="form-title">Repay USDC-test debt</div>
      <div className="form-desc">Reduce your USDC-test debt and improve your health factor. Full repayment clears the position.</div>
      <div className="form-hint">Outstanding debt: {debtStr}</div>
      <div className="form-hint">Wallet: {usdcBal} USDC-test</div>
      <form onSubmit={handleSubmit}>
        <div className="form-input-row">
          <div className="form-input-wrap">
            <input type="text" inputMode="decimal" className="action-input" placeholder="USDC-test repay amount" value={amount} onChange={e => { setAmount(e.target.value); notified.current = false; autoFired.current = false; approveFlow.reset(); actionFlow.reset(); }} disabled={busy} />
            <span className="form-input-unit">USDC-test</span>
          </div>
          {maxVal && <button type="button" className="form-max-btn btn-secondary" onClick={() => setAmount(maxVal)} disabled={busy}>Max</button>}
        </div>
        {exceedsDebt && <div className="form-constraint violated">Exceeds current debt — any surplus is returned.</div>}
        {isConnected && <div className="form-gas-row"><span>Estimated gas</span><span>~{gasEstimate} PAS</span></div>}
        <button className="form-cta btn-primary" type="submit" disabled={!valid || !isConnected || busy}>{btnText}</button>
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
