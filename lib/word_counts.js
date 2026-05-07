/**
 * lib/word_counts.js
 *
 * Word and phrase counter for Fed transcripts. Counts every word in
 * TRACKED_WORDS against each transcript's full_text, writes raw + per-10k
 * normalized counts into transcript_word_counts, and rolls up totals into
 * speaker_word_frequency (the supporting card on mention pages).
 *
 * Idempotent at the per-transcript level — recompute deletes existing rows
 * for that transcript_id before re-inserting. Safe to re-run after editing
 * TRACKED_WORDS.
 *
 * Phase 2c of the mention-pages build. Replaces the stub that the Phase 2b
 * fed_transcripts scraper called.
 *
 * Usage:
 *   const wordCounts = require('./lib/word_counts');
 *   wordCounts.init({ pool });                           // pg.Pool from server.js
 *   await wordCounts.computeWordCounts(transcriptId);
 *   await wordCounts.rebuildSpeakerWordFrequency('Powell');
 *   await wordCounts.backfillAllPending();               // CLI entrypoint
 */

'use strict';

let _pool = null;

function init(opts) {
  if (!opts?.pool) throw new Error('word_counts.init: opts.pool required');
  _pool = opts.pool;
}

/**
 * Words and phrases tracked across all Fed transcripts.
 * Adding a word here means re-running computeWordCounts on existing
 * transcripts (the rollup needs the new word's counts to materialise).
 */
const TRACKED_WORDS = [
  // Hawkish signals
  'restrictive', 'persistent', 'tightening', 'overheating', 'hike', 'hawkish',
  'inflation expectations', 'sticky inflation', 'wage pressure',

  // Dovish signals
  'patient', 'data-dependent', 'soft landing', 'cut', 'accommodative',
  'transitory', 'pivot', 'easing',

  // Frame words (used to detect rhetorical posture)
  'recession', 'labor market', 'inflation', 'anchored', 'uncertainty',
  'employment', 'growth',

  // Warsh-era anticipated themes (relevant for upcoming pressers)
  'independence', 'AI', 'balance sheet', 'disinflationary', 'trimmed PCE',
  'productivity',
];

/**
 * Normalize text for word matching.
 * Lowercase, strip punctuation except apostrophes/hyphens, collapse whitespace.
 */
function normalizeText(text) {
  return text.toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Count occurrences of a word or phrase in normalized text.
 * - Phrases (with space or hyphen) match exactly with word boundaries
 * - Single words also match common inflections (-s, -es, -ed, -ing, -ly)
 * - Regex specials in the input word are escaped before pattern construction
 */
function countWord(normalizedText, word) {
  const w = word.toLowerCase();
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (w.includes(' ') || w.includes('-')) {
    // Phrase / hyphenated: exact match with word boundaries on both sides
    const re = new RegExp(`\\b${escaped}\\b`, 'g');
    const matches = normalizedText.match(re);
    return matches ? matches.length : 0;
  }

  // Single word: include common English inflections
  const re = new RegExp(`\\b${escaped}(s|es|ed|ing|ly)?\\b`, 'g');
  const matches = normalizedText.match(re);
  return matches ? matches.length : 0;
}

/**
 * Compute word counts for one transcript and upsert to transcript_word_counts.
 * Wrapped in a transaction; deletes existing rows for that transcript_id
 * first so re-runs are clean replacements, not duplicates.
 *
 * @param {string} transcriptId  uuid
 * @returns {Promise<{transcriptId, totalWords, wordsTracked}>}
 */
async function computeWordCounts(transcriptId) {
  if (!_pool) throw new Error('word_counts.init() must be called first');

  const { rows } = await _pool.query(
    'select id, full_text, word_count from transcripts where id = $1',
    [transcriptId]
  );
  if (rows.length === 0) {
    throw new Error(`transcript ${transcriptId} not found`);
  }

  const transcript = rows[0];
  const normalized = normalizeText(transcript.full_text);

  // Per-word raw counts
  const counts = TRACKED_WORDS.map(word => ({
    word,
    raw: countWord(normalized, word),
  }));

  // Normalize: counts per 10,000 words so transcripts of different
  // lengths are comparable side-by-side.
  const totalWords = transcript.word_count || normalized.split(/\s+/).filter(Boolean).length;
  const scale = totalWords > 0 ? 10000 / totalWords : 1;

  const client = await _pool.connect();
  try {
    await client.query('begin');
    await client.query(
      'delete from transcript_word_counts where transcript_id = $1',
      [transcriptId]
    );
    for (const c of counts) {
      await client.query(
        `insert into transcript_word_counts
           (transcript_id, word, raw_count, normalized_count)
         values ($1, $2, $3, $4)`,
        [transcriptId, c.word, c.raw, Math.round(c.raw * scale)]
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  return { transcriptId, totalWords, wordsTracked: counts.length };
}

/**
 * Rebuild the speaker_word_frequency rollup for one speaker. Run after a
 * batch that touched their transcripts — single rebuild beats 51 incremental
 * upserts.
 */
async function rebuildSpeakerWordFrequency(speaker) {
  if (!_pool) throw new Error('word_counts.init() must be called first');

  const client = await _pool.connect();
  try {
    await client.query('begin');
    await client.query(
      'delete from speaker_word_frequency where speaker = $1',
      [speaker]
    );
    await client.query(`
      insert into speaker_word_frequency (speaker, word, total_count, source_count)
      select t.speaker, twc.word,
             sum(twc.raw_count)::int as total_count,
             count(distinct t.id)::int as source_count
      from transcripts t
      join transcript_word_counts twc on twc.transcript_id = t.id
      where t.speaker = $1
      group by t.speaker, twc.word
    `, [speaker]);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Backfill: process every transcript that has no row in transcript_word_counts
 * yet, then rebuild the rollups for every distinct speaker that was touched.
 * The single-rebuild-per-speaker pattern keeps backfill O(transcripts) rather
 * than O(transcripts × speakers).
 */
async function backfillAllPending() {
  if (!_pool) throw new Error('word_counts.init() must be called first');

  const { rows: pending } = await _pool.query(`
    select t.id, t.speaker
    from transcripts t
    left join transcript_word_counts twc on twc.transcript_id = t.id
    where twc.id is null
  `);

  let succeeded = 0, failed = 0;
  const speakersTouched = new Set();
  for (const r of pending) {
    try {
      await computeWordCounts(r.id);
      speakersTouched.add(r.speaker);
      succeeded++;
    } catch (err) {
      console.error(`[word_counts] failed for ${r.id}:`, err.message);
      failed++;
    }
  }

  for (const speaker of speakersTouched) {
    await rebuildSpeakerWordFrequency(speaker);
  }

  return { succeeded, failed, speakersRebuilt: Array.from(speakersTouched) };
}

module.exports = {
  init,
  computeWordCounts,
  rebuildSpeakerWordFrequency,
  backfillAllPending,
  TRACKED_WORDS,
  // exported for testability
  normalizeText,
  countWord,
};
