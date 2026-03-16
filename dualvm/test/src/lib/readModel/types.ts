import { expect } from "chai";
import * as readModelTypes from "../../../../src/lib/readModel/types";

describe("readModel/types module", () => {
  it("loads without throwing", () => {
    expect(readModelTypes).to.be.an("object");
  });
});
