// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWPASDeposit {
    function deposit() external payable;
}

interface ILendingEngineDeposit {
    function depositCollateralFor(address beneficiary, uint256 amount) external;
}

/**
 * @title LendingRouter
 * @notice Convenience router that wraps native PAS into WPAS and deposits it as
 *         collateral in LendingEngine in a single transaction, crediting the
 *         original caller's position (not the router's).
 *
 * @dev Uses LendingEngine.depositCollateralFor(msg.sender, amount) so the position
 *      is tracked for the original caller, not for this router contract. This fixes
 *      the accounting issue present in the v1 LendingRouter where the router address
 *      accumulated collateral instead of the user.
 *
 *      Requires the router address to hold a role authorised for depositCollateralFor
 *      in the AccessManager before deployment is wired.
 */
contract LendingRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();

    IWPASDeposit public immutable wpas;
    ILendingEngineDeposit public immutable lendingCore;

    event DepositedCollateralFromPAS(address indexed depositor, uint256 amount);

    constructor(address _wpas, address _lendingCore) {
        wpas = IWPASDeposit(_wpas);
        lendingCore = ILendingEngineDeposit(_lendingCore);
    }

    /**
     * @notice Wraps msg.value of native PAS to WPAS and deposits it as collateral
     *         in LendingEngine, crediting the original caller's position.
     *
     * Steps:
     *  1. WPAS.deposit{value: msg.value}()  — router receives WPAS
     *  2. WPAS.forceApprove(lendingCore, msg.value) — approve LendingEngine to pull
     *  3. LendingEngine.depositCollateralFor(msg.sender, msg.value) — position credited to caller
     */
    function depositCollateralFromPAS() external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        uint256 amount = msg.value;

        // 1. Wrap native PAS → WPAS (router receives the WPAS tokens)
        wpas.deposit{value: amount}();

        // 2. Approve LendingEngine to pull WPAS from this router
        IERC20(address(wpas)).forceApprove(address(lendingCore), amount);

        // 3. Deposit collateral — position credited to original caller, not the router
        lendingCore.depositCollateralFor(msg.sender, amount);

        emit DepositedCollateralFromPAS(msg.sender, amount);
    }
}
