/**
 * lib/clusterer/domains.js
 *
 * Phase 4 multi-domain registry. Each domain declares its own stance
 * vocabulary, voice surface text, and ingestion source. The composer,
 * blurb generator, and event-page templates read from this registry
 * to stay domain-agnostic at the code level while behaving correctly
 * per domain at runtime.
 *
 * One entry today (Fed). Architecture is in place; adding a second
 * domain is a registry edit + a new scraper, not a schema change.
 *
 * Stance axis note: each domain has its own three-bucket axis. The
 * Fed uses hawkish/dovish/neutral. A future Trump-on-tariffs domain
 * might use escalating/de-escalating/ambiguous. Musk-on-Tesla might
 * use bullish/bearish/hedging. The schema (speaker_word_stance.llm_stance,
 * mention_events.dominant_stance) is free-text; the registry is what
 * tells the prompt builder which vocabulary to use, and what tells
 * the page which pill colors to map onto which value.
 *
 * What this registry does NOT do (yet):
 *   - Pill color mapping per domain — premature without a second
 *     domain to test against. /event and /mentions still use the
 *     Fed-shaped cyan/red/slate scheme universally.
 *   - Hero-selection ranking — currently /mentions hero is hardcoded
 *     to the Warsh preview-registry slug. When 2+ domains have live
 *     events, hero rotation becomes a query against market relevance.
 */

'use strict';

const { TRACKED_WORDS } = require('../word_counts');

const DOMAINS = {
  fed_monetary_policy: {
    id:                 'fed_monetary_policy',
    label:              'Federal Reserve',
    eyebrow:            'Federal Reserve',
    short_eyebrow:      'Federal Reserve',
    source_org:         'Federal Reserve',
    speakers:           ['Powell', 'Warsh', 'Brainard', 'Cook', 'Jefferson', 'Waller', 'Yellen'],
    // stance_axis_id is the value written to mention_events.stance_axis;
    // values is the enum the LLM judge picks from for this axis.
    stance_axis_id:     'hawkish_dovish',
    stance_values:      ['hawkish', 'dovish', 'neutral'],
    insufficient_label: 'insufficient_signal',
    tracked_vocab:      TRACKED_WORDS,
    posture_hint:       'monetary-policy posture (hawkish / dovish / neutral) on tracked Fed vocabulary',
  },
};

// Speaker → domain map for ingestion routing. Built once from the
// domains registry. When a transcript or stance row exists without an
// explicit domain field, we fall back to looking up the speaker here.
const _speakerIndex = new Map();
for (const d of Object.values(DOMAINS)) {
  for (const speaker of d.speakers) {
    _speakerIndex.set(speaker.toLowerCase(), d.id);
  }
}

function get(id) {
  return DOMAINS[String(id || '').toLowerCase()] || null;
}

function list() {
  return Object.values(DOMAINS);
}

function ids() {
  return Object.keys(DOMAINS);
}

/**
 * Look up which domain a speaker belongs to. Used by the composer
 * when populating mention_events.domain on insert. Defaults to 'fed_monetary_policy'
 * when unknown (the existing 86 events are all Fed; this is a
 * back-compat fallback, not a real default for new domains).
 */
function forSpeaker(speaker) {
  if (!speaker) return 'fed_monetary_policy';
  return _speakerIndex.get(String(speaker).toLowerCase()) || 'fed_monetary_policy';
}

module.exports = {
  get,
  list,
  ids,
  forSpeaker,
  DOMAINS,
};
