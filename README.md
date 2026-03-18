# HYPERFLEX Smart Contracts
### Predict Everything · Built on HyperLiquid HyperEVM

---

## Architecture

```
HyperFlexFactory.sol     ← Deploy markets, registry, global config
HyperFlexMarket.sol      ← Individual prediction market (one per question)
HyperFlexRouter.sol      ← User entry point with referral tracking
interfaces/
  IHyperCoreOracle.sol   ← HyperEVM precompile interface (no external oracle)
utils/
  ReentrancyGuard.sol
  Ownable.sol
```

---

## How It Works

### Prediction Market Mechanics
Each market is a YES/NO binary outcome contract using a **constant-product virtual AMM**:

- Starting price: 50¢ YES / 50¢ NO
- Buy YES → YES price rises (NO price falls)
- Buy NO → NO price rises (YES price falls)
- At resolution: winners split **all collateral** pro-rata by shares held
- Losers get nothing (winner-takes-all pot)

### Fees
| Fee | Amount | Recipient |
|-----|--------|-----------|
| Platform | 2.00% | HYPERFLEX treasury |
| Market creator | 0–1% (creator sets) | Market deployer |
| Referral | 10% of platform fee | Referrer address |

Fees are deducted from the USDH input before AMM math.

### Resolution Types
| Type | How | Who triggers |
|------|-----|-------------|
| `PRICE_ABOVE` | HyperCore oracle precompile | Anyone (trustless) |
| `PRICE_BELOW` | HyperCore oracle precompile | Anyone (trustless) |
| `MANUAL` | Designated resolver address | Resolver only |
| `INVALID` | Admin safety valve | Factory owner |

PRICE_ABOVE / PRICE_BELOW markets are **fully trustless** — they read directly from
the HyperCore oracle precompile on HyperEVM. No Chainlink. No delay. No trust needed.

MANUAL markets are for sports, earnings, macro events — a resolver address (could be
a multisig, Chainlink feed, or UMA-style dispute mechanism) signs the outcome.

---

## Deployment

### Prerequisites
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Setup
```bash
cd HyperFlex
forge install foundry-rs/forge-std
```

### Add HyperEVM to wallet
- **Testnet**: Chain ID `998`, RPC `https://api.hyperliquid-testnet.xyz/evm`
- **Mainnet**: Chain ID `999`, RPC `https://api.hyperliquid.xyz/evm`

### Fund with HYPE (gas)
Bridge from HyperCore to: `0x2222222222222222222222222222222222222222`

### Deploy (Testnet first)
```bash
export PRIVATE_KEY=0x...

forge script script/Deploy.s.sol \
  --rpc-url https://api.hyperliquid-testnet.xyz/evm \
  --private-key $PRIVATE_KEY \
  --broadcast \
  -vvvv
```

### Deploy (Mainnet)
```bash
forge script script/Deploy.s.sol \
  --rpc-url https://api.hyperliquid.xyz/evm \
  --private-key $PRIVATE_KEY \
  --broadcast \
  -vvvv
```

---

## Tests
```bash
forge test -vvvv
```

All 12 tests cover:
- Buy/sell mechanics and price movement
- Slippage protection
- Oracle resolution (YES wins, NO wins)
- Manual resolution + access control
- INVALID markets with pro-rata refunds
- Double-claim prevention
- Batch market creation
- Referral earnings
- Emergency pause

---

## Key Addresses to Verify Before Mainnet

| Address | Description |
|---------|-------------|
| `0x0000000000000000000000000000000000000800` | HyperCore oracle precompile |
| USDH contract address | Verify on HyperEVM explorer |
| `0x2222222222222222222222222222222222222222` | HyperCore→HyperEVM bridge |

**Always verify precompile address against Hyperliquid's official docs before mainnet.**

---

## HyperCore Asset Indices (for market creation)
| Index | Asset |
|-------|-------|
| 0 | BTC |
| 1 | ETH |
| 2 | SOL |
| 10 | HYPE |
| 11 | XAG (Silver) — if listed |
| 12 | XAU (Gold) — if listed |
| 13 | WTI (Crude oil) — if listed |

Check `HyperCore metadata` endpoint for current indices before creating markets.

---

## Frontend Integration

```javascript
// Create a market (from the AI scanner batch deploy)
const factory = new ethers.Contract(FACTORY_ADDRESS, factoryABI, signer);

const params = {
  question:    "Will XAG/USD be above $32 by end of week?",
  sector:      "Commodities",
  iconEmoji:   "🥈",
  closesAt:    Math.floor(Date.now()/1000) + 7*86400,
  resolvesAt:  Math.floor(Date.now()/1000) + 7*86400 + 3600,
  resType:     0, // PRICE_ABOVE
  assetIndex:  11, // XAG
  strikePrice: 32_000_000, // $32.00
  resolver:    ethers.ZeroAddress,
  creatorFee:  50  // 0.5%
};

const tx = await factory.createMarket(params);
const receipt = await tx.wait();
// Parse MarketCreated event for market address

// Buy YES
const market = new ethers.Contract(marketAddress, marketABI, signer);
await usdh.approve(marketAddress, amount);
await market.buy(true, amount, minShares);

// Get current price
const yesPrice = await market.getYesPrice(); // 6-decimal cents (500000 = $0.50 = 50%)
```

---

*HYPERFLEX · Predict Everything · Built on HyperLiquid HIP-4 · March 2026*
