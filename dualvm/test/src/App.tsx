import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import App from "../../src/App";

describe("src/App", () => {
  it("renders key app text", () => {
    const html = ReactDOMServer.renderToString(React.createElement(App));

    expect(html).to.contain("Public-RPC-first isolated lending market");
    expect(html).to.contain("Write-path truth");
  });
});
