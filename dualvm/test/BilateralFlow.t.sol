// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";

import {DualVMAccessManager} from "../contracts/DualVMAccessManager.sol";
import {WPAS} from "../contracts/WPAS.sol";
import {USDCMock} from "../contracts/USDCMock.sol";
import {ManualOracle} from "../contracts/ManualOracle.sol";
import {DeterministicRiskModel} from "../contracts/pvm/DeterministicRiskModel.sol";
import {GovernancePolicyStore} from "../contracts/GovernancePolicyStore.sol";
import {RiskGateway} from "../contracts/RiskGateway.sol";
import {DebtPool} from "../contracts/DebtPool.sol";
import {LiquidationHookRegistry} from "../contracts/LiquidationHookRegistry.sol";
import {XcmLiquidationNotifier} from "../contracts/precompiles/XcmLiquidationNotifier.sol";
import {XcmNotifierAdapter} from "../contracts/XcmNotifierAdapter.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";
import {LendingRouter} from "../contracts/LendingRouter.sol";
import {XcmInbox} from "../contracts/XcmInbox.sol";
import {MockLiquidationNotifier} from "../contracts/test/MockLiquidationNotifier.sol";
import {IXcm, XCM_PRECOMPILE_ADDRESS} from "../contracts/precompiles/IXcm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IRiskAdapter} from "../contracts/interfaces/IRiskAdapter.sol";
import {IRiskEngine} from "../contracts/interfaces/IRiskEngine.sol";

