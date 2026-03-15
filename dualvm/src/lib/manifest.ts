import manifestJson from "../../deployments/polkadot-hub-testnet.json";

export interface DeploymentManifest {
  generatedAt: string;
  networkName: string;
  polkadotHubTestnet: {
    name: string;
    chainId: number;
    rpcUrl: string;
    fallbackRpcUrl: string;
    explorerUrl: string;
    faucetUrl: string;
  };
  roles: {
    treasury: string;
    emergencyAdmin: string;
    riskAdmin: string;
    treasuryOperator: string;
    minter: string;
  };
  config: {
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
  };
  contracts: {
    accessManager: string;
    wpas: string;
    usdc: string;
    oracle: string;
    riskEngine: string;
    debtPool: string;
    lendingCore: string;
  };
}

export const deploymentManifest = manifestJson as DeploymentManifest;
export const hasLivePolkadotHubTestnetDeployment = deploymentManifest.networkName === "polkadotHubTestnet";
