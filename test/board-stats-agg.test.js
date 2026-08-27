// Equivalence check for the /api/board-stats aggregation refactor.
//
// The endpoint used to SELECT every durable trade and sum them in JS. It now
// GROUPs BY market_question in SQL and sums the per-market counts instead.
// The row shape changed, so the accumulation loop had to change with it —
// and those sums are public claims on the homepage (capital graded, board
// win rate, share of capital by category). This asserts the new loop lands
// on exactly the old numbers, over randomised data, without needing a DB.
//
// Run: npm run test:board-stats

// Stand-in for server.js's classifier. What it returns doesn't matter here —
// only that both implementations get the same answer for the same question,
// which is what makes the category rollups comparable.
function classify(q) {
  if (/fed|cpi|rate/i.test(q)) return 'macro';
  if (/bitcoin|eth/i.test(q)) return 'crypto';
  if (/cup|nba|nfl/i.test(q)) return 'sports';
  if (/election|tariff/i.test(q)) return 'politics';
  return 'other';
}

// ── OLD: one row per trade ────────────────────────────────────────────
function oldWay(trades) {
  const catAgg = new Map();
  let wins = 0, losses = 0, pushes = 0, capitalUsd = 0;
  let uncategorizedCapital = 0, uncategorizedTrades = 0;
  let firstClose = null, lastClose = null;
  for (const t of trades) {
    const pnl = Number(t.realized_pnl);
    const cost = Number(t.entry_cost_usd);
    capitalUsd += cost;
    if (pnl > 0) wins++; else if (pnl < 0) losses++; else pushes++;
    const ms = new Date(t.closed_at).getTime();
    if (!Number.isNaN(ms)) {
      if (firstClose == null || ms < firstClose) firstClose = ms;
      if (lastClose == null || ms > lastClose) lastClose = ms;
    }
    const category = classify(t.market_question);
    if (category === 'other') { uncategorizedCapital += cost; uncategorizedTrades++; continue; }
    if (!catAgg.has(category)) catAgg.set(category, { trades: 0, wins: 0, losses: 0, capital: 0 });
    const c = catAgg.get(category);
    c.trades++; c.capital += cost;
    if (pnl > 0) c.wins++; else if (pnl < 0) c.losses++;
  }
  return { catAgg, wins, losses, pushes, capitalUsd, uncategorizedCapital,
           uncategorizedTrades, firstClose, lastClose, scoredTrades: trades.length };
}

// ── What Postgres GROUP BY market_question produces ───────────────────
function groupLikeSql(trades) {
  const by = new Map();
  for (const t of trades) {
    const k = t.market_question;
    if (!by.has(k)) by.set(k, { market_question: k, trades: 0, wins: 0, losses: 0,
                                pushes: 0, capital: 0, first_close: null, last_close: null });
    const g = by.get(k);
    const pnl = Number(t.realized_pnl);
    g.trades++;
    if (pnl > 0) g.wins++; else if (pnl < 0) g.losses++; else g.pushes++;
    g.capital += Number(t.entry_cost_usd);
    const ms = new Date(t.closed_at).getTime();
    if (g.first_close == null || ms < new Date(g.first_close).getTime()) g.first_close = t.closed_at;
    if (g.last_close == null || ms > new Date(g.last_close).getTime()) g.last_close = t.closed_at;
  }
  return [...by.values()];
}

// ── NEW: one row per market question ──────────────────────────────────
function newWay(durableRows) {
  const catAgg = new Map();
  let wins = 0, losses = 0, pushes = 0, capitalUsd = 0, scoredTrades = 0;
  let uncategorizedCapital = 0, uncategorizedTrades = 0;
  let firstClose = null, lastClose = null;
  for (const t of durableRows) {
    const trades = Number(t.trades) || 0;
    const w = Number(t.wins) || 0, l = Number(t.losses) || 0, p = Number(t.pushes) || 0;
    const cost = Number(t.capital) || 0;
    scoredTrades += trades;
    capitalUsd += cost;
    wins += w; losses += l; pushes += p;
    const firstMs = t.first_close ? new Date(t.first_close).getTime() : NaN;
    const lastMs = t.last_close ? new Date(t.last_close).getTime() : NaN;
    if (!Number.isNaN(firstMs) && (firstClose == null || firstMs < firstClose)) firstClose = firstMs;
    if (!Number.isNaN(lastMs) && (lastClose == null || lastMs > lastClose)) lastClose = lastMs;
    const category = classify(t.market_question);
    if (category === 'other') { uncategorizedCapital += cost; uncategorizedTrades += trades; continue; }
    if (!catAgg.has(category)) catAgg.set(category, { trades: 0, wins: 0, losses: 0, capital: 0 });
    const c = catAgg.get(category);
    c.trades += trades; c.capital += cost;
    c.wins += w; c.losses += l;
  }
  return { catAgg, wins, losses, pushes, capitalUsd, uncategorizedCapital,
           uncategorizedTrades, firstClose, lastClose, scoredTrades };
}

