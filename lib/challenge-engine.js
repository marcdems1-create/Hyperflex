// lib/challenge-engine.js
// Weekly Challenge engine — market selection, creation, scoring.
// Called by server.js crons and boot timeout; never started standalone.
'use strict';

const { getHotMarketsCarousel, classifyTopic } = require('./hot-markets');

// dbQuery (server.js) returns an array of rows. Some call sites still pass
// a pg Result-shaped object. Normalize so .rows never blows up creation.
function asRows(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

async function selectChallengeMarkets() {
  // { limit: 80 } — the old call was getHotMarketsCarousel(80, null), which
  // passed a number as `opts` (so limit fell back to the carousel default of
  // 7) and null as `deps` (so a cache miss threw on deps.newsImpactCache).
  // That's why /challenge sat on "No active challenge" even after boot.
  const tiles = await getHotMarketsCarousel({ limit: 80 });

  const candidates = tiles.filter(function(m) {
    const p = m.yes_price != null ? Number(m.yes_price) : null;
    const vol = Number(m.volume_24h_usd || 0);
    const days = m.days_until_end;
    // Scoring is a 7-day price-move contest, not "resolves this week" —
    // the old 2–14 day window matched zero of today's hot markets (all
    // 37–307 days out). Keep markets open through the week (days >= 7)
    // and skip coin-flip extremes / dead volume.
    return (
      p != null && p >= 0.15 && p <= 0.85 &&
      vol >= 10000 &&
      days != null && days >= 7 &&
      m.event_slug && m.market_question
    );
  });

  const selected = [];
  const usedTopics = new Set();

  // First pass — one per topic
  for (const m of candidates) {
    if (selected.length >= 5) break;
    const topic = classifyTopic(m);
    if (!usedTopics.has(topic)) {
      selected.push(m);
      usedTopics.add(topic);
    }
  }

  // Second pass — fill remaining slots
  for (const m of candidates) {
    if (selected.length >= 5) break;
    if (!selected.find(function(s) { return s.event_slug === m.event_slug; })) {
      selected.push(m);
    }
  }

  return selected.slice(0, 5).map(function(m) {
    return {
      slug:             m.event_slug,
      question:         m.market_question,
      image:            m.image || null,
      topic:            classifyTopic(m),
      yes_price_at_open: Math.round((m.yes_price || 0.5) * 100),
      volume:           Math.round(Number(m.volume_24h_usd || 0)),
      closes:           m.end_date || null,
    };
  });
}

async function createWeeklyChallenge(dbQuery) {
  // Check if an active challenge already exists
  const existing = asRows(await dbQuery(
    "SELECT id FROM weekly_challenges WHERE status = 'active' AND week_end > NOW()"
  ));
  if (existing.length > 0) {
    console.log('[challenge] Active challenge already exists:', existing[0].id);
    return existing[0];
  }

  let markets;
  try {
    markets = await selectChallengeMarkets();
  } catch (err) {
    console.error('[challenge] selectChallengeMarkets failed:', err.message);
    markets = [];
  }

  if (markets.length < 3) {
    console.warn('[challenge] Not enough candidate markets:', markets.length, '— skipping creation');
    return null;
  }

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const inserted = asRows(await dbQuery(
    `INSERT INTO weekly_challenges (week_start, week_end, markets, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [now, weekEnd, JSON.stringify(markets)]
  ));

  console.log('[challenge] Created weekly challenge:', inserted[0] && inserted[0].id, 'with', markets.length, 'markets');
  return inserted[0] || null;
}

async function scoreAndResolveChallenge(dbQuery, screenerData) {
  const challenge = asRows(await dbQuery(
    "SELECT * FROM weekly_challenges WHERE status = 'active' ORDER BY week_start DESC LIMIT 1"
  ));
  if (!challenge.length) {
    console.log('[challenge] No active challenge to score');
    return null;
  }

  const ch = challenge[0];
  const markets = Array.isArray(ch.markets) ? ch.markets : JSON.parse(ch.markets || '[]');
  const picks = asRows(await dbQuery(
    'SELECT * FROM challenge_picks WHERE challenge_id = $1 AND completed = true',
    [ch.id]
  ));

  // Build a live-price map from screener cache
  const livePrices = {};
  for (const m of markets) {
    const screener = (screenerData || []).find(function(s) { return s.slug === m.slug; });
    livePrices[m.slug] = screener
      ? Math.round((screener.yes_price || 0.5) * 100)
      : m.yes_price_at_open;
  }

  for (const pick of picks) {
    let score = 0;
    const userPicks = Array.isArray(pick.picks) ? pick.picks : JSON.parse(pick.picks || '[]');
    for (const p of userPicks) {
      const market = markets.find(function(m) { return m.slug === p.slug; });
      const currentPrice = livePrices[p.slug] || (market && market.yes_price_at_open) || 50;
      const entryPrice = p.yes_price_at_pick || (market && market.yes_price_at_open) || 50;
      const priceChange = currentPrice - entryPrice;

      if (p.side === 'YES' && priceChange > 0) score += priceChange;
      else if (p.side === 'NO' && priceChange < 0) score += Math.abs(priceChange);
      // Contrarian bonus
      if (p.side === 'YES' && entryPrice <= 30 && currentPrice >= 60) score += 20;
      if (p.side === 'NO' && entryPrice >= 70 && currentPrice <= 40) score += 20;
    }
    await dbQuery('UPDATE challenge_picks SET score = $1 WHERE id = $2', [score, pick.id]);
  }

  // Assign ranks
  const ranked = asRows(await dbQuery(
    'SELECT id FROM challenge_picks WHERE challenge_id = $1 ORDER BY score DESC',
    [ch.id]
  ));
  for (let i = 0; i < ranked.length; i++) {
    await dbQuery('UPDATE challenge_picks SET rank = $1 WHERE id = $2', [i + 1, ranked[i].id]);
  }

  // Mark resolved
  await dbQuery(
    "UPDATE weekly_challenges SET status = 'resolved' WHERE id = $1",
    [ch.id]
  );

  console.log('[challenge] Resolved challenge', ch.id, 'with', picks.length, 'participants');
  return ch;
}

module.exports = { createWeeklyChallenge, scoreAndResolveChallenge, selectChallengeMarkets };
