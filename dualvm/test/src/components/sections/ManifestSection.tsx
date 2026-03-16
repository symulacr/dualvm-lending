import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { ManifestSection } from "../../../../src/components/sections/ManifestSection";

describe("src/components/sections/ManifestSection", () => {
  it("renders the deployment manifest heading", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(ManifestSection, {
        explorerUrl: "https://explorer.example",
        contractRows: [{ name: "LendingCore", address: "0x1234567890abcdef1234567890abcdef12345678" }],
      }),
    );

    expect(html).to.contain("Deployment manifest");
    expect(html).to.contain("LendingCore");
  });
});
