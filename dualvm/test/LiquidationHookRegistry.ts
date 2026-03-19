import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Unit tests for LiquidationHookRegistry.
 *
 * Covers:
 *  - registerHook: stores handler, emits HookRegistered, rejects zero address
 *  - deregisterHook: removes handler, emits HookDeregistered, rejects missing key
 *  - getHook: returns correct handler before/after register/deregister
 *  - executeHooks: calls handler, emits HookExecuted
 *  - executeHooks: no-op when no handler is registered
 *  - executeHooks: emits HookFailed when handler reverts (never reverts caller)
 *  - notifyLiquidation: dispatches to DEFAULT_HOOK_TYPE handler (ILiquidationNotifier impl)
 *  - register/execute/deregister lifecycle cycle
 *  - XcmNotifierAdapter: bridges 3-arg interface to 4-arg XcmLiquidationNotifier
 */

const HOOK_TYPE_A = ethers.id("LIQUIDATION");
const HOOK_TYPE_B = ethers.id("OTHER_HOOK");
const WAD = 10n ** 18n;

// -----------------------------------------------------------------------
// Fixture
// -----------------------------------------------------------------------

async function deployFixture() {
  const [deployer, caller, outsider] = await ethers.getSigners();

  // AccessManager — deployer is admin
  const accessManager = (await (
    await ethers.getContractFactory("DualVMAccessManager")
  ).deploy(deployer.address)) as any;
  await accessManager.waitForDeployment();

  // Registry
  const registry = (await (
    await ethers.getContractFactory("LiquidationHookRegistry")
  ).deploy(await accessManager.getAddress())) as any;
  await registry.waitForDeployment();

  // Good mock handler (does not revert)
  const goodMock = (await (
    await ethers.getContractFactory("MockLiquidationNotifier")
  ).deploy(false)) as any;
  await goodMock.waitForDeployment();

  // Bad mock handler (always reverts)
  const badMock = (await (
    await ethers.getContractFactory("MockLiquidationNotifier")
  ).deploy(true)) as any;
  await badMock.waitForDeployment();

  // XcmNotifierAdapter (wraps a fresh XcmLiquidationNotifier)
  const xcmNotifier = (await (
    await ethers.getContractFactory("XcmLiquidationNotifier")
  ).deploy()) as any;
  await xcmNotifier.waitForDeployment();

  const xcmAdapter = (await (
    await ethers.getContractFactory("XcmNotifierAdapter")
  ).deploy(await xcmNotifier.getAddress())) as any;
  await xcmAdapter.waitForDeployment();

  return {
    deployer,
    caller,
    outsider,
    accessManager,
    registry,
    goodMock,
    badMock,
    xcmNotifier,
    xcmAdapter,
  };
}

// -----------------------------------------------------------------------
// DEFAULT_HOOK_TYPE constant
// -----------------------------------------------------------------------

