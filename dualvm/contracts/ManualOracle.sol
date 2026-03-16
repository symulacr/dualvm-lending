// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract ManualOracle is AccessManaged, Pausable {
    error OraclePriceUnset();
    error OraclePriceStale(uint256 age, uint256 maxAge);
    error OraclePriceOutOfBounds(uint256 priceWad, uint256 minPriceWad, uint256 maxPriceWad);
    error OraclePriceDeltaTooLarge(uint256 previousPriceWad, uint256 nextPriceWad, uint256 maxDeltaBps);
    error InvalidConfiguration();

    uint256 public priceWad;
    uint256 public lastUpdatedAt;
    uint256 public maxAge;
    uint256 public minPriceWad;
    uint256 public maxPriceWad;
    uint256 public maxPriceChangeBps;
    uint256 public oracleEpoch;

    event PriceUpdated(uint256 priceWad, uint256 timestamp, uint256 oracleEpoch);
    event MaxAgeUpdated(uint256 maxAge, uint256 oracleEpoch);
    event CircuitBreakerUpdated(uint256 minPriceWad, uint256 maxPriceWad, uint256 maxPriceChangeBps, uint256 oracleEpoch);
    event OraclePauseStateUpdated(bool paused, uint256 oracleEpoch);

    constructor(
        address authority,
        uint256 initialPriceWad,
        uint256 initialMaxAge,
        uint256 initialMinPriceWad,
        uint256 initialMaxPriceWad,
        uint256 initialMaxPriceChangeBps
    ) AccessManaged(authority) {
        _validateCircuitBreaker(initialMinPriceWad, initialMaxPriceWad, initialMaxPriceChangeBps);
        if (initialPriceWad != 0) {
            _validatePriceAgainstBounds(initialPriceWad, initialMinPriceWad, initialMaxPriceWad);
        }
        if (initialMaxAge == 0) revert InvalidConfiguration();

        priceWad = initialPriceWad;
        lastUpdatedAt = block.timestamp;
        maxAge = initialMaxAge;
        minPriceWad = initialMinPriceWad;
        maxPriceWad = initialMaxPriceWad;
        maxPriceChangeBps = initialMaxPriceChangeBps;
        oracleEpoch = 1;
    }

    function setPrice(uint256 newPriceWad) external restricted {
        _validatePriceAgainstBounds(newPriceWad, minPriceWad, maxPriceWad);
        _validatePriceDelta(priceWad, newPriceWad, maxPriceChangeBps);
        priceWad = newPriceWad;
        lastUpdatedAt = block.timestamp;
        uint256 nextOracleEpoch = _advanceOracleEpoch();
        emit PriceUpdated(newPriceWad, block.timestamp, nextOracleEpoch);
    }

    function setMaxAge(uint256 newMaxAge) external restricted {
        if (newMaxAge == 0) revert InvalidConfiguration();
        maxAge = newMaxAge;
        emit MaxAgeUpdated(newMaxAge, _advanceOracleEpoch());
    }

    function setCircuitBreaker(uint256 newMinPriceWad, uint256 newMaxPriceWad, uint256 newMaxPriceChangeBps)
        external
        restricted
    {
        _validateCircuitBreaker(newMinPriceWad, newMaxPriceWad, newMaxPriceChangeBps);
        if (priceWad != 0) {
            _validatePriceAgainstBounds(priceWad, newMinPriceWad, newMaxPriceWad);
        }

        minPriceWad = newMinPriceWad;
        maxPriceWad = newMaxPriceWad;
        maxPriceChangeBps = newMaxPriceChangeBps;
        emit CircuitBreakerUpdated(newMinPriceWad, newMaxPriceWad, newMaxPriceChangeBps, _advanceOracleEpoch());
    }

    function pause() external restricted {
        _pause();
        emit OraclePauseStateUpdated(true, _advanceOracleEpoch());
    }

    function unpause() external restricted {
        _unpause();
        emit OraclePauseStateUpdated(false, _advanceOracleEpoch());
    }

    function isFresh() public view returns (bool) {
        return priceWad != 0 && !paused() && block.timestamp - lastUpdatedAt <= maxAge;
    }

    function currentAge() external view returns (uint256) {
        return block.timestamp - lastUpdatedAt;
    }

    function oracleStateHash() external view returns (bytes32) {
        return currentStateHash();
    }

    function currentStateHash() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                oracleEpoch,
                priceWad,
                lastUpdatedAt,
                maxAge,
                minPriceWad,
                maxPriceWad,
                maxPriceChangeBps,
                paused()
            )
        );
    }

    function latestPriceWad() external view whenNotPaused returns (uint256) {
        uint256 localPrice = priceWad;
        if (localPrice == 0) revert OraclePriceUnset();

        uint256 age = block.timestamp - lastUpdatedAt;
        if (age > maxAge) revert OraclePriceStale(age, maxAge);
        return localPrice;
    }

    function _advanceOracleEpoch() private returns (uint256) {
        oracleEpoch += 1;
        return oracleEpoch;
    }

    function _validateCircuitBreaker(uint256 newMinPriceWad, uint256 newMaxPriceWad, uint256 newMaxPriceChangeBps)
        private
        pure
    {
        if (newMinPriceWad == 0 || newMaxPriceWad < newMinPriceWad || newMaxPriceChangeBps > 10_000) {
            revert InvalidConfiguration();
        }
    }

    function _validatePriceAgainstBounds(uint256 newPriceWad, uint256 currentMinPriceWad, uint256 currentMaxPriceWad)
        private
        pure
    {
        if (newPriceWad < currentMinPriceWad || newPriceWad > currentMaxPriceWad) {
            revert OraclePriceOutOfBounds(newPriceWad, currentMinPriceWad, currentMaxPriceWad);
        }
    }

    function _validatePriceDelta(uint256 previousPriceWad, uint256 nextPriceWad, uint256 currentMaxPriceChangeBps)
        private
        pure
    {
        if (previousPriceWad == 0 || currentMaxPriceChangeBps == 0 || previousPriceWad == nextPriceWad) {
            return;
        }

        uint256 delta = previousPriceWad > nextPriceWad ? previousPriceWad - nextPriceWad : nextPriceWad - previousPriceWad;
        uint256 deltaBps = (delta * 10_000) / previousPriceWad;
        if (deltaBps > currentMaxPriceChangeBps) {
            revert OraclePriceDeltaTooLarge(previousPriceWad, nextPriceWad, currentMaxPriceChangeBps);
        }
    }
}
