// lib/mentions-heatmap.js
//
// /mentions heat-map sourcing + endpoint orchestrator.
//
// Sourcing: Gamma API top markets by 24h volume, enriched with whale and edge
// data from the screener cache, ranked by viral engagement scoring.
// Word-betting markets (Fed speech slug-probe) kept as a supplemental source.

'use strict';

const wordMarkets = require('./word-markets');

const CACHE_TTL_MS = 2 * 60 * 1000;  // 2-min cache; invalidated on large trades

const CODE_VERSION = '2026-05-29-editorial-exclusion-v2';

// Injected by server.js after boot
let _getScreenerCache = () => null;
let _getWhaleCache    = () => null;

// Editorial scope filter (PR #170). /mentions is mention-betting on
// political/macro figures — not pop-culture meme markets. The future-event
// discovery pass can surface GTA VI / Jesus-return / new-album tiles when
// their slug contains a speaker watchlist word.
const EXCLUDED_SLUG_PATTERN = /gta-vi|gta\s*6|jesus.*return|new-(rihanna|playboi-carti|drake|kendrick)/i;
function _passesEditorialFilter(c) {
  const haystack = (c.eventSlug || '') + ' ' + (c.polymarket_slug || '') + ' ' + (c.question || '');
  return !EXCLUDED_SLUG_PATTERN.test(haystack);
}

function init(opts) {
  if (opts.getScreenerCache) _getScreenerCache = opts.getScreenerCache;
  if (opts.getWhaleCache)    _getWhaleCache    = opts.getWhaleCache;
}

// Hard kill switches + viral engagement score
// Returns 0 if market should be skipped, otherwise a positive score
function _scoreMarket(m) {
  const price    = Math.max(0.01, Math.min(0.99, m.yes_price || 0.5));
  const vol24h   = Number(m.volume_24h)  || 0;
  const volTotal = Number(m.volume_total || m.volume) || 0;

  // Hard kill switches
  if (m.closed || m.resolved)      return 0;
  if (volTotal < 25000)            return 0;
  if (vol24h   < 200)              return 0;
  if (price < 0.02 || price > 0.98) return 0;

  // Controversy: peaks at 50¢
  const controversy = 1 - Math.abs(price - 0.5) * 2;

  // Momentum: what fraction of total volume hit in last 24h
  const momentum = vol24h / Math.max(volTotal, 1);

  // Viral: high momentum + controversy = people actively betting on uncertain outcome
  const viralScore = vol24h * (0.5 + controversy) * (1 + momentum * 3);

  // Whale and edge boosts
  const whaleBoost = (m._whaleCount || 0) > 0 ? 1.5 : 1;
  const edgeBoost  = (m._edgeScore  || 0) > 5 ? 1 + ((m._edgeScore - 5) * 0.15) : 1;

  // Recent large trade boost (2x)
  const liveBoost = m._recentLargeTrade ? 2 : 1;

  return viralScore * whaleBoost * edgeBoost * liveBoost;
}

// Build whale count and edge score maps from caches
function _buildEnrichmentMaps() {
  const whaleCounts = new Map();  // slug -> count
  const edgeScores  = new Map();  // slug -> score

  const screenerData = (() => {
    const c = _getScreenerCache();
    return (c && Array.isArray(c.data)) ? c.data : (Array.isArray(c) ? c : []);
  })();

  for (const m of screenerData) {
    const slug = m.slug || m.market_slug;
    if (slug && m.edge_score) edgeScores.set(slug, m.edge_score);
  }

  const whaleCache = _getWhaleCache();
  const whales = (whaleCache && whaleCache.data && Array.isArray(whaleCache.data.whales))
    ? whaleCache.data.whales : [];
  for (const whale of whales) {
    for (const pos of (whale.positions || [])) {
      if ((pos.size || 0) < 5000) continue;
      const slug = pos.slug || pos.market_slug;
      if (slug) whaleCounts.set(slug, (whaleCounts.get(slug) || 0) + 1);
    }
  }

  return { whaleCounts, edgeScores };
}

