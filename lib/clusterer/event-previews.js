/**
 * lib/clusterer/event-previews.js
 *
 * Registry of "preview" mention_event slugs that get a market-pricing
 * page BEFORE a real transcript-driven mention_event exists. Used by
 * Phase 3.6 — Warsh preview page is the launch case.
 *
 * Architectural contract: the registry only fires when the same slug
 * has no row in mention_events yet. The moment Phase 2g composes the
 * real event for that slug, the API stops serving the preview and
 * starts serving the composed event. Same URL, different render path
 * based on data state. URL integrity preserved across the transition.
 *
 * To add a preview: drop a new entry below. To remove one: delete it
 * (the composed event will take over automatically once it exists).
 */

'use strict';

const PREVIEW_REGISTRY = {
  'warsh-2026-06-fomc-presser': {
    speaker:    'Warsh',
    event_type: 'fomc_presser',
    // Mid-June 2026 — Fed meeting day per public reporting (Fed Open Market
    // Committee June 16-17, 2026; press conference traditionally on day 2).
    // Refine to exact wall-clock when Fed publishes the schedule.
    event_date: '2026-06-17',
    headline:    "Warsh's first FOMC",
    subhead:    'Mid-June 2026 — live receipt within 24h of the press conference.',
    // Search terms hit gamma /markets/keyset?search=<term>; deduped by
    // conditionId. Order matters only for fallback if rate-limited; all
    // results merged before sort-by-volume.
    polymarket_search_terms: [
      'warsh',
      'fed chair',
      'june 2026 fomc',
      'fed rate june',
      'fed funds june',
    ],
    // Hard post-filter against gamma's loose `?search=` matching. Gamma
    // ranks results by token similarity and will return basketball /
    // crypto / sports markets when asked about "fed rate june" because
    // it tokenizes loosely. Reject any candidate whose question doesn't
    // contain at least one of these macro-policy patterns. Patterns use
    // word boundaries so substring noise (Federalist, FedEx) doesn't
    // sneak through. Keep the search-term list broad to maximize
    // candidate recall; this filter handles precision.
    must_match_any: [
      /\bfed\b/i,
      /\bfederal reserve\b/i,
      /\bfomc\b/i,
      /\bwarsh\b/i,
      /\brate cut/i,
      /\brate hike/i,
      /\binterest rate/i,
      /\bbasis points?\b/i,
      /\bfed funds\b/i,
      /\bfed chair\b/i,
    ],
    // Backstop for gamma's loose keyword search: a hand-curated list of
    // event slugs that we know surface real Fed/Warsh markets. The
    // composer merges these into the candidate pool alongside the
    // keyword-search hits, dedupes on conditionId, then re-applies the
    // must_match_any filter. Lets the page render at least a few cards
    // even when gamma's `?search=` underperforms.
    //
    // Slugs verified via WebSearch on polymarket.com (2026-05). When
    // an event resolves and disappears, the fetch returns null and the
    // entry is silently skipped — no maintenance overhead until the
    // candidate pool dries up enough to warrant a re-curation pass.
    fallback_event_slugs: [
      'who-will-be-confirmed-as-fed-chair',
      'kevin-warsh-confirmed-as-fed-chair-by-may-15',
      'how-many-fed-rate-cuts-in-2026',
      'major-rate-cut-chances-under-each-fed-chair-948',
      'jerome-powell-out-as-fed-chair-by',
    ],
    powell_compare: true,
    placeholder_pill_label: 'Awaiting transcript',
    closing_copy: 'Live receipt within 24h · FRB.gov verified.',
  },

  // ── Phase 4.1: first non-Fed preview entry ──
  // Trump's Iran posture rolls up across April-May 2026 statements.
  // The mention_event composer writes a row at slug
  // `trump-iran-<latest_date>`; this entry surfaces the live
  // Polymarket markets pricing Iran outcomes alongside that event
  // page until / unless we ship a separate /event/<slug> hero
  // surface.
  'trump-iran-2026-05-01': {
    speaker:                'Trump',
    subject:                'iran',
    domain:                 'us_politics',
    event_type:             'social_post',
    event_date:             '2026-05-01',
    headline:               "Trump's Iran posture",
    subhead:                'April-May 2026 statement arc, paired against Biden\'s 2022-2023 baseline.',
    placeholder_pill_label: 'Awaiting transcript',
    closing_copy:           'Live receipt updates as new statements land · sources verified.',
    polymarket_search_terms: [
      'iran nuclear',
      'iran strike',
      'iran regime',
      'iran oil',
      'us iran',
      'tehran',
      'iran ceasefire',
      'fordow',
    ],
    must_match_any: [
      /\biran\b/i,
      /\btehran\b/i,
      /\bayatollah\b/i,
      /\buranium\b/i,
      /\bfordow\b/i,
      /\bnatanz\b/i,
      /\bregime\b/i,
      /\bhormuz\b/i,
      /\bnuclear deal\b/i,
    ],
    fallback_event_slugs: [
      'will-the-iranian-regime-survive-us-military-strikes-741',
      'will-the-iranian-regime-fall-by-june-30',
      'iran-nuke-before-2027',
      'us-x-iran-ceasefire-extended-by',
      'us-iran-nuclear-deal-by-june-30',
      'trump-announces-end-of-military-operations-against-iran-by',
    ],
    powell_compare:         false, // not Fed; comparison handled at compose level (Biden)
    political_compare:      'Biden',
};

function getPreview(slug) {
  return PREVIEW_REGISTRY[String(slug || '').toLowerCase()] || null;
}

function previewSlugs() {
  return Object.keys(PREVIEW_REGISTRY);
}

module.exports = { PREVIEW_REGISTRY, getPreview, previewSlugs };
