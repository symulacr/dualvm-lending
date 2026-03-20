import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useFaucet } from "../../hooks/useFaucet";
import { deploymentManifest } from "../../lib/manifest";

interface TopBarProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  isLoading?: boolean;
}

export function TopBar({ sidebarOpen, setSidebarOpen, theme, setTheme, isLoading }: TopBarProps) {
  const { isConnected } = useAccount();
  const { state, error, claim } = useFaucet();

  const faucetLabel =
    state === "loading" ? "Claiming…" :
    state === "success" ? "Tokens sent ✓" :
    state === "error" ? (error ?? "Error") :
    state === "cooldown" ? (error ?? "Cooldown") :
    "Get Tokens";

  return (
    <header className="top-bar">
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          className="btn-ghost"
          style={{ padding: "4px 8px", fontSize: "var(--text-md)", lineHeight: 1 }}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? "✕" : "☰"}
        </button>
        <span className="top-bar-brand">DUALVM</span>
      </div>
      <div className="top-bar-center">
        <span className="net-dot" />
        <span className="net-badge">{deploymentManifest.polkadotHubTestnet.name}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {isConnected && (
          <button
            className={`btn-ghost${state === "success" ? " success" : state === "error" || state === "cooldown" ? " error" : ""}${state === "loading" ? " loading" : ""}`}
            style={{ fontSize: "var(--text-sm)", padding: "4px 10px" }}
            onClick={claim}
            disabled={state === "loading" || state === "success"}
          >
            {faucetLabel}
          </button>
        )}
        <button
          className="btn-ghost"
          style={{ padding: "4px 8px", fontSize: "var(--text-md)", lineHeight: 1 }}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "☀" : "☽"}
        </button>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>
      {isLoading && <div className="header-loading-bar" />}
    </header>
  );
}
