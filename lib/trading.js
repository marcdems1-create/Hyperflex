'use strict';

// ── Whale Position Diffing ────────────────────────────────
function diffWhalePositions(oldPositions, newPositions, trader) {
  const changes = [];
  const oldMap = new Map((oldPositions || []).map(p => [p.title || p.market, p]));
  const newMap = new Map((newPositions || []).map(p => [p.title || p.market, p]));

  // New positions (opened)
  for (const [title, p] of newMap) {
    if (!oldMap.has(title) && (parseFloat(p.size) || 0) >= 1000) {
      changes.push({ type: 'opened', trader, position: p });
    }
  }

  // Removed positions (closed)
  for (const [title, p] of oldMap) {
    if (!newMap.has(title) && (parseFloat(p.size) || 0) >= 1000) {
      changes.push({ type: 'closed', trader, position: p });
    }
  }

  // Size changes > 20%
  for (const [title, newP] of newMap) {
    const oldP = oldMap.get(title);
    if (oldP) {
      const oldSize = parseFloat(oldP.size) || 0;
      const newSize = parseFloat(newP.size) || 0;
      if (oldSize > 0 && Math.abs(newSize - oldSize) / oldSize > 0.2 && newSize >= 1000) {
        changes.push({ type: newSize > oldSize ? 'increased' : 'decreased', trader, position: newP, oldSize, newSize });
      }
    }
  }
  return changes;
}

// ── Screener Filter ───────────────────────────────────────
function filterScreenerResults(markets, query) {
  let filtered = [...markets];
  const minWhales = parseInt(query.min_whales) || 0;
  const category = (query.category || '').toLowerCase();
  const minVolume = parseInt(query.min_volume) || 0;
  const sort = query.sort || 'edge_score';

  if (minWhales > 0) filtered = filtered.filter(m => m.whale_count >= minWhales);
  if (category && category !== 'all') filtered = filtered.filter(m => m.category === category);
  if (minVolume > 0) filtered = filtered.filter(m => m.volume >= minVolume);

  switch (sort) {
    case 'volume': filtered.sort((a, b) => b.volume - a.volume); break;
    case 'price_change': filtered.sort((a, b) => Math.abs(b.price_change_24h || 0) - Math.abs(a.price_change_24h || 0)); break;
    case 'newest': filtered.sort((a, b) => (b.days_until_expiry || 999) - (a.days_until_expiry || 999)); break;
    case 'edge_score': filtered.sort((a, b) => (b.edge_score || 0) - (a.edge_score || 0)); break;
    case 'whale_count': filtered.sort((a, b) => b.whale_count - a.whale_count || b.volume - a.volume); break;
    default: filtered.sort((a, b) => (b.edge_score || 0) - (a.edge_score || 0)); break;
  }

  return filtered;
}

// ── Whale Alpha Scores ────────────────────────────────────
const _gradeMultiplier = { 'A+': 1.0, 'A': 0.9, 'B': 0.75, 'C': 0.55, 'D': 0.35 };

