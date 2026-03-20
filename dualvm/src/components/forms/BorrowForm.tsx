import { FormEvent, useEffect, useRef, useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useGasPrice } from "wagmi";
import { useWriteFlow, useElapsedSeconds } from "../../hooks/useWriteFlow";
import { deploymentManifest } from "../../lib/manifest";
import { lendingCoreWriteAbi } from "../../lib/abi";
import { benchStart, benchMark, benchEnd, benchAbort } from "../../lib/txBench";
import { extractNumeric } from "../../lib/format";
import type { MarketSnapshot, ObserverSnapshot } from "../../lib/readModel/types";

const { contracts } = deploymentManifest;

export function BorrowForm({ snapshot, observer, onWriteSuccess }: { snapshot: MarketSnapshot | null; observer: ObserverSnapshot | null; onWriteSuccess: (delta?: { debtDelta?: bigint; collateralDelta?: bigint }) => void }) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const flow = useWriteFlow();
  const notified = useRef(false);
  const elapsed = useElapsedSeconds(flow.status === "confirming");

  const { data: gasPrice } = useGasPrice();
  const gasEstimate = gasPrice ? (Number(gasPrice) * 150_000 / 1e18).toFixed(4) : "—";

  const available = observer?.availableToBorrow ?? null;
  const availNum = available ? extractNumeric(available, "dash") : "";
  const parsed = parseFloat(amount);
  const valid = !Number.isNaN(parsed) && parsed > 0;
  const busy = flow.status === "pending" || flow.status === "confirming";
  const oracleStale = snapshot?.oracleFresh === "stale";

  const minBorrow = snapshot?.minBorrowAmount ? extractNumeric(snapshot.minBorrowAmount) : "0";
  const minBorrowNum = parseFloat(minBorrow);
  const belowMin = valid && minBorrowNum > 0 && parsed < minBorrowNum;
  const exceedsAvailable = valid && availNum !== "" && parseFloat(availNum) > 0 && parsed > parseFloat(availNum);

  useEffect(() => { if (flow.status === "confirmed" && !notified.current) { notified.current = true; onWriteSuccess({ debtDelta: parseUnits(amount, 18) }); benchMark("data_refreshed"); benchEnd(); } }, [flow.status, onWriteSuccess, amount]);
  useEffect(() => { if (flow.status === "error") benchAbort(flow.error ?? "unknown"); }, [flow.status, flow.error]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !address || !observer) return;
    benchStart("borrow");
    benchMark("form_validated");
    flow.write({ address: contracts.lendingEngine as `0x${string}`, abi: lendingCoreWriteAbi, functionName: "borrow", args: [parseUnits(amount, 18)] });
  }

  const maxVal = availNum && availNum !== "0" && availNum !== "0.00" ? availNum : null;
  const btnText = busy ? "Confirm in wallet…" : valid ? `Borrow ${amount} USDC-test` : "Enter USDC-test amount to borrow";

  return (
    <div className="form-container">
      <div className="form-title">Borrow USDC-test</div>
      <div className="form-desc">Draw USDC-test against your WPAS collateral. Interest accrues every block — keep health factor above 1.0.</div>
      <div className="form-hint">{observer ? `Available to borrow: ${available}` : "Connect wallet and deposit collateral to unlock borrowing."}</div>
      <form onSubmit={handleSubmit}>
        <div className="form-input-row">
          <div className="form-input-wrap">
            <input type="text" inputMode="decimal" className="action-input" placeholder="USDC-test borrow amount" value={amount} onChange={e => { setAmount(e.target.value); notified.current = false; flow.reset(); }} disabled={busy} />
            <span className="form-input-unit">USDC-test</span>
          </div>
          {maxVal && <button type="button" className="form-max-btn btn-secondary" onClick={() => setAmount(maxVal)} disabled={busy}>Max</button>}
        </div>
        {belowMin && <div className="form-constraint violated">Below minimum borrow amount ({snapshot?.minBorrowAmount})</div>}
        {oracleStale && <div className="form-constraint violated">Oracle is stale — borrow transactions will revert until the price is updated.</div>}
        {exceedsAvailable && <div className="form-constraint violated">Exceeds available borrow capacity ({available})</div>}
        {isConnected && <div className="form-gas-row"><span>Estimated gas</span><span>~{gasEstimate} PAS</span></div>}
        <button className="form-cta btn-primary" type="submit" disabled={!valid || !isConnected || !observer || busy}>{btnText}</button>
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
