// Offline assertion suite over the REAL render functions in
// public/home-kings.html. No network, no database, no server — safe in CI.
//
// It loads the page's own script block and eval's it against a small DOM
// shim, so these tests exercise SHIPPED code rather than a copy that can
// drift. Run: npm run test:homepage
//
// Companion: test/homepage-live.test.js hits production and walks each
// live call's CTA. Several bugs this file cannot see are only visible
// there — see SESSION_STATE.md 2026-08-20.
// Loads them the same way prerender.js does (slice + eval with a DOM shim)
// so these tests exercise shipped code, not a copy of it.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'home-kings.html'), 'utf8');

const start = html.indexOf('var TRADE_DEFAULT_USD');
const end = html.indexOf('// Connect flow —');
if (start < 0 || end < 0) throw new Error('could not locate script block');
const block = html.slice(start, end);

const sinks = {};
const kpiVals = [];
function mkEl(id) {
  return {
    id, _html: '',
    set innerHTML(v) { this._html = v; sinks[id] = v; },
    get innerHTML() { return this._html; },
    set textContent(v) { sinks[id] = v; },
    get textContent() { return sinks[id] || ''; },
    classes: new Set(),
    get classList() {
      const set = this.classes;
      return { add: (c) => set.add(c), remove: (c) => set.delete(c),
               toggle: (c) => (set.has(c) ? set.delete(c) : set.add(c)),
               contains: (c) => set.has(c) };
    },
    addEventListener() {},
    querySelector() { return { addEventListener() {}, classList: { add() {}, remove() {} } }; },
    querySelectorAll(sel) {
      if (id === 'heroProofBody' && sel === '.hero-stat-val') {
        const n = (this._html.match(/class="hero-stat"/g) || []).length;
        const out = [];
        for (let i = 0; i < n; i++) out.push({ _t: '', classList: { add() {}, remove() {} },
          set textContent(v) { this._t = v; }, get textContent() { return this._t; } });
        return out;
      }
      if (id === 'kpiRow' && sel === '.kpi-val') {
        kpiVals.length = 0;
        const n = (this._html.match(/class="kpi"/g) || []).length;
        for (let i = 0; i < n; i++) kpiVals.push({ _t: '', classList: { add() {}, remove() {} },
          set textContent(v) { this._t = v; }, get textContent() { return this._t; } });
        return kpiVals;
      }
      return [];
    },
    closest() { return { querySelector: () => null }; },
    setAttribute() {}, getAttribute() { return null; }, hidden: false,
  };
}
const els = {};
global.document = { getElementById: (id) => (els[id] = els[id] || mkEl(id)), querySelectorAll: () => [] };
global.window = { matchMedia: () => ({ matches: true }) };
global.performance = { now: () => 0 };
global.requestAnimationFrame = (fn) => fn(0);
global.fetch = () => Promise.resolve({ ok: false });
global.setInterval = () => 0;
global.fmtPlainPct = (p) => p == null ? '—' : p.toFixed(1) + '%';
global.fmtPct = (p) => p == null ? '—' : (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '%';
// Defined below the sliced block (it belongs to the challenge/auth code,
// not the render code), so cardArticleHtml needs it supplied here.
global.cardActionsHtml = () => '<div class="card-actions"></div>';
global.esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

eval(block);

// ---------------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); }
}
function throws(name, fn) {
  try { fn(); ok(name, true); }
  catch (e) { ok(name, false, 'threw: ' + e.message); }
}

const T = (o = {}) => Object.assign({
  user_id: 'u1', username: 'trader', display_name: 'Trader', polymarket_address: '0xabc',
  flex_score: 90, win_rate_pct: 61.2, n: 47,
}, o);
const M = (o = {}) => Object.assign({
  question: 'Will X happen?', slug: 'will-x', side: 'YES',
  end_date: new Date(Date.now() + 86400e3 * 5).toISOString(), icon: 'https://img/x.png',
}, o);
const C = (o = {}) => Object.assign({
  trader: T(), market: M(), entry_price: 0.32, current_price: 0.41,
  price_move_pct: 28.1, potential_roi_pct: 143.9, trader_position_usd: 1250,
}, o);

