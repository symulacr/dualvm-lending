import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";

export type FaucetState = "idle" | "loading" | "success" | "error" | "cooldown";

interface FaucetTxHashes {
  pas?: string;
  usdc?: string;
  wpas?: string;
}

export interface UseFaucetResult {
  state: FaucetState;
  txHashes: FaucetTxHashes;
  error: string | null;
  claim: () => void;
  reset: () => void;
}

export function useFaucet(): UseFaucetResult {
  const { address } = useAccount();
  const [state, setState] = useState<FaucetState>("idle");
  const [txHashes, setTxHashes] = useState<FaucetTxHashes>({});
  const [error, setError] = useState<string | null>(null);

  const claim = useCallback(() => {
    if (!address) return;
    setState("loading");
    setError(null);
    setTxHashes({});

    fetch("/api/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then(async (res) => {
        const data = await res.json();

        if (res.status === 429) {
          setState("cooldown");
          setError(data.error ?? "Rate limited. Try again in 24 hours.");
          return;
        }

        if (!res.ok) {
          setState("error");
          setError(data.error ?? "Faucet request failed");
          if (data.partialTxHashes) setTxHashes(data.partialTxHashes);
          return;
        }

        setTxHashes(data.txHashes);
        setState("success");
      })
      .catch((err: unknown) => {
        setState("error");
        setError(err instanceof Error ? err.message : "Network error");
      });
  }, [address]);

  // Auto-reset after 10 seconds on success
  useEffect(() => {
    if (state !== "success") return;
    const timer = setTimeout(() => {
      setState("idle");
      setTxHashes({});
    }, 10_000);
    return () => clearTimeout(timer);
  }, [state]);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setTxHashes({});
  }, []);

  return { state, txHashes, error, claim, reset };
}
