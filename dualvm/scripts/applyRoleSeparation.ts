import { LIVE_ROLE_EXECUTION_DELAYS_SECONDS, ROLE_IDS } from "../lib/config/marketConfig";
import { loadDeploymentManifest, writeDeploymentManifest } from "../lib/deployment/manifestStore";
import type { HexAddress } from "../lib/shared/deploymentManifest";
import { loadActors } from "../lib/runtime/actors";
import { attachManifestContract } from "../lib/runtime/contracts";
import { waitForTransaction } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

export async function main() {
  const manifest = loadDeploymentManifest();
  const { admin, emergency, riskAdmin, treasury, minter } = loadActors(
    ["admin", "emergency", "riskAdmin", "treasury", "minter"] as const,
  );

  const accessManager = await attachManifestContract(manifest, "accessManager", "DualVMAccessManager", admin);

  await waitForTransaction(
    accessManager.grantRole(ROLE_IDS.EMERGENCY, emergency.address, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.emergency),
    "grant emergency role",
  );
  await waitForTransaction(
    accessManager.grantRole(ROLE_IDS.RISK_ADMIN, riskAdmin.address, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.riskAdmin),
    "grant risk role",
  );
  await waitForTransaction(
    accessManager.grantRole(ROLE_IDS.TREASURY, treasury.address, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.treasury),
    "grant treasury role",
  );
  await waitForTransaction(
    accessManager.grantRole(ROLE_IDS.MINTER, minter.address, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.minter),
    "grant minter role",
  );


  const previousRoles = manifest.roles;
  if (previousRoles.emergencyAdmin.toLowerCase() !== emergency.address.toLowerCase()) {
    await waitForTransaction(accessManager.revokeRole(ROLE_IDS.EMERGENCY, previousRoles.emergencyAdmin), "revoke old emergency role");
  }
  if (previousRoles.riskAdmin.toLowerCase() !== riskAdmin.address.toLowerCase()) {
    await waitForTransaction(accessManager.revokeRole(ROLE_IDS.RISK_ADMIN, previousRoles.riskAdmin), "revoke old risk role");
  }
  if (previousRoles.treasuryOperator.toLowerCase() !== treasury.address.toLowerCase()) {
    await waitForTransaction(accessManager.revokeRole(ROLE_IDS.TREASURY, previousRoles.treasuryOperator), "revoke old treasury role");
  }
  if (previousRoles.minter.toLowerCase() !== minter.address.toLowerCase()) {
    await waitForTransaction(accessManager.revokeRole(ROLE_IDS.MINTER, previousRoles.minter), "revoke old minter role");
  }

  manifest.roles = {
    treasury: treasury.address as HexAddress,
    emergencyAdmin: emergency.address as HexAddress,
    riskAdmin: riskAdmin.address as HexAddress,
    treasuryOperator: treasury.address as HexAddress,
    minter: minter.address as HexAddress,
  };
  manifest.governance = {
    admin: admin.address as HexAddress,
    executionDelaySeconds: LIVE_ROLE_EXECUTION_DELAYS_SECONDS,
  };
  writeDeploymentManifest(manifest);

  console.log(
    JSON.stringify(
      {
        roles: manifest.roles,
        governance: manifest.governance,
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/applyRoleSeparation.ts", main);