// ── Randomised corpus ─────────────────────────────────────────────────
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const QUESTIONS = [
  'Will the Fed cut rates by September 2026?', 'Will CPI print above 3.0%?',
  'Will Bitcoin close above $150,000?', 'Will ETH flip BTC?',
  'Will Argentina win the World Cup?', 'Who wins the NBA finals?',
  'Will new tariffs take effect?', 'Will the election be certified?',
  'Some unclassifiable market', 'Another residual market',
];
function corpus(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    out.push({
      market_question: QUESTIONS[Math.floor(rnd() * QUESTIONS.length)],
      // Deliberately includes exact zeros: a push is not a graded outcome and
      // must not land in wins or losses on either side of the refactor.
      realized_pnl: r < 0.08 ? 0 : (r < 0.54 ? -Math.round(rnd() * 900) : Math.round(rnd() * 1200)),
      entry_cost_usd: Math.round(rnd() * 5000) + 1,
      closed_at: new Date(Date.UTC(2026, 0, 1 + Math.floor(rnd() * 500))).toISOString(),
    });
  }
  return out;
}

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };

function compare(label, trades) {
  const a = oldWay(trades);
  const b = newWay(groupLikeSql(trades));
  ok(label + ': scored trades', a.scoredTrades === b.scoredTrades, a.scoredTrades + ' vs ' + b.scoredTrades);
  ok(label + ': wins', a.wins === b.wins, a.wins + ' vs ' + b.wins);
  ok(label + ': losses', a.losses === b.losses, a.losses + ' vs ' + b.losses);
  ok(label + ': pushes', a.pushes === b.pushes, a.pushes + ' vs ' + b.pushes);
  ok(label + ': capital', Math.abs(a.capitalUsd - b.capitalUsd) < 1e-6, a.capitalUsd + ' vs ' + b.capitalUsd);
  ok(label + ': uncategorised capital',
    Math.abs(a.uncategorizedCapital - b.uncategorizedCapital) < 1e-6);
  ok(label + ': uncategorised trades', a.uncategorizedTrades === b.uncategorizedTrades,
    a.uncategorizedTrades + ' vs ' + b.uncategorizedTrades);
  ok(label + ': first resolution', a.firstClose === b.firstClose);
  ok(label + ': last resolution', a.lastClose === b.lastClose);
  ok(label + ': same categories',
    [...a.catAgg.keys()].sort().join() === [...b.catAgg.keys()].sort().join());
  for (const [cat, av] of a.catAgg) {
    const bv = b.catAgg.get(cat) || {};
    ok(label + ': ' + cat + ' trades', av.trades === bv.trades, av.trades + ' vs ' + bv.trades);
    ok(label + ': ' + cat + ' wins', av.wins === bv.wins);
    ok(label + ': ' + cat + ' losses', av.losses === bv.losses);
    ok(label + ': ' + cat + ' capital', Math.abs(av.capital - bv.capital) < 1e-6);
    // The win rate is the figure the chart actually prints.
    const rate = (w, l) => (w + l) > 0 ? Math.round((w / (w + l)) * 1000) / 10 : null;
    ok(label + ': ' + cat + ' win rate', rate(av.wins, av.losses) === rate(bv.wins, bv.losses));
  }
}

compare('empty', []);
compare('single trade', corpus(1));
compare('small', corpus(37));
compare('large', corpus(5000));
// Every trade on one market — the worst case for grouping.
compare('one market', corpus(200).map(t => Object.assign(t, { market_question: QUESTIONS[0] })));
// All pushes: wins and losses must both stay zero and the rate must stay null.
compare('all pushes', corpus(50).map(t => Object.assign(t, { realized_pnl: 0 })));

console.log('\n' + '='.repeat(56));
console.log('BOARD-STATS AGG SUITE: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
process.exit(fail ? 1 : 0);
