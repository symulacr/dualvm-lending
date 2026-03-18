import { FormEvent, useEffect, useRef, useState } from "react";
import { parseEther, parseUnits, isAddress } from "viem";
import { useAccount } from "wagmi";
import { TxStatusBanner } from "../TxStatusBanner";
import { TxHistoryList } from "../TxHistoryList";
import { useWriteFlow, type TxHistoryEntry } from "../../hooks/useWriteFlow";
import { deploymentManifest } from "../../lib/manifest";
import type { ObserverSnapshot } from "../../lib/readModel";
import {
  erc20ApproveAbi,
  lendingCoreWriteAbi,
  lendingRouterWriteAbi,
  debtPoolWriteAbi,
} from "../../lib/abi";

export type { TxHistoryEntry };

const { contracts } = deploymentManifest;

// Use V2 contracts when available (V2 is the active market version)
const activeLendingCore = contracts.lendingCoreV2 ?? contracts.lendingCore;
const activeDebtPool = contracts.debtPoolV2 ?? contracts.debtPool;
const activeLendingRouter = contracts.lendingRouterV2 ?? contracts.lendingRouter;

function extractAmount(formatted: string): string {
  return (formatted.split(" ")[0] ?? "").replace(/,/g, "");
}

interface FormProps {
  onWriteSuccess?: () => void;
  observer?: ObserverSnapshot | null;
  onTxHistoryEntry?: (entry: TxHistoryEntry) => void;
}

/** Shared hook for approve-then-action two-step flows */
function useApproveAndAction({
  approveLabel,
  actionLabel,
  onWriteSuccess,
  onTxHistoryEntry,
}: {
  approveLabel: string;
  actionLabel: string;
  onWriteSuccess?: () => void;
  onTxHistoryEntry?: (entry: TxHistoryEntry) => void;
}) {
  const approveFlow = useWriteFlow();
  const actionFlow = useWriteFlow();
  const [txHistory, setTxHistory] = useState<TxHistoryEntry[]>([]);
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (approveFlow.status === "confirmed" && approveFlow.txHash) {
      const entry: TxHistoryEntry = { label: approveLabel, txHash: approveFlow.txHash };
      setTxHistory((prev) => (prev.some((e) => e.txHash === entry.txHash) ? prev : [...prev, entry]));
      onTxHistoryEntry?.(entry);
    }
  }, [approveFlow.status, approveFlow.txHash, approveLabel, onTxHistoryEntry]);

  useEffect(() => {
    if (actionFlow.status === "confirmed" && actionFlow.txHash && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess?.();
      onTxHistoryEntry?.({ label: actionLabel, txHash: actionFlow.txHash });
    }
  }, [actionFlow.status, actionFlow.txHash, actionLabel, onWriteSuccess, onTxHistoryEntry]);

  const isApproved = approveFlow.status === "confirmed";

  function reset() {
    approveFlow.reset();
    actionFlow.reset();
    setTxHistory([]);
    notifiedRef.current = false;
  }

  return { approveFlow, actionFlow, isApproved, txHistory, reset };
}