// Normalise a Gamma market object into our canonical shape
function _normGamma(g) {
  let price = null;
  try {
    const op = g.outcomePrices;
    const arr = typeof op === 'string' ? JSON.parse(op) : op;
    if (Array.isArray(arr) && arr.length > 0) price = Number(arr[0]);
  } catch (_) {}
  if (price == null && g.bestBid != null) price = Number(g.bestBid);

  const vol24h   = Number(g.volume_24h || g.volumeNum24hr || 0);
  const volTotal = Number(g.volume || g.volumeNum || 0);

  return {
    polymarket_slug: g.slug || '',
    question:        g.question || '',
    yes_price:       price,
    volume_24h:      vol24h,
    volume_total:    volTotal,
    image:           g.image || null,
    eventSlug:       g.eventSlug || g.event_slug || '',
    closed:          g.closed   || false,
    resolved:        g.resolved || false,
    active:          g.active,
    end_date:        g.endDate  || g.end_date || null,
  };
}

// Derive type label from enrichment flags
function _deriveType(m) {
  if (m._recentLargeTrade) return 'live';
  if (m._whaleCount > 0)   return 'whale';
  if (m._edgeScore  > 5)   return 'edge';
  return 'hot';
}

function _bucketIntoTiers(sorted) {
  const n = sorted.length;
  if (n === 0) return { jumbo: [], large: [], medium: [], small: [] };

  const jumboCount  = Math.min(4,  Math.max(1, Math.ceil(n * 0.05)));
  const largeCount  = Math.min(10, Math.ceil(n * 0.15));
  const mediumCount = Math.ceil(n * 0.30);

  let i = 0;
  const jumbo  = sorted.slice(i, i + jumboCount);  i += jumboCount;
  const large  = sorted.slice(i, i + largeCount);  i += largeCount;
  const medium = sorted.slice(i, i + mediumCount); i += mediumCount;
  const small  = sorted.slice(i);

  return { jumbo, large, medium, small };
}

function _toTile(c, tier) {
  return {
    polymarket_slug: c.polymarket_slug,
    question:        c.question,
    yes_price:       c.yes_price,
    volume_24h:      c.volume_24h,
    volume_total:    c.volume_total,
    image:           c.image || null,
    eventSlug:       c.eventSlug,
    whale_count:     c._whaleCount || 0,
    edge_score:      c._edgeScore  || 0,
    score:           c._score      || 0,
    type:            _deriveType(c),
    tier,
  };
}

let _heatmapCache = null;  // { value, expiresAt }

