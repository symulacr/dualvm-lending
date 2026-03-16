import { expect } from "chai";
import { openBorrowPosition, seedDebtPoolLiquidity, waitForDebtToAccrue } from "../lib/ops/liveScenario";

function tx() {
  return {
    hash: "0x1",
    async wait() {
      return { hash: "0x1" };
    },
  };
}

describe("live scenario helpers", () => {
  it("seeds pool liquidity through the shared helper", async () => {
    const calls: string[] = [];
    const managedMinterContext = {
      accessManager: {} as never,
      signer: {} as never,
      executionDelaySeconds: 0,
    };
    const usdcAdmin = {
      connect() {
        return {
          async mint() {
            calls.push("mint");
            return tx();
          },
        };
      },
      async approve() {
        calls.push("approve");
        return tx();
      },
    };
    const debtPool = {
      async getAddress() {
        return "0x1000000000000000000000000000000000000000";
      },
      async deposit() {
        calls.push("deposit");
        return tx();
      },
    };

    await seedDebtPoolLiquidity(
      managedMinterContext,
      usdcAdmin,
      usdcAdmin,
      debtPool,
      "0x2000000000000000000000000000000000000000",
      10n,
      "scenario",
    );

    expect(calls).to.deep.equal(["mint", "approve", "deposit"]);
  });

  it("opens a borrow position with the shared helper", async () => {
    const calls: string[] = [];
    const wpas = {
      async getAddress() {
        return "0x3000000000000000000000000000000000000000";
      },
      async deposit() {
        calls.push("wrap");
        return tx();
      },
      async approve() {
        calls.push("approve");
        return tx();
      },
    };
    const lendingCore = {
      async getAddress() {
        return "0x3000000000000000000000000000000000000001";
      },
      async depositCollateral() {
        calls.push("depositCollateral");
        return tx();
      },
      async borrow() {
        calls.push("borrow");
        return tx();
      },
      async currentDebt() {
        return 0n;
      },
    };

    await openBorrowPosition({
      wpas,
      lendingCore,
      collateralPas: 5n,
      borrowAmount: 3n,
      labelPrefix: "borrower",
    });

    expect(calls).to.deep.equal(["wrap", "approve", "depositCollateral", "borrow"]);
  });

  it("waits until debt accrues", async () => {
    let reads = 0;
    const lendingCore = {
      async getAddress() {
        return "0x4000000000000000000000000000000000000000";
      },
      async depositCollateral() {
        return tx();
      },
      async borrow() {
        return tx();
      },
      async currentDebt() {
        reads += 1;
        return reads > 1 ? 2n : 1n;
      },
    };

    await waitForDebtToAccrue(lendingCore, "0x4000000000000000000000000000000000000000", 1n, "debt accrues", 1_500);
  });
});
