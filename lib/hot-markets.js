// lib/hot-markets.js
//
// Phase 1 of the Polymarket Hot Markets Carousel rescope. Supersedes the
// single-event rolling banner (lib/hero-banner.js). Surfaces the top N
// Polymarket events sorted by 24h volume with sparkline data + news
// citations per tile. Phase 2 will add the standalone market detail page
// (/market/:slug enrichment) — out of scope for this file.
//
// Spec: replaces hero-banner.js's single-event-with-countdown pattern
// with a multi-tile carousel. Pure volume sort (no day-decay penalty —
// the carousel surfaces what's hot today, not what's about to resolve).
//
// Tunable knobs via env vars. CAROUSEL_BLACKLIST is the manual escape
// hatch — comma-separated event_slugs to exclude. Accepts the legacy
// HERO_BANNER_BLACKLIST name as a fallback during the rolling-banner →
// carousel transition.

'use strict';

const polymarket = require('./polymarket');

const DEFAULT_LIMIT  = Number(process.env.CAROUSEL_LIMIT)         || 7;
const MIN_VOL_24H    = Number(process.env.CAROUSEL_MIN_VOL_24H)   || 10000; // looser than hero-banner — carousel wants breadth
const MAX_DAYS       = Number(process.env.CAROUSEL_MAX_DAYS)      || 365;
const CACHE_TTL_MS   = Number(process.env.CAROUSEL_CACHE_TTL_MS)  || 300000; // 5 min
const FETCH_POOL     = Number(process.env.CAROUSEL_FETCH_POOL)    || 200;    // gamma events fetched before ranking
const SPARKLINE_INTERVAL = '1w';
const SPARKLINE_FIDELITY = 360; // ~6h granularity for 7d window

let _cache = null;  // { value: [tile, ...], expiresAt: ms, fetchedAt: ms }

