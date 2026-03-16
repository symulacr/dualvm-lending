import { expect } from "chai";
import * as applyRoleSeparation from "../scripts/applyRoleSeparation";
import * as deploy from "../scripts/deploy";
import * as executeLiquidation from "../scripts/executeLiquidation";
import * as liveLiquidationSmoke from "../scripts/liveLiquidationSmoke";
import * as liveMinterSmoke from "../scripts/liveMinterSmoke";
import * as liveOracleSmoke from "../scripts/liveOracleSmoke";
import * as liveRepaySmoke from "../scripts/liveRepaySmoke";
import * as liveRiskAdminSmoke from "../scripts/liveRiskAdminSmoke";
import * as liveSmoke from "../scripts/liveSmoke";
import * as upgradeOracle from "../scripts/upgradeOracle";
import * as verifyAll from "../scripts/verifyAll";

describe("script entrypoints", () => {
  it("exports import-safe main functions", () => {
    const modules = [
      applyRoleSeparation,
      deploy,
      executeLiquidation,
      liveLiquidationSmoke,
      liveMinterSmoke,
      liveOracleSmoke,
      liveRepaySmoke,
      liveRiskAdminSmoke,
      liveSmoke,
      upgradeOracle,
      verifyAll,
    ];

    for (const module of modules) {
      expect(module.main).to.be.a("function");
    }
  });
});
