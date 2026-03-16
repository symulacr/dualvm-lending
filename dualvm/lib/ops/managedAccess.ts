import type { Signer } from "ethers";
import { waitForCondition, waitForTransaction, type SubmittedTransaction } from "../runtime/transactions";

interface AccessManagerContract {
  getAddress(): Promise<string>;
  interface: {
    encodeFunctionData(fragment: string, args: readonly unknown[]): string;
  };
  hashOperation(caller: string, target: string, data: string): Promise<bigint | number | string>;
  getSchedule(operationId: string): Promise<bigint | number | string>;
  runner?: {
    provider?: {
      getBlock(tag: string): Promise<{ timestamp: number }>;
    };
  };
  connect(signer: Signer): {
    schedule(target: string, data: string, when: number): Promise<SubmittedTransaction>;
    execute(target: string, data: string): Promise<SubmittedTransaction>;
  };
}

interface ContractInterfaceLike {
  getAddress(): Promise<string>;
  interface: {
    encodeFunctionData(functionName: string, args: readonly unknown[]): string;
  };
  connect(signer: Signer): Record<string, (...args: unknown[]) => Promise<SubmittedTransaction>>;
}

export interface ManagedCallContext {
  accessManager: AccessManagerContract;
  signer: Signer;
  executionDelaySeconds: number;
}

function isAlreadyScheduledError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("already scheduled") || normalized.includes("operation already scheduled");
}

async function sendManagerCall(
  accessManager: AccessManagerContract,
  signer: Signer,
  fragment: "schedule" | "execute",
  args: readonly unknown[],
  label: string,
) {
  const manager = accessManager.connect(signer);
  if (fragment === "schedule") {
    return waitForTransaction(manager.schedule(args[0] as string, args[1] as string, args[2] as number), label);
  }
  return waitForTransaction(manager.execute(args[0] as string, args[1] as string), label);
}

async function waitUntilOperationReady(
  accessManager: AccessManagerContract,
  signer: Signer,
  target: string,
  data: string,
) {
  const caller = await signer.getAddress();
  const operationId = String(await accessManager.hashOperation(caller, target, data));
  const scheduledFor = BigInt(await accessManager.getSchedule(operationId));
  if (scheduledFor === 0n) {
    throw new Error(`No scheduled operation found for ${operationId}`);
  }

  const provider = accessManager.runner?.provider;
  if (!provider) {
    throw new Error("AccessManager runner provider is unavailable");
  }

  await waitForCondition(
    `wait for scheduled operation ${operationId}`,
    async () => {
      const nextBlock = await provider.getBlock("latest");
      return BigInt(nextBlock.timestamp) >= scheduledFor;
    },
    { intervalMs: 1_000, timeoutMs: 120_000 },
  );
}

async function executeContractMethod(
  contract: ContractInterfaceLike,
  signer: Signer,
  functionName: string,
  args: readonly unknown[],
  label: string,
) {
  const connected = contract.connect(signer);
  const method = connected[functionName];
  if (typeof method !== "function") {
    throw new Error(`Managed contract method '${functionName}' is unavailable`);
  }
  return waitForTransaction(method(...args), label);
}

async function executeManagedMethod(
  context: ManagedCallContext,
  contract: ContractInterfaceLike,
  functionName: string,
  args: readonly unknown[],
  label: string,
) {
  if (context.executionDelaySeconds <= 0) {
    return executeContractMethod(contract, context.signer, functionName, args, label);
  }

  const target = await contract.getAddress();
  const data = contract.interface.encodeFunctionData(functionName, [...args]);

  try {
    await sendManagerCall(context.accessManager, context.signer, "schedule", [target, data, 0], `${label} schedule`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isAlreadyScheduledError(message)) {
      throw error;
    }
    console.log(`${label} schedule skipped: ${message}`);
  }

  await waitUntilOperationReady(context.accessManager, context.signer, target, data);
  return sendManagerCall(context.accessManager, context.signer, "execute", [target, data], `${label} execute`);
}

export async function managedMintUsdc(
  context: ManagedCallContext,
  usdc: ContractInterfaceLike,
  recipient: string,
  amount: bigint,
  label: string,
) {
  return executeManagedMethod(context, usdc, "mint", [recipient, amount], label);
}

export async function managedSetOraclePrice(
  context: ManagedCallContext,
  oracle: ContractInterfaceLike,
  newPriceWad: bigint,
  label: string,
) {
  return executeManagedMethod(context, oracle, "setPrice", [newPriceWad], label);
}

export async function managedSetOracleCircuitBreaker(
  context: ManagedCallContext,
  oracle: ContractInterfaceLike,
  minPriceWad: bigint,
  maxPriceWad: bigint,
  maxPriceChangeBps: bigint,
  label: string,
) {
  return executeManagedMethod(
    context,
    oracle,
    "setCircuitBreaker",
    [minPriceWad, maxPriceWad, maxPriceChangeBps],
    label,
  );
}

export async function managedRegisterVersion(
  context: ManagedCallContext,
  registry: ContractInterfaceLike,
  lendingCoreAddress: string,
  debtPoolAddress: string,
  oracleAddress: string,
  riskEngineAddress: string,
  label: string,
 ) {
  return executeManagedMethod(
    context,
    registry,
    "registerVersion",
    [lendingCoreAddress, debtPoolAddress, oracleAddress, riskEngineAddress],
    label,
  );
}

export async function managedActivateVersion(
  context: ManagedCallContext,
  registry: ContractInterfaceLike,
  versionId: bigint | number,
  label: string,
 ) {
  return executeManagedMethod(context, registry, "activateVersion", [versionId], label);
}
