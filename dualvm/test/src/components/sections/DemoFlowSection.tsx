import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { DemoFlowSection } from "../../../../src/components/sections/DemoFlowSection";

describe("src/components/sections/DemoFlowSection", () => {
  it("renders the demo flow heading", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(DemoFlowSection, {
        judgeFlow: ["Open dashboard"],
      }),
    );

    expect(html).to.contain("Judge-facing demo flow");
    expect(html).to.contain("Open dashboard");
  });
});
