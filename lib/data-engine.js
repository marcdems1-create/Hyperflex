/**
 * HYPERFLEX DATA ENGINE — Phase 1: Unified Market Data Pipeline
 *
 * Normalizes data from Polymarket, Kalshi, and sports books into a single schema.
 * Persists snapshots for historical analysis. Matches cross-platform events.
 * Exposes clean data for the intelligence layer + external API.
 *
 * Usage: const engine = require('./lib/data-engine'); engine.init(pool, fetch);
 */

'use strict';

// ── UNIFIED MARKET SCHEMA ────────────────────────────────────────────────
// Every market from every source gets normalized to this shape before
// it enters any cache, DB, or API response.

/**
 * @typedef {Object} NormalizedMarket
 * @property {string} hfx_id          - Stable Hyperflex ID: "{source}:{source_id}"
 * @property {string} source          - "polymarket" | "kalshi" | "sportsbook"
 * @property {string} source_id       - Original platform ID / slug / ticker
 * @property {string} title           - Human-readable market question
 * @property {string} description     - Longer description if available
 * @property {string} category        - politics | sports | crypto | tech | entertainment | science | other
 * @property {string} status          - "active" | "resolved" | "cancelled" | "expired"
 * @property {string|null} resolution - Resolved outcome if status=resolved
 * @property {string|null} end_date   - ISO8601 expiration/close date
 * @property {Outcome[]} outcomes     - Array of possible outcomes with prices
 * @property {number} volume_24h      - USD volume in last 24h
 * @property {number} volume_total    - Total lifetime volume
 * @property {number} liquidity       - Available depth estimate (USD)
 * @property {string} url             - Direct link to the market on source platform
 * @property {string} updated_at      - ISO8601 last data refresh
 * @property {Object|null} _raw       - Original source data (stripped from API responses)
 */

/**
 * @typedef {Object} Outcome
 * @property {string} name   - "Yes" | "No" | team name | candidate name etc
 * @property {number} price  - Normalized 0-1 (probability)
 * @property {number|null} volume - Volume on this outcome if available
 */

/**
 * @typedef {Object} CrossReference
 * @property {string} hfx_id_a       - First market
 * @property {string} hfx_id_b       - Second market
 * @property {number} confidence     - Match confidence 0-1
 * @property {number} spread         - Current price difference (absolute)
 * @property {string} matched_at     - ISO8601 when match was detected
 */

// ── MODULE STATE ─────────────────────────────────────────────────────────
let _pool = null;           // pg Pool
let _fetch = null;          // node-fetch
let _supabase = null;       // optional supabase client

// In-memory normalized market cache (all platforms merged)
let _marketCache = { ts: 0, markets: [], byId: new Map() };
const CACHE_TTL = 90 * 1000; // 90 seconds

// Cross-reference cache
let _crossRefCache = { ts: 0, refs: [] };
const CROSSREF_TTL = 5 * 60 * 1000; // 5 minutes

// ── INIT ─────────────────────────────────────────────────────────────────
function init({ pool, fetch, supabase }) {
  _pool = pool;
  _fetch = fetch;
  _supabase = supabase || null;
  console.log('[data-engine] Initialized');
}

// ── CATEGORY DETECTION ───────────────────────────────────────────────────
function detectCategory(text) {
  const t = (text || '').toLowerCase();
  if (/bitcoin|btc|eth(?:ereum)?|crypto|solana|sol\b|xrp|doge|token|defi|nft|blockchain/i.test(t)) return 'crypto';
  if (/nba|nfl|mlb|nhl|soccer|football|basketball|baseball|ufc|boxing|sport|game\b|match|playoff|super bowl|world cup|championship|league|team\b|player|coach|season\b|finals|series|mvp|draft|trade\b|free agent/i.test(t)) return 'sports';
  if (/trump|biden|president|congress|senate|election|democrat|republican|politic|governor|vote\b|primary|gop|dnc|rnc|impeach|cabinet|supreme court|parliament|prime minister/i.test(t)) return 'politics';
  if (/movie|oscar|grammy|emmy|album|netflix|spotify|tiktok|youtube|celebrity|award|film|tv\b|show\b|music|concert|tour|streaming|actor|singer|rapper/i.test(t)) return 'entertainment';
  if (/\bai\b|openai|chatgpt|apple|google|microsoft|meta\b|tesla|nvidia|amazon|startup|tech|iphone|android|semiconductor|chip/i.test(t)) return 'tech';
  if (/climate|vaccine|virus|pandemic|fda|health|medicine|drug\b|trial|study|research|science|space|nasa|spacex/i.test(t)) return 'science';
  return 'other';
}

