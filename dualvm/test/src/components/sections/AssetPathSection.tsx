import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { AssetPathSection } from "../../../../src/components/sections/AssetPathSection";

describe("src/components/sections/AssetPathSection", () => {
  it("renders the asset path heading", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(AssetPathSection, {
        assets: [
          {
            symbol: "WPAS",
            name: "Wrapped PAS",
            role: "Collateral asset",
            decimals: 18,
            address: "0x1234567890abcdef1234567890abcdef12345678",
            source: "Native PAS",
            truthModel: "Real native collateral",
            notes: "Used for collateral",
            upgradePath: "None",
          },
        ],
      }),
    );

    expect(html).to.contain("Asset path");
    expect(html).to.contain("WPAS");
  });
});
