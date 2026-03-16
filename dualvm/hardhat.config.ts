import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import { POLKADOT_HUB_TESTNET } from "./lib/config/marketConfig";

dotenv.config();

type HardhatEnv = NodeJS.ProcessEnv;

export function buildAccounts(env: HardhatEnv) {
  return env.PRIVATE_KEY ? [env.PRIVATE_KEY] : [];
}

export function createHardhatConfig(env: HardhatEnv): HardhatUserConfig {
  const accounts = buildAccounts(env);
  const rpcUrl = env.POLKADOT_HUB_TESTNET_RPC_URL ?? POLKADOT_HUB_TESTNET.rpcUrl;
  const fallbackRpcUrl = env.POLKADOT_HUB_TESTNET_RPC_FALLBACK_URL ?? POLKADOT_HUB_TESTNET.fallbackRpcUrl;
  const blockscoutApiKey = env.BLOCKSCOUT_API_KEY ?? "empty";

  return {
    solidity: {
      version: "0.8.28",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        evmVersion: "cancun",
      },
    },
    networks: {
      hardhat: {
        chainId: 31337,
      },
      polkadotHubTestnet: {
        url: rpcUrl,
        chainId: POLKADOT_HUB_TESTNET.chainId,
        accounts,
      },
      polkadotHubTestnetFallback: {
        url: fallbackRpcUrl,
        chainId: POLKADOT_HUB_TESTNET.chainId,
        accounts,
      },
    },
    etherscan: {
      apiKey: {
        polkadotHubTestnet: blockscoutApiKey,
      },
      customChains: [
        {
          network: "polkadotHubTestnet",
          chainId: POLKADOT_HUB_TESTNET.chainId,
          urls: {
            apiURL: `${POLKADOT_HUB_TESTNET.explorerUrl}api`,
            browserURL: POLKADOT_HUB_TESTNET.explorerUrl.replace(/\/$/, ""),
          },
        },
      ],
    },
    paths: {
      sources: "./contracts",
      tests: "./test",
      cache: "./cache",
      artifacts: "./artifacts",
    },
  };
}

export default createHardhatConfig(process.env);
