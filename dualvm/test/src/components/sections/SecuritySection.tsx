import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { SecuritySection } from "../../../../src/components/sections/SecuritySection";

describe("src/components/sections/SecuritySection", () => {
  it("renders the security heading", () => {
    const html = ReactDOMServer.renderToString(React.createElement(SecuritySection));

    expect(html).to.contain("Security posture");
    expect(html).to.contain("AccessManager is the authority boundary for admin actions.");
  });
});
