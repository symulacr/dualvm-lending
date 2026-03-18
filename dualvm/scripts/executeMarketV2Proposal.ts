/**
 * executeMarketV2Proposal.ts
 *
 * Executes the already-queued governance proposal for market-v2-registration.
 * Run this after deployMarketV2Registration.ts times out during timelock wait.
 *
 * The proposal must already be queued (Queued state = 5) for this to work.
 */
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { loadDeploymentManifest, writeDeploymentManifest } from "../lib/deployment/manifestStore";
import { loadActors } from "../lib/runtime/actors";
import { attachContract } from "../lib/runtime/contracts";
import { waitForCondition } from "../lib/runtime/transactions";
import { ROLE_IDS } from "../lib/config/marketConfig";
import { runEntrypoint } from "../lib/runtime/entrypoint";
import type { HexAddress } from "../lib/shared/deploymentManifest";

const { ethers } = hre;

function selector(contract: any, name: string): string {
  const fragment = contract.interface.getFunction(name);
  if (!fragment) throw new Error(`Missing selector for ${name}`);
  return fragment.selector;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProposalState(
  governor: any,
  proposalId: bigint,
  targetState: number,
  label: string,
  timeoutMs = 120_000,
) {
  await waitForCondition(
    label,
    async () => {
      const state = await governor.state(proposalId);
      return Number(state) === targetState;
    },
    { intervalMs: 5_000, timeoutMs },
  );
}

export async function main() {
  const manifest = loadDeploymentManifest();
  const { admin } = loadActors(["admin"] as const);
  console.log(`Admin: ${admin.address}`);

  // Load V2 contracts manifest
  const v2ManifestPath = path.join(process.cwd(), "deployments", "polkadot-hub-testnet-v2-contracts.json");
  const v2Manifest = JSON.parse(fs.readFileSync(v2ManifestPath, "utf8"));

  const lendingCoreV2Address: string = v2Manifest.contracts.lendingCoreV2.address;
  const riskAdapterV2Address: string = v2Manifest.contracts.riskAdapterV2.address;
  const debtPoolV2Address: string = v2Manifest.contracts.debtPoolV2.address;
  const pvmDeterministicRiskModelAddress: string = v2Manifest.pvmDeterministicRiskModel;
  const oracleAddress: string = manifest.contracts.oracle;

  // Get the LendingRouterV2 address that was deployed by deployMarketV2Registration.ts
  // It should be in v2Manifest if the deploy script updated it, otherwise read from environment
  let lendingRouterV2Address: string;
  if (v2Manifest.contracts.lendingRouterV2?.address) {
    lendingRouterV2Address = v2Manifest.contracts.lendingRouterV2.address;
    console.log(`LendingRouterV2 from v2 manifest: ${lendingRouterV2Address}`);
  } else {
    // The deploy script didn't finish, so we need the address from the partial run
    // Check if it's passed as an environment variable
    const envAddr = process.env.LENDING_ROUTER_V2_ADDRESS;
    if (!envAddr) {
      throw new Error(
        "LendingRouterV2 address not found in v2 manifest and LENDING_ROUTER_V2_ADDRESS env var not set. " +
        "Set LENDING_ROUTER_V2_ADDRESS=0x08aace96441Cb320BC68b072D110169fbf38eb08"
      );
    }
    lendingRouterV2Address = envAddr;
    console.log(`LendingRouterV2 from env: ${lendingRouterV2Address}`);
  }

  console.log(`LendingCoreV2:    ${lendingCoreV2Address}`);
  console.log(`RiskAdapterV2:    ${riskAdapterV2Address}`);
  console.log(`DebtPoolV2:       ${debtPoolV2Address}`);
  console.log(`Oracle:           ${oracleAddress}`);
  console.log(`LendingRouterV2:  ${lendingRouterV2Address}`);

  // Attach contracts
  const accessManager = await attachContract<any>("DualVMAccessManager", admin, manifest.contracts.accessManager);
  const governor = await attachContract<any>("DualVMGovernor", admin, manifest.contracts.governor!);
  const marketRegistry = await attachContract<any>("MarketVersionRegistry", admin, manifest.contracts.marketRegistry!);
  const oracle = await attachContract<any>("ManualOracle", admin, oracleAddress);
  const lendingCoreV2 = await attachContract<any>("LendingCoreV2", admin, lendingCoreV2Address);

  // Read current registry state
  const latestVersionId = await marketRegistry.latestVersionId();
  const activeVersionId = await marketRegistry.activeVersionId();
  const expectedV2VersionId = latestVersionId + 1n;
  console.log(`\nCurrent latestVersionId: ${latestVersionId}`);
  console.log(`Current activeVersionId: ${activeVersionId}`);
  console.log(`Expected V2 version ID: ${expectedV2VersionId}`);

  // Reconstruct proposal targets/values/calldatas (must match exactly)
  const targets: string[] = [];
  const values: bigint[] = [];
  const calldatas: string[] = [];

  targets.push(manifest.contracts.marketRegistry!);
  values.push(0n);
  calldatas.push(
    marketRegistry.interface.encodeFunctionData("registerVersion", [
      lendingCoreV2Address,
      debtPoolV2Address,
      oracleAddress,
      riskAdapterV2Address,
    ]),
  );

  targets.push(manifest.contracts.marketRegistry!);
  values.push(0n);
  calldatas.push(marketRegistry.interface.encodeFunctionData("activateVersion", [expectedV2VersionId]));

  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(accessManager.interface.encodeFunctionData("labelRole", [ROLE_IDS.ROUTER, "ROUTER_ROLE"]));

  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(
    accessManager.interface.encodeFunctionData("setTargetFunctionRole", [
      lendingCoreV2Address,
      [selector(lendingCoreV2, "depositCollateralFor")],
      ROLE_IDS.ROUTER,
    ]),
  );

  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(
    accessManager.interface.encodeFunctionData("grantRole", [ROLE_IDS.ROUTER, lendingRouterV2Address, 0]),
  );

  targets.push(oracleAddress);
  values.push(0n);
  calldatas.push(oracle.interface.encodeFunctionData("setMaxAge", [1800]));

  const description = `V2 registration: register+activate market V2, wire ROUTER role, set oracle maxAge=1800`;

  // Check current proposal state
  const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.id(description));
  console.log(`\nProposal ID: ${proposalId.toString()}`);

  const currentState = await governor.state(proposalId);
  console.log(`Current proposal state: ${currentState} (5=Queued, 7=Executed)`);

  if (Number(currentState) === 7) {
    console.log("Proposal already executed!");
  } else if (Number(currentState) === 5) {
    console.log("Proposal is Queued. Executing...");
    const executeTx = await governor.execute(targets, values, calldatas, ethers.id(description));
    const executeReceipt = await executeTx.wait();
    console.log(`Executed: ${executeReceipt.hash}`);

    // Confirm Executed state = 7
    await waitForProposalState(governor, proposalId, 7, "wait for Executed state", 60_000);
    console.log("✓ Governance proposal executed successfully");
  } else if (Number(currentState) === 4) {
    throw new Error("Proposal is Succeeded but not yet queued. Run queue first.");
  } else {
    throw new Error(`Unexpected proposal state: ${currentState}`);
  }

  await sleep(3_000);

  // ─── Verify on-chain state ───
  console.log("\n─── Verifying on-chain state ───");

  const newActiveVersionId = await marketRegistry.activeVersionId();
  console.log(`activeVersionId: ${newActiveVersionId}`);
  if (newActiveVersionId !== expectedV2VersionId) {
    throw new Error(`activeVersionId mismatch: expected ${expectedV2VersionId}, got ${newActiveVersionId}`);
  }
  console.log(`✓ activeVersionId = ${newActiveVersionId} (V2 activated)`);

  const newMaxAge = await oracle.maxAge();
  console.log(`oracle.maxAge(): ${newMaxAge}`);
  if (newMaxAge !== 1800n) {
    throw new Error(`oracle.maxAge mismatch: expected 1800, got ${newMaxAge}`);
  }
  console.log("✓ oracle.maxAge() = 1800");

  const [routerHasRole] = await accessManager.hasRole(ROLE_IDS.ROUTER, lendingRouterV2Address);
  console.log(`hasRole(ROUTER, LendingRouterV2): ${routerHasRole}`);
  if (!routerHasRole) {
    throw new Error("ROUTER role not granted to LendingRouterV2");
  }
  console.log("✓ LendingRouterV2 has ROUTER role");

  // ─── Update manifests ───
  console.log("\n─── Updating manifests ───");

  // Update V2 manifest with LendingRouterV2 if not already there
  if (!v2Manifest.contracts.lendingRouterV2) {
    v2Manifest.contracts.lendingRouterV2 = {
      address: lendingRouterV2Address,
      note: "LendingRouterV2: wraps PAS→WPAS and calls depositCollateralFor in 1 TX",
    };
  }
  v2Manifest.marketRegistry = {
    activeVersionId: newActiveVersionId.toString(),
    v2VersionId: expectedV2VersionId.toString(),
    lendingCoreV2: lendingCoreV2Address,
    debtPoolV2: debtPoolV2Address,
    oracle: oracleAddress,
    riskAdapterV2: riskAdapterV2Address,
    registeredAt: new Date().toISOString(),
  };
  v2Manifest.oracleMaxAge = {
    newValue: 1800,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(v2ManifestPath, JSON.stringify(v2Manifest, null, 2));
  console.log(`V2 contracts manifest updated: ${v2ManifestPath}`);

  // Update canonical manifest
  manifest.contracts.lendingCoreV2 = lendingCoreV2Address as HexAddress;
  manifest.contracts.riskEngineV2 = riskAdapterV2Address as HexAddress;
  manifest.contracts.debtPoolV2 = debtPoolV2Address as HexAddress;
  manifest.contracts.lendingRouterV2 = lendingRouterV2Address as HexAddress;
  manifest.contracts.pvmDeterministicRiskModel = pvmDeterministicRiskModelAddress as HexAddress;
  manifest.config.oracleMaxAgeSeconds = 1800;
  const manifestPath = writeDeploymentManifest(manifest);
  console.log(`Canonical manifest updated: ${manifestPath}`);

  console.log("\n═══ MARKET V2 REGISTRATION COMPLETE ═══");
  console.log(JSON.stringify({
    lendingRouterV2: lendingRouterV2Address,
    v2VersionId: expectedV2VersionId.toString(),
    activeVersionId: newActiveVersionId.toString(),
    oracleMaxAge: 1800,
    routerRoleGranted: routerHasRole,
  }, null, 2));
}

runEntrypoint("scripts/executeMarketV2Proposal.ts", main);
