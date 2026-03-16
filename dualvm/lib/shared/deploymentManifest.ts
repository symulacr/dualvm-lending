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

export function parseDeploymentManifest(value: unknown): DeploymentManifest {
  assertRecord(value, "manifest");
  assertRecord(value.polkadotHubTestnet, "manifest.polkadotHubTestnet");
  assertRecord(value.roles, "manifest.roles");
  assertRecord(value.governance, "manifest.governance");
  assertRecord(value.governance.executionDelaySeconds, "manifest.governance.executionDelaySeconds");
  assertRecord(value.config, "manifest.config");
  assertRecord(value.config.pool, "manifest.config.pool");
  assertRecord(value.config.core, "manifest.config.core");
  assertRecord(value.config.riskEngine, "manifest.config.riskEngine");
  assertRecord(value.contracts, "manifest.contracts");

  if (value.config.oracle !== undefined) {
    assertRecord(value.config.oracle, "manifest.config.oracle");
    assertRecord(value.config.oracle.circuitBreaker, "manifest.config.oracle.circuitBreaker");
  }

  readString(value, "generatedAt", "manifest");
  readString(value, "networkName", "manifest");

  readString(value.polkadotHubTestnet, "name", "manifest.polkadotHubTestnet");
  readNumber(value.polkadotHubTestnet, "chainId", "manifest.polkadotHubTestnet");
  readString(value.polkadotHubTestnet, "rpcUrl", "manifest.polkadotHubTestnet");
  readString(value.polkadotHubTestnet, "fallbackRpcUrl", "manifest.polkadotHubTestnet");
  readString(value.polkadotHubTestnet, "explorerUrl", "manifest.polkadotHubTestnet");
  readString(value.polkadotHubTestnet, "faucetUrl", "manifest.polkadotHubTestnet");

  readAddress(value.roles, "treasury", "manifest.roles");
  readAddress(value.roles, "emergencyAdmin", "manifest.roles");
  readAddress(value.roles, "riskAdmin", "manifest.roles");
  readAddress(value.roles, "treasuryOperator", "manifest.roles");
  readAddress(value.roles, "minter", "manifest.roles");

  readAddress(value.governance, "admin", "manifest.governance");
  readNumber(value.governance.executionDelaySeconds, "emergency", "manifest.governance.executionDelaySeconds");
  readNumber(value.governance.executionDelaySeconds, "riskAdmin", "manifest.governance.executionDelaySeconds");
  readNumber(value.governance.executionDelaySeconds, "treasury", "manifest.governance.executionDelaySeconds");
  readNumber(value.governance.executionDelaySeconds, "minter", "manifest.governance.executionDelaySeconds");

  readNumber(value.config, "adminDelaySeconds", "manifest.config");
  readNumber(value.config, "oracleMaxAgeSeconds", "manifest.config");
  readString(value.config, "oraclePriceWad", "manifest.config");
  readString(value.config, "initialLiquidity", "manifest.config");
  readString(value.config.pool, "supplyCap", "manifest.config.pool");
  readString(value.config.pool, "initialLiquidity", "manifest.config.pool");
  readString(value.config.core, "borrowCap", "manifest.config.core");
  readString(value.config.core, "minBorrowAmount", "manifest.config.core");
  readString(value.config.core, "reserveFactorBps", "manifest.config.core");
  readString(value.config.core, "maxLtvBps", "manifest.config.core");
  readString(value.config.core, "liquidationThresholdBps", "manifest.config.core");
  readString(value.config.core, "liquidationBonusBps", "manifest.config.core");

  for (const [key, engineValue] of Object.entries(value.config.riskEngine)) {
    if (typeof engineValue !== "string") {
      throw new Error(`Expected string at manifest.config.riskEngine.${key}`);
    }
  }

  if (value.config.oracle !== undefined) {
    const circuitBreaker = value.config.oracle.circuitBreaker as Record<string, unknown>;
    readString(circuitBreaker, "minPriceWad", "manifest.config.oracle.circuitBreaker");
    readString(circuitBreaker, "maxPriceWad", "manifest.config.oracle.circuitBreaker");
    readString(circuitBreaker, "maxPriceChangeBps", "manifest.config.oracle.circuitBreaker");
  }

  readAddress(value.contracts, "accessManager", "manifest.contracts");
  readAddress(value.contracts, "wpas", "manifest.contracts");
  readAddress(value.contracts, "usdc", "manifest.contracts");
  readAddress(value.contracts, "oracle", "manifest.contracts");
  readAddress(value.contracts, "riskEngine", "manifest.contracts");
  readAddress(value.contracts, "debtPool", "manifest.contracts");
  readAddress(value.contracts, "lendingCore", "manifest.contracts");
  if (value.contracts.quoteEngine !== undefined) {
    readAddress(value.contracts, "quoteEngine", "manifest.contracts");
  }
  if (value.contracts.marketRegistry !== undefined) {
    readAddress(value.contracts, "marketRegistry", "manifest.contracts");
  }
  if (value.contracts.governanceToken !== undefined) {
    readAddress(value.contracts, "governanceToken", "manifest.contracts");
  }
  if (value.contracts.governor !== undefined) {
    readAddress(value.contracts, "governor", "manifest.contracts");
  }
  if (value.contracts.governanceMultisig !== undefined) {
    readAddress(value.contracts, "governanceMultisig", "manifest.contracts");
  }
  if (value.contracts.governanceTimelock !== undefined) {
    readAddress(value.contracts, "governanceTimelock", "manifest.contracts");
  }
  return value as unknown as DeploymentManifest;
}