function computeWhaleAlphaScores(whaleData) {
  if (!whaleData || !whaleData.whales) return new Map();

  const byWallet = new Map();
  for (const w of whaleData.whales) {
    if (!w.proxyWallet) continue;
    if (!byWallet.has(w.proxyWallet)) {
      byWallet.set(w.proxyWallet, { name: w.trader, rank: w.trader_rank, pnl: w.trader_pnl, positions: [] });
    }
    byWallet.get(w.proxyWallet).positions.push(w);
  }

  const scores = new Map();

  for (const [wallet, data] of byWallet) {
    const positions = data.positions;
    const totalPos = positions.length;

    // 1. Win rate proxy (30%)
    const pnl = data.pnl || 0;
    let winRateScore;
    if (pnl >= 1000000) winRateScore = 95;
    else if (pnl >= 500000) winRateScore = 85;
    else if (pnl >= 100000) winRateScore = 75;
    else if (pnl >= 10000) winRateScore = 65;
    else if (pnl >= 0) winRateScore = 50;
    else if (pnl >= -50000) winRateScore = 35;
    else winRateScore = 20;

    // 2. Category diversification (20%)
    const categories = new Set();
    for (const p of positions) {
      const q = (p.market || '').toLowerCase();
      if (/nba|nfl|mlb|soccer|football|vs\.|match|game|win on/.test(q)) categories.add('sports');
      else if (/bitcoin|ethereum|crypto|btc|eth|solana/.test(q)) categories.add('crypto');
      else if (/president|election|trump|biden|congress/.test(q)) categories.add('politics');
      else if (/youtube|tiktok|twitter|views|subscribers/.test(q)) categories.add('entertainment');
      else categories.add('other');
    }
    const catScore = Math.min(95, categories.size * 25);

    // 3. Early entry score (25%)
    let earlySum = 0;
    let earlyCount = 0;
    for (const p of positions) {
      const price = p.current_price || 0;
      const side = (p.side || '').toUpperCase();
      if (side === 'YES' && price > 0.5) { earlySum += Math.min(95, price * 100); earlyCount++; }
      else if (side === 'NO' && price < 0.5) { earlySum += Math.min(95, (1 - price) * 100); earlyCount++; }
      else { earlySum += 40; earlyCount++; }
    }
    const earlyScore = earlyCount > 0 ? Math.round(earlySum / earlyCount) : 50;

    // 4. Sizing discipline (15%)
    const sizes = positions.map(p => p.size).filter(s => s > 0);
    let sizingScore = 50;
    if (sizes.length >= 3) {
      const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const stddev = Math.sqrt(sizes.reduce((s, v) => s + (v - avg) ** 2, 0) / sizes.length);
      const cv = avg > 0 ? stddev / avg : 1;
      sizingScore = cv < 0.3 ? 90 : cv < 0.6 ? 75 : cv < 1 ? 60 : 40;
    }

    // 5. Recency (10%)
    let recencyScore = 50;
    if (data.rank <= 10) recencyScore = 90;
    else if (data.rank <= 25) recencyScore = 75;
    else if (data.rank <= 40) recencyScore = 60;
    else recencyScore = 45;
    if (totalPos >= 5) recencyScore = Math.min(95, recencyScore + 15);

    // Composite
    const composite = Math.round(
      winRateScore * 0.30 +
      catScore * 0.20 +
      earlyScore * 0.25 +
      sizingScore * 0.15 +
      recencyScore * 0.10
    );
    const score = Math.min(99, Math.max(1, composite));

    let grade;
    if (score >= 90) grade = 'A+';
    else if (score >= 80) grade = 'A';
    else if (score >= 70) grade = 'B';
    else if (score >= 55) grade = 'C';
    else grade = 'D';

    scores.set(wallet, {
      score, grade, name: data.name, rank: data.rank,
      breakdown: { win_rate: winRateScore, category: catScore, early_entry: earlyScore, sizing: sizingScore, recency: recencyScore }
    });
  }

  return scores;
}

// ── Market Alpha Score ────────────────────────────────────
function computeMarketAlphaScore(market, whaleIndex, eliteScores) {
  if (!whaleIndex || !market) return 0;
  const idx = whaleIndex.find(w => w.market === market.question || w.market === market.market || w.market_id === market.market_id);
  if (!idx || !idx.whale_count || idx.whale_count < 2) return 0;

  const marketPrice = market.yes_price || market.price || 0.5;
  const whaleConsensus = idx.consensus_side === 'YES' ? (idx.consensus_pct / 100) : (1 - idx.consensus_pct / 100);
  const divergence = Math.abs(whaleConsensus - marketPrice) * 100;

  const wallets = idx.wallets || [];
  let gradeSum = 0, gradeCount = 0;
  for (const w of wallets) {
    const s = eliteScores.get(w);
    if (s) { gradeSum += (_gradeMultiplier[s.grade] || 0.5); gradeCount++; }
  }
  const avgGrade = gradeCount > 0 ? gradeSum / gradeCount : 0.5;

  const totalCapital = idx.total_capital || 10000;
  const capitalWeight = Math.min(1.2, Math.log10(Math.max(1, totalCapital)) / 5.5);

  const raw = (divergence / 10) * avgGrade * capitalWeight;
  return Math.round(Math.min(10, Math.max(0, raw)) * 10) / 10;
}

module.exports = {
  diffWhalePositions,
  filterScreenerResults,
  computeWhaleAlphaScores,
  computeMarketAlphaScore,
  _gradeMultiplier,
};
