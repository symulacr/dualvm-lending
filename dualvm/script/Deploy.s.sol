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
    uint64 internal constant ROLE_EMERGENCY = 1;
    uint64 internal constant ROLE_RISK_ADMIN = 2;
    uint64 internal constant ROLE_TREASURY = 3;
    uint64 internal constant ROLE_MINTER = 4;
    uint64 internal constant ROLE_GOVERNANCE = 5;
    uint64 internal constant ROLE_MIGRATION = 6;
    uint64 internal constant ROLE_LENDING_CORE = 7;
    uint64 internal constant ROLE_ROUTER = 8;
    uint64 internal constant ROLE_RELAY_CALLER = 9;
    uint64 internal constant ROLE_USDC_MINTER = 10;

    // -------------------------------------------------------------------------
    // Risk model parameters (kinked utilization model)
    // -------------------------------------------------------------------------
    uint256 internal constant BASE_RATE_BPS = 200; // 2%
    uint256 internal constant SLOPE1_BPS = 800; // 8% below kink
    uint256 internal constant SLOPE2_BPS = 3_000; // 30% above kink
    uint256 internal constant KINK_BPS = 8_000; // 80% utilization kink
    uint256 internal constant HEALTHY_MAX_LTV_BPS = 7_500; // 75% healthy LTV
    uint256 internal constant STRESSED_MAX_LTV_BPS = 6_500; // 65% stressed LTV
    uint256 internal constant HEALTHY_LIQ_THRESHOLD_BPS = 8_500; // 85% healthy liquidation threshold
    uint256 internal constant STRESSED_LIQ_THRESHOLD_BPS = 7_800; // 78% stressed liquidation threshold
    uint256 internal constant STALE_BORROW_RATE_PENALTY_BPS = 1_000; // +10% penalty on stale oracle
    uint256 internal constant STRESSED_COLLATERAL_RATIO_BPS = 14_000; // 140% — below this → stressed mode

    // -------------------------------------------------------------------------
    // Market parameters
    // -------------------------------------------------------------------------
    uint256 internal constant ORACLE_MAX_AGE = 604_800; // 7 days (testnet-friendly)
    uint256 internal constant ORACLE_INITIAL_PRICE_WAD = 1_000 * 1e18; // 1000 USDC per WPAS
    uint256 internal constant ORACLE_MIN_PRICE_WAD = 1 * 1e18; // 1 USDC min
    uint256 internal constant ORACLE_MAX_PRICE_WAD = 10_000 * 1e18; // 10000 USDC max
    uint256 internal constant ORACLE_MAX_PRICE_CHANGE_BPS = 10_000; // 100% max price change (testnet-friendly)

    uint256 internal constant POOL_SUPPLY_CAP = 5_000_000 * 1e18; // 5M USDC supply cap
    uint256 internal constant BORROW_CAP = 4_000_000 * 1e18; // 4M USDC borrow cap
    uint256 internal constant MIN_BORROW_AMOUNT = 100 * 1e18; // 100 USDC minimum borrow
    uint256 internal constant RESERVE_FACTOR_BPS = 1_000; // 10% reserve factor
    uint256 internal constant MAX_LTV_BPS = 7_000; // 70% max LTV
    uint256 internal constant LIQUIDATION_THRESHOLD_BPS = 8_000; // 80% liquidation threshold
    uint256 internal constant LIQUIDATION_BONUS_BPS = 500; // 5% liquidation bonus

    // -------------------------------------------------------------------------
    // Governance parameters (demo-friendly: short delays for hackathon)
    // -------------------------------------------------------------------------
    uint48 internal constant VOTING_DELAY = 1; // 1 second
    uint32 internal constant VOTING_PERIOD = 30; // 30 seconds (testnet-friendly)
    uint256 internal constant TIMELOCK_MIN_DELAY = 10; // 10 seconds (testnet-friendly)
    uint256 internal constant QUORUM_NUMERATOR = 4; // 4% quorum
    uint256 internal constant INITIAL_GOV_SUPPLY = 1_000_000 * 1e18; // 1M governance tokens

    // -------------------------------------------------------------------------
    // AccessManager execution delays for roles (0 = immediate for Timelock
    //   since Timelock itself enforces its own delay)
    // -------------------------------------------------------------------------
    uint32 internal constant EMERGENCY_DELAY = 0;
    uint32 internal constant RISK_ADMIN_DELAY = 0; // Timelock enforces delay
    uint32 internal constant TREASURY_DELAY = 0;
    uint32 internal constant MINTER_DELAY = 0;
    uint32 internal constant GOVERNANCE_DELAY = 0;
    uint32 internal constant MIGRATION_DELAY = 0;

    // -------------------------------------------------------------------------
    // Manifest output path
    // -------------------------------------------------------------------------
    string internal constant MANIFEST_PATH = "./deployments/deploy-manifest.json";

    // -------------------------------------------------------------------------
    // PVM quote engine override (set PVM_QUOTE_ENGINE_ADDRESS in env to use
    // the resolc-compiled PVM DeterministicRiskModel as the live quoteEngine).
    // If unset (address(0)), the freshly-deployed EVM version is used instead.
    // -------------------------------------------------------------------------
    address internal pvmQuoteEngineAddress;

    // -------------------------------------------------------------------------
    // Struct: packs all deployed addresses to avoid stack-too-deep without via_ir
    // -------------------------------------------------------------------------
    struct Addresses {
        address accessManager;
        address wpas;
        address usdc;
        address oracle;
        address policyStore;
        address evmRiskModel;
        address pvmRiskModel;
        address riskGateway;
        address debtPool;
        address hookRegistry;
        address xcmNotifier;
        address xcmAdapter;
        address lendingEngine;
        address lendingRouter;
        address xcmInbox;
        address marketRegistry;
        address coordinator;
        address govToken;
        address timelock;
        address governor;
    }

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
        // Read optional PVM quoteEngine override before broadcasting
        pvmQuoteEngineAddress = vm.envOr("PVM_QUOTE_ENGINE_ADDRESS", address(0));
        if (pvmQuoteEngineAddress != address(0)) {
            console.log("PVM quoteEngine override:", pvmQuoteEngineAddress);
        }

        vm.startBroadcast();
        address deployer = msg.sender;
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        Addresses memory a;

        // -----------------------------------------------------------------
        // 1. AccessManager — governance root, role manager
        // -----------------------------------------------------------------
        a.accessManager = address(new DualVMAccessManager(deployer));
        console.log("AccessManager:              ", a.accessManager);

        // -----------------------------------------------------------------
        // 2. WPAS + USDCMock
        // -----------------------------------------------------------------
        a.wpas = address(new WPAS());
        a.usdc = address(new USDCMock(a.accessManager));
        console.log("WPAS:                       ", a.wpas);
        console.log("USDCMock:                   ", a.usdc);

        // -----------------------------------------------------------------
        // 3. ManualOracle (maxAge=1800s — 30 minute freshness)
        // -----------------------------------------------------------------
        a.oracle = address(
            new ManualOracle(
                a.accessManager,
                ORACLE_INITIAL_PRICE_WAD,
                ORACLE_MAX_AGE,
                ORACLE_MIN_PRICE_WAD,
                ORACLE_MAX_PRICE_WAD,
                ORACLE_MAX_PRICE_CHANGE_BPS
            )
        );
        console.log("ManualOracle:               ", a.oracle);

        // -----------------------------------------------------------------
        // 4. GovernancePolicyStore
        // -----------------------------------------------------------------
        a.policyStore = address(new GovernancePolicyStore(a.accessManager));
        console.log("GovernancePolicyStore:      ", a.policyStore);

        // -----------------------------------------------------------------
        // 5. DeterministicRiskModel (EVM version)
        //    NOTE: PVM version is compiled via resolc — see script/DeployPVM.sh
        //    If PVM_QUOTE_ENGINE_ADDRESS is set, skip EVM deployment (PVM is used instead).
        // -----------------------------------------------------------------
        if (pvmQuoteEngineAddress == address(0)) {
            a.evmRiskModel = address(
                new DeterministicRiskModel(
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
                )
            );
            console.log("DeterministicRiskModel (EVM):", a.evmRiskModel);
        } else {
            // Skip EVM deployment; use PVM address for both fields
            a.evmRiskModel = pvmQuoteEngineAddress;
            console.log("DeterministicRiskModel:     SKIPPED (using PVM version as quoteEngine)");
        }

        // -----------------------------------------------------------------
        // 6. RiskGateway (inline deterministic math + optional PVM cross-VM verification)
        //    Use PVM quoteEngine if PVM_QUOTE_ENGINE_ADDRESS is set; otherwise use EVM version.
        // -----------------------------------------------------------------
        a.pvmRiskModel = (pvmQuoteEngineAddress != address(0)) ? pvmQuoteEngineAddress : a.evmRiskModel;
        a.riskGateway = address(
            new RiskGateway(
                a.accessManager,
                a.pvmRiskModel,
                a.policyStore,
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
            )
        );
        console.log("RiskGateway:                ", a.riskGateway);

        // -----------------------------------------------------------------
        // 7. DebtPool (ERC-4626 LP vault)
        // -----------------------------------------------------------------
        a.debtPool = address(new DebtPool(USDCMock(a.usdc), a.accessManager, POOL_SUPPLY_CAP));
        console.log("DebtPool:                   ", a.debtPool);

        // -----------------------------------------------------------------
        // 8. LiquidationHookRegistry — deployed before LendingEngine
        //    so its address can be used as the liquidationNotifier
        // -----------------------------------------------------------------
        a.hookRegistry = address(new LiquidationHookRegistry(a.accessManager));
        console.log("LiquidationHookRegistry:    ", a.hookRegistry);

        // -----------------------------------------------------------------
        // 9. XcmLiquidationNotifier + XcmNotifierAdapter
        //    NOTE: XcmLiquidationNotifier.notifyLiquidation() will revert
        //    on chains without the XCM precompile (local anvil). The hook
        //    is wrapped in try/catch in LiquidationHookRegistry so it is
        //    safe to register even on non-Polkadot chains.
        // -----------------------------------------------------------------
        a.xcmNotifier = address(new XcmLiquidationNotifier());
        a.xcmAdapter = address(new XcmNotifierAdapter(a.xcmNotifier));
        console.log("XcmLiquidationNotifier:     ", a.xcmNotifier);
        console.log("XcmNotifierAdapter:         ", a.xcmAdapter);

        // -----------------------------------------------------------------
        // 10. LendingEngine (liquidationNotifier = hookRegistry)
        // -----------------------------------------------------------------
        a.lendingEngine = address(
            new LendingEngine(
                a.accessManager,
                WPAS(payable(a.wpas)),
                USDCMock(a.usdc),
                DebtPool(a.debtPool),
                ManualOracle(a.oracle),
                RiskGateway(a.riskGateway),
                LendingEngine.MarketConfig({
                    borrowCap: BORROW_CAP,
                    minBorrowAmount: MIN_BORROW_AMOUNT,
                    reserveFactorBps: RESERVE_FACTOR_BPS,
                    maxLtvBps: MAX_LTV_BPS,
                    liquidationThresholdBps: LIQUIDATION_THRESHOLD_BPS,
                    liquidationBonusBps: LIQUIDATION_BONUS_BPS
                }),
                a.hookRegistry // liquidationNotifier
            )
        );
        console.log("LendingEngine:              ", a.lendingEngine);

        // Wire DebtPool to LendingEngine (admin-protected by default, deployer is admin)
        DebtPool(a.debtPool).setLendingCore(a.lendingEngine);

        // -----------------------------------------------------------------
        // 11. LendingRouter
        // -----------------------------------------------------------------
        a.lendingRouter = address(new LendingRouter(a.wpas, a.lendingEngine));
        console.log("LendingRouter:              ", a.lendingRouter);

        // -----------------------------------------------------------------
        // 12. Register XcmNotifierAdapter as DEFAULT_HOOK_TYPE
        //     Must happen BEFORE we restrict registerHook to ROLE_GOVERNANCE
        // -----------------------------------------------------------------
        LiquidationHookRegistry(a.hookRegistry)
            .registerHook(LiquidationHookRegistry(a.hookRegistry).DEFAULT_HOOK_TYPE(), a.xcmAdapter);
        console.log("XcmNotifierAdapter registered as DEFAULT_HOOK_TYPE");

        // -----------------------------------------------------------------
        // 13. XcmInbox (de-duplicates async XCM receipts by correlationId)
        // -----------------------------------------------------------------
        a.xcmInbox = address(new XcmInbox(a.accessManager));
        console.log("XcmInbox:                   ", a.xcmInbox);

        // -----------------------------------------------------------------
        // 14. MarketVersionRegistry + MarketMigrationCoordinator
        // -----------------------------------------------------------------
        a.marketRegistry = address(new MarketVersionRegistry(a.accessManager));
        a.coordinator =
            address(new MarketMigrationCoordinator(a.accessManager, IMarketVersionRegistry(a.marketRegistry)));
        console.log("MarketVersionRegistry:      ", a.marketRegistry);
        console.log("MarketMigrationCoordinator: ", a.coordinator);

        // -----------------------------------------------------------------
        // 15. Governance: GovernanceToken + TimelockController + DualVMGovernor
        // -----------------------------------------------------------------
        a.govToken = address(
            new GovernanceToken(
                a.accessManager,
                deployer, // initial token holder — gives deployer voting power for demo
                INITIAL_GOV_SUPPLY
            )
        );
        console.log("GovernanceToken:            ", a.govToken);

        // Self-delegate for governance voting power
        GovernanceToken(a.govToken).delegate(deployer);

        // Deploy TimelockController with deployer as initial admin
        {
            address[] memory proposers = new address[](0);
            address[] memory executors = new address[](1);
            executors[0] = address(0); // anyone can execute (after queue delay)
            a.timelock = address(
                new TimelockController(
                    TIMELOCK_MIN_DELAY,
                    proposers,
                    executors,
                    deployer // initial admin — renounced at end
                )
            );
        }
        console.log("TimelockController:         ", a.timelock);

        // Deploy DualVMGovernor
        a.governor = address(
            new DualVMGovernor(
                IVotes(a.govToken),
                TimelockController(payable(a.timelock)),
                VOTING_DELAY,
                VOTING_PERIOD,
                QUORUM_NUMERATOR
            )
        );
        console.log("DualVMGovernor:             ", a.governor);

        // Wire Governor as proposer + canceller on TimelockController
        TimelockController(payable(a.timelock))
            .grantRole(TimelockController(payable(a.timelock)).PROPOSER_ROLE(), a.governor);
        TimelockController(payable(a.timelock))
            .grantRole(TimelockController(payable(a.timelock)).CANCELLER_ROLE(), a.governor);

        // -----------------------------------------------------------------
        // 16. Wire AccessManager roles
        // -----------------------------------------------------------------
        _wireAccessManagerRoles(a);

        // -----------------------------------------------------------------
        // 17. Grant AccessManager admin to TimelockController
        // -----------------------------------------------------------------
        DualVMAccessManager(a.accessManager).grantRole(DualVMAccessManager(a.accessManager).ADMIN_ROLE(), a.timelock, 0);
        console.log("AccessManager admin granted to TimelockController");

        // -----------------------------------------------------------------
        // 18. Deployer renounces admin on AccessManager
        // -----------------------------------------------------------------
        DualVMAccessManager(a.accessManager).renounceRole(DualVMAccessManager(a.accessManager).ADMIN_ROLE(), deployer);
        console.log("Deployer renounced AccessManager admin");

        // -----------------------------------------------------------------
        // 19. Deployer renounces DEFAULT_ADMIN_ROLE on TimelockController
        // -----------------------------------------------------------------
        TimelockController(payable(a.timelock))
            .renounceRole(TimelockController(payable(a.timelock)).DEFAULT_ADMIN_ROLE(), deployer);
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
        (bool ok, bytes memory tokenData) = a.governor.staticcall(abi.encodeWithSignature("token()"));
        require(ok, "Deploy: governor.token() staticcall failed");
        address govTokenAddr = abi.decode(tokenData, (address));

        a.govToken = govTokenAddr;
        _writeManifest(a);
        console.log("Manifest written to:", MANIFEST_PATH);
        console.log("NOTE: If governanceToken shows as *** in manifest, retrieve via:");
        console.log("  cast call <dualVMGovernor> 'token()(address)' --rpc-url <RPC>");
    }

    // -------------------------------------------------------------------------
    // Internal: role wiring
    // -------------------------------------------------------------------------

    // Split into sub-functions to avoid stack-too-deep on non-via_ir builds.
    function _wireAccessManagerRoles(Addresses memory a) internal {
        DualVMAccessManager am = DualVMAccessManager(a.accessManager);
        _wireLabelsAndGrants(am, a);
        _wireLendingEngineFns(am, a.lendingEngine);
        _wireDebtPoolFns(am, a.debtPool);
        _wireOracleFns(am, a.oracle);
        _wireOtherFns(am, a);
        console.log("AccessManager roles wired");
    }

    function _wireLabelsAndGrants(DualVMAccessManager am, Addresses memory a) internal {
        am.labelRole(ROLE_EMERGENCY, "EMERGENCY");
        am.labelRole(ROLE_RISK_ADMIN, "RISK_ADMIN");
        am.labelRole(ROLE_TREASURY, "TREASURY");
        am.labelRole(ROLE_MINTER, "MINTER");
        am.labelRole(ROLE_GOVERNANCE, "GOVERNANCE");
        am.labelRole(ROLE_MIGRATION, "MIGRATION");
        am.labelRole(ROLE_LENDING_CORE, "LENDING_CORE");
        am.labelRole(ROLE_ROUTER, "ROUTER");
        am.labelRole(ROLE_RELAY_CALLER, "RELAY_CALLER");
        am.labelRole(ROLE_USDC_MINTER, "USDC_MINTER");
        am.grantRole(ROLE_EMERGENCY, a.timelock, EMERGENCY_DELAY);
        am.grantRole(ROLE_RISK_ADMIN, a.timelock, RISK_ADMIN_DELAY);
        am.grantRole(ROLE_TREASURY, a.timelock, TREASURY_DELAY);
        am.grantRole(ROLE_MINTER, a.timelock, MINTER_DELAY);
        am.grantRole(ROLE_GOVERNANCE, a.timelock, GOVERNANCE_DELAY);
        am.grantRole(ROLE_MIGRATION, a.timelock, MIGRATION_DELAY);
        am.grantRole(ROLE_RELAY_CALLER, a.timelock, 0);
        am.grantRole(ROLE_LENDING_CORE, a.lendingEngine, 0);
        am.grantRole(ROLE_ROUTER, a.lendingRouter, 0);
        am.grantRole(ROLE_MIGRATION, a.coordinator, 0);

        // Faucet: create dedicated USDC minter role (separate from governance token minter)
        bytes4[] memory usdcMintFn = new bytes4[](1);
        usdcMintFn[0] = USDCMock.mint.selector;
        am.setTargetFunctionRole(a.usdc, usdcMintFn, ROLE_USDC_MINTER);

        // Grant faucet relayer the USDC-only minter role
        am.grantRole(ROLE_USDC_MINTER, 0xF5D29698aeaE6CCdD685035c8b90A1Df53Cd3713, 0);

        // Grant deployer ROLE_RISK_ADMIN for oracle maintenance
        am.grantRole(ROLE_RISK_ADMIN, msg.sender, 0);
    }

    function _wireLendingEngineFns(DualVMAccessManager am, address lendingEngineAddr) internal {
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

    function _wireDebtPoolFns(DualVMAccessManager am, address debtPoolAddr) internal {
        bytes4[] memory emergencyFns = new bytes4[](2);
        emergencyFns[0] = DebtPool.pause.selector;
        emergencyFns[1] = DebtPool.unpause.selector;
        am.setTargetFunctionRole(debtPoolAddr, emergencyFns, ROLE_EMERGENCY);
        bytes4[] memory treasuryFns = new bytes4[](1);
        treasuryFns[0] = DebtPool.claimReserves.selector;
        am.setTargetFunctionRole(debtPoolAddr, treasuryFns, ROLE_TREASURY);
    }

    function _wireOracleFns(DualVMAccessManager am, address oracleAddr) internal {
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

    function _wireOtherFns(DualVMAccessManager am, Addresses memory a) internal {
        {
            bytes4[] memory lendingCoreFns = new bytes4[](1);
            lendingCoreFns[0] = RiskGateway.quoteViaTicket.selector;
            am.setTargetFunctionRole(a.riskGateway, lendingCoreFns, ROLE_LENDING_CORE);
        }
        {
            bytes4[] memory riskFns = new bytes4[](2);
            riskFns[0] = GovernancePolicyStore.setPolicy.selector;
            riskFns[1] = GovernancePolicyStore.removePolicy.selector;
            am.setTargetFunctionRole(a.policyStore, riskFns, ROLE_RISK_ADMIN);
        }
        {
            bytes4[] memory govFns = new bytes4[](2);
            govFns[0] = LiquidationHookRegistry.registerHook.selector;
            govFns[1] = LiquidationHookRegistry.deregisterHook.selector;
            am.setTargetFunctionRole(a.hookRegistry, govFns, ROLE_GOVERNANCE);
        }
        {
            bytes4[] memory govFns = new bytes4[](2);
            govFns[0] = MarketVersionRegistry.registerVersion.selector;
            govFns[1] = MarketVersionRegistry.activateVersion.selector;
            am.setTargetFunctionRole(a.marketRegistry, govFns, ROLE_GOVERNANCE);
        }
        {
            bytes4[] memory migFns = new bytes4[](2);
            migFns[0] = MarketMigrationCoordinator.openMigrationRoute.selector;
            migFns[1] = MarketMigrationCoordinator.closeMigrationRoute.selector;
            am.setTargetFunctionRole(a.coordinator, migFns, ROLE_MIGRATION);
        }
        {
            bytes4[] memory relayFns = new bytes4[](1);
            relayFns[0] = XcmInbox.receiveReceipt.selector;
            am.setTargetFunctionRole(a.xcmInbox, relayFns, ROLE_RELAY_CALLER);
        }
        {
            bytes4[] memory minterFns = new bytes4[](1);
            minterFns[0] = GovernanceToken.mint.selector;
            am.setTargetFunctionRole(a.govToken, minterFns, ROLE_MINTER);
        }
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

    function _writeManifest(Addresses memory a) internal {
        // Split into two halves to stay within Solidity stack depth (non-via_ir)
        string memory part1 = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "deployedAt": ',
            vm.toString(block.timestamp),
            ",\n",
            '  "accessManager": "',
            _addrHex(a.accessManager),
            '",\n',
            '  "wpas": "',
            _addrHex(a.wpas),
            '",\n',
            '  "usdcMock": "',
            _addrHex(a.usdc),
            '",\n',
            '  "manualOracle": "',
            _addrHex(a.oracle),
            '",\n',
            '  "governancePolicyStore": "',
            _addrHex(a.policyStore),
            '",\n',
            '  "deterministicRiskModel": "',
            _addrHex(a.evmRiskModel),
            '",\n',
            '  "pvmDeterministicRiskModel": "',
            _addrHex(a.pvmRiskModel),
            '",\n',
            '  "riskGateway": "',
            _addrHex(a.riskGateway),
            '",\n'
        );
        string memory part2 = string.concat(
            '  "debtPool": "',
            _addrHex(a.debtPool),
            '",\n',
            '  "liquidationHookRegistry": "',
            _addrHex(a.hookRegistry),
            '",\n',
            '  "xcmLiquidationNotifier": "',
            _addrHex(a.xcmNotifier),
            '",\n',
            '  "xcmNotifierAdapter": "',
            _addrHex(a.xcmAdapter),
            '",\n',
            '  "lendingEngine": "',
            _addrHex(a.lendingEngine),
            '",\n',
            '  "lendingRouter": "',
            _addrHex(a.lendingRouter),
            '",\n',
            '  "xcmInbox": "',
            _addrHex(a.xcmInbox),
            '",\n',
            '  "marketVersionRegistry": "',
            _addrHex(a.marketRegistry),
            '",\n',
            '  "marketMigrationCoordinator": "',
            _addrHex(a.coordinator),
            '",\n',
            '  "governanceToken": "',
            _addrHex(a.govToken),
            '",\n',
            '  "timelockController": "',
            _addrHex(a.timelock),
            '",\n',
            '  "dualVMGovernor": "',
            _addrHex(a.governor),
            '"\n',
            "}\n"
        );
        vm.writeFile(MANIFEST_PATH, string.concat(part1, part2));
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
            result[2 + i * 2] = hexChars[uint8(b[i]) >> 4];
            result[3 + i * 2] = hexChars[uint8(b[i]) & 0x0f];
        }
        return string(result);
    }
}
