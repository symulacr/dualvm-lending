/**
 * Test suite for the idempotent deployment core logic.
 *
 * Tests classifySteps() and runIdempotentSteps() using injected mocks for:
 *  - manifestContracts (in-memory map)
 *  - getCode (simulates provider.getCode)
 *  - onDeployed (checkpoint callback)
 *  - deploy functions (counters to verify skip/run behaviour)
 *
 * Run: npx hardhat test test/IdempotentDeploy.ts
 * Or:  npm test -- --grep "idempotent-deploy"
 */
import { expect } from "chai";
import { classifySteps, runIdempotentSteps, type IdempotentDeployStep } from "../lib/deployment/idempotentDeploy";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const LIVE_CODE = "0x608060405234801561001057600080fd5b50"; // non-empty bytecode prefix
const EMPTY_CODE = "0x";

const ADDR_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ADDR_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ADDR_C = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const ADDR_NEW = "0x1234123412341234123412341234123412341234";

/**
 * Builds a simple step that increments a counter when deploy() is called.
 */
function makeStep(key: string, label: string, returnAddr: string) {
  const tracker = { callCount: 0 };
  const step: IdempotentDeployStep = {
    key,
    label,
    deploy: async () => {
      tracker.callCount += 1;
      return returnAddr;
    },
  };
  return { step, tracker };
}

// ─── classifySteps ─────────────────────────────────────────────────────────

describe("idempotent-deploy: classifySteps()", function () {
  it("marks step as SKIP when manifest has address with live bytecode", async function () {
    const { step } = makeStep("accessManager", "AccessManager", ADDR_NEW);
    const result = await classifySteps([step], {
      manifestContracts: { accessManager: ADDR_A },
      getCode: async () => LIVE_CODE,
    });

    expect(result).to.have.length(1);
    expect(result[0].shouldSkip).to.be.true;
    expect(result[0].existingAddress).to.equal(ADDR_A);
    expect(result[0].skipReason).to.include(ADDR_A);
  });

  it("marks step as DEPLOY when manifest has address but code is empty (0x)", async function () {
    const { step } = makeStep("wpas", "WPAS", ADDR_NEW);
    const result = await classifySteps([step], {
      manifestContracts: { wpas: ADDR_B },
      getCode: async () => EMPTY_CODE,
    });

    expect(result).to.have.length(1);
    expect(result[0].shouldSkip).to.be.false;
    expect(result[0].existingAddress).to.equal(ADDR_B);
    expect(result[0].skipReason).to.be.undefined;
  });

  it("marks step as DEPLOY when key is absent from manifest", async function () {
    const { step } = makeStep("oracle", "ManualOracle", ADDR_NEW);
    const result = await classifySteps([step], {
      manifestContracts: {},
      getCode: async () => LIVE_CODE, // getCode should NOT be called
    });

    expect(result).to.have.length(1);
    expect(result[0].shouldSkip).to.be.false;
    expect(result[0].existingAddress).to.be.undefined;
  });

  it("handles mixed steps correctly", async function () {
    const { step: stepA } = makeStep("accessManager", "AccessManager", ADDR_NEW);
    const { step: stepB } = makeStep("wpas", "WPAS", ADDR_NEW);
    const { step: stepC } = makeStep("usdc", "USDC", ADDR_NEW);

    const getCode = async (addr: string) => {
      if (addr === ADDR_A) return LIVE_CODE; // accessManager: deployed
      if (addr === ADDR_B) return EMPTY_CODE; // wpas: recorded but empty
      return EMPTY_CODE;
    };

    const result = await classifySteps([stepA, stepB, stepC], {
      manifestContracts: { accessManager: ADDR_A, wpas: ADDR_B },
      getCode,
    });

    expect(result).to.have.length(3);
    expect(result[0].shouldSkip).to.be.true;  // accessManager: has live code
    expect(result[1].shouldSkip).to.be.false; // wpas: address recorded but empty code
    expect(result[2].shouldSkip).to.be.false; // usdc: not in manifest at all
  });

  it("treats getCode failures as not-deployed", async function () {
    const { step } = makeStep("oracle", "ManualOracle", ADDR_NEW);
    const result = await classifySteps([step], {
      manifestContracts: { oracle: ADDR_C },
      getCode: async () => {
        throw new Error("RPC timeout");
      },
    });

    // Provider error → treat as empty code → should deploy
    expect(result).to.have.length(1);
    expect(result[0].shouldSkip).to.be.false;
  });

  it("returns classifications in same order as steps", async function () {
    const keys = ["a", "b", "c", "d", "e"];
    const steps = keys.map((k) => makeStep(k, k.toUpperCase(), ADDR_NEW).step);

    const result = await classifySteps(steps, {
      manifestContracts: {},
      getCode: async () => EMPTY_CODE,
    });

    expect(result.map((r) => r.step.key)).to.deep.equal(keys);
  });
});

// ─── runIdempotentSteps ────────────────────────────────────────────────────

