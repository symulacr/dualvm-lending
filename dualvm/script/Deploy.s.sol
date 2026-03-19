// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import {DualVMAccessManager} from "../contracts/DualVMAccessManager.sol";
import {WPAS} from "../contracts/WPAS.sol";
import {USDCMock} from "../contracts/USDCMock.sol";
import {ManualOracle} from "../contracts/ManualOracle.sol";
import {GovernancePolicyStore} from "../contracts/GovernancePolicyStore.sol";
import {DeterministicRiskModel} from "../contracts/pvm/DeterministicRiskModel.sol";
import {RiskGateway} from "../contracts/RiskGateway.sol";
import {DebtPool} from "../contracts/DebtPool.sol";
import {LiquidationHookRegistry} from "../contracts/LiquidationHookRegistry.sol";
import {XcmLiquidationNotifier} from "../contracts/precompiles/XcmLiquidationNotifier.sol";
import {XcmNotifierAdapter} from "../contracts/XcmNotifierAdapter.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";
import {LendingRouter} from "../contracts/LendingRouter.sol";
import {XcmInbox} from "../contracts/XcmInbox.sol";
import {MarketVersionRegistry} from "../contracts/MarketVersionRegistry.sol";
import {MarketMigrationCoordinator} from "../contracts/migration/MarketMigrationCoordinator.sol";
import {GovernanceToken} from "../contracts/governance/GovernanceToken.sol";
import {DualVMGovernor} from "../contracts/governance/DualVMGovernor.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IMarketVersionRegistry} from "../contracts/interfaces/IMarketVersionRegistry.sol";

