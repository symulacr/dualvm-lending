import type { TxHistoryEntry } from "../hooks/useWriteFlow";
import { deploymentManifest } from "../lib/manifest";

interface TxHistoryListProps {
  entries: TxHistoryEntry[];
}

/**
 * Compact list of completed transaction steps in a multi-step flow.
 * Each entry shows a step label + Blockscout link for its TX hash.
 */
export function TxHistoryList({ entries }: TxHistoryListProps) {
  if (entries.length === 0) return null;

  const explorerUrl = deploymentManifest.polkadotHubTestnet.explorerUrl.replace(/\/$/, "");

  return (
    <div className="tx-history-list">
      {entries.map((entry, i) => (
        <div className="tx-history-entry" key={`${entry.txHash}-${i}`}>
          <span className="tx-history-check">✅</span>
          <span className="tx-history-label">{entry.label}</span>
          <a
            className="tx-history-link"
            href={`${explorerUrl}/tx/${entry.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View TX ↗
          </a>
        </div>
      ))}
    </div>
  );
}
