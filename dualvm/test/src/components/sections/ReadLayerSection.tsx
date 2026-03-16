import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { ReadLayerSection } from "../../../../src/components/sections/ReadLayerSection";

describe("src/components/sections/ReadLayerSection", () => {
  it("renders the read layer heading", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(ReadLayerSection, {
        readStatus: "RPC healthy",
        snapshot: null,
      }),
    );

    expect(html).to.contain("Read layer");
    expect(html).to.contain("RPC healthy");
  });
});
