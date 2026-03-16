import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { MetricCard } from "../../../src/components/MetricCard";

describe("src/components/MetricCard", () => {
  it("renders label and value text", () => {
    const html = ReactDOMServer.renderToString(React.createElement(MetricCard, { label: "Debt", value: "10" }));

    expect(html).to.contain("Debt");
    expect(html).to.contain("10");
  });
});