// ── POLYMARKET INGESTION ─────────────────────────────────────────────────
async function fetchPolymarketMarkets() {
  if (!_fetch) throw new Error('data-engine not initialized');
  const fetch = _fetch;

  // Fetch top markets from Gamma API (same source as existing screener)
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  const res = await fetch('https://gamma-api.polymarket.com/markets/keyset?closed=false&limit=200&order=volume&ascending=false', {
    signal: ctrl.signal,
    headers: { Accept: 'application/json', 'User-Agent': 'Hyperflex/2.0' }
  });
  clearTimeout(tid);
  if (!res.ok) throw new Error(`Gamma API ${res.status}`);
  const raw = await res.json();

  return (raw || []).map(m => {
    const yesPrice = parseFloat(m.outcomePrices ? JSON.parse(m.outcomePrices)[0] : m.bestAsk || 0.5);
    const noPrice = 1 - yesPrice;
    const vol = parseFloat(m.volume || m.volumeNum || 0);
    const vol24 = parseFloat(m.volume24hr || 0);
    const slug = m.slug || m.conditionId || m.id || '';

    return {
      hfx_id: `polymarket:${slug}`,
      source: 'polymarket',
      source_id: slug,
      title: m.question || m.title || '',
      description: m.description || '',
      category: detectCategory(m.question || m.title || ''),
      status: m.closed ? 'resolved' : (m.active === false ? 'expired' : 'active'),
      resolution: m.resolutionSource || null,
      end_date: m.endDate || m.endDateIso || null,
      outcomes: [
        { name: 'Yes', price: round4(yesPrice), volume: null },
        { name: 'No', price: round4(noPrice), volume: null }
      ],
      volume_24h: vol24,
      volume_total: vol,
      liquidity: parseFloat(m.liquidityNum || m.liquidity || 0),
      url: m.slug ? `https://polymarket.com/event/${m.slug}` : 'https://polymarket.com',
      updated_at: new Date().toISOString(),
      _raw: m
    };
  }).filter(m => m.title && m.outcomes[0].price > 0.01 && m.outcomes[0].price < 0.99);
}

// ── KALSHI INGESTION ─────────────────────────────────────────────────────
async function fetchKalshiMarkets() {
  if (!_fetch) throw new Error('data-engine not initialized');
  const fetch = _fetch;

  // Fetch active events with their markets
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  const res = await fetch('https://api.elections.kalshi.com/trade-api/v2/events?limit=100&status=open', {
    signal: ctrl.signal,
    headers: { Accept: 'application/json', 'User-Agent': 'Hyperflex/2.0' }
  });
  clearTimeout(tid);
  if (!res.ok) throw new Error(`Kalshi API ${res.status}`);
  const data = await res.json();

  const markets = [];
  for (const evt of (data.events || [])) {
    const mkts = (evt.markets || []).filter(m => m.status === 'open' || m.status === 'active');
    for (const m of mkts) {
      const yesAsk = m.yes_ask != null ? m.yes_ask / 100 :
                     m.yes_ask_dollars != null ? parseFloat(m.yes_ask_dollars) :
                     m.last_price != null ? m.last_price / 100 :
                     m.last_price_dollars != null ? parseFloat(m.last_price_dollars) : null;
      if (yesAsk == null || yesAsk >= 0.99 || yesAsk <= 0.01) continue;

      const ticker = m.ticker || m.event_ticker || '';
      markets.push({
        hfx_id: `kalshi:${ticker}`,
        source: 'kalshi',
        source_id: ticker,
        title: evt.title || m.title || m.subtitle || '',
        description: evt.description || m.description || '',
        category: detectCategory(evt.title || m.title || ''),
        status: 'active',
        resolution: null,
        end_date: m.close_time || m.expiration_time || evt.close_time || null,
        outcomes: [
          { name: 'Yes', price: round4(yesAsk), volume: null },
          { name: 'No', price: round4(1 - yesAsk), volume: null }
        ],
        volume_24h: parseFloat(m.volume_24h || 0),
        volume_total: parseFloat(m.volume || 0),
        liquidity: parseFloat(m.open_interest || 0),
        url: `https://kalshi.com/markets/${(evt.event_ticker || ticker).toLowerCase()}`,
        updated_at: new Date().toISOString(),
        _raw: { event: evt, market: m }
      });
    }
  }
  return markets;
}

