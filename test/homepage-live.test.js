// LIVE END-TO-END TEST against production.
// The API responding 200 with plausible JSON is not proof the product
// works. This walks every live call the way a user would: reads the card's
// promise, follows its CTA, and checks the destination actually offers that
// market at that price. The wrong-market bug passed every API-level check
// and was only visible by doing this.
const BASE = process.env.HFX_BASE || 'https://hyperflex.network';

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); }
};

const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' -> ' + r.status); return r.json(); };
const getText = async (u) => { const r = await fetch(u); return { status: r.status, body: await r.text() }; };
const meta = (html, prop) => {
  const m = new RegExp('<meta property="' + prop + '" content="([^"]*)"').exec(html)
         || new RegExp(prop + '" content="([^"]*)"').exec(html);
  return m ? m[1] : null;
};

(async () => {
  // ---------- board-stats ----------
  const bs = await getJSON(BASE + '/api/board-stats');
  const t = bs.totals;
  ok('board: ranked_wallets > 0', t.ranked_wallets > 0, String(t.ranked_wallets));
  ok('board: wins + losses + pushes == scored_trades',
    t.wins + t.losses + t.pushes === t.scored_trades,
    `${t.wins}+${t.losses}+${t.pushes} vs ${t.scored_trades}`);
  ok('board: win_rate matches wins/(wins+losses)',
    Math.abs(t.win_rate_pct - (t.wins / (t.wins + t.losses)) * 100) < 0.1);
  ok('board: durable_trades <= graded_trades', t.durable_trades <= t.graded_trades);
  ok('board: capital > 0', t.capital_usd > 0);

  const catSum = bs.categories.reduce((s, c) => s + c.capital_usd, 0);
  const withResidual = catSum + bs.uncategorized.capital_usd;
  ok('board: categories + uncategorized == total capital (within rounding)',
    Math.abs(withResidual - t.capital_usd) <= bs.categories.length + 2,
    `${withResidual} vs ${t.capital_usd}`);

  for (const c of bs.categories) {
    ok('board: ' + c.label + ' win_rate consistent',
      c.win_rate_pct == null || Math.abs(c.win_rate_pct - (c.wins / (c.wins + c.losses)) * 100) < 0.1);
    ok('board: ' + c.label + ' is not the residual bucket', c.category !== 'other');
  }

  const sd = bs.score_distribution;
  ok('board: score buckets cover 0-99 in ten bands', sd.buckets.length === 10);
  const bucketSum = sd.buckets.reduce((s, b) => s + b.count, 0);
  ok('board: bucketed + unscored == ranked_wallets',
    bucketSum + sd.unscored === t.ranked_wallets, `${bucketSum}+${sd.unscored} vs ${t.ranked_wallets}`);
  const split = bs.wallet_roi_split;
  ok('board: roi split <= ranked_wallets', split.profitable + split.losing <= t.ranked_wallets);

  // ---------- live-calls ----------
  const lc = await getJSON(BASE + '/api/live-calls');
  ok('calls: returned some calls', lc.calls.length > 0, String(lc.calls.length));
  ok('calls: disclosure present', !!lc.disclosure);

  const now = Date.now();
  for (const c of lc.calls) {
    const tr = c.trader, m = c.market;
    const tag = (tr.display_name || tr.username || 'wallet').slice(0, 14);

    ok(`[${tag}] side is YES/NO`, m.side === 'YES' || m.side === 'NO', m.side);
    ok(`[${tag}] score present (rule 3)`, tr.flex_score != null);
    ok(`[${tag}] sample size present (rule 3)`, tr.n != null && tr.n > 0);
    ok(`[${tag}] win rate >= 55`, tr.win_rate_pct >= 55, String(tr.win_rate_pct));
    ok(`[${tag}] durable_verified`, tr.durable_verified === true);
    ok(`[${tag}] price in tradeable band`, c.current_price >= 0.03 && c.current_price <= 0.95, String(c.current_price));
    ok(`[${tag}] move within 25%`, Math.abs(c.price_move_pct) <= 25, String(c.price_move_pct));

    const days = (new Date(m.end_date).getTime() - now) / 86400e3;
    ok(`[${tag}] horizon 1-365d`, days >= 1 && days <= 365, days.toFixed(1) + 'd');

    // potential return must be exactly the payout arithmetic it claims
    const expected = ((1 - c.current_price) / c.current_price) * 100;
    ok(`[${tag}] potential_roi is payout arithmetic`, Math.abs(c.potential_roi_pct - expected) < 0.6,
      `${c.potential_roi_pct} vs ${expected.toFixed(1)}`);

    // ---- THE ONE THAT MATTERS: follow the CTA ----
    const url = `${BASE}/market/${encodeURIComponent(m.slug)}?from=live-call&side=${m.side.toLowerCase()}&size=25`;
    const page = await getText(url);
    ok(`[${tag}] CTA returns 200`, page.status === 200, 'HTTP ' + page.status);

    const title = (/<title>([^<]*)<\/title>/.exec(page.body) || [])[1] || '';
    // the destination must be the market the card named, not its parent event
    const first6 = m.question.replace(/[^a-z0-9 ]/gi, '').toLowerCase().split(/\s+/).slice(0, 6).join(' ');
    const titleNorm = title.replace(/[^a-z0-9 ]/gi, '').toLowerCase();
    ok(`[${tag}] CTA lands on the market the card named`, titleNorm.includes(first6.slice(0, 28)),
      `card="${m.question.slice(0, 40)}" page="${title.slice(0, 40)}"`);

    // and it must offer roughly the price the card quoted
    const og = meta(page.body, 'og:description') || '';
    const pm = /YES\s+(\d+)¢\s*·\s*NO\s+(\d+)¢/.exec(og);
    if (pm) {
      const pageCents = m.side === 'YES' ? parseInt(pm[1], 10) : parseInt(pm[2], 10);
      const cardCents = Math.round(c.current_price * 100);
      ok(`[${tag}] CTA page price matches the card's quote`, Math.abs(pageCents - cardCents) <= 3,
        `card=${cardCents}¢ page=${pageCents}¢ (${og.slice(0, 30)})`);
    } else {
      ok(`[${tag}] CTA page exposes a price`, false, 'no YES/NO price in og:description: ' + og.slice(0, 60));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`LIVE E2E:  ${pass} passed, ${fail} failed   (${lc.calls.length} calls walked)`);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  ✗ ' + f)); }
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e.message); process.exit(2); });
