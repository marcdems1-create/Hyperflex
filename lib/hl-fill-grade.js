'use strict';

// Hyperliquid fill-grade — independently counted close-fill record.
//
// Perps have no resolution event, so this is NOT a Polymarket-equivalent
// grade. Only fills whose `dir` starts with "Close" count (Open Long/Short
// are inventory, not a result). Wins AND losses. Fees deducted from net.
// Hyperliquid caps userFills at 2,000 rows; the sample is labelled as such.
//
// Pure + no I/O — exercised by test/hl-fill-grade.test.js.

const HL_FILL_GRADE_MIN_N = 10;

// 100% WR on hundreds of same-coin closes is inventory / MM activity, not a
// directional book. Flagged, not hidden — they stay on the board so the
// reader can see why they look "perfect."
const INVENTORY_CLOSER_MIN_N = 200;
const INVENTORY_CLOSER_MIN_WR = 98; // win_rate is 0–100
const SINGLE_COIN_CLOSER_MIN_N = 100;
const SINGLE_COIN_CLOSER_MIN_WR = 95;

function gradeHyperliquidFills(fills) {
  if (!Array.isArray(fills) || !fills.length) return { qualify: false, n: 0 };
  const closes = fills.filter(f => /^Close/i.test(String(f.dir || '')));
  const n = closes.length;
  if (n < HL_FILL_GRADE_MIN_N) return { qualify: false, n, fills_seen: fills.length };
  let pnl = 0, fees = 0, wins = 0, losses = 0, notional = 0;
  const coins = {};
  for (const f of closes) {
    const p = parseFloat(f.closedPnl || 0) || 0;
    const fee = parseFloat(f.fee || 0) || 0;
    const sz = parseFloat(f.sz || 0) || 0;
    const px = parseFloat(f.px || 0) || 0;
    pnl += p;
    fees += fee;
    notional += sz * px;
    if (p > 0) wins++;
    else if (p < 0) losses++;
    const c = f.coin || '?';
    coins[c] = (coins[c] || 0) + 1;
  }
  const uniqueCoins = Object.keys(coins).length;
  const top = Object.entries(coins).sort((a, b) => b[1] - a[1])[0];
  const winRate = Math.round((wins / n) * 1000) / 10;
  const flags = [];
  if (n >= INVENTORY_CLOSER_MIN_N && winRate >= INVENTORY_CLOSER_MIN_WR) flags.push('inventory_closer');
  if (uniqueCoins === 1 && n >= SINGLE_COIN_CLOSER_MIN_N && winRate >= SINGLE_COIN_CLOSER_MIN_WR) {
    flags.push('single_coin_closer');
  }
  return {
    qualify: true,
    n, wins, losses,
    win_rate: winRate,
    realized_pnl: Math.round(pnl * 100) / 100,
    fees: Math.round(fees * 100) / 100,
    net_pnl: Math.round((pnl - fees) * 100) / 100,
    close_notional: Math.round(notional),
    fills_seen: fills.length,
    unique_coins: uniqueCoins,
    sample_label: 'Last ' + fills.length + ' fills (Hyperliquid cap)',
    top_coin: top ? top[0] : null,
    flags
  };
}

// Directional books first (no closer flags), then inventory/MM closers.
// Within each group, rank by net PnL desc so a 2000–0 inventory closer
// cannot sit above a real W–L book just because its notional is huge.
function rankFillGraded(traders) {
  return (traders || []).slice().sort((a, b) => {
    const af = (a.flags && a.flags.length) ? 1 : 0;
    const bf = (b.flags && b.flags.length) ? 1 : 0;
    if (af !== bf) return af - bf;
    return (b.net_pnl || 0) - (a.net_pnl || 0);
  }).map((t, i) => ({ ...t, rank: i + 1 }));
}

module.exports = {
  HL_FILL_GRADE_MIN_N,
  INVENTORY_CLOSER_MIN_N,
  INVENTORY_CLOSER_MIN_WR,
  SINGLE_COIN_CLOSER_MIN_N,
  SINGLE_COIN_CLOSER_MIN_WR,
  gradeHyperliquidFills,
  rankFillGraded
};