// ── SPORTSBOOK INGESTION ─────────────────────────────────────────────────
async function fetchSportsbookMarkets() {
  if (!_fetch) throw new Error('data-engine not initialized');
  const fetch = _fetch;
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_API_KEY) return []; // graceful skip if no key

  // Fetch active sports
  const sportsRes = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`, {
    headers: { Accept: 'application/json' }
  });
  if (!sportsRes.ok) throw new Error(`Odds API sports ${sportsRes.status}`);
  const sports = await sportsRes.json();

  // Pick top active sports (limit API calls)
  const activeSports = (sports || [])
    .filter(s => !s.has_outrights && s.active)
    .slice(0, 6)
    .map(s => s.key);

  const markets = [];
  for (const sportKey of activeSports) {
    try {
      const oddsRes = await fetch(
        `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=decimal&dateFormat=iso`,
        { headers: { Accept: 'application/json' } }
      );
      if (!oddsRes.ok) continue;
      const events = await oddsRes.json();

      for (const evt of (events || [])) {
        // Find best available odds across bookmakers
        const bookmaker = (evt.bookmakers || [])[0]; // First bookmaker as primary
        if (!bookmaker) continue;
        const h2hMarket = (bookmaker.markets || []).find(m => m.key === 'h2h');
        if (!h2hMarket) continue;

        const outcomes = (h2hMarket.outcomes || []).map(o => {
          // Convert decimal odds to implied probability
          const impliedProb = o.price > 0 ? 1 / o.price : 0;
          return { name: o.name, price: round4(impliedProb), volume: null };
        });

        // Normalize probabilities to sum to 1 (remove vig)
        const totalProb = outcomes.reduce((s, o) => s + o.price, 0);
        if (totalProb > 0) {
          outcomes.forEach(o => { o.price = round4(o.price / totalProb); });
        }

        const eventId = evt.id || `${evt.home_team}-${evt.away_team}-${evt.commence_time}`;
        markets.push({
          hfx_id: `sportsbook:${eventId}`,
          source: 'sportsbook',
          source_id: eventId,
          title: `${evt.away_team} vs ${evt.home_team}`,
          description: `${evt.sport_title} — ${new Date(evt.commence_time).toLocaleDateString()}`,
          category: 'sports',
          status: 'active',
          resolution: null,
          end_date: evt.commence_time || null,
          outcomes,
          volume_24h: 0, // Not available from Odds API
          volume_total: 0,
          liquidity: 0,
          url: '', // No direct link
          updated_at: new Date().toISOString(),
          _raw: evt
        });
      }
    } catch (e) {
      console.warn(`[data-engine] sports ${sportKey} fetch failed:`, e.message);
    }
  }
  return markets;
}

// ── CROSS-MARKET MATCHING ENGINE ─────────────────────────────────────────
// Finds the same event across different platforms using text similarity.
// Much more robust than the old word-overlap approach.

function tokenize(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    // Remove common stop words
    .filter(w => !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  'the', 'will', 'this', 'that', 'what', 'when', 'how', 'who', 'which',
  'does', 'before', 'after', 'above', 'below', 'between', 'from', 'into',
  'than', 'then', 'there', 'here', 'with', 'for', 'and', 'but', 'not',
  'any', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'only', 'own', 'same', 'also', 'can', 'would', 'could',
  'should', 'may', 'might', 'shall', 'has', 'have', 'had', 'are', 'was',
  'were', 'been', 'being', 'about', 'over', 'under', 'again', 'year',
  'end', 'next', 'market', 'price'
]);

function jaccardSimilarity(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

// Named entity extraction — pull out proper nouns, numbers, dates
function extractEntities(text) {
  const entities = [];
  const t = text || '';
  // Dollar amounts
  const dollars = t.match(/\$[\d,.]+[BMK]?/gi);
  if (dollars) entities.push(...dollars.map(d => d.toLowerCase()));
  // Percentages
  const pcts = t.match(/\d+(?:\.\d+)?%/g);
  if (pcts) entities.push(...pcts);
  // Specific numbers that matter (like years, thresholds)
  const years = t.match(/\b20[2-3]\d\b/g);
  if (years) entities.push(...years);
  // Capitalized proper nouns (crude but effective)
  const properNouns = t.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g);
  if (properNouns) entities.push(...properNouns.map(n => n.toLowerCase()));
  return entities;
}

function matchMarkets(marketsA, marketsB, minConfidence = 0.35) {
  const matches = [];
  const usedB = new Set();

  for (const a of marketsA) {
    const tokA = tokenize(a.title);
    const entA = extractEntities(a.title);
    if (tokA.length < 2) continue;

    let bestMatch = null;
    let bestScore = 0;

    for (let bi = 0; bi < marketsB.length; bi++) {
      if (usedB.has(bi)) continue;
      const b = marketsB[bi];

      // Category mismatch = heavy penalty (but don't exclude — cross-category arbs exist)
      const catPenalty = (a.category === b.category) ? 0 : 0.15;

      const tokB = tokenize(b.title);
      const entB = extractEntities(b.title);

      // Jaccard on tokens
      const tokenSim = jaccardSimilarity(tokA, tokB);

      // Entity overlap bonus — if same proper nouns / numbers appear, much more likely same event
      const entityOverlap = entA.length > 0 && entB.length > 0
        ? entA.filter(e => entB.includes(e)).length / Math.max(entA.length, entB.length)
        : 0;

      // Combined score: token similarity + entity bonus - category penalty
      const score = (tokenSim * 0.6) + (entityOverlap * 0.4) - catPenalty;

      if (score > bestScore && score >= minConfidence) {
        bestScore = score;
        bestMatch = bi;
      }
    }

    if (bestMatch !== null) {
      const b = marketsB[bestMatch];
      const priceA = a.outcomes[0]?.price || 0.5;
      const priceB = b.outcomes[0]?.price || 0.5;
      const spread = Math.abs(priceA - priceB);

      matches.push({
        hfx_id_a: a.hfx_id,
        hfx_id_b: b.hfx_id,
        title_a: a.title,
        title_b: b.title,
        source_a: a.source,
        source_b: b.source,
        price_a: priceA,
        price_b: priceB,
        spread: round4(spread),
        spread_pct: Math.round(spread * 100),
        confidence: round4(bestScore),
        buy_on: priceA < priceB ? a.source : b.source,
        sell_on: priceA < priceB ? b.source : a.source,
        arb_roi: Math.min(priceA, priceB) > 0
          ? Math.round(((Math.max(priceA, priceB) - Math.min(priceA, priceB)) / Math.min(priceA, priceB)) * 100)
          : 0,
        category: a.category,
        matched_at: new Date().toISOString()
      });
      usedB.add(bestMatch);
    }
  }

  return matches.sort((a, b) => b.spread - a.spread);
}

// ── FULL PIPELINE: INGEST → NORMALIZE → MATCH → CACHE ───────────────────

async function refreshAll() {
  const t0 = Date.now();
  const errors = [];

  // Fetch from all sources in parallel
  const [polyResult, kalshiResult, sportsResult] = await Promise.allSettled([
    fetchPolymarketMarkets(),
    fetchKalshiMarkets(),
    fetchSportsbookMarkets()
  ]);

  const polyMarkets = polyResult.status === 'fulfilled' ? polyResult.value : (errors.push('polymarket: ' + polyResult.reason?.message), []);
  const kalshiMarkets = kalshiResult.status === 'fulfilled' ? kalshiResult.value : (errors.push('kalshi: ' + kalshiResult.reason?.message), []);
  const sportsMarkets = sportsResult.status === 'fulfilled' ? sportsResult.value : (errors.push('sportsbook: ' + sportsResult.reason?.message), []);

  // Merge all into one list
  const allMarkets = [...polyMarkets, ...kalshiMarkets, ...sportsMarkets];
  const byId = new Map();
  for (const m of allMarkets) byId.set(m.hfx_id, m);

  // Update cache
  _marketCache = { ts: Date.now(), markets: allMarkets, byId };

  // Cross-market matching
  const crossRefs = [];
  if (polyMarkets.length > 0 && kalshiMarkets.length > 0) {
    crossRefs.push(...matchMarkets(polyMarkets, kalshiMarkets, 0.30));
  }
  if (polyMarkets.length > 0 && sportsMarkets.length > 0) {
    crossRefs.push(...matchMarkets(polyMarkets, sportsMarkets, 0.30));
  }
  if (kalshiMarkets.length > 0 && sportsMarkets.length > 0) {
    crossRefs.push(...matchMarkets(kalshiMarkets, sportsMarkets, 0.30));
  }
  _crossRefCache = { ts: Date.now(), refs: crossRefs };

  // Persist snapshots to DB (fire-and-forget)
  persistSnapshots(allMarkets).catch(e => console.warn('[data-engine] snapshot persist failed:', e.message));

  const elapsed = Date.now() - t0;
  console.log(`[data-engine] Refresh: ${polyMarkets.length} poly + ${kalshiMarkets.length} kalshi + ${sportsMarkets.length} sports = ${allMarkets.length} markets, ${crossRefs.length} cross-refs (${elapsed}ms)${errors.length ? ' ERRORS: ' + errors.join('; ') : ''}`);

  return { markets: allMarkets, crossRefs, errors, elapsed };
}

// ── PERSISTENCE: SNAPSHOT MARKET PRICES TO DB ────────────────────────────

async function persistSnapshots(markets) {
  if (!_pool) return;

  // Batch insert: market_id, source, yes_price, volume, snapshot_at
  const now = new Date().toISOString();
  const values = [];
  const params = [];
  let idx = 1;

  for (const m of markets) {
    if (m.status !== 'active') continue;
    const yesPrice = m.outcomes[0]?.price;
    if (yesPrice == null) continue;
    values.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5})`);
    params.push(m.hfx_id, m.source, m.title, yesPrice, m.volume_total, now);
    idx += 6;
    if (values.length >= 100) break; // Cap batch size
  }

  if (values.length === 0) return;

  try {
    await _pool.query(`
      INSERT INTO normalized_snapshots (hfx_id, source, title, yes_price, volume, snapshot_at)
      VALUES ${values.join(', ')}
    `, params);
  } catch (e) {
    // Table might not exist yet — that's okay, we'll create it via migration
    if (e.code === '42P01') {
      console.log('[data-engine] normalized_snapshots table not found — run migration');
    } else {
      throw e;
    }
  }
}

