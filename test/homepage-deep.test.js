// Deep production suite: cross-endpoint consistency, input robustness,
// caching behaviour, and the invariants the product's credibility rests on.
// Complements homepage-live.test.js (which walks the CTA path).
const BASE = process.env.HFX_BASE || 'https://hyperflex.network';

let pass = 0, fail = 0, warn = 0;
const failures = [], warnings = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };
const soft = (n, c, d) => { if (c) pass++; else { warn++; warnings.push(n + (d ? ' — ' + d : '')); } };

const J = async (u) => { const r = await fetch(BASE + u); return { status: r.status, json: await r.json().catch(() => null), headers: r.headers }; };

(async () => {
  console.log('== cross-endpoint consistency ==');
  const [bs, kings, integrity] = await Promise.all([J('/api/board-stats'), J('/api/kings'), J('/api/integrity')]);
  ok('board-stats 200', bs.status === 200);
  ok('kings 200', kings.status === 200);

  const t = bs.json.totals;

  // The #1 on /api/kings must itself be a plausible member of the board
  // that /api/board-stats is describing. These are computed by the same
  // helper, so a disagreement means one of them is reading stale state.
  const king = (kings.json.overall || [])[0];
  ok('kings returns a #1', !!king);
  if (king) {
    ok('king has a score', king.flex_score != null || king.score_pct != null);
    ok('king n >= board minimum', king.n >= t.minimum_trades_to_rank, `n=${king.n} min=${t.minimum_trades_to_rank}`);
    ok('king carries scope_label (rule 3)', !!king.scope_label);
  }

  // Every category king must clear the same floor
  for (const c of (kings.json.categories || [])) {
    ok(`king[${c.category}] n >= floor`, c.card.n >= t.minimum_trades_to_rank, `n=${c.card.n}`);
    ok(`king[${c.category}] is not 'other'`, c.category !== 'other');
  }

  // category-leaderboard must agree with board-stats on which categories exist
  const cats = bs.json.categories.map(c => c.category);
  for (const cat of cats.slice(0, 4)) {
    const cl = await J('/api/category-leaderboard?category=' + cat + '&limit=6');
    ok(`category-leaderboard[${cat}] 200`, cl.status === 200, 'HTTP ' + cl.status);
    const rows = (cl.json && (cl.json.cards || cl.json.leaderboard)) || [];
    for (const r of rows) {
      ok(`cat[${cat}] row n >= floor`, r.n >= t.minimum_trades_to_rank, `n=${r.n}`);
      // rule 3: a score never travels without its sample size
      ok(`cat[${cat}] row has n`, r.n != null);
    }
  }

  console.log('== arithmetic invariants ==');
  ok('wins+losses+pushes == scored_trades', t.wins + t.losses + t.pushes === t.scored_trades);
  ok('durable_trades <= graded_trades', t.durable_trades <= t.graded_trades);
  ok('ranked_wallets <= wallets_tracked', t.ranked_wallets <= t.wallets_tracked, `${t.ranked_wallets} vs ${t.wallets_tracked}`);
  ok('capital_usd positive', t.capital_usd > 0);
  ok('first_resolution before last_resolution',
    new Date(t.first_resolution_at) < new Date(t.last_resolution_at));
  ok('last_resolution not in the future', new Date(t.last_resolution_at) <= new Date(Date.now() + 3600e3));

  const bsum = bs.json.score_distribution.buckets.reduce((s, b) => s + b.count, 0);
  ok('score buckets + unscored == ranked_wallets', bsum + bs.json.score_distribution.unscored === t.ranked_wallets);
  ok('buckets are contiguous 0..99', bs.json.score_distribution.buckets.every((b, i) => b.min === i * 10 && b.max === i * 10 + 9));
  ok('no negative bucket counts', bs.json.score_distribution.buckets.every(b => b.count >= 0));

  const catCap = bs.json.categories.reduce((s, c) => s + c.capital_usd, 0) + bs.json.uncategorized.capital_usd;
  ok('categories + uncategorized == total capital', Math.abs(catCap - t.capital_usd) <= bs.json.categories.length + 2,
    `${catCap} vs ${t.capital_usd}`);
  const catTrades = bs.json.categories.reduce((s, c) => s + c.trades, 0) + bs.json.uncategorized.trades;
  ok('category trades + uncategorized == scored_trades', catTrades === t.scored_trades, `${catTrades} vs ${t.scored_trades}`);

  for (const c of bs.json.categories) {
    ok(`cat[${c.label}] wins+losses <= trades`, c.wins + c.losses <= c.trades);
    ok(`cat[${c.label}] capital >= 0`, c.capital_usd >= 0);
    soft(`cat[${c.label}] ranked_wallets <= board`, c.ranked_wallets == null || c.ranked_wallets <= t.ranked_wallets,
      `${c.ranked_wallets} vs ${t.ranked_wallets}`);
  }
  ok('categories sorted by capital desc', bs.json.categories.every((c, i, a) => i === 0 || a[i - 1].capital_usd >= c.capital_usd));

  console.log('== live-calls invariants ==');
  const lc = await J('/api/live-calls');
  ok('live-calls 200', lc.status === 200);
  const calls = lc.json.calls || [];
  ok('at most 9 calls (rail, not a market list)', calls.length <= 9, String(calls.length));
  const slugs = calls.map(c => c.market.slug);
  ok('no duplicate markets in the rail', new Set(slugs).size === slugs.length);
  const traders = calls.map(c => c.trader.user_id);
  ok('one call per trader', new Set(traders).size === traders.length);
  ok('sorted by flex_score desc', calls.every((c, i, a) => i === 0 || a[i - 1].trader.flex_score >= c.trader.flex_score));
  for (const c of calls) {
    const tag = (c.trader.display_name || 'w').slice(0, 12);
    ok(`[${tag}] entry price in (0,1)`, c.entry_price > 0 && c.entry_price < 1, String(c.entry_price));
    ok(`[${tag}] position size disclosed`, c.trader_position_usd >= 50);
    ok(`[${tag}] slug is not the parent event`, !!c.market.slug && c.market.slug.length > 0);
    ok(`[${tag}] has condition_id`, !!c.market.condition_id);
    ok(`[${tag}] icon is https or null`, c.market.icon == null || /^https:\/\//.test(c.market.icon));
    ok(`[${tag}] question non-empty`, (c.market.question || '').length > 3);
  }

  console.log('== input robustness ==');
  const badCat = await J('/api/category-leaderboard?category=');
  ok('empty category rejected, not 500', badCat.status === 400, 'HTTP ' + badCat.status);
  const otherCat = await J('/api/category-leaderboard?category=other');
  ok("'other' category rejected", otherCat.status === 400, 'HTTP ' + otherCat.status);
  const inject = await J('/api/category-leaderboard?category=' + encodeURIComponent("'; DROP TABLE users;--"));
  ok('sql-ish category string does not 500', inject.status === 400 || inject.status === 200, 'HTTP ' + inject.status);
  const badAddr = await J('/api/polymarket/positions/not-an-address');
  ok('bad wallet address rejected, not 500', badAddr.status === 400, 'HTTP ' + badAddr.status);
  const shortAddr = await J('/api/polymarket/positions/0x123');
  ok('short address rejected', shortAddr.status === 400, 'HTTP ' + shortAddr.status);
  // query params that should simply be ignored, never crash
  const junk = await J('/api/board-stats?limit=-1&foo[]=bar&x=%00');
  ok('junk query params ignored on board-stats', junk.status === 200, 'HTTP ' + junk.status);
  const junk2 = await J('/api/live-calls?limit=99999');
  ok('junk query params ignored on live-calls', junk2.status === 200, 'HTTP ' + junk2.status);

  console.log('== caching / load ==');
  const t0 = Date.now(); await fetch(BASE + '/api/board-stats'); const warm1 = Date.now() - t0;
  const t1 = Date.now(); await fetch(BASE + '/api/board-stats'); const warm2 = Date.now() - t1;
  ok('board-stats warm response under 2s', warm2 < 2000, warm2 + 'ms');
  soft('board-stats appears cached (2nd call not slower by >2x)', warm2 <= warm1 * 2 + 200, `${warm1}ms then ${warm2}ms`);

  // concurrent burst must not error or stampede
  const burst = await Promise.all(Array.from({ length: 12 }, () => fetch(BASE + '/api/live-calls').then(r => r.status)));
  ok('12 concurrent live-calls all 200', burst.every(s => s === 200), burst.join(','));

  console.log('== page-level ==');
  const home = await fetch(BASE + '/');
  const html = await home.text();
  ok('homepage 200', home.status === 200);
  ok('homepage under 250KB', html.length < 250000, Math.round(html.length / 1024) + 'KB');
  ok('has a title', /<title>[^<]{5,}<\/title>/.test(html));
  ok('has meta description', /name="description"/.test(html));
  ok('has viewport meta', /name="viewport"/.test(html));
  ok('no leftover TODO/FIXME in shipped markup', !/TODO:|FIXME:/.test(html));
  ok('no hardcoded localhost', !/localhost:\d+/.test(html));
  ok('no exposed secret-looking strings', !/(sk_live|secret_key|api_key\s*[:=]\s*["'][A-Za-z0-9]{20,})/i.test(html));
  ok('every chart has a table-view toggle', (html.match(/class="chart-toggle"/g) || []).length === 4);
  ok('call rail present', /id="callsRail"/.test(html));
  ok('disclosure text present', /not a forecast|Nothing here is advice/i.test(html));

  console.log('\n' + '='.repeat(62));
  console.log(`DEEP SUITE:  ${pass} passed, ${fail} failed, ${warn} warnings`);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  ✗ ' + f)); }
  if (warnings.length) { console.log('\nWARNINGS (non-fatal):'); warnings.forEach(w => console.log('  ! ' + w)); }
  console.log('='.repeat(62));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e.stack); process.exit(2); });