async function buildHeatmapResponse(opts = {}) {
  const now = Date.now();
  if (!opts.bypass_cache && _heatmapCache && _heatmapCache.expiresAt > now) {
    return _heatmapCache.value;
  }

  const { whaleCounts, edgeScores } = _buildEnrichmentMaps();
  const candidates = [];
  const seenSlugs = new Set();

  // Source A: Gamma API top 50 by 24h volume
  try {
    const gRes = await fetch(
      'https://gamma-api.polymarket.com/markets?closed=false&active=true&order=volume_24h&ascending=false&limit=50',
      { headers: { 'User-Agent': 'hyperflex/1.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (gRes.ok) {
      const gData = await gRes.json();
      for (const g of (Array.isArray(gData) ? gData : [])) {
        const m = _normGamma(g);
        if (!m.polymarket_slug || seenSlugs.has(m.polymarket_slug)) continue;
        m._whaleCount = whaleCounts.get(m.polymarket_slug) || 0;
        m._edgeScore  = edgeScores.get(m.polymarket_slug)  || 0;
        m._score = _scoreMarket(m);
        if (m._score === 0) continue;
        seenSlugs.add(m.polymarket_slug);
        candidates.push(m);
      }
    }
  } catch (e) {
    console.error('[heatmap] gamma fetch error:', e.message);
  }

  // Source B: screener cache (catch high edge_score markets not in Gamma top-50)
  const screenerData = (() => {
    const c = _getScreenerCache();
    return (c && Array.isArray(c.data)) ? c.data : (Array.isArray(c) ? c : []);
  })();
  for (const m of screenerData) {
    const slug = m.slug || m.market_slug || '';
    if (!slug || seenSlugs.has(slug)) continue;
    const candidate = {
      polymarket_slug: slug,
      question:        m.question || m.market || '',
      yes_price:       m.yes_price != null ? m.yes_price : (m.yes_pct != null ? m.yes_pct / 100 : null),
      volume_24h:      Number(m.volume_24h) || 0,
      volume_total:    Number(m.volume || m.volume_total) || 0,
      image:           m.image || m.market_image || null,
      eventSlug:       m.event_slug || '',
      closed:          m.closed   || false,
      resolved:        m.resolved || false,
      _whaleCount:     whaleCounts.get(slug) || 0,
      _edgeScore:      m.edge_score || 0,
    };
    candidate._score = _scoreMarket(candidate);
    if (candidate._score === 0) continue;
    seenSlugs.add(slug);
    candidates.push(candidate);
  }

  // Source C: word-betting markets (Fed speech slug-probe) — supplemental
  try {
    const { candidates: wordCandidates } = await wordMarkets.getHeatmapCandidates(opts);
    for (const wm of wordCandidates) {
      const slug = wm.polymarket_slug || '';
      if (!slug || seenSlugs.has(slug)) continue;
      wm._whaleCount = whaleCounts.get(slug) || 0;
      wm._edgeScore  = edgeScores.get(slug)  || 0;
      wm._score = _scoreMarket(wm);
      if (wm._score === 0) continue;
      seenSlugs.add(slug);
      candidates.push(wm);
    }
  } catch (e) {
    console.error('[heatmap] word-markets error:', e.message);
  }

  // Editorial filter (PR #170): drop off-thesis meme markets before sorting
  const candidatesAfterEditorial = candidates.filter(_passesEditorialFilter).length;
  const droppedEditorial = candidates.length - candidatesAfterEditorial;
  const editorialFiltered = candidates.filter(_passesEditorialFilter);

  // Sort by score, diversity cap (max 2 per eventSlug), tier bucket
  editorialFiltered.sort((a, b) => b._score - a._score);

  const seenEvents = new Map();
  const diverse = editorialFiltered.filter(c => {
    const key = c.eventSlug || c.polymarket_slug || '';
    const count = seenEvents.get(key) || 0;
    if (count >= 2) return false;
    seenEvents.set(key, count + 1);
    return true;
  });

  const tiers = _bucketIntoTiers(diverse);
  const tiered = {
    jumbo:  tiers.jumbo.map(c  => _toTile(c, 'jumbo')),
    large:  tiers.large.map(c  => _toTile(c, 'large')),
    medium: tiers.medium.map(c => _toTile(c, 'medium')),
    small:  tiers.small.map(c  => _toTile(c, 'small')),
  };

  const total_volume_24h = diverse.reduce((s, c) => s + (c.volume_24h || 0), 0);
  const total_volume     = diverse.reduce((s, c) => s + (c.volume_total || 0), 0);

  const response = {
    total_markets:   diverse.length,
    total_volume,
    total_volume_24h,
    tiers: tiered,
    cached_at:       new Date(now).toISOString(),
    next_refresh_at: new Date(now + CACHE_TTL_MS).toISOString(),
    sourcing: {
      code_version:        CODE_VERSION,
      candidates_raw:      candidates.length,
      candidates_after_editorial: candidatesAfterEditorial,
      dropped_editorial:   droppedEditorial,
      candidates_after_diversity: diverse.length,
      tier_counts: {
        jumbo:  tiered.jumbo.length,
        large:  tiered.large.length,
        medium: tiered.medium.length,
        small:  tiered.small.length,
      },
    },
  };

  console.log(
    `[heatmap-source] v=${CODE_VERSION}` +
    ` raw=${candidates.length} diverse=${diverse.length}` +
    ` tiers=${tiered.jumbo.length}/${tiered.large.length}/${tiered.medium.length}/${tiered.small.length}` +
    ` vol_24h=${total_volume_24h}`
  );

  _heatmapCache = { value: response, expiresAt: now + CACHE_TTL_MS };
  return response;
}

function bustCache() { _heatmapCache = null; }

function getCachedSnapshot() {
  if (!_heatmapCache) return null;
  return {
    expiresAt:     _heatmapCache.expiresAt,
    age_ms:        Date.now() - (_heatmapCache.expiresAt - CACHE_TTL_MS),
    total_markets: _heatmapCache.value && _heatmapCache.value.total_markets,
  };
}

module.exports = {
  init,
  buildHeatmapResponse,
  bustCache,
  getCachedSnapshot,
  CACHE_TTL_MS,
  _scoreMarket,
};
