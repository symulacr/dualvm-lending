import {
  createWalletClient,
  createPublicClient,
  http,
  isAddress,
  parseEther,
  parseUnits,
  defineChain,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// --- Request/Response types (Vercel Node.js runtime) ---

interface ApiRequest {
  method?: string;
  body?: { address?: string };
  headers: { origin?: string; [key: string]: string | string[] | undefined };
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): ApiResponse;
  end(): void;
}

// --- Constants ---

const RPC_URL = "https://eth-rpc-testnet.polkadot.io/";
const USDC_ADDRESS: Address = "0x2d7e60571b478f8de5f25a8b494e7f4527310d34";
const WPAS_ADDRESS: Address = "0x5e18c7708d492c66d8ebd92ae208b74c069f18fc";

const ALLOWED_ORIGINS = ["https://dualvm.vercel.app", "http://localhost:4173"];
const RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory rate limit (resets on cold starts — acceptable for hackathon testnet)
const claimTimestamps = new Map<string, number>();

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

const USDC_MINT_ABI = [
  {
    name: "mint",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const WPAS_DEPOSIT_TO_ABI = [
  {
    name: "depositTo",
    type: "function",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

// --- CORS ---

function setCorsHeaders(res: ApiResponse, origin: string | undefined): void {
  const allowed = ALLOWED_ORIGINS.includes(origin ?? "");
  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// --- Handler ---

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const origin =
    typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  setCorsHeaders(res, origin);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Validate address
  const { address } = req.body ?? {};
  if (!address || typeof address !== "string" || !isAddress(address)) {
    res.status(400).json({ error: "Invalid Ethereum address" });
    return;
  }

  const normalizedAddress = address.toLowerCase();

  // Rate limit
  const lastClaim = claimTimestamps.get(normalizedAddress);
  if (lastClaim && Date.now() - lastClaim < RATE_LIMIT_MS) {
    const remainingMs = RATE_LIMIT_MS - (Date.now() - lastClaim);
    const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
    res
      .status(429)
      .json({ error: `Rate limited. Try again in ~${remainingHours} hour(s).` });
    return;
  }

  // Relayer wallet
  const privateKey = process.env.FAUCET_RELAYER_PRIVATE_KEY;
  if (!privateKey) {
    res.status(500).json({ error: "Faucet relayer not configured" });
    return;
  }

  const account = privateKeyToAccount(privateKey as Hex);

  const publicClient = createPublicClient({
    chain: polkadotHubTestnet,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: polkadotHubTestnet,
    transport: http(RPC_URL),
  });

  const txHashes: { pas?: Hash; usdc?: Hash; wpas?: Hash } = {};

  try {
    // Get nonce for sequential tx management
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
    });

    // 1. Send 10 PAS (native) to user
    txHashes.pas = await walletClient.sendTransaction({
      to: address as Address,
      value: parseEther("10"),
      nonce,
    });

    // 2. Mint 10,000 USDC to user
    txHashes.usdc = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_MINT_ABI,
      functionName: "mint",
      args: [address as Address, parseUnits("10000", 18)],
      nonce: nonce + 1,
    });

    // 3. Deposit 50 WPAS to user (wraps native PAS)
    txHashes.wpas = await walletClient.writeContract({
      address: WPAS_ADDRESS,
      abi: WPAS_DEPOSIT_TO_ABI,
      functionName: "depositTo",
      args: [address as Address],
      value: parseEther("50"),
      nonce: nonce + 2,
    });

    // Record claim for rate limiting
    claimTimestamps.set(normalizedAddress, Date.now());

    res.status(200).json({ success: true, txHashes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    let failedStep = "unknown";
    if (!txHashes.pas) failedStep = "PAS transfer";
    else if (!txHashes.usdc) failedStep = "USDC mint";
    else if (!txHashes.wpas) failedStep = "WPAS deposit";

    res.status(500).json({
      error: `Transaction failed at: ${failedStep}`,
      details: message.slice(0, 200),
      partialTxHashes: txHashes,
    });
  }
}
