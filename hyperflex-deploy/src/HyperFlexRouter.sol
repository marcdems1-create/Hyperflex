// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HyperFlexMarket} from "./HyperFlexMarket.sol";
import {ReentrancyGuard} from "./utils/ReentrancyGuard.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/**
 * @title  HyperFlexRouter
 * @notice User-facing entry point for all HYPERFLEX trades.
 *
 * @dev    Adds referral tracking on top of the core market mechanics.
 *         Users trade through the Router → Router calls the market.
 *         Referrers earn 10% of platform fees on their referees' trades.
 *
 *  Referral flow:
 *  1. User connects with referral code HFX-XXXXXX
 *  2. Frontend passes referrer address on first trade
 *  3. Router records the referrer (immutable once set)
 *  4. 10% of platform fee share is earmarked for referrer
 *  5. Referrer calls claimReferralEarnings() any time
 */
contract HyperFlexRouter is ReentrancyGuard {

    // ── Config ────────────────────────────────────────────────
    address public immutable factory;
    address public usdh;
    address public owner;

    uint256 public constant REFERRAL_SHARE    = 1000; // 10% of platform fee
    uint256 public constant PLATFORM_FEE_BPS  = 200;  // 2% total platform fee
    uint256 public constant FEE_DENOM         = 10_000;

    // ── Referral state ────────────────────────────────────────
    mapping(address => address)  public referrer;         // user => their referrer
    mapping(address => uint256)  public referralEarnings; // referrer => unclaimed USDH
    mapping(address => uint256)  public totalReferred;    // referrer => # users referred
    mapping(address => uint256)  public totalVolume;      // user => lifetime volume

    // ── Events ────────────────────────────────────────────────
    event ReferralSet(address indexed user, address indexed referrer);
    event ReferralEarned(address indexed referrer, uint256 amount);
    event ReferralClaimed(address indexed referrer, uint256 amount);
    event TradeRouted(
        address indexed user,
        address indexed market,
        bool    isYes,
        uint256 usdhIn,
        uint256 sharesOut
    );

    // ── Errors ────────────────────────────────────────────────
    error SelfReferral();
    error NothingToClaim();
    error OnlyOwner();

    constructor(address _factory, address _usdh) {
        factory = _factory;
        usdh    = _usdh;
        owner   = msg.sender;
    }

    // ─────────────────────────────────────────────────────────
    //  TRADE WITH REFERRAL
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Buy shares in a market, optionally setting a referrer
     * @param market        Address of the HyperFlexMarket to trade
     * @param isYes         true = buy YES, false = buy NO
     * @param usdhIn        USDH to spend (must be pre-approved to Router)
     * @param minShares     Slippage protection
     * @param referrerAddr  Referrer's wallet (address(0) if none / already set)
     */
    function buyWithReferral(
        address market,
        bool    isYes,
        uint256 usdhIn,
        uint256 minShares,
        address referrerAddr
    ) external nonReentrant returns (uint256 sharesOut) {
        // Set referrer on first trade only (immutable after that)
        if (referrerAddr != address(0) && referrer[msg.sender] == address(0)) {
            if (referrerAddr == msg.sender) revert SelfReferral();
            referrer[msg.sender]           = referrerAddr;
            totalReferred[referrerAddr]   += 1;
            emit ReferralSet(msg.sender, referrerAddr);
        }

        // Pull USDH from user to router
        IERC20(usdh).transferFrom(msg.sender, address(this), usdhIn);

        // Calculate referral amount (10% of 2% fee = 0.2% of trade)
        uint256 referralAmt = _calcReferralAmt(usdhIn);
        uint256 netToMarket = usdhIn - referralAmt;

        // Credit referrer
        address ref = referrer[msg.sender];
        if (ref != address(0) && referralAmt > 0) {
            referralEarnings[ref] += referralAmt;
            emit ReferralEarned(ref, referralAmt);
        } else {
            // No referrer — extra goes to factory fee recipient
            netToMarket = usdhIn; // full amount passes through (market takes its own fee)
        }

        // Approve market and execute trade
        IERC20(usdh).approve(market, netToMarket);
        sharesOut = HyperFlexMarket(market).buy(isYes, netToMarket, minShares);

        totalVolume[msg.sender] += usdhIn;

        emit TradeRouted(msg.sender, market, isYes, usdhIn, sharesOut);
    }

    /**
     * @notice Sell shares through the router
     */
    function sell(
        address market,
        bool    isYes,
        uint256 shares,
        uint256 minUsdh
    ) external nonReentrant returns (uint256 usdhOut) {
        usdhOut = HyperFlexMarket(market).sell(isYes, shares, minUsdh);
        IERC20(usdh).transfer(msg.sender, usdhOut);
        totalVolume[msg.sender] += usdhOut;
    }

    // ─────────────────────────────────────────────────────────
    //  REFERRAL CLAIMING
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Referrers call this to claim their accumulated USDH earnings
     */
    function claimReferralEarnings() external nonReentrant {
        uint256 amount = referralEarnings[msg.sender];
        if (amount == 0) revert NothingToClaim();

        referralEarnings[msg.sender] = 0;
        IERC20(usdh).transfer(msg.sender, amount);
        emit ReferralClaimed(msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────
    //  VIEWS
    // ─────────────────────────────────────────────────────────

    function getReferralStats(address user) external view returns (
        address myReferrer,
        uint256 referralsGenerated,
        uint256 earningsPending,
        uint256 lifetimeVolume
    ) {
        myReferrer          = referrer[user];
        referralsGenerated  = totalReferred[user];
        earningsPending     = referralEarnings[user];
        lifetimeVolume      = totalVolume[user];
    }

    function getTradeQuote(
        address market,
        bool    isYes,
        uint256 usdhIn
    ) external view returns (
        uint256 sharesOut,
        uint256 priceAfter,
        uint256 priceImpactBps,
        uint256 feePaid
    ) {
        feePaid = _calcReferralAmt(usdhIn);
        uint256 netIn = usdhIn - feePaid;
        (sharesOut, priceAfter, priceImpactBps) =
            HyperFlexMarket(market).getQuote(isYes, netIn);
    }

    // ─────────────────────────────────────────────────────────
    //  INTERNAL
    // ─────────────────────────────────────────────────────────

    function _calcReferralAmt(uint256 usdhIn) internal pure returns (uint256) {
        // 10% of the 2% platform fee = 0.2% of trade value
        uint256 platformFee = (usdhIn * PLATFORM_FEE_BPS) / FEE_DENOM;
        return  (platformFee * REFERRAL_SHARE) / FEE_DENOM;
    }

    // ─────────────────────────────────────────────────────────
    //  ADMIN
    // ─────────────────────────────────────────────────────────

    function rescueTokens(address token, uint256 amount) external {
        if (msg.sender != owner) revert OnlyOwner();
        IERC20(token).transfer(owner, amount);
    }
}

// IERC20 imported from ./interfaces/IERC20.sol
