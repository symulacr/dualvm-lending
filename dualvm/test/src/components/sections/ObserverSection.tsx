import { expect } from "chai";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { ObserverSection } from "../../../../src/components/sections/ObserverSection";

describe("src/components/sections/ObserverSection", () => {
  it("renders observer labels", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(ObserverSection, {
        snapshot: null,
        observerInput: "0x1234567890abcdef1234567890abcdef12345678",
        setObserverInput: () => undefined,
        onTrackAddress: () => undefined,
        onRefresh: () => undefined,
      }),
    );

    expect(html).to.contain("Observer mode");
    expect(html).to.contain("Track address");
  });
});
