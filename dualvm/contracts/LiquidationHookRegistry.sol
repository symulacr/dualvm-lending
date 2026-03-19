// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {ILiquidationNotifier} from "./interfaces/ILiquidationNotifier.sol";

/// @title LiquidationHookRegistry
/// @notice Governance-managed registry mapping hook types to post-liquidation handlers.
///
/// Each hook type (a bytes32 key) maps to one handler address that implements
/// ILiquidationNotifier.  Governance can register or deregister handlers at any time.
/// executeHooks dispatches to the registered handler inside a try/catch so a
/// reverting hook never propagates to the caller (e.g. LendingEngine liquidation).
///
/// @dev Wire this contract as the liquidationNotifier on LendingEngine.  LendingEngine
/// calls ILiquidationNotifier.notifyLiquidation(borrower, debtRepaid, collateralSeized),
/// which hits this contract.  The registry then re-dispatches to each registered hook
/// for the DEFAULT_HOOK_TYPE with the same 3-arg signature.
contract LiquidationHookRegistry is AccessManaged, ILiquidationNotifier {
    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @notice Default hook type used by LendingEngine post-liquidation.
    bytes32 public constant DEFAULT_HOOK_TYPE = keccak256("LIQUIDATION");

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Maps hookType → handler address (one handler per type).
    mapping(bytes32 => address) private _hooks;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event HookRegistered(bytes32 indexed hookType, address indexed handler);
    event HookDeregistered(bytes32 indexed hookType, address indexed handler);
    event HookExecuted(bytes32 indexed hookType, address indexed handler);
    event HookFailed(bytes32 indexed hookType, address indexed handler, bytes reason);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error HookNotRegistered(bytes32 hookType);
    error ZeroHandlerAddress();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address authority_) AccessManaged(authority_) {}

    // -------------------------------------------------------------------------
    // Governance-restricted functions
    // -------------------------------------------------------------------------

    /// @notice Register a hook handler for a given type (replaces any existing handler).
    /// @param hookType  Identifier for the hook category.
    /// @param handler   Contract implementing ILiquidationNotifier.
    function registerHook(bytes32 hookType, address handler) external restricted {
        if (handler == address(0)) revert ZeroHandlerAddress();
        _hooks[hookType] = handler;
        emit HookRegistered(hookType, handler);
    }

    /// @notice Remove the hook handler for a given type.
    /// @param hookType Identifier for the hook category.
    function deregisterHook(bytes32 hookType) external restricted {
        address handler = _hooks[hookType];
        if (handler == address(0)) revert HookNotRegistered(hookType);
        delete _hooks[hookType];
        emit HookDeregistered(hookType, handler);
    }

    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    /// @notice Returns the handler registered for hookType (address(0) if none).
    function getHook(bytes32 hookType) external view returns (address) {
        return _hooks[hookType];
    }

    // -------------------------------------------------------------------------
    // ILiquidationNotifier — called directly by LendingEngine
    // -------------------------------------------------------------------------

    /// @inheritdoc ILiquidationNotifier
    /// @dev Dispatches to the DEFAULT_HOOK_TYPE handler via executeHooks.
    function notifyLiquidation(address borrower, uint256 debtRepaid, uint256 collateralSeized, bytes32 correlationId)
        external
        override
    {
        executeHooks(DEFAULT_HOOK_TYPE, abi.encode(borrower, debtRepaid, collateralSeized, correlationId));
    }

    // -------------------------------------------------------------------------
    // Execute
    // -------------------------------------------------------------------------

    /// @notice Execute the registered hook for hookType with the given ABI-encoded data.
    /// @dev    data must be ABI-encoded as (address borrower, uint256 debtRepaid, uint256 collateralSeized, bytes32 correlationId).
    ///         If no handler is registered, returns silently (no revert).
    ///         If the handler reverts, emits HookFailed and continues.
    /// @param hookType Identifier for the hook category.
    /// @param data     ABI-encoded (address, uint256, uint256, bytes32) liquidation parameters.
    function executeHooks(bytes32 hookType, bytes memory data) public {
        address handler = _hooks[hookType];
        if (handler == address(0)) return;

        (address borrower, uint256 debtRepaid, uint256 collateralSeized, bytes32 correlationId) =
            abi.decode(data, (address, uint256, uint256, bytes32));

        try ILiquidationNotifier(handler).notifyLiquidation(borrower, debtRepaid, collateralSeized, correlationId) {
            emit HookExecuted(hookType, handler);
        } catch (bytes memory reason) {
            emit HookFailed(hookType, handler, reason);
        }
    }
}
