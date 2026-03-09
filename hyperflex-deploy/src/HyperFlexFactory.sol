// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HyperFlexMarket, MarketParams, Outcome, ResolutionType} from "./HyperFlexMarket.sol";
import {Ownable} from "./utils/Ownable.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/**
 * @title  HyperFlexFactory v2
 * @notice Deploys markets AND automatically seeds both sides with bootstrap
 *         liquidity so every market is tradeable from block 1.
 *
 * Bootstrap flow:
 *   1. Factory holds a USDH reserve (funded by protocol treasury)
 *   2. On createMarket() → factory approves new market contract
 *      for (2 × bootstrapAmount) → calls market.bootstrap()
 *   3. Both YES and NO sides start with real depth
 *   4. After resolution, factory calls reclaimBootstrap() to recover funds
 *      (bootstrap USDH is recycled, not burned)
 */
contract HyperFlexFactory is Ownable {

    // ── Config ────────────────────────────────────────────────────────
    address public usdh;
    address public oracle;
    address public aggregator;            // dual-oracle price aggregator
    address public feeRecipient;
    uint256 public marketCreationFee;
    uint256 public bootstrapAmount;
    uint256 public bootstrapReserve;

    // ── Registry ──────────────────────────────────────────────────────
    uint256 public marketCount;
    mapping(uint256 => address) public markets;
    mapping(address => uint256[]) public creatorMarkets;
    mapping(string  => uint256[]) public sectorMarkets;
    address[] public allMarkets;

    // ── Events ────────────────────────────────────────────────────────
    event MarketCreated(
        uint256 indexed marketId,
        address indexed market,
        address indexed creator,
        string  question,
        string  sector,
        uint256 closesAt,
        bool    bootstrapped
    );
    event BootstrapReserveDeposited(uint256 amount);
    event BootstrapReclaimed(uint256 marketId, uint256 amount);
    event BootstrapAmountUpdated(uint256 newAmount);

    // ── Errors ────────────────────────────────────────────────────────
    error InsufficientCreationFee();
    error InvalidMarketParams();
    error InsufficientBootstrapReserve();

    // ─────────────────────────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────

    constructor(
        address _usdh,
        address _oracle,
        address _aggregator,
        address _feeRecipient,
        uint256 _marketCreationFee,
        uint256 _bootstrapAmount
    ) Ownable(msg.sender) {
        usdh              = _usdh;
        oracle            = _oracle;
        aggregator        = _aggregator;
        feeRecipient      = _feeRecipient;
        marketCreationFee = _marketCreationFee;
        bootstrapAmount   = _bootstrapAmount;
    }

    // ─────────────────────────────────────────────────────────────────
    //  BOOTSTRAP RESERVE MANAGEMENT
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Fund the bootstrap reserve — protocol treasury deposits USDH here.
     *         This USDH gets recycled: deployed to new markets, reclaimed after
     *         resolution, then re-deployed to the next batch of markets.
     */
    function depositBootstrapReserve(uint256 amount) external {
        IERC20(usdh).transferFrom(msg.sender, address(this), amount);
        bootstrapReserve += amount;
        emit BootstrapReserveDeposited(amount);
    }

    /**
     * @notice Reclaim bootstrap USDH from a resolved market back into reserve.
     *         Call this after all traders have claimed their winnings.
     */
    function reclaimBootstrap(uint256 marketId) external onlyOwner {
        address market = markets[marketId];
        require(market != address(0), "market not found");

        uint256 before = IERC20(usdh).balanceOf(address(this));
        HyperFlexMarket(market).reclaimBootstrap();
        uint256 recovered = IERC20(usdh).balanceOf(address(this)) - before;

        bootstrapReserve += recovered;
        emit BootstrapReclaimed(marketId, recovered);
    }

    // ─────────────────────────────────────────────────────────────────
    //  CREATE MARKET
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Deploy a new prediction market with automatic bootstrap liquidity.
     *
     * @dev    If bootstrapAmount > 0 and reserve is sufficient, both YES and NO
     *         sides are seeded immediately. If reserve is insufficient, the market
     *         still deploys but without bootstrap (virtual AMM only).
     */
    function createMarket(MarketParams calldata params)
        external
        returns (uint256 marketId, address market)
    {
        if (params.closesAt   <= block.timestamp)   revert InvalidMarketParams();
        if (params.resolvesAt <= params.closesAt)   revert InvalidMarketParams();
        if (bytes(params.question).length == 0)     revert InvalidMarketParams();

        // Collect creation fee
        if (marketCreationFee > 0) {
            bool ok = IERC20(usdh).transferFrom(msg.sender, feeRecipient, marketCreationFee);
            if (!ok) revert InsufficientCreationFee();
        }

        // Deploy market
        marketId = marketCount++;
        HyperFlexMarket m = new HyperFlexMarket(
            marketId,
            address(this),
            msg.sender,
            usdh,
            oracle,
            aggregator,
            params
        );
        market = address(m);

        // Register
        markets[marketId]              = market;
        allMarkets.push(market);
        creatorMarkets[msg.sender].push(marketId);
        sectorMarkets[params.sector].push(marketId);

        // ── Bootstrap if reserve is sufficient ──────────────────────
        bool didBootstrap = false;
        uint256 totalSeed = bootstrapAmount * 2; // one side each
        if (bootstrapAmount > 0 && bootstrapReserve >= totalSeed) {
            bootstrapReserve -= totalSeed;
            IERC20(usdh).approve(market, totalSeed);
            m.bootstrap(bootstrapAmount, bootstrapAmount);
            didBootstrap = true;
        }

        emit MarketCreated(
            marketId, market, msg.sender,
            params.question, params.sector, params.closesAt,
            didBootstrap
        );
    }

    /**
     * @notice Batch-create markets (AI scanner "Deploy All" button)
     */
    function batchCreateMarkets(MarketParams[] calldata paramsList)
        external
        returns (uint256[] memory ids, address[] memory addrs)
    {
        uint256 n = paramsList.length;
        require(n > 0 && n <= 20, "1-20 per batch");
        ids   = new uint256[](n);
        addrs = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            (ids[i], addrs[i]) = this.createMarket(paramsList[i]);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    //  VIEWS
    // ─────────────────────────────────────────────────────────────────

    function bootstrapReserveUsdh() external view returns (uint256) {
        return bootstrapReserve;
    }

    function canBootstrapNextMarket() external view returns (bool) {
        return bootstrapReserve >= bootstrapAmount * 2;
    }

    function getMarketsByCreator(address creator) external view returns (uint256[] memory) {
        return creatorMarkets[creator];
    }

    function getMarketsBySector(string calldata sector) external view returns (uint256[] memory) {
        return sectorMarkets[sector];
    }

    function getAllMarketsCount() external view returns (uint256) {
        return allMarkets.length;
    }

    function getMarkets(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = allMarkets.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = 0; i < page.length; i++) {
            page[i] = allMarkets[total - 1 - offset - i];
        }
    }

    // ─────────────────────────────────────────────────────────────────
    //  EMERGENCY
    // ─────────────────────────────────────────────────────────────────

    function pauseMarket(uint256 marketId, bool paused) external onlyOwner {
        HyperFlexMarket(markets[marketId]).setEmergencyPause(paused);
    }

    function resolveMarketInvalid(uint256 marketId) external onlyOwner {
        HyperFlexMarket(markets[marketId]).resolveInvalid();
    }

    // ─────────────────────────────────────────────────────────────────
    //  ADMIN
    // ─────────────────────────────────────────────────────────────────

    function setFeeRecipient(address r)  external onlyOwner   { feeRecipient      = r; }
    function setCreationFee(uint256 f)   external onlyOwner   { marketCreationFee = f; }
    function setOracle(address o)        external onlyOwner   { oracle            = o; }
    function setAggregator(address a)    external onlyOwner   { aggregator        = a; }
    function setBootstrapAmount(uint256 a) external onlyOwner {
        bootstrapAmount = a;
        emit BootstrapAmountUpdated(a);
    }
}

// IERC20 imported from ./interfaces/IERC20.sol