// ── QUERY INTERFACE ──────────────────────────────────────────────────────

async function getMarkets(opts = {}) {
  // Refresh if stale
  if (Date.now() - _marketCache.ts > CACHE_TTL) {
    await refreshAll();
  }

  let markets = _marketCache.markets;

  // Filter by source
  if (opts.source) {
    markets = markets.filter(m => m.source === opts.source);
  }
  // Filter by category
  if (opts.category) {
    markets = markets.filter(m => m.category === opts.category);
  }
  // Filter by status
  if (opts.status) {
    markets = markets.filter(m => m.status === opts.status);
  }
  // Search by title
  if (opts.search) {
    const q = opts.search.toLowerCase();
    markets = markets.filter(m => m.title.toLowerCase().includes(q));
  }
  // Sort
  const sortField = opts.sort || 'volume_total';
  const sortDir = opts.order === 'asc' ? 1 : -1;
  markets.sort((a, b) => ((b[sortField] || 0) - (a[sortField] || 0)) * sortDir);

  // Pagination
  const limit = Math.min(parseInt(opts.limit) || 50, 200);
  const offset = parseInt(opts.offset) || 0;

  // Strip _raw from API responses
  const cleaned = markets.slice(offset, offset + limit).map(stripRaw);

  return {
    markets: cleaned,
    total: markets.length,
    sources: {
      polymarket: _marketCache.markets.filter(m => m.source === 'polymarket').length,
      kalshi: _marketCache.markets.filter(m => m.source === 'kalshi').length,
      sportsbook: _marketCache.markets.filter(m => m.source === 'sportsbook').length
    },
    updated_at: new Date(_marketCache.ts).toISOString()
  };
}

