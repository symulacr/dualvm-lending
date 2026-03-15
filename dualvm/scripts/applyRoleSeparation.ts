import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { executeManagedCall } from "./accessManagerOps";
import { LIVE_ROLE_EXECUTION_DELAYS_SECONDS, ROLE_IDS } from "./marketConfig";

const { ethers } = hre;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function waitFor(txPromise: Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }>, label: string) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${receipt.hash ?? tx.hash ?? "mined"}`);
}

async function main() {
  const manifestPath = path.join(process.cwd(), "deployments", "polkadot-hub-testnet.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const provider = ethers.provider;

  const admin = new ethers.Wallet(requireEnv("ADMIN_PRIVATE_KEY"), provider);
  const emergency = new ethers.Wallet(requireEnv("EMERGENCY_PRIVATE_KEY"), provider);
  const risk = new ethers.Wallet(requireEnv("RISK_PRIVATE_KEY"), provider);
  const treasury = new ethers.Wallet(requireEnv("TREASURY_PRIVATE_KEY"), provider);
  const minter = new ethers.Wallet(requireEnv("MINTER_PRIVATE_KEY"), provider);

  const accessManager = (await ethers.getContractFactory("DualVMAccessManager", admin)).attach(manifest.contracts.accessManager);
  const lendingCoreRisk = (await ethers.getContractFactory("LendingCore", risk)).attach(manifest.contracts.lendingCore);

  await waitFor(
    accessManager.grantRole(ROLE_IDS.EMERGENCY, emergency.address, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.emergency),
    "grant emergency role",
  );
  await waitFor(
    accessManager.grantRole(ROLE_IDS.RISK_ADMIN, risk.address, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.riskAdmin),
    "grant risk role",
  );
  await waitFor(
    accessManager.grantRole(ROLE_IDS.TREASURY, treasury.address, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.treasury),
    "grant treasury role",
  );
  await waitFor(
    accessManager.grantRole(ROLE_IDS.MINTER, minter.address, LIVE_ROLE_EXECUTION_DELAYS_SECONDS.minter),
    "grant minter role",
  );

  await executeManagedCall(
    accessManager,
    risk,
    lendingCoreRisk,
    "setTreasury",
    [treasury.address],
    "set live treasury address",
    LIVE_ROLE_EXECUTION_DELAYS_SECONDS.riskAdmin,
  );

  const previousRoles = manifest.roles;
  if (previousRoles.emergencyAdmin.toLowerCase() !== emergency.address.toLowerCase()) {
    await waitFor(accessManager.revokeRole(ROLE_IDS.EMERGENCY, previousRoles.emergencyAdmin), "revoke old emergency role");
  }
  if (previousRoles.riskAdmin.toLowerCase() !== risk.address.toLowerCase()) {
    await waitFor(accessManager.revokeRole(ROLE_IDS.RISK_ADMIN, previousRoles.riskAdmin), "revoke old risk role");
  }
  if (previousRoles.treasuryOperator.toLowerCase() !== treasury.address.toLowerCase()) {
    await waitFor(accessManager.revokeRole(ROLE_IDS.TREASURY, previousRoles.treasuryOperator), "revoke old treasury role");
  }
  if (previousRoles.minter.toLowerCase() !== minter.address.toLowerCase()) {
    await waitFor(accessManager.revokeRole(ROLE_IDS.MINTER, previousRoles.minter), "revoke old minter role");
  }

  manifest.roles = {
    treasury: treasury.address,
    emergencyAdmin: emergency.address,
    riskAdmin: risk.address,
    treasuryOperator: treasury.address,
    minter: minter.address,
  };
  manifest.governance = {
    admin: admin.address,
    executionDelaySeconds: LIVE_ROLE_EXECUTION_DELAYS_SECONDS,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
