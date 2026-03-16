import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { RecentActivitySection } from "../../../../src/components/sections/RecentActivitySection";

describe("src/components/sections/RecentActivitySection", () => {
  it("renders the recent activity heading", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(RecentActivitySection, {
        snapshot: null,
        explorerUrl: "https://explorer.example",
      }),
    );

    expect(html).to.contain("Recent activity");
    expect(html).to.contain("No recent events were returned from the configured block window.");
  });
});
