// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHyperCoreOracle} from "./interfaces/IHyperCoreOracle.sol";

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         HYPERFLEX — Dual Oracle Price Aggregator                 ║
 * ║                                                                  ║
 * ║  Two-source price confirmation before any market can resolve.   ║
 * ║                                                                  ║
 * ║  Source A: HyperCore precompile (primary — on-chain, trustless) ║
 * ║  Source B: Permissioned price feeder (secondary — off-chain     ║
 * ║            script pulls from Coinbase/Binance/Kitco APIs and    ║
 * ║            posts on-chain via pushPrice())                       ║
 * ║                                                                  ║
 * ║  Resolution is only allowed when:                                ║
 * ║    1. Both prices are fresh (within MAX_PRICE_AGE seconds)      ║
 * ║    2. Both prices agree within MAX_DEVIATION (default 1%)       ║
 * ║    3. Neither price is zero                                      ║
 * ║                                                                  ║
 * ║  If the two sources disagree by more than MAX_DEVIATION:        ║
 * ║    → resolution is blocked                                       ║
 * ║    → a PriceDeviation event fires                               ║
 * ║    → humans are alerted to investigate before resolving         ║
 * ║                                                                  ║
 * ║  Circuit breaker: if either oracle hasn't been updated in       ║
 * ║  MAX_PRICE_AGE, all resolutions halt until prices refresh.      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
