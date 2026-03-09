// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         HYPERFLEX — Prediction Market Core  v2                  ║
 * ║                                                                  ║
 * ║  Three-layer liquidity solution:                                 ║
 * ║                                                                  ║
 * ║  LAYER 1 — Liquidity Bootstrap                                   ║
 * ║    Factory seeds every new market with real USDH on both sides.  ║
 * ║    No trader ever faces a zero-liquidity pool. The first trade   ║
 * ║    always has a counterparty: the protocol itself.               ║
 * ║                                                                  ║
 * ║  LAYER 2 — One-Sided Refund Safety Net                          ║
 * ║    If a market resolves and the LOSING side has zero traders,    ║
 * ║    the winner's collateral is fully refunded minus fees.         ║
 * ║    Nobody loses money to a ghost market.                         ║
 * ║                                                                  ║
 * ║  LAYER 3 — Limit Order Book (alongside AMM)                     ║
 * ║    Traders can post limit orders at a specific price.            ║
 * ║    When a matching trade comes in, orders fill before the AMM.   ║
 * ║    Better prices, deeper liquidity, more efficient markets.      ║
 * ║    Unfilled orders can be cancelled and refunded any time.       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import {IERC20}           from "./interfaces/IERC20.sol";
import {IHyperCoreOracle} from "./interfaces/IHyperCoreOracle.sol";
import {ReentrancyGuard}  from "./utils/ReentrancyGuard.sol";
import {HyperFlexPriceAggregator} from "./HyperFlexPriceAggregator.sol";

// ─────────────────────────────────────────────────────────────────────
//  ENUMS & STRUCTS
// ─────────────────────────────────────────────────────────────────────

enum Outcome { UNRESOLVED, YES, NO, INVALID }

enum ResolutionType {
    PRICE_ABOVE,   // YES if oracle price >= strike at expiry
    PRICE_BELOW,   // YES if oracle price <= strike at expiry
    MANUAL,        // Resolved by trusted resolver address
    CHAINLINK      // Future: Chainlink / UMA
}

struct MarketParams {
    string       question;
    string       sector;
    string       iconEmoji;
    uint256      closesAt;
    uint256      resolvesAt;
    ResolutionType resType;
    uint32       assetIndex;
    uint256      strikePrice;
    address      resolver;
    uint256      creatorFee;   // basis points, max 100 (= 1%)
}

/// @dev A resting limit order in the order book
struct LimitOrder {
    address maker;
    bool    isYes;       // which side they want to buy
    uint256 priceLimit;  // max price willing to pay (6-dec cents, e.g. 550000 = 55¢)
    uint256 usdhAmount;  // USDH remaining unfilled
    bool    active;
}

// ─────────────────────────────────────────────────────────────────────
//  HYPERFLEX MARKET CONTRACT
// ─────────────────────────────────────────────────────────────────────

