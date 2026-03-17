/**
 * Barrel test: consolidates all lib/ module import-safety checks.
 * Replaces individual stub files in test/lib/.
 */
import { expect } from "chai";
import { isDirectExecution, runEntrypoint } from "../lib/runtime/entrypoint";
import { formatWad, waitForCondition, waitForTransaction } from "../lib/runtime/transactions";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { parseDeploymentManifest } from "../lib/shared/deploymentManifest";
import { openBorrowPosition, seedDebtPoolLiquidity, waitForDebtToAccrue } from "../lib/ops/liveScenario";
import { managedActivateVersion, managedMintUsdc, managedRegisterVersion } from "../lib/ops/managedAccess";

describe("lib barrel", () => {
  it("runtime: exports entrypoint and transaction helpers", () => {
    for (const fn of [isDirectExecution, runEntrypoint, formatWad, waitForTransaction, waitForCondition]) {
      expect(fn).to.be.a("function");
    }
  });

  it("deployment: exports manifest loaders and parsers", () => {
    for (const fn of [loadDeploymentManifest, parseDeploymentManifest]) {
      expect(fn).to.be.a("function");
    }
  });

  it("ops: exports scenario and managed-access helpers", () => {
    for (const fn of [seedDebtPoolLiquidity, openBorrowPosition, waitForDebtToAccrue, managedMintUsdc, managedRegisterVersion, managedActivateVersion]) {
      expect(fn).to.be.a("function");
    }
  });
});
