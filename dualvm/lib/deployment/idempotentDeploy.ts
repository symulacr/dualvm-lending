/**
 * idempotentDeploy.ts
 *
 * Core logic for idempotent deployment:
 *  - Classifies each step as "skip" (already deployed with live code) or "deploy"
 *  - Supports checkpoint-after-each-step so interrupted runs can resume
 *  - Pure functions accept injected dependencies for testability
 */

export interface IdempotentDeployStep {
  /** Key matching the manifest's contracts record */
  key: string;
  /** Human-readable label for log output */
  label: string;
  /** Deploys the contract and returns its checksummed address */
  deploy: () => Promise<string>;
  /** Optional: Hardhat artifact name. Reserved for future bytecode-hash comparison. */
  artifactName?: string;
}

export interface StepClassification {
  step: IdempotentDeployStep;
  /** Address from manifest, if present */
  existingAddress: string | undefined;
  /** True when the address has non-zero on-chain code — step should be skipped */
  shouldSkip: boolean;
  /** Human-readable reason for skipping (only set when shouldSkip=true) */
  skipReason?: string;
}

export interface ClassifyOptions {
  /** Current manifest contracts map (key → address, possibly undefined) */
  manifestContracts: Record<string, string | undefined>;
  /** Returns the deployed bytecode for an address; returns "0x" if nothing deployed */
  getCode: (address: string) => Promise<string>;
}

export interface RunOptions extends ClassifyOptions {
  /** Called immediately after each successful deployment; used as the checkpoint */
  onDeployed: (key: string, address: string) => Promise<void>;
  /** Optional logger; defaults to console.log */
  log?: (message: string) => void;
}

/**
 * Classifies each step as "skip" or "deploy".
 *
 * A step is skipped when:
 *  1. Its key exists in manifestContracts with a non-empty address, AND
 *  2. getCode(address) returns a non-zero bytecode string
 *
 * Returns classifications in the same order as `steps`.
 */
export async function classifySteps(
  steps: IdempotentDeployStep[],
  opts: ClassifyOptions,
): Promise<StepClassification[]> {
  const results: StepClassification[] = [];

  for (const step of steps) {
    const existingAddress = opts.manifestContracts[step.key];

    if (existingAddress) {
      let code: string;
      try {
        code = await opts.getCode(existingAddress);
      } catch {
        // If provider call fails, treat as not-deployed
        code = "0x";
      }

      if (code && code !== "0x") {
        results.push({
          step,
          existingAddress,
          shouldSkip: true,
          skipReason: `already deployed at ${existingAddress} (bytecode prefix: ${code.slice(0, 10)}…)`,
        });
      } else {
        // Address recorded but no code — needs (re)deploy
        results.push({
          step,
          existingAddress,
          shouldSkip: false,
        });
      }
    } else {
      // Not in manifest at all
      results.push({
        step,
        existingAddress: undefined,
        shouldSkip: false,
      });
    }
  }

  return results;
}

/**
 * Runs idempotent deployment for the given steps.
 *
 * For each step:
 *  - If already deployed (non-zero code at manifest address), logs SKIP and continues.
 *  - Otherwise, calls step.deploy(), records the address, and calls opts.onDeployed
 *    as a checkpoint so the caller can persist the address before continuing.
 *
 * Returns a map of key → final address for ALL steps (skipped and newly deployed).
 */
export async function runIdempotentSteps(
  steps: IdempotentDeployStep[],
  opts: RunOptions,
): Promise<Record<string, string>> {
  const { log = console.log } = opts;
  const result: Record<string, string> = {};

  const classifications = await classifySteps(steps, opts);

  for (const { step, existingAddress, shouldSkip, skipReason } of classifications) {
    if (shouldSkip && existingAddress) {
      log(`[SKIP]   ${step.label} — ${skipReason}`);
      result[step.key] = existingAddress;
      continue;
    }

    log(`[DEPLOY] ${step.label}…`);
    const address = await step.deploy();
    result[step.key] = address;
    log(`[DONE]   ${step.label} → ${address}`);

    // Checkpoint: persist the address before proceeding to the next step.
    // If the process is interrupted after this call, a re-run will detect
    // the non-zero code at this address and skip it.
    await opts.onDeployed(step.key, address);
  }

  return result;
}