// ===== LIVE CALL CARDS =================================================
throws('callCardHtml renders without throwing', () => callCardHtml(C()));

let h = callCardHtml(C());
ok('call: shows flex score', h.includes('>90<'));
ok('call: shows win rate', h.includes('61.2%'));
ok('call: shows sample size (rule 3 — never naked)', /47 resolved/.test(h));
ok('call: shows market question', h.includes('Will X happen?'));
ok('call: renders market icon', h.includes('https://img/x.png'));
ok('call: icon falls back on error instead of vanishing', h.includes('onerror=') && h.includes('data-fb='));
ok('call: CTA links to /market/ flow', h.includes('href="/market/will-x?'));
ok('call: CTA carries site default size, NOT trader size', h.includes('size=25') && !h.includes('size=1250'));
ok('call: discloses trader size separately', h.includes('$1,250'));
ok('call: says user sets own size', h.includes('you set your own size'));
ok('call: countdown carries deadline', h.includes('data-deadline='));
ok('call: entry tick positioned at entry', h.includes('left:32.0%'));
ok('call: fill positioned at current price', h.includes('width:41.0%'));
ok('call: trader links to profile', h.includes('href="/@trader"'));

// side handling
ok('call: NO side gets no-class', callCardHtml(C({ market: M({ side: 'NO' }) })).includes('call-side no'));
ok('call: NO side CTA says NO', callCardHtml(C({ market: M({ side: 'NO' }) })).includes('Trade NO at'));

// negative move
h = callCardHtml(C({ price_move_pct: -11.3 }));
ok('call: negative move uses down class', h.includes('call-move down'));
ok('call: negative move renders minus', h.includes('−11.3%'));

