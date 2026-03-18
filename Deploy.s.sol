// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {HyperFlexFactory} from "../src/HyperFlexFactory.sol";
import {HyperFlexRouter}  from "../src/HyperFlexRouter.sol";
import {MarketParams, ResolutionType} from "../src/HyperFlexMarket.sol";

/**
 * @title  DeployHyperFlex
 * @notice Foundry deployment script for HYPERFLEX on HyperEVM
 *
 * ── Testnet (Chain ID 998) ─────────────────────────────────
 *   forge script script/Deploy.s.sol \
 *     --rpc-url https://api.hyperliquid-testnet.xyz/evm \
 *     --private-key $PK \
 *     --broadcast \
 *     -vvvv
 *
 * ── Mainnet (Chain ID 999) ─────────────────────────────────
 *   forge script script/Deploy.s.sol \
 *     --rpc-url https://api.hyperliquid.xyz/evm \
 *     --private-key $PK \
 *     --broadcast \
 *     --verify \
 *     -vvvv
 */
contract DeployHyperFlex is Script {

    // ── HyperEVM Addresses ────────────────────────────────────
    // USDH token on HyperEVM (verify on-chain before deploying)
    address constant USDH_MAINNET  = 0x5555555555555555555555555555555555555555; // PLACEHOLDER
    address constant USDH_TESTNET  = 0x5555555555555555555555555555555555555555; // PLACEHOLDER

    // HyperCore oracle precompile
    address constant ORACLE_PRECOMPILE = 0x0000000000000000000000000000000000000800;

    // 0.1 USDH creation fee (USDH has 6 decimals)
    uint256 constant CREATION_FEE = 100_000; // 0.1 USDH

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        address usdhAddr = block.chainid == 999 ? USDH_MAINNET : USDH_TESTNET;

        vm.startBroadcast(deployerKey);

        // 1. Deploy Factory
        HyperFlexFactory factory = new HyperFlexFactory(
            usdhAddr,
            ORACLE_PRECOMPILE,
            deployer,       // fee recipient (update to multisig before mainnet)
            CREATION_FEE
        );
        console.log("Factory deployed:", address(factory));

        // 2. Deploy Router
        HyperFlexRouter router = new HyperFlexRouter(
            address(factory),
            usdhAddr
        );
        console.log("Router deployed:", address(router));

        // 3. Create initial seed markets (mirroring the 34+ pre-built markets)
        _seedMarkets(factory);

        vm.stopBroadcast();

        console.log("\n=== HYPERFLEX DEPLOYED ===");
        console.log("Factory:", address(factory));
        console.log("Router: ", address(router));
        console.log("USDH:   ", usdhAddr);
        console.log("Oracle: ", ORACLE_PRECOMPILE);
    }

    function _seedMarkets(HyperFlexFactory factory) internal {
        uint256 closesAt   = block.timestamp + 7 days;
        uint256 resolvesAt = block.timestamp + 7 days + 1 hours;

        // ── Commodity Markets ─────────────────────────────────
        factory.createMarket(MarketParams({
            question:    "Will XAG/USD be above $32 by end of week?",
            sector:      "Commodities",
            iconEmoji:   unicode"🥈",
            closesAt:    closesAt,
            resolvesAt:  resolvesAt,
            resType:     ResolutionType.PRICE_ABOVE,
            assetIndex:  11,             // XAG (Silver) on HyperCore
            strikePrice: 32_000_000,     // $32.00 (6 dec)
            resolver:    address(0),
            creatorFee:  50              // 0.5%
        }));

        factory.createMarket(MarketParams({
            question:    "Will XAU/USD close above $2,900 this week?",
            sector:      "Commodities",
            iconEmoji:   unicode"🥇",
            closesAt:    closesAt,
            resolvesAt:  resolvesAt,
            resType:     ResolutionType.PRICE_ABOVE,
            assetIndex:  12,             // XAU (Gold)
            strikePrice: 2_900_000_000,  // $2,900.00
            resolver:    address(0),
            creatorFee:  50
        }));

        // ── Crypto Markets ────────────────────────────────────
        factory.createMarket(MarketParams({
            question:    "Will BTC close above $100K by end of March?",
            sector:      "Crypto",
            iconEmoji:   unicode"₿",
            closesAt:    block.timestamp + 25 days,
            resolvesAt:  block.timestamp + 25 days + 1 hours,
            resType:     ResolutionType.PRICE_ABOVE,
            assetIndex:  0,              // BTC
            strikePrice: 100_000_000_000, // $100,000 (6 dec)
            resolver:    address(0),
            creatorFee:  50
        }));

        factory.createMarket(MarketParams({
            question:    "Will HYPE flip above $30 this month?",
            sector:      "Crypto",
            iconEmoji:   unicode"🔷",
            closesAt:    block.timestamp + 25 days,
            resolvesAt:  block.timestamp + 25 days + 1 hours,
            resType:     ResolutionType.PRICE_ABOVE,
            assetIndex:  10,             // HYPE
            strikePrice: 30_000_000,     // $30.00
            resolver:    address(0),
            creatorFee:  50
        }));

        console.log("Seed markets created.");
    }
}
