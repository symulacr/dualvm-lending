import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { ethers } from "hardhat";

const abiCoder = AbiCoder.defaultAbiCoder();
const ECHO_INPUT = "0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000";
const QUOTE_INPUT = {
  utilizationBps: 5_000n,
  collateralRatioBps: 20_000n,
  oracleAgeSeconds: 60n,
  oracleFresh: true,
};
const PVM_TARGET_ID = keccak256(toUtf8Bytes("PvmQuoteProbeTarget"));
const DIRECT_SYNC_MODE = 1;

function expectedInputHash() {
  return keccak256(abiCoder.encode(["uint256", "uint256", "uint256", "bool"], Object.values(QUOTE_INPUT)));
}

function expectedQuoteHash() {
  return keccak256(abiCoder.encode(["uint256", "uint256", "uint256"], [700n, 7_500n, 8_500n]));
}

describe("DualVM probe contracts", function () {
  async function deployFixture() {
    const pvmQuoteProbe = await (await ethers.getContractFactory("PvmQuoteProbe")).deploy();
    await pvmQuoteProbe.waitForDeployment();

    const quoteCaller = await (
      await ethers.getContractFactory("RevmQuoteCallerProbe")
    ).deploy(await pvmQuoteProbe.getAddress(), PVM_TARGET_ID, DIRECT_SYNC_MODE);
    await quoteCaller.waitForDeployment();

    const callbackReceiver = await (await ethers.getContractFactory("RevmCallbackReceiver")).deploy();
    await callbackReceiver.waitForDeployment();

    const pvmCallbackProbe = await (await ethers.getContractFactory("PvmCallbackProbe")).deploy();
    await pvmCallbackProbe.waitForDeployment();

    const roundTripSettlement = await (
      await ethers.getContractFactory("RevmRoundTripSettlementProbe")
    ).deploy(await quoteCaller.getAddress());
    await roundTripSettlement.waitForDeployment();

    return {
      pvmQuoteProbe,
      quoteCaller,
      callbackReceiver,
      pvmCallbackProbe,
      roundTripSettlement,
    };
  }

  it("stores exact echo and deterministic quote results on-chain", async function () {
    const { quoteCaller } = await loadFixture(deployFixture);

    await expect(quoteCaller.runEcho(ECHO_INPUT)).to.emit(quoteCaller, "ProbeEchoed");
    expect(await quoteCaller.lastEchoInput()).to.equal(ECHO_INPUT);
    expect(await quoteCaller.lastEchoOutput()).to.equal(ECHO_INPUT);

    await expect(quoteCaller.runQuote(QUOTE_INPUT)).to.emit(quoteCaller, "ProbeQuoted");
    expect(await quoteCaller.callCount()).to.equal(1n);
    expect(await quoteCaller.lastInputHash()).to.equal(expectedInputHash());
    expect(await quoteCaller.lastResultHash()).to.equal(expectedQuoteHash());
    expect(await quoteCaller.lastBorrowRateBps()).to.equal(700n);
    expect(await quoteCaller.lastMaxLtvBps()).to.equal(7_500n);
    expect(await quoteCaller.lastLiquidationThresholdBps()).to.equal(8_500n);
  });

  it("records a PVM-originated callback in the REVM receiver state", async function () {
    const { callbackReceiver, pvmCallbackProbe } = await loadFixture(deployFixture);

    const callId = keccak256(toUtf8Bytes("dualvm-callback-test"));
    await expect(pvmCallbackProbe.callbackFingerprint(await callbackReceiver.getAddress(), callId)).to.emit(
      callbackReceiver,
      "CallbackReceived",
    );

    expect(await callbackReceiver.seenCallIds(callId)).to.equal(true);
    expect(await callbackReceiver.lastCallId()).to.equal(callId);
    expect(await callbackReceiver.lastA()).to.equal(1n);
    expect(await callbackReceiver.lastB()).to.equal(2n);
  });

  it("stores settlement state that depends on the quote adapter output", async function () {
    const { roundTripSettlement } = await loadFixture(deployFixture);

    await expect(roundTripSettlement.settleBorrow(QUOTE_INPUT, 1_000n)).to.emit(roundTripSettlement, "RoundTripSettled");

    expect(await roundTripSettlement.principalDebt()).to.equal(1_070n);
    expect(await roundTripSettlement.lastBorrowRateBps()).to.equal(700n);
    expect(await roundTripSettlement.lastMaxLtvBps()).to.equal(7_500n);
    expect(await roundTripSettlement.lastLiquidationThresholdBps()).to.equal(8_500n);
    expect(await roundTripSettlement.lastQuoteHash()).to.equal(expectedQuoteHash());
    expect(await roundTripSettlement.settlementCount()).to.equal(1n);

    await roundTripSettlement.settleLiquidationCheck(QUOTE_INPUT);
    expect(await roundTripSettlement.settlementCount()).to.equal(2n);
  });
});