// EVERY market must show a picture — no icon means a deterministic tile,
// never an empty gap in the card
{
  const noIcon = callCardHtml(C({ market: M({ icon: null }) }));
  ok('call: no icon -> no img tag', !noIcon.includes('<img'));
  ok('call: no icon -> fallback tile rendered', noIcon.includes('call-icon-fb'));
  ok('call: fallback tile shows a letter', /call-icon-fb[^>]*>W</.test(noIcon));
  // compare only the tile: the full card embeds a live deadline timestamp
  const tileOf = (x) => (/<span class="call-icon call-icon-fb"[^>]*>/.exec(x) || [''])[0];
  const again = callCardHtml(C({ market: M({ icon: null }) }));
  ok('call: fallback tile is deterministic', tileOf(noIcon) === tileOf(again) && tileOf(noIcon).length > 0);
  const other = callCardHtml(C({ market: M({ icon: null, slug: 'totally-different-slug', question: 'Zebra?' }) }));
  const hue1 = /hsl\((\d+),/.exec(noIcon)[1], hue2 = /hsl\((\d+),/.exec(other)[1];
  ok('call: different markets get different tile colours', hue1 !== hue2, hue1 + ' vs ' + hue2);
}

// CTA must name the venue, and the card must explain the payout in plain
// English for someone who has never used a prediction market
ok('call: CTA names Polymarket', h.includes('on Polymarket'));
ok('call: explains what a share pays', /pays \$1 if (YES|NO) resolves/.test(h));
ok('call: still discloses their size', h.includes('they hold $1,250'));
ok('call: still says user sets size', h.includes('you set your own size'));

// handle-less wallet falls back to /m/:id
h = callCardHtml(C({ trader: T({ username: null }) }));
ok('call: handle-less falls back to /m/', h.includes('href="/m/u1"'));

// XSS
h = callCardHtml(C({
  market: M({ question: '<script>alert(1)</script>', slug: 'a"onmouseover="x' }),
  trader: T({ username: '<img src=x onerror=y>' }),
}));
ok('call: escapes question', !h.includes('<script>alert(1)'));
ok('call: escapes handle', !h.includes('<img src=x onerror=y>'));
ok('call: encodes slug in href', !h.includes('a"onmouseover='));

// extreme prices
throws('call: 1c price does not throw', () => callCardHtml(C({ entry_price: 0.01, current_price: 0.99 })));
h = callCardHtml(C({ current_price: 0.99, potential_roi_pct: 1.0 }));
ok('call: rounds ROI to whole percent', h.includes('+1%'));

// named-outcome markets must never render (broken CTA) — found on live data
ok('call: named outcome renders nothing', callCardHtml(C({ market: M({ side: 'ELENA RYBAKINA' }) })) === '');
ok('call: lowercase yes renders nothing (server sends uppercase)', callCardHtml(C({ market: M({ side: 'yes' }) })) === '');
ok('call: empty side renders nothing', callCardHtml(C({ market: M({ side: '' }) })) === '');
ok('call: YES still renders', callCardHtml(C({ market: M({ side: 'YES' }) })).length > 0);
ok('call: NO still renders', callCardHtml(C({ market: M({ side: 'NO' }) })).length > 0);

// trade-slot slug: must target the LEG, never the parent event
ok('tradeSlug: prefers market_slug', tradeMarketSlug({ market_slug: 'leg-slug', market_url: 'https://polymarket.com/event/parent-event' }) === 'leg-slug');
ok('tradeSlug: falls back to market_url', tradeMarketSlug({ market_url: 'https://polymarket.com/event/parent-event' }) === 'parent-event');
ok('tradeSlug: null when neither', tradeMarketSlug({}) === null);

// ===== COUNTDOWN =======================================================
ok('countdown: past deadline reads closed', fmtCountdown(-1000) === 'closed');
ok('countdown: seconds granularity under an hour', /^\d+m \d\ds$/.test(fmtCountdown(65 * 1000)));
ok('countdown: hours+minutes under a day', /^\d+h \d\dm$/.test(fmtCountdown(5 * 3600e3 + 4 * 60e3)));
ok('countdown: days+hours over a day', /^\d+d \d+h$/.test(fmtCountdown(3 * 86400e3)));
ok('countdown: past a month drops the noisy 0h', fmtCountdown(296 * 86400e3) === '296d');
ok('countdown: 365d clean', fmtCountdown(365 * 86400e3) === '365d');
ok('countdown: under a month keeps hours', /^\d+d \d+h$/.test(fmtCountdown(5 * 86400e3 + 7 * 3600e3)));
ok('countdown: exactly zero reads closed', fmtCountdown(0) === 'closed');

// ===== CENTS FORMATTING ================================================
ok('cents: 0.41 -> 41c', centsOf(0.41) === '41¢');
ok('cents: rounds half up', centsOf(0.415) === '42¢');
ok('cents: 0.01 -> 1c', centsOf(0.01) === '1¢');

// ===== KPI TILES =======================================================
const totals = { ranked_wallets: 80, minimum_trades_to_rank: 10, wallets_tracked: 1462,
  graded_trades: 38106, scored_trades: 3801, wins: 1994, losses: 1749, win_rate_pct: 53.3, capital_usd: 4820431 };
throws('renderKpis does not throw', () => renderKpis(totals));
renderKpis(totals);
ok('kpi: renders 4 tiles', (sinks.kpiRow.match(/class="kpi"/g) || []).length === 4);
ok('kpi: shows minimum-to-rank', sinks.kpiRow.includes('Minimum 10 resolved trades'));
ok('kpi: shows wins and losses', sinks.kpiRow.includes('1,994 won') && sinks.kpiRow.includes('1,749 lost'));

// all-null totals must not invent zeros
renderKpis({ ranked_wallets: null, scored_trades: null, capital_usd: null, win_rate_pct: null,
  minimum_trades_to_rank: null, graded_trades: null, wins: null, losses: null });
ok('kpi: null values render as em dash, not 0', (sinks.kpiRow.match(/is-mute/g) || []).length === 4);
ok('kpi: null values never render literal 0', !/>0</.test(sinks.kpiRow));

// ===== NUMBER FORMATTING ===============================================
ok('usd: millions', fmtUsdCompact(4820431) === '$4.8M');
ok('usd: billions', fmtUsdCompact(2.4e9) === '$2.4B');
ok('usd: thousands', fmtUsdCompact(45200) === '$45K');
ok('usd: sub-thousand', fmtUsdCompact(820) === '$820');
ok('usd: null -> dash', fmtUsdCompact(null) === '—');
ok('usd: strips trailing .0', fmtUsdCompact(3e6) === '$3M');
ok('int: null -> dash', fmtInt(null) === '—');
ok('int: thousands separator', fmtInt(38106) === '38,106');

// ===== DONUT ===========================================================
const cats = [
  { category: 'politics', label: 'Politics', trades: 1420, wins: 780, losses: 610, win_rate_pct: 56.1, capital_usd: 1980000 },
  { category: 'sports', label: 'Sports', trades: 980, wins: 470, losses: 495, win_rate_pct: 48.7, capital_usd: 1240000 },
  { category: 'macro', label: 'Macro', trades: 610, wins: 330, losses: 268, win_rate_pct: 55.2, capital_usd: 820000 },
  { category: 'world', label: 'World', trades: 430, wins: 232, losses: 191, win_rate_pct: 54.8, capital_usd: 480000 },
  { category: 'crypto', label: 'Crypto', trades: 260, wins: 118, losses: 138, win_rate_pct: 46.1, capital_usd: 210000 },
];
throws('renderCapitalDonut does not throw', () => renderCapitalDonut(cats));
renderCapitalDonut(cats);
ok('donut: caps at 4 segments (3 hues + Other)', (sinks.capitalChart.match(/donut-seg/g) || []).length === 4);
ok('donut: folds tail into Other with count', sinks.capitalChart.includes('Other (2)'));
ok('donut: uses only the 3 validated hues + neutral',
  ['--cat-1', '--cat-2', '--cat-3', '--cat-other'].every(v => sinks.capitalChart.includes(v)));
ok('donut: every segment has a title tooltip', (sinks.capitalChart.match(/<title>/g) || []).length === 4);
ok('donut: builds table twin', !!sinks.tblCapital && sinks.tblCapital.includes('<table'));

// the classifier residual must be folded in, or the ring undercounts the
// headline "capital graded" figure (live: $25.1M of $163M went missing)
renderCapitalDonut(cats.slice(0, 3), { capital_usd: 1000000, trades: 50 });
ok('donut: residual creates an Other slice', sinks.capitalChart.includes('Other'));
{
  const pcts = [...sinks.capitalChart.matchAll(/(\d+\.\d)%<\/span>/g)].map(m => parseFloat(m[1]));
  const sum = pcts.reduce((a, b) => a + b, 0);
  ok('donut: slices sum to 100% with residual', Math.abs(sum - 100) < 0.3, 'sum=' + sum);
}
renderCapitalDonut(cats, { capital_usd: 0, trades: 0 });
{
  const pcts = [...sinks.capitalChart.matchAll(/(\d+\.\d)%<\/span>/g)].map(m => parseFloat(m[1]));
  ok('donut: sums to 100% with zero residual', Math.abs(pcts.reduce((a,b)=>a+b,0) - 100) < 0.3);
}
// residual alone, no categories at all
renderCapitalDonut([], { capital_usd: 500, trades: 2 });
ok('donut: residual-only still renders', !sinks.capitalChart.includes('chart-empty'));

// exactly 3 categories -> no Other slice
renderCapitalDonut(cats.slice(0, 3), { capital_usd: 0, trades: 0 });
ok('donut: exactly 3 cats + no residual -> no Other', !sinks.capitalChart.includes('Other'));
ok('donut: 3 cats -> 3 segments', (sinks.capitalChart.match(/donut-seg/g) || []).length === 3);

// single category -> full ring
renderCapitalDonut(cats.slice(0, 1));
ok('donut: single category renders 100%', sinks.capitalChart.includes('100.0%'));

// empty / zero capital -> honest empty state, no NaN
renderCapitalDonut([]);
ok('donut: empty renders empty state', sinks.capitalChart.includes('chart-empty'));
renderCapitalDonut([{ label: 'X', capital_usd: 0, trades: 0 }]);
ok('donut: all-zero capital renders empty state, not NaN', sinks.capitalChart.includes('chart-empty'));
ok('donut: never emits NaN', !/NaN/.test(sinks.capitalChart));

// ===== WIN/LOSS BARS ===================================================
throws('renderWinLoss does not throw', () => renderWinLoss(cats));
renderWinLoss(cats);
ok('winloss: one row per category (max 6)', (sinks.winLossChart.match(/class="wl-row"/g) || []).length === 5);
ok('winloss: shows loss counts', sinks.winLossChart.includes('610 lost'));
ok('winloss: builds table twin', sinks.tblWinLoss.includes('<table'));
renderWinLoss(cats.concat([
  { label: 'A', wins: 5, losses: 5, win_rate_pct: 50, capital_usd: 1, trades: 10 },
  { label: 'B', wins: 5, losses: 5, win_rate_pct: 50, capital_usd: 1, trades: 10 },
]));
ok('winloss: caps at 6 rows', (sinks.winLossChart.match(/class="wl-row"/g) || []).length === 6);
// 100% win and 100% loss must not break geometry
renderWinLoss([{ label: 'Perfect', wins: 10, losses: 0, win_rate_pct: 100, capital_usd: 1, trades: 10 },
               { label: 'Wiped', wins: 0, losses: 10, win_rate_pct: 0, capital_usd: 1, trades: 10 }]);
ok('winloss: 100% win -> full green', sinks.winLossChart.includes('width:100.00%'));
ok('winloss: 0% win -> zero green', sinks.winLossChart.includes('width:0.00%'));
ok('winloss: no NaN at extremes', !/NaN/.test(sinks.winLossChart));
renderWinLoss([]);
ok('winloss: empty renders empty state', sinks.winLossChart.includes('chart-empty'));

// ===== HISTOGRAM =======================================================
const buckets = Array.from({ length: 10 }, (_, i) => ({ label: (i*10)+'–'+(i*10+9), min: i*10, max: i*10+9, count: [0,1,4,9,17,21,14,8,3,1][i] }));
throws('renderScoreHist does not throw', () => renderScoreHist({ buckets, unscored: 2 }));
renderScoreHist({ buckets, unscored: 2 });
ok('hist: 10 columns', (sinks.scoreChart.match(/hist-col/g) || []).length === 10);
ok('hist: zero bucket marked empty', sinks.scoreChart.includes('is-empty'));
ok('hist: discloses unscored wallets', sinks.scoreChart.includes('2 ranked wallets have no Flex Score'));
ok('hist: tallest bar is 100%', sinks.scoreChart.includes('height:100.0%'));
ok('hist: builds table twin', sinks.tblScores.includes('<table'));
renderScoreHist({ buckets: buckets.map(b => ({ ...b, count: 0 })), unscored: 0 });
ok('hist: all-zero renders empty state', sinks.scoreChart.includes('chart-empty'));
renderScoreHist({});
ok('hist: missing buckets renders empty state', sinks.scoreChart.includes('chart-empty'));
renderScoreHist({ buckets, unscored: 1 });
ok('hist: singular grammar for one wallet', sinks.scoreChart.includes('1 ranked wallet has no Flex Score yet and is not plotted.'));
renderScoreHist({ buckets, unscored: 3 });
ok('hist: plural grammar for many', sinks.scoreChart.includes('3 ranked wallets have no Flex Score yet and are not plotted.'));

// ===== SPLIT BAR =======================================================
throws('renderSplit does not throw', () => renderSplit({ profitable: 44, losing: 36 }));
renderSplit({ profitable: 44, losing: 36 });
ok('split: shows both counts', sinks.splitChart.includes('44') && sinks.splitChart.includes('36'));
ok('split: shows losing share', sinks.splitChart.includes('45%'));
ok('split: builds table twin', sinks.tblSplit.includes('<table'));
renderSplit({ profitable: 0, losing: 0 });
ok('split: zero/zero renders empty state', sinks.splitChart.includes('chart-empty'));
renderSplit(null);
ok('split: null renders empty state', sinks.splitChart.includes('chart-empty'));
renderSplit({ profitable: 10, losing: 0 });
ok('split: all-profitable no NaN', !/NaN/.test(sinks.splitChart));

// ===== TABLE TWIN ======================================================
const t = tableHtml('Cap', ['A', 'B'], [['<script>', '1']]);
ok('table: escapes cell content', !t.includes('<script>'));
ok('table: has caption', t.includes('<caption>Cap</caption>'));
ok('table: row headers are th scope=row', t.includes('scope="row"'));


// ===== TRADER CARD SPARKLINE ===========================================
// The card's curve must be the equity curve (form_pnl) whenever the server
// ships one. card.form is win/loss flags — as a line it is a square wave
// that says nothing about magnitude, so it is a fallback, never the default.
const CARD = (o = {}) => Object.assign({
  user_id: 'u1', username: 'trader', display_name: 'Trader', polymarket_address: '0xabc',
  flex_score: 72, win_rate_pct: 58.3, n: 31, raw_weighted_roi_pct: 12.5,
  form: [1, 0, 1, 1, 0, 1, 0, 1],
}, o);
const trendOf = (html) => (html.match(/data-trend="([^"]*)"/) || [])[1];
const colorOf = (html) => (html.match(/data-color="([^"]*)"/) || [])[1];

let sc = cardArticleHtml(CARD({ form_pnl: [0, 120, -40, 310] }), false, 2);
ok('spark: equity curve wins over the win/loss flags',
  trendOf(sc) === '0,120,-40,310', trendOf(sc));
ok('spark: a curve ending up is green', colorOf(sc) === 'green', colorOf(sc));
ok('spark: an equity curve carries a zero baseline',
  /data-baseline="0"/.test(sc));
ok('spark: the canvas has an accessible name',
  /role="img"/.test(sc) && /aria-label="Cumulative profit and loss[^"]*"/.test(sc));
ok('spark: the accessible name carries the signed net',
  /aria-label="[^"]*\+\$310"/.test(sc), (sc.match(/aria-label="([^"]*)"/) || [])[1]);

sc = cardArticleHtml(CARD({ form_pnl: [0, -200, -90, -450] }), false, 2);
ok('spark: a curve ending down is red', colorOf(sc) === 'red', colorOf(sc));
ok('spark: a losing net uses U+2212, not a hyphen',
  /aria-label="[^"]*\u2212\$450"/.test(sc), (sc.match(/aria-label="([^"]*)"/) || [])[1]);

