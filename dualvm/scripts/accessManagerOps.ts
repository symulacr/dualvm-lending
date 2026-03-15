import type { Signer } from "ethers";

async function waitForTx(txPromise: Promise<any>, label: string) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${receipt?.hash ?? tx.hash}`);
  return receipt;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendManagerCall(accessManager: any, signer: Signer, fragment: string, args: readonly unknown[], label: string) {
  const to = await accessManager.getAddress();
  const data = accessManager.interface.encodeFunctionData(fragment, [...args]);
  return waitForTx(signer.sendTransaction({ to, data }), label);
}

async function waitUntilOperationReady(accessManager: any, signer: Signer, target: string, data: string) {
  const caller = await signer.getAddress();
  const operationId = await accessManager.hashOperation(caller, target, data);
  const scheduledFor = BigInt(await accessManager.getSchedule(operationId));
  if (scheduledFor === 0n) {
    throw new Error(`No scheduled operation found for ${operationId}`);
  }

  const latestBlock = await accessManager.runner.provider.getBlock("latest");
  const latestTimestamp = BigInt(latestBlock.timestamp);
  const waitSeconds = scheduledFor > latestTimestamp ? scheduledFor - latestTimestamp + 15n : 15n;
  await sleep(Number(waitSeconds) * 1000);
}

export async function executeManagedCall(
  accessManager: any,
  signer: Signer,
  targetContract: any,
  functionName: string,
  args: readonly unknown[],
  label: string,
  executionDelaySeconds: number,
) {
  const target = await targetContract.getAddress();
  const data = targetContract.interface.encodeFunctionData(functionName, [...args]);

  if (executionDelaySeconds <= 0) {
    return waitForTx((targetContract.connect(signer) as any)[functionName](...args), label);
  }

  try {
    await sendManagerCall(accessManager, signer, "schedule", [target, data, 0], `${label} schedule`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${label} schedule skipped: ${message}`);
  }

  await waitUntilOperationReady(accessManager, signer, target, data);
  return sendManagerCall(accessManager, signer, "execute", [target, data], `${label} execute`);
}
