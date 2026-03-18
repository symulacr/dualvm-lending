import * as dotenv from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@parity/hardhat-polkadot";
import { POLKADOT_HUB_TESTNET } from "./lib/config/marketConfig";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  resolc: {
    compilerSource: "npm",
  },
  networks: {
    polkadotHubPvmTestnet: {
      polkadot: true,
      url: process.env.POLKADOT_HUB_TESTNET_RPC_FALLBACK_URL ?? POLKADOT_HUB_TESTNET.fallbackRpcUrl,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: POLKADOT_HUB_TESTNET.chainId,
    },
  },
  paths: {
    sources: "./contracts/probes",
    cache: "./cache-pvm",
    artifacts: "./artifacts-pvm",
  },
};

export default config;
