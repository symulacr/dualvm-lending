import hre from "hardhat";
import { type ProbeTransportMode, loadProbeDeploymentManifest, writeProbeDeploymentManifest } from "../../lib/probes/probeStore";
import { requireEnv } from "../../lib/runtime/env";
import { runEntrypoint } from "../../lib/runtime/entrypoint";

const { ethers } = hre;

const DIRECT_SYNC_MODE = 1;

async function deployContract(name: string, signer: any, args: unknown[] = []) {
  const factory = await ethers.getContractFactory(name, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const deployTx = contract.deploymentTransaction();
  if (!deployTx) {
    throw new Error(`Missing deployment transaction for ${name}`);
  }
  return {
    contract,
    deployTxHash: deployTx.hash as `0x${string}`,
  };
}

export async function main() {
  const privateKey = requireEnv("PRIVATE_KEY");
  const manifest = loadProbeDeploymentManifest();
  if (!manifest.pvm.quoteProbe?.address || !manifest.pvm.quoteProbe.codeHash) {
    throw new Error("PVM quote probe must be deployed before REVM probes");
  }

  const provider = ethers.provider;
  const deployer = new ethers.Wallet(privateKey, provider);
  const balanceWei = await provider.getBalance(deployer.address);
  if (balanceWei === 0n) {
    throw new Error(
      `Probe deployer ${deployer.address} has 0 PAS. Fund it from ${manifest.polkadotHubTestnet.faucetUrl} before deploying REVM probes.`,
    );
  }

  const callbackReceiver = await deployContract("RevmCallbackReceiver", deployer);
  const quoteCaller = await deployContract("RevmQuoteCallerProbe", deployer, [
    manifest.pvm.quoteProbe.address,
    manifest.pvm.quoteProbe.codeHash,
    DIRECT_SYNC_MODE,
  ]);
  const roundTripSettlement = await deployContract("RevmRoundTripSettlementProbe", deployer, [
    await quoteCaller.contract.getAddress(),
  ]);

  const explorerBaseUrl = manifest.polkadotHubTestnet.explorerUrl;
  manifest.revm.callbackReceiver = {
    address: (await callbackReceiver.contract.getAddress()) as `0x${string}`,
    deployTxHash: callbackReceiver.deployTxHash,
    explorerUrl: `${explorerBaseUrl}address/${await callbackReceiver.contract.getAddress()}`,
  };
  manifest.revm.quoteCaller = {
    address: (await quoteCaller.contract.getAddress()) as `0x${string}`,
    deployTxHash: quoteCaller.deployTxHash,
    explorerUrl: `${explorerBaseUrl}address/${await quoteCaller.contract.getAddress()}`,
    pvmTargetId: manifest.pvm.quoteProbe.codeHash,
    transportMode: "DirectSync" satisfies ProbeTransportMode,
  };
  manifest.revm.roundTripSettlement = {
    address: (await roundTripSettlement.contract.getAddress()) as `0x${string}`,
    deployTxHash: roundTripSettlement.deployTxHash,
    explorerUrl: `${explorerBaseUrl}address/${await roundTripSettlement.contract.getAddress()}`,
    pvmTargetId: manifest.pvm.quoteProbe.codeHash,
    transportMode: "DirectSync" satisfies ProbeTransportMode,
  };

  if (manifest.operator) {
    manifest.operator.balanceWei = balanceWei.toString();
    manifest.operator.balancePas = ethers.formatEther(balanceWei);
  }

  const outPath = writeProbeDeploymentManifest(manifest);
  console.log(
    JSON.stringify(
      {
        outPath,
        operator: manifest.operator,
        revm: manifest.revm,
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/probes/deploy-revm-probes.ts", main);
