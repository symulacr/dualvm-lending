/**
 * Deploy RiskAdapterV2 + LendingCoreV2
 *
 * Deploys a new RiskAdapter instance with constructor arg quoteEngine_ pointing to the
 * PVM-compiled DeterministicRiskModel address. Deploys LendingCoreV2 with a fresh DebtPool
 * (reusing existing Oracle). Wires AccessManager roles via governance proposal.
 *
 * Satisfies VAL-STAB-002: RiskAdapterV2.quoteEngine() returns PVM DeterministicRiskModel address.
 */
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { loadActors } from "../lib/runtime/actors";
import { attachContract } from "../lib/runtime/contracts";
import { formatWad, waitForCondition } from "../lib/runtime/transactions";
import {
  CORE_DEFAULTS,
  ORACLE_CIRCUIT_BREAKER_DEFAULTS,
  POOL_DEFAULTS,
  RISK_ENGINE_DEFAULTS,
  ROLE_IDS,
} from "../lib/config/marketConfig";
import { runEntrypoint } from "../lib/runtime/entrypoint";

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

  if (!manifest.contracts.governor || !manifest.contracts.governanceTimelock) {
    throw new Error("Manifest missing governor/timelock — not a governed deployment");
  }

  // Get PVM DeterministicRiskModel address from probes manifest
  const probesManifestPath = path.join(process.cwd(), "deployments", "polkadot-hub-testnet-probes.json");
  const probesManifest = JSON.parse(fs.readFileSync(probesManifestPath, "utf8"));
  const pvmDeterministicRiskModelAddress: string = probesManifest.pvm.deterministicRiskModel.address;
  if (!pvmDeterministicRiskModelAddress) {
    throw new Error("PVM DeterministicRiskModel address not found in probes manifest");
  }
  console.log(`PVM DeterministicRiskModel: ${pvmDeterministicRiskModelAddress}`);

  // XcmLiquidationNotifier (working one from xcm-full-integration)
  const xcmManifestPath = path.join(process.cwd(), "deployments", "polkadot-hub-testnet-xcm-full-integration.json");
  const xcmManifest = JSON.parse(fs.readFileSync(xcmManifestPath, "utf8"));
  const liquidationNotifierAddress: string = xcmManifest.canonicalContracts?.xcmLiquidationNotifier?.address ?? "0x0000000000000000000000000000000000000000";
  console.log(`XcmLiquidationNotifier: ${liquidationNotifierAddress}`);

  // Attach existing contracts
  const accessManager = await attachContract<any>("DualVMAccessManager", admin, manifest.contracts.accessManager);
  const governor = await attachContract<any>("DualVMGovernor", admin, manifest.contracts.governor);
  const governanceToken = await attachContract<any>("GovernanceToken", admin, manifest.contracts.governanceToken!);

  // ═══════════════════════════════════════════════════════════════════════
  // Step 1: Self-delegate governance tokens (if not already)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 1: Ensure governance token delegation ═══");
  const adminVotes = await governanceToken.getVotes(admin.address);
  const adminBalance = await governanceToken.balanceOf(admin.address);
  console.log(`Admin governance token balance: ${formatWad(adminBalance)}`);
  console.log(`Admin voting power: ${formatWad(adminVotes)}`);

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
  // Step 2: Deploy RiskAdapterV2 with PVM DeterministicRiskModel
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 2: Deploy RiskAdapterV2 ═══");
  const riskAdapterFactory = await ethers.getContractFactory("RiskAdapter", admin);
  const riskAdapterV2 = await riskAdapterFactory.deploy(
    manifest.contracts.accessManager,
    pvmDeterministicRiskModelAddress,
    {
      baseRateBps: RISK_ENGINE_DEFAULTS.baseRateBps,
      slope1Bps: RISK_ENGINE_DEFAULTS.slope1Bps,
      slope2Bps: RISK_ENGINE_DEFAULTS.slope2Bps,
      kinkBps: RISK_ENGINE_DEFAULTS.kinkBps,
      healthyMaxLtvBps: RISK_ENGINE_DEFAULTS.healthyMaxLtvBps,
      stressedMaxLtvBps: RISK_ENGINE_DEFAULTS.stressedMaxLtvBps,
      healthyLiquidationThresholdBps: RISK_ENGINE_DEFAULTS.healthyLiquidationThresholdBps,
      stressedLiquidationThresholdBps: RISK_ENGINE_DEFAULTS.stressedLiquidationThresholdBps,
      staleBorrowRatePenaltyBps: RISK_ENGINE_DEFAULTS.staleBorrowRatePenaltyBps,
      stressedCollateralRatioBps: RISK_ENGINE_DEFAULTS.stressedCollateralRatioBps,
    },
  );
  await riskAdapterV2.waitForDeployment();
  const riskAdapterV2Address = await riskAdapterV2.getAddress();
  console.log(`RiskAdapterV2 deployed: ${riskAdapterV2Address}`);

  // Verify quoteEngine is set correctly
  const actualQuoteEngine = await riskAdapterV2.quoteEngine();
  console.log(`RiskAdapterV2.quoteEngine(): ${actualQuoteEngine}`);
  if (actualQuoteEngine.toLowerCase() !== pvmDeterministicRiskModelAddress.toLowerCase()) {
    throw new Error(`quoteEngine mismatch! Expected ${pvmDeterministicRiskModelAddress}, got ${actualQuoteEngine}`);
  }
  console.log("✓ quoteEngine correctly points to PVM DeterministicRiskModel");

  results.steps.riskAdapterV2 = {
    address: riskAdapterV2Address,
    quoteEngine: actualQuoteEngine,
    deployTxHash: riskAdapterV2.deploymentTransaction()?.hash,
    explorerUrl: `${manifest.polkadotHubTestnet.explorerUrl}address/${riskAdapterV2Address}`,
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Step 3: Deploy new DebtPoolV2 (can't reuse V1 DebtPool — setLendingCore is once-only)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 3: Deploy DebtPoolV2 ═══");
  const debtPoolFactory = await ethers.getContractFactory("DebtPool", admin);
  const debtPoolV2 = await debtPoolFactory.deploy(
    manifest.contracts.usdc,
    manifest.contracts.accessManager,
    POOL_DEFAULTS.supplyCap,
  );
  await debtPoolV2.waitForDeployment();
  const debtPoolV2Address = await debtPoolV2.getAddress();
  console.log(`DebtPoolV2 deployed: ${debtPoolV2Address}`);

  results.steps.debtPoolV2 = {
    address: debtPoolV2Address,
    deployTxHash: debtPoolV2.deploymentTransaction()?.hash,
    explorerUrl: `${manifest.polkadotHubTestnet.explorerUrl}address/${debtPoolV2Address}`,
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Step 4: Deploy LendingCoreV2 (reuse existing Oracle, new RiskAdapterV2, new DebtPoolV2)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 4: Deploy LendingCoreV2 ═══");
  const lendingCoreV2Factory = await ethers.getContractFactory("LendingCoreV2", admin);
  const lendingCoreV2 = await lendingCoreV2Factory.deploy(
    manifest.contracts.accessManager,
    manifest.contracts.wpas,
    manifest.contracts.usdc,
    debtPoolV2Address,
    manifest.contracts.oracle,
    riskAdapterV2Address,
    {
      borrowCap: CORE_DEFAULTS.borrowCap,
      minBorrowAmount: CORE_DEFAULTS.minBorrowAmount,
      reserveFactorBps: CORE_DEFAULTS.reserveFactorBps,
      maxLtvBps: CORE_DEFAULTS.maxLtvBps,
      liquidationThresholdBps: CORE_DEFAULTS.liquidationThresholdBps,
      liquidationBonusBps: CORE_DEFAULTS.liquidationBonusBps,
    },
    liquidationNotifierAddress, // XcmLiquidationNotifier
  );
  await lendingCoreV2.waitForDeployment();
  const lendingCoreV2Address = await lendingCoreV2.getAddress();
  console.log(`LendingCoreV2 deployed: ${lendingCoreV2Address}`);

  results.steps.lendingCoreV2 = {
    address: lendingCoreV2Address,
    deployTxHash: lendingCoreV2.deploymentTransaction()?.hash,
    explorerUrl: `${manifest.polkadotHubTestnet.explorerUrl}address/${lendingCoreV2Address}`,
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Step 5: Governance Proposal — wire DebtPoolV2, AccessManager roles
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 5: Create governance proposal for role wiring ═══");

  const targets: string[] = [];
  const values: bigint[] = [];
  const calldatas: string[] = [];

  // 1. Wire DebtPoolV2 ← LendingCoreV2
  targets.push(debtPoolV2Address);
  values.push(0n);
  calldatas.push(debtPoolV2.interface.encodeFunctionData("setLendingCore", [lendingCoreV2Address]));

  // 2. Grant LENDING_CORE role to LendingCoreV2 in AccessManager
  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(accessManager.interface.encodeFunctionData("grantRole", [ROLE_IDS.LENDING_CORE, lendingCoreV2Address, 0]));

  // 3. Set quoteViaTicket function on RiskAdapterV2 to LENDING_CORE role
  //    (target is accessManager — setTargetFunctionRole is called on the AccessManager)
  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(
    accessManager.interface.encodeFunctionData("setTargetFunctionRole", [
      riskAdapterV2Address,
      [selector(riskAdapterV2, "quoteViaTicket")],
      ROLE_IDS.LENDING_CORE,
    ]),
  );

  // 4. Wire AccessManager role for pause/unpause on LendingCoreV2 (emergency role)
  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(
    accessManager.interface.encodeFunctionData("setTargetFunctionRole", [
      lendingCoreV2Address,
      [selector(lendingCoreV2, "pause"), selector(lendingCoreV2, "unpause")],
      ROLE_IDS.EMERGENCY,
    ]),
  );

  // 5. Wire AccessManager role for pause/unpause and claimReserves on DebtPoolV2
  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(
    accessManager.interface.encodeFunctionData("setTargetFunctionRole", [
      debtPoolV2Address,
      [selector(debtPoolV2, "pause"), selector(debtPoolV2, "unpause")],
      ROLE_IDS.EMERGENCY,
    ]),
  );

  // 6. Wire DebtPoolV2 claimReserves to TREASURY role
  targets.push(manifest.contracts.accessManager);
  values.push(0n);
  calldatas.push(
    accessManager.interface.encodeFunctionData("setTargetFunctionRole", [
      debtPoolV2Address,
      [selector(debtPoolV2, "claimReserves")],
      ROLE_IDS.TREASURY,
    ]),
  );

  const description = `V2 deploy: wire DebtPoolV2, RiskAdapterV2, LendingCoreV2 roles in AccessManager`;
  console.log(`Proposal has ${targets.length} operations`);
  console.log("Submitting proposal...");

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

  // Wait for timelock delay (at least 60s; check Queued state = 5 then try execute)
  console.log("Waiting for timelock delay (70s)...");
  await sleep(70_000);

  // Execute
  console.log("Executing proposal...");
  const executeTx = await governor.execute(targets, values, calldatas, ethers.id(description));
  const executeReceipt = await executeTx.wait();
  console.log(`Executed: ${executeReceipt.hash}`);
  results.steps.executeTx = executeReceipt.hash;

  // Wait for Executed state = 7
  await waitForProposalState(governor, proposalId, 7, "wait for Executed state", 60_000);
  console.log("✓ Governance proposal executed successfully");

  // ═══════════════════════════════════════════════════════════════════════
  // Step 6: Verify on-chain
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 6: Verify on-chain ═══");

  // Verify quoteEngine
  const verifiedQuoteEngine = await riskAdapterV2.quoteEngine();
  console.log(`RiskAdapterV2.quoteEngine(): ${verifiedQuoteEngine}`);
  if (verifiedQuoteEngine.toLowerCase() !== pvmDeterministicRiskModelAddress.toLowerCase()) {
    throw new Error(`quoteEngine verification failed`);
  }
  console.log("✓ RiskAdapterV2.quoteEngine() = PVM DeterministicRiskModel");

  // Verify LENDING_CORE role granted to LendingCoreV2
  const [hasRole] = await accessManager.hasRole(ROLE_IDS.LENDING_CORE, lendingCoreV2Address);
  console.log(`hasRole(LENDING_CORE, LendingCoreV2): ${hasRole}`);
  if (!hasRole) {
    throw new Error("LENDING_CORE role not granted to LendingCoreV2");
  }
  console.log("✓ LENDING_CORE role granted to LendingCoreV2");

  // Verify DebtPool lendingCore
  const poolLendingCore = await debtPoolV2.lendingCore();
  console.log(`DebtPoolV2.lendingCore(): ${poolLendingCore}`);
  if (poolLendingCore.toLowerCase() !== lendingCoreV2Address.toLowerCase()) {
    throw new Error("DebtPoolV2.lendingCore not set to LendingCoreV2");
  }
  console.log("✓ DebtPoolV2 wired to LendingCoreV2");

  results.steps.verification = {
    quoteEngine: verifiedQuoteEngine,
    quoteEngineMatchesPvm: verifiedQuoteEngine.toLowerCase() === pvmDeterministicRiskModelAddress.toLowerCase(),
    lendingCoreRoleGranted: hasRole,
    debtPoolWired: poolLendingCore.toLowerCase() === lendingCoreV2Address.toLowerCase(),
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Step 7: Write V2 manifest
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 7: Write V2 manifest ═══");

  const v2Manifest = {
    generatedAt: new Date().toISOString(),
    description: "V2 contract deployments: RiskAdapterV2 (quoteEngine=PVM DeterministicRiskModel), LendingCoreV2 (with XCM liquidation notifier), DebtPoolV2",
    pvmDeterministicRiskModel: pvmDeterministicRiskModelAddress,
    contracts: {
      riskAdapterV2: {
        address: riskAdapterV2Address,
        deployTxHash: riskAdapterV2.deploymentTransaction()?.hash,
        explorerUrl: `${manifest.polkadotHubTestnet.explorerUrl}address/${riskAdapterV2Address}`,
        quoteEngine: pvmDeterministicRiskModelAddress,
        note: "RiskAdapter with PVM DeterministicRiskModel as quoteEngine (VAL-STAB-002)",
      },
      debtPoolV2: {
        address: debtPoolV2Address,
        deployTxHash: debtPoolV2.deploymentTransaction()?.hash,
        explorerUrl: `${manifest.polkadotHubTestnet.explorerUrl}address/${debtPoolV2Address}`,
        note: "Fresh DebtPool for V2 (V1 DebtPool already wired to LendingCore V1)",
      },
      lendingCoreV2: {
        address: lendingCoreV2Address,
        deployTxHash: lendingCoreV2.deploymentTransaction()?.hash,
        explorerUrl: `${manifest.polkadotHubTestnet.explorerUrl}address/${lendingCoreV2Address}`,
        liquidationNotifier: liquidationNotifierAddress,
        note: "LendingCoreV2 with depositCollateralFor + XcmLiquidationNotifier hook",
      },
    },
    governance: {
      proposalTxHash: results.steps.proposeTx,
      voteTxHash: results.steps.voteTx,
      queueTxHash: results.steps.queueTx,
      executeTxHash: results.steps.executeTx,
    },
    roles: {
      lendingCoreV2HoldsLendingCoreRole: hasRole,
      debtPoolV2WiredToLendingCoreV2: poolLendingCore.toLowerCase() === lendingCoreV2Address.toLowerCase(),
    },
  };

  const v2ManifestPath = path.join(process.cwd(), "deployments", "polkadot-hub-testnet-v2-contracts.json");
  fs.writeFileSync(v2ManifestPath, JSON.stringify(v2Manifest, null, 2));
  console.log(`V2 manifest written to ${v2ManifestPath}`);

  results.completedAt = new Date().toISOString();
  results.v2Contracts = v2Manifest.contracts;

  console.log("\n═══ DEPLOYMENT COMPLETE ═══");
  console.log(JSON.stringify(results, null, 2));
}

runEntrypoint("scripts/deployRiskAdapterV2.ts", main);
