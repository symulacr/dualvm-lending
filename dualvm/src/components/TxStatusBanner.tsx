import type { WriteFlowStatus } from "../hooks/useWriteFlow";
import { deploymentManifest } from "../lib/manifest";

interface TxStatusBannerProps {
  status: WriteFlowStatus;
  txHash: `0x${string}` | undefined;
  error: string | null;
  onReset: () => void;
}

export function TxStatusBanner({ status, txHash, error, onReset }: TxStatusBannerProps) {
  if (status === "idle") return null;

  const explorerUrl = deploymentManifest.polkadotHubTestnet.explorerUrl.replace(/\/$/, "");

  return (
    <div className={`tx-status-banner tx-status-${status}`}>
      {status === "pending" && <p>⏳ Waiting for wallet confirmation…</p>}
      {status === "confirming" && (
        <p>
          ⛏️ Transaction submitted. Waiting for confirmation…
          {txHash && (
            <>
              {" "}
              <a href={`${explorerUrl}/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
                View on Blockscout ↗
              </a>
            </>
          )}
        </p>
      )}
      {status === "confirmed" && (
        <p>
          ✅ Transaction confirmed!{" "}
          {txHash && (
            <a href={`${explorerUrl}/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
              View on Blockscout ↗
            </a>
          )}
          <button className="tx-reset-button" type="button" onClick={onReset}>
            New transaction
          </button>
        </p>
      )}
      {status === "error" && (
        <p>
          ❌ {error ?? "Transaction failed."}
          <button className="tx-reset-button" type="button" onClick={onReset}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
