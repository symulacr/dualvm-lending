export type HexAddress = `0x${string}`;

export interface DeploymentNetwork {
  name: string;
  chainId: number;
  rpcUrl: string;
  fallbackRpcUrl: string;
  explorerUrl: string;
  faucetUrl: string;
}

export interface DeploymentRoles {
  treasury: HexAddress;
  emergencyAdmin: HexAddress;
  riskAdmin: HexAddress;
  treasuryOperator: HexAddress;
  minter: HexAddress;
}

export interface GovernanceExecutionDelays {
  emergency: number;
  riskAdmin: number;
  treasury: number;
  minter: number;
}

export interface DeploymentGovernance {
  admin: HexAddress;
  executionDelaySeconds: GovernanceExecutionDelays;
}

export interface DeploymentConfig {
  adminDelaySeconds: number;
  oracleMaxAgeSeconds: number;
  oraclePriceWad: string;
  initialLiquidity: string;
  pool: {
    supplyCap: string;
    initialLiquidity: string;
  };
  core: {
    borrowCap: string;
    minBorrowAmount: string;
    reserveFactorBps: string;
    maxLtvBps: string;
    liquidationThresholdBps: string;
    liquidationBonusBps: string;
  };
  riskEngine: Record<string, string>;
  oracle?: {
    circuitBreaker: {
      minPriceWad: string;
      maxPriceWad: string;
      maxPriceChangeBps: string;
    };
  };
}

export interface DeploymentContracts {
  accessManager: HexAddress;
  wpas: HexAddress;
  usdc: HexAddress;
  oracle: HexAddress;
  riskEngine: HexAddress;
  debtPool: HexAddress;
  lendingCore: HexAddress;
  quoteEngine?: HexAddress;
  marketRegistry?: HexAddress;
  governanceToken?: HexAddress;
  governor?: HexAddress;
  governanceMultisig?: HexAddress;
  governanceTimelock?: HexAddress;
  lendingRouter?: HexAddress;
}

export interface DeploymentManifest {
  generatedAt: string;
  networkName: string;
  polkadotHubTestnet: DeploymentNetwork;
  roles: DeploymentRoles;
  governance: DeploymentGovernance;
  config: DeploymentConfig;
  contracts: DeploymentContracts;
}

export function bigintReplacer(_: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected object at ${path}`);
  }
}

function readString(record: Record<string, unknown>, key: string, path: string) {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string at ${path}.${key}`);
  }
  return value;
}

function readNumber(record: Record<string, unknown>, key: string, path: string) {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`Expected number at ${path}.${key}`);
  }
  return value;
}

function readAddress(record: Record<string, unknown>, key: string, path: string): HexAddress {
  const value = readString(record, key, path);
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Expected 20-byte hex address at ${path}.${key}`);
  }
  return value as HexAddress;
}

function readStrings(record: Record<string, unknown>, keys: string[], path: string) {
  for (const key of keys) readString(record, key, path);
}

function readNumbers(record: Record<string, unknown>, keys: string[], path: string) {
  for (const key of keys) readNumber(record, key, path);
}

function readAddresses(record: Record<string, unknown>, keys: string[], path: string) {
  for (const key of keys) readAddress(record, key, path);
}

function readOptionalAddresses(record: Record<string, unknown>, keys: string[], path: string) {
  for (const key of keys) {
    if (record[key] !== undefined) readAddress(record, key, path);
  }
}

export function parseDeploymentManifest(value: unknown): DeploymentManifest {
  assertRecord(value, "manifest");
  for (const [key, path] of [
    ["polkadotHubTestnet", "manifest.polkadotHubTestnet"],
    ["roles", "manifest.roles"],
    ["governance", "manifest.governance"],
    ["config", "manifest.config"],
    ["contracts", "manifest.contracts"],
  ] as const) {
    assertRecord(value[key], path);
  }
  const net = value.polkadotHubTestnet as Record<string, unknown>;
  const roles = value.roles as Record<string, unknown>;
  const governance = value.governance as Record<string, unknown>;
  const config = value.config as Record<string, unknown>;
  const contracts = value.contracts as Record<string, unknown>;

  assertRecord(governance.executionDelaySeconds, "manifest.governance.executionDelaySeconds");
  const delays = governance.executionDelaySeconds as Record<string, unknown>;
  for (const sub of ["pool", "core", "riskEngine"] as const) assertRecord(config[sub], `manifest.config.${sub}`);
  const pool = config.pool as Record<string, unknown>;
  const core = config.core as Record<string, unknown>;

  if (config.oracle !== undefined) {
    assertRecord(config.oracle, "manifest.config.oracle");
    assertRecord((config.oracle as Record<string, unknown>).circuitBreaker, "manifest.config.oracle.circuitBreaker");
  }

  readStrings(value, ["generatedAt", "networkName"], "manifest");
  readStrings(net, ["name", "rpcUrl", "fallbackRpcUrl", "explorerUrl", "faucetUrl"], "manifest.polkadotHubTestnet");
  readNumber(net, "chainId", "manifest.polkadotHubTestnet");
  readAddresses(roles, ["treasury", "emergencyAdmin", "riskAdmin", "treasuryOperator", "minter"], "manifest.roles");
  readAddress(governance, "admin", "manifest.governance");
  readNumbers(delays, ["emergency", "riskAdmin", "treasury", "minter"], "manifest.governance.executionDelaySeconds");
  readNumbers(config, ["adminDelaySeconds", "oracleMaxAgeSeconds"], "manifest.config");
  readStrings(config, ["oraclePriceWad", "initialLiquidity"], "manifest.config");
  readStrings(pool, ["supplyCap", "initialLiquidity"], "manifest.config.pool");
  readStrings(core, ["borrowCap", "minBorrowAmount", "reserveFactorBps", "maxLtvBps", "liquidationThresholdBps", "liquidationBonusBps"], "manifest.config.core");

  for (const [key, engineValue] of Object.entries(config.riskEngine as Record<string, unknown>)) {
    if (typeof engineValue !== "string") throw new Error(`Expected string at manifest.config.riskEngine.${key}`);
  }

  if (config.oracle !== undefined) {
    readStrings((config.oracle as Record<string, unknown>).circuitBreaker as Record<string, unknown>, ["minPriceWad", "maxPriceWad", "maxPriceChangeBps"], "manifest.config.oracle.circuitBreaker");
  }

  readAddresses(contracts, ["accessManager", "wpas", "usdc", "oracle", "riskEngine", "debtPool", "lendingCore"], "manifest.contracts");
  readOptionalAddresses(contracts, ["quoteEngine", "marketRegistry", "governanceToken", "governor", "governanceMultisig", "governanceTimelock", "lendingRouter"], "manifest.contracts");

  return value as unknown as DeploymentManifest;
}
