import { FormEvent, useEffect, useRef, useState } from "react";
import { parseEther, parseUnits, isAddress, erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { useWriteFlow } from "../hooks/useWriteFlow";
import { deploymentManifest } from "../lib/manifest";
import type { MarketSnapshot } from "../lib/readModel/types";
import {
  erc20ApproveAbi,
  lendingCoreWriteAbi,
  lendingRouterWriteAbi,
  debtPoolWriteAbi,
} from "../lib/abi";

const { contracts } = deploymentManifest;

type ActionType = "deposit" | "supply" | "borrow" | "repay" | "withdraw" | "liquidate";

const ACTION_IDS: ActionType[] = ["deposit", "supply", "borrow", "repay", "withdraw", "liquidate"];

interface ActionConfig {
  id: ActionType;
  label: string;
  token: string;
  placeholder: string;
  usesApprove: boolean;
  needsExtraInput?: boolean;
  hasMaxButton?: boolean;
  maxKey?: "availableToBorrow" | "currentDebt";
}

const ACTIONS: ActionConfig[] = [
  { id: "deposit",   label: "Deposit",   token: "PAS",  placeholder: "PAS amount",              usesApprove: false, hasMaxButton: true },
  { id: "supply",    label: "Supply",     token: "USDC", placeholder: "USDC-test amount",        usesApprove: true,  hasMaxButton: true },
  { id: "borrow",    label: "Borrow",     token: "USDC", placeholder: "USDC-test borrow amount", usesApprove: false, hasMaxButton: true, maxKey: "availableToBorrow" },
  { id: "repay",     label: "Repay",      token: "USDC", placeholder: "USDC-test repay amount",  usesApprove: true,  hasMaxButton: true, maxKey: "currentDebt" },
  { id: "withdraw",  label: "Withdraw",   token: "WPAS", placeholder: "WPAS amount to withdraw", usesApprove: false },
  { id: "liquidate", label: "Liquidate",  token: "USDC", placeholder: "USDC-test repay amount",  usesApprove: true,  needsExtraInput: true },
];

function extractNum(formatted: string): string {
  return (formatted.split(" ")[0] ?? "").replace(/,/g, "");
}

function fmtBal(value: bigint | undefined, decimals = 18, maxDecimals = 2): string {
  if (value === undefined) return "...";
  const str = formatUnits(value, decimals);
  const num = parseFloat(str);
  return num.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

/* ── Public API ─────────────────────────────────────────────────── */

export interface ActionPanelProps {
  snapshot: MarketSnapshot | null;
  trackedAddress: string;
  onWriteSuccess: () => void;
}

export function ActionPanel({ snapshot, trackedAddress: _tracked, onWriteSuccess }: ActionPanelProps) {
  const [activeId, setActiveId] = useState<ActionType>("deposit");
  const [amount, setAmount] = useState("");
  const [extra, setExtra] = useState("");           // borrower address (liquidate)
  const { address } = useAccount();

  /* ── balance reads ────────────────────────────────────────────── */
  const { data: pasBalance } = useBalance({
    address,
    query: { refetchInterval: 15_000 },
  });

  const { data: usdcRaw } = useReadContract({
    address: contracts.usdc as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const { data: wpasRaw } = useReadContract({
    address: contracts.wpas as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const approveFlow = useWriteFlow();
  const actionFlow = useWriteFlow();
  const notifiedRef = useRef(false);
  const cfg = ACTIONS.find((a) => a.id === activeId)!;

  /* reset on action switch */
  useEffect(() => {
    setAmount(""); setExtra("");
    approveFlow.reset(); actionFlow.reset();
    notifiedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  /* notify parent on confirmed action */
  useEffect(() => {
    if (actionFlow.status === "confirmed" && !notifiedRef.current) {
      notifiedRef.current = true;
      onWriteSuccess();
    }
  }, [actionFlow.status, onWriteSuccess]);

  const isApproved = cfg.usesApprove && approveFlow.status === "confirmed";
  const flow = cfg.usesApprove && !isApproved ? approveFlow : actionFlow;
  const busy = flow.status === "pending" || flow.status === "confirming";

  /* balance info */
  const obs = snapshot?.observer;

  const balanceInfo = (() => {
    switch (activeId) {
      case "deposit":   return { label: "Balance",    value: fmtBal(pasBalance?.value),         token: "PAS" };
      case "supply":    return { label: "Balance",    value: fmtBal(usdcRaw as bigint | undefined), token: "USDC" };
      case "borrow":    return { label: "Capacity",   value: obs?.availableToBorrow ?? "—",     token: "" };
      case "repay":     return { label: "Debt",       value: obs?.currentDebt ?? "—",           token: "" };
      case "withdraw":  return { label: "Collateral", value: fmtBal(wpasRaw as bigint | undefined), token: "WPAS" };
      case "liquidate": return null;
    }
  })();

  /* max button */
  const maxRaw = cfg.maxKey ? extractNum(obs?.[cfg.maxKey] ?? "") : null;

  const maxValue = (() => {
    if (!cfg.hasMaxButton) return null;
    switch (activeId) {
      case "deposit": {
        if (!pasBalance?.value) return null;
        const net = pasBalance.value - parseEther("0.1");
        return net > 0n ? formatUnits(net, 18) : null;
      }
      case "supply": {
        if (!usdcRaw) return null;
        return formatUnits(usdcRaw as bigint, 18);
      }
      case "borrow":  return maxRaw && maxRaw !== "0" ? maxRaw : null;
      case "repay":   return maxRaw && maxRaw !== "0" ? maxRaw : null;
      default:        return null;
    }
  })();

  const showMax = maxValue !== null;

  /* ── submit handler ───────────────────────────────────────────── */
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount || !address) return;
    const parsed = activeId === "deposit" || activeId === "withdraw"
      ? parseEther(amount) : parseUnits(amount, 18);

    /* approve step */
    if (cfg.usesApprove && !isApproved) {
      const spender = activeId === "supply" ? contracts.debtPool : contracts.lendingEngine;
      approveFlow.write({ address: contracts.usdc, abi: erc20ApproveAbi, functionName: "approve", args: [spender, parsed] });
      return;
    }

    /* action step */
    switch (activeId) {
      case "deposit":
        if (!contracts.lendingRouter) return;
        actionFlow.write({ address: contracts.lendingRouter, abi: lendingRouterWriteAbi, functionName: "depositCollateralFromPAS", value: parsed });
        break;
      case "supply":
        actionFlow.write({ address: contracts.debtPool, abi: debtPoolWriteAbi, functionName: "deposit", args: [parsed, address] });
        break;
      case "borrow":
        actionFlow.write({ address: contracts.lendingEngine, abi: lendingCoreWriteAbi, functionName: "borrow", args: [parsed] });
        break;
      case "repay":
        actionFlow.write({ address: contracts.lendingEngine, abi: lendingCoreWriteAbi, functionName: "repay", args: [parsed] });
        break;
      case "withdraw":
        actionFlow.write({ address: contracts.lendingEngine, abi: lendingCoreWriteAbi, functionName: "withdrawCollateral", args: [parsed] });
        break;
      case "liquidate":
        if (!isAddress(extra)) return;
        actionFlow.write({ address: contracts.lendingEngine, abi: lendingCoreWriteAbi, functionName: "liquidate", args: [extra as `0x${string}`, parsed] });
        break;
    }
  }

  /* ── derived UI strings ───────────────────────────────────────── */
  const btnLabel = cfg.usesApprove && !isApproved
    ? `1. Approve ${cfg.token}` : cfg.usesApprove ? `2. ${cfg.label}` : cfg.label;
  const liquidateInvalid = activeId === "liquidate" && !isAddress(extra);
  const disableBtn = !address || !amount || busy || liquidateInvalid;
  const statusText =
    flow.status === "pending"    ? "Waiting for wallet…" :
    flow.status === "confirming" ? "Confirming…" :
    flow.status === "confirmed"  ? "Confirmed ✓" :
    flow.status === "error"      ? (flow.error ?? "Transaction failed") : "";

  return (
    <div className="action-panel">
      <div className="action-selector">
        {ACTION_IDS.map((id) => (
          <button key={id} type="button"
            className={`action-selector-btn${id === activeId ? " active" : ""}`}
            onClick={() => setActiveId(id)}>
            {ACTIONS.find((a) => a.id === id)!.label}
          </button>
        ))}
      </div>

      <form className="action-form" onSubmit={handleSubmit}>
        {cfg.needsExtraInput && (
          <input className="action-input" type="text" placeholder="Borrower 0x address"
            value={extra} onChange={(e) => setExtra(e.target.value)} disabled={busy} />
        )}
        {balanceInfo && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>
            <span>{balanceInfo.label}</span>
            <span>{balanceInfo.value} {balanceInfo.token}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input className="action-input" style={{ flex: 1 }} type="text" inputMode="decimal"
            placeholder={cfg.placeholder} value={amount}
            onChange={(e) => setAmount(e.target.value)} disabled={busy} />
          {showMax && (
            <button type="button" className="action-btn" style={{ flex: "none" }}
              onClick={() => setAmount(maxValue!)} disabled={busy}>Max</button>
          )}
        </div>
        <button className="action-btn" type="submit" disabled={disableBtn}>{btnLabel}</button>
      </form>

      {statusText && <p className={`action-status ${flow.status}`}>{statusText}</p>}
    </div>
  );
}
