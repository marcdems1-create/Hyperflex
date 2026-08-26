// Offline assertion suite over the REAL render functions in
// public/challenge.html. No network, no database, no server — safe in CI.
//
// Same technique as test/homepage.test.js: slice the page's own script
// block and eval it against a DOM shim, so these tests exercise SHIPPED
// code rather than a copy that drifts. The slice stops before the boot
// calls so nothing tries to fetch.
//
// Run: npm run test:challenge
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'challenge.html'), 'utf8');

const start = html.indexOf('var TOKEN = localStorage');
const end = html.indexOf('/* ── Boot ─');
if (start < 0 || end < 0) throw new Error('could not locate script block');
const block = html.slice(start, end);

const sinks = {};
function mkEl(id) {
  return {
    id, _html: '', value: '', disabled: false, className: '', style: {},
    set innerHTML(v) { this._html = v; sinks[id] = v; },
    get innerHTML() { return this._html; },
    set textContent(v) { sinks[id] = v; },
    get textContent() { return sinks[id] || ''; },
    classes: new Set(),
    get classList() {
      const s = this.classes;
      return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) };
    },
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    focus() {},
  };
}
const els = {};
global.document = {
  getElementById: (id) => (els[id] = els[id] || mkEl(id)),
  querySelectorAll: () => [],
  addEventListener() {},
};
global.window = { matchMedia: () => ({ matches: true }), location: { href: '' } };
global.localStorage = { getItem: () => '', removeItem() {}, setItem() {} };
global.performance = { now: () => 0 };
global.requestAnimationFrame = (fn) => fn(0);
global.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
global.setInterval = () => 0;
global.setTimeout = () => 0;
global.alert = () => {};

eval(block);

// ---------------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };
const throws = (n, fn) => { try { fn(); ok(n, true); } catch (e) { ok(n, false, 'threw: ' + e.message); } };

const CALL = (o = {}) => Object.assign({
  trader: Object.assign({
    user_id: 'u1', username: 'whale', display_name: 'Whale', polymarket_address: '0xabc',
    flex_score: 88, win_rate_pct: 64.2, n: 63, durable_verified: true,
  }, o.trader || {}),
  market: Object.assign({
    question: 'Will the Fed cut rates by September 2026?', slug: 'fed-cut',
    condition_id: '0xcond', side: 'YES', icon: null,
    end_date: new Date(Date.now() + 86400e3 * 9).toISOString(),
  }, o.market || {}),
  entry_price: 0.34, current_price: 0.41, trader_position_usd: 4200,
}, o.top || {});

// ===== OPPONENT CARDS ==================================================
throws('opp: renders without throwing', () => oppCardHtml(CALL(), 0));

