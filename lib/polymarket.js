/**
 * HYPERFLEX Polymarket data layer — single source of truth.
 *
 * Every Polymarket data fetch in server.js should go through here. Goals:
 *
 *   1. Eliminate the half-dozen ad-hoc Gamma/CLOB fetch patterns that
 *      grew across server.js. Quirks (the Gamma `markets?event_id=`
 *      filter being unreliable, the closed-market ghost rows in event
 *      responses, etc.) get fixed in ONE place.
 *
 *   2. Make Polymarket-data bugs loudly testable. The smoke-test helpers
 *      below take known-good event slugs, fetch them through the same
 *      paths the production endpoints use, and assert structural
 *      invariants. Run on boot + reachable via /api/_smoke/polymarket.
 *
 *   3. Keep things behind one `require('./lib/polymarket')` so a future
 *      change (e.g. moving to Polymarket's data API v3) is one file
 *      diff, not 27 grep-and-replace edits.
 *
 * Initialization:
 *   const polymarket = require('./lib/polymarket');
 *   polymarket.init({ fetch: _nodeFetch });
 *
 * Public API:
 *   getEventBySlug(slug)            -> { event, eventMarkets } | null
 *   getMarketBySlug(slug)           -> market | null
 *   refreshClobBestAsk(eventMarkets)-> mutates outcomePrices in-place
 *   getOrderbook(tokenId)           -> book | null
 *   getPriceHistory(tokenId, opts)  -> history | null
 *   bookBestAsk(book)               -> number | null
 *   bookBestPrices(book)            -> { bestAsk, bestBid }
 *   smokeTest(opts)                 -> { ok, results: [...], failures: [...] }
 */

'use strict';

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB  = 'https://clob.polymarket.com';
const UA    = 'Hyperflex/1.0';
const HEAD  = { Accept: 'application/json', 'User-Agent': UA };

// 15s cache for /book best-ask. Polymarket's own UI refreshes ~5s, so
// 15s drift is acceptable and saves us hammering CLOB on every hit.
const CLOB_BOOK_TTL = 15 * 1000;
const _clobBestAskCache = new Map(); // tokenId -> { ask, ts }

let _fetch = null;

function init(opts = {}) {
  _fetch = opts.fetch || globalThis.fetch;
  if (!_fetch) throw new Error('lib/polymarket: init() requires a fetch implementation');
}

// ── INTERNAL HELPERS ───────────────────────────────────────────────────────

function _parseClobTokens(raw) {
  try {
    const tids = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(tids) ? tids : [];
  } catch (_) { return []; }
}

function _yesTokenId(market) {
  const tids = _parseClobTokens(market && market.clobTokenIds);
  return tids[0] || null;
}

// Polymarket events sometimes return resolved-version copies of recurring
// markets alongside the active versions (e.g. WTI April 2026 has 8 closed
// copies of ↑$90/↑$100/↑$105/↑$110/↓$95/↓$100/↓$110 from previous monthly
// resolutions). Polymarket's UI hides these; rendering them produces ghost
// rows showing 100%/0% next to the live ones. Always filter.
function _activeOnly(markets) {
  if (!Array.isArray(markets)) return [];
  return markets.filter(m => m && m.active !== false && !m.closed);
}

// ── ORDERBOOK HELPERS ──────────────────────────────────────────────────────

/**
 * Best ask = lowest price > 0 < 1 across asks. If no valid asks, fall
 * back to best bid (highest price > 0 < 1). Used to match what
 * polymarket.com displays as the "Buy YES" price.
 */
function bookBestPrices(book) {
  let bestAsk = null, bestBid = null;
  if (book && Array.isArray(book.asks)) {
    for (const a of book.asks) {
      const p = parseFloat(a && a.price);
      if (!isNaN(p) && p > 0 && p < 1 && (bestAsk === null || p < bestAsk)) bestAsk = p;
    }
  }
  if (book && Array.isArray(book.bids)) {
    for (const b of book.bids) {
      const p = parseFloat(b && b.price);
      if (!isNaN(p) && p > 0 && p < 1 && (bestBid === null || p > bestBid)) bestBid = p;
    }
  }
  return { bestAsk, bestBid };
}

