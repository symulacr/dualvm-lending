import { expect } from "chai";
import { requireEnv } from "../lib/runtime/env";
import { formatWad, waitForCondition } from "../lib/runtime/transactions";

describe("runtime helpers", () => {
  it("requires present environment variables", () => {
    process.env.DUALVM_TEST_ENV = "set";
    expect(requireEnv("DUALVM_TEST_ENV")).to.equal("set");
    delete process.env.DUALVM_TEST_ENV;
    expect(() => requireEnv("DUALVM_TEST_ENV")).to.throw("Missing required environment variable: DUALVM_TEST_ENV");
  });

  it("formats wad amounts", () => {
    expect(formatWad(1234567890000000000n)).to.equal("1.23456789");
  });

  it("waits until a condition becomes ready", async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 25);

    await waitForCondition("test ready", async () => ready, { intervalMs: 10, timeoutMs: 500 });
  });

  it("times out when a condition never becomes ready", async () => {
    try {
      await waitForCondition("never ready", async () => false, { intervalMs: 10, timeoutMs: 30 });
      expect.fail("expected waitForCondition to throw");
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.equal("never ready did not become ready within 30ms");
    }
  });
});
