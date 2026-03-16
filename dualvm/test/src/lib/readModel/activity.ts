import { expect } from "chai";
import { describeRecentActivityWindow, loadRecentActivityFeed } from "../../../../src/lib/readModel/activity";

describe("readModel/activity module", () => {
  it("exports recent-activity helpers", () => {
    expect(describeRecentActivityWindow).to.be.a("function");
    expect(loadRecentActivityFeed).to.be.a("function");
  });
});
