// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {HyperFlexMarket, MarketParams, ResolutionType, Outcome} from "../src/HyperFlexMarket.sol";
import {HyperFlexFactory} from "../src/HyperFlexFactory.sol";
import {HyperFlexRouter}  from "../src/HyperFlexRouter.sol";

// ── Mock USDH ─────────────────────────────────────────────────
contract MockUSDH {
    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    string public name   = "USD Hyperliquid";
    string public symbol = "USDH";
    uint8  public decimals = 6;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

// ── Mock Oracle ───────────────────────────────────────────────
contract MockOracle {
    mapping(uint32 => uint256) public prices;

    function setPrice(uint32 assetIndex, uint256 price) external {
        prices[assetIndex] = price;
    }

    function getMarkPrice(uint32 assetIndex) external view returns (uint256) {
        return prices[assetIndex];
    }

    function getOraclePrice(uint32 assetIndex) external view returns (uint256) {
        return prices[assetIndex];
    }

    function getPrices(uint32 assetIndex) external view returns (uint256, uint256) {
        uint256 p = prices[assetIndex];
        return (p, p);
    }
}

// ─────────────────────────────────────────────────────────────
//  HYPERFLEX MARKET TESTS
// ─────────────────────────────────────────────────────────────

contract HyperFlexMarketTest is Test {
    MockUSDH  public usdh;
    MockOracle public oracle;
    HyperFlexFactory public factory;
    HyperFlexRouter  public router;

    address alice   = makeAddr("alice");
    address bob     = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address referrer = makeAddr("referrer");

    uint256 constant ONE_USDH = 1e6;
    uint256 constant CLOSE_DELAY   = 7 days;
    uint256 constant RESOLVE_DELAY = 7 days + 1 hours;

    function setUp() public {
        usdh   = new MockUSDH();
        oracle = new MockOracle();

        // Deploy factory (no creation fee for tests)
        factory = new HyperFlexFactory(
            address(usdh),
            address(oracle),
            address(this),
            0
        );

        router = new HyperFlexRouter(address(factory), address(usdh));

        // Fund traders
        usdh.mint(alice,   10_000 * ONE_USDH);
        usdh.mint(bob,     10_000 * ONE_USDH);
        usdh.mint(charlie,  5_000 * ONE_USDH);

        // Set oracle prices
        oracle.setPrice(0,  95_000_000_000); // BTC $95,000
        oracle.setPrice(11, 31_500_000);     // XAG $31.50
    }

    function _createMarket(ResolutionType resType, uint256 strike, address resolver)
        internal returns (address market)
    {
        MarketParams memory p = MarketParams({
            question:    "Will XAG/USD be above $32?",
            sector:      "Commodities",
            iconEmoji:   unicode"🥈",
            closesAt:    block.timestamp + CLOSE_DELAY,
            resolvesAt:  block.timestamp + RESOLVE_DELAY,
            resType:     resType,
            assetIndex:  11,
            strikePrice: strike,
            resolver:    resolver,
            creatorFee:  50
        });

        (, market) = factory.createMarket(p);
    }

    // ── Test: Basic buy and price movement ───────────────────

    function test_BuyYes_MovesPrice() public {
        address market = _createMarket(ResolutionType.PRICE_ABOVE, 32_000_000, address(0));
        HyperFlexMarket m = HyperFlexMarket(market);

        uint256 priceBefore = m.getYesPrice();
        assertEq(priceBefore, 500_000, "should start at 50 cents");

        vm.startPrank(alice);
        usdh.approve(market, 100 * ONE_USDH);
        m.buy(true, 100 * ONE_USDH, 0);
        vm.stopPrank();

        uint256 priceAfter = m.getYesPrice();
        assertGt(priceAfter, priceBefore, "YES price should increase after YES buy");

        console.log("YES price before:", priceBefore);
        console.log("YES price after: ", priceAfter);
    }

    function test_BuyNo_MovesPrice() public {
        address market = _createMarket(ResolutionType.PRICE_ABOVE, 32_000_000, address(0));
        HyperFlexMarket m = HyperFlexMarket(market);

        vm.startPrank(bob);
        usdh.approve(market, 200 * ONE_USDH);
        m.buy(false, 200 * ONE_USDH, 0);
        vm.stopPrank();

        uint256 noPrice = m.getNoPrice();
        assertGt(noPrice, 500_000, "NO price should increase after NO buy");
    }

    function test_SlippageProtection() public {
        address market = _createMarket(ResolutionType.PRICE_ABOVE, 32_000_000, address(0));

        vm.startPrank(alice);
        usdh.approve(market, 100 * ONE_USDH);
        // Request impossibly high min shares
        vm.expectRevert(HyperFlexMarket.SlippageExceeded.selector);
        HyperFlexMarket(market).buy(true, 100 * ONE_USDH, type(uint256).max);
        vm.stopPrank();
    }

    function test_CannotTradeAfterClose() public {
        address market = _createMarket(ResolutionType.PRICE_ABOVE, 32_000_000, address(0));

        vm.warp(block.timestamp + CLOSE_DELAY + 1);

        vm.startPrank(alice);
        usdh.approve(market, 100 * ONE_USDH);
        vm.expectRevert(HyperFlexMarket.MarketClosed.selector);
        HyperFlexMarket(market).buy(true, 100 * ONE_USDH, 0);
        vm.stopPrank();
    }

    // ── Test: Oracle resolution ───────────────────────────────

    function test_OracleResolve_YesWins() public {
        address market = _createMarket(ResolutionType.PRICE_ABOVE, 32_000_000, address(0));
        HyperFlexMarket m = HyperFlexMarket(market);

        // Alice buys YES, Bob buys NO
        vm.prank(alice);
        usdh.approve(market, 500 * ONE_USDH);
        vm.prank(alice);
        m.buy(true, 500 * ONE_USDH, 0);

        vm.prank(bob);
        usdh.approve(market, 300 * ONE_USDH);
        vm.prank(bob);
        m.buy(false, 300 * ONE_USDH, 0);

        // Advance past resolve time & set price above strike
        vm.warp(block.timestamp + RESOLVE_DELAY + 1);
        oracle.setPrice(11, 33_000_000); // $33 > $32 → YES wins

        m.resolveWithOracle();

        assertEq(uint(m.outcome()), uint(Outcome.YES));

        // Alice claims and should get more than she put in
        uint256 aliceBefore = usdh.balanceOf(alice);
        vm.prank(alice);
        m.claim();
        uint256 aliceAfter = usdh.balanceOf(alice);

        assertGt(aliceAfter, aliceBefore, "Alice should have more USDH after claiming");
        console.log("Alice profit:", aliceAfter - aliceBefore, "USDH units");
    }

    function test_OracleResolve_NoWins() public {
        address market = _createMarket(ResolutionType.PRICE_ABOVE, 32_000_000, address(0));
        HyperFlexMarket m = HyperFlexMarket(market);

        vm.prank(alice);
        usdh.approve(market, 300 * ONE_USDH);
        vm.prank(alice);
        m.buy(true, 300 * ONE_USDH, 0);

        vm.prank(bob);
        usdh.approve(market, 500 * ONE_USDH);
        vm.prank(bob);
        m.buy(false, 500 * ONE_USDH, 0);

        vm.warp(block.timestamp + RESOLVE_DELAY + 1);
        oracle.setPrice(11, 30_000_000); // $30 < $32 → NO wins

        m.resolveWithOracle();
        assertEq(uint(m.outcome()), uint(Outcome.NO));

        uint256 bobBefore = usdh.balanceOf(bob);
        vm.prank(bob);
        m.claim();
        assertGt(usdh.balanceOf(bob), bobBefore, "Bob should profit");
    }

    // ── Test: Manual resolution ───────────────────────────────

    function test_ManualResolve() public {
        address resolverAddr = makeAddr("resolver");
        address market = _createMarket(ResolutionType.MANUAL, 0, resolverAddr);
        HyperFlexMarket m = HyperFlexMarket(market);

        vm.prank(alice);
        usdh.approve(market, 100 * ONE_USDH);
        vm.prank(alice);
        m.buy(true, 100 * ONE_USDH, 0);

        vm.warp(block.timestamp + RESOLVE_DELAY + 1);
        vm.prank(resolverAddr);
        m.resolveManual(true);

        assertEq(uint(m.outcome()), uint(Outcome.YES));
    }

    function test_OnlyResolverCanResolveManual() public {
        address market = _createMarket(ResolutionType.MANUAL, 0, makeAddr("resolver"));

        vm.warp(block.timestamp + RESOLVE_DELAY + 1);
        vm.expectRevert(HyperFlexMarket.NotResolver.selector);
        vm.prank(alice);
        HyperFlexMarket(market).resolveManual(true);
    }

    // ── Test: INVALID markets refund everyone ─────────────────

    function test_InvalidMarket_Refunds() public {
        address market = _createMarket(ResolutionType.MANUAL, 0, makeAddr("resolver"));
        HyperFlexMarket m = HyperFlexMarket(market);

        uint256 aliceDeposit = 200 * ONE_USDH;
        uint256 bobDeposit   = 150 * ONE_USDH;

        vm.prank(alice);
        usdh.approve(market, aliceDeposit);
        vm.prank(alice);
        m.buy(true, aliceDeposit, 0);

        vm.prank(bob);
        usdh.approve(market, bobDeposit);
        vm.prank(bob);
        m.buy(false, bobDeposit, 0);

        vm.warp(block.timestamp + RESOLVE_DELAY + 1);
        factory.resolveMarketInvalid(0); // marketId 0

        assertEq(uint(m.outcome()), uint(Outcome.INVALID));

        // Both should get most of their money back (minus fees)
        uint256 alicePre = usdh.balanceOf(alice);
        vm.prank(alice);
        m.claim();
        assertGt(usdh.balanceOf(alice), alicePre, "Alice gets refund");
    }

    // ── Test: Double claim blocked ────────────────────────────

    function test_CannotClaimTwice() public {
        address market = _createMarket(ResolutionType.PRICE_ABOVE, 32_000_000, address(0));
        HyperFlexMarket m = HyperFlexMarket(market);

        vm.prank(alice);
        usdh.approve(market, 100 * ONE_USDH);
        vm.prank(alice);
        m.buy(true, 100 * ONE_USDH, 0);

        vm.warp(block.timestamp + RESOLVE_DELAY + 1);
        oracle.setPrice(11, 33_000_000);
        m.resolveWithOracle();

        vm.prank(alice);
        m.claim();

        vm.expectRevert(HyperFlexMarket.NothingToClaim.selector);
        vm.prank(alice);
        m.claim();
    }

    // ── Test: Factory batch creation ─────────────────────────

    function test_BatchCreateMarkets() public {
        MarketParams[] memory params = new MarketParams[](3);
        for (uint i = 0; i < 3; i++) {
            params[i] = MarketParams({
                question:    string(abi.encodePacked("Market ", vm.toString(i))),
                sector:      "Crypto",
                iconEmoji:   unicode"💎",
                closesAt:    block.timestamp + CLOSE_DELAY,
                resolvesAt:  block.timestamp + RESOLVE_DELAY,
                resType:     ResolutionType.PRICE_ABOVE,
                assetIndex:  0,
                strikePrice: 100_000 * 1e6,
                resolver:    address(0),
                creatorFee:  50
            });
        }

        (uint256[] memory ids, address[] memory addrs) = factory.batchCreateMarkets(params);
        assertEq(ids.length, 3);
        assertEq(addrs.length, 3);
        assertEq(factory.getAllMarketsCount(), 3);
    }

    // ── Test: Referral system ─────────────────────────────────

    function test_ReferralEarnings() public {
        address market = _createMarket(ResolutionType.PRICE_ABOVE, 32_000_000, address(0));

        vm.prank(alice);
        usdh.approve(address(router), 1000 * ONE_USDH);

        vm.prank(alice);
        router.buyWithReferral(market, true, 1000 * ONE_USDH, 0, referrer);

        (, , uint256 earnings, ) = router.getReferralStats(referrer);
        assertGt(earnings, 0, "referrer should have earned fees");
        console.log("Referral earnings:", earnings, "USDH units");
    }

    function test_CannotSelfRefer() public {
        address market = _createMarket(ResolutionType.PRICE_ABOVE, 32_000_000, address(0));

        vm.prank(alice);
        usdh.approve(address(router), 100 * ONE_USDH);

        vm.expectRevert(HyperFlexRouter.SelfReferral.selector);
        vm.prank(alice);
        router.buyWithReferral(market, true, 100 * ONE_USDH, 0, alice);
    }

    // ── Test: Emergency pause ─────────────────────────────────

    function test_EmergencyPause() public {
        address market = _createMarket(ResolutionType.PRICE_ABOVE, 32_000_000, address(0));

        factory.pauseMarket(0, true);

        vm.prank(alice);
        usdh.approve(market, 100 * ONE_USDH);

        vm.expectRevert(HyperFlexMarket.Paused.selector);
        vm.prank(alice);
        HyperFlexMarket(market).buy(true, 100 * ONE_USDH, 0);

        factory.pauseMarket(0, false);

        // Should work after unpause
        vm.prank(alice);
        HyperFlexMarket(market).buy(true, 100 * ONE_USDH, 0);
    }
}