describe("idempotent-deploy: runIdempotentSteps()", function () {
  it("skips already-deployed steps and does not call deploy()", async function () {
    const { step, tracker } = makeStep("accessManager", "AccessManager", ADDR_NEW);

    const checkpointLog: Array<{ key: string; address: string }> = [];

    await runIdempotentSteps([step], {
      manifestContracts: { accessManager: ADDR_A },
      getCode: async () => LIVE_CODE,
      onDeployed: async (key, address) => {
        checkpointLog.push({ key, address });
      },
    });

    expect(tracker.callCount).to.equal(0, "deploy() must not be called for already-deployed step");
    expect(checkpointLog).to.have.length(0, "onDeployed checkpoint must not fire for skipped steps");
  });

  it("deploys steps that are missing from manifest", async function () {
    const { step, tracker } = makeStep("accessManager", "AccessManager", ADDR_NEW);

    const checkpointLog: Array<{ key: string; address: string }> = [];

    const result = await runIdempotentSteps([step], {
      manifestContracts: {},
      getCode: async () => EMPTY_CODE,
      onDeployed: async (key, address) => {
        checkpointLog.push({ key, address });
      },
    });

    expect(tracker.callCount).to.equal(1, "deploy() must be called exactly once");
    expect(result["accessManager"]).to.equal(ADDR_NEW);
    expect(checkpointLog).to.deep.equal([{ key: "accessManager", address: ADDR_NEW }]);
  });

  it("deploys steps where manifest address has no code", async function () {
    const { step, tracker } = makeStep("usdc", "USDC", ADDR_NEW);

    const result = await runIdempotentSteps([step], {
      manifestContracts: { usdc: ADDR_C },
      getCode: async () => EMPTY_CODE,
      onDeployed: async () => {},
    });

    expect(tracker.callCount).to.equal(1);
    expect(result["usdc"]).to.equal(ADDR_NEW);
  });

  it("calls onDeployed checkpoint immediately after each deployment", async function () {
    const { step: stepA } = makeStep("a", "ContractA", ADDR_A);
    const { step: stepB } = makeStep("b", "ContractB", ADDR_B);
    const { step: stepC } = makeStep("c", "ContractC", ADDR_C);

    const checkpointOrder: string[] = [];

    await runIdempotentSteps([stepA, stepB, stepC], {
      manifestContracts: {},
      getCode: async () => EMPTY_CODE,
      onDeployed: async (key) => {
        checkpointOrder.push(key);
      },
    });

    // Checkpoint must be called in step order
    expect(checkpointOrder).to.deep.equal(["a", "b", "c"]);
  });

  it("resume scenario: second run skips steps deployed in first run", async function () {
    // Simulate state after first run deployed steps A and B but failed before C
    const firstRunAddresses: Record<string, string> = {
      a: ADDR_A,
      b: ADDR_B,
      // c was NOT deployed (interrupted)
    };

    const { step: stepA, tracker: trackerA } = makeStep("a", "ContractA", "0xnew_a");
    const { step: stepB, tracker: trackerB } = makeStep("b", "ContractB", "0xnew_b");
    const { step: stepC, tracker: trackerC } = makeStep("c", "ContractC", ADDR_C);

    const getCode = async (addr: string) => {
      // A and B are live on-chain from the first run
      if (addr === ADDR_A || addr === ADDR_B) return LIVE_CODE;
      return EMPTY_CODE;
    };

    const newlyDeployed: string[] = [];

    const result = await runIdempotentSteps([stepA, stepB, stepC], {
      manifestContracts: firstRunAddresses,
      getCode,
      onDeployed: async (key, address) => {
        newlyDeployed.push(key);
        firstRunAddresses[key] = address; // simulate checkpoint update
      },
    });

    // A and B must have been skipped
    expect(trackerA.callCount).to.equal(0, "step A must be skipped (already deployed)");
    expect(trackerB.callCount).to.equal(0, "step B must be skipped (already deployed)");
    // C must have been deployed
    expect(trackerC.callCount).to.equal(1, "step C must be deployed (missing)");

    // Result must include all addresses
    expect(result["a"]).to.equal(ADDR_A);
    expect(result["b"]).to.equal(ADDR_B);
    expect(result["c"]).to.equal(ADDR_C);

    // Only C was newly deployed
    expect(newlyDeployed).to.deep.equal(["c"]);
  });

  it("manifest output is consistent across multiple complete runs", async function () {
    // First run: everything needs to be deployed
    const addresses: Record<string, string> = {};

    const makeTrackedStep = (key: string, addr: string) => {
      const { step } = makeStep(key, key, addr);
      return step;
    };

    const steps = [
      makeTrackedStep("accessManager", ADDR_A),
      makeTrackedStep("wpas", ADDR_B),
      makeTrackedStep("usdc", ADDR_C),
    ];

    const firstResult = await runIdempotentSteps(steps, {
      manifestContracts: {},
      getCode: async () => EMPTY_CODE,
      onDeployed: async (key, address) => {
        addresses[key] = address;
      },
    });

    // Second run: all already deployed (simulate addresses persisted from first run)
    const { step: stepAM2, tracker: trackerAM2 } = makeStep("accessManager", "AccessManager", "0xdifferent");
    const { step: stepWP2, tracker: trackerWP2 } = makeStep("wpas", "WPAS", "0xdifferent");
    const { step: stepUS2, tracker: trackerUS2 } = makeStep("usdc", "USDC", "0xdifferent");

    const secondResult = await runIdempotentSteps([stepAM2, stepWP2, stepUS2], {
      manifestContracts: addresses,
      getCode: async () => LIVE_CODE, // all addresses have live code now
      onDeployed: async () => {},
    });

    // Second run must produce identical addresses
    expect(secondResult["accessManager"]).to.equal(firstResult["accessManager"]);
    expect(secondResult["wpas"]).to.equal(firstResult["wpas"]);
    expect(secondResult["usdc"]).to.equal(firstResult["usdc"]);

    // deploy() must not have been called in the second run
    expect(trackerAM2.callCount).to.equal(0);
    expect(trackerWP2.callCount).to.equal(0);
    expect(trackerUS2.callCount).to.equal(0);
  });
});
