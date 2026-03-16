import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { ROLE_IDS, WAD } from "../lib/config/marketConfig";
import { deployDualVmSystem } from "../lib/deployment/deploySystem";
import { deployMarketVersion } from "../lib/deployment/deployMarketVersion";

async function selector(contract: any, name: string) {
  const fragment = contract.interface.getFunction(name);
  if (!fragment) throw new Error(`Missing selector for ${name}`);
  return fragment.selector;
}

describe("MarketMigrationCoordinator", function () {
  async function deployFixture() {
    const [deployer, lender, borrower] = await ethers.getSigners();
    const deployment = await deployDualVmSystem();
    const { accessManager, wpas, usdc, debtPool, lendingCore, marketRegistry } = deployment.contracts as any;

    const coordinatorFactory = await ethers.getContractFactory("MarketMigrationCoordinator");
    const migrationCoordinator = (await coordinatorFactory.deploy(
      await accessManager.getAddress(),
      await marketRegistry.getAddress(),
    )) as any;
    await migrationCoordinator.waitForDeployment();

    await accessManager.labelRole(ROLE_IDS.MIGRATION, "MIGRATION_ROLE");
    await accessManager.grantRole(ROLE_IDS.MIGRATION, await migrationCoordinator.getAddress(), 0);
    await accessManager.setTargetFunctionRole(
      await lendingCore.getAddress(),
      [await selector(lendingCore, "exportPositionForMigration"), await selector(lendingCore, "importMigratedPosition")],
      ROLE_IDS.MIGRATION,
    );

    const nextVersion = await deployMarketVersion({
      deployer,
      authority: await accessManager.getAddress(),
      collateralAsset: await wpas.getAddress(),
      debtAsset: await usdc.getAddress(),
    });

    await accessManager.setTargetFunctionRole(
      await nextVersion.lendingCore.getAddress(),
      [await selector(nextVersion.lendingCore, "exportPositionForMigration"), await selector(nextVersion.lendingCore, "importMigratedPosition")],
      ROLE_IDS.MIGRATION,
    );
    await marketRegistry.registerVersion(
      await nextVersion.lendingCore.getAddress(),
      await nextVersion.debtPool.getAddress(),
      await nextVersion.oracle.getAddress(),
      await nextVersion.riskEngine.getAddress(),
    );
    await marketRegistry.activateVersion(2n);

    const poolLiquidity = 50_000n * WAD;
    const collateralAmount = 20n * WAD;
    await usdc.mint(lender.address, poolLiquidity);
    await usdc.connect(lender).approve(await debtPool.getAddress(), ethers.MaxUint256);
    await debtPool.connect(lender).deposit(poolLiquidity, lender.address);

    await wpas.connect(borrower).deposit({ value: collateralAmount });
    await wpas.connect(borrower).approve(await lendingCore.getAddress(), ethers.MaxUint256);
    await lendingCore.connect(borrower).depositCollateral(collateralAmount);
    await lendingCore.connect(borrower).borrow(5_000n * WAD);
    await lendingCore.freezeNewDebt();

    await migrationCoordinator.openMigrationRoute(1n, 2n, true, true);

    return {
      deployer,
      lender,
      borrower,
      wpas,
      usdc,
      debtPool,
      lendingCore,
      marketRegistry,
      migrationCoordinator,
      nextDebtPool: nextVersion.debtPool as any,
      nextLendingCore: nextVersion.lendingCore as any,
    };
  }

  it("migrates a borrower position into the next market version", async function () {
    const { borrower, lendingCore, nextLendingCore, debtPool, nextDebtPool, migrationCoordinator } = await loadFixture(deployFixture);

    const debtBefore = await lendingCore.currentDebt(borrower.address);
    const oldPrincipalBefore = await debtPool.outstandingPrincipal();
    const newPrincipalBefore = await nextDebtPool.outstandingPrincipal();

    await expect(migrationCoordinator.connect(borrower).migrateBorrower(1n, 2n)).to.emit(
      migrationCoordinator,
      "BorrowerMigrated",
    );

    expect(await lendingCore.currentDebt(borrower.address)).to.equal(0n);
    const migratedDebt = await nextLendingCore.currentDebt(borrower.address);
    expect(migratedDebt).to.be.gte(debtBefore);
    expect(migratedDebt - debtBefore).to.be.lt(10n ** 15n);
    expect(await debtPool.outstandingPrincipal()).to.equal(oldPrincipalBefore - 5_000n * WAD);
    expect(await nextDebtPool.outstandingPrincipal()).to.equal(newPrincipalBefore + 5_000n * WAD);

    const migratedPosition = await nextLendingCore.positions(borrower.address);
    expect(migratedPosition.collateralAmount).to.equal(20n * WAD);
    expect(migratedPosition.principalDebt).to.equal(5_000n * WAD);
  });

  it("migrates LP liquidity shares into the next market version", async function () {
    const { lender, debtPool, nextDebtPool, migrationCoordinator } = await loadFixture(deployFixture);

    const shares = await debtPool.balanceOf(lender.address);
    await debtPool.connect(lender).approve(await migrationCoordinator.getAddress(), shares / 2n);

    await expect(migrationCoordinator.connect(lender).migrateLiquidity(1n, 2n, shares / 2n)).to.emit(
      migrationCoordinator,
      "LiquidityMigrated",
    );

    expect(await nextDebtPool.balanceOf(lender.address)).to.be.gt(0n);
    expect(await debtPool.balanceOf(lender.address)).to.equal(shares - shares / 2n);
  });
});
