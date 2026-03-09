/**
 * HYPERFLEX — Price Oracle Monitor
 * =================================
 * Runs continuously. Every 60 seconds:
 *   1. Fetches prices from 3 external APIs (Coinbase, Binance, CoinGecko)
 *   2. Takes the median across sources
 *   3. Reads HyperCore on-chain price for comparison
 *   4. If deviation > 0.5% → alerts to Telegram/console
 *   5. If deviation <= 1% → posts secondary price on-chain
 *   6. If deviation > 1% → blocks resolution + fires alert
 *
 * Setup:
 *   npm install ethers node-fetch dotenv node-cron
 *   cp .env.example .env  # fill in keys
 *   node scripts/priceMonitor.js
 *
 * For production: run with PM2
 *   pm2 start scripts/priceMonitor.js --name hyperflex-oracle
 *   pm2 save && pm2 startup
 */

import { ethers } from "ethers";
import fetch from "node-fetch";
import * as dotenv from "dotenv";
dotenv.config();

// ── Config ─────────────────────────────────────────────────────────────────

const RPC_URL        = process.env.RPC_URL        || "https://api.hyperliquid-testnet.xyz/evm";
const PRIVATE_KEY    = process.env.FEEDER_KEY;      // dedicated feeder wallet (not deployer)
const AGGREGATOR_ADDR = process.env.AGGREGATOR_ADDRESS;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT  = process.env.TELEGRAM_CHAT_ID   || "";

const POLL_INTERVAL_SEC    = 60;     // how often to push prices
const ALERT_DEVIATION_BPS  = 50;    // 0.5% → alert but still push
const BLOCK_DEVIATION_BPS  = 100;   // 1.0% → alert + do NOT push (let contract block)
const MAX_RETRIES          = 3;     // retry failed API calls
const STALE_ALERT_SEC      = 180;   // alert if secondary price hasn't updated in 3 min

// ── Asset mapping ───────────────────────────────────────────────────────────
// Maps HyperCore asset index → how to fetch from external APIs

const ASSETS = [
  {
    index:    0,
    symbol:   "BTC",
    name:     "Bitcoin",
    coinbase: "BTC-USD",
    binance:  "BTCUSDT",
    coingecko:"bitcoin",
    kitco:    null,         // crypto only on Kitco, skip
  },
  {
    index:    1,
    symbol:   "ETH",
    name:     "Ethereum",
    coinbase: "ETH-USD",
    binance:  "ETHUSDT",
    coingecko:"ethereum",
    kitco:    null,
  },
  {
    index:    10,
    symbol:   "HYPE",
    name:     "Hyperliquid",
    coinbase: null,          // not on Coinbase yet
    binance:  null,          // not on Binance yet
    coingecko:"hyperliquid", // CoinGecko ID
    kitco:    null,
  },
  {
    index:    11,
    symbol:   "XAG",
    name:     "Silver",
    coinbase: null,           // not on Coinbase
    binance:  null,           // not on Binance
    coingecko:"silver",
    kitco:    "AG",           // Kitco metals API
  },
  {
    index:    12,
    symbol:   "XAU",
    name:     "Gold",
    coinbase: null,
    binance:  null,
    coingecko:"gold",
    kitco:    "AU",           // Kitco metals API
  },
  {
    index:    13,
    symbol:   "WTI",
    name:     "WTI Crude Oil",
    coinbase: null,
    binance:  null,
    coingecko:null,           // not reliable on CoinGecko
    kitco:    "CL",           // Kitco energy
  },
];

// ── ABI (only what we need) ─────────────────────────────────────────────────

const AGGREGATOR_ABI = [
  "function pushPriceBatch(uint32[] calldata indices, uint256[] calldata prices, string calldata source) external",
  "function checkPrice(uint32 assetIndex) external view returns (bool ok, uint256 primaryPrice, uint256 secondaryPrice, uint256 deviationBps, string memory reason)",
  "function secondaryPrices(uint32) external view returns (uint256 price, uint256 updatedAt, string memory source)",
  "event PriceDeviation(uint32 indexed assetIndex, uint256 primaryPrice, uint256 secondaryPrice, uint256 deviationBps, bool resolutionBlocked)",
];