function bookBestAsk(book) {
  const { bestAsk, bestBid } = bookBestPrices(book);
  return bestAsk !== null ? bestAsk : bestBid;
}

// ── GAMMA FETCHERS ─────────────────────────────────────────────────────────

/**
 * Fetch an event by its slug. Returns { event, eventMarkets } or null.
 * eventMarkets has CLOSED/RESOLVED markets filtered out — you almost
 * always want this. If you need the raw set, read event.markets.
 */
async function getEventBySlug(slug) {
  if (!_fetch) throw new Error('lib/polymarket: not initialized');
  const r = await _fetch(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`, { headers: HEAD })
    .catch(() => null);
  if (!r || !r.ok) return null;
  const data = await r.json().catch(() => null);
  if (!Array.isArray(data) || !data.length) return null;
  const event = data[0];
  if (!event.markets || !event.markets.length) return null;
  const active = _activeOnly(event.markets);
  // Edge case: every market in the event is closed. Fall through to the
  // raw list so the page shows SOMETHING rather than 404'ing.
  const eventMarkets = (active.length ? active : event.markets).map(m => ({
    question:        m.question,
    slug:            m.slug,
    outcomePrices:   m.outcomePrices,
    clobTokenIds:    m.clobTokenIds,
    active:          m.active,
    closed:          m.closed,
    conditionId:     m.conditionId,
    neg_risk:        m.neg_risk !== undefined ? m.neg_risk : true,
    groupItemTitle:  m.groupItemTitle || '',
    event_id:        event.id || null,
    // Previously omitted. Without these the market-detail page showed
    // 0 volume / 0 liquidity / 0 24h vol / "ends in —" for any market
    // that came in through the event path (Trump Iran binary was one
    // example reported). Client reads both `*Num` and plain variants,
    // plus endDate / description — pass them all through.
    volume:          m.volume !== undefined ? m.volume : null,
    volumeNum:       m.volumeNum !== undefined ? m.volumeNum : null,
    volume24hr:      m.volume24hr !== undefined ? m.volume24hr : (m.volume_24hr !== undefined ? m.volume_24hr : null),
    liquidity:       m.liquidity !== undefined ? m.liquidity : null,
    liquidityNum:    m.liquidityNum !== undefined ? m.liquidityNum : null,
    endDate:         m.endDate || m.end_date_iso || event.endDate || null,
    end_date_iso:    m.end_date_iso || m.endDate || null,
    description:     m.description || null,
    icon:            m.icon || m.image || null,
    image:           m.image || m.icon || null,
    resolvedBy:      m.resolvedBy || null,
  }));
  return { event, eventMarkets };
}

/**
 * Fetch a single market by slug. Returns the raw Gamma market object or null.
 */
async function getMarketBySlug(slug) {
  if (!_fetch) throw new Error('lib/polymarket: not initialized');
  const r = await _fetch(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`, { headers: HEAD })
    .catch(() => null);
  if (!r || !r.ok) return null;
  const data = await r.json().catch(() => null);
  if (!Array.isArray(data) || !data.length) return null;
  return data[0];
}

// ── CLOB FETCHERS ──────────────────────────────────────────────────────────

async function getOrderbook(tokenId) {
  if (!_fetch || !tokenId) return null;
  const r = await _fetch(`${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`, { headers: HEAD })
    .catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}

async function getPriceHistory(tokenId, { interval = 'all', fidelity = 60 } = {}) {
  if (!_fetch || !tokenId) return null;
  const url = `${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&interval=${interval}&fidelity=${fidelity}`;
  const r = await _fetch(url, { headers: HEAD }).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}

