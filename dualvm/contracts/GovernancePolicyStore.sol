// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";

/// @title GovernancePolicyStore
/// @notice Stores governance-managed risk policy overrides that can be read by RiskGateway.
///
/// Risk parameters in RiskGateway are immutable by design (set at constructor time) to
/// prevent runtime manipulation. GovernancePolicyStore provides a separate governance-
/// controlled layer for policy overrides that the gateway can optionally consult.
///
/// Each policy is identified by a bytes32 key and stores an arbitrary uint256 value.
/// The governance body (via AccessManager) is the sole authorized updater.
///
/// @dev RiskGateway reads this store via the optional `policyStore` constructor arg.
/// If `policyStore` is address(0), RiskGateway ignores policy overrides entirely.
contract GovernancePolicyStore is AccessManaged {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Maps policy key → current policy value.
    mapping(bytes32 => uint256) private _policies;

    /// @notice True when a policy key has been explicitly set (to distinguish unset from 0).
    mapping(bytes32 => bool) private _policyActive;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a policy value is set or updated.
    /// @param key Policy identifier.
    /// @param value The new policy value.
    event PolicySet(bytes32 indexed key, uint256 value);

    /// @notice Emitted when a policy is removed (reset to inactive).
    /// @param key Policy identifier.
    event PolicyRemoved(bytes32 indexed key);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param authority_ The AccessManager that governs this contract.
    constructor(address authority_) AccessManaged(authority_) {}

    // -------------------------------------------------------------------------
    // Governance functions
    // -------------------------------------------------------------------------

    /// @notice Set or update a policy value.
    /// @dev Restricted: only the governance authority (via AccessManager) may call this.
    /// @param key Policy identifier.
    /// @param value The policy value to store.
    function setPolicy(bytes32 key, uint256 value) external restricted {
        _policies[key] = value;
        _policyActive[key] = true;
        emit PolicySet(key, value);
    }

    /// @notice Remove a policy (mark it as inactive).
    /// @dev Restricted: only the governance authority (via AccessManager) may call this.
    /// @param key Policy identifier to remove.
    function removePolicy(bytes32 key) external restricted {
        delete _policies[key];
        delete _policyActive[key];
        emit PolicyRemoved(key);
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @notice Returns the current value for a policy key.
    /// @param key Policy identifier.
    /// @return value The stored policy value (0 if not set or if set to 0).
    function getPolicy(bytes32 key) external view returns (uint256 value) {
        return _policies[key];
    }

    /// @notice Returns whether a policy has been explicitly set.
    /// @param key Policy identifier.
    /// @return True if the policy is active (has been set and not removed).
    function policyActive(bytes32 key) external view returns (bool) {
        return _policyActive[key];
    }

    /// @notice Returns the policy value only if it is active; reverts otherwise.
    /// @dev Useful for callers that need to distinguish "not set" from "set to 0".
    /// @param key Policy identifier.
    /// @return value The stored policy value.
    function getPolicyOrRevert(bytes32 key) external view returns (uint256 value) {
        require(_policyActive[key], "GovernancePolicyStore: policy not set");
        return _policies[key];
    }
}
