import { useAccount, useBlockNumber } from "wagmi";
import type { MarketSnapshot } from "../../lib/readModel/types";

export function BottomBar({ snapshot }: { snapshot: MarketSnapshot | null }) {
  const { address, isConnected } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const truncAddr = address ? `0x${address.slice(2, 8)}…${address.slice(-6)}` : "";
  const versionLabel = snapshot?.activeVersionId ? `market ${snapshot.activeVersionId}` : null;

  return (
    <footer className="bottom-bar">
      <span>blk {blockNumber ? blockNumber.toLocaleString() : "—"}</span>
      {versionLabel && <span>{versionLabel}</span>}
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {isConnected && <span className="net-dot" />}
        {isConnected ? truncAddr : "Not connected"}
      </span>
    </footer>
  );
}
