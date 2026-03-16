import hre from "hardhat";
import { requireEnv } from "./env";

const { ethers } = hre;

export const ACTOR_ENV_VARS = {
  deployer: "PRIVATE_KEY",
  admin: "ADMIN_PRIVATE_KEY",
  emergency: "EMERGENCY_PRIVATE_KEY",
  riskAdmin: "RISK_PRIVATE_KEY",
  treasury: "TREASURY_PRIVATE_KEY",
  minter: "MINTER_PRIVATE_KEY",
  lender: "LENDER_PRIVATE_KEY",
  borrower: "BORROWER_PRIVATE_KEY",
  liquidator: "LIQUIDATOR_PRIVATE_KEY",
  recipient: "RECIPIENT_PRIVATE_KEY",
} as const;

export type ActorName = keyof typeof ACTOR_ENV_VARS;

type RuntimeWallet = ReturnType<typeof buildRuntimeWallet>;
type ActorMap<T extends readonly ActorName[]> = { [K in T[number]]: RuntimeWallet };

function buildRuntimeWallet(envName: string) {
  return new ethers.Wallet(requireEnv(envName), ethers.provider);
}

export function loadActors<const T extends readonly ActorName[]>(names: T): ActorMap<T> {
  const entries = names.map((name) => [name, buildRuntimeWallet(ACTOR_ENV_VARS[name])]);
  return Object.fromEntries(entries) as ActorMap<T>;
}
