#!/usr/bin/env node
/**
 * backfill-user-market-interest.js — one-time, read-only backfill
 *
 * Populates user_market_interest (migration #63) from existing
 * polymarket_v2_trades rows so the feature isn't empty on day one — new
 * trades are tracked live via _trackMarketInterestFromOrder() in server.js.
 *
 * Read-only against polymarket_v2_trades and users — never writes to
 * either. Only writes to user_market_interest, via the same upsert
 * server.js's _trackMarketInterest() uses, so re-running this script is
 * safe (ON CONFLICT (user_id, token_id) DO UPDATE, same as live tracking).
 *
 * polymarket_v2_trades has no condition_id/question column — only
 * token_id — so condition_id/question/category are backfilled per unique
 * token_id via the Gamma clob_token_ids lookup, same as
 * _fetchMarketByTokenId() in server.js.
 *
 * Run:
 *   DATABASE_URL='postgresql://...' node scripts/backfill-user-market-interest.js
 */

const { Pool } = require('pg');

const CATEGORY_RULES = [
  ['crypto', /\b(bitcoin|btc|eth|ethereum|crypto|solana|xrp|dogecoin|doge|token|defi|nft|stablecoin|blockchain)\b/i],
  ['politics', /\b(trump|biden|harris|obama|kamala|president|prime minister|parliament|parliamentary|congress|senate|elections?|democrat|republican|politic|politics|governor|primary|gop|dnc|rnc|impeach|cabinet|supreme court|tariff|treaty|sanction|regime|coup|invasion|invade|ceasefire|nato|united nations|geopolitic)\b/i],
  ['sports', /\b(nba|nfl|mlb|nhl|soccer|football|basketball|baseball|ufc|boxing|mma|sport|sports|game|match|playoff|super bowl|world cup|championship|tournament|league|team|player|coach|season|finals|mvp|golf|tennis|pga|lpga|masters|olympic|olympics|wimbledon|formula 1|f1|nascar)\b/i],
  ['politics', /\b(iran|iranian|israel|israeli|russia|russian|ukraine|china|chinese|korea|korean|syria|yemen|afghanistan|palestine|palestinian|gaza|lebanon|taiwan|hungary|hungarian|germany|german|france|french|italy|italian|spain|spanish|uk|britain|british|canada|canadian|brazil|brazilian|mexico|mexican|argentina|turkey|turkish|india|indian|pakistan|venezuela|venezuelan|putin|netanyahu|khamenei|orban|orbán|macron|merkel|scholz|sunak|starmer|trudeau|hamas|hezbollah|taliban|war|conflict|middle east)\b/i],
  ['entertainment', /\b(movie|film|oscar|grammy|emmy|album|netflix|spotify|tiktok|youtube|celebrity|award|tv show|concert|tour|streaming|actor|singer|rapper|kardashian|taylor swift)\b/i],
  ['tech', /\b(ai|openai|chatgpt|apple|google|microsoft|meta|tesla|nvidia|amazon|startup|tech|iphone|android|spacex|bezos|musk|zuckerberg)\b/i],
];
// Same taxonomy as server.js's _classifyMarketCategory() (mirrors buildAlphaList's
// detectCategory so live-tracked and backfilled rows agree on category labels).
function classify(question) {
  const t = (question || '').toLowerCase();
  for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
  return 'other';
}

async function fetchMarketByTokenId(tokenId) {
  try {
    const r = await fetch(`https://gamma-api.polymarket.com/markets?clob_token_ids=${encodeURIComponent(tokenId)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Hyperflex/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const body = await r.json();
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.markets) ? body.markets : []);
    const m = arr[0];
    if (!m) return null;
    return { question: m.question || null, conditionId: m.conditionId || m.condition_id || null };
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required:');
    console.error('  DATABASE_URL="postgresql://..." node scripts/backfill-user-market-interest.js');
    process.exit(2);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  console.log('[backfill] reading accepted polymarket_v2_trades...');
  // Live schema uses signer_address, not eoa_address — see the 2026-08-12
  // market-interest-status investigation (server.js's _runMarketInterestBackfill
  // has the same fix and a longer explanation of the drift).
  const { rows: trades } = await pool.query(`
    SELECT signer_address, token_id, side, created_at
    FROM polymarket_v2_trades
    WHERE clob_status = 'accepted' AND signer_address IS NOT NULL AND token_id IS NOT NULL
    ORDER BY created_at ASC
  `);
  console.log(`[backfill] found ${trades.length} accepted trades`);

  const { rows: userRows } = await pool.query(
    `SELECT id, LOWER(polymarket_address) AS addr FROM users WHERE polymarket_address IS NOT NULL`
  );
  const addrToUserId = {};
  for (const r of userRows) addrToUserId[r.addr] = r.id;
  console.log(`[backfill] mapped ${userRows.length} wallet addresses to users`);

  const metaCache = new Map();
  let tracked = 0, skippedNoUser = 0, skippedNoMeta = 0;

  for (const t of trades) {
    const userId = addrToUserId[(t.signer_address || '').toLowerCase()];
    if (!userId) { skippedNoUser++; continue; }

    let meta = metaCache.get(t.token_id);
    if (meta === undefined) {
      meta = await fetchMarketByTokenId(t.token_id);
      metaCache.set(t.token_id, meta);
      await new Promise(r => setTimeout(r, 150)); // gentle rate limit on Gamma
    }
    if (!meta) { skippedNoMeta++; continue; }

    const category = classify(meta.question);
    await pool.query(
      `INSERT INTO user_market_interest (user_id, token_id, condition_id, question, category, side, trade_count, first_traded_at, last_traded_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)
       ON CONFLICT (user_id, token_id) DO UPDATE SET
         trade_count = user_market_interest.trade_count + 1,
         last_traded_at = GREATEST(user_market_interest.last_traded_at, EXCLUDED.last_traded_at),
         side = EXCLUDED.side,
         condition_id = COALESCE(user_market_interest.condition_id, EXCLUDED.condition_id),
         question = COALESCE(user_market_interest.question, EXCLUDED.question)`,
      [userId, t.token_id, meta.conditionId, meta.question, category, t.side, t.created_at]
    );
    tracked++;
  }

  console.log(`[backfill] done — ${tracked} rows upserted, ${skippedNoUser} skipped (no matching user), ${skippedNoMeta} skipped (gamma lookup failed)`);
  await pool.end();
}

main().catch(err => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
