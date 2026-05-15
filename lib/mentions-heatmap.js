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
const CODE_VERSION = '2026-05-15-drop-settled-binaries';

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

// Liveness filter -- drops settled/dead markets that surface via slug-probe
// (PR #157 dropped the closed flag filter at sourcing time to keep
// pending-activation markets visible, but settled markets share the same
// flag and were leaking through with stale 0/100 prices).
//
// PR #161 v1 of this filter dropped any (yes_price ∈ {0,1}) AND
// (volume_24h <= 0). That overcorrected: pre-activation Polymarket sub-
// markets sit at yes_price=0 placeholder with zero recent trading AND
// real lifetime volume (e.g. "Will Powell say Judge" has $3.6M lifetime
// even before the June FOMC sub-markets activate). v1 killed 52 of 53
// tiles by dropping all pre-activation supply.
//
// Option C (Marc's recommend): a market fails liveness only when it has
// a settled price AND zero volume in BOTH dimensions (24h and lifetime).
// Tiles with ANY volume signal (lifetime accumulation OR recent activity)
// survive. Truly-dead markets -- settled price + no money ever -- drop.
//
// Trade-off vs v1: settled-and-resolved markets with high lifetime volume
// continue to surface at 0¢/100¢ (the original Issue 2 leak). Acceptable
// per Marc; better than dropping pre-activation supply.
function _passesLivenessFilter(c) {
  const p   = c.yes_price;
  const v24 = Number(c.volume_24h)   || 0;
  const vt  = Number(c.volume_total) || 0;
  const settled = (p === 0 || p === 1);
  const dead    = (v24 <= 0 && vt <= 0);
  return !(settled && dead);
}

// Settled-binary-outcome detector. Empirical 2026-05-15 (Marc):
// 52 of 52 "pending"-tagged tiles on /mentions had yes_price === 0
// OR yes_price >= 0.99 with $18-22k of historical volume on past
// Powell pressers (March + May 2026, both already happened). Those
// are settled binary outcomes -- the YES either happened or didn't,
// market resolved, money paid out. PRs #161/#162/#166/#167 all
// shipped state-relabel layers that preserved them under different
// names ("pending", "active-discriminated"); none filtered them.
//
// Structural fix per Marc's spec: drop tiles where
//   closed === true AND (yes_price === 0 OR yes_price >= 0.99).
// Pre-activation tiles that legitimately exist would sit at
// mid-price (~50c) with low volume -- this filter preserves them.
// If no such tiles exist empirically, supply scarcity is a separate
// sourcing problem, not solved by keeping dead markets on screen.
function _isSettledBinary(c) {
  if (c.closed !== true) return false;
  const p = c.yes_price;
  return (p === 0 || p >= 0.99);
}

