import { Fragment, useState } from "react";
import { useAccount } from "wagmi";
import { deploymentManifest } from "../lib/manifest";
import { formatAddress } from "../lib/format";

interface FooterProps {
  trackedAddress: string;
  onTrackedAddressChange: (addr: string) => void;
}

export function Footer({ trackedAddress, onTrackedAddressChange }: FooterProps) {
  const { isConnected } = useAccount();
  const [showTooltip, setShowTooltip] = useState(false);

  const contractRows = Object.entries(deploymentManifest.contracts)
    .filter(([, addr]) => typeof addr === "string")
    .map(([name, addr]) => ({ name, address: addr as string }));

  const explorerBase = deploymentManifest.polkadotHubTestnet.explorerUrl.replace(
    /\/$/,
    "",
  );

  return (
    <footer className="app-footer">
      <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
        {deploymentManifest.polkadotHubTestnet.chainId}
      </span>

      <input
        className="mono"
        value={trackedAddress}
        onChange={(e) => onTrackedAddressChange(e.target.value)}
        placeholder="0x observer"
        style={{
          background: "transparent",
          border: "none",
          borderBottom: "1px solid var(--text-tertiary)",
          color: "var(--text-tertiary)",
          fontSize: 11,
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          padding: "2px 6px",
          width: 120,
          outline: "none",
          letterSpacing: "0.02em",
        }}
      />

      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setShowTooltip((prev) => !prev)}
          style={{
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 11,
            padding: "2px 8px",
          }}
        >
          ?
        </button>

        {showTooltip && (
          <div className="footer-tooltip">
            <button
              type="button"
              className="footer-tooltip-close"
              onClick={() => setShowTooltip(false)}
            >
              ×
            </button>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "4px 12px",
                fontSize: 11,
                marginBottom: 8,
              }}
            >
              {contractRows.map((row) => (
                <Fragment key={row.name}>
                  <span style={{ color: "var(--text-secondary)" }}>{row.name}</span>
                  <a
                    className="mono"
                    href={`${explorerBase}/address/${row.address}`}
                    target="_blank"
                    rel="noreferrer"
                    title={row.address}
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {formatAddress(row.address)}
                  </a>
                </Fragment>
              ))}
            </div>

            <p style={{ fontSize: 10, color: "var(--text-tertiary)", margin: 0 }}>
              AccessManager + SafeERC20 + ReentrancyGuard + Pausable + Oracle
              freshness
            </p>
          </div>
        )}
      </div>

      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: isConnected ? "#22c55e" : "#6b7280",
          display: "inline-block",
          animation: isConnected ? "pulse-dot 2s ease-in-out infinite" : "none",
        }}
        title={isConnected ? "Connected" : "Disconnected"}
      />
    </footer>
  );
}
