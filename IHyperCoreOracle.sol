// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  IHyperCoreOracle
 * @notice Interface for the HyperEVM system precompile that reads
 *         live HyperCore oracle/mark prices directly on-chain.
 *
 * @dev    Precompile address: 0x0000000000000000000000000000000000000800
 *         (verify against official Hyperliquid docs before deploying)
 *
 *         This is the "L1Read" precompile documented at:
 *         hyperliquid.gitbook.io/hyperliquid-docs/for-developers/
 *         hyperevm/interacting-with-hypercore
 *
 *         Price units: 6-decimal USD (e.g. 32_000_000 = $32.00)
 *
 * ── HyperCore Asset Index Reference (as of Feb 2026) ──────────
 *  0  = BTC
 *  1  = ETH
 *  2  = SOL
 *  3  = ARB
 *  4  = OP
 *  5  = AVAX
 *  6  = MATIC
 *  7  = DOGE
 *  8  = LINK
 *  9  = ATOM
 *  10 = HYPE
 *  11 = XAG  (Silver spot, if listed)
 *  12 = XAU  (Gold spot, if listed)
 *  13 = WTI  (Crude oil, if listed)
 *  ... (check Hyperliquid metadata for current indices)
 */
interface IHyperCoreOracle {

    /**
     * @notice Get the mark price for a perpetual asset
     * @param  assetIndex  HyperCore internal asset index
     * @return price       Price in USD with 6 decimals
     */
    function getMarkPrice(uint32 assetIndex) external view returns (uint256 price);

    /**
     * @notice Get the oracle (index) price for an asset
     * @dev    May differ slightly from mark price due to funding
     */
    function getOraclePrice(uint32 assetIndex) external view returns (uint256 price);

    /**
     * @notice Get both mark and oracle prices in one call
     */
    function getPrices(uint32 assetIndex) external view returns (
        uint256 markPrice,
        uint256 oraclePrice
    );
}

/**
 * @title  HyperCoreOracleLib
 * @notice Convenience library for reading prices from the precompile
 *
 * @dev    Usage:
 *         using HyperCoreOracleLib for uint32;
 *         uint256 btcPrice = uint32(0).getPrice();
 */
library HyperCoreOracleLib {

    // Official precompile address — verify before mainnet deploy
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000800;

    function getPrice(uint32 assetIndex) internal view returns (uint256) {
        return IHyperCoreOracle(PRECOMPILE).getMarkPrice(assetIndex);
    }

    function getOraclePrice(uint32 assetIndex) internal view returns (uint256) {
        return IHyperCoreOracle(PRECOMPILE).getOraclePrice(assetIndex);
    }

    /**
     * @notice Check whether a price meets a threshold condition
     * @param assetIndex  HyperCore asset
     * @param threshold   Price threshold (6 dec USD)
     * @param above       true = check price >= threshold, false = check price <= threshold
     */
    function checkCondition(
        uint32  assetIndex,
        uint256 threshold,
        bool    above
    ) internal view returns (bool) {
        uint256 price = getPrice(assetIndex);
        return above ? price >= threshold : price <= threshold;
    }
}

// ─────────────────────────────────────────────────────────────
//  ASSET INDEX CONSTANTS (for readability in factory scripts)
// ─────────────────────────────────────────────────────────────

library HyperAssets {
    uint32 internal constant BTC    = 0;
    uint32 internal constant ETH    = 1;
    uint32 internal constant SOL    = 2;
    uint32 internal constant HYPE   = 10;
    uint32 internal constant XAG    = 11;   // Silver
    uint32 internal constant XAU    = 12;   // Gold
    uint32 internal constant WTI    = 13;   // Crude oil
    uint32 internal constant COPPER = 14;   // Copper
    // Add more as HyperLiquid lists them
}
