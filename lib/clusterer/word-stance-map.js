/**
 * lib/clusterer/word-stance-map.js
 *
 * v1 stance lookup for the 30-word tracked vocabulary defined in
 * lib/word_counts.js#TRACKED_WORDS. Words land in one of three buckets:
 *   - HAWKISH_WORDS — over-indexed usage tilts the speaker hawkish
 *   - DOVISH_WORDS  — over-indexed usage tilts the speaker dovish
 *   - everything else stays neutral (frame words and Warsh-era themes)
 *
 * v1 is a hand-coded lookup. Phase 2d.5 will replace this with LLM judgment
 * on actual usage in context — in v1 we want reproducibility before we layer
 * in any model-flavored interpretation. Words like "anchored" and "inflation"
 * are deliberately left neutral because both camps use them; the LLM pass
 * can break the tie by reading the surrounding sentence.
 *
 * Keep these in sync with TRACKED_WORDS — adding a word to TRACKED_WORDS
 * without categorising it here just means it stays neutral, which is the
 * correct default.
 */

'use strict';

// Lowercased + trimmed for comparison. Set membership keeps lookup O(1).
const HAWKISH_WORDS = new Set([
  'restrictive',
  'persistent',
  'tightening',
  'overheating',
  'hike',
  'hawkish',
  'inflation expectations',
  'sticky inflation',
  'wage pressure',
]);

const DOVISH_WORDS = new Set([
  'patient',
  'data-dependent',
  'soft landing',
  'cut',
  'accommodative',
  'transitory',
  'pivot',
  'easing',
]);

function stanceLeaning(word) {
  const w = String(word || '').toLowerCase().trim();
  if (HAWKISH_WORDS.has(w)) return 'hawkish';
  if (DOVISH_WORDS.has(w)) return 'dovish';
  return null; // neutral default
}

module.exports = {
  HAWKISH_WORDS,
  DOVISH_WORDS,
  stanceLeaning,
};
