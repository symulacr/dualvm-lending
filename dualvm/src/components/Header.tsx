import { ConnectButton } from "@rainbow-me/rainbowkit";

interface HeaderProps {
  txStatus: "idle" | "pending" | "confirming" | "confirmed" | "error";
  oraclePrice?: string | null;
  faucetState: "idle" | "loading" | "success" | "error" | "cooldown";
  onFaucetClaim: () => void;
  isConnected: boolean;
}

export function Header({ txStatus, oraclePrice, faucetState, onFaucetClaim, isConnected }: HeaderProps) {
  const barClass =
    txStatus === "idle"
      ? ""
      : txStatus === "confirmed"
        ? "tx-progress confirmed"
        : txStatus === "error"
          ? "tx-progress error"
          : txStatus === "confirming"
            ? "tx-progress confirming"
            : "tx-progress pending";

  const faucetLabel =
    faucetState === "loading"
      ? "CLAIMING..."
      : faucetState === "success"
        ? "CLAIMED ✓"
        : faucetState === "error"
          ? "FAILED"
          : faucetState === "cooldown"
            ? "CLAIMED"
            : "GET TOKENS";

  const faucetClassName =
    "header-btn" +
    (faucetState === "success" ? " success" : "") +
    (faucetState === "error" ? " error" : "") +
    (faucetState === "loading" ? " loading" : "");

  return (
    <header className="app-header">
      <span
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--text-secondary)",
        }}
      >
        DUALVM
      </span>

      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
        Polkadot Hub TestNet
      </span>

      {oraclePrice && (
        <span
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-tertiary)",
          }}
        >
          WPAS {Number(oraclePrice).toLocaleString()}
        </span>
      )}

      {isConnected && (
        <button
          className={faucetClassName}
          onClick={onFaucetClaim}
          disabled={faucetState === "loading" || faucetState === "cooldown"}
        >
          {faucetLabel}
        </button>
      )}

      <ConnectButton
        showBalance={false}
        chainStatus="icon"
        accountStatus="address"
      />

      {txStatus !== "idle" && (
        <div
          className={barClass}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: 2,
          }}
        />
      )}
    </header>
  );
}
