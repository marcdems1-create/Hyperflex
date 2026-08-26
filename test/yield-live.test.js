// Live suite for /incentives (Yield). Hits production.
// The page's whole job is telling a maker where to rest an order, so these
// assertions check the two things that decide that: the reward program's
// terms, and the live book those terms apply to.
//
// npm run test:yield:live   (override target with HFX_BASE)
const BASE = process.env.HFX_BASE || 'https://hyperflex.network';

let pass = 0, fail = 0, warn = 0;
const failures = [], warnings = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };
const soft = (n, c, d) => { if (c) pass++; else { warn++; warnings.push(n + (d ? ' — ' + d : '')); } };

(async () => {
  const rRes = await fetch(BASE + '/api/ecosystem/rewards');
  ok('rewards endpoint 200', rRes.status === 200, 'HTTP ' + rRes.status);
  const rw = await rRes.json();
  const markets = (rw && rw.markets) || [];
  ok('rewards returns markets', markets.length > 0, String(markets.length));

  // Program terms must be usable — the page renders a post range from these.
  for (const m of markets) {
    const tag = (m.slug || '?').slice(0, 26);
    ok(`[${tag}] has a question`, (m.question || '').length > 3);
    ok(`[${tag}] reward_rate > 0`, Number(m.reward_rate) > 0, String(m.reward_rate));
    // Polymarket does not always publish these. That is an upstream fact,
    // not a defect — the card degrades to "range not published" / "—" and
    // the book skips the reward band. Warn so the frequency is visible.
    soft(`[${tag}] max_spread published`, m.max_spread != null && Number(m.max_spread) > 0, String(m.max_spread));
    soft(`[${tag}] min_size published`, m.min_size != null && Number(m.min_size) > 0, String(m.min_size));
    const yp = Number(m.yes_price);
    ok(`[${tag}] yes_price in (0,1)`, yp > 0 && yp < 1, String(yp));
    ok(`[${tag}] has a slug to link to`, !!m.slug);
    // the book visual cannot render without this
    ok(`[${tag}] has clob_token_ids`, !!m.clob_token_ids, String(m.clob_token_ids));
    let toks = null;
    try { toks = typeof m.clob_token_ids === 'string' ? JSON.parse(m.clob_token_ids) : m.clob_token_ids; } catch (e) { /* asserted below */ }
    ok(`[${tag}] clob_token_ids parses to a non-empty array`, Array.isArray(toks) && toks.length > 0);
  }

  // Books: check a sample rather than all, to stay polite to the CLOB proxy.
  const sample = markets.slice(0, 6);
  let withBook = 0;
  for (const m of sample) {
    const tag = (m.slug || '?').slice(0, 26);
    let toks; try { toks = typeof m.clob_token_ids === 'string' ? JSON.parse(m.clob_token_ids) : m.clob_token_ids; } catch (e) { continue; }
    const res = await fetch(BASE + '/api/polymarket/orderbook/' + encodeURIComponent(toks[0]));
    ok(`[${tag}] orderbook 200`, res.status === 200, 'HTTP ' + res.status);
    if (res.status !== 200) continue;
    const b = await res.json();

    const bids = b.bids || [], asks = b.asks || [];
    soft(`[${tag}] book has two sides`, bids.length > 0 && asks.length > 0, `bids=${bids.length} asks=${asks.length}`);
    if (!bids.length || !asks.length) continue;
    withBook++;

    const bb = Number(b.best_bid), ba = Number(b.best_ask);
    ok(`[${tag}] best_bid in (0,1)`, bb > 0 && bb < 1, String(bb));
    ok(`[${tag}] best_ask in (0,1)`, ba > 0 && ba < 1, String(ba));
    ok(`[${tag}] best_ask > best_bid (not crossed)`, ba > bb, `${bb} / ${ba}`);
    ok(`[${tag}] reported spread matches ask-bid`, Math.abs(Number(b.spread) - (ba - bb)) < 1e-6,
      `${b.spread} vs ${(ba - bb).toFixed(6)}`);
    if (b.mid_price != null) {
      ok(`[${tag}] mid sits between the touch prices`, Number(b.mid_price) >= bb && Number(b.mid_price) <= ba,
        `${bb} <= ${b.mid_price} <= ${ba}`);
    }
    // best_bid/best_ask must actually be the extremes of the book
    const maxBid = Math.max(...bids.map(x => Number(x.price)));
    const minAsk = Math.min(...asks.map(x => Number(x.price)));
    ok(`[${tag}] best_bid is the highest bid`, Math.abs(maxBid - bb) < 1e-6, `${maxBid} vs ${bb}`);
    ok(`[${tag}] best_ask is the lowest ask`, Math.abs(minAsk - ba) < 1e-6, `${minAsk} vs ${ba}`);
    ok(`[${tag}] all sizes positive`, bids.concat(asks).every(x => Number(x.size) > 0));

    // The reward band the page draws must overlap prices a maker can
    // actually rest at, or the card would be telling someone to post
    // somewhere the book can't accept.
    const mid = b.mid_price != null ? Number(b.mid_price) : (bb + ba) / 2;
    const ms = Number(m.max_spread);
    const lo = mid * 100 - ms, hi = mid * 100 + ms;
    ok(`[${tag}] reward band is a real range`, hi > lo);
    ok(`[${tag}] reward band overlaps the touch`, hi >= bb * 100 && lo <= ba * 100,
      `band ${lo.toFixed(1)}-${hi.toFixed(1)} vs touch ${(bb * 100).toFixed(1)}/${(ba * 100).toFixed(1)}`);
  }
  ok('at least one sampled market had a two-sided book', withBook > 0, String(withBook));

  // Bad token must 4xx, not 500
  const bad = await fetch(BASE + '/api/polymarket/orderbook/not-a-token');
  ok('bad token id does not 500', bad.status < 500, 'HTTP ' + bad.status);

  // Page-level
  const page = await fetch(BASE + '/incentives');
  const html = await page.text();
  ok('yield page 200', page.status === 200);
  ok('page ships the book component', /r-book-svg|r-book\b/.test(html));
  ok('page ships the numbers/table toggle', /r-book-toggle/.test(html));
  ok('card is not an anchor wrapping a button', !/<a class="r-card"/.test(html));
  ok('no leftover TODO/FIXME', !/TODO:|FIXME:/.test(html));
  // the null-terms path must never print fabricated zeros
  ok('page handles unpublished program terms', /range not published/.test(html));

  console.log('\n' + '='.repeat(60));
  console.log(`YIELD LIVE:  ${pass} passed, ${fail} failed, ${warn} warnings  (${markets.length} markets, ${sample.length} books)`);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  ✗ ' + f)); }
  if (warnings.length) { console.log('\nWARNINGS:'); warnings.forEach(w => console.log('  ! ' + w)); }
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e.stack); process.exit(2); });
