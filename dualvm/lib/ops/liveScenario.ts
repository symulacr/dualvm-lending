const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

import { managedMintUsdc, type ManagedCallContext } from "./managedAccess";
import { waitForCondition, waitForTransaction } from "../runtime/transactions";

interface DebtPoolLike {
  getAddress(): Promise<string>;
  deposit(amount: bigint, receiver: string): Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }>;
}

interface WpasLike {
  getAddress(): Promise<string>;
  deposit(overrides: { value: bigint }): Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }>;
  approve(spender: string, amount: bigint): Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }>;
}

interface LendingCoreLike {
  getAddress(): Promise<string>;
  depositCollateral(amount: bigint): Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }>;
  borrow(amount: bigint): Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }>;
  currentDebt(account: string): Promise<bigint>;
}


export async function seedDebtPoolLiquidity(
  managedMinterContext: ManagedCallContext,
  usdcAdmin: any,
  usdcLiquidityProvider: { approve(spender: string, amount: bigint): Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }> },
  debtPool: DebtPoolLike,
  lenderAddress: string,
  seedAmount: bigint,
  labelPrefix: string,
 ) {
  await managedMintUsdc(managedMinterContext, usdcAdmin, lenderAddress, seedAmount, `${labelPrefix} mint lender usdc-test`);
  await waitForTransaction(
    usdcLiquidityProvider.approve(await debtPool.getAddress(), MAX_UINT256),
    `${labelPrefix} approve debt pool`,
  );
  await waitForTransaction(debtPool.deposit(seedAmount, lenderAddress), `${labelPrefix} deposit pool liquidity`);
}

export async function openBorrowPosition(params: {
  wpas: WpasLike;
  lendingCore: LendingCoreLike;
  collateralPas: bigint;
  borrowAmount: bigint;
  labelPrefix: string;
}) {
  const { wpas, lendingCore, collateralPas, borrowAmount, labelPrefix } = params;
  await waitForTransaction(wpas.deposit({ value: collateralPas }), `${labelPrefix} wrap pas into wpas`);
  await waitForTransaction(wpas.approve(await lendingCore.getAddress(), MAX_UINT256), `${labelPrefix} approve collateral`);
  await waitForTransaction(lendingCore.depositCollateral(collateralPas), `${labelPrefix} deposit collateral`);
  await waitForTransaction(lendingCore.borrow(borrowAmount), `${labelPrefix} draw stable debt`);
}

export async function waitForDebtToAccrue(
  lendingCore: LendingCoreLike,
  borrowerAddress: string,
  baselineDebt: bigint,
  label: string,
  timeoutMs = 30_000,
) {
  await waitForCondition(
    label,
    async () => (await lendingCore.currentDebt(borrowerAddress)) > baselineDebt,
    { intervalMs: 1_000, timeoutMs },
  );
}
