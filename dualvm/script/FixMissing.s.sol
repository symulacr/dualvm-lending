// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {RiskGateway} from "../contracts/RiskGateway.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";
import {LendingRouter} from "../contracts/LendingRouter.sol";
import {DebtPool} from "../contracts/DebtPool.sol";
import {ManualOracle} from "../contracts/ManualOracle.sol";
import {IRiskAdapter} from "../contracts/interfaces/IRiskAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/// @notice Deploys RiskGateway, LendingEngine, and LendingRouter with the new GovernancePolicyStore address.
///         Then outputs the new addresses for manifest update.
contract FixMissing is Script {
    // New GovernancePolicyStore deployed manually
    address constant NEW_POLICY_STORE = 0x7D32E964E02A879f9b092947101431471b4cE7d1;

    // From latest deploy-manifest.json
    address constant ACCESS_MANAGER = 0x7568c7826191bc8AC3C37679915B718960BdC1C6;
    address constant PVM_RISK_MODEL = 0x1e6903a816BE0BC013291bbED547df45BdC9E86c;
    address constant WPAS = 0x16ba06ba6a4f009E6c8D9219cBE2E1612D52081C;
    address constant USDC = 0x58FD81de77F705dADFEbB3B2eBb0a90B6edb8304;
    address constant ORACLE = 0x29680E0Eb09B9f901D9e4217CB3CD81632C15e24;
    address constant DEBT_POOL = 0x99aAAD5FECd4d5AFf200B8F3E45F07EcC2d309D8;
    address constant LIQ_HOOK_REGISTRY = 0x3E5A6e0C1e6cb1E7D81Be67E1Bb918FE89f9f68D;

    // Risk model params (from Deploy.s.sol constants)
    uint256 constant BASE_RATE_BPS = 200;
    uint256 constant SLOPE1_BPS = 800;
    uint256 constant SLOPE2_BPS = 3_000;
    uint256 constant KINK_BPS = 8_000;
    uint256 constant HEALTHY_MAX_LTV_BPS = 7_500;
    uint256 constant STRESSED_MAX_LTV_BPS = 5_000;
    uint256 constant HEALTHY_LIQ_THRESHOLD_BPS = 8_500;
    uint256 constant STRESSED_LIQ_THRESHOLD_BPS = 7_000;
    uint256 constant STALE_BORROW_RATE_PENALTY_BPS = 1_000;
    uint256 constant STRESSED_COLLATERAL_RATIO_BPS = 14_000;

    // LendingEngine params
    uint256 constant BORROW_CAP = 4_000_000e18;
    uint256 constant MIN_BORROW = 100e18;
    uint256 constant LIQ_BONUS_BPS = 500;
    uint256 constant RESERVE_FACTOR_BPS = 1_000;
    uint256 constant MAX_LTV_BPS = 7_000;
    uint256 constant MAX_LIQ_THRESHOLD_BPS = 8_000;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        // 1. Deploy new RiskGateway with new PolicyStore
        RiskGateway newRiskGateway = new RiskGateway(
            ACCESS_MANAGER,
            PVM_RISK_MODEL,
            NEW_POLICY_STORE,
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
        console.log("New RiskGateway:     ", address(newRiskGateway));

        // 2. Deploy new LendingEngine with new RiskGateway
        LendingEngine newEngine = new LendingEngine(
            ACCESS_MANAGER,
            IERC20(WPAS),
            IERC20(USDC),
            DebtPool(DEBT_POOL),
            ManualOracle(ORACLE),
            IRiskAdapter(address(newRiskGateway)),
            LendingEngine.MarketConfig({
                borrowCap: BORROW_CAP,
                minBorrowAmount: MIN_BORROW,
                liquidationBonusBps: LIQ_BONUS_BPS,
                reserveFactorBps: RESERVE_FACTOR_BPS,
                maxLtvBps: MAX_LTV_BPS,
                liquidationThresholdBps: MAX_LIQ_THRESHOLD_BPS
            }),
            LIQ_HOOK_REGISTRY
        );
        console.log("New LendingEngine:   ", address(newEngine));

        // 3. Deploy new LendingRouter
        LendingRouter newRouter = new LendingRouter(WPAS, address(newEngine));
        console.log("New LendingRouter:   ", address(newRouter));

        vm.stopBroadcast();

        console.log("");
        console.log("NEXT STEPS:");
        console.log("1. Grant ROLE_LENDING_CORE (7) to new LendingEngine via governance");
        console.log("2. Grant ROLE_ROUTER (8) to new LendingRouter via governance");
        console.log("3. Update deploy-manifest.json with new addresses");
    }
}
