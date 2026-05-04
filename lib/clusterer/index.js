/**
 * lib/clusterer/index.js
 *
 * Phase 2d clusterer — builds the speaker_word_stance table by comparing
 * each speaker's per-1k-words usage of each tracked word against the
 * corpus baseline. Output is consumed by Phase 2e (blurb) and Phase 2f
 * (stance seed) to drive the stance-flip timeline on mention pages.
 *
 * Determinism over judgment in v1: pure rule-based pass with a hand-coded
 * hawkish/dovish lookup (lib/clusterer/word-stance-map.js). Phase 2d.5 will
 * layer LLM context-reading on top.
 *
 * Usage:
 *   const clusterer = require('./lib/clusterer');
 *   clusterer.init({ pool });                // pg.Pool
 *   const stats = await clusterer.run();     // recomputes the full table
 *
 * `run()` is idempotent: deletes and rebuilds inside a single transaction.
 * Re-running produces identical rows.
 */

'use strict';

const { stanceLeaning } = require('./word-stance-map');

// Classifier knobs — kept here so they're testable / tunable without
// hunting through query strings.
const MIN_SPEAKER_TRANSCRIPTS = 3;       // below this, classify as insufficient_data
const MIN_TRANSCRIPTS_WITH_WORD = 2;     // word must appear in ≥ 2 of speaker's transcripts
const RATE_RATIO_THRESHOLD = 1.5;        // speaker rate must exceed corpus baseline by ≥ 1.5×

let _pool = null;

function init(opts) {
  if (!opts?.pool) throw new Error('clusterer.init: opts.pool required');
  _pool = opts.pool;
}

/**
 * Classify one (speaker, word) row given the precomputed metrics.
 * Pure function — no DB access, no side effects.
 */
function classify({
  speakerTotalTranscripts,
  transcriptsWithWord,
  speakerRatePer1k,
  corpusRatePer1k,
  word,
}) {
  if (
    speakerTotalTranscripts < MIN_SPEAKER_TRANSCRIPTS ||
    transcriptsWithWord < MIN_TRANSCRIPTS_WITH_WORD
  ) {
    return 'insufficient_data';
  }
  // No corpus signal for this word at all → can't say anyone over-indexes
  // on something nobody else uses. Fall through to neutral.
  if (!(corpusRatePer1k > 0)) return 'neutral';

  const ratio = speakerRatePer1k / corpusRatePer1k;
  if (ratio > RATE_RATIO_THRESHOLD) {
    const lean = stanceLeaning(word);
    if (lean === 'hawkish') return 'hawkish';
    if (lean === 'dovish') return 'dovish';
  }
  return 'neutral';
}

/**
 * Recompute speaker_word_stance from scratch.
 *
 * The heavy lifting happens in two SQL aggregations:
 *   - speaker_metrics: per (speaker, word), sum of raw counts, distinct
 *     transcripts, and the speaker's total word_count across all their
 *     transcripts (used to compute per-1k normalisation)
 *   - corpus_metrics:  per word, same shape across the whole corpus
 *
 * We then join in JS, classify, and write back inside a transaction.
 * Pulling the join into JS rather than SQL keeps the classifier rules in
 * one place (the classify() function above) — easier to extend in 2d.5.
 */
async function run() {
  if (!_pool) throw new Error('clusterer.init() must be called first');

  const startedAt = Date.now();

  // 1. Per-speaker totals — every distinct transcript word_count summed.
  //    A speaker's "rate per 1k words" is sum(raw_count) / total_words * 1000.
  const speakerTotalsRes = await _pool.query(`
    select speaker,
           count(*)::int as transcript_count,
           coalesce(sum(word_count), 0)::bigint as total_words
    from transcripts
    group by speaker
  `);
  const speakerTotals = new Map(); // speaker -> { transcriptCount, totalWords }
  for (const r of speakerTotalsRes.rows) {
    speakerTotals.set(r.speaker, {
      transcriptCount: r.transcript_count,
      totalWords: Number(r.total_words),
    });
  }

  // 2. Per-(speaker, word) aggregation. transcripts_with_word is the count
  //    of that speaker's transcripts where the word appeared at least once.
  const speakerMetricsRes = await _pool.query(`
    select t.speaker,
           twc.word,
           sum(twc.raw_count)::bigint as raw_count,
           count(*) filter (where twc.raw_count > 0)::int as transcripts_with_word
    from transcripts t
    join transcript_word_counts twc on twc.transcript_id = t.id
    group by t.speaker, twc.word
  `);

  // 3. Corpus baseline — same per-1k math but over the whole corpus.
  const corpusTotalsRes = await _pool.query(
    `select coalesce(sum(word_count), 0)::bigint as total_words from transcripts`
  );
  const corpusTotalWords = Number(corpusTotalsRes.rows[0].total_words);

  const corpusMetricsRes = await _pool.query(`
    select word,
           sum(raw_count)::bigint as raw_count
    from transcript_word_counts
    group by word
  `);
  const corpusRateByWord = new Map(); // word -> rate per 1k
  for (const r of corpusMetricsRes.rows) {
    const raw = Number(r.raw_count);
    const rate = corpusTotalWords > 0 ? (raw / corpusTotalWords) * 1000 : 0;
    corpusRateByWord.set(r.word, rate);
  }

  // 4. Classify each (speaker, word) row.
  const rows = [];
  for (const r of speakerMetricsRes.rows) {
    const speaker = r.speaker;
    const word = r.word;
    const totals = speakerTotals.get(speaker);
    if (!totals) continue; // shouldn't happen — every transcript row has a speaker

    const speakerRaw = Number(r.raw_count);
    const speakerRatePer1k = totals.totalWords > 0
      ? (speakerRaw / totals.totalWords) * 1000
      : 0;
    const corpusRatePer1k = corpusRateByWord.get(word) || 0;
    const rateRatio = corpusRatePer1k > 0
      ? speakerRatePer1k / corpusRatePer1k
      : 0;

    const stance = classify({
      speakerTotalTranscripts: totals.transcriptCount,
      transcriptsWithWord: r.transcripts_with_word,
      speakerRatePer1k,
      corpusRatePer1k,
      word,
    });

    rows.push({
      speaker,
      word,
      stance,
      speaker_rate_per_1k: speakerRatePer1k,
      corpus_rate_per_1k: corpusRatePer1k,
      rate_ratio: rateRatio,
      transcripts_with_word: r.transcripts_with_word,
      speaker_total_transcripts: totals.transcriptCount,
    });
  }

  // 5. Replace table contents in a single transaction. Truncate + insert
  //    rather than upsert so dropping a (speaker, word) pair (e.g. after a
  //    transcript is deleted upstream) actually removes the stale row.
  const speakersProcessed = speakerTotals.size;
  const client = await _pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from speaker_word_stance');
    for (const row of rows) {
      await client.query(
        `insert into speaker_word_stance
           (speaker, word, stance,
            speaker_rate_per_1k, corpus_rate_per_1k, rate_ratio,
            transcripts_with_word, speaker_total_transcripts)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          row.speaker, row.word, row.stance,
          row.speaker_rate_per_1k, row.corpus_rate_per_1k, row.rate_ratio,
          row.transcripts_with_word, row.speaker_total_transcripts,
        ]
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  return {
    rows_written: rows.length,
    speakers_processed: speakersProcessed,
    duration_ms: Date.now() - startedAt,
  };
}

module.exports = {
  init,
  run,
  // exported for testability
  classify,
  MIN_SPEAKER_TRANSCRIPTS,
  MIN_TRANSCRIPTS_WITH_WORD,
  RATE_RATIO_THRESHOLD,
};