function SupplyLiquidityForm({ onWriteSuccess, onTxHistoryEntry }: FormProps) {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const { approveFlow, actionFlow, isApproved, txHistory, reset } = useApproveAndAction({
    approveLabel: "Approve USDC",
    actionLabel: "Supply USDC-test",
    onWriteSuccess,
    onTxHistoryEntry,
  });

  function handleApprove(e: FormEvent) {
    e.preventDefault();
    if (!amount || !address) return;
    approveFlow.write({ address: contracts.usdc, abi: erc20ApproveAbi, functionName: "approve", args: [activeDebtPool, parseUnits(amount, 18)] });
  }

  function handleDeposit() {
    if (!amount || !address) return;
    actionFlow.write({ address: activeDebtPool, abi: debtPoolWriteAbi, functionName: "deposit", args: [parseUnits(amount, 18), address] });
  }

  return (
    <article className="write-form-card panel-card">
      <h3>Supply Liquidity</h3>
      <form className="write-form" onSubmit={handleApprove}>
        <input className="write-input" type="text" inputMode="decimal" placeholder="USDC-test amount" value={amount}
          onChange={(e) => setAmount(e.target.value)} disabled={approveFlow.status === "pending" || approveFlow.status === "confirming"} />
        {!isApproved ? (
          <button className="action-button" type="submit" disabled={!address || !amount || approveFlow.status === "pending" || approveFlow.status === "confirming"}>1. Approve USDC</button>
        ) : (
          <button className="action-button" type="button" onClick={handleDeposit} disabled={!address || actionFlow.status === "pending" || actionFlow.status === "confirming"}>2. Deposit</button>
        )}
      </form>
      <TxHistoryList entries={txHistory} />
      <TxStatusBanner status={isApproved ? actionFlow.status : approveFlow.status} txHash={isApproved ? actionFlow.txHash : approveFlow.txHash} error={isApproved ? actionFlow.error : approveFlow.error} onReset={reset} />
    </article>
  );
}

function DepositCollateralForm({ onWriteSuccess, onTxHistoryEntry }: FormProps) {
  const { address } = useAccount();
  const flow = useWriteFlow();
  const [amount, setAmount] = useState("");
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (flow.status === "confirmed" && flow.txHash && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess?.();
      onTxHistoryEntry?.({ label: "Deposit PAS (1-click)", txHash: flow.txHash });
    }
  }, [flow.status, flow.txHash, onWriteSuccess, onTxHistoryEntry]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount || !activeLendingRouter) return;
    flow.write({ address: activeLendingRouter, abi: lendingRouterWriteAbi, functionName: "depositCollateralFromPAS", value: parseEther(amount) });
  }

  function handleReset() {
    flow.reset();
    setAmount("");
    notifiedRef.current = false;
  }

  return (
    <article className="write-form-card panel-card">
      <h3>Deposit Collateral</h3>
      <p className="write-form-hint">Wraps native PAS to WPAS and deposits collateral in one transaction.</p>
      <form className="write-form" onSubmit={handleSubmit}>
        <input className="write-input" type="text" inputMode="decimal" placeholder="PAS amount" value={amount}
          onChange={(e) => setAmount(e.target.value)} disabled={flow.status === "pending" || flow.status === "confirming"} />
        <button className="action-button" type="submit" disabled={!address || !amount || !activeLendingRouter || flow.status === "pending" || flow.status === "confirming"}>
          Deposit PAS (1-click)
        </button>
      </form>
      <TxStatusBanner status={flow.status} txHash={flow.txHash} error={flow.error} onReset={handleReset} />
    </article>
  );
}

function BorrowForm({ onWriteSuccess, observer, onTxHistoryEntry }: FormProps) {
  const { address } = useAccount();
  const flow = useWriteFlow();
  const [amount, setAmount] = useState("");
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (flow.status === "confirmed" && flow.txHash && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess?.();
      onTxHistoryEntry?.({ label: "Borrow", txHash: flow.txHash });
    }
  }, [flow.status, flow.txHash, onWriteSuccess, onTxHistoryEntry]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    flow.write({ address: activeLendingCore, abi: lendingCoreWriteAbi, functionName: "borrow", args: [parseUnits(amount, 18)] });
  }

  function handleReset() { flow.reset(); setAmount(""); notifiedRef.current = false; }

  const maxAmount = observer ? extractAmount(observer.availableToBorrow) : null;

  return (
    <article className="write-form-card panel-card">
      <h3>Borrow</h3>
      <form className="write-form" onSubmit={handleSubmit}>
        <div className="write-input-row">
          <input className="write-input" type="text" inputMode="decimal" placeholder="USDC-test borrow amount" value={amount}
            onChange={(e) => setAmount(e.target.value)} disabled={flow.status === "pending" || flow.status === "confirming"} />
          {maxAmount && maxAmount !== "0" && (
            <button type="button" className="max-button" onClick={() => setAmount(maxAmount)} disabled={flow.status === "pending" || flow.status === "confirming"}>Max</button>
          )}
        </div>
        <button className="action-button" type="submit" disabled={!address || !amount || flow.status === "pending" || flow.status === "confirming"}>Borrow</button>
      </form>
      <TxStatusBanner status={flow.status} txHash={flow.txHash} error={flow.error} onReset={handleReset} />
    </article>
  );
}