describe("LiquidationHookRegistry", function () {
  it("DEFAULT_HOOK_TYPE equals keccak256('LIQUIDATION')", async function () {
    const { registry } = await loadFixture(deployFixture);
    const expected = ethers.id("LIQUIDATION");
    expect(await registry.DEFAULT_HOOK_TYPE()).to.equal(expected);
  });

  // -----------------------------------------------------------------------
  // registerHook
  // -----------------------------------------------------------------------

  describe("registerHook", function () {
    it("registers a handler and emits HookRegistered", async function () {
      const { deployer, registry, goodMock } = await loadFixture(deployFixture);
      const handlerAddr = await goodMock.getAddress();

      await expect(registry.connect(deployer).registerHook(HOOK_TYPE_A, handlerAddr))
        .to.emit(registry, "HookRegistered")
        .withArgs(HOOK_TYPE_A, handlerAddr);

      expect(await registry.getHook(HOOK_TYPE_A)).to.equal(handlerAddr);
    });

    it("overwrites an existing handler silently", async function () {
      const { deployer, registry, goodMock, badMock } = await loadFixture(deployFixture);

      await registry.connect(deployer).registerHook(HOOK_TYPE_A, await goodMock.getAddress());
      await registry.connect(deployer).registerHook(HOOK_TYPE_A, await badMock.getAddress());

      expect(await registry.getHook(HOOK_TYPE_A)).to.equal(await badMock.getAddress());
    });

    it("reverts with ZeroHandlerAddress for address(0)", async function () {
      const { deployer, registry } = await loadFixture(deployFixture);

      await expect(
        registry.connect(deployer).registerHook(HOOK_TYPE_A, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "ZeroHandlerAddress");
    });

    it("reverts when called by non-admin (access control)", async function () {
      const { outsider, registry, goodMock } = await loadFixture(deployFixture);

      await expect(
        registry.connect(outsider).registerHook(HOOK_TYPE_A, await goodMock.getAddress()),
      ).to.be.revertedWithCustomError(registry, "AccessManagedUnauthorized");
    });
  });

  // -----------------------------------------------------------------------
  // deregisterHook
  // -----------------------------------------------------------------------

  describe("deregisterHook", function () {
    it("removes handler and emits HookDeregistered", async function () {
      const { deployer, registry, goodMock } = await loadFixture(deployFixture);
      const handlerAddr = await goodMock.getAddress();

      await registry.connect(deployer).registerHook(HOOK_TYPE_A, handlerAddr);

      await expect(registry.connect(deployer).deregisterHook(HOOK_TYPE_A))
        .to.emit(registry, "HookDeregistered")
        .withArgs(HOOK_TYPE_A, handlerAddr);

      expect(await registry.getHook(HOOK_TYPE_A)).to.equal(ethers.ZeroAddress);
    });

    it("reverts with HookNotRegistered when no handler set", async function () {
      const { deployer, registry } = await loadFixture(deployFixture);

      await expect(registry.connect(deployer).deregisterHook(HOOK_TYPE_A))
        .to.be.revertedWithCustomError(registry, "HookNotRegistered")
        .withArgs(HOOK_TYPE_A);
    });

    it("reverts when called by non-admin (access control)", async function () {
      const { deployer, outsider, registry, goodMock } = await loadFixture(deployFixture);

      await registry.connect(deployer).registerHook(HOOK_TYPE_A, await goodMock.getAddress());

      await expect(registry.connect(outsider).deregisterHook(HOOK_TYPE_A)).to.be.revertedWithCustomError(
        registry,
        "AccessManagedUnauthorized",
      );
    });
  });

  // -----------------------------------------------------------------------
  // getHook
  // -----------------------------------------------------------------------

  describe("getHook", function () {
    it("returns address(0) when no handler registered", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.getHook(HOOK_TYPE_A)).to.equal(ethers.ZeroAddress);
    });

    it("returns registered handler address", async function () {
      const { deployer, registry, goodMock } = await loadFixture(deployFixture);
      const handlerAddr = await goodMock.getAddress();
      await registry.connect(deployer).registerHook(HOOK_TYPE_A, handlerAddr);
      expect(await registry.getHook(HOOK_TYPE_A)).to.equal(handlerAddr);
    });

    it("returns address(0) after deregistration", async function () {
      const { deployer, registry, goodMock } = await loadFixture(deployFixture);
      await registry.connect(deployer).registerHook(HOOK_TYPE_A, await goodMock.getAddress());
      await registry.connect(deployer).deregisterHook(HOOK_TYPE_A);
      expect(await registry.getHook(HOOK_TYPE_A)).to.equal(ethers.ZeroAddress);
    });

    it("different hookTypes are independent", async function () {
      const { deployer, registry, goodMock, badMock } = await loadFixture(deployFixture);

      await registry.connect(deployer).registerHook(HOOK_TYPE_A, await goodMock.getAddress());
      await registry.connect(deployer).registerHook(HOOK_TYPE_B, await badMock.getAddress());

      expect(await registry.getHook(HOOK_TYPE_A)).to.equal(await goodMock.getAddress());
      expect(await registry.getHook(HOOK_TYPE_B)).to.equal(await badMock.getAddress());
    });
  });

  // -----------------------------------------------------------------------
  // executeHooks
  // -----------------------------------------------------------------------

  describe("executeHooks", function () {
    const borrower = "0x1234567890123456789012345678901234567890";
    const debtRepaid = 100n * WAD;
    const collateralSeized = 110n * WAD;

    function encode(b: string, d: bigint, c: bigint): string {
      return ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256", "uint256"], [b, d, c]);
    }

    it("no-op when no handler is registered (does not revert)", async function () {
      const { registry } = await loadFixture(deployFixture);
      const data = encode(borrower, debtRepaid, collateralSeized);
      await expect(registry.executeHooks(HOOK_TYPE_A, data)).to.not.be.reverted;
    });

    it("calls handler and emits HookExecuted on success", async function () {
      const { deployer, registry, goodMock } = await loadFixture(deployFixture);
      const handlerAddr = await goodMock.getAddress();
      await registry.connect(deployer).registerHook(HOOK_TYPE_A, handlerAddr);

      const data = encode(borrower, debtRepaid, collateralSeized);

      await expect(registry.executeHooks(HOOK_TYPE_A, data))
        .to.emit(registry, "HookExecuted")
        .withArgs(HOOK_TYPE_A, handlerAddr);
    });

    it("handler receives correct arguments", async function () {
      const { deployer, registry, goodMock } = await loadFixture(deployFixture);
      await registry.connect(deployer).registerHook(HOOK_TYPE_A, await goodMock.getAddress());

      const data = encode(borrower, debtRepaid, collateralSeized);
      await registry.executeHooks(HOOK_TYPE_A, data);

      expect(await goodMock.lastBorrower()).to.equal(borrower);
      expect(await goodMock.lastDebtRepaid()).to.equal(debtRepaid);
      expect(await goodMock.lastCollateralSeized()).to.equal(collateralSeized);
      expect(await goodMock.callCount()).to.equal(1n);
    });

    it("emits HookFailed when handler reverts (does not revert caller)", async function () {
      const { deployer, registry, badMock } = await loadFixture(deployFixture);
      const handlerAddr = await badMock.getAddress();
      await registry.connect(deployer).registerHook(HOOK_TYPE_A, handlerAddr);

      const data = encode(borrower, debtRepaid, collateralSeized);

      await expect(registry.executeHooks(HOOK_TYPE_A, data))
        .to.emit(registry, "HookFailed")
        .withArgs(HOOK_TYPE_A, handlerAddr, (reason: string) => reason.length > 0);
    });

    it("HookFailed is emitted and tx does not revert despite handler reverting", async function () {
      const { deployer, registry, badMock } = await loadFixture(deployFixture);
      await registry.connect(deployer).registerHook(HOOK_TYPE_A, await badMock.getAddress());

      const data = encode(borrower, debtRepaid, collateralSeized);
      await expect(registry.executeHooks(HOOK_TYPE_A, data)).to.not.be.reverted;
    });

    it("executeHooks on unknown type is no-op (different hookType)", async function () {
      const { deployer, registry, goodMock } = await loadFixture(deployFixture);
      await registry.connect(deployer).registerHook(HOOK_TYPE_A, await goodMock.getAddress());

      const data = encode(borrower, debtRepaid, collateralSeized);
      // HOOK_TYPE_B has no handler — should be silent
      await expect(registry.executeHooks(HOOK_TYPE_B, data)).to.not.be.reverted;
      expect(await goodMock.callCount()).to.equal(0n);
    });
  });

  // -----------------------------------------------------------------------
  // notifyLiquidation (ILiquidationNotifier implementation)
  // -----------------------------------------------------------------------

  describe("notifyLiquidation (ILiquidationNotifier)", function () {
    // Use a properly checksummed address (compute from lowercase)
    const borrower = ethers.getAddress("0xaabbccddeeff001122334455aabbccddeeff0011");
    const debtRepaid = 200n * WAD;
    const collateralSeized = 220n * WAD;

    it("dispatches to DEFAULT_HOOK_TYPE handler when registered", async function () {
      const { deployer, registry, goodMock } = await loadFixture(deployFixture);

      // Register goodMock for DEFAULT_HOOK_TYPE (keccak256("LIQUIDATION"))
      const defaultType = await registry.DEFAULT_HOOK_TYPE();
      await registry.connect(deployer).registerHook(defaultType, await goodMock.getAddress());

      await expect(registry.notifyLiquidation(borrower, debtRepaid, collateralSeized))
        .to.emit(registry, "HookExecuted")
        .withArgs(defaultType, await goodMock.getAddress());

      expect(await goodMock.lastBorrower()).to.equal(borrower);
      expect(await goodMock.lastDebtRepaid()).to.equal(debtRepaid);
      expect(await goodMock.lastCollateralSeized()).to.equal(collateralSeized);
    });

    it("does not revert when no DEFAULT_HOOK_TYPE handler is set", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.notifyLiquidation(borrower, debtRepaid, collateralSeized)).to.not.be.reverted;
    });

    it("does not revert when handler reverts", async function () {
      const { deployer, registry, badMock } = await loadFixture(deployFixture);
      const defaultType = await registry.DEFAULT_HOOK_TYPE();
      await registry.connect(deployer).registerHook(defaultType, await badMock.getAddress());

      await expect(registry.notifyLiquidation(borrower, debtRepaid, collateralSeized)).to.not.be.reverted;
    });
  });

  // -----------------------------------------------------------------------
  // Register / execute / deregister lifecycle
  // -----------------------------------------------------------------------

  describe("register → execute → deregister cycle", function () {
    const borrower = ethers.getAddress("0xcafecafecafecafecafecafecafecafecafecafe");
    const debtRepaid = 500n * WAD;
    const collateralSeized = 550n * WAD;

    it("full cycle: hook fires when registered, silent after deregistration", async function () {
      const { deployer, registry, goodMock } = await loadFixture(deployFixture);
      const handlerAddr = await goodMock.getAddress();
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [borrower, debtRepaid, collateralSeized],
      );

      // 1. Register
      await registry.connect(deployer).registerHook(HOOK_TYPE_A, handlerAddr);

      // 2. Execute — hook should fire
      await expect(registry.executeHooks(HOOK_TYPE_A, data))
        .to.emit(registry, "HookExecuted")
        .withArgs(HOOK_TYPE_A, handlerAddr);
      expect(await goodMock.callCount()).to.equal(1n);

      // 3. Deregister
      await registry.connect(deployer).deregisterHook(HOOK_TYPE_A);

      // 4. Execute again — no handler, no revert, no call
      await expect(registry.executeHooks(HOOK_TYPE_A, data)).to.not.be.reverted;
      // callCount unchanged
      expect(await goodMock.callCount()).to.equal(1n);
    });
  });

  // -----------------------------------------------------------------------
  // XcmNotifierAdapter
  // -----------------------------------------------------------------------

  describe("XcmNotifierAdapter", function () {
    it("deploys with correct xcmNotifier reference", async function () {
      const { xcmAdapter, xcmNotifier } = await loadFixture(deployFixture);
      expect(await xcmAdapter.xcmNotifier()).to.equal(await xcmNotifier.getAddress());
    });

    it("RELAY_DESTINATION is 0x050100", async function () {
      const { xcmAdapter } = await loadFixture(deployFixture);
      expect(await xcmAdapter.RELAY_DESTINATION()).to.equal("0x050100");
    });

    it("implements ILiquidationNotifier (3-arg) interface", async function () {
      const factory = await ethers.getContractFactory("XcmNotifierAdapter");
      const iface = factory.interface;
      const fn = iface.getFunction("notifyLiquidation");
      expect(fn).to.not.be.null;
      expect(fn!.inputs.length).to.equal(3);
      expect(fn!.inputs[0].type).to.equal("address");
      expect(fn!.inputs[1].type).to.equal("uint256");
      expect(fn!.inputs[2].type).to.equal("uint256");
    });

    it("notifyLiquidation reverts on local Hardhat (XCM precompile absent)", async function () {
      const { xcmAdapter } = await loadFixture(deployFixture);
      // On Hardhat, the XCM precompile at 0x000...0A0000 has no code → call reverts
      await expect(
        xcmAdapter.notifyLiquidation(
          "0x1234567890123456789012345678901234567890",
          ethers.parseEther("100"),
          ethers.parseEther("110"),
        ),
      ).to.be.reverted;
    });

    it("can be registered in LiquidationHookRegistry as a handler", async function () {
      const { deployer, registry, xcmAdapter } = await loadFixture(deployFixture);
      const adapterAddr = await xcmAdapter.getAddress();
      const defaultType = await registry.DEFAULT_HOOK_TYPE();

      await expect(registry.connect(deployer).registerHook(defaultType, adapterAddr))
        .to.emit(registry, "HookRegistered")
        .withArgs(defaultType, adapterAddr);

      expect(await registry.getHook(defaultType)).to.equal(adapterAddr);
    });
  });
});