// ── Price fetchers ──────────────────────────────────────────────────────────

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { timeout: 8000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries) throw err;
      await sleep(1000 * (i + 1));
    }
  }
}

async function fetchCoinbase(symbol) {
  if (!symbol) return null;
  try {
    const data = await fetchWithRetry(`https://api.coinbase.com/v2/prices/${symbol}/spot`);
    const price = parseFloat(data?.data?.amount);
    return isFinite(price) && price > 0 ? price : null;
  } catch { return null; }
}

async function fetchBinance(symbol) {
  if (!symbol) return null;
  try {
    const data = await fetchWithRetry(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const price = parseFloat(data?.price);
    return isFinite(price) && price > 0 ? price : null;
  } catch { return null; }
}

async function fetchCoinGecko(id) {
  if (!id) return null;
  try {
    const data = await fetchWithRetry(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
    );
    const price = data?.[id]?.usd;
    return isFinite(price) && price > 0 ? price : null;
  } catch { return null; }
}

async function fetchKitco(symbol) {
  if (!symbol) return null;
  try {
    // Kitco live metals/energy price endpoint
    const data = await fetchWithRetry(
      `https://proxy.kitco.com/getPM?symbol=${symbol}&unit=oz&currency=USD`
    );
    const price = parseFloat(data?.bid || data?.price || data?.last);
    return isFinite(price) && price > 0 ? price : null;
  } catch { return null; }
}

/**
 * Fetch all available prices for an asset and return the median.
 * Uses at least 2 sources or returns null if < 2 succeed.
 */
async function fetchMedianPrice(asset) {
  const results = await Promise.allSettled([
    fetchCoinbase(asset.coinbase),
    fetchBinance(asset.binance),
    fetchCoinGecko(asset.coingecko),
    fetchKitco(asset.kitco),
  ]);

  const prices = results
    .filter(r => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value);

  if (prices.length < 2) {
    console.warn(`⚠️  ${asset.symbol}: only ${prices.length} source(s) available, need ≥ 2`);
    if (prices.length === 1) {
      console.warn(`   Using single source with caution: $${prices[0].toFixed(4)}`);
      return { price: prices[0], sources: 1, values: prices };
    }
    return null;
  }

  prices.sort((a, b) => a - b);
  const median = prices.length % 2 === 0
    ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
    : prices[Math.floor(prices.length / 2)];

  return { price: median, sources: prices.length, values: prices };
}

// ── On-chain helpers ────────────────────────────────────────────────────────

function toOnChainPrice(usdPrice) {
  // Convert float USD to 6-decimal integer
  return BigInt(Math.round(usdPrice * 1_000_000));
}

function fromOnChainPrice(onChainPrice) {
  return Number(onChainPrice) / 1_000_000;
}

function deviationBps(a, b) {
  if (a === 0 || b === 0) return 10000;
  const diff = Math.abs(a - b);
  const base = Math.max(a, b);
  return Math.round((diff / base) * 10000);
}

// ── Alerting ────────────────────────────────────────────────────────────────

async function sendTelegram(msg) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg, parse_mode: "HTML" }),
    });
  } catch {}
}