function getMarketById(hfxId) {
  const m = _marketCache.byId.get(hfxId);
  return m ? stripRaw(m) : null;
}

async function getCrossRefs(opts = {}) {
  // Refresh if stale
  if (Date.now() - _crossRefCache.ts > CROSSREF_TTL) {
    await refreshAll();
  }

  let refs = _crossRefCache.refs;

  // Filter: only arb opportunities (spread > threshold)
  const minSpread = parseFloat(opts.min_spread) || 0;
  if (minSpread > 0) {
    refs = refs.filter(r => r.spread >= minSpread);
  }

  // Filter by category
  if (opts.category) {
    refs = refs.filter(r => r.category === opts.category);
  }

  // Filter by source pair
  if (opts.source) {
    refs = refs.filter(r => r.source_a === opts.source || r.source_b === opts.source);
  }

  const limit = Math.min(parseInt(opts.limit) || 50, 200);

  return {
    opportunities: refs.slice(0, limit),
    total: refs.length,
    avg_spread: refs.length > 0 ? round4(refs.reduce((s, r) => s + r.spread, 0) / refs.length) : 0,
    updated_at: new Date(_crossRefCache.ts).toISOString()
  };
}

async function getPriceHistory(hfxId, hours = 24) {
  if (!_pool) return { prices: [], hfx_id: hfxId };

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  try {
    const result = await _pool.query(
      'SELECT yes_price, volume, snapshot_at FROM normalized_snapshots WHERE hfx_id = $1 AND snapshot_at >= $2 ORDER BY snapshot_at ASC',
      [hfxId, since]
    );
    return {
      hfx_id: hfxId,
      prices: (result.rows || []).map(r => ({
        price: parseFloat(r.yes_price),
        volume: parseFloat(r.volume || 0),
        ts: r.snapshot_at
      })),
      period_hours: hours
    };
  } catch (e) {
    return { prices: [], hfx_id: hfxId, error: e.message };
  }
}

