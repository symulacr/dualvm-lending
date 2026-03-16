import { expect } from "chai";
import { managedMintUsdc } from "../lib/ops/managedAccess";

function tx(hash = "0x1") {
  return {
    hash,
    async wait() {
      return { hash };
    },
  };
}

describe("managed access helpers", () => {
  it("calls the target contract directly when no delay is configured", async () => {
    const calls: string[] = [];
    const context = {
      accessManager: {} as never,
      signer: {} as never,
      executionDelaySeconds: 0,
    };
    const usdc = {
      async getAddress() {
        return "0x1000000000000000000000000000000000000000";
      },
      interface: {
        encodeFunctionData() {
          return "0xdeadbeef";
        },
      },
      connect() {
        return {
          async mint() {
            calls.push("mint");
            return tx();
          },
        };
      },
    };

    await managedMintUsdc(context, usdc, "0x2000000000000000000000000000000000000000", 5n, "mint direct");
    expect(calls).to.deep.equal(["mint"]);
  });

  it("schedules and executes delayed calls", async () => {
    const calls: string[] = [];
    const signer = {
      async getAddress() {
        return "0x3000000000000000000000000000000000000000";
      },
    };
    const accessManager = {
      async getAddress() {
        return "0x4000000000000000000000000000000000000000";
      },
      interface: {
        encodeFunctionData(fragment: string) {
          return `0x${fragment}`;
        },
      },
      async hashOperation() {
        return 1n;
      },
      async getSchedule() {
        return 1n;
      },
      runner: {
        provider: {
          async getBlock() {
            return { timestamp: 30 };
          },
        },
      },
      connect() {
        return {
          async schedule() {
            calls.push("schedule");
            return tx("0x11");
          },
          async execute() {
            calls.push("execute");
            return tx("0x12");
          },
        };
      },
    };
    const usdc = {
      async getAddress() {
        return "0x5000000000000000000000000000000000000000";
      },
      interface: {
        encodeFunctionData() {
          return "0xbeef";
        },
      },
      connect() {
        return {
          async mint() {
            calls.push("mint");
            return tx("0x13");
          },
        };
      },
    };

    await managedMintUsdc(
      {
        accessManager: accessManager as never,
        signer: signer as never,
        executionDelaySeconds: 5,
      },
      usdc as never,
      "0x6000000000000000000000000000000000000000",
      7n,
      "mint delayed",
    );

    expect(calls).to.deep.equal(["schedule", "execute"]);
  });
});
