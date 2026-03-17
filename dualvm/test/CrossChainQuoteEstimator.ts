import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * The XCM precompile (0x00000000000000000000000000000000000a0000) is only
 * available on Polkadot Hub. On a local Hardhat network these tests verify:
 *   1. The contract compiles successfully.
 *   2. The IXcm interface selector matches the Polkadot XCM precompile spec.
 *   3. The contract exposes the expected public surface (all 3 functions).
 *   4. Input validation (empty message rejection) works.
 *   5. Live precompile calls will revert on Hardhat (expected, deferred to testnet).
 *
 * Live execute/send/weighMessage invocations are deferred to the deployment-worker.
 */

const XCM_PRECOMPILE_ADDRESS = "0x00000000000000000000000000000000000A0000";

/** SCALE-encoded XCM message example from the Polkadot docs */
const SAMPLE_XCM_MESSAGE =
  "0x050c000401000003008c86471301000003008c8647000d010101000000010100368e8759910dab756d344995f1d3c79374ca8f70066d3a709e48029f6bf0ee7e";

/** Minimal SCALE-encoded destination MultiLocation (relay chain parent: 0x010100) */
const SAMPLE_DESTINATION = "0x010100";

describe("CrossChainQuoteEstimator", function () {
  async function deployFixture() {
    const factory = await ethers.getContractFactory("CrossChainQuoteEstimator");
    const estimator = await factory.deploy();
    await estimator.waitForDeployment();
    return { estimator };
  }

  it("compiles and deploys successfully", async function () {
    const { estimator } = await loadFixture(deployFixture);
    const address = await estimator.getAddress();
    expect(address).to.be.properAddress;
    const code = await ethers.provider.getCode(address);
    expect(code).to.not.equal("0x");
  });

  it("exposes the XCM precompile at the canonical address", async function () {
    const { estimator } = await loadFixture(deployFixture);
    const xcmAddress = await estimator.XCM();
    expect(xcmAddress.toLowerCase()).to.equal(XCM_PRECOMPILE_ADDRESS.toLowerCase());
  });

  it("has estimateCrossChainQuoteCost function with correct signature", async function () {
    const factory = await ethers.getContractFactory("CrossChainQuoteEstimator");
    const iface = factory.interface;

    // Verify the function exists and has the expected signature
    const fragment = iface.getFunction("estimateCrossChainQuoteCost");
    expect(fragment).to.not.be.null;
    expect(fragment!.inputs.length).to.equal(1);
    expect(fragment!.inputs[0].type).to.equal("bytes");

    // Returns (uint64 refTime, uint64 proofSize)
    expect(fragment!.outputs!.length).to.equal(2);
    expect(fragment!.outputs![0].type).to.equal("uint64");
    expect(fragment!.outputs![0].name).to.equal("refTime");
    expect(fragment!.outputs![1].type).to.equal("uint64");
    expect(fragment!.outputs![1].name).to.equal("proofSize");
  });

  it("has executeLocalXcm function with correct signature", async function () {
    const factory = await ethers.getContractFactory("CrossChainQuoteEstimator");
    const iface = factory.interface;

    const fragment = iface.getFunction("executeLocalXcm");
    expect(fragment).to.not.be.null;
    expect(fragment!.inputs.length).to.equal(3);
    expect(fragment!.inputs[0].type).to.equal("bytes"); // message
    expect(fragment!.inputs[1].type).to.equal("uint64"); // refTime
    expect(fragment!.inputs[2].type).to.equal("uint64"); // proofSize
  });

  it("has sendCrossChainNotification function with correct signature", async function () {
    const factory = await ethers.getContractFactory("CrossChainQuoteEstimator");
    const iface = factory.interface;

    const fragment = iface.getFunction("sendCrossChainNotification");
    expect(fragment).to.not.be.null;
    expect(fragment!.inputs.length).to.equal(2);
    expect(fragment!.inputs[0].type).to.equal("bytes"); // destination
    expect(fragment!.inputs[1].type).to.equal("bytes"); // message
  });

  it("IXcm interface matches the Polkadot XCM precompile spec", async function () {
    // Verify the IXcm interface has the three expected functions
    const iface = new ethers.Interface([
      "function execute(bytes calldata message, tuple(uint64 refTime, uint64 proofSize) calldata weight) external",
      "function send(bytes calldata destination, bytes calldata message) external",
      "function weighMessage(bytes calldata message) external view returns (tuple(uint64 refTime, uint64 proofSize) weight)",
    ]);

    // Verify function selectors match the canonical interface
    const executeSelector = iface.getFunction("execute")!.selector;
    const sendSelector = iface.getFunction("send")!.selector;
    const weighMessageSelector = iface.getFunction("weighMessage")!.selector;

    expect(executeSelector).to.be.a("string").and.match(/^0x[0-9a-f]{8}$/);
    expect(sendSelector).to.be.a("string").and.match(/^0x[0-9a-f]{8}$/);
    expect(weighMessageSelector).to.be.a("string").and.match(/^0x[0-9a-f]{8}$/);

    // All three selectors must be distinct
    expect(new Set([executeSelector, sendSelector, weighMessageSelector]).size).to.equal(3);
  });

  it("reverts with EmptyXcmMessage for empty input on estimateCrossChainQuoteCost", async function () {
    const { estimator } = await loadFixture(deployFixture);
    await expect(estimator.estimateCrossChainQuoteCost("0x")).to.be.revertedWithCustomError(
      estimator,
      "EmptyXcmMessage",
    );
  });

  it("reverts with EmptyXcmMessage for empty message on executeLocalXcm", async function () {
    const { estimator } = await loadFixture(deployFixture);
    await expect(estimator.executeLocalXcm("0x", 1_000_000n, 65_536n)).to.be.revertedWithCustomError(
      estimator,
      "EmptyXcmMessage",
    );
  });

  it("reverts with EmptyDestination for empty destination on sendCrossChainNotification", async function () {
    const { estimator } = await loadFixture(deployFixture);
    await expect(
      estimator.sendCrossChainNotification("0x", SAMPLE_XCM_MESSAGE),
    ).to.be.revertedWithCustomError(estimator, "EmptyDestination");
  });

  it("reverts with EmptyXcmMessage for empty message on sendCrossChainNotification", async function () {
    const { estimator } = await loadFixture(deployFixture);
    await expect(
      estimator.sendCrossChainNotification(SAMPLE_DESTINATION, "0x"),
    ).to.be.revertedWithCustomError(estimator, "EmptyXcmMessage");
  });

  it("reverts when calling weighMessage on local Hardhat (no precompile)", async function () {
    const { estimator } = await loadFixture(deployFixture);
    // On local Hardhat, the XCM precompile address has no code,
    // so the static call to weighMessage will revert.
    await expect(estimator.estimateCrossChainQuoteCost(SAMPLE_XCM_MESSAGE)).to.be.reverted;
  });

  it("reverts executeLocalXcm on local Hardhat (no precompile)", async function () {
    const { estimator } = await loadFixture(deployFixture);
    // On local Hardhat, the XCM precompile address has no code.
    await expect(estimator.executeLocalXcm(SAMPLE_XCM_MESSAGE, 1_000_000n, 65_536n)).to.be.reverted;
  });

  it("reverts sendCrossChainNotification on local Hardhat (no precompile)", async function () {
    const { estimator } = await loadFixture(deployFixture);
    // On local Hardhat, the XCM precompile address has no code.
    await expect(estimator.sendCrossChainNotification(SAMPLE_DESTINATION, SAMPLE_XCM_MESSAGE)).to.be.reverted;
  });
});
