import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import App from "../src/App";
import { MetricCard } from "../src/components/MetricCard";
import { assetRegistry } from "../src/lib/assetRegistry";
import { debtPoolAbi, lendingCoreAbi, manualOracleAbi } from "../src/lib/abi";
import { formatAddress, formatTokenAmount, formatTimestamp } from "../src/lib/format";
import { deploymentManifest, hasLivePolkadotHubTestnetDeployment } from "../src/lib/manifest";
import { loadMarketSnapshot } from "../src/lib/readModel";
import { renderApp } from "../src/main";

describe("frontend modules", () => {
  it("renders the app shell without crashing", () => {
    const html = ReactDOMServer.renderToString(React.createElement(App));
    expect(html).to.contain("Public-RPC-first isolated lending market");
    expect(html).to.contain("Write-path truth");
  });

  it("renders metric cards", () => {
    const html = ReactDOMServer.renderToString(React.createElement(MetricCard, { label: "Debt", value: "10" }));
    expect(html).to.contain("Debt");
    expect(html).to.contain("10");
  });

  it("exposes the asset registry and deployment manifest", () => {
    expect(assetRegistry.map((asset) => asset.symbol)).to.deep.equal(["WPAS", "USDC-test"]);
    expect(hasLivePolkadotHubTestnetDeployment).to.equal(true);
    expect(deploymentManifest.contracts.lendingCore).to.match(/^0x[a-fA-F0-9]{40}$/);
  });

  it("exports ABIs and read-model entrypoints", () => {
    expect(debtPoolAbi.length).to.be.greaterThan(0);
    expect(lendingCoreAbi.length).to.be.greaterThan(0);
    expect(manualOracleAbi.length).to.be.greaterThan(0);
    expect(loadMarketSnapshot).to.be.a("function");
    expect(renderApp).to.be.a("function");
  });

  it("formats addresses, token amounts, and timestamps", () => {
    expect(formatAddress("0x1234567890abcdef1234567890abcdef12345678")).to.equal("0x1234…5678");
    expect(formatTokenAmount(1234500000000000000n)).to.equal("1.23");
    expect(formatTimestamp("2026-03-16T00:00:00.000Z")).to.be.a("string");
  });
});
