import { getDefaultConfig, type Chain } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { deploymentManifest } from "./manifest";

/**
 * Custom Polkadot Hub TestNet chain definition for wagmi/RainbowKit.
 * Reads RPC URL and explorer from the canonical deployment manifest.
 */
export const polkadotHubTestnet = {
  id: deploymentManifest.polkadotHubTestnet.chainId,
  name: deploymentManifest.polkadotHubTestnet.name,
  nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
  rpcUrls: {
    default: { http: [deploymentManifest.polkadotHubTestnet.rpcUrl] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: deploymentManifest.polkadotHubTestnet.explorerUrl,
    },
  },
} as const satisfies Chain;

/**
 * WalletConnect project ID.
 * MetaMask and other injected wallets work without a valid projectId.
 * For WalletConnect modal support, replace this with a real ID from
 * https://cloud.walletconnect.com/
 */
const WALLETCONNECT_PROJECT_ID = "DUALVM_LENDING_HACKATHON";

/**
 * Wagmi configuration for DualVM Lending.
 *
 * Uses RainbowKit's getDefaultConfig which bundles wagmi createConfig
 * with sensible defaults (injected + WalletConnect + Coinbase + Rainbow wallets).
 */
export const wagmiConfig = getDefaultConfig({
  appName: "DualVM Lending",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [polkadotHubTestnet],
  transports: {
    [polkadotHubTestnet.id]: http(deploymentManifest.polkadotHubTestnet.rpcUrl),
  },
});
