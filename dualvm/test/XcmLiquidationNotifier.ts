import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Tests for XcmLiquidationNotifier.
 *
 * The XCM precompile (0x00000000000000000000000000000000000a0000) is only
 * available on Polkadot Hub. On a local Hardhat network these tests verify:
 *   1. The contract compiles successfully.
 *   2. The notifyLiquidation function signature is correct.
 *   3. Input validation (empty destination, zero borrower) reverts appropriately.
 *   4. Calls that reach the precompile revert on Hardhat (expected behaviour).
 *
 * Live notifyLiquidation calls are deferred to the deployment-worker.
 */

/** Minimal SCALE-encoded destination MultiLocation (relay chain parent: 0x010100) */
const SAMPLE_DESTINATION = "0x010100";

/** Sample borrower address */
const SAMPLE_BORROWER = "0x1234567890123456789012345678901234567890";

describe("XcmLiquidationNotifier", function () {
  async function deployFixture() {
    const factory = await ethers.getContractFactory("XcmLiquidationNotifier");
    const notifier = await factory.deploy();
    await notifier.waitForDeployment();
    return { notifier };
  }

  it("compiles and deploys successfully", async function () {
    const { notifier } = await loadFixture(deployFixture);
    const address = await notifier.getAddress();
    expect(address).to.be.properAddress;
    const code = await ethers.provider.getCode(address);
    expect(code).to.not.equal("0x");
  });

  it("has notifyLiquidation function with correct signature", async function () {
    const factory = await ethers.getContractFactory("XcmLiquidationNotifier");
    const iface = factory.interface;

    const fragment = iface.getFunction("notifyLiquidation");
    expect(fragment).to.not.be.null;
    expect(fragment!.inputs.length).to.equal(4);
    expect(fragment!.inputs[0].type).to.equal("bytes"); // destination
    expect(fragment!.inputs[1].type).to.equal("address"); // borrower
    expect(fragment!.inputs[2].type).to.equal("uint256"); // debtRepaid
    expect(fragment!.inputs[3].type).to.equal("uint256"); // collateralSeized
  });

  it("reverts with EmptyDestination for empty destination", async function () {
    const { notifier } = await loadFixture(deployFixture);
    await expect(
      notifier.notifyLiquidation("0x", SAMPLE_BORROWER, ethers.parseEther("100"), ethers.parseEther("110")),
    ).to.be.revertedWithCustomError(notifier, "EmptyDestination");
  });

  it("reverts with ZeroBorrower for zero address borrower", async function () {
    const { notifier } = await loadFixture(deployFixture);
    await expect(
      notifier.notifyLiquidation(
        SAMPLE_DESTINATION,
        ethers.ZeroAddress,
        ethers.parseEther("100"),
        ethers.parseEther("110"),
      ),
    ).to.be.revertedWithCustomError(notifier, "ZeroBorrower");
  });

  it("reverts when calling notifyLiquidation on local Hardhat (no precompile)", async function () {
    const { notifier } = await loadFixture(deployFixture);
    // On local Hardhat, the XCM precompile address has no code, so the send() call reverts.
    await expect(
      notifier.notifyLiquidation(
        SAMPLE_DESTINATION,
        SAMPLE_BORROWER,
        ethers.parseEther("100"),
        ethers.parseEther("110"),
      ),
    ).to.be.reverted;
  });

  it("emits LiquidationNotified event on successful send (testnet only — reverts on Hardhat)", async function () {
    const { notifier } = await loadFixture(deployFixture);
    // On testnet, a successful call emits LiquidationNotified.
    // On Hardhat this will revert because the precompile is absent.
    // We verify the event is defined in the ABI.
    const factory = await ethers.getContractFactory("XcmLiquidationNotifier");
    const iface = factory.interface;
    const eventFragment = iface.getEvent("LiquidationNotified");
    expect(eventFragment).to.not.be.null;
    expect(eventFragment!.inputs.length).to.equal(3);
    expect(eventFragment!.inputs[0].name).to.equal("borrower");
    expect(eventFragment!.inputs[1].name).to.equal("debtRepaid");
    expect(eventFragment!.inputs[2].name).to.equal("collateralSeized");
  });
});
