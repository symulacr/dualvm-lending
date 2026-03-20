import { FormEvent, useEffect, useRef, useState } from "react";
import { parseUnits, erc20Abi } from "viem";
import { useAccount, useReadContract, useGasPrice } from "wagmi";
import { useWriteFlow, useElapsedSeconds } from "../../hooks/useWriteFlow";
import { deploymentManifest } from "../../lib/manifest";
import { erc20ApproveAbi, debtPoolWriteAbi } from "../../lib/abi";
import { benchStart, benchMark, benchEnd, benchAbort } from "../../lib/txBench";
import { extractNumeric } from "../../lib/format";
import type { MarketSnapshot } from "../../lib/readModel/types";

const { contracts } = deploymentManifest;

export function SupplyLiquidityForm({ snapshot, onWriteSuccess }: { snapshot: MarketSnapshot | null; onWriteSuccess: (delta?: { debtDelta?: bigint; collateralDelta?: bigint }) => void }) {
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
  const parsed = parseFloat(amount);
  const valid = !Number.isNaN(parsed) && parsed > 0;
  const isApproved = approveFlow.status === "confirmed";
  const flow = !isApproved ? approveFlow : actionFlow;
  const elapsed = useElapsedSeconds(flow.status === "confirming");
  const busy = flow.status === "pending" || flow.status === "confirming";

  const autoFired = useRef(false);

  useEffect(() => { if (actionFlow.status === "confirmed" && !notified.current) { notified.current = true; onWriteSuccess(); benchMark("data_refreshed"); benchEnd(); } }, [actionFlow.status, onWriteSuccess]);
  useEffect(() => { if (actionFlow.status === "error" || approveFlow.status === "error") benchAbort(flow.error ?? "unknown"); }, [actionFlow.status, approveFlow.status, flow.error]);

  // Auto-trigger supply after approve confirms
  useEffect(() => {
    if (approveFlow.status === "confirmed" && !autoFired.current && valid && address) {
      autoFired.current = true;
      benchMark("step2_start");
      actionFlow.write({ address: contracts.debtPool as `0x${string}`, abi: debtPoolWriteAbi, functionName: "deposit", args: [parseUnits(amount, 18), address] });
    }
  }, [approveFlow.status, valid, address, amount, actionFlow]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !address) return;
    const parsedAmt = parseUnits(amount, 18);
    benchStart("supply");
    benchMark("form_validated");
    approveFlow.write({ address: contracts.usdc as `0x${string}`, abi: erc20ApproveAbi, functionName: "approve", args: [contracts.debtPool, parsedAmt] });
  }

  const maxVal = usdcRaw ? (Number(usdcRaw) / 1e18).toFixed(2) : null;
  const actionLabel = approveFlow.status === "confirmed" ? "Supplying…" : "Approve & Supply";
  const btnText = busy ? (approveFlow.status === "pending" || approveFlow.status === "confirming" ? "Approving…" : "Supplying…") : valid ? `${actionLabel} ${amount} USDC-test` : "Enter USDC-test amount to supply";

  return (
    <div className="form-container">
      <div className="form-title">Supply USDC-test liquidity</div>
      <div className="form-desc">Deposit USDC-test to earn borrow interest. Withdraw any time up to available pool liquidity.</div>
      <div className="form-hint">Wallet: {usdcBal} USDC-test</div>
      {usdcRaw !== undefined && usdcRaw === 0n && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--c-text-tertiary)", fontStyle: "italic", marginBottom: 6 }}>
          Need USDC-test? Use the faucet button above — it mints test tokens to your wallet.
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div className="form-input-row">
          <div className="form-input-wrap">
            <input type="text" inputMode="decimal" className="action-input" placeholder="USDC-test amount" value={amount} onChange={e => { setAmount(e.target.value); notified.current = false; autoFired.current = false; approveFlow.reset(); actionFlow.reset(); }} disabled={busy} />
            <span className="form-input-unit">USDC-test</span>
          </div>
          {maxVal && parseFloat(maxVal) > 0 && <button type="button" className="form-max-btn btn-secondary" onClick={() => setAmount(maxVal)} disabled={busy}>Max</button>}
        </div>
        {snapshot?.borrowCap && <div className="form-constraint">Pool supply cap: {snapshot.borrowCap}</div>}
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
