import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { deployDualVmSystem } from "../lib/deployment/deploySystem";

describe("LendingRouter", function () {
  async function deployRouterFixture() {
    const [deployer, user] = await ethers.getSigners();
    const deployment = await deployDualVmSystem();
    const { wpas, lendingCore: core } = deployment.contracts as any;

    const wpasAddress = await wpas.getAddress();
    const coreAddress = await core.getAddress();

    const routerFactory = await ethers.getContractFactory("LendingRouter");
    // Cast as any to access contract-specific methods — consistent with test patterns
    // in this codebase (all other tests use `deployment.contracts as any`).
    const router = (await routerFactory.deploy(wpasAddress, coreAddress)) as any;
    await router.waitForDeployment();

    return { deployer, user, wpas, core, router };
  }

  it("depositCollateralFromPAS wraps PAS and deposits collateral in one TX", async function () {
    const { user, core, router } = await loadFixture(deployRouterFixture);

    const depositAmount = ethers.parseEther("1");
    const routerAddress = await router.getAddress();

    const positionBefore = await core.positions(routerAddress);
    expect(positionBefore.collateralAmount).to.equal(0n);

    await expect(router.connect(user).depositCollateralFromPAS({ value: depositAmount }))
      .to.emit(router, "DepositedCollateralFromPAS")
      .withArgs(user.address, depositAmount);

    const positionAfter = await core.positions(routerAddress);
    expect(positionAfter.collateralAmount).to.equal(depositAmount);
  });

  it("reverts on zero-value call", async function () {
    const { user, router } = await loadFixture(deployRouterFixture);

    await expect(router.connect(user).depositCollateralFromPAS({ value: 0n })).to.be.revertedWithCustomError(
      router,
      "ZeroAmount",
    );
  });

  it("multiple calls accumulate collateral for the router address", async function () {
    const { user, core, router } = await loadFixture(deployRouterFixture);

    const routerAddress = await router.getAddress();
    const depositAmount = ethers.parseEther("2");

    await router.connect(user).depositCollateralFromPAS({ value: depositAmount });
    await router.connect(user).depositCollateralFromPAS({ value: depositAmount });

    const position = await core.positions(routerAddress);
    expect(position.collateralAmount).to.equal(depositAmount * 2n);
  });
});
