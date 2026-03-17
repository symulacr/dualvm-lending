// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWPAS {
    function deposit() external payable;
}

interface ILendingCoreDeposit {
    function depositCollateral(uint256 amount) external;
}

/**
 * @title LendingRouter
 * @notice Convenience router that wraps native PAS into WPAS and deposits it as
 *         collateral in LendingCore in a single transaction.
 *
 * @dev The position in LendingCore is tracked for this router's address. This is
 *      intentional for the hackathon MVP 1-click UX. The 3-step manual flow
 *      (wrap → approve → deposit) remains available as a fallback for per-user positions.
 */
contract LendingRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();

    IWPAS public immutable wpas;
    ILendingCoreDeposit public immutable lendingCore;

    event DepositedCollateralFromPAS(address indexed depositor, uint256 amount);

    constructor(address _wpas, address _lendingCore) {
        wpas = IWPAS(_wpas);
        lendingCore = ILendingCoreDeposit(_lendingCore);
    }

    /**
     * @notice Wraps msg.value of native PAS to WPAS and deposits it as collateral
     *         in LendingCore — all in a single transaction.
     *
     * Steps:
     *  1. WPAS.deposit{value: msg.value}()  — router receives WPAS
     *  2. WPAS.forceApprove(lendingCore, msg.value) — approve LendingCore to pull
     *  3. LendingCore.depositCollateral(msg.value) — position recorded for router
     */
    function depositCollateralFromPAS() external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        uint256 amount = msg.value;

        // 1. Wrap native PAS → WPAS (router receives the WPAS tokens)
        wpas.deposit{value: amount}();

        // 2. Approve LendingCore to pull WPAS from this router
        IERC20(address(wpas)).forceApprove(address(lendingCore), amount);

        // 3. Deposit collateral (position tracked for this router's address)
        lendingCore.depositCollateral(amount);

        emit DepositedCollateralFromPAS(msg.sender, amount);
    }
}
