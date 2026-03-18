import hre from "hardhat";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildProbePvmIdentity,
  createPvmApi,
  formatPasFromWei,
  readContractCodeHash,
  readFallbackAccountBalance,
} from "../lib/probes/pvmRuntime";
import {
  loadProbeDeploymentManifest,
  writeProbeDeploymentManifest,
  type ProbeContractDeployment,
} from "../lib/probes/probeStore";
import { requireEnv } from "../lib/runtime/env";
import { runEntrypoint } from "../lib/runtime/entrypoint";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";

const { ethers } = hre;

const STANDARD_QUOTE_INPUTS = {
  utilizationBps: 5000,
  collateralRatioBps: 15000,
  oracleAgeSeconds: 0,
  oracleFresh: true,
};

const EXPECTED_QUOTE_OUTPUT = {
  borrowRateBps: 700n,
  maxLtvBps: 7500n,
  liquidationThresholdBps: 8500n,
};

async function callQuote(
  contractAddress: string,
  abi: readonly unknown[],
  provider: any,
): Promise<{ borrowRateBps: bigint; maxLtvBps: bigint; liquidationThresholdBps: bigint }> {
  const contract = new ethers.Contract(contractAddress, abi as any, provider);
  const result = await contract.quote([
    STANDARD_QUOTE_INPUTS.utilizationBps,
    STANDARD_QUOTE_INPUTS.collateralRatioBps,
    STANDARD_QUOTE_INPUTS.oracleAgeSeconds,
    STANDARD_QUOTE_INPUTS.oracleFresh,
  ]);
  return {
    borrowRateBps: BigInt(result[0]),
    maxLtvBps: BigInt(result[1]),
    liquidationThresholdBps: BigInt(result[2]),
  };
}

