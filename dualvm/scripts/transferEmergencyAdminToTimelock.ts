/**
 * transferEmergencyAdminToTimelock.ts
 *
 * Transfers EMERGENCY_ADMIN_ROLE (ROLE_IDS.EMERGENCY = 1) from the deployer EOA
 * (0x519870b7b98a4FDc3D73cDb818634993cc942A86) to the governance TimelockController
 * (0x65712EEFD810F077c6C11Fd7c18988d3ce569C60).
 *
 * Context: During initial governed deployment, the TimelockController was correctly
 * granted EMERGENCY role, but the original EMERGENCY_ADMIN address from .env was
 * NOT revoked. This script completes the handoff by having the deployer EOA
 * self-renounce the EMERGENCY role it still holds.
 *
 * Operations:
 *   TX1: Verify / confirm timelock already holds EMERGENCY (no TX needed — already done)
 *   TX2: emergencyEOA.renounceRole(EMERGENCY, emergencyEOA.address) — self-revocation
 *
 * Verification:
 *   - hasRole(EMERGENCY, timelock) == true  ✅
 *   - hasRole(EMERGENCY, deployerEOA) == false  ✅
 */

import { ROLE_IDS } from "../lib/config/marketConfig";
import { createSmokeContext } from "../lib/runtime/smokeContext";
import { waitForTransaction } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";
import fs from "fs";
import path from "path";

async function main() {
  const { manifest, actors, attach } = await createSmokeContext(["emergency"] as const);
  const { emergency } = actors;
  const emergencyAddr = await emergency.getAddress();

  const timelock = manifest.contracts.governanceTimelock;
  console.log("AccessManager:    ", manifest.contracts.accessManager);
  console.log("Timelock:         ", timelock);
  console.log("Emergency EOA:    ", emergencyAddr);
  console.log("EMERGENCY role ID:", ROLE_IDS.EMERGENCY);
  console.log("");

  // Attach AccessManager with the emergency actor (for renounceRole — requires msg.sender == account)
  const accessManager = await attach("accessManager", "DualVMAccessManager", emergency);

  // ── Pre-flight checks ──────────────────────────────────────────────────────
  const [timelockHasBefore, tDelayBefore] = await accessManager.hasRole(ROLE_IDS.EMERGENCY, timelock);
  const [deployerHasBefore, dDelayBefore] = await accessManager.hasRole(ROLE_IDS.EMERGENCY, emergencyAddr);

  console.log("=== PRE-TRANSFER STATE ===");
  console.log(`Timelock   hasRole(EMERGENCY): ${timelockHasBefore}  delay=${tDelayBefore}`);
  console.log(`DeployerEOA hasRole(EMERGENCY): ${deployerHasBefore}  delay=${dDelayBefore}`);
  console.log("");

  if (!timelockHasBefore) {
    throw new Error(
      "Precondition failed: TimelockController does NOT hold EMERGENCY role. " +
        "Governance deployment may be incomplete. Aborting.",
    );
  }

  if (!deployerHasBefore) {
    console.log("Deployer EOA already lacks EMERGENCY role — nothing to do.");
    console.log("VAL-ASYNC-003: ALREADY SATISFIED");
    return;
  }

  // ── TX: Self-renounce EMERGENCY role from deployer EOA ───────────────────
  // OZ AccessManager.renounceRole(roleId, callerConfirmation) requires msg.sender == callerConfirmation
  console.log("Executing: accessManager.renounceRole(EMERGENCY, emergencyEOA) ...");
  const renounceTx = await waitForTransaction(
    accessManager.renounceRole(ROLE_IDS.EMERGENCY, emergencyAddr),
    "renounce EMERGENCY role from deployer EOA",
  );
  console.log("TX hash:", renounceTx?.hash ?? "confirmed");
  console.log("");

  // ── Post-flight verification ───────────────────────────────────────────────
  const [timelockHasAfter] = await accessManager.hasRole(ROLE_IDS.EMERGENCY, timelock);
  const [deployerHasAfter] = await accessManager.hasRole(ROLE_IDS.EMERGENCY, emergencyAddr);

  console.log("=== POST-TRANSFER STATE ===");
  console.log(`Timelock    hasRole(EMERGENCY): ${timelockHasAfter}   ← must be true`);
  console.log(`DeployerEOA hasRole(EMERGENCY): ${deployerHasAfter}  ← must be false`);
  console.log("");

  if (!timelockHasAfter || deployerHasAfter) {
    throw new Error(
      `Role transfer verification failed! ` +
        `timelockHas=${timelockHasAfter}, deployerHas=${deployerHasAfter}`,
    );
  }

  console.log("✅ VAL-ASYNC-003: EMERGENCY_ADMIN_ROLE successfully transferred to timelock.");
  console.log("   Timelock holds EMERGENCY: true");
  console.log("   Deployer EOA holds EMERGENCY: false");

  // ── Write proof artifact ───────────────────────────────────────────────────
  const proof = {
    timestamp: new Date().toISOString(),
    feature: "admin-transfer-timelock",
    validation: "VAL-ASYNC-003",
    network: "polkadot-hub-testnet",
    chainId: 420420417,
    accessManager: manifest.contracts.accessManager,
    emergencyRoleId: ROLE_IDS.EMERGENCY,
    timelockAddress: timelock,
    deployerEOA: emergencyAddr,
    renounceTxHash: renounceTx?.hash,
    preState: {
      timelockHasEmergency: timelockHasBefore,
      deployerHasEmergency: deployerHasBefore,
    },
    postState: {
      timelockHasEmergency: timelockHasAfter,
      deployerHasEmergency: deployerHasAfter,
    },
    result: "EMERGENCY_ADMIN transferred to governance timelock",
  };

  const proofPath = path.join(__dirname, "../deployments/polkadot-hub-testnet-emergency-admin-transfer.json");
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2));
  console.log("Proof written to:", proofPath);
}

runEntrypoint("scripts/transferEmergencyAdminToTimelock.ts", main);
