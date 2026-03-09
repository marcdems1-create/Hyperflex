// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  MockHyperCoreOracle
 * @notice Testnet stand-in for the HyperCore oracle precompile.
 *
 *         Prices sourced from HYPERFLEX scanner + landing page (March 2026):
 *           XAU  $5,171/oz   XAG  $83.48/oz
 *           WTI  $89.00/bbl  COPPER $4.82/lb
 *           BTC  ~$85,000    ETH  ~$2,000
 *           HYPE ~$15        SOL  ~$130
 *
 *         All prices: 6 decimal USD (e.g. 5_171_000_000 = $5,171.00)
 *
 * Asset index reference (matches HyperCore mainnet):
 *   0=BTC  1=ETH  2=SOL  10=HYPE  11=XAG  12=XAU  13=WTI  14=COPPER
 */
contract MockHyperCoreOracle {

    address public owner;
    mapping(address => bool) public feeders;

    // assetIndex => price (6 decimals USD)
    mapping(uint32 => uint256) public prices;
    mapping(uint32 => uint256) public lastUpdated;

    event PriceSet(uint32 indexed assetIndex, uint256 price, address setter);
    event FeederAdded(address feeder);
    event FeederRemoved(address feeder);

    constructor() {
        owner = msg.sender;
        feeders[msg.sender] = true;

        // ── Prices as of March 2026 (from HYPERFLEX scanner) ──────────
        // Format: asset_price * 1e6
        prices[0]  =  85_000_000_000;  // BTC    $85,000.00
        prices[1]  =   2_000_000_000;  // ETH     $2,000.00
        prices[2]  =     130_000_000;  // SOL       $130.00
        prices[3]  =       1_200_000;  // ARB         $1.20
        prices[4]  =       1_800_000;  // OP          $1.80
        prices[5]  =      25_000_000;  // AVAX       $25.00
        prices[6]  =         500_000;  // MATIC        $0.50
        prices[7]  =         180_000;  // DOGE         $0.18
        prices[8]  =      14_000_000;  // LINK       $14.00
        prices[9]  =       6_000_000;  // ATOM         $6.00
        prices[10] =      15_000_000;  // HYPE       $15.00
        prices[11] =      83_480_000;  // XAG        $83.48/oz  ← landing page
        prices[12] = 5_171_000_000;   // XAU     $5,171.00/oz  ← landing page
        prices[13] =      89_000_000;  // WTI        $89.00/bbl ← landing page
        prices[14] =       4_820_000;  // COPPER      $4.82/lb  ← landing page
    }

    // ── Price reading (matches IHyperCoreOracle interface) ────────────

    function getMarkPrice(uint32 assetIndex) external view returns (uint256) {
        return prices[assetIndex];
    }

    function getOraclePrice(uint32 assetIndex) external view returns (uint256) {
        return prices[assetIndex];
    }

    function getPrices(uint32 assetIndex) external view returns (uint256, uint256) {
        return (prices[assetIndex], prices[assetIndex]);
    }

    // ── Price setting ──────────────────────────────────────────────────

    function setPrice(uint32 assetIndex, uint256 price) external {
        require(feeders[msg.sender] || msg.sender == owner, "not authorized");
        prices[assetIndex]      = price;
        lastUpdated[assetIndex] = block.timestamp;
        emit PriceSet(assetIndex, price, msg.sender);
    }

    function setPriceBatch(uint32[] calldata indices, uint256[] calldata newPrices) external {
        require(feeders[msg.sender] || msg.sender == owner, "not authorized");
        require(indices.length == newPrices.length, "length mismatch");
        for (uint256 i = 0; i < indices.length; i++) {
            prices[indices[i]]      = newPrices[i];
            lastUpdated[indices[i]] = block.timestamp;
            emit PriceSet(indices[i], newPrices[i], msg.sender);
        }
    }

    // ── Access control ────────────────────────────────────────────────

    function addFeeder(address feeder) external {
        require(msg.sender == owner, "not owner");
        feeders[feeder] = true;
        emit FeederAdded(feeder);
    }

    function removeFeeder(address feeder) external {
        require(msg.sender == owner, "not owner");
        feeders[feeder] = false;
        emit FeederRemoved(feeder);
    }
}
