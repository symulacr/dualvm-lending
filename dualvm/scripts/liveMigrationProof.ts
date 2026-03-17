/**
 * Live Migration Proof Script
 *
 * Executes a complete live migration proof on the canonical governed deployment:
 * 1. Deploy v2 market version + MarketMigrationCoordinator
 * 2. Create a borrower position on v1
 * 3. Run governance proposal to wire v2, register, activate, grant roles, open migration
 * 4. Execute migrateBorrower for the borrower
 * 5. Verify position exists in v2 with correct collateral/debt
 * 6. Restore v1 as active version
 * 7. Record all TX hashes in migration proof results file
 */
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { deployMarketVersion } from "../lib/deployment/deployMarketVersion";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { loadActors } from "../lib/runtime/actors";
import { attachManifestContract } from "../lib/runtime/contracts";
import { formatWad, waitForTransaction, waitForCondition } from "../lib/runtime/transactions";
import { openBorrowPosition } from "../lib/ops/liveScenario";
import { WAD, ORACLE_CIRCUIT_BREAKER_DEFAULTS } from "../lib/config/marketConfig";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

const MAX_UINT256 = 2n ** 256n - 1n;

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
  timeoutMs = 600_000,
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

  // Load actors — use 'lender' as migration borrower since the original borrower may
  // have a deeply underwater position from liquidation smoke tests
  const { admin, minter, lender: migrationBorrower } = loadActors(["admin", "minter", "lender"] as const);
  console.log(`Admin (proposer): ${admin.address}`);
  console.log(`Minter: ${minter.address}`);
  console.log(`Migration borrower (lender wallet): ${migrationBorrower.address}`);

  // Verify governed deployment
  if (!manifest.contracts.governor || !manifest.contracts.governanceTimelock || !manifest.contracts.marketRegistry || !manifest.contracts.governanceToken) {
    throw new Error("Manifest missing governor/timelock/registry/governanceToken — not a governed deployment");
  }

  // Attach existing contracts
  const accessManager = await attachManifestContract(manifest, "accessManager", "DualVMAccessManager", admin) as any;
  const marketRegistry = await attachManifestContract(manifest, "marketRegistry", "MarketVersionRegistry", admin) as any;
  const governor = await attachManifestContract(manifest, "governor", "DualVMGovernor", admin) as any;
  const governanceToken = await attachManifestContract(manifest, "governanceToken", "GovernanceToken", admin) as any;
  const oracle = await attachManifestContract(manifest, "oracle", "ManualOracle", admin) as any;
  const wpas = await attachManifestContract(manifest, "wpas", "WPAS", admin) as any;
  const usdc = await attachManifestContract(manifest, "usdc", "USDCMock", admin) as any;
  const debtPool = await attachManifestContract(manifest, "debtPool", "DebtPool", admin) as any;
  const lendingCore = await attachManifestContract(manifest, "lendingCore", "LendingCore", admin) as any;

  const v1VersionId = await marketRegistry.activeVersionId();
  console.log(`Current active version: ${v1VersionId}`);

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
    // Wait a bit for delegation to take effect
    await sleep(3_000);
  } else if (adminVotes > 0n) {
    console.log("Already delegated, skipping.");
  } else {
    throw new Error("Admin has no governance tokens — cannot propose");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Step 2: Ensure borrower position on v1 (before activating v2)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 2: Ensure borrower position on v1 ═══");

  // Check if migration borrower already has a position
  const existingPosition = await lendingCore.positions(migrationBorrower.address);
  const existingDebt = await lendingCore.currentDebt(migrationBorrower.address);

  // Read current oracle price to calculate safe borrow amount
  const currentPrice = BigInt(await oracle.priceWad());
  console.log(`Current v1 oracle price: ${formatWad(currentPrice)}`);

  if (existingPosition.collateralAmount > 0n && existingDebt > 0n) {
    // Check if position is healthy enough to migrate
    const collateralValue = (existingPosition.collateralAmount * currentPrice) / WAD;
    const maxBorrow = (collateralValue * 7000n) / 10000n; // 70% LTV
    if (existingDebt <= maxBorrow) {
      console.log("Migration borrower has a healthy position — reusing it.");
      results.steps.v1PositionSource = "reused-existing";
    } else {
      console.log("Migration borrower has an unhealthy position — skipping reuse.");
      throw new Error("Migration borrower position is underwater; cannot migrate. Use a different address.");
    }
  } else {
    console.log("No existing position — creating new borrower position.");
    // Calculate safe borrow: 2 PAS at current price * 50% LTV (conservative)
    const collateralPas = 2n * WAD;
    const collateralValue = (collateralPas * currentPrice) / WAD;
    const borrowAmount = (collateralValue * 5000n) / 10000n; // 50% LTV — well under 70% max
    // Ensure borrow meets minimum (100 WAD)
    const safeBorrow = borrowAmount >= 100n * WAD ? borrowAmount : 100n * WAD;

    console.log(`  Collateral: 2 WPAS`);
    console.log(`  Collateral value at price ${formatWad(currentPrice)}: ${formatWad(collateralValue)}`);
    console.log(`  Borrow amount: ${formatWad(safeBorrow)}`);

    const wpasForBorrower = wpas.connect(migrationBorrower) as any;
    const lendingCoreForBorrower = lendingCore.connect(migrationBorrower) as any;
    await openBorrowPosition({
      wpas: wpasForBorrower,
      lendingCore: lendingCoreForBorrower,
      collateralPas,
      borrowAmount: safeBorrow,
      labelPrefix: "migration-borrower",
    });
    results.steps.v1PositionSource = "created-fresh";
  }

  const v1DebtBefore = await lendingCore.currentDebt(migrationBorrower.address);
  const v1PositionBefore = await lendingCore.positions(migrationBorrower.address);
  console.log(`Borrower v1 debt: ${formatWad(v1DebtBefore)}`);
  console.log(`Borrower v1 collateral: ${formatWad(v1PositionBefore.collateralAmount)}`);
  console.log(`Borrower v1 principal: ${formatWad(v1PositionBefore.principalDebt)}`);
  results.steps.v1Position = {
    debt: formatWad(v1DebtBefore),
    collateral: formatWad(v1PositionBefore.collateralAmount),
    principal: formatWad(v1PositionBefore.principalDebt),
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Step 3: Deploy v2 market version + MarketMigrationCoordinator
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 3: Deploy v2 market + migration coordinator ═══");

  // Read current on-chain oracle price (may differ from manifest if changed during smoke tests)
  const currentOraclePrice = await oracle.priceWad();
  console.log(`Current v1 oracle price: ${formatWad(currentOraclePrice)}`);

  const v2Market = await deployMarketVersion({
    deployer: admin,
    authority: manifest.contracts.accessManager,
    collateralAsset: manifest.contracts.wpas,
    debtAsset: manifest.contracts.usdc,
    autoWireLendingCore: false, // Will be wired through governance
    riskQuoteEngineAddress: manifest.contracts.quoteEngine, // Reuse same PVM quote engine
    oraclePriceWad: currentOraclePrice, // Match current v1 oracle price for consistent health checks
    oracleMaxAgeSeconds: manifest.config.oracleMaxAgeSeconds,
    oracleMinPriceWad: BigInt(manifest.config.oracle?.circuitBreaker?.minPriceWad ?? ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad),
    oracleMaxPriceWad: BigInt(manifest.config.oracle?.circuitBreaker?.maxPriceWad ?? ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad),
    oracleMaxPriceChangeBps: BigInt(manifest.config.oracle?.circuitBreaker?.maxPriceChangeBps ?? ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps),
  });

  const v2Addresses = {
    oracle: await v2Market.oracle.getAddress(),
    quoteEngine: await v2Market.quoteEngine.getAddress(),
    riskEngine: await v2Market.riskEngine.getAddress(),
    debtPool: await v2Market.debtPool.getAddress(),
    lendingCore: await v2Market.lendingCore.getAddress(),
  };
  console.log("v2 market deployed:", JSON.stringify(v2Addresses, null, 2));
  results.steps.v2Deploy = v2Addresses;

  const coordinatorFactory = await ethers.getContractFactory("MarketMigrationCoordinator", admin);
  const coordinator = await coordinatorFactory.deploy(
    manifest.contracts.accessManager,
    manifest.contracts.marketRegistry,
  );
  await coordinator.waitForDeployment();
  const coordinatorAddress = await coordinator.getAddress();
  console.log(`MarketMigrationCoordinator deployed: ${coordinatorAddress}`);
  results.steps.coordinatorDeploy = coordinatorAddress;

  // ═══════════════════════════════════════════════════════════════════════
  // Step 4: Governance Proposal — wire, register, activate v2, grant roles, open route
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 4: Create governance proposal (all-in-one) ═══");

  const nextVersionId = (await marketRegistry.latestVersionId()) + 1n;
  console.log(`Next version ID will be: ${nextVersionId}`);

  const accessManagerAddr = manifest.contracts.accessManager;
  const registryAddr = manifest.contracts.marketRegistry!;

  // Build batch of operations:
  const targets: string[] = [];
  const values: bigint[] = [];
  const calldatas: string[] = [];

  // 1. Wire v2 debtPool ← lendingCore
  targets.push(v2Addresses.debtPool);
  values.push(0n);
  calldatas.push(v2Market.debtPool.interface.encodeFunctionData("setLendingCore", [v2Addresses.lendingCore]));

  // 2. Grant ADMIN role (0) to coordinator with 0 delay — allows it to call export/import
  //    on both v1 and v2 LendingCore (since those functions default to admin role)
  targets.push(accessManagerAddr);
  values.push(0n);
  calldatas.push(accessManager.interface.encodeFunctionData("grantRole", [0, coordinatorAddress, 0]));

  // 3. Register v2 in MarketVersionRegistry
  targets.push(registryAddr);
  values.push(0n);
  calldatas.push(
    marketRegistry.interface.encodeFunctionData("registerVersion", [
      v2Addresses.lendingCore,
      v2Addresses.debtPool,
      v2Addresses.oracle,
      v2Addresses.riskEngine,
    ]),
  );

  // 4. Activate v2
  targets.push(registryAddr);
  values.push(0n);
  calldatas.push(marketRegistry.interface.encodeFunctionData("activateVersion", [nextVersionId]));

  // 5. Open migration route v1 → v2 (borrower + liquidity)
  targets.push(coordinatorAddress);
  values.push(0n);
  calldatas.push(coordinator.interface.encodeFunctionData("openMigrationRoute", [v1VersionId, nextVersionId, true, true]));

  const description = `Migration proof: wire v2, register, activate, grant coordinator admin, open route v${v1VersionId}→v${nextVersionId}`;

  console.log(`Proposal has ${targets.length} operations`);
  console.log("Submitting proposal...");

  const proposeTx = await governor.connect(admin).propose(targets, values, calldatas, description);
  const proposeReceipt = await proposeTx.wait();
  console.log(`Proposal submitted: ${proposeReceipt.hash}`);
  results.steps.proposeTx = proposeReceipt.hash;

  const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.id(description));
  console.log(`Proposal ID: ${proposalId.toString()}`);

  // Wait for voting delay (1 second on testnet)
  console.log("Waiting for voting delay...");
  await waitForProposalState(governor, proposalId, 1, "wait for Active state", 60_000);

  // Vote in favor
  console.log("Casting vote...");
  const voteTx = await governor.connect(admin).castVote(proposalId, 1);
  const voteReceipt = await voteTx.wait();
  console.log(`Vote cast: ${voteReceipt.hash}`);
  results.steps.voteTx = voteReceipt.hash;

  // Wait for voting period (300 seconds)
  console.log("Waiting for voting period to end (300s)...");
  await waitForProposalState(governor, proposalId, 4, "wait for Succeeded state", 600_000);

  // Queue
  console.log("Queueing proposal...");
  const queueTx = await governor.queue(targets, values, calldatas, ethers.id(description));
  const queueReceipt = await queueTx.wait();
  console.log(`Queued: ${queueReceipt.hash}`);
  results.steps.queueTx = queueReceipt.hash;

  // Wait for timelock delay (60 seconds) — state stays Queued(5) until we execute
  console.log("Waiting for timelock delay (70s)...");
  await sleep(70_000);

  // Execute
  console.log("Executing proposal...");
  const executeTx = await governor.execute(targets, values, calldatas, ethers.id(description));
  const executeReceipt = await executeTx.wait();
  console.log(`Executed: ${executeReceipt.hash}`);
  results.steps.executeTx = executeReceipt.hash;

  // Verify v2 is now active
  const activeVersionId = await marketRegistry.activeVersionId();
  console.log(`Active version after proposal: ${activeVersionId}`);
  if (activeVersionId !== nextVersionId) {
    throw new Error(`Expected active version ${nextVersionId}, got ${activeVersionId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Step 5: Execute migration
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 5: Execute borrower migration v1 → v2 ═══");

  const coordinatorForBorrower = coordinator.connect(migrationBorrower) as any;
  const migrateTx = await coordinatorForBorrower.migrateBorrower(v1VersionId, nextVersionId);
  const migrateReceipt = await migrateTx.wait();
  console.log(`Borrower migrated: ${migrateReceipt.hash}`);
  results.steps.migrateBorrowerTx = migrateReceipt.hash;

  // ═══════════════════════════════════════════════════════════════════════
  // Step 6: Verify migration results
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 6: Verify migration ═══");

  // v1 position should be zeroed
  const v1DebtAfter = await lendingCore.currentDebt(migrationBorrower.address);
  const v1PositionAfter = await lendingCore.positions(migrationBorrower.address);
  console.log(`v1 debt after migration: ${formatWad(v1DebtAfter)}`);
  console.log(`v1 collateral after migration: ${formatWad(v1PositionAfter.collateralAmount)}`);

  // v2 position should have the collateral and debt
  const v2LendingCore = v2Market.lendingCore.connect(admin) as any;
  const v2DebtAfter = await v2LendingCore.currentDebt(migrationBorrower.address);
  const v2PositionAfter = await v2LendingCore.positions(migrationBorrower.address);
  console.log(`v2 debt after migration: ${formatWad(v2DebtAfter)}`);
  console.log(`v2 collateral after migration: ${formatWad(v2PositionAfter.collateralAmount)}`);
  console.log(`v2 principal after migration: ${formatWad(v2PositionAfter.principalDebt)}`);

  // Verify v1 zeroed
  if (v1DebtAfter !== 0n) {
    console.warn(`WARNING: v1 debt not zero: ${formatWad(v1DebtAfter)}`);
  }
  if (v1PositionAfter.collateralAmount !== 0n) {
    console.warn(`WARNING: v1 collateral not zero: ${formatWad(v1PositionAfter.collateralAmount)}`);
  }

  // Verify v2 has position
  if (v2PositionAfter.collateralAmount === 0n) {
    throw new Error("v2 collateral is zero — migration failed");
  }

  results.steps.verification = {
    v1: {
      debtAfter: formatWad(v1DebtAfter),
      collateralAfter: formatWad(v1PositionAfter.collateralAmount),
      zeroed: v1DebtAfter === 0n && v1PositionAfter.collateralAmount === 0n,
    },
    v2: {
      debtAfter: formatWad(v2DebtAfter),
      collateralAfter: formatWad(v2PositionAfter.collateralAmount),
      principalAfter: formatWad(v2PositionAfter.principalDebt),
      preserved: v2PositionAfter.collateralAmount === v1PositionBefore.collateralAmount,
    },
    debtPreserved:
      v2DebtAfter >= v1DebtBefore && v2DebtAfter - v1DebtBefore < WAD, // small interest accrual allowed
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Step 7: Restore v1 as active version
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ Step 7: Restore v1 as active version via governance ═══");

  const restoreTargets = [registryAddr];
  const restoreValues = [0n];
  const restoreCalldatas = [marketRegistry.interface.encodeFunctionData("activateVersion", [v1VersionId])];
  const restoreDescription = `Migration proof: restore v${v1VersionId} as active version`;

  const restoreProposeTx = await governor.connect(admin).propose(restoreTargets, restoreValues, restoreCalldatas, restoreDescription);
  const restoreProposeReceipt = await restoreProposeTx.wait();
  console.log(`Restore proposal submitted: ${restoreProposeReceipt.hash}`);
  results.steps.restoreProposeTx = restoreProposeReceipt.hash;

  const restoreProposalId = await governor.hashProposal(
    restoreTargets,
    restoreValues,
    restoreCalldatas,
    ethers.id(restoreDescription),
  );

  console.log("Waiting for voting delay...");
  await waitForProposalState(governor, restoreProposalId, 1, "wait for Active state (restore)", 60_000);

  console.log("Casting vote for restore...");
  const restoreVoteTx = await governor.connect(admin).castVote(restoreProposalId, 1);
  const restoreVoteReceipt = await restoreVoteTx.wait();
  console.log(`Restore vote cast: ${restoreVoteReceipt.hash}`);
  results.steps.restoreVoteTx = restoreVoteReceipt.hash;

  console.log("Waiting for voting period to end (300s)...");
  await waitForProposalState(governor, restoreProposalId, 4, "wait for Succeeded state (restore)", 600_000);

  console.log("Queueing restore proposal...");
  const restoreQueueTx = await governor.queue(restoreTargets, restoreValues, restoreCalldatas, ethers.id(restoreDescription));
  const restoreQueueReceipt = await restoreQueueTx.wait();
  console.log(`Restore queued: ${restoreQueueReceipt.hash}`);
  results.steps.restoreQueueTx = restoreQueueReceipt.hash;

  console.log("Waiting for timelock delay (60s)...");
  await sleep(70_000);

  console.log("Executing restore proposal...");
  const restoreExecuteTx = await governor.execute(
    restoreTargets,
    restoreValues,
    restoreCalldatas,
    ethers.id(restoreDescription),
  );
  const restoreExecuteReceipt = await restoreExecuteTx.wait();
  console.log(`Restore executed: ${restoreExecuteReceipt.hash}`);
  results.steps.restoreExecuteTx = restoreExecuteReceipt.hash;

  // Verify v1 is active again
  const finalActiveVersion = await marketRegistry.activeVersionId();
  console.log(`Final active version: ${finalActiveVersion}`);
  results.steps.finalActiveVersionId = finalActiveVersion.toString();

  // ═══════════════════════════════════════════════════════════════════════
  // Step 8: Revoke coordinator admin role (cleanup)
  // ═══════════════════════════════════════════════════════════════════════
  // Note: The coordinator was granted admin role (0) for migration.
  // In a production system, this would be revoked through governance.
  // For the hackathon proof, we leave it as-is since the coordinator
  // has no independent key and can only be called by borrowers for their own positions.

  // ═══════════════════════════════════════════════════════════════════════
  // Write results file
  // ═══════════════════════════════════════════════════════════════════════
  results.completedAt = new Date().toISOString();
  results.v1VersionId = v1VersionId.toString();
  results.v2VersionId = nextVersionId.toString();
  results.v2Contracts = v2Addresses;
  results.coordinatorAddress = coordinatorAddress;
  results.borrower = migrationBorrower.address;

  results.summary = {
    v2Registered: true,
    v2Activated: true,
    migrationRouteOpened: true,
    borrowerExportedFromV1: v1DebtAfter === 0n && v1PositionAfter.collateralAmount === 0n,
    borrowerImportedToV2: v2PositionAfter.collateralAmount > 0n && v2DebtAfter > 0n,
    v1RestoredAsActive: finalActiveVersion === v1VersionId,
    debtPreserved: v2DebtAfter >= v1DebtBefore && v2DebtAfter - v1DebtBefore < WAD,
    collateralPreserved: v2PositionAfter.collateralAmount === v1PositionBefore.collateralAmount,
  };

  const outPath = path.join(__dirname, "..", "deployments", "polkadot-hub-testnet-migration-proof.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nMigration proof results written to: ${outPath}`);
  console.log(JSON.stringify(results, null, 2));
}

runEntrypoint("scripts/liveMigrationProof.ts", main);
