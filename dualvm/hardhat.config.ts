import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

dotenv.config();

const privateKey = process.env.PRIVATE_KEY;
const accounts = privateKey ? [privateKey] : [];
const polkadotHubTestnetRpcUrl = process.env.POLKADOT_HUB_TESTNET_RPC_URL ?? "https://eth-rpc-testnet.polkadot.io/";
const fallbackRpcUrl = process.env.POLKADOT_HUB_TESTNET_RPC_FALLBACK_URL ?? "https://services.polkadothub-rpc.com/testnet/";

const config: HardhatUserConfig = {
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
      url: polkadotHubTestnetRpcUrl,
      chainId: 420420417,
      accounts,
    },
    polkadotHubTestnetFallback: {
      url: fallbackRpcUrl,
      chainId: 420420417,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      polkadotHubTestnet: process.env.BLOCKSCOUT_API_KEY ?? "empty",
    },
    customChains: [
      {
        network: "polkadotHubTestnet",
        chainId: 420420417,
        urls: {
          apiURL: "https://blockscout-testnet.polkadot.io/api",
          browserURL: "https://blockscout-testnet.polkadot.io",
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

export default config;