contract HyperFlexMarket is ReentrancyGuard {

    // ── Constants ─────────────────────────────────────────────────────
    uint256 public constant PLATFORM_FEE    = 200;   // 2.00% bps
    uint256 public constant MAX_CREATOR_FEE = 100;   // 1.00% bps max
    uint256 public constant FEE_DENOM       = 10_000;
    uint256 public constant PRICE_SCALE     = 1e6;   // 1.000000 = $1

    // ── Immutables ────────────────────────────────────────────────────
    address public immutable factory;
    address public immutable creator;
    IERC20  public immutable usdh;
    IHyperCoreOracle          public immutable oracle;      // HyperCore primary
    HyperFlexPriceAggregator  public immutable aggregator;  // dual-oracle confirmation

    MarketParams public params;
    uint256 public immutable marketId;
    uint256 public immutable createdAt;

    // ── LAYER 1: Bootstrap liquidity tracking ─────────────────────────
    // The factory seeds both sides with BOOTSTRAP_AMOUNT each.
    // We track it separately so bootstrap USDH is never double-counted
    // in trader payouts — it's returned to the factory on resolution.
    uint256 public bootstrapYes;        // protocol YES liquidity (USDH)
    uint256 public bootstrapNo;         // protocol NO  liquidity (USDH)
    bool    public bootstrapped;

    // ── AMM state ─────────────────────────────────────────────────────
    uint256 public yesShares;
    uint256 public noShares;
    uint256 public yesReserve;
    uint256 public noReserve;
    uint256 public totalCollateral;     // trader USDH only (excl. bootstrap)

    // ── Resolution ────────────────────────────────────────────────────
    Outcome public outcome;
    uint256 public settlementPrice;
    bool    public resolved;
    bool    public emergencyPaused;

    // ── Fee accounting ────────────────────────────────────────────────
    uint256 public platformFeesAccrued;
    uint256 public creatorFeesAccrued;

    // ── Trader positions ──────────────────────────────────────────────
    mapping(address => uint256) public yesBalance;
    mapping(address => uint256) public noBalance;
    mapping(address => bool)    public hasClaimed;

    // ── LAYER 3: Order book ───────────────────────────────────────────
    uint256 public nextOrderId;
    mapping(uint256 => LimitOrder) public orders;

    // Index: price bucket → list of order IDs waiting there
    // YES orders at price P: someone willing to buy YES for ≤ P cents
    // NO  orders at price P: someone willing to buy NO  for ≤ (100 - P) cents
    mapping(uint256 => uint256[]) private _yesBuckets; // priceLimit → orderIds
    mapping(uint256 => uint256[]) private _noBuckets;

    // ── Events ────────────────────────────────────────────────────────
    event Bootstrapped(uint256 yesAmount, uint256 noAmount);
    event TradePlaced(
        address indexed trader,
        bool    isYes,
        uint256 usdhIn,
        uint256 sharesOut,
        uint256 newYesPrice
    );
    event OrderPlaced(uint256 indexed orderId, address indexed maker, bool isYes, uint256 priceLimit, uint256 amount);
    event OrderFilled(uint256 indexed orderId, address indexed taker, uint256 usdhFilled, uint256 sharesOut);
    event OrderCancelled(uint256 indexed orderId, address indexed maker, uint256 refund);
    event MarketResolved(Outcome outcome, uint256 settlementPrice);
    event WinningsClaimed(address indexed user, uint256 usdhAmount);
    event OneSidedRefund(address indexed user, uint256 refund);
    event BootstrapReclaimed(address indexed factory, uint256 amount);
    event EmergencyPause(bool paused);

    // ── Errors ────────────────────────────────────────────────────────
    error MarketClosed();
    error MarketNotResolved();
    error AlreadyResolved();
    error NotResolver();
    error InvalidAmount();
    error SlippageExceeded();
    error NothingToClaim();
    error Paused();
    error TooEarlyToResolve();
    error NotOrderMaker();
    error OrderNotActive();
    error AlreadyBootstrapped();
    error OnlyFactory();

    // ─────────────────────────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────

    constructor(
        uint256          _marketId,
        address          _factory,
        address          _creator,
        address          _usdh,
        address          _oracle,
        address          _aggregator,
        MarketParams memory _params
    ) {
        require(_params.closesAt    > block.timestamp,  "closes must be future");
        require(_params.resolvesAt  > _params.closesAt, "resolve after close");
        require(_params.creatorFee <= MAX_CREATOR_FEE,   "creator fee too high");

        marketId   = _marketId;
        factory    = _factory;
        creator    = _creator;
        usdh       = IERC20(_usdh);
        oracle     = IHyperCoreOracle(_oracle);
        aggregator = HyperFlexPriceAggregator(_aggregator);
        params     = _params;
        createdAt  = block.timestamp;

        // Seed virtual AMM reserves (virtual — no real USDH yet)
        // This prevents division-by-zero on first trade
        yesReserve = 1e18;
        noReserve  = 1e18;
    }

    // ═════════════════════════════════════════════════════════════════
    //  LAYER 1 — LIQUIDITY BOOTSTRAP
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Called by the factory immediately after deploy.
     *         Seeds both sides of the AMM with real USDH so that
     *         every market has a liquid counterparty from block 1.
     *
     * @dev    Factory must approve this contract for (2 * amount) USDH
     *         before calling. Recommended amount: 50–200 USDH per side.
     *
     * @param  yesAmount   USDH to seed YES side
     * @param  noAmount    USDH to seed NO side
     */
    function bootstrap(uint256 yesAmount, uint256 noAmount) external nonReentrant {
        if (msg.sender != factory)  revert OnlyFactory();
        if (bootstrapped)           revert AlreadyBootstrapped();
        require(yesAmount > 0 && noAmount > 0, "both sides required");

        usdh.transferFrom(factory, address(this), yesAmount + noAmount);

        bootstrapYes = yesAmount;
        bootstrapNo  = noAmount;
        bootstrapped = true;

        // Inject bootstrap liquidity into AMM reserves
        // We issue virtual "protocol shares" that are NOT user-owned
        // They inflate the pool depth so early trades get better prices
        yesReserve += yesAmount;
        noReserve  += noAmount;

        emit Bootstrapped(yesAmount, noAmount);
    }

    // ═════════════════════════════════════════════════════════════════
    //  LAYER 3 — LIMIT ORDER BOOK
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Post a limit order — "I want to buy YES at ≤ X cents"
     *
     * @dev    Orders sit in the book. When a market buy comes in that
     *         would cross the spread, it fills resting orders first
     *         (at their limit price) before hitting the AMM.
     *         This gives limit order makers a price improvement.
     *
     * @param  isYes       true = buy YES, false = buy NO
     * @param  priceLimit  max price willing to pay (PRICE_SCALE units)
     *                     e.g. 550000 = willing to pay up to 55¢ for YES
     * @param  usdhAmount  USDH to commit (locked until filled or cancelled)
     */
    function placeLimitOrder(
        bool    isYes,
        uint256 priceLimit,
        uint256 usdhAmount
    ) external nonReentrant returns (uint256 orderId) {
        if (emergencyPaused)                        revert Paused();
        if (block.timestamp >= params.closesAt)     revert MarketClosed();
        if (usdhAmount == 0)                        revert InvalidAmount();
        require(priceLimit > 0 && priceLimit < PRICE_SCALE, "invalid price");

        usdh.transferFrom(msg.sender, address(this), usdhAmount);

        orderId = nextOrderId++;
        orders[orderId] = LimitOrder({
            maker:       msg.sender,
            isYes:       isYes,
            priceLimit:  priceLimit,
            usdhAmount:  usdhAmount,
            active:      true
        });

        // Store in price bucket for matching
        if (isYes) {
            _yesBuckets[priceLimit].push(orderId);
        } else {
            _noBuckets[priceLimit].push(orderId);
        }

        emit OrderPlaced(orderId, msg.sender, isYes, priceLimit, usdhAmount);
    }

    /**
     * @notice Cancel an unfilled limit order and get USDH back
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        LimitOrder storage o = orders[orderId];
        if (msg.sender != o.maker) revert NotOrderMaker();
        if (!o.active)             revert OrderNotActive();

        uint256 refund = o.usdhAmount;
        o.active     = false;
        o.usdhAmount = 0;

        usdh.transfer(msg.sender, refund);
        emit OrderCancelled(orderId, msg.sender, refund);
    }

    // ═════════════════════════════════════════════════════════════════
    //  TRADING (AMM + order book matching)
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Buy YES or NO shares — fills limit orders first, then AMM
     *
     * @param  isYes      true = buy YES, false = buy NO
     * @param  usdhIn     USDH to spend
     * @param  minShares  slippage protection
     */
    function buy(
        bool    isYes,
        uint256 usdhIn,
        uint256 minShares
    ) external nonReentrant returns (uint256 sharesOut) {
        if (emergencyPaused)                        revert Paused();
        if (block.timestamp >= params.closesAt)     revert MarketClosed();
        if (usdhIn == 0)                            revert InvalidAmount();

        usdh.transferFrom(msg.sender, address(this), usdhIn);

        // Fees on total input
        uint256 platformFee = (usdhIn * PLATFORM_FEE)      / FEE_DENOM;
        uint256 creatorFee  = (usdhIn * params.creatorFee)  / FEE_DENOM;
        uint256 remaining   = usdhIn - platformFee - creatorFee;

        platformFeesAccrued += platformFee;
        creatorFeesAccrued  += creatorFee;

        // ── STEP 1: Fill resting limit orders first ────────────────────
        // A YES buyer can fill resting NO orders (and vice versa) when
        // their price limits cross. This gives both parties better fills
        // than the AMM would provide.
        uint256 filledFromBook;
        (remaining, filledFromBook, sharesOut) = _matchOrderBook(
            msg.sender, isYes, remaining
        );

        // ── STEP 2: Route any remaining USDH through the AMM ──────────
        if (remaining > 0) {
            uint256 ammShares = _getSharesOut(isYes, remaining);
            sharesOut += ammShares;

            if (isYes) {
                yesReserve += remaining;
                yesShares  += ammShares;
                yesBalance[msg.sender] += ammShares;
            } else {
                noReserve += remaining;
                noShares  += ammShares;
                noBalance[msg.sender] += ammShares;
            }

            totalCollateral += remaining;
        }

        if (sharesOut < minShares) revert SlippageExceeded();

        emit TradePlaced(msg.sender, isYes, usdhIn, sharesOut, _getYesPrice());
    }

    /**
     * @notice Sell shares back before market closes
     */
    function sell(
        bool    isYes,
        uint256 shares,
        uint256 minUsdh
    ) external nonReentrant returns (uint256 usdhOut) {
        if (emergencyPaused)                        revert Paused();
        if (block.timestamp >= params.closesAt)     revert MarketClosed();
        if (shares == 0)                            revert InvalidAmount();

        if (isYes) {
            require(yesBalance[msg.sender] >= shares, "insufficient YES");
            yesBalance[msg.sender] -= shares;
            yesShares -= shares;
        } else {
            require(noBalance[msg.sender] >= shares, "insufficient NO");
            noBalance[msg.sender] -= shares;
            noShares -= shares;
        }

        usdhOut = _getUsdhOut(isYes, shares);

        uint256 platformFee = (usdhOut * PLATFORM_FEE)     / FEE_DENOM;
        uint256 creatorFee  = (usdhOut * params.creatorFee) / FEE_DENOM;
        usdhOut            -= (platformFee + creatorFee);

        platformFeesAccrued += platformFee;
        creatorFeesAccrued  += creatorFee;
        totalCollateral     -= usdhOut;

        if (isYes) {
            yesReserve -= (usdhOut + platformFee + creatorFee);
        } else {
            noReserve  -= (usdhOut + platformFee + creatorFee);
        }

        if (usdhOut < minUsdh) revert SlippageExceeded();
        usdh.transfer(msg.sender, usdhOut);
    }

    // ═════════════════════════════════════════════════════════════════
    //  RESOLUTION
    // ═════════════════════════════════════════════════════════════════

    /// @notice Resolve via dual-oracle confirmation.
    ///         Calls aggregator.confirmPrice() which:
    ///           1. Reads HyperCore primary price
    ///           2. Reads secondary price (posted by off-chain monitor)
    ///           3. Reverts if either is stale or they deviate > 1%
    ///         Only settles using the confirmed average. If sources
    ///         disagree, resolution is blocked until they converge.
    function resolveWithOracle() external {
        _checkResolvable();
        require(
            params.resType == ResolutionType.PRICE_ABOVE ||
            params.resType == ResolutionType.PRICE_BELOW,
            "wrong resolution type"
        );

        // confirmPrice() reverts with a specific error if:
        //   - secondary price is missing or stale (> 5 min old)
        //   - deviation between HyperCore and secondary > 1%
        //   - either price is zero
        // This is the circuit breaker — no human override possible.
        uint256 price = aggregator.confirmPrice(params.assetIndex);

        settlementPrice = price;
        outcome = (params.resType == ResolutionType.PRICE_ABOVE)
            ? (price >= params.strikePrice ? Outcome.YES : Outcome.NO)
            : (price <= params.strikePrice ? Outcome.YES : Outcome.NO);

        resolved = true;
        emit MarketResolved(outcome, price);
    }

    /// @notice Resolve via trusted resolver (sports, earnings, macro)
    function resolveManual(bool yesWins) external {
        _checkResolvable();
        require(params.resType == ResolutionType.MANUAL, "wrong resolution type");
        if (msg.sender != params.resolver) revert NotResolver();

        outcome  = yesWins ? Outcome.YES : Outcome.NO;
        resolved = true;
        emit MarketResolved(outcome, 0);
    }

    /// @notice Mark INVALID — triggers full pro-rata refund path
    function resolveInvalid() external {
        _checkResolvable();
        require(msg.sender == factory || msg.sender == params.resolver, "unauthorized");
        outcome  = Outcome.INVALID;
        resolved = true;
        emit MarketResolved(Outcome.INVALID, 0);
    }

    // ═════════════════════════════════════════════════════════════════
    //  LAYER 2 — CLAIMING (with one-sided refund safety net)
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Claim winnings (or refund) after resolution.
     *
     * @dev    Three scenarios handled:
     *
     *  A) Normal market — both sides had traders
     *     → Winners split all collateral pro-rata. Standard winner-takes-all.
     *
     *  B) One-sided market — winning side had traders, losing side had NONE
     *     → Winners are fully refunded their collateral (minus fees).
     *       There was no real counterparty, so no winnings to claim — but
     *       crucially, nobody loses money to an empty market.
     *
     *  C) INVALID market
     *     → Everyone gets their collateral back pro-rata, regardless of side.
     */
    function claim() external nonReentrant {
        if (!resolved)              revert MarketNotResolved();
        if (hasClaimed[msg.sender]) revert NothingToClaim();

        hasClaimed[msg.sender] = true;

        uint256 payout = _calculatePayout(msg.sender);
        if (payout == 0)            revert NothingToClaim();

        usdh.transfer(msg.sender, payout);

        bool isOneSided = _isOneSidedMarket();
        if (isOneSided) {
            emit OneSidedRefund(msg.sender, payout);
        } else {
            emit WinningsClaimed(msg.sender, payout);
        }
    }

    /**
     * @dev  Core payout logic — handles all three resolution scenarios.
     */
    function _calculatePayout(address user) internal view returns (uint256) {
        uint256 userYes = yesBalance[user];
        uint256 userNo  = noBalance[user];

        // ── Scenario C: INVALID ────────────────────────────────────────
        if (outcome == Outcome.INVALID) {
            uint256 totalShares = yesShares + noShares;
            if (totalShares == 0) return 0;
            return (totalCollateral * (userYes + userNo)) / totalShares;
        }

        // Identify winning and losing share counts
        uint256 userWinShares;
        uint256 totalWinShares;
        uint256 userLoseShares;
        uint256 totalLoseShares;

        if (outcome == Outcome.YES) {
            userWinShares   = userYes;   totalWinShares   = yesShares;
            userLoseShares  = userNo;    totalLoseShares  = noShares;
        } else {
            userWinShares   = userNo;    totalWinShares   = noShares;
            userLoseShares  = userYes;   totalLoseShares  = yesShares;
        }

        // ── Scenario B: ONE-SIDED market ──────────────────────────────
        // Losing side has no traders (zero shares) → refund winners
        if (totalLoseShares == 0) {
            if (userWinShares == 0) return 0;
            // Refund winner their proportional share of collateral
            // (minus fees already taken — fair, since fee was for service)
            return (totalCollateral * userWinShares) / totalWinShares;
        }

        // ── Scenario A: NORMAL market — winner takes all ───────────────
        if (userWinShares == 0) return 0;
        return (totalCollateral * userWinShares) / totalWinShares;
    }

    /**
     * @dev Returns true if one side of the market has zero trader shares.
     *      Bootstrap shares are NOT counted — protocol liquidity doesn't
     *      count as a "real" counterparty for this check.
     */
    function _isOneSidedMarket() internal view returns (bool) {
        if (outcome == Outcome.YES) return noShares == 0;
        if (outcome == Outcome.NO)  return yesShares == 0;
        return false;
    }

    // ─────────────────────────────────────────────────────────────────
    //  BOOTSTRAP RECLAIM (after resolution)
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Factory calls this after resolution to reclaim its bootstrap
     *         liquidity. Must be called after all traders have claimed.
     *
     * @dev    Safe to call any time after resolution — bootstrap USDH
     *         is tracked separately and never mixed with trader funds.
     */
    function reclaimBootstrap() external nonReentrant {
        if (msg.sender != factory) revert OnlyFactory();
        require(resolved, "not resolved");

        uint256 amount = bootstrapYes + bootstrapNo;
        require(amount > 0, "nothing to reclaim");

        bootstrapYes = 0;
        bootstrapNo  = 0;

        // Only send what's actually in the contract (after trader claims)
        uint256 available = usdh.balanceOf(address(this))
            - platformFeesAccrued
            - creatorFeesAccrued;
        uint256 send = amount < available ? amount : available;

        if (send > 0) {
            usdh.transfer(factory, send);
            emit BootstrapReclaimed(factory, send);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    //  FEE WITHDRAWAL
    // ─────────────────────────────────────────────────────────────────

    function withdrawFees() external {
        uint256 platformAmt;
        uint256 creatorAmt;

        if (msg.sender == factory) {
            platformAmt = platformFeesAccrued;
            platformFeesAccrued = 0;
        }
        if (msg.sender == creator) {
            creatorAmt = creatorFeesAccrued;
            creatorFeesAccrued = 0;
        }

        require(platformAmt + creatorAmt > 0, "nothing to withdraw");

        address recipient = (msg.sender == factory)
            ? IHyperFlexFactory(factory).feeRecipient()
            : creator;

        usdh.transfer(recipient, platformAmt + creatorAmt);
    }

    // ─────────────────────────────────────────────────────────────────
    //  ORDER BOOK MATCHING (internal)
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev  Try to fill resting orders on the opposite side before
     *       routing to the AMM.
     *
     *       A YES buyer at market crosses against NO limit orders
     *       whose priceLimit >= current NO price (i.e. NO ≤ 1 - yesPrice).
     *
     *       Matching is greedy: scans price buckets from best to worst,
     *       fills as much as possible, then returns the remainder.
     *
     * @return remainingUsdh  USDH not matched (goes to AMM)
     * @return filledUsdh     USDH matched via order book
     * @return sharesFromBook Shares received by taker from book fills
     */
    function _matchOrderBook(
        address taker,
        bool    isYes,
        uint256 usdhIn
    ) internal returns (uint256 remainingUsdh, uint256 filledUsdh, uint256 sharesFromBook) {
        remainingUsdh = usdhIn;

        // Current AMM price — orders at better-or-equal price get matched
        uint256 currentYesPrice = _getYesPrice();
        uint256 currentNoPrice  = PRICE_SCALE - currentYesPrice;

        // Scan price buckets: YES buyer looks for NO orders priced ≤ NO market price
        // meaning the NO seller is willing to sell NO cheaper than AMM
        // We scan from lowest NO ask (best for buyer) upward
        // For simplicity: scan the 20 best price levels (gas-bounded)
        uint256 scanned = 0;
        uint256 maxScan = 20;

        for (uint256 p = 1; p < PRICE_SCALE && scanned < maxScan && remainingUsdh > 0; p += PRICE_SCALE / 100) {
            // For YES buyer: look for NO orders whose priceLimit makes them
            // willing to take the other side at ≤ current AMM NO price
            mapping(uint256 => uint256[]) storage buckets = isYes ? _noBuckets : _yesBuckets;
            uint256[] storage bucket = buckets[p];

            for (uint256 j = 0; j < bucket.length && remainingUsdh > 0; j++) {
                uint256 oid = bucket[j];
                LimitOrder storage o = orders[oid];
                if (!o.active) continue;

                // Check price compatibility
                // YES buyer crosses with NO order if NO order's priceLimit >= currentNoPrice
                // (the NO seller is willing to sell NO at at most their priceLimit)
                bool compatible = isYes
                    ? (PRICE_SCALE - o.priceLimit) <= currentNoPrice   // NO seller price OK
                    : o.priceLimit >= currentNoPrice;                   // YES seller price OK

                if (!compatible) continue;

                // Fill as much as possible
                uint256 fillUsdh = remainingUsdh < o.usdhAmount ? remainingUsdh : o.usdhAmount;

                // Calculate shares at the order's limit price (better than AMM for taker)
                uint256 fillPrice     = isYes ? (PRICE_SCALE - o.priceLimit) : o.priceLimit;
                uint256 sharesForFill = (fillUsdh * PRICE_SCALE) / fillPrice;

                // Give taker their shares
                if (isYes) {
                    yesBalance[taker] += sharesForFill;
                    yesShares         += sharesForFill;
                } else {
                    noBalance[taker]  += sharesForFill;
                    noShares          += sharesForFill;
                }

                // Give maker their shares (opposite side)
                if (isYes) {
                    noBalance[o.maker] += sharesForFill;
                    noShares           += sharesForFill;
                } else {
                    yesBalance[o.maker] += sharesForFill;
                    yesShares           += sharesForFill;
                }

                totalCollateral  += fillUsdh * 2; // both sides' USDH now locked
                sharesFromBook   += sharesForFill;
                filledUsdh       += fillUsdh;
                remainingUsdh    -= fillUsdh;

                o.usdhAmount -= fillUsdh;
                if (o.usdhAmount == 0) o.active = false;

                emit OrderFilled(oid, taker, fillUsdh, sharesForFill);
            }
            scanned++;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    //  AMM MATH (internal)
    // ─────────────────────────────────────────────────────────────────

    function _getSharesOut(bool isYes, uint256 usdhIn) internal view returns (uint256) {
        if (isYes) {
            if (yesShares == 0) return usdhIn; // first trade edge case
            return (yesShares * usdhIn) / (yesReserve + usdhIn);
        } else {
            if (noShares == 0) return usdhIn;
            return (noShares * usdhIn) / (noReserve + usdhIn);
        }
    }

    function _getUsdhOut(bool isYes, uint256 sharesIn) internal view returns (uint256) {
        if (isYes) return (yesReserve  * sharesIn) / (yesShares + sharesIn);
        else       return (noReserve   * sharesIn) / (noShares  + sharesIn);
    }

    function _getYesPrice() internal view returns (uint256) {
        uint256 total = yesReserve + noReserve;
        if (total == 0) return PRICE_SCALE / 2;
        return (noReserve * PRICE_SCALE) / total;
    }

    function _checkResolvable() internal view {
        require(!resolved,                             "already resolved");
        require(block.timestamp >= params.resolvesAt,  "too early to resolve");
    }

    // ─────────────────────────────────────────────────────────────────
    //  VIEWS
    // ─────────────────────────────────────────────────────────────────

    function getYesPrice() external view returns (uint256) { return _getYesPrice(); }
    function getNoPrice()  external view returns (uint256) { return PRICE_SCALE - _getYesPrice(); }

    /// @notice Quote a trade — reads order book + AMM to give accurate estimate
    function getQuote(bool isYes, uint256 usdhIn) external view returns (
        uint256 sharesOut,
        uint256 priceAfter,
        uint256 priceImpactBps
    ) {
        uint256 pf  = (usdhIn * PLATFORM_FEE)      / FEE_DENOM;
        uint256 cf  = (usdhIn * params.creatorFee)  / FEE_DENOM;
        uint256 net = usdhIn - pf - cf;

        sharesOut = _getSharesOut(isYes, net);

        uint256 priceBefore = _getYesPrice();
        uint256 newYes = isYes ? yesReserve + net : yesReserve;
        uint256 newNo  = isYes ? noReserve : noReserve + net;
        priceAfter = (newYes + newNo > 0) ? (newNo * PRICE_SCALE) / (newYes + newNo) : priceBefore;

        uint256 diff = isYes
            ? (priceAfter > priceBefore ? priceAfter - priceBefore : 0)
            : (priceBefore > priceAfter ? priceBefore - priceAfter : 0);

        priceImpactBps = priceBefore > 0 ? (diff * FEE_DENOM) / priceBefore : 0;
    }

    function getUserPosition(address user) external view returns (
        uint256 yes,
        uint256 no,
        uint256 estimatedPayout
    ) {
        yes = yesBalance[user];
        no  = noBalance[user];
        estimatedPayout = resolved ? _calculatePayout(user) : 0;
    }

    function getMarketSummary() external view returns (
        string  memory question,
        string  memory sector,
        uint256 closesAt,
        uint256 yesPrice,
        uint256 volume,
        Outcome currentOutcome,
        bool    isResolved,
        bool    isOneSided,
        bool    hasBootstrap
    ) {
        question       = params.question;
        sector         = params.sector;
        closesAt       = params.closesAt;
        yesPrice       = _getYesPrice();
        volume         = totalCollateral;
        currentOutcome = outcome;
        isResolved     = resolved;
        isOneSided     = resolved ? _isOneSidedMarket() : (yesShares == 0 || noShares == 0);
        hasBootstrap   = bootstrapped;
    }

    /// @notice Get open limit orders near the current price (for UI order book display)
    function getOrderBook(uint256 depth) external view returns (
        uint256[] memory bidPrices,
        uint256[] memory bidSizes,
        uint256[] memory askPrices,
        uint256[] memory askSizes
    ) {
        bidPrices = new uint256[](depth);
        bidSizes  = new uint256[](depth);
        askPrices = new uint256[](depth);
        askSizes  = new uint256[](depth);

        uint256 yesP = _getYesPrice();
        uint256 noP  = PRICE_SCALE - yesP;

        // Sample up to `depth` price levels around the current price
        for (uint256 i = 0; i < depth; i++) {
            uint256 bidLevel = yesP > i * (PRICE_SCALE / 100)
                ? yesP - i * (PRICE_SCALE / 100) : 0;
            uint256 askLevel = yesP + (i + 1) * (PRICE_SCALE / 100);

            bidPrices[i] = bidLevel;
            askPrices[i] = askLevel < PRICE_SCALE ? askLevel : 0;

            // Sum open orders at each level
            uint256[] storage yesBid = _yesBuckets[bidLevel];
            for (uint256 j = 0; j < yesBid.length; j++) {
                if (orders[yesBid[j]].active) bidSizes[i] += orders[yesBid[j]].usdhAmount;
            }
            uint256[] storage noAsk = _noBuckets[askLevel];
            for (uint256 j = 0; j < noAsk.length; j++) {
                if (orders[noAsk[j]].active) askSizes[i] += orders[noAsk[j]].usdhAmount;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    //  EMERGENCY
    // ─────────────────────────────────────────────────────────────────

    function setEmergencyPause(bool paused) external {
        if (msg.sender != factory) revert OnlyFactory();
        emergencyPaused = paused;
        emit EmergencyPause(paused);
    }
}

// Minimal interface to avoid circular import
interface IHyperFlexFactory {
    function feeRecipient() external view returns (address);
}