function _blacklist() {
  // Prefer CAROUSEL_BLACKLIST, fall back to HERO_BANNER_BLACKLIST during
  // the migration. Either env var works; CAROUSEL_BLACKLIST is canonical.
  const raw = process.env.CAROUSEL_BLACKLIST || process.env.HERO_BANNER_BLACKLIST || '';
  return String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function _daysUntil(endDateIso) {
  if (!endDateIso) return Infinity;
  const end = Date.parse(endDateIso);
  if (!Number.isFinite(end)) return Infinity;
  return (end - Date.now()) / 86400000;
}

function _qualifies(ev) {
  if (!ev) return false;
  if (ev.closed || ev.active === false) return false;
  const vol24h = Number(ev.volume_24hr || 0);
  if (!(vol24h > 0)) return false;
  if (vol24h < MIN_VOL_24H) return false;
  const days = _daysUntil(ev.end_date);
  if (!Number.isFinite(days) || days <= 0 || days > MAX_DAYS) return false;
  if (_blacklist().includes(String(ev.slug || '').toLowerCase())) return false;
  return true;
}

// Pick the "headline market" for an event — the highest-24h-volume market
// among its children. For binary events this is just the only market;
// for multi-outcome events this surfaces whichever option has the most
// trading happening right now.
function _headlineMarket(ev) {
  const markets = Array.isArray(ev.markets) ? ev.markets : [];
  if (!markets.length) return null;
  let best = null;
  let bestVol = -1;
  for (const m of markets) {
    if (m.closed || m.active === false) continue;
    const v = Number(m.volume_24hr || 0);
    if (v > bestVol) { best = m; bestVol = v; }
  }
  return best || markets[0];
}

// News lookup: given an event + its headline market, find up to 3 news
// items from the _newsImpactCache whose related_markets[].question
// matches (lowercased + trimmed). Falls back to event title match. Empty
// array when no news cache or no matches.
function _newsForEvent(ev, headlineMarket, newsImpactCache) {
  if (!newsImpactCache || !newsImpactCache.data || !Array.isArray(newsImpactCache.data.news_impacts)) {
    return [];
  }
  const keys = new Set();
  if (ev && ev.title) keys.add(String(ev.title).toLowerCase().trim());
  if (headlineMarket && headlineMarket.question) keys.add(String(headlineMarket.question).toLowerCase().trim());
  if (!keys.size) return [];

  const hits = [];
  for (const ni of newsImpactCache.data.news_impacts) {
    if (!Array.isArray(ni.related_markets)) continue;
    const matched = ni.related_markets.some(rm => {
      const q = (rm.question || '').toLowerCase().trim();
      return q && keys.has(q);
    });
    if (matched) {
      hits.push({
        headline:  ni.headline  || '',
        source:    ni.source    || '',
        sentiment: ni.sentiment || 'neutral',
      });
      if (hits.length >= 3) break;
    }
  }
  return hits;
}

// Fetch /prices-history for the YES token. Returns a sparkline array
// (numeric prices, oldest → newest) plus the 7d delta vs the latest
// price. Returns null when the lookup fails — caller renders the tile
// without a sparkline rather than blocking.
async function _sparkline(yesTokenId) {
  if (!yesTokenId) return null;
  try {
    const data = await polymarket.getPriceHistory(yesTokenId, {
      interval:  SPARKLINE_INTERVAL,
      fidelity:  SPARKLINE_FIDELITY,
    });
    if (!data || !Array.isArray(data.history) || !data.history.length) return null;
    const points = data.history
      .map(pt => Number(pt.p))
      .filter(p => Number.isFinite(p) && p >= 0 && p <= 1);
    if (points.length < 2) return null;
    const first = points[0];
    const last  = points[points.length - 1];
    const change_7d = last - first;
    return { points, change_7d };
  } catch {
    return null;
  }
}

function _formatVol(v) {
  if (!Number.isFinite(v) || v <= 0) return '$0';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
  return '$' + Math.round(v);
}

async function _buildTile(ev, newsImpactCache) {
  const headlineMarket = _headlineMarket(ev);
  const yesPrice = headlineMarket && headlineMarket.yes_price != null ? Number(headlineMarket.yes_price) : null;
  const noPrice  = headlineMarket && headlineMarket.no_price  != null ? Number(headlineMarket.no_price)  : null;
  const tokenId  = headlineMarket && Array.isArray(headlineMarket.clob_token_ids) ? headlineMarket.clob_token_ids[0] : null;

  // Sparkline fetched in parallel with news lookup (news is sync from cache).
  const [spark, news] = await Promise.all([
    _sparkline(tokenId),
    Promise.resolve(_newsForEvent(ev, headlineMarket, newsImpactCache)),
  ]);

  const vol24h = Number(ev.volume_24hr || 0);
  const volTot = Number(ev.volume || 0);
  const days   = _daysUntil(ev.end_date);

  return {
    event_slug:        String(ev.slug || ''),
    event_title:       ev.title || '',
    image:             ev.image || null,
    event_image_url:   ev.image || null,
    category:          ev.category || (Array.isArray(ev.tags) && ev.tags[0]) || null,
    end_date:          ev.end_date || null,
    days_until_end:    Number.isFinite(days) ? Math.max(0, Math.floor(days)) : null,
    condition_id:      headlineMarket ? headlineMarket.condition_id : null,
    market_question:   headlineMarket ? headlineMarket.question : ev.title || '',
    yes_price:         yesPrice,
    no_price:          noPrice,
    sparkline_7d:      spark ? spark.points : null,
    yes_price_change_7d: spark ? spark.change_7d : null,
    volume_24h_usd:    Math.round(vol24h),
    volume_total_usd:  Math.round(volTot),
    volume_24h_label:  _formatVol(vol24h),
    news_citations:    news,
    cta_href:          '/market/' + String(ev.slug || ''),
  };
}

async function _selectFresh(limit, newsImpactCache) {
  const nowIso = new Date().toISOString();
  const maxIso = new Date(Date.now() + MAX_DAYS * 86400000).toISOString();
  let events;
  try {
    events = await polymarket.fetchPolymarketEvents({
      active:       true,
      end_date_min: nowIso,
      end_date_max: maxIso,
      limit:        FETCH_POOL,
    });
  } catch (e) {
    console.warn('[hot-markets] fetchPolymarketEvents failed:', e.message);
    return [];
  }
  if (!Array.isArray(events) || !events.length) return [];

  const ranked = events
    .filter(_qualifies)
    .sort((a, b) => {
      const va = Number(a.volume_24hr || 0);
      const vb = Number(b.volume_24hr || 0);
      if (vb !== va) return vb - va;
      // Tie-break: stable by event id for determinism.
      return String(a.id || '').localeCompare(String(b.id || ''));
    })
    .slice(0, limit);

  if (!ranked.length) return [];

  // Build tiles in parallel — each tile's sparkline is a separate CLOB
  // call, so parallel cuts wall time from N×latency to ~max(latency).
  const tiles = await Promise.all(ranked.map(ev => _buildTile(ev, newsImpactCache)));
  // Filter out any that completely failed to produce a market (no
  // headline market at all). Rare but possible if the event has zero
  // active markets.
  return tiles.filter(t => t.market_question);
}

async function getHotMarketsCarousel(opts = {}, deps = {}) {
  const limit = Math.max(1, Math.min(20, Number(opts.limit) || DEFAULT_LIMIT));
  const now = Date.now();

  if (_cache && _cache.expiresAt > now && _cache.value && _cache.limit >= limit) {
    return _cache.value.slice(0, limit);
  }

  const fresh = await _selectFresh(limit, deps.newsImpactCache || null);
  _cache = { value: fresh, expiresAt: now + CACHE_TTL_MS, fetchedAt: now, limit };
  return fresh;
}

function bustCache() {
  _cache = null;
}

function getCachedSnapshot() {
  if (!_cache) return null;
  return {
    value:     _cache.value,
    expiresAt: _cache.expiresAt,
    fetchedAt: _cache.fetchedAt,
    age_ms:    Date.now() - _cache.fetchedAt,
    count:     _cache.value ? _cache.value.length : 0,
  };
}

// Resolution-check hook for the 1-min cron in server.js. If ANY of the
// currently-cached tiles correspond to events that have resolved, we
// bust the whole cache and re-rank on the next request. Simpler than
// per-tile invalidation and fine for a 7-tile carousel.
async function checkCachedEventsResolved() {
  if (!_cache || !_cache.value || !_cache.value.length) return false;
  const slugs = _cache.value.map(t => t.event_slug).filter(Boolean);
  if (!slugs.length) return false;

  for (const slug of slugs) {
    try {
      const ev = await polymarket.getEventBySlug(slug);
      if (!ev || ev.closed || ev.active === false) {
        bustCache();
        console.log('[hot-markets] cached event slug=' + slug + ' resolved/missing — busted carousel cache');
        return true;
      }
      const days = _daysUntil(ev.end_date);
      if (!Number.isFinite(days) || days <= 0) {
        bustCache();
        console.log('[hot-markets] cached event slug=' + slug + ' end_date passed — busted carousel cache');
        return true;
      }
    } catch (e) {
      // Network blip on one slug — keep the cache, try next tick.
      continue;
    }
  }
  return false;
}

module.exports = {
  getHotMarketsCarousel,
  bustCache,
  getCachedSnapshot,
  checkCachedEventsResolved,
  _config: { DEFAULT_LIMIT, MIN_VOL_24H, MAX_DAYS, CACHE_TTL_MS, FETCH_POOL, SPARKLINE_INTERVAL, SPARKLINE_FIDELITY },
  _internals: { _qualifies, _headlineMarket, _newsForEvent, _sparkline, _buildTile, _selectFresh, _daysUntil, _formatVol },
};
