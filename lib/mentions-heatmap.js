// lib/mentions-heatmap.js
//
// /mentions heat-map sourcing + endpoint orchestrator.
//
// SOURCING ARCHITECTURE NOTE (2026-05-14, post-PR-153 production diag):
// gamma's `?search=<term>` is a loose-token full-text query, NOT
// language-aware. Searching for "will say" / "mention" / "tweet" etc.
// returns mostly unrelated markets ("New Rihanna Album", "Will Jesus
// Christ return"). PR #153's keyword-only sourcing pipeline produced
// 1 kept market across 800 fetched (0.13%); the curated slug-probe
// in lib/word-markets.js (`what-will-<speaker>-say-during-<month>-
// <suffix>`) finds 3 events x 52 sub-markets ($6.94M total) with no
// noise. Slug-probe + event_type curation are the real sourcing
// strategies on Polymarket gamma; keyword-search is unreliable as a
// primary source. Keep keyword sweeps only as a cheap secondary that
// might catch the rare one-off market with no event-slug shape.
//
// Pipeline (per 5-min cache refresh):
//   1. wordMarkets.getHeatmapCandidates():
//      - PRIMARY: getUpcomingWordMarketEvents() returns slug-probe-found
//        event groups; each sub-market is flattened into a heat-map
//        candidate.
//      - SECONDARY: 4 keyword sweeps (word_betting / statement_betting
//        / speaker_action / event_decision) -- noise-prone, dedupe-only
//        wins after slug-probe.
//   2. Volume filter: a market passes if total volume > HEATMAP_MIN_VOLUME_TOTAL
//      ($500 default) OR 24h volume > HEATMAP_MIN_VOLUME ($100 default). The
//      OR rule keeps high-lifetime markets visible even on quiet days, and
//      keeps fresh-spike markets visible even when total is low.
//   3. Sort by volume_24h DESC (tie-break: volume_total DESC).
//   4. Percentile-bucket into 4 tiers per Marc's spec:
//        jumbo  = min(4,  ceil(N*0.05))
//        large  = min(10, ceil(N*0.15))
//        medium =          ceil(N*0.30)
//        small  = remainder
//      Hierarchy is preserved at small N (N=5 -> jumbo=1, large=1, medium=2,
//      small=1).
//   5. Format response shape per spec; cache 5 min.
//
// Deferred to v1.1 (called out explicitly so future readers know it's
// intentional, not forgotten):
//   - tag-based catch-all (Polymarket gamma /tags shape unverified)
//   - sparkline_7d (cost: 1 prices-history call per market = 564/hour at 47
//     markets x 12 refreshes; defer to hourly-cache 7-point form)
//   - yes_price_delta_24h (same per-market prices-history cost; defer with
//     sparkline; UI handles null and shows price-only on jumbo tiles)

'use strict';

const wordMarkets = require('./word-markets');

const CACHE_TTL_MS = 5 * 60 * 1000;

// Code-version stamp. Surfaced in the [heatmap-source] log + the
// /api/mentions-heatmap response so the deployed version is grep-able.
// Bump when the sourcing pipeline changes shape; cheap signal that the
// fix landed in prod (matches the flex_code_version pattern from
// recompute-flex).
const CODE_VERSION = '2026-05-14-slug-probe-primary+flatten-probe+no-closed-filter';

// Volume thresholds. Marc spec is one env var (HEATMAP_MIN_VOLUME) for the
// 24h floor; total-volume floor stays its own env so it can be tuned
// independently without forcing a code edit. Both default per the spec.
const MIN_VOLUME_24H   = Number(process.env.HEATMAP_MIN_VOLUME)       || 100;
const MIN_VOLUME_TOTAL = Number(process.env.HEATMAP_MIN_VOLUME_TOTAL) || 500;

// Tier cap constants. Jumbo + large have hard caps from spec; medium /
// small are percentile-only.
const TIER_CAPS = {
  jumbo_max: 4,
  large_max: 10,
};
const TIER_PERCENTILES = {
  jumbo:  0.05,
  large:  0.15,
  medium: 0.30,
  // small = remainder
};

let _heatmapCache = null;  // { value, expiresAt }

function _passesVolumeFilter(c) {
  return (c.volume_total >= MIN_VOLUME_TOTAL) || (c.volume_24h >= MIN_VOLUME_24H);
}

function _sortDesc(a, b) {
  const d24 = (b.volume_24h || 0) - (a.volume_24h || 0);
  if (d24 !== 0) return d24;
  return (b.volume_total || 0) - (a.volume_total || 0);
}

function _bucketIntoTiers(sorted) {
  const n = sorted.length;
  if (n === 0) return { jumbo: [], large: [], medium: [], small: [] };

  const jumboCount = Math.min(TIER_CAPS.jumbo_max, Math.ceil(n * TIER_PERCENTILES.jumbo));
  const largeCount = Math.min(TIER_CAPS.large_max, Math.ceil(n * TIER_PERCENTILES.large));
  const mediumCount = Math.ceil(n * TIER_PERCENTILES.medium);

  let i = 0;
  const jumbo  = sorted.slice(i, i + jumboCount);  i += jumboCount;
  const large  = sorted.slice(i, i + largeCount);  i += largeCount;
  const medium = sorted.slice(i, i + mediumCount); i += mediumCount;
  const small  = sorted.slice(i);

  return { jumbo, large, medium, small };
}