let h = oppCardHtml(CALL(), 0);
ok('opp: the CTA offers the side the trader is NOT on', /Take NO/.test(h) && !/Take YES/.test(h));
ok('opp: their corner shows their real side', /corner-side yes">YES/.test(h));
ok('opp: your corner shows the opposite side', /corner-side no">NO/.test(h));
ok('opp: score and sample size both travel with the card (rule 3)',
  /88/.test(h) && /64\.2% won/.test(h) && /63 resolved/.test(h));
ok('opp: entry and current price are both shown', /in at 34¢/.test(h) && /now 41¢/.test(h));

h = oppCardHtml(CALL({ market: { side: 'NO' } }), 1);
ok('opp: a NO holder is challenged with YES', /Take YES/.test(h));

// A market with no icon must still render a same-sized tile, never a gap.
ok('opp: a missing icon falls back to a deterministic tile',
  /opp-icon opp-icon-fb/.test(oppCardHtml(CALL(), 0)));
h = oppCardHtml(CALL({ market: { icon: 'https://img/x.png' } }), 0);
ok('opp: a real icon is lazy, async-decoded and referrer-free',
  /loading="lazy"/.test(h) && /decoding="async"/.test(h) && /referrerpolicy="no-referrer"/.test(h));
ok('opp: a dead icon URL swaps to the tile rather than collapsing',
  /onerror=/.test(h) && /data-fb=/.test(h));

// A multi-outcome leg with a named outcome can't be challenged coherently.
ok('opp: a non-YES/NO side renders nothing at all',
  oppCardHtml(CALL({ market: { side: 'ELENA RYBAKINA' } }), 0) === '');

// Position size is optional; a missing one must not print a dangling "$—".
h = oppCardHtml(CALL({ top: { trader_position_usd: null } }), 0);
ok('opp: an unknown position size prints no size clause', !/they hold/.test(h));
ok('opp: the countdown still renders without a size', /left</.test(h));

// ===== BOUT CARDS ======================================================
const BOUT = (o = {}) => Object.assign({
  id: 'c1', status: 'accepted', created_at: new Date(Date.now() - 3600e3).toISOString(),
  market_title: 'Will the Fed cut rates by September 2026?', stake_flex: 50,
  challenger_side: 'NO', challenged_side: 'YES', winner_id: null,
  challenger: { id: 'u9', name: 'Kess', handle: 'kess' },
  challenged: { id: 'u1', name: 'Whale', handle: 'whale.eth' },
}, o);

throws('bout: renders without throwing', () => boutHtml(BOUT()));
h = boutHtml(BOUT());
ok('bout: both corners are named', /@kess/.test(h) && /@whale\.eth/.test(h));
ok('bout: both sides are shown', /tape-side no">NO/.test(h) && /tape-side yes">YES/.test(h));
ok('bout: a stake is labelled', /50 FLEX/.test(h));
ok('bout: an unstaked challenge says so', /pride only/.test(boutHtml(BOUT({ stake_flex: 0 }))));
h = boutHtml(BOUT({ status: 'resolved', winner_id: 'u9' }));
ok('bout: a settled bout names the winner', /@kess/.test(h) && /took it/.test(h));

// ===== TITLE HOLDERS ===================================================
h = beltHtml({ user_id: 'u1', name: 'Whale', handle: 'whale.eth', wins: 9, losses: 3, win_rate: 0.75 }, 0);
ok('belt: wins and losses are both shown', /9W/.test(h) && /3L/.test(h));
ok('belt: losses are never dropped from the record',
  /2W/.test(beltHtml({ wins: 2, losses: 8, win_rate: 0.2 }, 3)) &&
  /8L/.test(beltHtml({ wins: 2, losses: 8, win_rate: 0.2 }, 3)));
ok('belt: win rate carries one decimal', /20\.0%/.test(beltHtml({ wins: 2, losses: 8, win_rate: 0.2 }, 3)));

// ===== WEEKLY PICK STATE ===============================================
const M = { yes_price_at_open: 34, current_price: 41 };
ok('weekly: YES ahead when the price rose', pickState({ side: 'YES', yes_price_at_pick: 34 }, M) === 'winning');
ok('weekly: NO behind when the price rose', pickState({ side: 'NO', yes_price_at_pick: 34 }, M) === 'losing');
ok('weekly: a 1c move is level, not a win',
  pickState({ side: 'YES', yes_price_at_pick: 40 }, M) === 'neutral');

// ===== FORMATTING ======================================================
ok('fmt: a closed market reads as closed', fmtLeft(new Date(Date.now() - 1000).toISOString()) === 'closed');
ok('fmt: days and hours both show', /d .*h left/.test(fmtLeft(new Date(Date.now() + 86400e3 * 3).toISOString())));
ok('fmt: percentages carry one decimal', fmtPct1(64.25) === '64.3%');
ok('fmt: a null percentage is an em-dash, not 0%', fmtPct1(null) === '—');
ok('esc: markup in a market title cannot break out',
  !/<script>/.test(oppCardHtml(CALL({ market: { question: '<script>x</script>' } }), 0)));

// ---------------------------------------------------------------------
console.log('\n' + '='.repeat(56));
console.log('CHALLENGE SUITE: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
process.exit(fail ? 1 : 0);