export async function main() {
  const privateKey = requireEnv("PRIVATE_KEY");
  const probeManifest = loadProbeDeploymentManifest();
  const canonicalManifest = loadDeploymentManifest();

  // Load pre-built PVM artifact for DeterministicRiskModel
  const artifactPath = path.join(process.cwd(), "pvm-artifacts", "DeterministicRiskModel.json");
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { abi: readonly unknown[]; bytecode: string };

  if (!artifact.bytecode || !artifact.abi) {
    throw new Error(`Invalid PVM artifact at ${artifactPath}. Run 'npm run build:pvm' first.`);
  }

  const api = await createPvmApi(probeManifest.polkadotHubTestnet.wssUrl);

  try {
    const provider = ethers.provider;
    const signer = new ethers.Wallet(privateKey, provider);
    const identity = buildProbePvmIdentity(signer.address);
    const balanceWei = await readFallbackAccountBalance(api, identity.fallbackAccountHex);

    console.log(
      JSON.stringify(
        {
          deployer: identity.evmAddress,
          balancePas: formatPasFromWei(balanceWei),
        },
        null,
        2,
      ),
    );

    if (balanceWei === 0n) {
      throw new Error(
        `Deployer ${identity.evmAddress} has 0 PAS. Fund it from ${probeManifest.polkadotHubTestnet.faucetUrl}`,
      );
    }

    // Get constructor args from canonical manifest riskEngine config
    const rc = canonicalManifest.config.riskEngine;
    const constructorArgs = [
      BigInt(rc.baseRateBps),
      BigInt(rc.slope1Bps),
      BigInt(rc.slope2Bps),
      BigInt(rc.kinkBps),
      BigInt(rc.healthyMaxLtvBps),
      BigInt(rc.stressedMaxLtvBps),
      BigInt(rc.healthyLiquidationThresholdBps),
      BigInt(rc.stressedLiquidationThresholdBps),
      BigInt(rc.staleBorrowRatePenaltyBps),
      BigInt(rc.stressedCollateralRatioBps),
    ];

    console.log(
      JSON.stringify(
        {
          step: "Deploying DeterministicRiskModel to PVM",
          constructorArgs: constructorArgs.map(String),
        },
        null,
        2,
      ),
    );

    // Deploy using pre-built PVM bytecode and ABI directly
    const factory = new ethers.ContractFactory(artifact.abi as any, artifact.bytecode, signer);
    const contract = await factory.deploy(...constructorArgs);
    await contract.waitForDeployment();

    const deployTx = contract.deploymentTransaction();
    if (!deployTx) {
      throw new Error("Missing deployment transaction for DeterministicRiskModel");
    }

    const pvmAddress = (await contract.getAddress()) as `0x${string}`;
    const explorerBaseUrl = probeManifest.polkadotHubTestnet.explorerUrl;

    // Verify via revive.accountInfoOf (confirms PVM code hash)
    const codeHash = await readContractCodeHash(api, pvmAddress);
    if (!codeHash) {
      throw new Error(
        `DeterministicRiskModel deployed at ${pvmAddress} but revive.accountInfoOf returned no code hash.`,
      );
    }

    const deployment: ProbeContractDeployment = {
      address: pvmAddress,
      deployTxHash: deployTx.hash as `0x${string}`,
      explorerUrl: `${explorerBaseUrl}address/${pvmAddress}`,
      codeHash,
    };

    console.log(
      JSON.stringify(
        {
          step: "PVM deployment confirmed",
          deployment,
        },
        null,
        2,
      ),
    );

    // ---- Quote comparison: PVM vs EVM ----
    const evmRiskEngineAddress = canonicalManifest.contracts.riskEngine;
    const evmProvider = new ethers.JsonRpcProvider(
      probeManifest.polkadotHubTestnet.rpcUrl ?? canonicalManifest.polkadotHubTestnet.rpcUrl,
    );

    console.log(
      JSON.stringify(
        {
          step: "Comparing quote() outputs",
          inputs: STANDARD_QUOTE_INPUTS,
        },
        null,
        2,
      ),
    );

    const pvmQuote = await callQuote(pvmAddress, artifact.abi, evmProvider);
    const evmQuote = await callQuote(evmRiskEngineAddress, artifact.abi, evmProvider);

    const quotesMatch =
      pvmQuote.borrowRateBps === evmQuote.borrowRateBps &&
      pvmQuote.maxLtvBps === evmQuote.maxLtvBps &&
      pvmQuote.liquidationThresholdBps === evmQuote.liquidationThresholdBps;

    const pvmMatchesExpected =
      pvmQuote.borrowRateBps === EXPECTED_QUOTE_OUTPUT.borrowRateBps &&
      pvmQuote.maxLtvBps === EXPECTED_QUOTE_OUTPUT.maxLtvBps &&
      pvmQuote.liquidationThresholdBps === EXPECTED_QUOTE_OUTPUT.liquidationThresholdBps;

    console.log(
      JSON.stringify(
        {
          step: "Quote comparison result",
          pvmQuote: {
            borrowRateBps: pvmQuote.borrowRateBps.toString(),
            maxLtvBps: pvmQuote.maxLtvBps.toString(),
            liquidationThresholdBps: pvmQuote.liquidationThresholdBps.toString(),
          },
          evmQuote: {
            borrowRateBps: evmQuote.borrowRateBps.toString(),
            maxLtvBps: evmQuote.maxLtvBps.toString(),
            liquidationThresholdBps: evmQuote.liquidationThresholdBps.toString(),
          },
          quotesMatch,
          pvmMatchesExpected,
        },
        null,
        2,
      ),
    );

    if (!quotesMatch) {
      throw new Error(
        `Quote mismatch: PVM returned ${JSON.stringify(pvmQuote)} but EVM returned ${JSON.stringify(evmQuote)}`,
      );
    }

    if (!pvmMatchesExpected) {
      throw new Error(
        `PVM quote does not match expected values: got ${JSON.stringify(pvmQuote)}, expected ${JSON.stringify(EXPECTED_QUOTE_OUTPUT)}`,
      );
    }

    // ---- Update probes manifest ----
    probeManifest.pvm.deterministicRiskModel = deployment;

    const existingNote = `DeterministicRiskModel (PVM) deployed by ${identity.evmAddress}`;
    probeManifest.notes = [
      ...probeManifest.notes.filter((note) => !note.startsWith("DeterministicRiskModel")),
      `${existingNote} at ${pvmAddress}. quote() verified identical to EVM riskEngine ${evmRiskEngineAddress}.`,
    ];

    if (probeManifest.operator) {
      probeManifest.operator.balanceWei = balanceWei.toString();
      probeManifest.operator.balancePas = formatPasFromWei(balanceWei);
    }

    const outPath = writeProbeDeploymentManifest(probeManifest);

    console.log(
      JSON.stringify(
        {
          outPath,
          pvmDeterministicRiskModel: deployment,
          quoteVerification: "PASSED: PVM == EVM for standard inputs",
        },
        null,
        2,
      ),
    );
  } finally {
    await api.disconnect();
  }
}

runEntrypoint("scripts/deployDeterministicRiskModelPvm.ts", main);
