// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract DebtPool is ERC20, ERC4626, AccessManaged, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    address public lendingCore;
    uint256 public outstandingPrincipal;
    uint256 public supplyCap;
    uint256 public reserveBalance;

    error InvalidConfiguration();
    error SupplyCapExceeded(uint256 attempted, uint256 cap);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error OnlyLendingCore();

    event LendingCoreSet(address indexed lendingCore);
    event SupplyCapUpdated(uint256 supplyCap);
    event DebtDrawn(address indexed receiver, uint256 amount);
    event RepaymentRecorded(uint256 principalPaid, uint256 interestPaid, uint256 reserveCut);
    event LossRecorded(uint256 principalLoss);
    event ReservesClaimed(address indexed treasury, uint256 amount);

    constructor(IERC20 asset_, address authority_, uint256 supplyCap_)
        ERC20("DualVM USDC Pool Share", "dvUSDC")
        ERC4626(asset_)
        AccessManaged(authority_)
    {
        if (address(asset_) == address(0) || supplyCap_ == 0) revert InvalidConfiguration();
        supplyCap = supplyCap_;
    }

    function decimals() public view override(ERC20, ERC4626) returns (uint8) {
        return super.decimals();
    }

    modifier onlyLendingCore() {
        if (msg.sender != lendingCore) revert OnlyLendingCore();
        _;
    }

    function setLendingCore(address lendingCore_) external restricted {
        if (lendingCore_ == address(0)) revert InvalidConfiguration();
        lendingCore = lendingCore_;
        emit LendingCoreSet(lendingCore_);
    }

    function setSupplyCap(uint256 newSupplyCap) external restricted {
        if (newSupplyCap == 0) revert InvalidConfiguration();
        supplyCap = newSupplyCap;
        emit SupplyCapUpdated(newSupplyCap);
    }

    function pause() external restricted {
        _pause();
    }

    function unpause() external restricted {
        _unpause();
    }

    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        _enforceSupplyCap(assets);
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        uint256 assets = previewMint(shares);
        _enforceSupplyCap(assets);
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        _enforceLiquidCash(assets);
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        uint256 assets = previewRedeem(shares);
        _enforceLiquidCash(assets);
        return super.redeem(shares, receiver, owner);
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (totalAssets() >= supplyCap) {
            return 0;
        }
        return supplyCap - totalAssets();
    }

    function maxMint(address) public view override returns (uint256) {
        uint256 assets = maxDeposit(address(0));
        return convertToShares(assets);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner), availableLiquidity());
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return Math.min(super.maxRedeem(owner), convertToShares(availableLiquidity()));
    }

    function availableLiquidity() public view returns (uint256) {
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        return balance > reserveBalance ? balance - reserveBalance : 0;
    }

    function utilizationBps() external view returns (uint256) {
        uint256 assets = totalAssets();
        if (assets == 0) {
            return 0;
        }
        return (outstandingPrincipal * BPS) / assets;
    }

    function totalAssets() public view override returns (uint256) {
        return availableLiquidity() + outstandingPrincipal;
    }

    function drawDebt(address receiver, uint256 amount) external onlyLendingCore nonReentrant whenNotPaused {
        _enforceLiquidCash(amount);
        outstandingPrincipal += amount;
        IERC20(asset()).safeTransfer(receiver, amount);
        emit DebtDrawn(receiver, amount);
    }

    function recordRepayment(uint256 principalPaid, uint256 interestPaid, uint256 reserveFactorBps)
        external
        onlyLendingCore
    {
        if (reserveFactorBps > BPS || principalPaid > outstandingPrincipal) revert InvalidConfiguration();
        outstandingPrincipal -= principalPaid;
        uint256 reserveCut = (interestPaid * reserveFactorBps) / BPS;
        reserveBalance += reserveCut;
        emit RepaymentRecorded(principalPaid, interestPaid, reserveCut);
    }

    function recordLoss(uint256 principalLoss) external onlyLendingCore {
        if (principalLoss > outstandingPrincipal) revert InvalidConfiguration();
        outstandingPrincipal -= principalLoss;
        emit LossRecorded(principalLoss);
    }

    function claimReserves(address treasury, uint256 amount) external restricted nonReentrant {
        if (treasury == address(0) || amount > reserveBalance) revert InvalidConfiguration();
        reserveBalance -= amount;
        IERC20(asset()).safeTransfer(treasury, amount);
        emit ReservesClaimed(treasury, amount);
    }

    function _enforceSupplyCap(uint256 assets) private view {
        uint256 attempted = totalAssets() + assets;
        if (attempted > supplyCap) revert SupplyCapExceeded(attempted, supplyCap);
    }

    function _enforceLiquidCash(uint256 assets) private view {
        uint256 liquid = availableLiquidity();
        if (assets > liquid) revert InsufficientLiquidity(assets, liquid);
    }
}