/**
 * For each market in eventMarkets, fetch its YES-token /book and replace
 * outcomePrices with `[bestAsk, 1 - bestAsk]`. Mutates in place. Markets
 * for which CLOB returns no usable price keep their existing Gamma value.
 *
 * Why best-ask, not midpoint: polymarket.com's UI displays best-ask as
 * the "Buy YES" price. Matching that means our percentages match theirs
 * to the cent.
 *
 * Caps at 25 concurrent requests per chunk (Polymarket-friendly), 5s
 * timeout per /book, caches each token's best-ask for 15s. Logs a single
 * summary line for observability.
 */
async function refreshClobBestAsk(eventMarkets) {
  if (!_fetch || !Array.isArray(eventMarkets) || eventMarkets.length === 0) return eventMarkets;
  const now = Date.now();

  const toFetch = [];
  for (let i = 0; i < eventMarkets.length; i++) {
    const tokenId = _yesTokenId(eventMarkets[i]);
    if (!tokenId) continue;

    const cached = _clobBestAskCache.get(tokenId);
    if (cached && (now - cached.ts < CLOB_BOOK_TTL) && cached.ask !== null) {
      eventMarkets[i].outcomePrices = JSON.stringify([cached.ask, 1 - cached.ask]);
      eventMarkets[i]._livePrice = true;
      continue;
    }
    toFetch.push({ idx: i, tokenId });
  }

  if (toFetch.length === 0) return eventMarkets;

  const CHUNK = 25;
  let hits = 0, misses = 0;
  for (let c = 0; c < toFetch.length; c += CHUNK) {
    const chunk = toFetch.slice(c, c + CHUNK);
    const results = await Promise.all(chunk.map(t =>
      _fetch(`${CLOB}/book?token_id=${encodeURIComponent(t.tokenId)}`, {
        headers: HEAD,
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      })
        .then(r => r.ok ? r.json() : null)
        .then(book => ({ idx: t.idx, tokenId: t.tokenId, ask: bookBestAsk(book) }))
        .catch(() => ({ idx: t.idx, tokenId: t.tokenId, ask: null }))
    ));
    for (const r of results) {
      if (r.ask === null || isNaN(r.ask) || r.ask <= 0 || r.ask >= 1) {
        misses++;
        continue;
      }
      _clobBestAskCache.set(r.tokenId, { ask: r.ask, ts: Date.now() });
      eventMarkets[r.idx].outcomePrices = JSON.stringify([r.ask, 1 - r.ask]);
      eventMarkets[r.idx]._livePrice = true;
      hits++;
    }
  }

  if (_clobBestAskCache.size > 1000) {
    for (const [k, v] of _clobBestAskCache) {
      if (now - v.ts > 5 * 60 * 1000) _clobBestAskCache.delete(k);
    }
  }
  if (eventMarkets.length > 1) {
    console.log(`[lib/polymarket] best-ask refresh: ${hits}/${eventMarkets.length} live, ${misses} kept Gamma`);
  }
  return eventMarkets;
}

// ── SMOKE TESTS ────────────────────────────────────────────────────────────
//
// Runs through the ACTUAL public functions (no mocks, no internal
// shortcuts) so a regression in any of them shows up here. Each test
// asserts a structural invariant we know the production response must
// satisfy. Failures are logged with a stable error code so Railway log
// alerts can fire on `[smoke]`.

const SMOKE_FIXTURES = [
  {
    name: 'multi-outcome event (WTI April 2026)',
    slug: 'what-price-will-wti-hit-in-april-2026',
    expect: { kind: 'event', minActiveMarkets: 5 },
  },
  // Note on adding fixtures: we deliberately keep this list short.
  // Adding too many means smoke tests become slow on boot (each costs
  // 1 Gamma + N CLOB calls). Add only fixtures that exercise a UNIQUE
  // code path or have caught a real bug. WTI exercises:
  //   - Gamma /events (vs /markets) lookup
  //   - Multi-outcome path
  //   - Active-only filter (the bug that prompted Phase 1)
  //   - CLOB best-ask refresh across many tokens
];

