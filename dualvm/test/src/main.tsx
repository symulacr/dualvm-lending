import { expect } from "chai";

describe("src/main", () => {
  it("exports renderApp", () => {
    (require.extensions as Record<string, (module: NodeModule, filename: string) => void>)[".css"] = () => undefined;
    const { renderApp } = require("../../src/main") as typeof import("../../src/main");

    expect(renderApp).to.be.a("function");
  });
});
