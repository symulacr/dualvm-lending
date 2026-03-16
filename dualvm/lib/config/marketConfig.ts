export const WAD = 10n ** 18n;

export const POLKADOT_HUB_TESTNET = {
  name: "Polkadot Hub TestNet",
  chainId: 420420417,
  rpcUrl: "https://eth-rpc-testnet.polkadot.io/",
  fallbackRpcUrl: "https://services.polkadothub-rpc.com/testnet/",
  explorerUrl: "https://blockscout-testnet.polkadot.io/",
  faucetUrl: "https://faucet.polkadot.io/",
} as const;

export const ROLE_IDS = {
  EMERGENCY: 1,
  RISK_ADMIN: 2,
  TREASURY: 3,
  MINTER: 4,
  GOVERNANCE: 5,
  MIGRATION: 6,
} as const;

export const TARGET_ADMIN_DELAY_SECONDS = 60 * 60;

export const LIVE_ROLE_EXECUTION_DELAYS_SECONDS = {
  emergency: 0,
  riskAdmin: 60,
  treasury: 60,
  minter: 60,
} as const;

export const RISK_ENGINE_DEFAULTS = {
  baseRateBps: 200n,
  slope1Bps: 800n,
  slope2Bps: 3_000n,
  kinkBps: 8_000n,
  healthyMaxLtvBps: 7_500n,
  stressedMaxLtvBps: 6_500n,
  healthyLiquidationThresholdBps: 8_500n,
  stressedLiquidationThresholdBps: 7_800n,
  staleBorrowRatePenaltyBps: 1_000n,
  stressedCollateralRatioBps: 14_000n,
} as const;

export const ORACLE_DEFAULTS = {
  maxAgeSeconds: 6 * 60 * 60,
  initialPriceWad: 1_000n * WAD,
} as const;

export const ORACLE_CIRCUIT_BREAKER_DEFAULTS = {
  minPriceWad: 1n * WAD,
  maxPriceWad: 10_000n * WAD,
  maxPriceChangeBps: 2_500n,
} as const;

export const POOL_DEFAULTS = {
  supplyCap: 5_000_000n * WAD,
  initialLiquidity: 0n,
} as const;

export const CORE_DEFAULTS = {
  borrowCap: 4_000_000n * WAD,
  minBorrowAmount: 100n * WAD,
  reserveFactorBps: 1_000n,
  maxLtvBps: 7_000n,
  liquidationThresholdBps: 8_000n,
  liquidationBonusBps: 500n,
} as const;
