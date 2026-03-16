import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { OverviewSections } from "../../../../src/components/sections/OverviewSections";

describe("src/components/sections/OverviewSections", () => {
  it("renders key overview headings", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(OverviewSections, {
        demoModeNotes: ["Read-only demo"],
        writePathTruth: ["No hidden backend"],
        scopeGuardrails: ["Observer-only UI"],
        network: {
          rpcUrl: "https://rpc.example",
          fallbackRpcUrl: "https://fallback.example",
          chainId: 420_420,
          explorerUrl: "https://explorer.example",
          faucetUrl: "https://faucet.example",
        },
        networkName: "TestNet manifest",
      }),
    );

    expect(html).to.contain("Frontend demo mode");
    expect(html).to.contain("Write-path truth");
  });
});
