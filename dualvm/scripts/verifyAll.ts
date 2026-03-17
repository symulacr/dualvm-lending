import hre from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadDeploymentManifest, getDeploymentManifestPath } from "../lib/deployment/manifestStore";
import { POLKADOT_HUB_TESTNET } from "../lib/config/marketConfig";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

interface VerifyResult {
  name: string;
  address: string;
  status: "verified" | "already-verified" | "failed";
  error?: string;
  blockscoutUrl?: string;
}

async function verify(name: string, address: string, constructorArguments: unknown[], contract?: string): Promise<VerifyResult> {
  const blockscoutUrl = `${POLKADOT_HUB_TESTNET.explorerUrl}address/${address}`;
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
      ...(contract ? { contract } : {}),
    });
    return { name, address, status: "verified" as const, blockscoutUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Already Verified") ||
      message.includes("already verified") ||
      message.includes("already been verified")
    ) {
      return { name, address, status: "already-verified" as const, blockscoutUrl };
    }
    return { name, address, status: "failed" as const, error: message, blockscoutUrl };
  }
}

function loadCanonicalResults(cwd = process.cwd()): Record<string, unknown> | null {
  const manifestDir = path.dirname(getDeploymentManifestPath(cwd));
  const resultsPath = path.join(manifestDir, "polkadot-hub-testnet-canonical-results.json");
  try {
    return JSON.parse(readFileSync(resultsPath, "utf8"));
  } catch {
    return null;
  }
}

