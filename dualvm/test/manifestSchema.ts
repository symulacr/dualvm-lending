import { expect } from "chai";
import { parseDeploymentManifest } from "../lib/shared/deploymentManifest";

function buildManifest() {
  return {
    generatedAt: "2026-03-16T00:00:00.000Z",
    networkName: "polkadotHubTestnet",
    polkadotHubTestnet: {
      name: "Polkadot Hub TestNet",
      chainId: 420420417,
      rpcUrl: "https://eth-rpc-testnet.polkadot.io/",
      fallbackRpcUrl: "https://services.polkadothub-rpc.com/testnet/",
      explorerUrl: "https://blockscout-testnet.polkadot.io/",
      faucetUrl: "https://faucet.polkadot.io/",
    },
    roles: {
      treasury: "0x1111111111111111111111111111111111111111",
      emergencyAdmin: "0x2222222222222222222222222222222222222222",
      riskAdmin: "0x3333333333333333333333333333333333333333",
      treasuryOperator: "0x4444444444444444444444444444444444444444",
      minter: "0x5555555555555555555555555555555555555555",
    },
    governance: {
      admin: "0x6666666666666666666666666666666666666666",
      executionDelaySeconds: {
        emergency: 0,
        riskAdmin: 5,
        treasury: 5,
        minter: 5,
      },
    },
    config: {
      adminDelaySeconds: 3600,
      oracleMaxAgeSeconds: 21600,
      oraclePriceWad: "1000000000000000000000",
      initialLiquidity: "0",
      pool: {
        supplyCap: "5000000000000000000000000",
        initialLiquidity: "0",
      },
      core: {
        borrowCap: "4000000000000000000000000",
        minBorrowAmount: "100000000000000000000",
        reserveFactorBps: "1000",
        maxLtvBps: "7000",
        liquidationThresholdBps: "8000",
        liquidationBonusBps: "500",
      },
      riskEngine: {
        baseRateBps: "200",
      },
      oracle: {
        circuitBreaker: {
          minPriceWad: "1",
          maxPriceWad: "10000000000000000000000",
          maxPriceChangeBps: "2500",
        },
      },
    },
    contracts: {
      accessManager: "0x7777777777777777777777777777777777777777",
      wpas: "0x8888888888888888888888888888888888888888",
      usdc: "0x9999999999999999999999999999999999999999",
      oracle: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
      riskEngine: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
      debtPool: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
      lendingCore: "0xdDdDddDdDDdDdDDddDdDdDdDdDdDdDdDdDdDDdDD",
    },
  };
}

describe("deployment manifest schema", () => {
  it("parses a valid manifest", () => {
    const manifest = parseDeploymentManifest(buildManifest());
    expect(manifest.contracts.lendingCore).to.equal("0xdDdDddDdDDdDdDDddDdDdDdDdDdDdDdDdDdDDdDD");
    expect(manifest.roles.riskAdmin).to.equal("0x3333333333333333333333333333333333333333");
  });

  it("rejects malformed addresses", () => {
    const manifest = buildManifest();
    manifest.contracts.oracle = "not-an-address";
    expect(() => parseDeploymentManifest(manifest)).to.throw("manifest.contracts.oracle");
  });

  it("rejects malformed risk engine values", () => {
    const manifest = buildManifest() as any;
    manifest.config.riskEngine.baseRateBps = 200;
    expect(() => parseDeploymentManifest(manifest)).to.throw("manifest.config.riskEngine.baseRateBps");
  });
});