// Sort by lifetime volume DESC ("$ in play" framing per Marc's spec),
// tie-break by 24h volume DESC so a quiet long-lived market doesn't
// outrank a fresh-but-thinner market with active trading.
function _sortDesc(a, b) {
  const dTotal = (b.volume_total || 0) - (a.volume_total || 0);
  if (dTotal !== 0) return dTotal;
  return (b.volume_24h || 0) - (a.volume_24h || 0);
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

// Strip event-context boilerplate from question text. Polymarket
// renders the parent event explicitly above the heat-map already,
// so "Will Powell say Judge during June Press Conference?" becomes
// just "Will Powell say Judge" on the tile -- shorter, scannable,
// no redundant info. Keeps original on `question_raw` for callers
// who need it. Trailing question mark cleanup if regex left one
// dangling.
const _MONTH_NAMES = '(?:january|february|march|april|may|june|july|august|september|october|november|december)';
const _BOILERPLATE_PATTERNS = [
  // "during June Press Conference?" / "during the June FOMC press conference"
  new RegExp(`\\s+during\\s+(?:the\\s+)?${_MONTH_NAMES}(?:\\s+\\d{4})?\\s+(?:fomc\\s+)?press\\s+conference\\??\\s*$`, 'i'),
  // "during the June FOMC meeting"
  new RegExp(`\\s+during\\s+(?:the\\s+)?${_MONTH_NAMES}(?:\\s+\\d{4})?\\s+fomc\\s+meeting\\??\\s*$`, 'i'),
  // "during <speaker>'s June press conference" -- generic catch
  new RegExp(`\\s+during\\s+\\w+'s\\s+${_MONTH_NAMES}(?:\\s+\\d{4})?\\s+press\\s+conference\\??\\s*$`, 'i'),
];
function _stripEventBoilerplate(question) {
  if (!question) return question;
  let q = String(question);
  for (const re of _BOILERPLATE_PATTERNS) q = q.replace(re, '');
  return q.trim();
}

// Derive tile state. Server-side derivation so the UI can render a
// PENDING/RESOLVED chip without re-implementing the rule.
//   - non-settled price                  -> 'live'
//   - settled price + active === false   -> 'resolved' (event over)
//   - settled price + active !== false   -> 'pending'  (pre-activation)
//
// `active` is Polymarket's canonical signal for "no longer accepting
// orders." Pre-activation sub-markets carry closed:true but active:true
// (they'll open soon); resolved markets carry active:false.
//
// PR #166 used `end_date < now` as the resolved discriminator, but
// Polymarket's parent-event endDate is unreliable for this -- Marc's
// 2026-05-15 diag showed 52 of 53 surviving tiles mis-labelled
// 'resolved', including all 17+17=34 pre-activation tiles for June +
// July Powell FOMC events (event dates ~33 days future, sub-markets
// at 0c placeholder, all caught by the end_date check anyway).
//
// `active === false` is the right signal. End_date stays in the
// response payload for caller inspection but no longer drives state.
function _deriveState(c) {
  const p = c.yes_price;
  const settled = (p === 0 || p === 1);
  if (!settled) return 'live';
  if (c.active === false) return 'resolved';
  return 'pending';
}

function _toResponseMarket(c, tier) {
  return {
    condition_id:         c.condition_id,
    question:             _stripEventBoilerplate(c.question),
    question_raw:         c.question,
    state:                _deriveState(c),
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
    active:               c.active,     // PR #167 diag: surface for state-derivation verification
    closed:               c.closed,     // PR #167 diag: complement to active for full state visibility
    tier,
  };
}

function _composeResponse(filtered, funnel, totalCandidatesBeforeFilter, droppedSettled, droppedResolved, droppedSettledBinaries) {
  filtered.sort(_sortDesc);
  const tiers = _bucketIntoTiers(filtered);

  const tiered = {
    jumbo:  tiers.jumbo.map(c  => _toResponseMarket(c, 'jumbo')),
    large:  tiers.large.map(c  => _toResponseMarket(c, 'large')),
    medium: tiers.medium.map(c => _toResponseMarket(c, 'medium')),
    small:  tiers.small.map(c  => _toResponseMarket(c, 'small')),
  };

  const total_volume_24h = filtered.reduce((s, c) => s + (c.volume_24h || 0), 0);
  const total_volume     = filtered.reduce((s, c) => s + (c.volume_total || 0), 0);

  const now = Date.now();
  return {
    total_markets:        filtered.length,
    total_volume,          // lifetime sum -- "$ in play" header metric
    total_volume_24h,      // last-24h sum -- secondary signal
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
      dropped_settled:    Number(droppedSettled)  || 0,  // PR #161 v2: explicit field for verification curl
      dropped_resolved:   Number(droppedResolved) || 0,  // PR #166: tiles whose state derived to 'resolved' (settled price + past end_date)
      dropped_settled_binaries: Number(droppedSettledBinaries) || 0,  // PR #168: closed:true && (yes_price===0 || yes_price>=0.99) -- structural settled-binary drop
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

  // Three-stage filter:
  //   1. Liveness (PR #162 Option C): drops settled-and-truly-dead markets
  //   2. Resolved-state drop (PR #166): defensive, mostly subsumed by
  //      stage 3 but kept in place as belt-and-suspenders against any
  //      tile with state='resolved' that doesn't also match the
  //      settled-binary shape (would require active:false + non-extreme
  //      price, which is unusual but technically possible).
  //   3. Settled-binary drop (PR #168, 2026-05-15): closed:true AND
  //      yes_price extreme (0 or >=0.99) -> drop. Marc's empirical
  //      sanity check confirmed 52 of 52 "pending" tiles had extreme
  //      yes_price + lifetime volume on past Powell pressers (March +
  //      May 2026 both already happened). Settled binary outcome by
  //      definition; PR #167's active-flag rename preserved them under
  //      "pending" without actually filtering. This is the structural fix.
  //   4. Volume gate
  // Each stage's drop count surfaces in [heatmap-source] for triage.
  const live = candidates.filter(_passesLivenessFilter);
  const droppedSettled = candidatesBeforeFilter - live.length;

  const notResolved = live.filter(c => _deriveState(c) !== 'resolved');
  const droppedResolved = live.length - notResolved.length;

  const notSettledBinary = notResolved.filter(c => !_isSettledBinary(c));
  const droppedSettledBinaries = notResolved.length - notSettledBinary.length;

  const filtered = notSettledBinary.filter(_passesVolumeFilter);

  const response = _composeResponse(filtered, funnel, candidatesBeforeFilter, droppedSettled, droppedResolved, droppedSettledBinaries);
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
    ` dropped_settled=${droppedSettled}` +
    ` dropped_resolved=${droppedResolved}` +
    ` dropped_binaries=${droppedSettledBinaries}` +
    ` filtered=${response.total_markets}` +
    ` slug_probe=${slug.kept}(events=${slug.event_groups},submarkets=${slug.sub_markets})` +
    ` word_betting=${funnel.word_betting.kept}` +
    ` statement_betting=${funnel.statement_betting.kept}` +
    ` speaker_action=${funnel.speaker_action.kept}` +
    ` event_decision=${funnel.event_decision.kept}` +
    ` tiers=${response.sourcing.tier_counts.jumbo}/${response.sourcing.tier_counts.large}/${response.sourcing.tier_counts.medium}/${response.sourcing.tier_counts.small}` +
    ` total_vol=${response.total_volume}` +
    ` vol_24h=${response.total_volume_24h}` +
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
  _internals: { _passesVolumeFilter, _passesLivenessFilter, _isSettledBinary, _bucketIntoTiers, _composeResponse, _sortDesc, _stripEventBoilerplate, _deriveState },
};
