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
  wpasWriteAbi,
  lendingCoreWriteAbi,
  lendingRouterWriteAbi,
  debtPoolWriteAbi,
  usdcMintAbi,
} from "../../lib/abi";

const { contracts } = deploymentManifest;

/** Extract plain numeric string from formatted amounts like "100.00 USDC-test" → "100.00" */
function extractAmount(formatted: string): string {
  return formatted.split(" ")[0] ?? "";
}

interface FormProps {
  onWriteSuccess?: () => void;
  observer?: ObserverSnapshot | null;
}

/* ──────────────────────────────────────────────────────────────────── */
/* Supply Liquidity: USDC-test approve + DebtPool.deposit()           */
/* ──────────────────────────────────────────────────────────────────── */

function SupplyLiquidityForm({ onWriteSuccess }: FormProps) {
  const { address } = useAccount();
  const approveFlow = useWriteFlow();
  const depositFlow = useWriteFlow();
  const [amount, setAmount] = useState("");
  const [txHistory, setTxHistory] = useState<TxHistoryEntry[]>([]);
  const notifiedRef = useRef(false);

  const isApproved = approveFlow.status === "confirmed";

  // Track completed approve step in history
  useEffect(() => {
    if (approveFlow.status === "confirmed" && approveFlow.txHash) {
      setTxHistory((prev) => {
        if (prev.some((e) => e.txHash === approveFlow.txHash)) return prev;
        return [...prev, { label: "Approve USDC", txHash: approveFlow.txHash! }];
      });
    }
  }, [approveFlow.status, approveFlow.txHash]);

  // Notify parent when final deposit confirms
  useEffect(() => {
    if (depositFlow.status === "confirmed" && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess?.();
    }
  }, [depositFlow.status, onWriteSuccess]);

  function handleApprove(e: FormEvent) {
    e.preventDefault();
    if (!amount || !address) return;
    const parsed = parseUnits(amount, 18);
    approveFlow.write({
      address: contracts.usdc,
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [contracts.debtPool, parsed],
    });
  }

  function handleDeposit() {
    if (!amount || !address) return;
    const parsed = parseUnits(amount, 18);
    depositFlow.write({
      address: contracts.debtPool,
      abi: debtPoolWriteAbi,
      functionName: "deposit",
      args: [parsed, address],
    });
  }

  function handleReset() {
    approveFlow.reset();
    depositFlow.reset();
    setAmount("");
    setTxHistory([]);
    notifiedRef.current = false;
  }

  return (
    <article className="write-form-card panel-card">
      <h3>Supply Liquidity</h3>
      <p className="write-form-hint">Approve and deposit USDC-test into the DebtPool (ERC-4626 LP vault).</p>
      <form className="write-form" onSubmit={handleApprove}>
        <input
          className="write-input"
          type="text"
          inputMode="decimal"
          placeholder="USDC-test amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={approveFlow.status === "pending" || approveFlow.status === "confirming"}
        />
        {!isApproved ? (
          <button
            className="action-button"
            type="submit"
            disabled={!address || !amount || approveFlow.status === "pending" || approveFlow.status === "confirming"}
          >
            1. Approve USDC
          </button>
        ) : (
          <button
            className="action-button"
            type="button"
            onClick={handleDeposit}
            disabled={!address || depositFlow.status === "pending" || depositFlow.status === "confirming"}
          >
            2. Deposit
          </button>
        )}
      </form>
      <TxHistoryList entries={txHistory} />
      <TxStatusBanner
        status={isApproved ? depositFlow.status : approveFlow.status}
        txHash={isApproved ? depositFlow.txHash : approveFlow.txHash}
        error={isApproved ? depositFlow.error : approveFlow.error}
        onReset={handleReset}
      />
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Deposit Collateral: PAS → WPAS wrap + approve + depositCollateral  */
/* ──────────────────────────────────────────────────────────────────── */

function DepositCollateralForm({ onWriteSuccess }: FormProps) {
  const { address } = useAccount();

  // ── 1-click flow (LendingRouter) ────────────────────────────────── //
  const oneClickFlow = useWriteFlow();
  const [oneClickAmount, setOneClickAmount] = useState("");
  const oneClickNotifiedRef = useRef(false);

  useEffect(() => {
    if (oneClickFlow.status === "confirmed" && !oneClickNotifiedRef.current) {
      oneClickNotifiedRef.current = true;
      onWriteSuccess?.();
    }
  }, [oneClickFlow.status, onWriteSuccess]);

  function handleOneClick(e: FormEvent) {
    e.preventDefault();
    if (!oneClickAmount || !contracts.lendingRouter) return;
    const parsed = parseEther(oneClickAmount);
    oneClickFlow.write({
      address: contracts.lendingRouter,
      abi: lendingRouterWriteAbi,
      functionName: "depositCollateralFromPAS",
      value: parsed,
    });
  }

  function handleOneClickReset() {
    oneClickFlow.reset();
    setOneClickAmount("");
    oneClickNotifiedRef.current = false;
  }

  // ── 3-step fallback flow ─────────────────────────────────────────── //
  const wrapFlow = useWriteFlow();
  const approveFlow = useWriteFlow();
  const depositFlow = useWriteFlow();
  const [amount, setAmount] = useState("");
  const [txHistory, setTxHistory] = useState<TxHistoryEntry[]>([]);
  const notifiedRef = useRef(false);

  type Step = "wrap" | "approve" | "deposit";
  const step: Step =
    depositFlow.status === "confirmed" || approveFlow.status === "confirmed"
      ? approveFlow.status === "confirmed"
        ? "deposit"
        : "approve"
      : wrapFlow.status === "confirmed"
        ? "approve"
        : "wrap";

  // Track completed wrap step in history
  useEffect(() => {
    if (wrapFlow.status === "confirmed" && wrapFlow.txHash) {
      setTxHistory((prev) => {
        if (prev.some((e) => e.txHash === wrapFlow.txHash)) return prev;
        return [...prev, { label: "Wrap PAS → WPAS", txHash: wrapFlow.txHash! }];
      });
    }
  }, [wrapFlow.status, wrapFlow.txHash]);

  // Track completed approve step in history
  useEffect(() => {
    if (approveFlow.status === "confirmed" && approveFlow.txHash) {
      setTxHistory((prev) => {
        if (prev.some((e) => e.txHash === approveFlow.txHash)) return prev;
        return [...prev, { label: "Approve WPAS", txHash: approveFlow.txHash! }];
      });
    }
  }, [approveFlow.status, approveFlow.txHash]);

  // Notify parent when final deposit confirms
  useEffect(() => {
    if (depositFlow.status === "confirmed" && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess?.();
    }
  }, [depositFlow.status, onWriteSuccess]);

  function handleWrap(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    const parsed = parseEther(amount);
    wrapFlow.write({
      address: contracts.wpas,
      abi: wpasWriteAbi,
      functionName: "deposit",
      value: parsed,
    });
  }

  function handleApprove() {
    if (!amount) return;
    const parsed = parseEther(amount);
    approveFlow.write({
      address: contracts.wpas,
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [contracts.lendingCore, parsed],
    });
  }

  function handleDeposit() {
    if (!amount) return;
    const parsed = parseEther(amount);
    depositFlow.write({
      address: contracts.lendingCore,
      abi: lendingCoreWriteAbi,
      functionName: "depositCollateral",
      args: [parsed],
    });
  }

  function handleReset() {
    wrapFlow.reset();
    approveFlow.reset();
    depositFlow.reset();
    setAmount("");
    setTxHistory([]);
    notifiedRef.current = false;
  }

  const activeFlow =
    step === "deposit" ? depositFlow : step === "approve" ? approveFlow : wrapFlow;

  return (
    <article className="write-form-card panel-card">
      <h3>Deposit Collateral</h3>
      <p className="write-form-hint">
        Wrap native PAS into WPAS, approve, and deposit collateral into LendingCore.
      </p>

      {/* ── 1-click option (only shown when LendingRouter is deployed) ── */}
      {contracts.lendingRouter && (
        <div className="write-form-oneclick">
          <p className="write-form-hint write-form-hint--accent">⚡ Deposit PAS (1-click) — wraps &amp; deposits in one TX</p>
          <form className="write-form" onSubmit={handleOneClick}>
            <input
              className="write-input"
              type="text"
              inputMode="decimal"
              placeholder="PAS amount"
              value={oneClickAmount}
              onChange={(e) => setOneClickAmount(e.target.value)}
              disabled={oneClickFlow.status === "pending" || oneClickFlow.status === "confirming"}
            />
            <button
              className="action-button action-button--accent"
              type="submit"
              disabled={
                !address ||
                !oneClickAmount ||
                oneClickFlow.status === "pending" ||
                oneClickFlow.status === "confirming"
              }
            >
              Deposit PAS (1-click)
            </button>
          </form>
          <TxStatusBanner
            status={oneClickFlow.status}
            txHash={oneClickFlow.txHash}
            error={oneClickFlow.error}
            onReset={handleOneClickReset}
          />
          <hr className="write-form-divider" />
        </div>
      )}

      {/* ── 3-step fallback ──────────────────────────────────────────── */}
      {contracts.lendingRouter && (
        <p className="write-form-hint write-form-hint--muted">Or use the manual 3-step flow:</p>
      )}
      <form className="write-form" onSubmit={handleWrap}>
        <input
          className="write-input"
          type="text"
          inputMode="decimal"
          placeholder="PAS amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={activeFlow.status === "pending" || activeFlow.status === "confirming"}
        />
        {step === "wrap" && (
          <button
            className="action-button"
            type="submit"
            disabled={!address || !amount || wrapFlow.status === "pending" || wrapFlow.status === "confirming"}
          >
            1. Wrap PAS → WPAS
          </button>
        )}
        {step === "approve" && (
          <button
            className="action-button"
            type="button"
            onClick={handleApprove}
            disabled={!address || approveFlow.status === "pending" || approveFlow.status === "confirming"}
          >
            2. Approve WPAS
          </button>
        )}
        {step === "deposit" && (
          <button
            className="action-button"
            type="button"
            onClick={handleDeposit}
            disabled={!address || depositFlow.status === "pending" || depositFlow.status === "confirming"}
          >
            3. Deposit Collateral
          </button>
        )}
      </form>
      <TxHistoryList entries={txHistory} />
      <TxStatusBanner
        status={activeFlow.status}
        txHash={activeFlow.txHash}
        error={activeFlow.error}
        onReset={handleReset}
      />
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Borrow: LendingCore.borrow(amount)                                 */
/* ──────────────────────────────────────────────────────────────────── */

function BorrowForm({ onWriteSuccess, observer }: FormProps) {
  const { address } = useAccount();
  const flow = useWriteFlow();
  const [amount, setAmount] = useState("");
  const notifiedRef = useRef(false);

  // Notify parent when borrow confirms
  useEffect(() => {
    if (flow.status === "confirmed" && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess?.();
    }
  }, [flow.status, onWriteSuccess]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    const parsed = parseUnits(amount, 18);
    flow.write({
      address: contracts.lendingCore,
      abi: lendingCoreWriteAbi,
      functionName: "borrow",
      args: [parsed],
    });
  }

  function handleReset() {
    flow.reset();
    setAmount("");
    notifiedRef.current = false;
  }

  const maxAmount = observer ? extractAmount(observer.availableToBorrow) : null;

  return (
    <article className="write-form-card panel-card">
      <h3>Borrow</h3>
      <p className="write-form-hint">Draw USDC-test debt against your deposited WPAS collateral.</p>
      <form className="write-form" onSubmit={handleSubmit}>
        <div className="write-input-row">
          <input
            className="write-input"
            type="text"
            inputMode="decimal"
            placeholder="USDC-test borrow amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={flow.status === "pending" || flow.status === "confirming"}
          />
          {maxAmount && maxAmount !== "0" && (
            <button
              type="button"
              className="max-button"
              onClick={() => setAmount(maxAmount)}
              disabled={flow.status === "pending" || flow.status === "confirming"}
            >
              Max
            </button>
          )}
        </div>
        <button
          className="action-button"
          type="submit"
          disabled={!address || !amount || flow.status === "pending" || flow.status === "confirming"}
        >
          Borrow
        </button>
      </form>
      <TxStatusBanner status={flow.status} txHash={flow.txHash} error={flow.error} onReset={handleReset} />
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Repay: USDC-test approve + LendingCore.repay(amount)               */
/* ──────────────────────────────────────────────────────────────────── */

function RepayForm({ onWriteSuccess, observer }: FormProps) {
  const { address } = useAccount();
  const approveFlow = useWriteFlow();
  const repayFlow = useWriteFlow();
  const [amount, setAmount] = useState("");
  const [txHistory, setTxHistory] = useState<TxHistoryEntry[]>([]);
  const notifiedRef = useRef(false);

  const isApproved = approveFlow.status === "confirmed";

  // Track completed approve step in history
  useEffect(() => {
    if (approveFlow.status === "confirmed" && approveFlow.txHash) {
      setTxHistory((prev) => {
        if (prev.some((e) => e.txHash === approveFlow.txHash)) return prev;
        return [...prev, { label: "Approve USDC", txHash: approveFlow.txHash! }];
      });
    }
  }, [approveFlow.status, approveFlow.txHash]);

  // Notify parent when final repay confirms
  useEffect(() => {
    if (repayFlow.status === "confirmed" && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess?.();
    }
  }, [repayFlow.status, onWriteSuccess]);

  function handleApprove(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    const parsed = parseUnits(amount, 18);
    approveFlow.write({
      address: contracts.usdc,
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [contracts.lendingCore, parsed],
    });
  }

  function handleRepay() {
    if (!amount) return;
    const parsed = parseUnits(amount, 18);
    repayFlow.write({
      address: contracts.lendingCore,
      abi: lendingCoreWriteAbi,
      functionName: "repay",
      args: [parsed],
    });
  }

  function handleReset() {
    approveFlow.reset();
    repayFlow.reset();
    setAmount("");
    setTxHistory([]);
    notifiedRef.current = false;
  }

  const maxAmount = observer ? extractAmount(observer.currentDebt) : null;
  const isDisabled = approveFlow.status === "pending" || approveFlow.status === "confirming";

  return (
    <article className="write-form-card panel-card">
      <h3>Repay</h3>
      <p className="write-form-hint">Approve and repay USDC-test debt. Interest is repaid first, then principal.</p>
      <form className="write-form" onSubmit={handleApprove}>
        <div className="write-input-row">
          <input
            className="write-input"
            type="text"
            inputMode="decimal"
            placeholder="USDC-test repay amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isDisabled}
          />
          {maxAmount && maxAmount !== "0" && maxAmount !== "0.00" && (
            <button
              type="button"
              className="max-button"
              onClick={() => setAmount(maxAmount)}
              disabled={isDisabled}
            >
              Max
            </button>
          )}
        </div>
        {!isApproved ? (
          <button
            className="action-button"
            type="submit"
            disabled={!address || !amount || approveFlow.status === "pending" || approveFlow.status === "confirming"}
          >
            1. Approve USDC
          </button>
        ) : (
          <button
            className="action-button"
            type="button"
            onClick={handleRepay}
            disabled={!address || repayFlow.status === "pending" || repayFlow.status === "confirming"}
          >
            2. Repay
          </button>
        )}
      </form>
      <TxHistoryList entries={txHistory} />
      <TxStatusBanner
        status={isApproved ? repayFlow.status : approveFlow.status}
        txHash={isApproved ? repayFlow.txHash : approveFlow.txHash}
        error={isApproved ? repayFlow.error : approveFlow.error}
        onReset={handleReset}
      />
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Withdraw Collateral: LendingCore.withdrawCollateral(amount)        */
/* ──────────────────────────────────────────────────────────────────── */

function WithdrawCollateralForm({ onWriteSuccess }: FormProps) {
  const { address } = useAccount();
  const flow = useWriteFlow();
  const [amount, setAmount] = useState("");
  const notifiedRef = useRef(false);

  // Notify parent when withdraw confirms
  useEffect(() => {
    if (flow.status === "confirmed" && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess?.();
    }
  }, [flow.status, onWriteSuccess]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    const parsed = parseEther(amount);
    flow.write({
      address: contracts.lendingCore,
      abi: lendingCoreWriteAbi,
      functionName: "withdrawCollateral",
      args: [parsed],
    });
  }

  function handleReset() {
    flow.reset();
    setAmount("");
    notifiedRef.current = false;
  }

  return (
    <article className="write-form-card panel-card">
      <h3>Withdraw Collateral</h3>
      <p className="write-form-hint">Withdraw WPAS collateral. Blocked if it would make the position unsafe.</p>
      <form className="write-form" onSubmit={handleSubmit}>
        <input
          className="write-input"
          type="text"
          inputMode="decimal"
          placeholder="WPAS amount to withdraw"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={flow.status === "pending" || flow.status === "confirming"}
        />
        <button
          className="action-button"
          type="submit"
          disabled={!address || !amount || flow.status === "pending" || flow.status === "confirming"}
        >
          Withdraw
        </button>
      </form>
      <TxStatusBanner status={flow.status} txHash={flow.txHash} error={flow.error} onReset={handleReset} />
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Liquidate: USDC-test approve + LendingCore.liquidate(borrower, amt)*/
/* ──────────────────────────────────────────────────────────────────── */

function LiquidateForm({ onWriteSuccess }: FormProps) {
  const { address } = useAccount();
  const approveFlow = useWriteFlow();
  const liquidateFlow = useWriteFlow();
  const [borrower, setBorrower] = useState("");
  const [amount, setAmount] = useState("");
  const [txHistory, setTxHistory] = useState<TxHistoryEntry[]>([]);
  const notifiedRef = useRef(false);

  const isApproved = approveFlow.status === "confirmed";

  // Track completed approve step in history
  useEffect(() => {
    if (approveFlow.status === "confirmed" && approveFlow.txHash) {
      setTxHistory((prev) => {
        if (prev.some((e) => e.txHash === approveFlow.txHash)) return prev;
        return [...prev, { label: "Approve USDC", txHash: approveFlow.txHash! }];
      });
    }
  }, [approveFlow.status, approveFlow.txHash]);

  // Notify parent when final liquidate confirms
  useEffect(() => {
    if (liquidateFlow.status === "confirmed" && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess?.();
    }
  }, [liquidateFlow.status, onWriteSuccess]);

  function handleApprove(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    const parsed = parseUnits(amount, 18);
    approveFlow.write({
      address: contracts.usdc,
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [contracts.lendingCore, parsed],
    });
  }

  function handleLiquidate() {
    if (!amount || !isAddress(borrower)) return;
    const parsed = parseUnits(amount, 18);
    liquidateFlow.write({
      address: contracts.lendingCore,
      abi: lendingCoreWriteAbi,
      functionName: "liquidate",
      args: [borrower as `0x${string}`, parsed],
    });
  }

  function handleReset() {
    approveFlow.reset();
    liquidateFlow.reset();
    setAmount("");
    setBorrower("");
    setTxHistory([]);
    notifiedRef.current = false;
  }

  return (
    <article className="write-form-card panel-card">
      <h3>Liquidate</h3>
      <p className="write-form-hint">
        Liquidate an underwater borrower. Approve USDC-test then call liquidate with the borrower address.
      </p>
      <form className="write-form write-form-liquidate" onSubmit={handleApprove}>
        <input
          className="write-input"
          type="text"
          placeholder="Borrower 0x address"
          value={borrower}
          onChange={(e) => setBorrower(e.target.value)}
          disabled={approveFlow.status === "pending" || approveFlow.status === "confirming"}
        />
        <input
          className="write-input"
          type="text"
          inputMode="decimal"
          placeholder="USDC-test repay amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={approveFlow.status === "pending" || approveFlow.status === "confirming"}
        />
        {!isApproved ? (
          <button
            className="action-button"
            type="submit"
            disabled={
              !address ||
              !amount ||
              !isAddress(borrower) ||
              approveFlow.status === "pending" ||
              approveFlow.status === "confirming"
            }
          >
            1. Approve USDC
          </button>
        ) : (
          <button
            className="action-button"
            type="button"
            onClick={handleLiquidate}
            disabled={
              !address ||
              !isAddress(borrower) ||
              liquidateFlow.status === "pending" ||
              liquidateFlow.status === "confirming"
            }
          >
            2. Liquidate
          </button>
        )}
      </form>
      <TxHistoryList entries={txHistory} />
      <TxStatusBanner
        status={isApproved ? liquidateFlow.status : approveFlow.status}
        txHash={isApproved ? liquidateFlow.txHash : approveFlow.txHash}
        error={isApproved ? liquidateFlow.error : approveFlow.error}
        onReset={handleReset}
      />
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Composite section: all 6 write forms                               */
/* ──────────────────────────────────────────────────────────────────── */

interface WritePathSectionProps {
  onWriteSuccess?: () => void;
  observer?: ObserverSnapshot | null;
}

export function WritePathSection({ onWriteSuccess, observer }: WritePathSectionProps) {
  const { isConnected } = useAccount();

  return (
    <section className="write-path-section">
      <div className="section-header">
        <h2>Write Path — Lending Operations</h2>
      </div>

      {!isConnected ? (
        <div className="empty-state">
          <p>Connect your wallet to access lending operations.</p>
        </div>
      ) : (
        <div className="write-forms-grid">
          <SupplyLiquidityForm onWriteSuccess={onWriteSuccess} />
          <DepositCollateralForm onWriteSuccess={onWriteSuccess} />
          <BorrowForm onWriteSuccess={onWriteSuccess} observer={observer} />
          <RepayForm onWriteSuccess={onWriteSuccess} observer={observer} />
          <WithdrawCollateralForm onWriteSuccess={onWriteSuccess} />
          <LiquidateForm onWriteSuccess={onWriteSuccess} />
        </div>
      )}
    </section>
  );
}
