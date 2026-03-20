import { useCallback, useEffect, useRef, useState } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import type { Abi, Address } from "viem";
import { benchMark } from "../lib/txBench";

export type WriteFlowStatus = "idle" | "pending" | "confirming" | "confirmed" | "error";

export interface TxHistoryEntry {
  label: string;
  txHash: `0x${string}`;
}

interface WriteFlowResult {
  status: WriteFlowStatus;
  txHash: `0x${string}` | undefined;
  error: string | null;
  write: (params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  }) => void;
  reset: () => void;
}

export function useWriteFlow(): WriteFlowResult {
  const [error, setError] = useState<string | null>(null);
  const [manualStatus, setManualStatus] = useState<WriteFlowStatus>("idle");

  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  let status: WriteFlowStatus = manualStatus;
  if (isWritePending) {
    status = "pending";
  } else if (txHash && isConfirming) {
    status = "confirming";
  } else if (txHash && isConfirmed) {
    status = "confirmed";
  } else if (writeError || receiptError) {
    status = "error";
  }

  useEffect(() => {
    if (writeError) {
      setError(extractRevertReason(writeError));
    } else if (receiptError) {
      setError(extractRevertReason(receiptError));
    }
  }, [writeError, receiptError]);

  /* ── bench: track state transitions ───────────────────────────── */
  useEffect(() => {
    if (txHash) benchMark("tx_broadcast");
  }, [txHash]);

  useEffect(() => {
    if (isConfirming) benchMark("block_confirming");
  }, [isConfirming]);

  useEffect(() => {
    if (isConfirmed) benchMark("block_confirmed");
  }, [isConfirmed]);

  useEffect(() => {
    if (writeError) benchMark("wallet_error");
    if (receiptError) benchMark("receipt_error");
  }, [writeError, receiptError]);

  const write = useCallback(
    (params: {
      address: Address;
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
      value?: bigint;
    }) => {
      setError(null);
      setManualStatus("pending");
      benchMark("wallet_prompted");
      writeContract(params);
    },
    [writeContract],
  );

  const reset = useCallback(() => {
    setError(null);
    setManualStatus("idle");
    resetWrite();
  }, [resetWrite]);

  return { status, txHash, error, write, reset };
}

export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (active) {
      startRef.current = Date.now();
      const id = setInterval(() => {
        setSeconds(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      setSeconds(0);
      startRef.current = null;
    }
  }, [active]);
  return seconds;
}

const KNOWN_ERRORS: Record<string, string> = {
  "0x3a23d825": "Insufficient collateral for this withdrawal",
  "0x068ca9d8": "Access denied — your wallet is not authorized for this action",
  "0xd93c0665": "Oracle price is stale — oracle needs to be refreshed before this action",
  "0x8b0d1495": "Borrowing is currently disabled",
  "0x7c946ed7": "Borrow exceeds your maximum LTV — reduce borrow amount or add collateral",
  "0xce3a3d37": "Amount cannot be zero",
  "0x1f2a2005": "You have no outstanding debt to repay",
  "0x35278d12": "Contract is paused — try again later",
};

function extractRevertReason(error: Error): string {
  const message = error.message ?? String(error);

  for (const [sel, desc] of Object.entries(KNOWN_ERRORS)) {
    if (message.includes(sel.slice(2)) || message.toLowerCase().includes(sel)) return desc;
  }
  if (message.includes("Gas estimation failed") || message.includes("gas required exceeds") || message.includes("execution reverted")) return "Transaction would fail — check your inputs and balances";
  if (message.toLowerCase().includes("insufficient funds") || message.toLowerCase().includes("insufficient balance")) return "Insufficient balance — you may not have enough tokens or PAS for gas";
  const reasonMatch = message.match(/reverted with the following reason:\s*\n?(.*)/i);
  if (reasonMatch?.[1]) return reasonMatch[1].trim();
  const customErrorMatch = message.match(/reverted with custom error '([^']+)'/i);
  if (customErrorMatch?.[1]) return customErrorMatch[1];
  if (message.includes("User rejected") || message.includes("user rejected")) return "Transaction rejected by user.";
  if (message.length > 200) return message.slice(0, 200) + "…";

  return message;
}
