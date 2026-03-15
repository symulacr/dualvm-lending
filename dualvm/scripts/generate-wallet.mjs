import { Wallet } from "ethers";
import { encodeAddress } from "@polkadot/util-crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function evmToFallbackAccountHex(address) {
  const normalized = address.toLowerCase().replace(/^0x/, "");
  return `0x${normalized}${"ee".repeat(12)}`;
}

function hexToBytes(hex) {
  const normalized = hex.replace(/^0x/, "");
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const wallet = Wallet.createRandom();
const fallbackAccountHex = evmToFallbackAccountHex(wallet.address);
const paseoSs58 = encodeAddress(hexToBytes(fallbackAccountHex), 0);
const outDir = path.join(process.cwd(), "wallets");
const outPath = path.join(outDir, `polkadot-hub-testnet-wallet-${timestampSlug()}.txt`);

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outPath,
  [
    "DualVM Polkadot Hub TestNet wallet",
    `Generated: ${new Date().toISOString()}`,
    "Warning: testnet only. Never reuse this private key or mnemonic for real funds.",
    "",
    `EVM address: ${wallet.address}`,
    `Fallback AccountId32 hex: ${fallbackAccountHex}`,
    `Current Paseo/Hub SS58 (prefix 0): ${paseoSs58}`,
    `Private key: ${wallet.privateKey}`,
    `Mnemonic: ${wallet.mnemonic?.phrase ?? "unavailable"}`,
    "Faucet: https://faucet.polkadot.io/",
    "Select Network \"Polkadot testnet (Paseo)\" and Chain \"Hub (smart contracts)\".",
    "Paste the 0x EVM address by default. Do not use old bookmarked URLs with ?parachain=1111.",
  ].join("\n"),
);

console.log(JSON.stringify({ path: outPath, address: wallet.address, fallbackAccountHex, paseoSs58 }, null, 2));
