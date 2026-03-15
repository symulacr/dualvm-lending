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

const count = Number(process.argv[2] ?? "10");
if (!Number.isInteger(count) || count <= 0) {
  console.error("Usage: node scripts/generate-wallet-batch.mjs <positive-count>");
  process.exit(1);
}

const outDir = path.join(process.cwd(), "wallets");
const outPath = path.join(outDir, `paseo-faucet-wallet-batch-${timestampSlug()}.txt`);
mkdirSync(outDir, { recursive: true });

const wallets = Array.from({ length: count }, (_, index) => {
  const wallet = Wallet.createRandom();
  const fallbackAccountHex = evmToFallbackAccountHex(wallet.address);
  const paseoSs58 = encodeAddress(hexToBytes(fallbackAccountHex), 0);
  return {
    index: index + 1,
    evmAddress: wallet.address,
    fallbackAccountHex,
    paseoSs58,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase ?? "unavailable",
  };
});

const lines = [
  "DualVM Paseo faucet wallet batch",
  `Generated: ${new Date().toISOString()}`,
  `Count: ${count}`,
  "Warning: testnet only. Never reuse these private keys or mnemonics for real funds.",
  "Faucet: https://faucet.polkadot.io/",
  "Use Network \"Polkadot testnet (Paseo)\".",
  "For Hub (smart contracts), paste the 0x EVM address by default.",
  "For other Paseo chains (Relay / BridgeHub / People / Coretime), the SS58 address is the safest manual form.",
  "Do not use stale bookmarked URLs with ?parachain=1111.",
  "",
];

for (const entry of wallets) {
  lines.push(
    `Wallet ${entry.index}`,
    `EVM address: ${entry.evmAddress}`,
    `Fallback AccountId32 hex: ${entry.fallbackAccountHex}`,
    `Paseo SS58 (prefix 0): ${entry.paseoSs58}`,
    `Private key: ${entry.privateKey}`,
    `Mnemonic: ${entry.mnemonic}`,
    "",
  );
}

writeFileSync(outPath, lines.join("\n"));
console.log(JSON.stringify({ path: outPath, wallets: wallets.map(({ index, evmAddress, paseoSs58 }) => ({ index, evmAddress, paseoSs58 })) }, null, 2));
