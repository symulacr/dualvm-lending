import { formatUnits } from "viem";

export interface SubmittedTransaction {
  wait(): Promise<{ hash?: string }>;
  hash?: string;
}

export function formatWad(value: bigint): string {
  return formatUnits(value, 18);
}

export async function waitForTransaction(txPromise: Promise<SubmittedTransaction>, label: string) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${receipt.hash ?? tx.hash ?? "mined"}`);
  return receipt;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(
  label: string,
  isReady: () => Promise<boolean>,
  { timeoutMs = 30_000, intervalMs = 1_000 }: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReady()) {
      console.log(`${label}: ready`);
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}