export async function main() {
  const manifest = loadDeploymentManifest();
  const authority = manifest.governance?.admin ?? manifest.roles.riskAdmin;
  const oracleConfig = manifest.config.oracle?.circuitBreaker;
  if (!oracleConfig) {
    throw new Error("Manifest is missing oracle circuit-breaker configuration");
  }

  // Load canonical results for governance constructor args
  const canonicalResults = loadCanonicalResults();

  const results: VerifyResult[] = [];

  // ── Core protocol contracts ──
  results.push(
    await verify(
      "DualVMAccessManager",
      manifest.contracts.accessManager,
      [authority],
      "contracts/DualVMAccessManager.sol:DualVMAccessManager",
    ),
  );
  results.push(await verify("WPAS", manifest.contracts.wpas, []));
  results.push(await verify("USDCMock", manifest.contracts.usdc, [manifest.contracts.accessManager]));
  results.push(
    await verify("ManualOracle", manifest.contracts.oracle, [
      manifest.contracts.accessManager,
      BigInt(manifest.config.oraclePriceWad),
      manifest.config.oracleMaxAgeSeconds,
      BigInt(oracleConfig.minPriceWad),
      BigInt(oracleConfig.maxPriceWad),
      BigInt(oracleConfig.maxPriceChangeBps),
    ]),
  );

  const riskAdapter = (await hre.ethers.getContractFactory("RiskAdapter")).attach(manifest.contracts.riskEngine) as any;
  const quoteEngineAddress = manifest.contracts.quoteEngine ?? (await riskAdapter.quoteEngine());
  // PvmRiskEngine is compiled via resolc (PolkaVM compiler) — Blockscout standard Solidity verification
  // cannot verify PVM bytecode. This is an expected limitation, not a deployment problem.
  // The PVM code hash can be confirmed via `revive.accountInfoOf` on the substrate API.
  results.push(
    await verify("PvmRiskEngine", quoteEngineAddress, [
      BigInt(manifest.config.riskEngine.baseRateBps),
      BigInt(manifest.config.riskEngine.slope1Bps),
      BigInt(manifest.config.riskEngine.slope2Bps),
      BigInt(manifest.config.riskEngine.kinkBps),
      BigInt(manifest.config.riskEngine.healthyMaxLtvBps),
      BigInt(manifest.config.riskEngine.stressedMaxLtvBps),
      BigInt(manifest.config.riskEngine.healthyLiquidationThresholdBps),
      BigInt(manifest.config.riskEngine.stressedLiquidationThresholdBps),
      BigInt(manifest.config.riskEngine.staleBorrowRatePenaltyBps),
      BigInt(manifest.config.riskEngine.stressedCollateralRatioBps),
    ]),
  );
  results.push(await verify("RiskAdapter", manifest.contracts.riskEngine, [quoteEngineAddress]));
  results.push(
    await verify("DebtPool", manifest.contracts.debtPool, [
      manifest.contracts.usdc,
      manifest.contracts.accessManager,
      BigInt(manifest.config.pool.supplyCap),
    ]),
  );
  results.push(
    await verify("LendingCore", manifest.contracts.lendingCore, [
      manifest.contracts.accessManager,
      manifest.contracts.wpas,
      manifest.contracts.usdc,
      manifest.contracts.debtPool,
      manifest.contracts.oracle,
      manifest.contracts.riskEngine,
      {
        borrowCap: BigInt(manifest.config.core.borrowCap),
        minBorrowAmount: BigInt(manifest.config.core.minBorrowAmount),
        reserveFactorBps: BigInt(manifest.config.core.reserveFactorBps),
        maxLtvBps: BigInt(manifest.config.core.maxLtvBps),
        liquidationThresholdBps: BigInt(manifest.config.core.liquidationThresholdBps),
        liquidationBonusBps: BigInt(manifest.config.core.liquidationBonusBps),
      },
    ]),
  );
  if (manifest.contracts.marketRegistry) {
    results.push(await verify("MarketVersionRegistry", manifest.contracts.marketRegistry, [manifest.contracts.accessManager]));
  }

  // ── Governance contracts ──
  if (manifest.contracts.governanceToken) {
    // GovernanceToken(authority, initialHolder, initialSupply)
    // initialHolder = deployer (from canonical results)
    const govRoot = canonicalResults?.governanceRoot as Record<string, unknown> | undefined;
    const deployer = (canonicalResults?.deployer as string) ?? "";
    const totalSupply = (govRoot?.governanceToken as Record<string, unknown>)?.totalSupply as string | undefined;
    if (deployer && totalSupply) {
      results.push(
        await verify(
          "GovernanceToken",
          manifest.contracts.governanceToken,
          [manifest.contracts.accessManager, deployer, BigInt(totalSupply)],
          "contracts/governance/GovernanceToken.sol:GovernanceToken",
        ),
      );
    } else {
      console.warn("Skipping GovernanceToken verification: missing deployer or totalSupply in canonical results");
    }
  }

  if (manifest.contracts.governanceTimelock) {
    // TimelockController(minDelay, proposers[], executors[], admin)
    // At deploy time: proposers=[], executors=[ZeroAddress], admin=deployer
    const govRoot = canonicalResults?.governanceRoot as Record<string, unknown> | undefined;
    const timelockMeta = govRoot?.timelock as Record<string, unknown> | undefined;
    const deployer = (canonicalResults?.deployer as string) ?? "";
    const minDelay = timelockMeta?.minDelaySeconds as number | undefined;
    if (deployer && minDelay !== undefined) {
      results.push(
        await verify(
          "TimelockController",
          manifest.contracts.governanceTimelock,
          [minDelay, [], [ethers.ZeroAddress], deployer],
          "@openzeppelin/contracts/governance/TimelockController.sol:TimelockController",
        ),
      );
    } else {
      console.warn("Skipping TimelockController verification: missing deployer or minDelay in canonical results");
    }
  }

  if (manifest.contracts.governor) {
    // DualVMGovernor(token, timelock, votingDelay, votingPeriod, quorumNumerator)
    const govRoot = canonicalResults?.governanceRoot as Record<string, unknown> | undefined;
    const govMeta = govRoot?.governor as Record<string, unknown> | undefined;
    const votingDelay = govMeta?.votingDelaySeconds as number | undefined;
    const votingPeriod = govMeta?.votingPeriodSeconds as number | undefined;
    const quorumNumerator = govMeta?.quorumNumerator as number | undefined;
    if (
      manifest.contracts.governanceToken &&
      manifest.contracts.governanceTimelock &&
      votingDelay !== undefined &&
      votingPeriod !== undefined &&
      quorumNumerator !== undefined
    ) {
      results.push(
        await verify(
          "DualVMGovernor",
          manifest.contracts.governor,
          [
            manifest.contracts.governanceToken,
            manifest.contracts.governanceTimelock,
            votingDelay,
            votingPeriod,
            quorumNumerator,
          ],
          "contracts/governance/DualVMGovernor.sol:DualVMGovernor",
        ),
      );
    } else {
      console.warn("Skipping DualVMGovernor verification: missing governance metadata in canonical results");
    }
  }

  // ── Write verification artifact ──
  const failedCount = results.filter((r) => r.status === "failed").length;
  const pvmOnlyFailures = results.filter((r) => r.status === "failed" && r.name === "PvmRiskEngine").length;
  const artifact = {
    generatedAt: new Date().toISOString(),
    network: POLKADOT_HUB_TESTNET,
    manifestPath: "deployments/polkadot-hub-testnet-canonical.json",
    results,
    summary: {
      total: results.length,
      verified: results.filter((r) => r.status === "verified").length,
      alreadyVerified: results.filter((r) => r.status === "already-verified").length,
      failed: failedCount,
    },
    notes:
      failedCount === pvmOnlyFailures && pvmOnlyFailures > 0
        ? [
            "PvmRiskEngine is compiled via resolc (PolkaVM compiler). Blockscout standard Solidity verification " +
              "cannot verify PVM bytecode — this is an expected limitation. The PVM code hash can be confirmed " +
              "via `revive.accountInfoOf` on the substrate API. All EVM-compiled contracts are fully verified.",
          ]
        : [],
  };

  const manifestDir = path.dirname(getDeploymentManifestPath());
  const artifactPath = path.join(manifestDir, "polkadot-hub-testnet-canonical-verification.json");
  writeFileSync(
    artifactPath,
    JSON.stringify(artifact, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2),
  );
  console.log(`Verification artifact written to ${artifactPath}`);

  console.log(
    JSON.stringify(
      artifact,
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
}

runEntrypoint("scripts/verifyAll.ts", main);