/// @title BilateralFlow Integration Test
/// @notice Proves the full M11 bilateral async pipeline end-to-end on local anvil.
///
/// Pipeline under test:
///   LendingRouter → LendingEngine → RiskGateway ↔ DeterministicRiskModel (PVM sim)
///   → LiquidationHookRegistry → XcmNotifierAdapter → XcmLiquidationNotifier → XCM
///   → XcmInbox (dedup) + GovernancePolicyStore governance
///
/// VAL assertions covered:
///   VAL-BILATERAL-002, VAL-BILATERAL-003, VAL-BILATERAL-005, VAL-BILATERAL-006,
///   VAL-BILATERAL-007, VAL-ASYNC-001, VAL-ASYNC-002, VAL-CROSS-M11-001,
///   VAL-STAB-003, VAL-STAB-004, VAL-UX-004
contract BilateralFlowTest is Test {
    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------
    uint256 internal constant WAD = 1e18;

    // Role IDs (match Deploy.s.sol)
    uint64 internal constant ROLE_EMERGENCY = 1;
    uint64 internal constant ROLE_RISK_ADMIN = 2;
    uint64 internal constant ROLE_TREASURY = 3;
    uint64 internal constant ROLE_MINTER = 4;
    uint64 internal constant ROLE_GOVERNANCE = 5;
    uint64 internal constant ROLE_LENDING_CORE = 7;
    uint64 internal constant ROLE_ROUTER = 8;
    uint64 internal constant ROLE_RELAY_CALLER = 9;

    // Risk parameters (match Deploy.s.sol)
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

    uint256 internal constant ORACLE_PRICE_WAD = 1_000 * WAD;
    uint256 internal constant ORACLE_MAX_AGE_SECONDS = 6 hours;
    uint256 internal constant ORACLE_MIN_PRICE_WAD = 1 * WAD;
    uint256 internal constant ORACLE_MAX_PRICE_WAD = 10_000 * WAD;
    uint256 internal constant ORACLE_MAX_PRICE_CHANGE_BPS = 2_500;

    uint256 internal constant POOL_SUPPLY_CAP = 5_000_000 * WAD;
    uint256 internal constant BORROW_CAP = 4_000_000 * WAD;
    uint256 internal constant MIN_BORROW_AMOUNT = 100 * WAD;
    uint256 internal constant RESERVE_FACTOR_BPS = 1_000;
    uint256 internal constant MAX_LTV_BPS = 7_000;
    uint256 internal constant LIQ_THRESHOLD_BPS = 8_000;
    uint256 internal constant LIQ_BONUS_BPS = 500;

    // -------------------------------------------------------------------------
    // Accounts
    // -------------------------------------------------------------------------
    address internal deployer;
    address internal lender;
    address internal user;
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
    GovernancePolicyStore internal policyStore;
    RiskGateway internal riskGateway;
    DebtPool internal debtPool;
    LiquidationHookRegistry internal hookRegistry;
    XcmLiquidationNotifier internal xcmNotifier;
    XcmNotifierAdapter internal xcmAdapter;
    LendingEngine internal lendingEngine;
    LendingRouter internal lendingRouter;
    XcmInbox internal xcmInbox;

    // -------------------------------------------------------------------------
    // setUp
    // -------------------------------------------------------------------------
    function setUp() public {
        deployer = address(this);
        lender = makeAddr("lender");
        user = makeAddr("user");
        liquidator = makeAddr("liquidator");
        outsider = makeAddr("outsider");

        vm.deal(user, 1_000 ether);
        vm.deal(lender, 100 ether);
        vm.deal(liquidator, 100 ether);

        _deploy();
        _wireRoles();
        _seedLiquidity();
    }

    function _deploy() internal {
        // 1. AccessManager
        accessManager = new DualVMAccessManager(deployer);

        // 2. Tokens
        wpas = new WPAS();
        usdc = new USDCMock(address(accessManager));

        // 3. Oracle
        oracle = new ManualOracle(
            address(accessManager),
            ORACLE_PRICE_WAD,
            ORACLE_MAX_AGE_SECONDS,
            ORACLE_MIN_PRICE_WAD,
            ORACLE_MAX_PRICE_WAD,
            ORACLE_MAX_PRICE_CHANGE_BPS
        );

        // 4. DeterministicRiskModel (same math as PVM version)
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

        // 5. GovernancePolicyStore (M11)
        policyStore = new GovernancePolicyStore(address(accessManager));

        // 6. RiskGateway with quoteEngine (PVM verification) AND policyStore (M11)
        riskGateway = new RiskGateway(
            address(accessManager),
            address(quoteEngine),
            address(policyStore),
            RiskGateway.RiskModelConfig({
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
            })
        );

        // 7. DebtPool (ERC-4626)
        debtPool = new DebtPool(usdc, address(accessManager), POOL_SUPPLY_CAP);

        // 8. LiquidationHookRegistry (M11) — must precede LendingEngine
        hookRegistry = new LiquidationHookRegistry(address(accessManager));

        // 9. XCM hook chain (M11)
        xcmNotifier = new XcmLiquidationNotifier();
        xcmAdapter = new XcmNotifierAdapter(address(xcmNotifier));

        // 10. LendingEngine with hookRegistry as notifier (M11)
        lendingEngine = new LendingEngine(
            address(accessManager),
            wpas,
            usdc,
            debtPool,
            oracle,
            riskGateway,
            LendingEngine.MarketConfig({
                borrowCap: BORROW_CAP,
                minBorrowAmount: MIN_BORROW_AMOUNT,
                reserveFactorBps: RESERVE_FACTOR_BPS,
                maxLtvBps: MAX_LTV_BPS,
                liquidationThresholdBps: LIQ_THRESHOLD_BPS,
                liquidationBonusBps: LIQ_BONUS_BPS
            }),
            address(hookRegistry)
        );

        // 11. LendingRouter (M11) — wrap PAS → WPAS + depositCollateralFor in 1 TX
        lendingRouter = new LendingRouter(address(wpas), address(lendingEngine));

        // 12. XcmInbox (M11)
        xcmInbox = new XcmInbox(address(accessManager));

        // Wire DebtPool → LendingEngine
        debtPool.setLendingCore(address(lendingEngine));
    }

    function _wireRoles() internal {
        DualVMAccessManager am = accessManager;

        // ── USDCMock mint ─────────────────────────────────────────────────────
        {
            bytes4[] memory s = new bytes4[](1);
            s[0] = USDCMock.mint.selector;
            am.setTargetFunctionRole(address(usdc), s, ROLE_MINTER);
        }
        am.grantRole(ROLE_MINTER, deployer, 0);

        // ── Oracle (RISK_ADMIN controls price/maxAge/circuitBreaker) ─────────
        {
            bytes4[] memory s = new bytes4[](3);
            s[0] = ManualOracle.setPrice.selector;
            s[1] = ManualOracle.setMaxAge.selector;
            s[2] = ManualOracle.setCircuitBreaker.selector;
            am.setTargetFunctionRole(address(oracle), s, ROLE_RISK_ADMIN);
        }
        {
            bytes4[] memory s = new bytes4[](2);
            s[0] = ManualOracle.pause.selector;
            s[1] = ManualOracle.unpause.selector;
            am.setTargetFunctionRole(address(oracle), s, ROLE_EMERGENCY);
        }
        am.grantRole(ROLE_RISK_ADMIN, deployer, 0);
        am.grantRole(ROLE_EMERGENCY, deployer, 0);

        // ── PolicyStore (RISK_ADMIN) ──────────────────────────────────────────
        {
            bytes4[] memory s = new bytes4[](2);
            s[0] = GovernancePolicyStore.setPolicy.selector;
            s[1] = GovernancePolicyStore.removePolicy.selector;
            am.setTargetFunctionRole(address(policyStore), s, ROLE_RISK_ADMIN);
        }

        // ── RiskGateway: quoteViaTicket ← LENDING_CORE ───────────────────────
        {
            bytes4[] memory s = new bytes4[](1);
            s[0] = RiskGateway.quoteViaTicket.selector;
            am.setTargetFunctionRole(address(riskGateway), s, ROLE_LENDING_CORE);
        }
        am.grantRole(ROLE_LENDING_CORE, address(lendingEngine), 0);

        // ── DebtPool ─────────────────────────────────────────────────────────
        {
            bytes4[] memory s = new bytes4[](2);
            s[0] = DebtPool.pause.selector;
            s[1] = DebtPool.unpause.selector;
            am.setTargetFunctionRole(address(debtPool), s, ROLE_EMERGENCY);
        }
        {
            bytes4[] memory s = new bytes4[](1);
            s[0] = DebtPool.claimReserves.selector;
            am.setTargetFunctionRole(address(debtPool), s, ROLE_TREASURY);
        }
        am.grantRole(ROLE_TREASURY, deployer, 0);

        // ── LendingEngine ─────────────────────────────────────────────────────
        {
            bytes4[] memory s = new bytes4[](2);
            s[0] = LendingEngine.pause.selector;
            s[1] = LendingEngine.unpause.selector;
            am.setTargetFunctionRole(address(lendingEngine), s, ROLE_EMERGENCY);
        }
        {
            bytes4[] memory s = new bytes4[](1);
            s[0] = LendingEngine.depositCollateralFor.selector;
            am.setTargetFunctionRole(address(lendingEngine), s, ROLE_ROUTER);
        }
        am.grantRole(ROLE_ROUTER, address(lendingRouter), 0);

        // ── HookRegistry: registerHook/deregisterHook ← GOVERNANCE ───────────
        {
            bytes4[] memory s = new bytes4[](2);
            s[0] = LiquidationHookRegistry.registerHook.selector;
            s[1] = LiquidationHookRegistry.deregisterHook.selector;
            am.setTargetFunctionRole(address(hookRegistry), s, ROLE_GOVERNANCE);
        }
        am.grantRole(ROLE_GOVERNANCE, deployer, 0);

        // Register XcmNotifierAdapter as DEFAULT_HOOK_TYPE handler
        hookRegistry.registerHook(hookRegistry.DEFAULT_HOOK_TYPE(), address(xcmAdapter));

        // ── XcmInbox: receiveReceipt ← RELAY_CALLER ──────────────────────────
        {
            bytes4[] memory s = new bytes4[](1);
            s[0] = XcmInbox.receiveReceipt.selector;
            am.setTargetFunctionRole(address(xcmInbox), s, ROLE_RELAY_CALLER);
        }
        am.grantRole(ROLE_RELAY_CALLER, deployer, 0);
    }

    function _seedLiquidity() internal {
        // Lender deposits USDC into DebtPool
        uint256 poolLiquidity = 100_000 * WAD;
        usdc.mint(lender, poolLiquidity);
        vm.startPrank(lender);
        usdc.approve(address(debtPool), type(uint256).max);
        debtPool.deposit(poolLiquidity, lender);
        vm.stopPrank();

        // Seed liquidator with USDC and approval
        usdc.mint(liquidator, 20_000 * WAD);
        vm.prank(liquidator);
        usdc.approve(address(lendingEngine), type(uint256).max);

        // Seed user with USDC approval for repayments
        vm.prank(user);
        usdc.approve(address(lendingEngine), type(uint256).max);
    }

    // =========================================================================
    // TEST 1: Full Bilateral Async Flow (VAL-CROSS-M11-001)
    // =========================================================================

    /// @notice Proves the complete bilateral async pipeline end-to-end.
    function test_FullBilateralAsyncFlow() public {
        // ─── 1. Deposit via LendingRouter.depositCollateralFromPAS() ─────────
        uint256 depositAmount = 10 * WAD;

        vm.recordLogs();
        vm.prank(user);
        lendingRouter.depositCollateralFromPAS{value: depositAmount}();
        Vm.Log[] memory depositLogs = vm.getRecordedLogs();

        // Position credited to user, not router (VAL-STAB-004)
        (uint256 col,,,,) = lendingEngine.positions(user);
        assertEq(col, depositAmount, "position credited to user, not router");
        (uint256 routerCol,,,,) = lendingEngine.positions(address(lendingRouter));
        assertEq(routerCol, 0, "router has no collateral position");

        // CollateralDeposited correlationId is non-zero
        bytes32 depositCorrId =
            _corrId(depositLogs, address(lendingEngine), LendingEngine.CollateralDeposited.selector, 2);
        assertNotEq(depositCorrId, bytes32(0), "deposit correlationId non-zero");

        // ─── 2. Borrow — Borrowed event + QuoteVerified (VAL-BILATERAL-005) ──
        uint256 borrowAmount = 5_000 * WAD; // 50% LTV at price=1000 USDC/WPAS

        vm.recordLogs();
        vm.prank(user);
        lendingEngine.borrow(borrowAmount);
        Vm.Log[] memory borrowLogs = vm.getRecordedLogs();

        bytes32 borrowCorrId = _corrId(borrowLogs, address(lendingEngine), LendingEngine.Borrowed.selector, 2);
        assertNotEq(borrowCorrId, bytes32(0), "borrow correlationId non-zero");

        // QuoteVerified emitted (PVM cross-VM verification succeeded)
        assertTrue(
            _hasLog(borrowLogs, address(riskGateway), RiskGateway.QuoteVerified.selector),
            "QuoteVerified should fire during borrow"
        );

        // ─── 3. GovernancePolicyStore.setPolicy via authorized caller ─────────
        bytes32 policyKey = riskGateway.POLICY_MAX_LTV();
        uint256 newMaxLtv = 6_000; // 60% override

        // Unauthorized reverts (VAL-BILATERAL-003)
        vm.prank(outsider);
        vm.expectRevert();
        policyStore.setPolicy(policyKey, newMaxLtv);

        // Authorized (deployer has ROLE_RISK_ADMIN) succeeds
        policyStore.setPolicy(policyKey, newMaxLtv);
        assertEq(policyStore.getPolicy(policyKey), newMaxLtv, "policy stored");
        assertTrue(policyStore.policyActive(policyKey), "policy active");

        // ─── 4. setPrice to make position liquidatable ────────────────────────
        // 10 WPAS @ 1000 USDC = 10000 USDC collateral. Debt=5000. HF=10000*80%/5000=1.6
        // Drop to 400 USDC/WPAS: HF = 10*400*80%/5000 = 0.64 → liquidatable
        oracle.setCircuitBreaker(1 * WAD, 10_000 * WAD, 10_000);
        oracle.setPrice(400 * WAD);
        assertLt(lendingEngine.healthFactor(user), WAD, "position should be liquidatable");

        // ─── 5. Liquidate — verify full hook chain with correlationId ─────────
        // Mock XCM precompile (not available on anvil)
        vm.mockCall(XCM_PRECOMPILE_ADDRESS, abi.encodeWithSelector(IXcm.send.selector), abi.encode());

        vm.recordLogs();
        vm.prank(liquidator);
        lendingEngine.liquidate(user, type(uint256).max);
        Vm.Log[] memory liqLogs = vm.getRecordedLogs();

        // (a) Liquidated event has correlationId (topic3 = 3rd indexed param)
        // Liquidated(address indexed borrower, address indexed liquidator, uint256, uint256, uint256, bytes32 indexed correlationId)
        bytes32 liqCorrId = _corrId(liqLogs, address(lendingEngine), LendingEngine.Liquidated.selector, 3);
        assertNotEq(liqCorrId, bytes32(0), "Liquidated correlationId non-zero");

        // (b) LiquidationHookRegistry dispatched
        assertTrue(
            _hasLog(liqLogs, address(hookRegistry), LiquidationHookRegistry.HookExecuted.selector),
            "HookExecuted should fire from LiquidationHookRegistry"
        );

        // (c) XcmLiquidationNotifier emitted LiquidationNotified with same correlationId
        // LiquidationNotified(address indexed borrower, uint256, uint256, bytes32 indexed correlationId)
        // topics: [0]=selector, [1]=borrower, [2]=correlationId
        bytes32 notifiedCorrId =
            _corrId(liqLogs, address(xcmNotifier), XcmLiquidationNotifier.LiquidationNotified.selector, 2);
        assertNotEq(notifiedCorrId, bytes32(0), "LiquidationNotified correlationId non-zero");

        // (d) correlationId is identical from LendingEngine to XcmLiquidationNotifier (VAL-BILATERAL-002)
        assertEq(
            liqCorrId,
            notifiedCorrId,
            "correlationId must match: LendingEngine.Liquidated == XcmLiquidationNotifier.LiquidationNotified"
        );

        // ─── 6. XcmInbox.receiveReceipt(correlationId, data) ─────────────────
        bytes memory receiptData = abi.encode("liquidation-confirmed");

        vm.recordLogs();
        xcmInbox.receiveReceipt(liqCorrId, receiptData);
        Vm.Log[] memory inboxLogs = vm.getRecordedLogs();

        // ReceiptReceived event emitted (VAL-BILATERAL-006)
        bool foundReceiptReceived = false;
        for (uint256 i = 0; i < inboxLogs.length; i++) {
            if (
                inboxLogs[i].emitter == address(xcmInbox) && inboxLogs[i].topics[0] == XcmInbox.ReceiptReceived.selector
            ) {
                assertEq(inboxLogs[i].topics[1], liqCorrId, "inbox correlationId matches");
                foundReceiptReceived = true;
            }
        }
        assertTrue(foundReceiptReceived, "ReceiptReceived should be emitted");
        assertTrue(xcmInbox.hasProcessed(liqCorrId), "correlationId marked processed");

        // ─── 7. Duplicate receiveReceipt → revert DuplicateCorrelationId ──────
        vm.expectRevert(abi.encodeWithSelector(XcmInbox.DuplicateCorrelationId.selector, liqCorrId));
        xcmInbox.receiveReceipt(liqCorrId, receiptData);

        // ─── 8. AccessManager governs all contracts (VAL-BILATERAL-007) ───────
        assertEq(_authority(address(lendingEngine)), address(accessManager), "LendingEngine authority");
        assertEq(_authority(address(riskGateway)), address(accessManager), "RiskGateway authority");
        assertEq(_authority(address(debtPool)), address(accessManager), "DebtPool authority");
        assertEq(_authority(address(oracle)), address(accessManager), "Oracle authority");
        assertEq(_authority(address(policyStore)), address(accessManager), "PolicyStore authority");
        assertEq(_authority(address(hookRegistry)), address(accessManager), "HookRegistry authority");
        assertEq(_authority(address(xcmInbox)), address(accessManager), "XcmInbox authority");
        assertEq(_authority(address(usdc)), address(accessManager), "USDCMock authority");

        // Verify unauthorized calls revert (AccessManagedUnauthorized)
        vm.prank(outsider);
        vm.expectRevert();
        lendingEngine.pause();
    }

    // =========================================================================
    // TEST 2: CorrelationId uniqueness across operations
    // =========================================================================

    function test_CorrelationId_UniquePerOperation() public {
        vm.recordLogs();
        vm.prank(user);
        lendingRouter.depositCollateralFromPAS{value: 1 * WAD}();
        bytes32 id1 =
            _corrId(vm.getRecordedLogs(), address(lendingEngine), LendingEngine.CollateralDeposited.selector, 2);

        vm.roll(block.number + 1);
        vm.recordLogs();
        vm.prank(user);
        lendingRouter.depositCollateralFromPAS{value: 1 * WAD}();
        bytes32 id2 =
            _corrId(vm.getRecordedLogs(), address(lendingEngine), LendingEngine.CollateralDeposited.selector, 2);

        assertNotEq(id1, bytes32(0));
        assertNotEq(id2, bytes32(0));
        assertNotEq(id1, id2, "successive operations have different correlationIds");
    }

    // =========================================================================
    // TEST 3: GovernancePolicyStore governs RiskGateway (VAL-BILATERAL-003)
    // =========================================================================

    function test_PolicyStore_SetAndGetPolicy() public {
        bytes32 key = riskGateway.POLICY_MAX_LTV();
        uint256 val = 5_500;

        policyStore.setPolicy(key, val);
        assertEq(policyStore.getPolicy(key), val);
        assertTrue(policyStore.policyActive(key));

        policyStore.removePolicy(key);
        assertFalse(policyStore.policyActive(key));
    }

    function test_PolicyStore_UnauthorizedReverts() public {
        bytes32 policyKey = riskGateway.POLICY_MAX_LTV(); // cache before prank (avoid consuming prank on view call)
        vm.prank(outsider);
        vm.expectRevert();
        policyStore.setPolicy(policyKey, 1_000);
    }

    // =========================================================================
    // TEST 4: LiquidationHookRegistry (VAL-ASYNC-002)
    // =========================================================================

    function test_HookRegistry_RegisterAndDispatch() public {
        MockLiquidationNotifier mock = new MockLiquidationNotifier(false);
        bytes32 hookType = keccak256("TEST");

        hookRegistry.registerHook(hookType, address(mock));
        assertEq(hookRegistry.getHook(hookType), address(mock));

        hookRegistry.executeHooks(hookType, abi.encode(user, uint256(100), uint256(50), keccak256("corrId")));
        assertEq(mock.callCount(), 1);
    }

    function test_HookRegistry_FailingHookDoesNotRevertLiquidation() public {
        // Replace hook with a reverting mock
        MockLiquidationNotifier revertMock = new MockLiquidationNotifier(true);
        hookRegistry.registerHook(hookRegistry.DEFAULT_HOOK_TYPE(), address(revertMock));

        // Set up a liquidatable position
        vm.prank(user);
        lendingRouter.depositCollateralFromPAS{value: 10 * WAD}();
        vm.prank(user);
        lendingEngine.borrow(5_000 * WAD);

        oracle.setCircuitBreaker(1 * WAD, 10_000 * WAD, 10_000);
        oracle.setPrice(300 * WAD);

        // Liquidation should succeed even if hook reverts
        vm.recordLogs();
        vm.prank(liquidator);
        lendingEngine.liquidate(user, type(uint256).max);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertTrue(
            _hasLog(logs, address(hookRegistry), LiquidationHookRegistry.HookFailed.selector),
            "HookFailed emitted on hook revert"
        );
        assertTrue(
            _hasLog(logs, address(lendingEngine), LendingEngine.Liquidated.selector),
            "Liquidated emitted despite hook failure"
        );
    }

    function test_HookRegistry_Deregister() public {
        hookRegistry.deregisterHook(hookRegistry.DEFAULT_HOOK_TYPE());
        assertEq(hookRegistry.getHook(hookRegistry.DEFAULT_HOOK_TYPE()), address(0));
    }

    function test_HookRegistry_MultipleHookTypes() public {
        // Two independent hook types can coexist
        bytes32 typeA = keccak256("TYPE_A");
        bytes32 typeB = keccak256("TYPE_B");

        MockLiquidationNotifier mockA = new MockLiquidationNotifier(false);
        MockLiquidationNotifier mockB = new MockLiquidationNotifier(false);

        hookRegistry.registerHook(typeA, address(mockA));
        hookRegistry.registerHook(typeB, address(mockB));

        bytes memory data = abi.encode(user, uint256(1), uint256(1), bytes32(keccak256("corrId")));
        hookRegistry.executeHooks(typeA, data);
        assertEq(mockA.callCount(), 1);
        assertEq(mockB.callCount(), 0);

        hookRegistry.executeHooks(typeB, data);
        assertEq(mockA.callCount(), 1);
        assertEq(mockB.callCount(), 1);
    }

    // =========================================================================
    // TEST 5: XcmInbox deduplication (VAL-ASYNC-001, VAL-BILATERAL-006)
    // =========================================================================

    function test_XcmInbox_FirstReceiptSucceeds() public {
        bytes32 corrId = keccak256("receipt-1");
        bytes memory data = abi.encode("payload");

        vm.expectEmit(true, true, false, true, address(xcmInbox));
        emit XcmInbox.ReceiptReceived(corrId, deployer, data);
        xcmInbox.receiveReceipt(corrId, data);

        assertTrue(xcmInbox.hasProcessed(corrId));
    }

    function test_XcmInbox_DuplicateReverts() public {
        bytes32 corrId = keccak256("receipt-2");
        xcmInbox.receiveReceipt(corrId, "");
        vm.expectRevert(abi.encodeWithSelector(XcmInbox.DuplicateCorrelationId.selector, corrId));
        xcmInbox.receiveReceipt(corrId, "");
    }

    function test_XcmInbox_UnauthorizedReverts() public {
        vm.prank(outsider);
        vm.expectRevert();
        xcmInbox.receiveReceipt(keccak256("unauth"), "");
    }

    function test_XcmInbox_DifferentIdsAccepted() public {
        bytes32 id1 = keccak256("id-a");
        bytes32 id2 = keccak256("id-b");

        xcmInbox.receiveReceipt(id1, "");
        xcmInbox.receiveReceipt(id2, ""); // different id — should succeed

        assertTrue(xcmInbox.hasProcessed(id1));
        assertTrue(xcmInbox.hasProcessed(id2));
    }

    // =========================================================================
    // TEST 6: AccessManager governs all contracts (VAL-BILATERAL-007)
    // =========================================================================

    function test_AccessManager_GovernsAllContracts() public view {
        assertEq(_authority(address(lendingEngine)), address(accessManager));
        assertEq(_authority(address(riskGateway)), address(accessManager));
        assertEq(_authority(address(debtPool)), address(accessManager));
        assertEq(_authority(address(oracle)), address(accessManager));
        assertEq(_authority(address(policyStore)), address(accessManager));
        assertEq(_authority(address(hookRegistry)), address(accessManager));
        assertEq(_authority(address(xcmInbox)), address(accessManager));
        assertEq(_authority(address(usdc)), address(accessManager));
    }

    function test_AccessManager_UnauthorizedCallsRevert() public {
        vm.prank(outsider);
        vm.expectRevert();
        lendingEngine.pause();

        vm.prank(outsider);
        vm.expectRevert();
        policyStore.setPolicy(keccak256("any"), 1);

        vm.prank(outsider);
        vm.expectRevert();
        xcmInbox.receiveReceipt(keccak256("any"), "");

        vm.prank(outsider);
        vm.expectRevert();
        oracle.setPrice(500 * WAD);
    }

    // =========================================================================
    // TEST 7: LendingRouter credits user position (VAL-STAB-004, VAL-UX-004)
    // =========================================================================

    function test_LendingRouter_CreditsUserPosition() public {
        uint256 amount = 5 * WAD;
        vm.prank(user);
        lendingRouter.depositCollateralFromPAS{value: amount}();

        (uint256 col,,,,) = lendingEngine.positions(user);
        (uint256 routerCol,,,,) = lendingEngine.positions(address(lendingRouter));

        assertEq(col, amount, "user gets collateral credit");
        assertEq(routerCol, 0, "router has no collateral");
    }

    function test_LendingRouter_AccumulatesOnRepeatedDeposits() public {
        vm.prank(user);
        lendingRouter.depositCollateralFromPAS{value: 3 * WAD}();
        vm.prank(user);
        lendingRouter.depositCollateralFromPAS{value: 5 * WAD}();

        (uint256 col,,,,) = lendingEngine.positions(user);
        assertEq(col, 8 * WAD, "collateral accumulates correctly");
    }

    // =========================================================================
    // TEST 8: Full lending cycle with correlationIds (VAL-BILATERAL-005)
    // =========================================================================

    function test_FullLendingCycle_WithCorrelationIds() public {
        // Deposit
        vm.recordLogs();
        vm.prank(user);
        lendingRouter.depositCollateralFromPAS{value: 10 * WAD}();
        bytes32 depositId =
            _corrId(vm.getRecordedLogs(), address(lendingEngine), LendingEngine.CollateralDeposited.selector, 2);

        // Borrow
        vm.roll(block.number + 1);
        vm.recordLogs();
        vm.prank(user);
        lendingEngine.borrow(3_000 * WAD);
        bytes32 borrowId = _corrId(vm.getRecordedLogs(), address(lendingEngine), LendingEngine.Borrowed.selector, 2);

        // Repay
        usdc.mint(user, 1_000 * WAD);
        vm.roll(block.number + 1);
        vm.recordLogs();
        vm.prank(user);
        lendingEngine.repay(1_000 * WAD);
        bytes32 repayId = _corrId(vm.getRecordedLogs(), address(lendingEngine), LendingEngine.Repaid.selector, 2);

        // Liquidate (price crash to bad debt: 10 WPAS * 50 USDC = 500 USDC << 2000 USDC debt)
        oracle.setCircuitBreaker(1 * WAD, 10_000 * WAD, 10_000);
        oracle.setPrice(50 * WAD);
        assertLt(lendingEngine.healthFactor(user), WAD);

        vm.mockCall(XCM_PRECOMPILE_ADDRESS, abi.encodeWithSelector(IXcm.send.selector), abi.encode());
        vm.roll(block.number + 1);
        vm.recordLogs();
        vm.prank(liquidator);
        lendingEngine.liquidate(user, type(uint256).max);
        bytes32 liqId = _corrId(vm.getRecordedLogs(), address(lendingEngine), LendingEngine.Liquidated.selector, 3);

        // All non-zero and unique
        assertNotEq(depositId, bytes32(0));
        assertNotEq(borrowId, bytes32(0));
        assertNotEq(repayId, bytes32(0));
        assertNotEq(liqId, bytes32(0));

        assertNotEq(depositId, borrowId);
        assertNotEq(borrowId, repayId);
        assertNotEq(repayId, liqId);
        assertNotEq(depositId, liqId);
    }

    // =========================================================================
    // TEST 9: CorrelationId propagates through full hook chain (VAL-BILATERAL-002)
    // =========================================================================

    function test_CorrelationId_PropagatesEndToEnd() public {
        // Setup position
        vm.prank(user);
        lendingRouter.depositCollateralFromPAS{value: 10 * WAD}();
        vm.prank(user);
        lendingEngine.borrow(5_000 * WAD);

        oracle.setCircuitBreaker(1 * WAD, 10_000 * WAD, 10_000);
        oracle.setPrice(300 * WAD);
        assertLt(lendingEngine.healthFactor(user), WAD);

        vm.mockCall(XCM_PRECOMPILE_ADDRESS, abi.encodeWithSelector(IXcm.send.selector), abi.encode());

        vm.recordLogs();
        vm.prank(liquidator);
        lendingEngine.liquidate(user, type(uint256).max);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Extract from LendingEngine.Liquidated (topic3)
        bytes32 liqCorrId = _corrId(logs, address(lendingEngine), LendingEngine.Liquidated.selector, 3);
        assertNotEq(liqCorrId, bytes32(0));

        // Must match in LiquidationNotified (topic2)
        bytes32 notifiedId = _corrId(logs, address(xcmNotifier), XcmLiquidationNotifier.LiquidationNotified.selector, 2);
        assertEq(liqCorrId, notifiedId, "correlationId must be identical from LendingEngine to XcmLiquidationNotifier");

        // XcmInbox round-trip proves the same correlationId closes the bilateral loop
        xcmInbox.receiveReceipt(liqCorrId, abi.encode("confirmed"));
        assertTrue(xcmInbox.hasProcessed(liqCorrId), "receipt accepted");

        // Duplicate proves dedup
        vm.expectRevert(abi.encodeWithSelector(XcmInbox.DuplicateCorrelationId.selector, liqCorrId));
        xcmInbox.receiveReceipt(liqCorrId, abi.encode("duplicate"));
    }

    // =========================================================================
    // TEST 10: XCM SetTopic encoding (VAL-BILATERAL-002)
    // =========================================================================

    function test_XcmSetTopic_CorrectMessageEncoding() public {
        bytes32 corrId = keccak256("set-topic-test");

        bytes memory expectedMsg = abi.encodePacked(
            bytes1(0x05), // VersionedXcm::V5
            bytes1(0x08), // compact(2) — 2 instructions
            bytes1(0x0a), // ClearOrigin
            bytes1(0x2c), // SetTopic
            corrId // 32-byte topic = correlationId
        );

        vm.mockCall(
            XCM_PRECOMPILE_ADDRESS,
            abi.encodeWithSelector(IXcm.send.selector, xcmAdapter.RELAY_DESTINATION(), expectedMsg),
            abi.encode()
        );

        vm.expectEmit(true, true, false, true, address(xcmNotifier));
        emit XcmLiquidationNotifier.LiquidationNotified(user, 1_000 * WAD, 1_100 * WAD, corrId);
        xcmAdapter.notifyLiquidation(user, 1_000 * WAD, 1_100 * WAD, corrId);
    }

    // =========================================================================
    // TEST 11: RiskGateway inline + PVM cross-VM verification (VAL-BILATERAL-005)
    // =========================================================================

    function test_RiskGateway_QuoteVerifiedDuringBorrow() public {
        vm.prank(user);
        lendingRouter.depositCollateralFromPAS{value: 10 * WAD}();

        vm.recordLogs();
        vm.prank(user);
        lendingEngine.borrow(2_000 * WAD);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // RiskGateway emits QuoteVerified when PVM result matches inline result
        assertTrue(
            _hasLog(logs, address(riskGateway), RiskGateway.QuoteVerified.selector),
            "QuoteVerified must fire (cross-VM verification pathway)"
        );
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /// @dev Extract bytes32 correlationId from an event at the given topic index.
    ///      topicIndex: 1=first indexed, 2=second indexed, 3=third indexed.
    function _corrId(Vm.Log[] memory logs, address emitter, bytes32 selector_, uint256 topicIdx)
        internal
        pure
        returns (bytes32)
    {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics[0] == selector_) {
                return logs[i].topics[topicIdx];
            }
        }
        return bytes32(0);
    }

    /// @dev Returns true if any log entry matches emitter + selector.
    function _hasLog(Vm.Log[] memory logs, address emitter, bytes32 selector_) internal pure returns (bool) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics[0] == selector_) return true;
        }
        return false;
    }

    function _authority(address target) internal view returns (address) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSignature("authority()"));
        require(ok, "authority() call failed");
        return abi.decode(data, (address));
    }
}
