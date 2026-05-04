/**
 * lib/clusterer/sentence-extract.js
 *
 * Pulls representative sentences from a transcript for a given target word.
 * Used by Phase 2d.5's LLM judgment pass — the model needs the actual
 * sentences in which a speaker uses a word, not just the count.
 *
 * Matching rules mirror lib/word_counts.js#countWord so the sentence pool
 * here is exactly the same set the rule-based clusterer counted:
 *   - Phrases / hyphenated terms: literal match with word boundaries
 *   - Single words: optional inflections (-s, -es, -ed, -ing, -ly)
 *
 * Sentence prioritization: when a transcript has more matches than the cap,
 * we prefer sentences that also mention monetary-policy context (rates,
 * inflation, employment, policy, balance sheet, FOMC, target). That's
 * where the rhetorical posture lives — "the Committee should cut" vs.
 * "I would not cut prematurely" both contain "cut", and the surrounding
 * context is what the LLM needs to disambiguate them.
 */

'use strict';

// Lightweight context heuristic — used to rank sentences when we have more
// matches than CAP. Words here are deliberately broad (we want to capture
// any sentence with monetary-policy framing, not just the 30-word vocab).
const CONTEXT_WORDS = [
  'rate', 'rates', 'inflation', 'employment', 'policy', 'fomc',
  'balance sheet', 'target', 'committee', 'meeting', 'decision',
  'cut', 'hike', 'tightening', 'easing', 'restrictive', 'accommodative',
  'percent', 'basis points', 'fed funds',
];

/**
 * Split text into sentences. Naive but workable for Fed transcript prose:
 *   - Splits on `.`, `!`, `?` followed by whitespace and a capital letter
 *   - Keeps the punctuation
 *   - Trims each sentence
 *   - Filters empty / very-short fragments (under 30 chars — usually
 *     headers, page numbers, transcript markers)
 */
function splitSentences(text) {
  if (!text || typeof text !== 'string') return [];
  // Use a lookahead so the punctuation stays with the preceding sentence.
  const raw = text.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
  return raw
    .map(s => s.trim())
    .filter(s => s.length >= 30);
}

/**
 * Build the same regex word_counts.js#countWord uses, so we match the same
 * surface forms the rule-based pass counted (no over- or under-shooting).
 */
function wordRegex(word) {
  const w = String(word || '').toLowerCase();
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (w.includes(' ') || w.includes('-')) {
    return new RegExp(`\\b${escaped}\\b`, 'i');
  }
  return new RegExp(`\\b${escaped}(s|es|ed|ing|ly)?\\b`, 'i');
}

/**
 * Score a sentence by how much monetary-policy context surrounds the
 * target word. Higher score = more "judgeable" sentence for the LLM.
 * Length-bonus tops out around 200 chars — over-long sentences don't
 * help and waste tokens.
 */
function scoreSentence(sentence) {
  const lower = sentence.toLowerCase();
  let score = 0;
  for (const ctx of CONTEXT_WORDS) {
    if (lower.includes(ctx)) score++;
  }
  // Mild length bonus, capped — sentences under 60 chars are often
  // fragments that don't carry stance signal.
  const len = Math.min(200, sentence.length);
  score += (len - 60) / 200;
  return score;
}

/**
 * Extract up to `cap` sentences from a list of (transcriptId, fullText)
 * pairs that contain `word`. Returns the raw sentence strings.
 *
 * Ranking:
 *   1. Score sentences by monetary-policy context density
 *   2. Sort highest-first
 *   3. Take the top `cap`
 *
 * Diversity: we explicitly do NOT dedup across transcripts. If a speaker
 * gave the same talking point in 5 speeches, the LLM still benefits from
 * seeing the strongest version — and identical sentences are vanishingly
 * rare in practice (Fed speakers rephrase across appearances).
 */
function extractSentences(transcripts, word, cap = 5) {
  if (!Array.isArray(transcripts) || transcripts.length === 0) return [];
  const re = wordRegex(word);
  const candidates = [];
  for (const t of transcripts) {
    const sentences = splitSentences(t.full_text || '');
    for (const s of sentences) {
      if (re.test(s)) {
        candidates.push({ text: s, score: scoreSentence(s) });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, cap).map(c => c.text);
}

module.exports = {
  extractSentences,
  // exported for testability
  splitSentences,
  wordRegex,
  scoreSentence,
};