function RepayForm({ onWriteSuccess, observer, onTxHistoryEntry }: FormProps) {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const { approveFlow, actionFlow, isApproved, txHistory, reset } = useApproveAndAction({
    approveLabel: "Approve USDC",
    actionLabel: "Repay",
    onWriteSuccess,
    onTxHistoryEntry,
  });

  function handleApprove(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    approveFlow.write({ address: contracts.usdc, abi: erc20ApproveAbi, functionName: "approve", args: [activeLendingCore, parseUnits(amount, 18)] });
  }

  function handleRepay() {
    if (!amount) return;
    actionFlow.write({ address: activeLendingCore, abi: lendingCoreWriteAbi, functionName: "repay", args: [parseUnits(amount, 18)] });
  }

  const maxAmount = observer ? extractAmount(observer.currentDebt) : null;
  const isDisabled = approveFlow.status === "pending" || approveFlow.status === "confirming";

  return (
    <article className="write-form-card panel-card">
      <h3>Repay</h3>
      <form className="write-form" onSubmit={handleApprove}>
        <div className="write-input-row">
          <input className="write-input" type="text" inputMode="decimal" placeholder="USDC-test repay amount" value={amount}
            onChange={(e) => setAmount(e.target.value)} disabled={isDisabled} />
          {maxAmount && maxAmount !== "0" && maxAmount !== "0.00" && (
            <button type="button" className="max-button" onClick={() => setAmount(maxAmount)} disabled={isDisabled}>Max</button>
          )}
        </div>
        {!isApproved ? (
          <button className="action-button" type="submit" disabled={!address || !amount || isDisabled}>1. Approve USDC</button>
        ) : (
          <button className="action-button" type="button" onClick={handleRepay} disabled={!address || actionFlow.status === "pending" || actionFlow.status === "confirming"}>2. Repay</button>
        )}
      </form>
      <TxHistoryList entries={txHistory} />
      <TxStatusBanner status={isApproved ? actionFlow.status : approveFlow.status} txHash={isApproved ? actionFlow.txHash : approveFlow.txHash} error={isApproved ? actionFlow.error : approveFlow.error} onReset={reset} />
    </article>
  );
}

function WithdrawCollateralForm({ onWriteSuccess, onTxHistoryEntry }: FormProps) {
  const { address } = useAccount();
  const flow = useWriteFlow();
  const [amount, setAmount] = useState("");
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (flow.status === "confirmed" && flow.txHash && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess?.();
      onTxHistoryEntry?.({ label: "Withdraw Collateral", txHash: flow.txHash });
    }
  }, [flow.status, flow.txHash, onWriteSuccess, onTxHistoryEntry]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    flow.write({ address: activeLendingCore, abi: lendingCoreWriteAbi, functionName: "withdrawCollateral", args: [parseEther(amount)] });
  }

  function handleReset() { flow.reset(); setAmount(""); notifiedRef.current = false; }

  return (
    <article className="write-form-card panel-card">
      <h3>Withdraw Collateral</h3>
      <form className="write-form" onSubmit={handleSubmit}>
        <input className="write-input" type="text" inputMode="decimal" placeholder="WPAS amount to withdraw" value={amount}
          onChange={(e) => setAmount(e.target.value)} disabled={flow.status === "pending" || flow.status === "confirming"} />
        <button className="action-button" type="submit" disabled={!address || !amount || flow.status === "pending" || flow.status === "confirming"}>Withdraw</button>
      </form>
      <TxStatusBanner status={flow.status} txHash={flow.txHash} error={flow.error} onReset={handleReset} />
    </article>
  );
}

