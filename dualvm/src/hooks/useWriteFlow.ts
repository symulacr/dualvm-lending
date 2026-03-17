import { useCallback, useEffect, useState } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import type { Abi, Address } from "viem";

export type WriteFlowStatus = "idle" | "pending" | "confirming" | "confirmed" | "error";

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

/**
 * Composable hook that wraps wagmi's useWriteContract + useWaitForTransactionReceipt
 * into a single status flow: idle → pending → confirming → confirmed | error.
 */
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

  // Derive status from wagmi hook states
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

  // Sync error messages
  useEffect(() => {
    if (writeError) {
      setError(extractRevertReason(writeError));
    } else if (receiptError) {
      setError(extractRevertReason(receiptError));
    }
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

/** Best-effort extraction of a human-readable revert reason from a wagmi/viem error. */
function extractRevertReason(error: Error): string {
  const message = error.message ?? String(error);

  // viem often puts the revert reason after "reverted with the following reason:"
  const reasonMatch = message.match(/reverted with the following reason:\s*\n?(.*)/i);
  if (reasonMatch?.[1]) {
    return reasonMatch[1].trim();
  }

  // Custom error names from viem decoding
  const customErrorMatch = message.match(/reverted with custom error '([^']+)'/i);
  if (customErrorMatch?.[1]) {
    return customErrorMatch[1];
  }

  // User rejected
  if (message.includes("User rejected") || message.includes("user rejected")) {
    return "Transaction rejected by user.";
  }

  // Shorten very long messages
  if (message.length > 200) {
    return message.slice(0, 200) + "…";
  }

  return message;
}