async function smokeTest({ verbose = false } = {}) {
  if (!_fetch) throw new Error('lib/polymarket: not initialized');
  const results = [];
  for (const fx of SMOKE_FIXTURES) {
    const t0 = Date.now();
    let res = { name: fx.name, slug: fx.slug, ok: false, ms: 0, errors: [] };
    try {
      if (fx.kind === 'event' || fx.expect.kind === 'event') {
        const got = await getEventBySlug(fx.slug);
        if (!got) {
          res.errors.push('SLUG_NOT_FOUND');
        } else {
          await refreshClobBestAsk(got.eventMarkets);

          // Invariant 1: enough active markets returned
          if (got.eventMarkets.length < (fx.expect.minActiveMarkets || 1)) {
            res.errors.push(`TOO_FEW_MARKETS: got ${got.eventMarkets.length}, expected >=${fx.expect.minActiveMarkets}`);
          }

          // Invariant 2: NO closed markets in the response (would
          // resurrect the WTI ghost-row bug)
          const ghosts = got.eventMarkets.filter(m => m.closed === true).length;
          if (ghosts > 0) {
            res.errors.push(`CLOSED_MARKETS_LEAKED: ${ghosts} markets with closed:true in response`);
          }

          // Invariant 3: at least half got live CLOB best-ask. Lower than
          // that and either CLOB is failing for us (geo, rate-limit) or
          // most outcomes are illiquid — both worth knowing.
          const live = got.eventMarkets.filter(m => m._livePrice).length;
          const liveRatio = live / got.eventMarkets.length;
          if (liveRatio < 0.5) {
            res.errors.push(`LOW_LIVE_RATIO: only ${live}/${got.eventMarkets.length} have CLOB best-ask`);
          }

          // Invariant 4: every market has parseable outcomePrices that
          // sum approximately to 1 (sanity check on JSON format)
          for (const m of got.eventMarkets) {
            let prices;
            try { prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices; } catch (_) { prices = null; }
            if (!Array.isArray(prices) || prices.length < 2) {
              res.errors.push(`BAD_PRICES: "${m.question}" has malformed outcomePrices`);
              continue;
            }
            const sum = parseFloat(prices[0]) + parseFloat(prices[1]);
            if (Math.abs(sum - 1) > 0.01) {
              res.errors.push(`PRICES_DONT_SUM: "${m.question}" => ${prices[0]} + ${prices[1]} = ${sum}`);
            }
          }

          res.ok = res.errors.length === 0;
          if (verbose) res.eventMarkets = got.eventMarkets.length;
        }
      }
    } catch (e) {
      res.errors.push(`THREW: ${e.message}`);
    }
    res.ms = Date.now() - t0;
    results.push(res);
  }
  const failures = results.filter(r => !r.ok);
  return { ok: failures.length === 0, results, failures };
}

// Logs results to console with a [smoke] prefix so Railway log filters
// can alert on it.
async function smokeTestAndLog(opts) {
  try {
    const out = await smokeTest(opts);
    if (out.ok) {
      console.log(`[smoke] polymarket OK (${out.results.length} fixtures, ${out.results.reduce((s,r)=>s+r.ms,0)}ms total)`);
    } else {
      console.error(`[smoke] polymarket FAIL — ${out.failures.length}/${out.results.length} fixtures broke:`);
      for (const f of out.failures) {
        console.error(`[smoke]   ✗ ${f.name} (${f.slug}, ${f.ms}ms): ${f.errors.join('; ')}`);
      }
    }
    return out;
  } catch (e) {
    console.error('[smoke] polymarket suite threw:', e.message);
    return { ok: false, results: [], failures: [], threw: e.message };
  }
}

module.exports = {
  init,
  getEventBySlug,
  getMarketBySlug,
  getOrderbook,
  getPriceHistory,
  refreshClobBestAsk,
  bookBestAsk,
  bookBestPrices,
  smokeTest,
  smokeTestAndLog,
};