// ── STATS ────────────────────────────────────────────────────────────────

function getStats() {
  const markets = _marketCache.markets;
  const active = markets.filter(m => m.status === 'active');
  return {
    total_markets: markets.length,
    active_markets: active.length,
    by_source: {
      polymarket: markets.filter(m => m.source === 'polymarket').length,
      kalshi: markets.filter(m => m.source === 'kalshi').length,
      sportsbook: markets.filter(m => m.source === 'sportsbook').length
    },
    by_category: active.reduce((acc, m) => { acc[m.category] = (acc[m.category] || 0) + 1; return acc; }, {}),
    cross_refs: _crossRefCache.refs.length,
    arb_opportunities: _crossRefCache.refs.filter(r => r.spread >= 0.02).length,
    cache_age_ms: Date.now() - _marketCache.ts,
    updated_at: _marketCache.ts > 0 ? new Date(_marketCache.ts).toISOString() : null
  };
}

// ── HELPERS ──────────────────────────────────────────────────────────────

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function stripRaw(market) {
  const { _raw, ...clean } = market;
  return clean;
}

// ── EXPORTS ──────────────────────────────────────────────────────────────
module.exports = {
  init,
  refreshAll,
  getMarkets,
  getMarketById,
  getCrossRefs,
  getPriceHistory,
  getStats,
  // Expose individual fetchers for testing
  fetchPolymarketMarkets,
  fetchKalshiMarkets,
  fetchSportsbookMarkets,
  matchMarkets,
  detectCategory
};
