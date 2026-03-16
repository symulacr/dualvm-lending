import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { HeroSection } from "../../../../src/components/sections/HeroSection";

describe("src/components/sections/HeroSection", () => {
  it("renders the hero heading", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(HeroSection, {
        generatedAt: "2026-03-16T00:00:00.000Z",
        hasLiveDeployment: true,
      }),
    );

    expect(html).to.contain("Public-RPC-first isolated lending market");
  });
});