sc = cardArticleHtml(CARD({ form_pnl: [0, 0, 0] }), false, 2);
ok('spark: a flat curve is neither green nor red', colorOf(sc) === 'gold', colorOf(sc));

// Fallback path — an older payload with no form_pnl still draws something,
// and must NOT claim a baseline it doesn't have.
sc = cardArticleHtml(CARD(), false, 2);
ok('spark: falls back to win/loss flags when no curve is shipped',
  trendOf(sc) === '100,0,100,100,0,100,0,100', trendOf(sc));
ok('spark: the fallback carries no zero baseline', !/data-baseline/.test(sc));
ok('spark: the fallback still has an accessible name',
  /aria-label="Win and loss sequence[^"]*"/.test(sc));

sc = cardArticleHtml(CARD({ form: [], form_pnl: null }), false, 2);
ok('spark: no series at all renders no canvas', !/spark-canvas/.test(sc));
sc = cardArticleHtml(CARD({ form: [1], form_pnl: [0] }), false, 2);
ok('spark: a single point is not a line, so no canvas', !/spark-canvas/.test(sc));

// ===== HERO BOARD PULSE ================================================
// Same figures as the KPI row, from the same response. It must disappear
// rather than render an empty scoreboard in the first screen.
const TOTALS = { ranked_wallets: 76, scored_trades: 4182, capital_usd: 2860000,
                 win_rate_pct: 54.3, wins: 2271, losses: 1911 };
