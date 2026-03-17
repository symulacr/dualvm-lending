import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "../lib/wagmiConfig";

import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * Root provider wrapper for wallet connection.
 * Wraps WagmiProvider → QueryClientProvider → RainbowKitProvider
 * with the custom Polkadot Hub TestNet chain configuration.
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#87c6ff",
            accentColorForeground: "#07111f",
            borderRadius: "large",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
