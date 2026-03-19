// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";

import {DualVMAccessManager} from "../../contracts/DualVMAccessManager.sol";
import {WPAS} from "../../contracts/WPAS.sol";
import {USDCMock} from "../../contracts/USDCMock.sol";
import {ManualOracle} from "../../contracts/ManualOracle.sol";
import {DeterministicRiskModel} from "../../contracts/pvm/DeterministicRiskModel.sol";
import {RiskGateway} from "../../contracts/RiskGateway.sol";
import {DebtPool} from "../../contracts/DebtPool.sol";
import {LendingEngine} from "../../contracts/LendingEngine.sol";
import {IRiskAdapter} from "../../contracts/interfaces/IRiskAdapter.sol";
import {IRiskEngine} from "../../contracts/interfaces/IRiskEngine.sol";

/// @dev Shared test base for all core lending tests.
///      Deploys the full system in setUp() and exposes common helpers.
abstract contract BaseTest is Test {
    // -------------------------------------------------------------------------
    // Constants (matches lib/config/marketConfig.ts)
    // -------------------------------------------------------------------------

    uint256 internal constant WAD = 1e18;

    // Role IDs
    uint64 internal constant ROLE_EMERGENCY = 1;
    uint64 internal constant ROLE_RISK_ADMIN = 2;
    uint64 internal constant ROLE_TREASURY = 3;
    uint64 internal constant ROLE_MINTER = 4;
    uint64 internal constant ROLE_GOVERNANCE = 5;
    uint64 internal constant ROLE_MIGRATION = 6;
    uint64 internal constant ROLE_LENDING_CORE = 7;
    uint64 internal constant ROLE_ROUTER = 8;

    // Risk engine defaults
    uint256 internal constant BASE_RATE_BPS = 200;
    uint256 internal constant SLOPE1_BPS = 800;
    uint256 internal constant SLOPE2_BPS = 3_000;
    uint256 internal constant KINK_BPS = 8_000;
    uint256 internal constant HEALTHY_MAX_LTV_BPS = 7_500;
    uint256 internal constant STRESSED_MAX_LTV_BPS = 6_500;
    uint256 internal constant HEALTHY_LIQ_THRESHOLD_BPS = 8_500;
    uint256 internal constant STRESSED_LIQ_THRESHOLD_BPS = 7_800;
    uint256 internal constant STALE_BORROW_RATE_PENALTY_BPS = 1_000;
    uint256 internal constant STRESSED_COLLATERAL_RATIO_BPS = 14_000;

    // Oracle defaults
    uint256 internal constant ORACLE_PRICE_WAD = 1_000 * WAD;
    uint256 internal constant ORACLE_MAX_AGE_SECONDS = 6 hours;
    uint256 internal constant ORACLE_MIN_PRICE_WAD = 1 * WAD;
    uint256 internal constant ORACLE_MAX_PRICE_WAD = 10_000 * WAD;
    uint256 internal constant ORACLE_MAX_PRICE_CHANGE_BPS = 2_500;

    // Pool defaults
    uint256 internal constant POOL_SUPPLY_CAP = 5_000_000 * WAD;

    // Core defaults
    uint256 internal constant BORROW_CAP = 4_000_000 * WAD;
    uint256 internal constant MIN_BORROW_AMOUNT = 100 * WAD;
    uint256 internal constant RESERVE_FACTOR_BPS = 1_000;
    uint256 internal constant MAX_LTV_BPS = 7_000;
    uint256 internal constant LIQUIDATION_THRESHOLD_BPS = 8_000;
    uint256 internal constant LIQUIDATION_BONUS_BPS = 500;

    // -------------------------------------------------------------------------
    // Accounts
    // -------------------------------------------------------------------------

    address internal deployer;   // == address(this), AccessManager admin
    address internal lender;
    address internal borrower;
    address internal liquidator;
    address internal outsider;

    // -------------------------------------------------------------------------
    // Contracts
    // -------------------------------------------------------------------------

    DualVMAccessManager internal accessManager;
    WPAS internal wpas;
    USDCMock internal usdc;
    ManualOracle internal oracle;
    DeterministicRiskModel internal quoteEngine;
    RiskGateway internal riskGateway;
    DebtPool internal debtPool;
    LendingEngine internal lendingEngine;

    // -------------------------------------------------------------------------
    // setUp
    // -------------------------------------------------------------------------

    function setUp() public virtual {
        deployer = address(this);
        lender = makeAddr("lender");
        borrower = makeAddr("borrower");
        liquidator = makeAddr("liquidator");
        outsider = makeAddr("outsider");

        // Fund test accounts with ETH for WPAS wrapping
        vm.deal(borrower, 1_000 ether);
        vm.deal(liquidator, 1_000 ether);
        vm.deal(lender, 100 ether);

        _deploySystem();
        _wireRoles();
        _seedLiquidity();
    }

    // -------------------------------------------------------------------------
    // Deployment helpers
    // -------------------------------------------------------------------------

    function _deploySystem() internal virtual {
        // AccessManager — test contract is admin
        accessManager = new DualVMAccessManager(deployer);

        // Tokens
        wpas = new WPAS();
        usdc = new USDCMock(address(accessManager));

        // Oracle
        oracle = new ManualOracle(
            address(accessManager),
            ORACLE_PRICE_WAD,
            ORACLE_MAX_AGE_SECONDS,
            ORACLE_MIN_PRICE_WAD,
            ORACLE_MAX_PRICE_WAD,
            ORACLE_MAX_PRICE_CHANGE_BPS
        );

        // Risk engine (DeterministicRiskModel as cross-VM quote engine)
        quoteEngine = new DeterministicRiskModel(
            BASE_RATE_BPS,
            SLOPE1_BPS,
            SLOPE2_BPS,
            KINK_BPS,
            HEALTHY_MAX_LTV_BPS,
            STRESSED_MAX_LTV_BPS,
            HEALTHY_LIQ_THRESHOLD_BPS,
            STRESSED_LIQ_THRESHOLD_BPS,
            STALE_BORROW_RATE_PENALTY_BPS,
            STRESSED_COLLATERAL_RATIO_BPS
        );

        // RiskGateway (inline math + optional PVM cross-VM verification)
        RiskGateway.RiskModelConfig memory riskConfig = RiskGateway.RiskModelConfig({
            baseRateBps: BASE_RATE_BPS,
            slope1Bps: SLOPE1_BPS,
            slope2Bps: SLOPE2_BPS,
            kinkBps: KINK_BPS,
            healthyMaxLtvBps: HEALTHY_MAX_LTV_BPS,
            stressedMaxLtvBps: STRESSED_MAX_LTV_BPS,
            healthyLiquidationThresholdBps: HEALTHY_LIQ_THRESHOLD_BPS,
            stressedLiquidationThresholdBps: STRESSED_LIQ_THRESHOLD_BPS,
            staleBorrowRatePenaltyBps: STALE_BORROW_RATE_PENALTY_BPS,
            stressedCollateralRatioBps: STRESSED_COLLATERAL_RATIO_BPS
        });
        riskGateway = new RiskGateway(address(accessManager), address(quoteEngine), address(0), riskConfig);

        // DebtPool (ERC-4626)
        debtPool = new DebtPool(usdc, address(accessManager), POOL_SUPPLY_CAP);

        // LendingEngine (no liquidation notifier by default)
        LendingEngine.MarketConfig memory coreConfig = LendingEngine.MarketConfig({
            borrowCap: BORROW_CAP,
            minBorrowAmount: MIN_BORROW_AMOUNT,
            reserveFactorBps: RESERVE_FACTOR_BPS,
            maxLtvBps: MAX_LTV_BPS,
            liquidationThresholdBps: LIQUIDATION_THRESHOLD_BPS,
            liquidationBonusBps: LIQUIDATION_BONUS_BPS
        });
        lendingEngine = new LendingEngine(
            address(accessManager),
            wpas,          // collateralAsset
            usdc,          // debtAsset
            debtPool,
            oracle,
            riskGateway,
            coreConfig,
            address(0)     // no liquidation notifier by default
        );
    }

    function _wireRoles() internal virtual {
        // Wire DebtPool → LendingEngine
        debtPool.setLendingCore(address(lendingEngine));

        // Grant all operational roles to the test contract (deployer = address(this))
        accessManager.grantRole(ROLE_EMERGENCY, deployer, 0);
        accessManager.grantRole(ROLE_RISK_ADMIN, deployer, 0);
        accessManager.grantRole(ROLE_TREASURY, deployer, 0);
        accessManager.grantRole(ROLE_MINTER, deployer, 0);
        accessManager.grantRole(ROLE_LENDING_CORE, address(lendingEngine), 0);

        // Map EMERGENCY role to pause/unpause functions
        bytes4[] memory emergencySelectors = new bytes4[](4);
        emergencySelectors[0] = lendingEngine.pause.selector;
        emergencySelectors[1] = lendingEngine.unpause.selector;
        emergencySelectors[2] = debtPool.pause.selector;
        emergencySelectors[3] = debtPool.unpause.selector;
        accessManager.setTargetFunctionRole(address(lendingEngine), _slice(emergencySelectors, 0, 2), ROLE_EMERGENCY);
        accessManager.setTargetFunctionRole(address(debtPool), _slice(emergencySelectors, 2, 4), ROLE_EMERGENCY);

        bytes4[] memory oracleEmergencySelectors = new bytes4[](2);
        oracleEmergencySelectors[0] = oracle.pause.selector;
        oracleEmergencySelectors[1] = oracle.unpause.selector;
        accessManager.setTargetFunctionRole(address(oracle), oracleEmergencySelectors, ROLE_EMERGENCY);

        // Map RISK_ADMIN role to oracle update functions
        bytes4[] memory oracleSelectors = new bytes4[](3);
        oracleSelectors[0] = oracle.setPrice.selector;
        oracleSelectors[1] = oracle.setMaxAge.selector;
        oracleSelectors[2] = oracle.setCircuitBreaker.selector;
        accessManager.setTargetFunctionRole(address(oracle), oracleSelectors, ROLE_RISK_ADMIN);

        // Map TREASURY role to claimReserves on DebtPool
        bytes4[] memory treasurySelectors = new bytes4[](1);
        treasurySelectors[0] = debtPool.claimReserves.selector;
        accessManager.setTargetFunctionRole(address(debtPool), treasurySelectors, ROLE_TREASURY);

        // Map MINTER role to mint on USDCMock
        bytes4[] memory minterSelectors = new bytes4[](1);
        minterSelectors[0] = usdc.mint.selector;
        accessManager.setTargetFunctionRole(address(usdc), minterSelectors, ROLE_MINTER);

        // Map LENDING_CORE role to quoteViaTicket on RiskGateway
        bytes4[] memory lendingCoreSelectors = new bytes4[](1);
        lendingCoreSelectors[0] = riskGateway.quoteViaTicket.selector;
        accessManager.setTargetFunctionRole(address(riskGateway), lendingCoreSelectors, ROLE_LENDING_CORE);
    }

    function _seedLiquidity() internal virtual {
        uint256 poolLiquidity = 50_000 * WAD;
        usdc.mint(lender, poolLiquidity);
        vm.startPrank(lender);
        usdc.approve(address(debtPool), type(uint256).max);
        debtPool.deposit(poolLiquidity, lender);
        vm.stopPrank();

        // Seed liquidator with USDC
        usdc.mint(liquidator, 10_000 * WAD);
        vm.prank(liquidator);
        usdc.approve(address(lendingEngine), type(uint256).max);

        // Seed borrower with WPAS collateral
        uint256 collateralAmount = 20 * WAD;
        vm.startPrank(borrower);
        wpas.deposit{value: collateralAmount}();
        wpas.approve(address(lendingEngine), type(uint256).max);
        usdc.approve(address(lendingEngine), type(uint256).max);
        lendingEngine.depositCollateral(collateralAmount);
        vm.stopPrank();
    }

    // -------------------------------------------------------------------------
    // Utility helpers
    // -------------------------------------------------------------------------

    /// @dev Deploy system with a specific liquidation notifier
    function _deployWithNotifier(address notifier) internal {
        // Deploy fresh AccessManager
        accessManager = new DualVMAccessManager(deployer);
        wpas = new WPAS();
        usdc = new USDCMock(address(accessManager));
        oracle = new ManualOracle(
            address(accessManager),
            ORACLE_PRICE_WAD,
            ORACLE_MAX_AGE_SECONDS,
            ORACLE_MIN_PRICE_WAD,
            ORACLE_MAX_PRICE_WAD,
            ORACLE_MAX_PRICE_CHANGE_BPS
        );
        quoteEngine = new DeterministicRiskModel(
            BASE_RATE_BPS, SLOPE1_BPS, SLOPE2_BPS, KINK_BPS,
            HEALTHY_MAX_LTV_BPS, STRESSED_MAX_LTV_BPS,
            HEALTHY_LIQ_THRESHOLD_BPS, STRESSED_LIQ_THRESHOLD_BPS,
            STALE_BORROW_RATE_PENALTY_BPS, STRESSED_COLLATERAL_RATIO_BPS
        );
        RiskGateway.RiskModelConfig memory riskConfig = RiskGateway.RiskModelConfig({
            baseRateBps: BASE_RATE_BPS,
            slope1Bps: SLOPE1_BPS,
            slope2Bps: SLOPE2_BPS,
            kinkBps: KINK_BPS,
            healthyMaxLtvBps: HEALTHY_MAX_LTV_BPS,
            stressedMaxLtvBps: STRESSED_MAX_LTV_BPS,
            healthyLiquidationThresholdBps: HEALTHY_LIQ_THRESHOLD_BPS,
            stressedLiquidationThresholdBps: STRESSED_LIQ_THRESHOLD_BPS,
            staleBorrowRatePenaltyBps: STALE_BORROW_RATE_PENALTY_BPS,
            stressedCollateralRatioBps: STRESSED_COLLATERAL_RATIO_BPS
        });
        riskGateway = new RiskGateway(address(accessManager), address(quoteEngine), address(0), riskConfig);
        debtPool = new DebtPool(usdc, address(accessManager), POOL_SUPPLY_CAP);

        LendingEngine.MarketConfig memory coreConfig = LendingEngine.MarketConfig({
            borrowCap: BORROW_CAP,
            minBorrowAmount: MIN_BORROW_AMOUNT,
            reserveFactorBps: RESERVE_FACTOR_BPS,
            maxLtvBps: MAX_LTV_BPS,
            liquidationThresholdBps: LIQUIDATION_THRESHOLD_BPS,
            liquidationBonusBps: LIQUIDATION_BONUS_BPS
        });
        lendingEngine = new LendingEngine(
            address(accessManager),
            wpas,
            usdc,
            debtPool,
            oracle,
            riskGateway,
            coreConfig,
            notifier
        );
        _wireRoles();
        _seedLiquidity();
    }

    /// @dev Widen oracle circuit breaker to allow large price movements in tests
    function _widenOracleBreaker() internal {
        oracle.setCircuitBreaker(ORACLE_MIN_PRICE_WAD, ORACLE_MAX_PRICE_WAD, 10_000);
    }

    /// @dev Set oracle price (must widen circuit breaker first for large moves)
    function _setOraclePrice(uint256 priceWad) internal {
        oracle.setPrice(priceWad);
    }

    /// @dev Borrow from lendingEngine as borrower
    function _borrowAs(address account, uint256 amount) internal {
        vm.prank(account);
        lendingEngine.borrow(amount);
    }

    /// @dev Make a position liquidatable by dropping the oracle price
    function _makeLiquidatable(uint256 newPriceWad) internal {
        _widenOracleBreaker();
        _setOraclePrice(newPriceWad);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _slice(bytes4[] memory arr, uint256 from, uint256 to) internal pure returns (bytes4[] memory result) {
        result = new bytes4[](to - from);
        for (uint256 i = from; i < to; i++) {
            result[i - from] = arr[i];
        }
    }
}