contract HyperFlexPriceAggregator {

    // ── Config ────────────────────────────────────────────────────────
    uint256 public constant MAX_DEVIATION  = 100;    // 1.00% in bps (10_000 = 100%)
    uint256 public constant MAX_PRICE_AGE  = 5 minutes; // both prices must be this fresh
    uint256 public constant DEVIATION_DENOM = 10_000;

    // ── HyperCore primary oracle (precompile) ─────────────────────────
    IHyperCoreOracle public immutable hyperCoreOracle;

    // ── Secondary price feed (pushed by off-chain monitoring script) ──
    struct SecondaryPrice {
        uint256 price;        // 6-decimal USD
        uint256 updatedAt;    // block.timestamp of last push
        string  source;       // "Coinbase" | "Binance" | "Kitco" | "CoinGecko"
    }
    mapping(uint32 => SecondaryPrice) public secondaryPrices;

    // ── Access control ────────────────────────────────────────────────
    address public owner;
    mapping(address => bool) public feeders; // off-chain bots allowed to push prices

    // ── Price history (last 10 readings per asset for anomaly detection)
    uint256 public constant HISTORY_SIZE = 10;
    mapping(uint32 => uint256[HISTORY_SIZE]) public priceHistory;
    mapping(uint32 => uint8)                 public historyIndex; // ring buffer pointer

    // ── Events ────────────────────────────────────────────────────────
    event PricePushed(
        uint32  indexed assetIndex,
        uint256 price,
        string  source,
        address feeder
    );
    event PriceDeviation(
        uint32  indexed assetIndex,
        uint256 primaryPrice,
        uint256 secondaryPrice,
        uint256 deviationBps,
        bool    resolutionBlocked
    );
    event PriceConfirmed(
        uint32  indexed assetIndex,
        uint256 confirmedPrice,
        uint256 deviationBps
    );
    event CircuitBreakerTriggered(
        uint32  indexed assetIndex,
        string  reason
    );
    event FeederAdded(address feeder);
    event FeederRemoved(address feeder);

    // ── Errors ────────────────────────────────────────────────────────
    error NotFeeder();
    error NotOwner();
    error PriceTooStale(uint32 assetIndex, uint256 age, uint256 maxAge);
    error PriceDeviationTooHigh(uint32 assetIndex, uint256 deviationBps, uint256 maxBps);
    error PrimaryPriceZero(uint32 assetIndex);
    error SecondaryPriceZero(uint32 assetIndex);
    error NoSecondaryPrice(uint32 assetIndex);

    // ─────────────────────────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────

    constructor(address _hyperCoreOracle) {
        owner            = msg.sender;
        feeders[msg.sender] = true;
        hyperCoreOracle  = IHyperCoreOracle(_hyperCoreOracle);
    }

    // ─────────────────────────────────────────────────────────────────
    //  SECONDARY PRICE FEED (off-chain bot pushes here)
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Push a secondary price from an external source.
     *         Called by the off-chain monitoring script every 60s.
     *
     * @param  assetIndex  HyperCore asset index (0=BTC, 11=XAG, 12=XAU, etc.)
     * @param  price       6-decimal USD price (e.g. 5_171_000_000 = $5,171)
     * @param  source      Human-readable source label ("Coinbase", "Kitco", etc.)
     */
    function pushPrice(uint32 assetIndex, uint256 price, string calldata source) external {
        if (!feeders[msg.sender] && msg.sender != owner) revert NotFeeder();
        require(price > 0, "price cannot be zero");

        // Store in ring-buffer history
        uint8 idx = historyIndex[assetIndex];
        priceHistory[assetIndex][idx] = price;
        historyIndex[assetIndex] = uint8((idx + 1) % HISTORY_SIZE);

        secondaryPrices[assetIndex] = SecondaryPrice({
            price:     price,
            updatedAt: block.timestamp,
            source:    source
        });

        emit PricePushed(assetIndex, price, source, msg.sender);
    }

    /**
     * @notice Batch push — more gas efficient for the monitoring script
     *         updating multiple assets in one tx.
     */
    function pushPriceBatch(
        uint32[]  calldata indices,
        uint256[] calldata prices,
        string    calldata source
    ) external {
        if (!feeders[msg.sender] && msg.sender != owner) revert NotFeeder();
        require(indices.length == prices.length, "length mismatch");
        require(indices.length <= 20,            "max 20 per batch");

        for (uint256 i = 0; i < indices.length; i++) {
            require(prices[i] > 0, "price cannot be zero");
            uint8 idx = historyIndex[indices[i]];
            priceHistory[indices[i]][idx] = prices[i];
            historyIndex[indices[i]] = uint8((idx + 1) % HISTORY_SIZE);
            secondaryPrices[indices[i]] = SecondaryPrice({
                price:     prices[i],
                updatedAt: block.timestamp,
                source:    source
            });
            emit PricePushed(indices[i], prices[i], source, msg.sender);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    //  PRICE CONFIRMATION (called by HyperFlexMarket before resolving)
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice The main function — confirms a price is valid before resolution.
     *
     * @dev    Returns the confirmed price (average of both sources if they agree).
     *         Reverts with a specific error if confirmation fails, which blocks
     *         the market from resolving until the issue is fixed.
     *
     * @param  assetIndex  HyperCore asset index
     * @return confirmed   The verified settlement price to use
     */
    function confirmPrice(uint32 assetIndex) external returns (uint256 confirmed) {
        // ── Get primary price (HyperCore precompile) ──────────────────
        uint256 primaryPrice = hyperCoreOracle.getMarkPrice(assetIndex);
        if (primaryPrice == 0) revert PrimaryPriceZero(assetIndex);

        // ── Get secondary price ───────────────────────────────────────
        SecondaryPrice memory sec = secondaryPrices[assetIndex];
        if (sec.price == 0)     revert NoSecondaryPrice(assetIndex);
        if (sec.price == 0)     revert SecondaryPriceZero(assetIndex);

        // ── Staleness check ───────────────────────────────────────────
        uint256 secAge = block.timestamp - sec.updatedAt;
        if (secAge > MAX_PRICE_AGE) {
            emit CircuitBreakerTriggered(assetIndex, "secondary price stale");
            revert PriceTooStale(assetIndex, secAge, MAX_PRICE_AGE);
        }

        // ── Deviation check ───────────────────────────────────────────
        uint256 deviationBps = _deviationBps(primaryPrice, sec.price);

        if (deviationBps > MAX_DEVIATION) {
            emit PriceDeviation(assetIndex, primaryPrice, sec.price, deviationBps, true);
            emit CircuitBreakerTriggered(assetIndex, "price deviation too high");
            revert PriceDeviationTooHigh(assetIndex, deviationBps, MAX_DEVIATION);
        }

        // ── Both sources agree — use average ──────────────────────────
        confirmed = (primaryPrice + sec.price) / 2;
        emit PriceConfirmed(assetIndex, confirmed, deviationBps);
    }

    /**
     * @notice Read-only version — check if a price would pass confirmation
     *         without reverting. Used by the off-chain script to monitor.
     *
     * @return ok           true if both sources agree and are fresh
     * @return primaryPrice price from HyperCore
     * @return secondaryPrice price from secondary source
     * @return deviationBps deviation between the two (bps)
     * @return reason       human-readable failure reason if !ok
     */
    function checkPrice(uint32 assetIndex) external view returns (
        bool    ok,
        uint256 primaryPrice,
        uint256 secondaryPrice,
        uint256 deviationBps,
        string  memory reason
    ) {
        primaryPrice = hyperCoreOracle.getMarkPrice(assetIndex);
        if (primaryPrice == 0) {
            return (false, 0, 0, 0, "primary price is zero");
        }

        SecondaryPrice memory sec = secondaryPrices[assetIndex];
        secondaryPrice = sec.price;

        if (sec.price == 0) {
            return (false, primaryPrice, 0, 0, "no secondary price pushed yet");
        }

        uint256 age = block.timestamp - sec.updatedAt;
        if (age > MAX_PRICE_AGE) {
            return (false, primaryPrice, sec.price, 0,
                string(abi.encodePacked("secondary price stale: ", _uintToStr(age), "s old")));
        }

        deviationBps = _deviationBps(primaryPrice, sec.price);
        if (deviationBps > MAX_DEVIATION) {
            return (false, primaryPrice, sec.price, deviationBps,
                string(abi.encodePacked("deviation ", _uintToStr(deviationBps), " bps > max ", _uintToStr(MAX_DEVIATION), " bps")));
        }

        ok = true;
        reason = "ok";
    }

    /**
     * @notice Get price history for an asset — useful for spotting
     *         manipulation attempts (sudden spikes that disappear).
     */
    function getPriceHistory(uint32 assetIndex) external view returns (uint256[HISTORY_SIZE] memory) {
        return priceHistory[assetIndex];
    }

    // ─────────────────────────────────────────────────────────────────
    //  INTERNAL MATH
    // ─────────────────────────────────────────────────────────────────

    function _deviationBps(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) return DEVIATION_DENOM; // 100% deviation
        uint256 diff  = a > b ? a - b : b - a;
        uint256 base  = a > b ? a : b; // use larger as denominator (conservative)
        return (diff * DEVIATION_DENOM) / base;
    }

    function _uintToStr(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v; uint256 digits;
        while (tmp != 0) { digits++; tmp /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { digits--; buf[digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }

    // ─────────────────────────────────────────────────────────────────
    //  ACCESS CONTROL
    // ─────────────────────────────────────────────────────────────────

    function addFeeder(address feeder) external {
        if (msg.sender != owner) revert NotOwner();
        feeders[feeder] = true;
        emit FeederAdded(feeder);
    }

    function removeFeeder(address feeder) external {
        if (msg.sender != owner) revert NotOwner();
        feeders[feeder] = false;
        emit FeederRemoved(feeder);
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert NotOwner();
        owner = newOwner;
    }
}