throws('heroProof: renders without throwing', () => renderHeroProof(TOTALS, new Date().toISOString()));
renderHeroProof(TOTALS, '2026-08-24T17:00:00Z');
let hp = sinks['heroProofBody'] || '';
ok('heroProof: renders four figures', (hp.match(/class="hero-stat"/g) || []).length === 4);
ok('heroProof: shows the win/loss ribbon', /hero-ribbon-seg win/.test(hp) && /hero-ribbon-seg loss/.test(hp));
ok('heroProof: the ribbon has an accessible name',
  /aria-label="2,271 trades won, 1,911 lost"/.test(hp));
ok('heroProof: losses are labelled, never folded into the win figure',
  /1,911 lost/.test(hp));
ok('heroProof: panel is visible when there are figures',
  !document.getElementById('heroProof').classList.contains('is-gone'));

renderHeroProof(null, null);
ok('heroProof: hides itself when the board has nothing to report',
  document.getElementById('heroProof').classList.contains('is-gone'));
renderHeroProof({ ranked_wallets: null }, null);
ok('heroProof: hides itself rather than rendering a row of dashes',
  document.getElementById('heroProof').classList.contains('is-gone'));

// A board with no decided trades yet must not draw a zero-width ribbon.
renderHeroProof({ ranked_wallets: 3, scored_trades: 0, capital_usd: 0,
                  win_rate_pct: 0, wins: 0, losses: 0 }, null);
