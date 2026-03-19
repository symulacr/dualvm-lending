import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Unit tests for XcmInbox.
 *
 * Verifies:
 *  - receiveReceipt records the correlationId and emits ReceiptReceived
 *  - Duplicate correlationId reverts with DuplicateCorrelationId
 *  - hasProcessed returns the correct state before and after receipt
 *  - Multiple distinct correlationIds are tracked independently
 *  - Zero bytes32 is a valid correlationId (no special-casing)
 *  - Unauthorized callers are rejected with AccessManagedUnauthorized
 */
describe("XcmInbox", function () {
  async function deployFixture() {
    // unauthorized is a signer that is never granted the relay caller role
    const [deployer, sender, other, unauthorized] = await ethers.getSigners();

    // AccessManager — deployer is admin
    const accessManager = (await (
      await ethers.getContractFactory("DualVMAccessManager")
    ).deploy(deployer.address)) as any;
    await accessManager.waitForDeployment();

    // Deploy XcmInbox with the AccessManager as authority
    const factory = await ethers.getContractFactory("XcmInbox");
    // Cast as any to access contract-specific methods — consistent with test patterns
    // throughout this codebase (all other tests use `deployment.contracts as any`).
    const inbox = (await factory.deploy(await accessManager.getAddress())) as any;
    await inbox.waitForDeployment();

    // Define RELAY_CALLER_ROLE (arbitrary ID) and grant it to sender + other.
    // `unauthorized` is intentionally left without this role so access-control
    // tests can verify that unkeyholded callers are rejected.
    const RELAY_CALLER_ROLE = 99n;
    await (await accessManager.labelRole(RELAY_CALLER_ROLE, "RELAY_CALLER")).wait();
    await (await accessManager.grantRole(RELAY_CALLER_ROLE, sender.address, 0)).wait();
    await (await accessManager.grantRole(RELAY_CALLER_ROLE, other.address, 0)).wait();

    const receiveReceiptSelector = inbox.interface.getFunction("receiveReceipt").selector;
    await (
      await accessManager.setTargetFunctionRole(
        await inbox.getAddress(),
        [receiveReceiptSelector],
        RELAY_CALLER_ROLE,
      )
    ).wait();

    return { inbox, deployer, sender, other, unauthorized, accessManager };
  }

  // Sample correlation IDs
  const ID_A = ethers.id("liquidation-abc-123");
  const ID_B = ethers.id("liquidation-def-456");
  const SAMPLE_DATA = ethers.toUtf8Bytes("proof-payload-v1");

  // -------------------------------------------------------------------------
  // receiveReceipt — happy path
  // -------------------------------------------------------------------------

  it("records correlationId and emits ReceiptReceived", async function () {
    const { inbox, sender } = await loadFixture(deployFixture);

    await expect(inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA))
      .to.emit(inbox, "ReceiptReceived")
      .withArgs(ID_A, sender.address, SAMPLE_DATA);

    expect(await inbox.processed(ID_A)).to.equal(true);
  });

  it("sets processed mapping to true after receipt", async function () {
    const { inbox, sender } = await loadFixture(deployFixture);

    expect(await inbox.processed(ID_A)).to.equal(false);
    await inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA);
    expect(await inbox.processed(ID_A)).to.equal(true);
  });

  it("accepts empty data payload", async function () {
    const { inbox, sender } = await loadFixture(deployFixture);

    await expect(inbox.connect(sender).receiveReceipt(ID_A, "0x"))
      .to.emit(inbox, "ReceiptReceived")
      .withArgs(ID_A, sender.address, "0x");
  });

  it("tracks multiple distinct correlationIds independently", async function () {
    const { inbox, sender } = await loadFixture(deployFixture);

    await inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA);
    await inbox.connect(sender).receiveReceipt(ID_B, SAMPLE_DATA);

    expect(await inbox.processed(ID_A)).to.equal(true);
    expect(await inbox.processed(ID_B)).to.equal(true);
  });

  // -------------------------------------------------------------------------
  // receiveReceipt — duplicate rejection
  // -------------------------------------------------------------------------

  it("reverts with DuplicateCorrelationId on second call with same ID", async function () {
    const { inbox, sender } = await loadFixture(deployFixture);

    await inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA);

    await expect(inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA)).to.be.revertedWithCustomError(
      inbox,
      "DuplicateCorrelationId",
    );
  });

  it("reverts with correct correlationId in custom error", async function () {
    const { inbox, sender } = await loadFixture(deployFixture);

    await inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA);

    await expect(inbox.connect(sender).receiveReceipt(ID_A, "0x"))
      .to.be.revertedWithCustomError(inbox, "DuplicateCorrelationId")
      .withArgs(ID_A);
  });

  it("rejects duplicate even from a different sender", async function () {
    const { inbox, sender, other } = await loadFixture(deployFixture);

    await inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA);

    await expect(inbox.connect(other).receiveReceipt(ID_A, SAMPLE_DATA)).to.be.revertedWithCustomError(
      inbox,
      "DuplicateCorrelationId",
    );
  });

  // -------------------------------------------------------------------------
  // hasProcessed view
  // -------------------------------------------------------------------------

  it("hasProcessed returns false before receipt", async function () {
    const { inbox } = await loadFixture(deployFixture);

    expect(await inbox.hasProcessed(ID_A)).to.equal(false);
  });

  it("hasProcessed returns true after receipt", async function () {
    const { inbox, sender } = await loadFixture(deployFixture);

    await inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA);
    expect(await inbox.hasProcessed(ID_A)).to.equal(true);
  });

  it("hasProcessed for unrelated ID remains false", async function () {
    const { inbox, sender } = await loadFixture(deployFixture);

    await inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA);
    expect(await inbox.hasProcessed(ID_B)).to.equal(false);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("accepts zero bytes32 as a valid correlationId", async function () {
    const { inbox, sender } = await loadFixture(deployFixture);
    const ZERO_ID = ethers.ZeroHash;

    await expect(inbox.connect(sender).receiveReceipt(ZERO_ID, SAMPLE_DATA))
      .to.emit(inbox, "ReceiptReceived")
      .withArgs(ZERO_ID, sender.address, SAMPLE_DATA);

    expect(await inbox.hasProcessed(ZERO_ID)).to.equal(true);
  });

  it("second ID processed after first rejected duplicate", async function () {
    const { inbox, sender } = await loadFixture(deployFixture);

    await inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA);

    // Duplicate of A reverts
    await expect(inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA)).to.be.revertedWithCustomError(
      inbox,
      "DuplicateCorrelationId",
    );

    // B can still be processed
    await expect(inbox.connect(sender).receiveReceipt(ID_B, SAMPLE_DATA))
      .to.emit(inbox, "ReceiptReceived")
      .withArgs(ID_B, sender.address, SAMPLE_DATA);
  });

  // -------------------------------------------------------------------------
  // Access control
  // -------------------------------------------------------------------------

  it("reverts with AccessManagedUnauthorized when called by an unauthorized address", async function () {
    // `unauthorized` was never granted RELAY_CALLER_ROLE, so receiveReceipt must revert
    const { inbox, unauthorized } = await loadFixture(deployFixture);

    await expect(inbox.connect(unauthorized).receiveReceipt(ID_A, SAMPLE_DATA)).to.be.revertedWithCustomError(
      inbox,
      "AccessManagedUnauthorized",
    );
  });

  it("authorised relay caller can submit a receipt after access is wired", async function () {
    // `sender` was granted RELAY_CALLER_ROLE in deployFixture
    const { inbox, sender } = await loadFixture(deployFixture);

    await expect(inbox.connect(sender).receiveReceipt(ID_A, SAMPLE_DATA))
      .to.emit(inbox, "ReceiptReceived")
      .withArgs(ID_A, sender.address, SAMPLE_DATA);

    expect(await inbox.hasProcessed(ID_A)).to.equal(true);
  });
});
