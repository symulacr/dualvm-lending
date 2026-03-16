import hre from "hardhat";
import type { DeploymentManifest } from "../shared/deploymentManifest";

const { ethers } = hre;

type ManifestContractKey = keyof DeploymentManifest["contracts"];

export async function attachContract<T = any>(contractName: string, signer: any, address: string): Promise<T> {
  return (await ethers.getContractFactory(contractName, signer)).attach(address) as T;
}

export async function attachManifestContract<T = any>(
  manifest: DeploymentManifest,
  contractKey: ManifestContractKey,
  contractName: string,
  signer: any,
): Promise<T> {
  const address = manifest.contracts[contractKey];
  if (!address) {
    throw new Error(`Manifest contract '${String(contractKey)}' is missing`);
  }
  return attachContract<T>(contractName, signer, address);
}
