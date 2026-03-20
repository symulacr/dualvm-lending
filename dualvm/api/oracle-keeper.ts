import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  defineChain,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// --- Request/Response types (Vercel Node.js runtime) ---

interface ApiRequest {
  method?: string;
  headers: { [key: string]: string | string[] | undefined };
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

// --- Constants ---

const RPC_URL = "https://eth-rpc-testnet.polkadot.io/";

// NOTE: This address will change after contract redeploy — update accordingly.
const ORACLE_ADDRESS: Address = "0x72b9340c315ad5d9277bcb67b694af12d3bd6592";

// --- Chain ---

const polkadotHubTestnet = defineChain({
  id: 420420417,
  name: "Polkadot Hub TestNet",
  nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
});

// --- ABI snippets ---

const oracleAbi = parseAbi([
  "function priceWad() view returns (uint256)",
  "function setPrice(uint256 newPriceWad)",
  "function isFresh() view returns (bool)",
  "function lastUpdatedAt() view returns (uint256)",
]);

// --- Handler ---

export default async function handler(req: ApiRequest, res: ApiResponse) {
  // Only allow cron calls (Vercel sets authorization header) or GET for manual trigger
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.ORACLE_KEEPER_PRIVATE_KEY;
  if (!key) {
    return res.status(500).json({ error: "ORACLE_KEEPER_PRIVATE_KEY not set" });
  }

  try {
    const publicClient = createPublicClient({
      chain: polkadotHubTestnet,
      transport: http(RPC_URL),
    });

    const account = privateKeyToAccount(key as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: polkadotHubTestnet,
      transport: http(RPC_URL),
    });

    // Read current price
    const currentPrice = await publicClient.readContract({
      address: ORACLE_ADDRESS,
      abi: oracleAbi,
      functionName: "priceWad",
    });

    // Add random drift: +/- 0.5% (simulates market movement)
    const driftBps = Math.floor(Math.random() * 100) - 50; // -50 to +50 bps
    const newPrice = currentPrice + (currentPrice * BigInt(driftBps)) / 10000n;

    // Ensure price stays in reasonable range (900–1100 WAD)
    const minPrice = 900_000_000_000_000_000_000n; // 900 WAD (18 decimals)
    const maxPrice = 1_100_000_000_000_000_000_000n; // 1100 WAD (18 decimals)
    const clampedPrice =
      newPrice < minPrice ? minPrice : newPrice > maxPrice ? maxPrice : newPrice;

    const hash = await walletClient.writeContract({
      address: ORACLE_ADDRESS,
      abi: oracleAbi,
      functionName: "setPrice",
      args: [clampedPrice],
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return res.status(200).json({
      success: true,
      previousPrice: currentPrice.toString(),
      newPrice: clampedPrice.toString(),
      driftBps,
      txHash: hash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message.slice(0, 200) });
  }
}
