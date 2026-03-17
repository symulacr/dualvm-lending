#!/usr/bin/env node
/**
 * CI Testnet Smoke Test
 *
 * Reads 3 canonical contract addresses from the deployment manifest and
 * verifies each has non-zero bytecode on-chain via eth_getCode.
 *
 * This is a read-only, stateless check — safe to run in CI.
 * Exits 0 on success, 1 on failure.  Public RPC may be down, so the
 * CI step that calls this script should use continue-on-error: true.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, "..", "deployments", "polkadot-hub-testnet-canonical.json");

// --- Load manifest -----------------------------------------------------------
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (err) {
  console.error(`[smoke] Failed to read canonical manifest at ${manifestPath}:`, err.message);
  process.exit(1);
}

const contracts = manifest.contracts;
if (!contracts || typeof contracts !== "object") {
  console.error("[smoke] Manifest missing 'contracts' object");
  process.exit(1);
}

// Pick 3 representative contracts: lendingCore, debtPool, accessManager
const TARGET_KEYS = ["lendingCore", "debtPool", "accessManager"];
const targets = TARGET_KEYS.map((key) => {
  const addr = contracts[key];
  if (!addr) {
    console.error(`[smoke] Manifest missing contracts.${key}`);
    process.exit(1);
  }
  return { name: key, address: addr };
});

// --- Configure viem client ---------------------------------------------------
const rpcUrl =
  manifest.polkadotHubTestnet?.rpcUrl ??
  process.env.POLKADOT_HUB_TESTNET_RPC_URL ??
  "https://eth-rpc-testnet.polkadot.io/";

const client = createPublicClient({
  transport: http(rpcUrl, { timeout: 15_000 }),
});

// --- Check bytecode ----------------------------------------------------------
console.log(`[smoke] RPC: ${rpcUrl}`);
console.log(`[smoke] Checking ${targets.length} contracts...\n`);

let failures = 0;

for (const { name, address } of targets) {
  try {
    const code = await client.getCode({ address });
    const hasCode = code && code !== "0x" && code.length > 2;
    if (hasCode) {
      console.log(`  ✅ ${name} (${address}) — ${code.length} hex chars`);
    } else {
      console.log(`  ❌ ${name} (${address}) — no bytecode (got ${code})`);
      failures++;
    }
  } catch (err) {
    console.log(`  ❌ ${name} (${address}) — RPC error: ${err.message}`);
    failures++;
  }
}

console.log();
if (failures > 0) {
  console.error(`[smoke] ${failures}/${targets.length} contract(s) failed bytecode check`);
  process.exit(1);
} else {
  console.log(`[smoke] All ${targets.length} contracts verified ✓`);
}
