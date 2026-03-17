import hre from "hardhat";
import { requireEnv } from "../runtime/env";

const { ethers } = hre;

/** Standard quote input used across all probe stages. */
export const PROBE_QUOTE_INPUT = {
  utilizationBps: 5_000n,
  collateralRatioBps: 20_000n,
  oracleAgeSeconds: 60n,
  oracleFresh: true,
} as const;

/** Build a Blockscout transaction URL from base explorer URL and tx hash. */
export function txUrl(baseUrl: string, hash: string) {
  return `${baseUrl}tx/${hash}`;
}

/** Create a signer from PRIVATE_KEY env var with balance check. */
export async function createProbeSigner(faucetUrl: string) {
  const privateKey = requireEnv("PRIVATE_KEY");
  const signer = new ethers.Wallet(privateKey, ethers.provider);
  const balance = await ethers.provider.getBalance(signer.address);
  if (balance === 0n) {
    throw new Error(`Probe deployer ${signer.address} has 0 PAS. Fund it from ${faucetUrl} before running probes.`);
  }
  return { signer, balance };
}
