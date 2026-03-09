// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MockUSDH.sol";
import "../src/HyperFlexPriceAggregator.sol";
import "../src/HyperFlexFactory.sol";
import "../src/HyperFlexMarket.sol";
import "../src/HyperFlexRouter.sol";

contract DeployPhase2 is Script {
    uint256 constant BOOTSTRAP_PER_SIDE = 1 * 1e6;
    uint256 constant BOOTSTRAP_RESERVE  = 50 * 1e6;
    uint256 constant CREATION_FEE       = 1 * 1e6;
    uint256 constant NUM_MARKETS        = 6;

    function run() external {
        uint256 pk       = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        MockUSDH usdh = MockUSDH(0x709C1958b1c5E43fdFC2E919CF1E30Dac5a55E9E);
        HyperFlexPriceAggregator aggregator = HyperFlexPriceAggregator(0x0AD188a2e5449DDD4b0512DC7fC54A60c8934b7B);
        address primaryOracle = 0x7D9a0A21fa8488445576820Dd2c24C0FB1Cf8552;

        vm.startBroadcast(pk);

        HyperFlexFactory factory = new HyperFlexFactory(
            address(usdh), primaryOracle, address(aggregator),
            deployer, CREATION_FEE, BOOTSTRAP_PER_SIDE
        );

        HyperFlexRouter router = new HyperFlexRouter(address(factory), address(usdh));

        uint256 totalApproval = BOOTSTRAP_RESERVE + (CREATION_FEE * NUM_MARKETS);
        usdh.approve(address(factory), totalApproval);
        factory.depositBootstrapReserve(BOOTSTRAP_RESERVE);

        (, address m0) = factory.createMarket(MarketParams({
            question: "Will XAG/USD hit $90/oz before June 2026?",
            sector: "COMMODITIES", iconEmoji: unicode"\xF0\x9F\xA5\x88",
            closesAt: 1775616136, resolvesAt: 1775702536,
            resType: ResolutionType.PRICE_ABOVE, assetIndex: 11,
            strikePrice: 90_000_000, resolver: address(0), creatorFee: 50
        }));

        (, address m1) = factory.createMarket(MarketParams({
            question: "Will XAU/USD hit $5,800/oz in 2026?",
            sector: "COMMODITIES", iconEmoji: unicode"\xF0\x9F\xA5\x87",
            closesAt: 1780800136, resolvesAt: 1780886536,
            resType: ResolutionType.PRICE_ABOVE, assetIndex: 12,
            strikePrice: 5_800_000_000, resolver: address(0), creatorFee: 50
        }));

        (, address m2) = factory.createMarket(MarketParams({
            question: "Will WTI crude exceed $100/barrel in 2026?",
            sector: "COMMODITIES", iconEmoji: unicode"\xF0\x9F\x9B\xA2",
            closesAt: 1788576136, resolvesAt: 1788662536,
            resType: ResolutionType.PRICE_ABOVE, assetIndex: 13,
            strikePrice: 100_000_000, resolver: address(0), creatorFee: 50
        }));

        (, address m3) = factory.createMarket(MarketParams({
            question: "Will Bitcoin hit $150,000 before end of 2026?",
            sector: "CRYPTO", iconEmoji: unicode"\xE2\x82\xBF",
            closesAt: 1804560136, resolvesAt: 1804646536,
            resType: ResolutionType.PRICE_ABOVE, assetIndex: 0,
            strikePrice: 150_000_000_000, resolver: address(0), creatorFee: 50
        }));

        (, address m4) = factory.createMarket(MarketParams({
            question: "Will HYPE token exceed $100 in 2026?",
            sector: "CRYPTO", iconEmoji: unicode"\xF0\x9F\x92\xA7",
            closesAt: 1804560136, resolvesAt: 1804646536,
            resType: ResolutionType.PRICE_ABOVE, assetIndex: 10,
            strikePrice: 100_000_000, resolver: address(0), creatorFee: 50
        }));

        (, address m5) = factory.createMarket(MarketParams({
            question: "Will gold close above $6,000/oz in 2026?",
            sector: "COMMODITIES", iconEmoji: unicode"\xF0\x9F\xA5\x87",
            closesAt: 1804560136, resolvesAt: 1804646536,
            resType: ResolutionType.PRICE_ABOVE, assetIndex: 12,
            strikePrice: 6_000_000_000, resolver: address(0), creatorFee: 50
        }));

        vm.stopBroadcast();

        console.log("HyperFlexFactory:", address(factory));
        console.log("HyperFlexRouter: ", address(router));
        console.log("Market 0 XAG:    ", m0);
        console.log("Market 1 XAU:    ", m1);
        console.log("Market 2 WTI:    ", m2);
        console.log("Market 3 BTC:    ", m3);
        console.log("Market 4 HYPE:   ", m4);
        console.log("Market 5 Gold:   ", m5);
    }
}
