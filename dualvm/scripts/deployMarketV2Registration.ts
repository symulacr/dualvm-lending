/**
 * deployMarketV2Registration.ts
 *
 * Performs all steps for market-v2-registration:
 *  1. Deploys LendingRouterV2 (WPAS + LendingCoreV2 addresses)
 *  2. Creates and executes a governance proposal that:
 *       a. Registers V2 in MarketVersionRegistry
 *          (LendingCoreV2, DebtPoolV2, ManualOracle, RiskAdapterV2)
 *       b. Activates V2 as the active market version
 *       c. Wires depositCollateralFor on LendingCoreV2 to ROUTER role (ID 8)
 *       d. Grants LendingRouterV2 the ROUTER role
 *       e. Sets ManualOracle.maxAge = 1800 (30 min, down from 6 h)
 *  3. Updates the canonical manifest with all new V2 contract addresses.
 *
 * Prerequisites:
 *  - pvm-risk-model-compile-deploy (PVM DeterministicRiskModel deployed)
 *  - risk-adapter-v2-deploy (RiskAdapterV2 + LendingCoreV2 + DebtPoolV2 deployed)
 *  - lending-router-v2 (LendingRouterV2.sol committed to codebase)
 *
 * Satisfies: VAL-STAB-006, VAL-STAB-007
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
  timeoutMs = 700_000,
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
  const results: Record<string, any> = {
    startedAt: new Date().toISOString(),
    network: manifest.polkadotHubTestnet,
    steps: {},
  };

  // Load actors
  const { admin } = loadActors(["admin"] as const);
  console.log(`Admin (proposer/deployer): ${admin.address}`);

  if (!manifest.contracts.governor || !manifest.contracts.governanceTimelock || !manifest.contracts.marketRegistry) {
    throw new Error("Manifest missing governor/timelock/marketRegistry — not a governed deployment");
  }

  // ─── Load V2 contract addresses from existing v2-contracts manifest ───
  const v2ManifestPath = path.join(process.cwd(), "deployments", "polkadot-hub-testnet-v2-contracts.json");
  if (!fs.existsSync(v2ManifestPath)) {
    throw new Error(`V2 contracts manifest not found at ${v2ManifestPath}. Run risk-adapter-v2-deploy first.`);
  }
  const v2Manifest = JSON.parse(fs.readFileSync(v2ManifestPath, "utf8"));

  const lendingCoreV2Address: string = v2Manifest.contracts.lendingCoreV2.address;
  const riskAdapterV2Address: string = v2Manifest.contracts.riskAdapterV2.address;
  const debtPoolV2Address: string = v2Manifest.contracts.debtPoolV2.address;
  const pvmDeterministicRiskModelAddress: string = v2Manifest.pvmDeterministicRiskModel;
  const oracleAddress: string = manifest.contracts.oracle;

  console.log(`LendingCoreV2:        ${lendingCoreV2Address}`);
  console.log(`RiskAdapterV2:        ${riskAdapterV2Address}`);
  console.log(`DebtPoolV2:           ${debtPoolV2Address}`);
  console.log(`ManualOracle:         ${oracleAddress}`);
  console.log(`PVM DeterministicRM:  ${pvmDeterministicRiskModelAddress}`);

  // Attach existing contracts
  const accessManager = await attachContract<any>("DualVMAccessManager", admin, manifest.contracts.accessManager);
  const governor = await attachContract<any>("DualVMGovernor", admin, manifest.contracts.governor);
  const governanceToken = await attachContract<any>("GovernanceToken", admin, manifest.contracts.governanceToken!);
  const marketRegistry = await attachContract<any>("MarketVersionRegistry", admin, manifest.contracts.marketRegistry);
  const oracle = await attachContract<any>("ManualOracle", admin, oracleAddress);
  const lendingCoreV2 = await attachContract<any>("LendingCoreV2", admin, lendingCoreV2Address);

  // ═══════════════════════════════════════════════════════════════════════
  // Step 1: Ensure governance token delegation
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 1: Ensure governance token delegation ═══");
  const adminVotes = await governanceToken.getVotes(admin.address);
  const adminBalance = await governanceToken.balanceOf(admin.address);
  console.log(`Admin balance: ${ethers.formatEther(adminBalance)} GOV, votes: ${ethers.formatEther(adminVotes)}`);

  if (adminVotes === 0n && adminBalance > 0n) {
    const delegateTx = await governanceToken.connect(admin).delegate(admin.address);
    const delegateReceipt = await delegateTx.wait();
    console.log(`Self-delegated governance tokens: ${delegateReceipt.hash}`);
    results.steps.delegate = delegateReceipt.hash;
    await sleep(3_000);
  } else if (adminVotes > 0n) {
    console.log("Already delegated, skipping.");
  } else {
    throw new Error("Admin has no governance tokens — cannot propose");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Step 2: Deploy LendingRouterV2
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 2: Deploy LendingRouterV2 ═══");
  const lendingRouterV2Factory = await ethers.getContractFactory("LendingRouterV2", admin);
  const lendingRouterV2 = await lendingRouterV2Factory.deploy(
    manifest.contracts.wpas,
    lendingCoreV2Address,
  );
  await lendingRouterV2.waitForDeployment();
  const lendingRouterV2Address = await lendingRouterV2.getAddress();
  console.log(`LendingRouterV2 deployed: ${lendingRouterV2Address}`);
  console.log(`Deploy tx: ${lendingRouterV2.deploymentTransaction()?.hash}`);

  results.steps.lendingRouterV2 = {
    address: lendingRouterV2Address,
    deployTxHash: lendingRouterV2.deploymentTransaction()?.hash,
    explorerUrl: `${manifest.polkadotHubTestnet.explorerUrl}address/${lendingRouterV2Address}`,
    wpas: manifest.contracts.wpas,
    lendingCore: lendingCoreV2Address,
  };

  await sleep(3_000);

  // ═══════════════════════════════════════════════════════════════════════
  // Step 3: Read current registry state
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 3: Read registry state ═══");
  const latestVersionId = await marketRegistry.latestVersionId();
  const activeVersionId = await marketRegistry.activeVersionId();
  const expectedV2VersionId = latestVersionId + 1n;
  console.log(`Current latestVersionId: ${latestVersionId}`);
  console.log(`Current activeVersionId: ${activeVersionId}`);
  console.log(`Expected V2 version ID after registration: ${expectedV2VersionId}`);

  const currentMaxAge = await oracle.maxAge();
  console.log(`Current oracle maxAge: ${currentMaxAge}s (${Number(currentMaxAge) / 3600} hours)`);

  // ═══════════════════════════════════════════════════════════════════════
  // Step 4: Build governance proposal
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 4: Build governance proposal ═══");

  const targets: string[] = [];
  const values: bigint[] = [];
  const calldatas: string[] = [];

  // Op 1: Register V2 in MarketVersionRegistry
  targets.push(manifest.contracts.marketRegistry);
  values.push(0n);
  calldatas.push(
    marketRegistry.interface.encodeFunctionData("registerVersion", [
      lendingCoreV2Address,
      debtPoolV2Address,
      oracleAddress,
      riskAdapterV2Address,
    ]),
  );

  // Op 2: Activate V2 (version ID = latestVersionId + 1 = expectedV2VersionId)
  targets.push(manifest.contracts.marketRegistry);
  values.push(0n);
  calldatas.push(marketRegistry.interface.encodeFunctionData("activateVersion", [expectedV2VersionId]));

  // Op 3: Label ROUTER role
  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(accessManager.interface.encodeFunctionData("labelRole", [ROLE_IDS.ROUTER, "ROUTER_ROLE"]));

  // Op 4: Wire depositCollateralFor on LendingCoreV2 to ROUTER role
  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(
    accessManager.interface.encodeFunctionData("setTargetFunctionRole", [
      lendingCoreV2Address,
      [selector(lendingCoreV2, "depositCollateralFor")],
      ROLE_IDS.ROUTER,
    ]),
  );

  // Op 5: Grant ROUTER role to LendingRouterV2
  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(
    accessManager.interface.encodeFunctionData("grantRole", [ROLE_IDS.ROUTER, lendingRouterV2Address, 0]),
  );

  // Op 6: Set ManualOracle.maxAge = 1800 (30 min)
  // Timelock holds RISK_ADMIN role with delay 0, so it can call oracle.setMaxAge directly.
  targets.push(oracleAddress);
  values.push(0n);
  calldatas.push(oracle.interface.encodeFunctionData("setMaxAge", [1800]));

  const description = `V2 registration: register+activate market V2, wire ROUTER role, set oracle maxAge=1800`;
  console.log(`Proposal has ${targets.length} operations:`);
  console.log("  1. MarketVersionRegistry.registerVersion(LendingCoreV2, DebtPoolV2, Oracle, RiskAdapterV2)");
  console.log(`  2. MarketVersionRegistry.activateVersion(${expectedV2VersionId})`);
  console.log("  3. AccessManager.labelRole(ROUTER_ROLE)");
  console.log("  4. AccessManager.setTargetFunctionRole(LendingCoreV2, [depositCollateralFor], ROUTER)");
  console.log("  5. AccessManager.grantRole(ROUTER, LendingRouterV2, 0)");
  console.log("  6. ManualOracle.setMaxAge(1800)");

  // ═══════════════════════════════════════════════════════════════════════
  // Step 5: Submit governance proposal
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 5: Submit governance proposal ═══");
  const proposeTx = await governor.connect(admin).propose(targets, values, calldatas, description);
  const proposeReceipt = await proposeTx.wait();
  console.log(`Proposal submitted: ${proposeReceipt.hash}`);
  results.steps.proposeTx = proposeReceipt.hash;

  const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.id(description));
  console.log(`Proposal ID: ${proposalId.toString()}`);

  // Wait for voting delay (Active state = 1)
  console.log("Waiting for voting delay to pass (Active state)...");
  await waitForProposalState(governor, proposalId, 1, "wait for Active state", 120_000);

  // Vote in favor
  console.log("Casting vote FOR...");
  const voteTx = await governor.connect(admin).castVote(proposalId, 1);
  const voteReceipt = await voteTx.wait();
  console.log(`Vote cast: ${voteReceipt.hash}`);
  results.steps.voteTx = voteReceipt.hash;

  // Wait for voting period to end (Succeeded state = 4)
  console.log("Waiting for voting period to end (~300s)...");
  await waitForProposalState(governor, proposalId, 4, "wait for Succeeded state", 700_000);

  // Queue
  console.log("Queueing proposal...");
  const queueTx = await governor.queue(targets, values, calldatas, ethers.id(description));
  const queueReceipt = await queueTx.wait();
  console.log(`Queued: ${queueReceipt.hash}`);
  results.steps.queueTx = queueReceipt.hash;

  // Wait for timelock delay
  console.log("Waiting for timelock delay (70s)...");
  await sleep(70_000);

  // Execute
  console.log("Executing proposal...");
  const executeTx = await governor.execute(targets, values, calldatas, ethers.id(description));
  const executeReceipt = await executeTx.wait();
  console.log(`Executed: ${executeReceipt.hash}`);
  results.steps.executeTx = executeReceipt.hash;

  // Confirm Executed state = 7
  await waitForProposalState(governor, proposalId, 7, "wait for Executed state", 60_000);
  console.log("✓ Governance proposal executed successfully");

  // ═══════════════════════════════════════════════════════════════════════
  // Step 6: Verify on-chain state
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 6: Verify on-chain state ═══");
  await sleep(3_000);

  // Check activeVersionId
  const newActiveVersionId = await marketRegistry.activeVersionId();
  console.log(`activeVersionId: ${newActiveVersionId}`);
  if (newActiveVersionId !== expectedV2VersionId) {
    throw new Error(`activeVersionId mismatch: expected ${expectedV2VersionId}, got ${newActiveVersionId}`);
  }
  console.log(`✓ activeVersionId = ${newActiveVersionId} (V2 activated)`);

  // Check registered version matches V2 contracts
  const registeredV2 = await marketRegistry.getVersion(expectedV2VersionId);
  console.log(`V2 lendingCore: ${registeredV2.lendingCore}`);
  console.log(`V2 debtPool:    ${registeredV2.debtPool}`);
  console.log(`V2 oracle:      ${registeredV2.oracle}`);
  console.log(`V2 riskEngine:  ${registeredV2.riskEngine}`);

  if (registeredV2.lendingCore.toLowerCase() !== lendingCoreV2Address.toLowerCase()) {
    throw new Error("Registered V2 lendingCore mismatch");
  }
  if (registeredV2.debtPool.toLowerCase() !== debtPoolV2Address.toLowerCase()) {
    throw new Error("Registered V2 debtPool mismatch");
  }
  if (registeredV2.oracle.toLowerCase() !== oracleAddress.toLowerCase()) {
    throw new Error("Registered V2 oracle mismatch");
  }
  if (registeredV2.riskEngine.toLowerCase() !== riskAdapterV2Address.toLowerCase()) {
    throw new Error("Registered V2 riskEngine mismatch");
  }
  console.log("✓ V2 version registered with correct addresses");

  // Check oracle maxAge
  const newMaxAge = await oracle.maxAge();
  console.log(`oracle.maxAge(): ${newMaxAge}`);
  if (newMaxAge !== 1800n) {
    throw new Error(`oracle.maxAge mismatch: expected 1800, got ${newMaxAge}`);
  }
  console.log("✓ oracle.maxAge() = 1800 (30 min)");

  // Check ROUTER role granted to LendingRouterV2
  const [routerHasRole] = await accessManager.hasRole(ROLE_IDS.ROUTER, lendingRouterV2Address);
  console.log(`hasRole(ROUTER, LendingRouterV2): ${routerHasRole}`);
  if (!routerHasRole) {
    throw new Error("ROUTER role not granted to LendingRouterV2");
  }
  console.log("✓ LendingRouterV2 has ROUTER role");

  results.steps.verification = {
    activeVersionId: newActiveVersionId.toString(),
    v2VersionId: expectedV2VersionId.toString(),
    registeredV2Addresses: {
      lendingCore: registeredV2.lendingCore,
      debtPool: registeredV2.debtPool,
      oracle: registeredV2.oracle,
      riskEngine: registeredV2.riskEngine,
    },
    oracleMaxAge: newMaxAge.toString(),
    routerRoleGranted: routerHasRole,
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Step 7: Update V2 manifest with LendingRouterV2
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 7: Update V2 contracts manifest ═══");
  v2Manifest.contracts.lendingRouterV2 = {
    address: lendingRouterV2Address,
    deployTxHash: lendingRouterV2.deploymentTransaction()?.hash,
    explorerUrl: `${manifest.polkadotHubTestnet.explorerUrl}address/${lendingRouterV2Address}`,
    wpas: manifest.contracts.wpas,
    lendingCore: lendingCoreV2Address,
    note: "LendingRouterV2: wraps PAS→WPAS and calls depositCollateralFor in 1 TX",
  };
  v2Manifest.governance.marketV2RegistrationProposalTxHash = results.steps.proposeTx;
  v2Manifest.governance.marketV2RegistrationVoteTxHash = results.steps.voteTx;
  v2Manifest.governance.marketV2RegistrationQueueTxHash = results.steps.queueTx;
  v2Manifest.governance.marketV2RegistrationExecuteTxHash = results.steps.executeTx;
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
    previousValue: Number(currentMaxAge),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(v2ManifestPath, JSON.stringify(v2Manifest, null, 2));
  console.log(`V2 contracts manifest updated: ${v2ManifestPath}`);

  // ═══════════════════════════════════════════════════════════════════════
  // Step 8: Update canonical manifest with V2 addresses
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 8: Update canonical manifest ═══");
  manifest.contracts.lendingCoreV2 = lendingCoreV2Address as HexAddress;
  manifest.contracts.riskEngineV2 = riskAdapterV2Address as HexAddress;
  manifest.contracts.debtPoolV2 = debtPoolV2Address as HexAddress;
  manifest.contracts.lendingRouterV2 = lendingRouterV2Address as HexAddress;
  manifest.contracts.pvmDeterministicRiskModel = pvmDeterministicRiskModelAddress as HexAddress;
  manifest.config.oracleMaxAgeSeconds = 1800;
  const manifestPath = writeDeploymentManifest(manifest);
  console.log(`Canonical manifest updated: ${manifestPath}`);

  results.completedAt = new Date().toISOString();
  results.summary = {
    lendingRouterV2: lendingRouterV2Address,
    v2VersionId: expectedV2VersionId.toString(),
    activeVersionId: newActiveVersionId.toString(),
    oracleMaxAge: 1800,
    routerRoleGranted: routerHasRole,
    manifestUpdated: manifestPath,
  };

  console.log("\n═══ DEPLOYMENT COMPLETE ═══");
  console.log(JSON.stringify(results, null, 2));
}

runEntrypoint("scripts/deployMarketV2Registration.ts", main);
