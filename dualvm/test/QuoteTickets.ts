import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { CORE_DEFAULTS, ORACLE_CIRCUIT_BREAKER_DEFAULTS, WAD } from "../lib/config/marketConfig";
import { deployDualVmSystem } from "../lib/deployment/deploySystem";

describe("Quote ticket and epoch flow", function () {
  async function deployFixture() {
    const [deployer, lender, borrower] = await ethers.getSigners();
    const deployment = await deployDualVmSystem();
    const { wpas, usdc, debtPool, oracle, lendingCore, riskEngine } = deployment.contracts as any;

    const poolLiquidity = 50_000n * WAD;
    const collateralAmount = 20n * WAD;
    await usdc.mint(lender.address, poolLiquidity);
    await usdc.connect(lender).approve(await debtPool.getAddress(), ethers.MaxUint256);
    await debtPool.connect(lender).deposit(poolLiquidity, lender.address);

    await wpas.connect(borrower).deposit({ value: collateralAmount });
    await wpas.connect(borrower).approve(await lendingCore.getAddress(), ethers.MaxUint256);
    await lendingCore.connect(borrower).depositCollateral(collateralAmount);

    return {
      deployer,
      lender,
      borrower,
      oracle,
      lendingCore,
      riskEngine,
      debtPool,
      collateralAmount,
    };
  }

  it("publishes and reuses deterministic quote tickets through the adapter", async function () {
    const { borrower, lendingCore, riskEngine } = await loadFixture(deployFixture);
    const borrowAmount = 5_000n * WAD;

    const [rawContext, rawInput] = await Promise.all([
      lendingCore.currentQuoteContext(),
      lendingCore.projectedBorrowQuoteInput(borrower.address, borrowAmount),
    ]);
    const context = {
      oracleEpoch: rawContext.oracleEpoch,
      configEpoch: rawContext.configEpoch,
      oracleStateHash: rawContext.oracleStateHash,
      configHash: rawContext.configHash,
    };
    const input = {
      utilizationBps: rawInput.utilizationBps,
      collateralRatioBps: rawInput.collateralRatioBps,
      oracleAgeSeconds: rawInput.oracleAgeSeconds,
      oracleFresh: rawInput.oracleFresh,
    };
    const ticketId = await riskEngine.quoteTicketId(context, input);

    await expect(lendingCore.publishProjectedBorrowQuoteTicket(borrower.address, borrowAmount))
      .to.emit(riskEngine, "QuoteTicketPublished")
      .withArgs(ticketId, anyValue, anyValue, context.oracleEpoch, context.configEpoch, context.oracleStateHash, context.configHash, lendingCore.target);

    const ticket = await riskEngine.getQuoteTicket(ticketId);
    expect(ticket.oracleEpoch).to.equal(context.oracleEpoch);
    expect(ticket.configEpoch).to.equal(context.configEpoch);
    expect(ticket.borrowRateBps).to.equal(300n);
    expect(ticket.maxLtvBps).to.equal(7_500n);
    expect(ticket.liquidationThresholdBps).to.equal(8_500n);

    const quote = await riskEngine.quote(input);
    const cachedQuote = await riskEngine.quoteViaTicket.staticCall(context, input);
    expect(cachedQuote.borrowRateBps).to.equal(quote.borrowRateBps);
    expect(cachedQuote.maxLtvBps).to.equal(quote.maxLtvBps);
    expect(cachedQuote.liquidationThresholdBps).to.equal(quote.liquidationThresholdBps);
  });

  it("auto-publishes a borrow ticket on the hot path when none exists yet", async function () {
    const { borrower, lendingCore, riskEngine } = await loadFixture(deployFixture);
    const borrowAmount = 5_000n * WAD;

    const [rawContextBefore, rawInputBefore] = await Promise.all([
      lendingCore.currentQuoteContext(),
      lendingCore.projectedBorrowQuoteInput(borrower.address, borrowAmount),
    ]);
    const contextBefore = {
      oracleEpoch: rawContextBefore.oracleEpoch,
      configEpoch: rawContextBefore.configEpoch,
      oracleStateHash: rawContextBefore.oracleStateHash,
      configHash: rawContextBefore.configHash,
    };
    const inputBefore = {
      utilizationBps: rawInputBefore.utilizationBps,
      collateralRatioBps: rawInputBefore.collateralRatioBps,
      oracleAgeSeconds: rawInputBefore.oracleAgeSeconds,
      oracleFresh: rawInputBefore.oracleFresh,
    };
    const ticketId = await riskEngine.quoteTicketId(contextBefore, inputBefore);

    await expect(lendingCore.connect(borrower).borrow(borrowAmount)).to.emit(riskEngine, "QuoteTicketPublished");

    const ticket = await riskEngine.getQuoteTicket(ticketId);
    expect(ticket.borrowRateBps).to.equal(300n);
  });

  it("increments oracleEpoch and changes quote context after oracle updates", async function () {
    const { oracle, lendingCore, borrower } = await loadFixture(deployFixture);

    expect(await oracle.oracleEpoch()).to.equal(1n);
    const contextBefore = await lendingCore.currentQuoteContext();
    const inputBefore = await lendingCore.currentQuoteInput(borrower.address);

    await oracle.setCircuitBreaker(
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      10_000n,
    );
    await oracle.setPrice(900n * WAD);

    expect(await oracle.oracleEpoch()).to.equal(3n);
    const contextAfter = await lendingCore.currentQuoteContext();
    const inputAfter = await lendingCore.currentQuoteInput(borrower.address);

    expect(contextAfter.oracleEpoch).to.equal(3n);
    expect(contextAfter.oracleStateHash).to.not.equal(contextBefore.oracleStateHash);
    expect(inputAfter.oracleFresh).to.equal(inputBefore.oracleFresh);
    expect(contextAfter.oracleEpoch).to.not.equal(contextBefore.oracleEpoch);
  });

  it("keeps config epoch and config hash stable within one immutable market version", async function () {
    const { borrower, lendingCore } = await loadFixture(deployFixture);

    const configEpochBefore = await lendingCore.configEpoch();
    const configHashBefore = await lendingCore.currentRiskConfigHash();

    await lendingCore.publishCurrentQuoteTicket(borrower.address);

    expect(await lendingCore.configEpoch()).to.equal(configEpochBefore);
    expect(await lendingCore.currentRiskConfigHash()).to.equal(configHashBefore);
  });
});
