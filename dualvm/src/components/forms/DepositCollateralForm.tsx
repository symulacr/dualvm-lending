import { FormEvent, useEffect, useRef, useState } from "react";
import { parseEther } from "viem";
import { useAccount, useBalance, useGasPrice } from "wagmi";
import { useWriteFlow, useElapsedSeconds } from "../../hooks/useWriteFlow";
import { useFaucet } from "../../hooks/useFaucet";
import { deploymentManifest } from "../../lib/manifest";
import { lendingRouterWriteAbi } from "../../lib/abi";
import { benchStart, benchMark, benchEnd, benchAbort } from "../../lib/txBench";
import { perf } from "../../lib/perf";
import type { MarketSnapshot } from "../../lib/readModel/types";

const { contracts } = deploymentManifest;

export function DepositCollateralForm({ snapshot, onWriteSuccess }: { snapshot: MarketSnapshot | null; onWriteSuccess: (delta?: { debtDelta?: bigint; collateralDelta?: bigint }) => void }) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const flow = useWriteFlow();
  const faucet = useFaucet();
  const notified = useRef(false);

  const elapsed = useElapsedSeconds(flow.status === "confirming");

  const { data: gasPrice } = useGasPrice();
  const gasEstimate = gasPrice ? (Number(gasPrice) * 150_000 / 1e18).toFixed(4) : "—";

  const { data: pasBalance } = useBalance({ address, query: { refetchInterval: 15_000 } });
  const balDisplay = pasBalance?.formatted ? (Number.isNaN(Number(pasBalance.formatted)) ? "—" : `${Number(pasBalance.formatted).toFixed(4)} PAS`) : "—";

  const parsed = parseFloat(amount);
  const valid = !Number.isNaN(parsed) && parsed > 0;
  const busy = flow.status === "pending" || flow.status === "confirming";

  const maxVal = (() => {
    if (!pasBalance?.formatted) return null;
    const n = parseFloat(pasBalance.formatted);
    if (Number.isNaN(n)) return null;
    const net = n - 0.01;
    return net > 0 ? net.toFixed(4) : null;
  })();

  useEffect(() => { if (flow.status === "confirmed" && !notified.current) { notified.current = true; onWriteSuccess({ collateralDelta: parseEther(amount) }); benchMark("data_refreshed"); benchEnd(); } }, [flow.status, onWriteSuccess, amount]);
  useEffect(() => { if (flow.status === "error") benchAbort(flow.error ?? "unknown"); }, [flow.status, flow.error]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !address || !contracts.lendingRouter) return;
    benchStart("deposit");
    benchMark("form_validated");
    perf.ui.transition("DepositForm", "idle", "submitting", { amount });
    flow.write({ address: contracts.lendingRouter as `0x${string}`, abi: lendingRouterWriteAbi, functionName: "depositCollateralFromPAS", value: parseEther(amount) });
  }

  const btnText = busy ? "Confirm in wallet…" : flow.status === "confirming" ? "Confirming…" : valid ? `Deposit ${amount} PAS as WPAS` : "Enter PAS amount to deposit";

  return (
    <div className="form-container">
      <div className="form-title">Deposit WPAS collateral</div>
      <div className="form-desc">Wrap PAS to WPAS in one step. Your collateral is locked — it earns no yield but unlocks USDC-test borrowing capacity.</div>
      <div className="form-hint">
        Wallet: {balDisplay}
        {pasBalance?.formatted && parseFloat(pasBalance.formatted) < 0.1 && (
          <>
            {"  ·  "}
            <button
              type="button"
              className="faucet-inline-link"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}
              onClick={faucet.claim}
              disabled={faucet.state === "loading" || faucet.state === "success"}
            >
              {faucet.state === "loading" ? "Claiming…" : faucet.state === "success" ? "Tokens sent ✓" : "↗ Get tokens"}
            </button>
          </>
        )}
      </div>
      <form onSubmit={handleSubmit}>
        <div className="form-input-row">
          <div className="form-input-wrap">
            <input type="text" inputMode="decimal" className="action-input" placeholder="PAS amount" value={amount} onChange={e => { setAmount(e.target.value); notified.current = false; flow.reset(); }} disabled={busy} />
            <span className="form-input-unit">PAS</span>
          </div>
          {maxVal && <button type="button" className="form-max-btn btn-secondary" onClick={() => setAmount(maxVal)} disabled={busy}>Max</button>}
        </div>
        <div className="form-constraint">Min deposit: 0.001 PAS</div>
        {snapshot?.borrowCap && <div className="form-constraint">Borrow cap: {snapshot.borrowCap}</div>}
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