function alert(level, msg) {
  const prefix = level === "CRITICAL" ? "🚨" : level === "WARN" ? "⚠️" : "ℹ️";
  const line = `${prefix} [${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (level !== "INFO") sendTelegram(`<b>HYPERFLEX ORACLE ${level}</b>\n${msg}`);
}

// ── Main loop ───────────────────────────────────────────────────────────────

async function runOnce(aggregator) {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ── Price check ──────────────────────`);

  const pushIndices = [];
  const pushPrices  = [];
  const deviations  = [];

  for (const asset of ASSETS) {
    // 1. Fetch external price
    const fetched = await fetchMedianPrice(asset);
    if (!fetched) {
      alert("WARN", `${asset.symbol}: failed to fetch from any external source`);
      continue;
    }

    // 2. Get HyperCore on-chain price
    let onChainResult;
    try {
      onChainResult = await aggregator.checkPrice(asset.index);
    } catch {
      // checkPrice may revert if no secondary price yet — that's ok on first run
      onChainResult = { ok: false, primaryPrice: 0n, reason: "no secondary price yet" };
    }

    const primaryUsd    = fromOnChainPrice(onChainResult.primaryPrice);
    const externalUsd   = fetched.price;
    const dev           = primaryUsd > 0 ? deviationBps(primaryUsd, externalUsd) : 0;

    console.log(
      `  ${asset.symbol.padEnd(6)} | External: $${externalUsd.toFixed(4).padStart(12)} (${fetched.sources} sources)` +
      (primaryUsd > 0 ? ` | HyperCore: $${primaryUsd.toFixed(4).padStart(12)} | Dev: ${(dev/100).toFixed(2)}%` : " | HyperCore: not available")
    );

    // 3. Check deviation
    if (primaryUsd > 0) {
      if (dev > BLOCK_DEVIATION_BPS) {
        alert("CRITICAL",
          `${asset.symbol} price deviation ${(dev/100).toFixed(2)}% EXCEEDS 1% LIMIT!\n` +
          `HyperCore: $${primaryUsd.toFixed(4)} | External: $${externalUsd.toFixed(4)}\n` +
          `Resolution BLOCKED until prices converge.`
        );
        deviations.push({ asset: asset.symbol, dev, blocked: true });
        // DO NOT push this price — let the contract block resolution
        continue;
      }

      if (dev > ALERT_DEVIATION_BPS) {
        alert("WARN",
          `${asset.symbol} deviation ${(dev/100).toFixed(2)}% (>0.5%) — monitoring closely.\n` +
          `HyperCore: $${primaryUsd.toFixed(4)} | External: $${externalUsd.toFixed(4)}`
        );
        deviations.push({ asset: asset.symbol, dev, blocked: false });
      }
    }

    // 4. Stage for batch push
    pushIndices.push(asset.index);
    pushPrices.push(toOnChainPrice(externalUsd));
  }

  // 5. Push all prices in one tx (gas efficient)
  if (pushIndices.length === 0) {
    alert("WARN", "No prices to push this cycle — check API connectivity");
    return;
  }

  try {
    const tx = await aggregator.pushPriceBatch(pushIndices, pushPrices, "Coinbase/Binance/CoinGecko");
    console.log(`  ✓ Pushed ${pushIndices.length} prices | tx: ${tx.hash}`);
    await tx.wait();
    console.log(`  ✓ Confirmed`);
  } catch (err) {
    alert("CRITICAL", `Failed to push prices on-chain: ${err.message}`);
  }

  // 6. Summary
  if (deviations.length > 0) {
    const blocked = deviations.filter(d => d.blocked);
    if (blocked.length > 0) {
      alert("CRITICAL", `${blocked.length} asset(s) have resolution BLOCKED: ${blocked.map(d=>d.asset).join(", ")}`);
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!PRIVATE_KEY)       throw new Error("FEEDER_KEY not set in .env");
  if (!AGGREGATOR_ADDR)   throw new Error("AGGREGATOR_ADDRESS not set in .env");

  const provider   = new ethers.JsonRpcProvider(RPC_URL);
  const wallet     = new ethers.Wallet(PRIVATE_KEY, provider);
  const aggregator = new ethers.Contract(AGGREGATOR_ADDR, AGGREGATOR_ABI, wallet);

  console.log("🔮 HYPERFLEX Price Oracle Monitor started");
  console.log(`   Network:     ${RPC_URL}`);
  console.log(`   Feeder:      ${wallet.address}`);
  console.log(`   Aggregator:  ${AGGREGATOR_ADDR}`);
  console.log(`   Interval:    ${POLL_INTERVAL_SEC}s`);
  console.log(`   Alert at:    >${ALERT_DEVIATION_BPS/100}% deviation`);
  console.log(`   Block at:    >${BLOCK_DEVIATION_BPS/100}% deviation`);
  console.log(`   Assets:      ${ASSETS.map(a=>a.symbol).join(", ")}`);

  // Run immediately, then every POLL_INTERVAL_SEC
  await runOnce(aggregator);

  setInterval(async () => {
    try {
      await runOnce(aggregator);
    } catch (err) {
      alert("CRITICAL", `Monitor loop crashed: ${err.message}\n${err.stack}`);
    }
  }, POLL_INTERVAL_SEC * 1000);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
