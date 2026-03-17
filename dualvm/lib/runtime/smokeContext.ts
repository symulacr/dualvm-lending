/**
 * Shared smoke-script context factory.
 * Eliminates repeated manifest-load → actor-load → attach → managed-context boilerplate.
 */
import type { ManagedCallContext } from "../ops/managedAccess";
import type { DeploymentManifest } from "../shared/deploymentManifest";
import { loadDeploymentManifest } from "../deployment/manifestStore";
import { loadActors, type ActorName } from "./actors";
import { attachManifestContract } from "./contracts";

export interface SmokeContext<A extends readonly ActorName[]> {
  manifest: DeploymentManifest;
  actors: ReturnType<typeof loadActors<A>>;
  attach: <T = any>(
    contractKey: keyof DeploymentManifest["contracts"],
    contractName: string,
    signer: any,
  ) => Promise<T>;
}

/**
 * Creates a shared smoke script context with manifest, actors, helpers.
 */
export async function createSmokeContext<const A extends readonly ActorName[]>(
  actorNames: A,
): Promise<SmokeContext<A>> {
  const manifest = loadDeploymentManifest();
  const actors = loadActors(actorNames);

  async function attach<T = any>(
    contractKey: keyof DeploymentManifest["contracts"],
    contractName: string,
    signer: any,
  ): Promise<T> {
    return attachManifestContract<T>(manifest, contractKey, contractName, signer);
  }

  return { manifest, actors, attach };
}

/**
 * Builds a ManagedCallContext from the manifest and an attached AccessManager.
 */
export function buildManagedContext(
  manifest: DeploymentManifest,
  accessManager: any,
  signer: any,
  role: "minter" | "riskAdmin" | "treasury" | "emergency",
): ManagedCallContext {
  return {
    accessManager,
    signer,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.[role] ?? 0,
  };
}