ok('heroProof: no decided trades means no ribbon',
  !/hero-ribbon-bar/.test(sinks['heroProofBody'] || ''));

// ===== PAGE-LEVEL / ACCESSIBILITY ======================================
// Asserted against the raw file, not the render functions — these are
// properties of the served document.
{
  ok('page: risk disclosure is STATIC, not fetch-dependent',
    /class="calls-disclosure"[^>]*>[^<]*not a forecast/.test(html.replace(/\n/g, ' ')));
  ok('page: score gauge is aria-hidden (decorative, number is adjacent text)',
    /class="gauge-wrap"><svg[^>]*aria-hidden="true"/.test(html));
  ok('page: donut carries an accessible name',
    /<svg viewBox="0 0 150 150" role="img" aria-label=/.test(html));
  ok('page: has exactly one h1', (html.match(/<h1/g) || []).length === 1);
  ok('page: html lang set', /<html lang="en"/.test(html));
  ok('page: four chart/table toggles', (html.match(/class="chart-toggle"/g) || []).length === 4);
  ok('page: prediction-market explainer present for newcomers',
    /an outcome trades between/.test(html));
  // --ink-faint failed WCAG AA at #565d70 across 12 styles; do not regress
  const faint = /--ink-faint:\s*(#[0-9a-fA-F]{6})/.exec(html);
  ok('page: --ink-faint token present', !!faint);
  if (faint) {
    const lum = (h) => {
      const n = parseInt(h.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (f, b) => { const L1 = lum(f), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
    // measured against --surface-2 #181c25, the lightest surface it sits on
    const r = ratio(faint[1], '#181c25');
    ok('page: --ink-faint meets WCAG AA (4.5:1) on the lightest surface',
      r >= 4.5, faint[1] + ' = ' + r.toFixed(2) + ':1');
  }
}

// ---------------------------------------------------------------------
console.log('\n' + '='.repeat(56));
console.log('FRONTEND SUITE:  ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
process.exit(fail ? 1 : 0);