/// @title Deploy
/// @notice Foundry deployment script for the full DualVM Lending canonical system.
///
/// Deployment order:
///  1. AccessManager (DualVMAccessManager)
///  2. WPAS + USDCMock
///  3. ManualOracle (maxAge=1800s)
///  4. GovernancePolicyStore
///  5. DeterministicRiskModel (EVM version — PVM version deployed separately via resolc)
///  6. RiskGateway (with policyStore + quoteEngine)
///  7. DebtPool
///  8. LiquidationHookRegistry (needed before LendingEngine as the liquidationNotifier)
///  9. XcmLiquidationNotifier + XcmNotifierAdapter
/// 10. LendingEngine  (liquidationNotifier = hookRegistry address)
/// 11. LendingRouter
/// 12. Register XcmNotifierAdapter as DEFAULT_HOOK_TYPE in LiquidationHookRegistry
/// 13. XcmInbox
/// 14. MarketVersionRegistry + MarketMigrationCoordinator
/// 15. GovernanceToken + TimelockController + DualVMGovernor
/// 16. Wire all AccessManager roles
/// 17. Grant AccessManager admin to TimelockController
/// 18. Deployer renounces admin on AccessManager
/// 19. Deployer renounces DEFAULT_ADMIN_ROLE on TimelockController
///
/// After run(), writes a JSON manifest to deployments/deploy-manifest.json.
///
/// Usage (anvil):
///   anvil &
///   forge script script/Deploy.s.sol --fork-url http://localhost:8545 --broadcast
///
/// Usage (testnet):
///   PRIVATE_KEY=0x... forge script script/Deploy.s.sol \
///     --rpc-url https://eth-rpc-testnet.polkadot.io/ --broadcast --verify
contract Deploy is Script {
    // -------------------------------------------------------------------------
    // Role IDs (must match BaseTest.sol and deployGovernedSystem.ts)
    // -------------------------------------------------------------------------
    uint64 internal constant ROLE_EMERGENCY    = 1;
    uint64 internal constant ROLE_RISK_ADMIN   = 2;
    uint64 internal constant ROLE_TREASURY     = 3;
    uint64 internal constant ROLE_MINTER       = 4;
    uint64 internal constant ROLE_GOVERNANCE   = 5;
    uint64 internal constant ROLE_MIGRATION    = 6;
    uint64 internal constant ROLE_LENDING_CORE = 7;
    uint64 internal constant ROLE_ROUTER       = 8;
    uint64 internal constant ROLE_RELAY_CALLER = 9;

    // -------------------------------------------------------------------------
    // Risk model parameters (kinked utilization model)
    // -------------------------------------------------------------------------
    uint256 internal constant BASE_RATE_BPS                  = 200;    // 2%
    uint256 internal constant SLOPE1_BPS                     = 800;    // 8% below kink
    uint256 internal constant SLOPE2_BPS                     = 3_000;  // 30% above kink
    uint256 internal constant KINK_BPS                       = 8_000;  // 80% utilization kink
    uint256 internal constant HEALTHY_MAX_LTV_BPS            = 7_500;  // 75% healthy LTV
    uint256 internal constant STRESSED_MAX_LTV_BPS           = 6_500;  // 65% stressed LTV
    uint256 internal constant HEALTHY_LIQ_THRESHOLD_BPS      = 8_500;  // 85% healthy liquidation threshold
    uint256 internal constant STRESSED_LIQ_THRESHOLD_BPS     = 7_800;  // 78% stressed liquidation threshold
    uint256 internal constant STALE_BORROW_RATE_PENALTY_BPS  = 1_000;  // +10% penalty on stale oracle
    uint256 internal constant STRESSED_COLLATERAL_RATIO_BPS  = 14_000; // 140% — below this → stressed mode

    // -------------------------------------------------------------------------
    // Market parameters
    // -------------------------------------------------------------------------
    uint256 internal constant ORACLE_MAX_AGE              = 1_800;            // 30 minutes
    uint256 internal constant ORACLE_INITIAL_PRICE_WAD    = 1_000 * 1e18;    // 1000 USDC per WPAS
    uint256 internal constant ORACLE_MIN_PRICE_WAD        = 1 * 1e18;        // 1 USDC min
    uint256 internal constant ORACLE_MAX_PRICE_WAD        = 10_000 * 1e18;   // 10000 USDC max
    uint256 internal constant ORACLE_MAX_PRICE_CHANGE_BPS = 2_500;           // 25% max price change

    uint256 internal constant POOL_SUPPLY_CAP         = 5_000_000 * 1e18; // 5M USDC supply cap
    uint256 internal constant BORROW_CAP              = 4_000_000 * 1e18; // 4M USDC borrow cap
    uint256 internal constant MIN_BORROW_AMOUNT       = 100 * 1e18;       // 100 USDC minimum borrow
    uint256 internal constant RESERVE_FACTOR_BPS      = 1_000;            // 10% reserve factor
    uint256 internal constant MAX_LTV_BPS             = 7_000;            // 70% max LTV
    uint256 internal constant LIQUIDATION_THRESHOLD_BPS = 8_000;          // 80% liquidation threshold
    uint256 internal constant LIQUIDATION_BONUS_BPS   = 500;              // 5% liquidation bonus

    // -------------------------------------------------------------------------
    // Governance parameters (demo-friendly: short delays for hackathon)
    // -------------------------------------------------------------------------
    uint48  internal constant VOTING_DELAY        = 1;          // 1 second
    uint32  internal constant VOTING_PERIOD       = 300;        // 5 minutes
    uint256 internal constant TIMELOCK_MIN_DELAY  = 60;         // 60 seconds
    uint256 internal constant QUORUM_NUMERATOR    = 4;          // 4% quorum
    uint256 internal constant INITIAL_GOV_SUPPLY  = 1_000_000 * 1e18;  // 1M governance tokens

    // -------------------------------------------------------------------------
    // AccessManager execution delays for roles (0 = immediate for Timelock
    //   since Timelock itself enforces its own delay)
    // -------------------------------------------------------------------------
    uint32 internal constant EMERGENCY_DELAY  = 0;
    uint32 internal constant RISK_ADMIN_DELAY = 0;  // Timelock enforces delay
    uint32 internal constant TREASURY_DELAY   = 0;
    uint32 internal constant MINTER_DELAY     = 0;
    uint32 internal constant GOVERNANCE_DELAY = 0;
    uint32 internal constant MIGRATION_DELAY  = 0;

    // -------------------------------------------------------------------------
    // Manifest output path
    // -------------------------------------------------------------------------
    string internal constant MANIFEST_PATH = "./deployments/deploy-manifest.json";

    // -------------------------------------------------------------------------
    // run() — main entry point
    // -------------------------------------------------------------------------
    function run() external {
        // The private key must be provided via the --private-key CLI flag:
        //   forge script script/Deploy.s.sol --rpc-url <RPC> --broadcast \
        //     --private-key <KEY>
        //
        // For local anvil testing (default funded account):
        //   forge script script/Deploy.s.sol --rpc-url http://localhost:8545 \
        //     --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
        //
        // msg.sender inside vm.startBroadcast() is the address derived from --private-key.
        // We intentionally do NOT read PRIVATE_KEY in the script to avoid Foundry
        // censoring contract addresses that happen to share bytes with the key.
        vm.startBroadcast();
        address deployer = msg.sender;
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        // -----------------------------------------------------------------
        // 1. AccessManager — governance root, role manager
        // -----------------------------------------------------------------
        DualVMAccessManager accessManager = new DualVMAccessManager(deployer);
        console.log("AccessManager:              ", address(accessManager));

        // -----------------------------------------------------------------
        // 2. WPAS + USDCMock
        // -----------------------------------------------------------------
        WPAS wpas = new WPAS();
        USDCMock usdc = new USDCMock(address(accessManager));
        console.log("WPAS:                       ", address(wpas));
        console.log("USDCMock:                   ", address(usdc));

        // -----------------------------------------------------------------
        // 3. ManualOracle (maxAge=1800s — 30 minute freshness)
        // -----------------------------------------------------------------
        ManualOracle oracle = new ManualOracle(
            address(accessManager),
            ORACLE_INITIAL_PRICE_WAD,
            ORACLE_MAX_AGE,
            ORACLE_MIN_PRICE_WAD,
            ORACLE_MAX_PRICE_WAD,
            ORACLE_MAX_PRICE_CHANGE_BPS
        );
        console.log("ManualOracle:               ", address(oracle));

        // -----------------------------------------------------------------
        // 4. GovernancePolicyStore
        // -----------------------------------------------------------------
        GovernancePolicyStore policyStore = new GovernancePolicyStore(address(accessManager));
        console.log("GovernancePolicyStore:      ", address(policyStore));

        // -----------------------------------------------------------------
        // 5. DeterministicRiskModel (EVM version)
        //    NOTE: PVM version is compiled via resolc — see script/DeployPVM.sh
        // -----------------------------------------------------------------
        DeterministicRiskModel quoteEngine = new DeterministicRiskModel(
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
        console.log("DeterministicRiskModel:     ", address(quoteEngine));

        // -----------------------------------------------------------------
        // 6. RiskGateway (inline deterministic math + optional PVM cross-VM verification)
        // -----------------------------------------------------------------
        RiskGateway riskGateway = new RiskGateway(
            address(accessManager),
            address(quoteEngine),   // EVM quoteEngine (swap for PVM address post-resolc deploy)
            address(policyStore),
            RiskGateway.RiskModelConfig({
                baseRateBps:                     BASE_RATE_BPS,
                slope1Bps:                       SLOPE1_BPS,
                slope2Bps:                       SLOPE2_BPS,
                kinkBps:                         KINK_BPS,
                healthyMaxLtvBps:                HEALTHY_MAX_LTV_BPS,
                stressedMaxLtvBps:               STRESSED_MAX_LTV_BPS,
                healthyLiquidationThresholdBps:  HEALTHY_LIQ_THRESHOLD_BPS,
                stressedLiquidationThresholdBps: STRESSED_LIQ_THRESHOLD_BPS,
                staleBorrowRatePenaltyBps:       STALE_BORROW_RATE_PENALTY_BPS,
                stressedCollateralRatioBps:      STRESSED_COLLATERAL_RATIO_BPS
            })
        );
        console.log("RiskGateway:                ", address(riskGateway));

        // -----------------------------------------------------------------
        // 7. DebtPool (ERC-4626 LP vault)
        // -----------------------------------------------------------------
        DebtPool debtPool = new DebtPool(usdc, address(accessManager), POOL_SUPPLY_CAP);
        console.log("DebtPool:                   ", address(debtPool));

        // -----------------------------------------------------------------
        // 8. LiquidationHookRegistry — deployed before LendingEngine
        //    so its address can be used as the liquidationNotifier
        // -----------------------------------------------------------------
        LiquidationHookRegistry hookRegistry = new LiquidationHookRegistry(address(accessManager));
        console.log("LiquidationHookRegistry:    ", address(hookRegistry));

        // -----------------------------------------------------------------
        // 9. XcmLiquidationNotifier + XcmNotifierAdapter
        //    NOTE: XcmLiquidationNotifier.notifyLiquidation() will revert
        //    on chains without the XCM precompile (local anvil). The hook
        //    is wrapped in try/catch in LiquidationHookRegistry so it is
        //    safe to register even on non-Polkadot chains.
        // -----------------------------------------------------------------
        XcmLiquidationNotifier xcmNotifier = new XcmLiquidationNotifier();
        XcmNotifierAdapter xcmAdapter = new XcmNotifierAdapter(address(xcmNotifier));
        console.log("XcmLiquidationNotifier:     ", address(xcmNotifier));
        console.log("XcmNotifierAdapter:         ", address(xcmAdapter));

        // -----------------------------------------------------------------
        // 10. LendingEngine (liquidationNotifier = hookRegistry)
        // -----------------------------------------------------------------
        LendingEngine lendingEngine = new LendingEngine(
            address(accessManager),
            wpas,
            usdc,
            debtPool,
            oracle,
            riskGateway,
            LendingEngine.MarketConfig({
                borrowCap:                 BORROW_CAP,
                minBorrowAmount:           MIN_BORROW_AMOUNT,
                reserveFactorBps:          RESERVE_FACTOR_BPS,
                maxLtvBps:                 MAX_LTV_BPS,
                liquidationThresholdBps:   LIQUIDATION_THRESHOLD_BPS,
                liquidationBonusBps:       LIQUIDATION_BONUS_BPS
            }),
            address(hookRegistry)  // liquidationNotifier
        );
        console.log("LendingEngine:              ", address(lendingEngine));

        // Wire DebtPool to LendingEngine (admin-protected by default, deployer is admin)
        debtPool.setLendingCore(address(lendingEngine));

        // -----------------------------------------------------------------
        // 11. LendingRouter
        // -----------------------------------------------------------------
        LendingRouter lendingRouter = new LendingRouter(address(wpas), address(lendingEngine));
        console.log("LendingRouter:              ", address(lendingRouter));

        // -----------------------------------------------------------------
        // 12. Register XcmNotifierAdapter as DEFAULT_HOOK_TYPE
        //     Must happen BEFORE we restrict registerHook to ROLE_GOVERNANCE
        // -----------------------------------------------------------------
        hookRegistry.registerHook(hookRegistry.DEFAULT_HOOK_TYPE(), address(xcmAdapter));
        console.log("XcmNotifierAdapter registered as DEFAULT_HOOK_TYPE");

        // -----------------------------------------------------------------
        // 13. XcmInbox (de-duplicates async XCM receipts by correlationId)
        // -----------------------------------------------------------------
        XcmInbox xcmInbox = new XcmInbox(address(accessManager));
        console.log("XcmInbox:                   ", address(xcmInbox));

        // -----------------------------------------------------------------
        // 14. MarketVersionRegistry + MarketMigrationCoordinator
        // -----------------------------------------------------------------
        MarketVersionRegistry marketRegistry = new MarketVersionRegistry(address(accessManager));
        MarketMigrationCoordinator coordinator = new MarketMigrationCoordinator(
            address(accessManager),
            IMarketVersionRegistry(address(marketRegistry))
        );
        console.log("MarketVersionRegistry:      ", address(marketRegistry));
        console.log("MarketMigrationCoordinator: ", address(coordinator));

        // -----------------------------------------------------------------
        // 15. Governance: GovernanceToken + TimelockController + DualVMGovernor
        // -----------------------------------------------------------------
        // NOTE on GovernanceToken deployment:
        // We deploy with deployer as initialHolder so they have voting power.
        // In Foundry 1.5.x, contracts whose constructor calldata contains the deployer
        // address get their addresses marked as sensitive in output/manifest. The manifest
        // receives the correct address via a governor.token() staticcall (done after
        // vm.stopBroadcast so it's outside the sensitive-tracking context).
        GovernanceToken govToken = new GovernanceToken(
            address(accessManager),
            deployer,       // initial token holder — gives deployer voting power for demo
            INITIAL_GOV_SUPPLY
        );
        // Console.log of govToken address is censored by Foundry (known quirk).
        // The manifest file gets the correct address via staticcall. Use:
        //   cast call <dualVMGovernor> "token()(address)" --rpc-url <RPC>
        console.log("GovernanceToken:            ", address(govToken));

        // Deploy TimelockController with deployer as initial admin so we can wire
        // Governor as proposer/canceller before renouncing
        address[] memory proposers = new address[](0);
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone can execute (after queue delay)
        TimelockController timelock = new TimelockController(
            TIMELOCK_MIN_DELAY,
            proposers,
            executors,
            deployer              // initial admin — renounced at end
        );
        console.log("TimelockController:         ", address(timelock));

        // Deploy DualVMGovernor
        DualVMGovernor governor = new DualVMGovernor(
            IVotes(address(govToken)),
            timelock,
            VOTING_DELAY,
            VOTING_PERIOD,
            QUORUM_NUMERATOR
        );
        console.log("DualVMGovernor:             ", address(governor));

        // Wire Governor as proposer + canceller on TimelockController
        timelock.grantRole(timelock.PROPOSER_ROLE(),   address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(),  address(governor));

        // -----------------------------------------------------------------
        // 16. Wire AccessManager roles
        // -----------------------------------------------------------------
        _wireAccessManagerRoles(
            accessManager,
            address(timelock),
            address(lendingEngine),
            address(lendingRouter),
            address(coordinator),
            address(oracle),
            address(riskGateway),
            address(debtPool),
            address(usdc),
            address(policyStore),
            address(hookRegistry),
            address(marketRegistry),
            address(xcmInbox),
            address(govToken)
        );

        // -----------------------------------------------------------------
        // 17. Grant AccessManager admin to TimelockController
        // -----------------------------------------------------------------
        accessManager.grantRole(accessManager.ADMIN_ROLE(), address(timelock), 0);
        console.log("AccessManager admin granted to TimelockController");

        // -----------------------------------------------------------------
        // 18. Deployer renounces admin on AccessManager
        // -----------------------------------------------------------------
        accessManager.renounceRole(accessManager.ADMIN_ROLE(), deployer);
        console.log("Deployer renounced AccessManager admin");

        // -----------------------------------------------------------------
        // 19. Deployer renounces DEFAULT_ADMIN_ROLE on TimelockController
        // -----------------------------------------------------------------
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), deployer);
        console.log("Deployer renounced TimelockController admin");

        vm.stopBroadcast();

        // -----------------------------------------------------------------
        // Write deployment manifest JSON.
        //
        // NOTE on GovernanceToken address censoring:
        // Foundry censors the GovernanceToken address in outputs because the deployer
        // private key is tracked as sensitive. As a fallback, we also derive the
        // GovernanceToken address via governor.token() (a read-only call that returns
        // the IVotes token address). The address is also readable via:
        //   cast call <govAddr> "token()(address)" --rpc-url <RPC>
        // -----------------------------------------------------------------
        // Read the GovernanceToken address via staticcall to governor.token().
        // This avoids Foundry's sensitive-value censoring: staticcall results are
        // not tracked as "broadcast" outputs and should not be redacted in the manifest.
        (bool ok, bytes memory tokenData) = address(governor).staticcall(
            abi.encodeWithSignature("token()")
        );
        require(ok, "Deploy: governor.token() staticcall failed");
        address govTokenAddr = abi.decode(tokenData, (address));
        require(govTokenAddr == address(govToken), "Deploy: governor.token() mismatch");

        _writeManifest(
            address(accessManager),
            address(wpas),
            address(usdc),
            address(oracle),
            address(policyStore),
            address(quoteEngine),
            address(riskGateway),
            address(debtPool),
            address(hookRegistry),
            address(xcmNotifier),
            address(xcmAdapter),
            address(lendingEngine),
            address(lendingRouter),
            address(xcmInbox),
            address(marketRegistry),
            address(coordinator),
            govTokenAddr,
            address(timelock),
            address(governor)
        );
        console.log("Manifest written to:", MANIFEST_PATH);
        console.log("NOTE: If governanceToken shows as *** in manifest, retrieve via:");
        console.log("  cast call <dualVMGovernor> 'token()(address)' --rpc-url <RPC>");
    }

    // -------------------------------------------------------------------------
    // Internal: role wiring
    // -------------------------------------------------------------------------

    function _wireAccessManagerRoles(
        DualVMAccessManager am,
        address timelockAddr,
        address lendingEngineAddr,
        address lendingRouterAddr,
        address coordinatorAddr,
        address oracleAddr,
        address riskGatewayAddr,
        address debtPoolAddr,
        address usdcAddr,
        address policyStoreAddr,
        address hookRegistryAddr,
        address marketRegistryAddr,
        address xcmInboxAddr,
        address govTokenAddr
    ) internal {
        // --- Label roles for readability on Blockscout ---
        am.labelRole(ROLE_EMERGENCY,    "EMERGENCY");
        am.labelRole(ROLE_RISK_ADMIN,   "RISK_ADMIN");
        am.labelRole(ROLE_TREASURY,     "TREASURY");
        am.labelRole(ROLE_MINTER,       "MINTER");
        am.labelRole(ROLE_GOVERNANCE,   "GOVERNANCE");
        am.labelRole(ROLE_MIGRATION,    "MIGRATION");
        am.labelRole(ROLE_LENDING_CORE, "LENDING_CORE");
        am.labelRole(ROLE_ROUTER,       "ROUTER");
        am.labelRole(ROLE_RELAY_CALLER, "RELAY_CALLER");

        // --- Grant operational roles to TimelockController ---
        // Execution delay = 0 on AM since Timelock enforces its own queue delay
        am.grantRole(ROLE_EMERGENCY,    timelockAddr,      EMERGENCY_DELAY);
        am.grantRole(ROLE_RISK_ADMIN,   timelockAddr,      RISK_ADMIN_DELAY);
        am.grantRole(ROLE_TREASURY,     timelockAddr,      TREASURY_DELAY);
        am.grantRole(ROLE_MINTER,       timelockAddr,      MINTER_DELAY);
        am.grantRole(ROLE_GOVERNANCE,   timelockAddr,      GOVERNANCE_DELAY);
        am.grantRole(ROLE_MIGRATION,    timelockAddr,      MIGRATION_DELAY);
        am.grantRole(ROLE_RELAY_CALLER, timelockAddr,      0);

        // --- Grant service account roles to protocol contracts ---
        // LendingEngine needs LENDING_CORE to call riskGateway.quoteViaTicket
        am.grantRole(ROLE_LENDING_CORE, lendingEngineAddr, 0);
        // LendingRouter needs ROUTER to call lendingEngine.depositCollateralFor
        am.grantRole(ROLE_ROUTER,       lendingRouterAddr, 0);
        // MarketMigrationCoordinator needs MIGRATION to call export/importMigratedPosition
        am.grantRole(ROLE_MIGRATION,    coordinatorAddr,   0);

        // --- LendingEngine function → role mappings ---
        {
            bytes4[] memory emergencyFns = new bytes4[](2);
            emergencyFns[0] = LendingEngine.pause.selector;
            emergencyFns[1] = LendingEngine.unpause.selector;
            am.setTargetFunctionRole(lendingEngineAddr, emergencyFns, ROLE_EMERGENCY);

            bytes4[] memory riskFns = new bytes4[](1);
            riskFns[0] = LendingEngine.freezeNewDebt.selector;
            am.setTargetFunctionRole(lendingEngineAddr, riskFns, ROLE_EMERGENCY);

            bytes4[] memory routerFns = new bytes4[](1);
            routerFns[0] = LendingEngine.depositCollateralFor.selector;
            am.setTargetFunctionRole(lendingEngineAddr, routerFns, ROLE_ROUTER);

            bytes4[] memory migFns = new bytes4[](2);
            migFns[0] = LendingEngine.exportPositionForMigration.selector;
            migFns[1] = LendingEngine.importMigratedPosition.selector;
            am.setTargetFunctionRole(lendingEngineAddr, migFns, ROLE_MIGRATION);
        }

        // --- DebtPool function → role mappings ---
        {
            bytes4[] memory emergencyFns = new bytes4[](2);
            emergencyFns[0] = DebtPool.pause.selector;
            emergencyFns[1] = DebtPool.unpause.selector;
            am.setTargetFunctionRole(debtPoolAddr, emergencyFns, ROLE_EMERGENCY);

            bytes4[] memory treasuryFns = new bytes4[](1);
            treasuryFns[0] = DebtPool.claimReserves.selector;
            am.setTargetFunctionRole(debtPoolAddr, treasuryFns, ROLE_TREASURY);
        }

        // --- ManualOracle function → role mappings ---
        {
            bytes4[] memory emergencyFns = new bytes4[](2);
            emergencyFns[0] = ManualOracle.pause.selector;
            emergencyFns[1] = ManualOracle.unpause.selector;
            am.setTargetFunctionRole(oracleAddr, emergencyFns, ROLE_EMERGENCY);

            bytes4[] memory riskFns = new bytes4[](3);
            riskFns[0] = ManualOracle.setPrice.selector;
            riskFns[1] = ManualOracle.setMaxAge.selector;
            riskFns[2] = ManualOracle.setCircuitBreaker.selector;
            am.setTargetFunctionRole(oracleAddr, riskFns, ROLE_RISK_ADMIN);
        }

        // --- RiskGateway function → role mappings ---
        {
            bytes4[] memory lendingCoreFns = new bytes4[](1);
            lendingCoreFns[0] = RiskGateway.quoteViaTicket.selector;
            am.setTargetFunctionRole(riskGatewayAddr, lendingCoreFns, ROLE_LENDING_CORE);
        }

        // --- USDCMock function → role mappings ---
        {
            bytes4[] memory minterFns = new bytes4[](1);
            minterFns[0] = USDCMock.mint.selector;
            am.setTargetFunctionRole(usdcAddr, minterFns, ROLE_MINTER);
        }

        // --- GovernancePolicyStore function → role mappings ---
        {
            bytes4[] memory riskFns = new bytes4[](2);
            riskFns[0] = GovernancePolicyStore.setPolicy.selector;
            riskFns[1] = GovernancePolicyStore.removePolicy.selector;
            am.setTargetFunctionRole(policyStoreAddr, riskFns, ROLE_RISK_ADMIN);
        }

        // --- LiquidationHookRegistry function → role mappings ---
        //     NOTE: registerHook was called BEFORE this mapping is set,
        //     so the initial XcmNotifierAdapter registration succeeded under ADMIN_ROLE.
        {
            bytes4[] memory govFns = new bytes4[](2);
            govFns[0] = LiquidationHookRegistry.registerHook.selector;
            govFns[1] = LiquidationHookRegistry.deregisterHook.selector;
            am.setTargetFunctionRole(hookRegistryAddr, govFns, ROLE_GOVERNANCE);
        }

        // --- MarketVersionRegistry function → role mappings ---
        {
            bytes4[] memory govFns = new bytes4[](2);
            govFns[0] = MarketVersionRegistry.registerVersion.selector;
            govFns[1] = MarketVersionRegistry.activateVersion.selector;
            am.setTargetFunctionRole(marketRegistryAddr, govFns, ROLE_GOVERNANCE);
        }

        // --- MarketMigrationCoordinator function → role mappings ---
        {
            bytes4[] memory migFns = new bytes4[](2);
            migFns[0] = MarketMigrationCoordinator.openMigrationRoute.selector;
            migFns[1] = MarketMigrationCoordinator.closeMigrationRoute.selector;
            am.setTargetFunctionRole(coordinatorAddr, migFns, ROLE_MIGRATION);
        }

        // --- XcmInbox function → role mappings ---
        {
            bytes4[] memory relayFns = new bytes4[](1);
            relayFns[0] = XcmInbox.receiveReceipt.selector;
            am.setTargetFunctionRole(xcmInboxAddr, relayFns, ROLE_RELAY_CALLER);
        }

        // --- GovernanceToken function → role mappings ---
        {
            bytes4[] memory minterFns = new bytes4[](1);
            minterFns[0] = GovernanceToken.mint.selector;
            am.setTargetFunctionRole(govTokenAddr, minterFns, ROLE_MINTER);
        }

        console.log("AccessManager roles wired");
    }

    // -------------------------------------------------------------------------
    // Internal: write JSON manifest
    // -------------------------------------------------------------------------
    // We use vm.writeFile with a manually constructed JSON string rather than
    // vm.writeJson. This is necessary to handle the GovernanceToken address, which
    // Foundry 1.5.x censors when written via vm.serializeAddress because the deployer
    // address appears in its constructor calldata (as initialHolder).
    //
    // The _addrHex() helper computes the lowercase hex address WITHOUT using
    // vm.toString(), which bypasses Foundry's sensitive-value pattern matching
    // (which only checks checksummed EIP-55 addresses).
    // -------------------------------------------------------------------------

    function _writeManifest(
        address accessManagerAddr,
        address wpasAddr,
        address usdcAddr,
        address oracleAddr,
        address policyStoreAddr,
        address quoteEngineAddr,
        address riskGatewayAddr,
        address debtPoolAddr,
        address hookRegistryAddr,
        address xcmNotifierAddr,
        address xcmAdapterAddr,
        address lendingEngineAddr,
        address lendingRouterAddr,
        address xcmInboxAddr,
        address marketRegistryAddr,
        address coordinatorAddr,
        address govTokenAddr,
        address timelockAddr,
        address governorAddr
    ) internal {
        string memory json = string.concat(
            '{\n',
            '  "chainId": ',    vm.toString(block.chainid),   ',\n',
            '  "deployedAt": ', vm.toString(block.timestamp),  ',\n',
            '  "accessManager": "',              _addrHex(accessManagerAddr),  '",\n',
            '  "wpas": "',                       _addrHex(wpasAddr),            '",\n',
            '  "usdcMock": "',                   _addrHex(usdcAddr),            '",\n',
            '  "manualOracle": "',               _addrHex(oracleAddr),          '",\n',
            '  "governancePolicyStore": "',      _addrHex(policyStoreAddr),     '",\n',
            '  "deterministicRiskModel": "',     _addrHex(quoteEngineAddr),     '",\n',
            '  "riskGateway": "',                _addrHex(riskGatewayAddr),     '",\n',
            '  "debtPool": "',                   _addrHex(debtPoolAddr),        '",\n',
            '  "liquidationHookRegistry": "',   _addrHex(hookRegistryAddr),    '",\n',
            '  "xcmLiquidationNotifier": "',    _addrHex(xcmNotifierAddr),     '",\n',
            '  "xcmNotifierAdapter": "',        _addrHex(xcmAdapterAddr),      '",\n',
            '  "lendingEngine": "',             _addrHex(lendingEngineAddr),   '",\n',
            '  "lendingRouter": "',             _addrHex(lendingRouterAddr),   '",\n',
            '  "xcmInbox": "',                  _addrHex(xcmInboxAddr),        '",\n',
            '  "marketVersionRegistry": "',     _addrHex(marketRegistryAddr),  '",\n',
            '  "marketMigrationCoordinator": "',_addrHex(coordinatorAddr),     '",\n',
            '  "governanceToken": "',           _addrHex(govTokenAddr),        '",\n',
            '  "timelockController": "',        _addrHex(timelockAddr),        '",\n',
            '  "dualVMGovernor": "',            _addrHex(governorAddr),        '"\n',
            '}\n'
        );
        vm.writeFile(MANIFEST_PATH, json);
    }

    /// @dev Converts an address to a lowercase "0x..." hex string using pure Solidity.
    ///      This avoids Foundry's vm.toString() which participates in sensitive-value
    ///      censoring. The resulting lowercase hex bypasses the EIP-55 checksummed
    ///      address pattern that Foundry uses for censored-value detection.
    function _addrHex(address addr) internal pure returns (string memory) {
        bytes20 b = bytes20(addr);
        bytes memory result = new bytes(42);
        result[0] = "0";
        result[1] = "x";
        bytes16 hexChars = "0123456789abcdef";
        for (uint256 i = 0; i < 20; i++) {
            result[2 + i * 2]     = hexChars[uint8(b[i]) >> 4];
            result[3 + i * 2]     = hexChars[uint8(b[i]) & 0x0f];
        }
        return string(result);
    }
}
