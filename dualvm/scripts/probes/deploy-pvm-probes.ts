import hre from "hardhat";
import {
  buildProbePvmIdentity,
  createPvmApi,
  formatPasFromWei,
  readContractCodeHash,
  readFallbackAccountBalance,
} from "../../lib/probes/pvmRuntime";
import {
  type ProbeContractDeployment,
  loadProbeDeploymentManifest,
  writeProbeDeploymentManifest,
} from "../../lib/probes/probeStore";
import { requireEnv } from "../../lib/runtime/env";
import { runEntrypoint } from "../../lib/runtime/entrypoint";

const { ethers } = hre;

async function deployPvmContract(signer: any, api: any, contractName: string, explorerBaseUrl: string) {
  const factory = await ethers.getContractFactory(contractName, signer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const deployTx = contract.deploymentTransaction();
  if (!deployTx) {
    throw new Error(`Missing deployment transaction for ${contractName}`);
  }

  const address = (await contract.getAddress()) as `0x${string}`;
  const codeHash = await readContractCodeHash(api, address);
  if (!codeHash) {
    throw new Error(
      `${contractName} deployed at ${address}, but revive.accountInfoOf returned no code hash. This is not defensible as a live PVM target.`,
    );
  }

  const deployment: ProbeContractDeployment = {
    address,
    deployTxHash: deployTx.hash as `0x${string}`,
    explorerUrl: `${explorerBaseUrl}address/${address}`,
    codeHash,
  };

  return deployment;
}

export async function main() {
  const privateKey = requireEnv("PRIVATE_KEY");
  const manifest = loadProbeDeploymentManifest();
  const api = await createPvmApi(manifest.polkadotHubTestnet.wssUrl);

  try {
    const provider = ethers.provider;
    const signer = new ethers.Wallet(privateKey, provider);
    const identity = buildProbePvmIdentity(signer.address);
    const balanceWei = await readFallbackAccountBalance(api, identity.fallbackAccountHex);
    if (balanceWei == 0n) {
      throw new Error(
        `Probe deployer ${identity.evmAddress} has 0 PAS. Fund it from ${manifest.polkadotHubTestnet.faucetUrl} before deploying PVM probes.`,
      );
    }

    manifest.operator = {
      evmAddress: identity.evmAddress,
      fallbackAccountHex: identity.fallbackAccountHex,
      paseoSs58: identity.paseoSs58,
      balanceWei: balanceWei.toString(),
      balancePas: formatPasFromWei(balanceWei),
    };

    const explorerBaseUrl = manifest.polkadotHubTestnet.explorerUrl;
    manifest.pvm.quoteProbe = await deployPvmContract(signer, api, "PvmQuoteProbe", explorerBaseUrl);
    manifest.pvm.callbackProbe = await deployPvmContract(signer, api, "PvmCallbackProbe", explorerBaseUrl);

    manifest.notes = [
      ...manifest.notes.filter((note) => !note.startsWith("PVM probes deployed by")),
      `PVM probes deployed by ${identity.evmAddress} through the Hardhat Polkadot provider and verified via revive.accountInfoOf code hashes.`,
    ];

    const outPath = writeProbeDeploymentManifest(manifest);
    console.log(
      JSON.stringify(
        {
          outPath,
          operator: manifest.operator,
          pvm: manifest.pvm,
        },
        null,
        2,
      ),
    );
  } finally {
    await api.disconnect();
  }
}

runEntrypoint("scripts/probes/deploy-pvm-probes.ts", main);
