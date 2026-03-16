import { expect } from "chai";
import { loadObserverSnapshot } from "../../../../src/lib/readModel/observer";

describe("readModel/observer module", () => {
  it("exports loadObserverSnapshot", () => {
    expect(loadObserverSnapshot).to.be.a("function");
  });
});