function LiquidateForm({ onWriteSuccess, onTxHistoryEntry }: FormProps) {
  const { address } = useAccount();
  const [borrower, setBorrower] = useState("");
  const [amount, setAmount] = useState("");
  const { approveFlow, actionFlow, isApproved, txHistory, reset } = useApproveAndAction({
    approveLabel: "Approve USDC",
    actionLabel: "Liquidate",
    onWriteSuccess,
    onTxHistoryEntry,
  });

  function handleApprove(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    approveFlow.write({ address: contracts.usdc, abi: erc20ApproveAbi, functionName: "approve", args: [activeLendingCore, parseUnits(amount, 18)] });
  }

  function handleLiquidate() {
    if (!amount || !isAddress(borrower)) return;
    actionFlow.write({ address: activeLendingCore, abi: lendingCoreWriteAbi, functionName: "liquidate", args: [borrower as `0x${string}`, parseUnits(amount, 18)] });
  }

  function handleReset() { reset(); setAmount(""); setBorrower(""); }

  return (
    <article className="write-form-card panel-card">
      <h3>Liquidate</h3>
      <form className="write-form write-form-liquidate" onSubmit={handleApprove}>
        <input className="write-input" type="text" placeholder="Borrower 0x address" value={borrower}
          onChange={(e) => setBorrower(e.target.value)} disabled={approveFlow.status === "pending" || approveFlow.status === "confirming"} />
        <input className="write-input" type="text" inputMode="decimal" placeholder="USDC-test repay amount" value={amount}
          onChange={(e) => setAmount(e.target.value)} disabled={approveFlow.status === "pending" || approveFlow.status === "confirming"} />
        {!isApproved ? (
          <button className="action-button" type="submit" disabled={!address || !amount || !isAddress(borrower) || approveFlow.status === "pending" || approveFlow.status === "confirming"}>1. Approve USDC</button>
        ) : (
          <button className="action-button" type="button" onClick={handleLiquidate} disabled={!address || !isAddress(borrower) || actionFlow.status === "pending" || actionFlow.status === "confirming"}>2. Liquidate</button>
        )}
      </form>
      <TxHistoryList entries={txHistory} />
      <TxStatusBanner status={isApproved ? actionFlow.status : approveFlow.status} txHash={isApproved ? actionFlow.txHash : approveFlow.txHash} error={isApproved ? actionFlow.error : approveFlow.error} onReset={handleReset} />
    </article>
  );
}

interface WritePathSectionProps {
  onWriteSuccess?: () => void;
  observer?: ObserverSnapshot | null;
  onTxHistoryEntry?: (entry: TxHistoryEntry) => void;
}

export function WritePathSection({ onWriteSuccess, observer, onTxHistoryEntry }: WritePathSectionProps) {
  const { isConnected } = useAccount();

  return (
    <section className="write-path-section">
      <div className="section-header">
        <h2>Write Path — Lending Operations</h2>
      </div>
      {!isConnected ? (
        <div className="empty-state"><p>Connect your wallet to access lending operations.</p></div>
      ) : (
        <div className="write-forms-grid">
          <SupplyLiquidityForm onWriteSuccess={onWriteSuccess} onTxHistoryEntry={onTxHistoryEntry} />
          <DepositCollateralForm onWriteSuccess={onWriteSuccess} onTxHistoryEntry={onTxHistoryEntry} />
          <BorrowForm onWriteSuccess={onWriteSuccess} observer={observer} onTxHistoryEntry={onTxHistoryEntry} />
          <RepayForm onWriteSuccess={onWriteSuccess} observer={observer} onTxHistoryEntry={onTxHistoryEntry} />
          <WithdrawCollateralForm onWriteSuccess={onWriteSuccess} onTxHistoryEntry={onTxHistoryEntry} />
          <LiquidateForm onWriteSuccess={onWriteSuccess} onTxHistoryEntry={onTxHistoryEntry} />
        </div>
      )}
    </section>
  );
}