function _toResponseMarket(c, tier) {
  return {
    condition_id:         c.condition_id,
    question:             c.question,
    speaker:              c.speaker,
    speaker_slug:         c.speaker_slug,
    yes_price:            c.yes_price,
    yes_price_delta_24h:  null,   // deferred to v1.1 with sparkline
    volume_24h:           c.volume_24h,
    volume_total:         c.volume_total,
    end_date:             c.end_date,
    sparkline_7d:         [],     // deferred to v1.1 (cost: 564 calls/hr)
    polymarket_slug:      c.polymarket_slug,
    eventSlug:            c.eventSlug,
    matched_patterns:     c.matched_patterns,
    tier,
  };
}

function _composeResponse(filtered, funnel, totalCandidatesBeforeFilter) {
  filtered.sort(_sortDesc);
  const tiers = _bucketIntoTiers(filtered);

  const tiered = {
    jumbo:  tiers.jumbo.map(c  => _toResponseMarket(c, 'jumbo')),
    large:  tiers.large.map(c  => _toResponseMarket(c, 'large')),
    medium: tiers.medium.map(c => _toResponseMarket(c, 'medium')),
    small:  tiers.small.map(c  => _toResponseMarket(c, 'small')),
  };

  const total_volume_24h = filtered.reduce((s, c) => s + (c.volume_24h || 0), 0);

  const now = Date.now();
  return {
    total_markets:        filtered.length,
    total_volume_24h,
    tiers:                tiered,
    cached_at:            new Date(now).toISOString(),
    next_refresh_at:      new Date(now + CACHE_TTL_MS).toISOString(),
    sourcing: {
      code_version:       CODE_VERSION,
      patterns_shipped:   ['slug_probe_primary', 'word_betting_secondary', 'statement_betting_secondary', 'speaker_action_secondary', 'event_decision_secondary'],
      patterns_deferred:  ['tag_based'],  // v1.1 -- gamma /tags shape unverified
      primary_source:     'slug_probe',
      secondary_note:     'keyword sweeps kept as supplement; gamma ?search= is loose-token, rarely contributes net-new markets',
      candidates_before_volume_filter: totalCandidatesBeforeFilter,
      candidates_after_volume_filter:  filtered.length,
      min_volume_24h:     MIN_VOLUME_24H,
      min_volume_total:   MIN_VOLUME_TOTAL,
      funnel,
      tier_counts: {
        jumbo:  tiered.jumbo.length,
        large:  tiered.large.length,
        medium: tiered.medium.length,
        small:  tiered.small.length,
      },
    },
  };
}

/**
 * Build (or return cached) heat-map response. Caller decides whether to
 * pass through cache via opts.bypass_cache.
 *
 * Response shape per spec; see _composeResponse for fields.
 */
async function buildHeatmapResponse(opts = {}) {
  const now = Date.now();
  if (!opts.bypass_cache && _heatmapCache && _heatmapCache.expiresAt > now) {
    return _heatmapCache.value;
  }

  const t0 = Date.now();
  const { candidates, funnel } = await wordMarkets.getHeatmapCandidates(opts);
  const candidatesBeforeFilter = candidates.length;

  const filtered = candidates.filter(_passesVolumeFilter);

  const response = _composeResponse(filtered, funnel, candidatesBeforeFilter);
  const elapsedMs = Date.now() - t0;

  // [heatmap-source] structured per-source + tier diag log. Slug-probe
  // is the primary supply (via getUpcomingWordMarketEvents); the 4
  // keyword sweeps are kept as a cheap secondary that almost never
  // contributes net-new markets (gamma `?search=` is loose-token, not
  // language-aware -- proven 2026-05-14). Surface both layers so the
  // funnel keeps the keyword failure mode visible.
  const slug = funnel.slug_probe_primary || { event_groups: 0, sub_markets: 0, kept: 0 };
  console.log(
    '[heatmap-source]' +
    ` v=${CODE_VERSION}` +
    ` candidates_raw=${candidatesBeforeFilter}` +
    ` filtered=${response.total_markets}` +
    ` slug_probe=${slug.kept}(events=${slug.event_groups},submarkets=${slug.sub_markets})` +
    ` word_betting=${funnel.word_betting.kept}` +
    ` statement_betting=${funnel.statement_betting.kept}` +
    ` speaker_action=${funnel.speaker_action.kept}` +
    ` event_decision=${funnel.event_decision.kept}` +
    ` tiers=${response.sourcing.tier_counts.jumbo}/${response.sourcing.tier_counts.large}/${response.sourcing.tier_counts.medium}/${response.sourcing.tier_counts.small}` +
    ` elapsed_ms=${elapsedMs}`
  );

  _heatmapCache = { value: response, expiresAt: now + CACHE_TTL_MS };
  return response;
}

function bustCache() { _heatmapCache = null; }

function getCachedSnapshot() {
  if (!_heatmapCache) return null;
  return {
    expiresAt: _heatmapCache.expiresAt,
    age_ms:    Date.now() - (_heatmapCache.expiresAt - CACHE_TTL_MS),
    total_markets: _heatmapCache.value && _heatmapCache.value.total_markets,
  };
}

module.exports = {
  buildHeatmapResponse,
  bustCache,
  getCachedSnapshot,
  CACHE_TTL_MS,
  MIN_VOLUME_24H,
  MIN_VOLUME_TOTAL,
  _internals: { _passesVolumeFilter, _bucketIntoTiers, _composeResponse },
};
