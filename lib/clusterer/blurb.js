/**
 * lib/clusterer/blurb.js
 *
 * Phase 2e — atomic blurb generator. For each speaker_word_stance row with
 * a non-insufficient_signal llm_stance, asks Claude Sonnet 4.6 to write
 * one observational line about how the speaker treats the term. The
 * blurb is grounded in the same up-to-5 sentence excerpts the judge saw
 * (same extractor, deterministic), plus the speaker's corpus date range
 * for temporal framing.
 *
 * Voice charter (locked in 2e brief):
 *   - 90/10 dry-to-warm, observational, no editorializing
 *   - Active voice, third person, no second person in data displays
 *   - Quotes ≤ 15 words, pulled verbatim from the excerpts
 *   - Max 1 em-dash, no emoji, no exclamation points
 *   - 1-2 sentences total, ≤ 45 words
 *
 * Temporal framing (the Brainard/Waller catch from 2d.5 retro):
 *   - Narrow date range (<6 months) or single tenure phase → frame
 *     temporally ("during her 2022 Vice Chair tenure")
 *   - Multi-cycle range with visible pivot → frame as evolution
 *     ("his 2024-2025 pivot toward preemptive cuts")
 *   - Uniformly recent + unremarkable → no temporal framing
 *
 * Output schema (parsed + validated):
 *   { blurb, quote_used, word_count, temporal_framing_applied }
 *
 * Cost: ~$0.45 per full pass over 104 eligible rows at Sonnet 4.6 pricing
 * (700 input + 150 output per call).
 */

'use strict';

const { extractSentences } = require('./sentence-extract');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 400;
const SENTENCE_CAP = 5;
const DEFAULT_CONCURRENCY = 4;
const MAX_BLURB_WORDS = 45;

const PRICE_INPUT_PER_1M = 3.00;
const PRICE_OUTPUT_PER_1M = 15.00;

let _pool = null;
let _anthropic = null;

function init(opts) {
  if (!opts?.pool) throw new Error('blurb.init: opts.pool required');
  if (!opts?.anthropic) throw new Error('blurb.init: opts.anthropic required');
  _pool = opts.pool;
  _anthropic = opts.anthropic;
}

const SYSTEM_PROMPT =
  'You write one-line observational blurbs about U.S. Federal Reserve officials\' ' +
  'rhetorical posture on monetary-policy terms, for a prediction-market product that ' +
  'records receipts on what people said. ' +
  '\n\nVOICE:\n' +
  '- Observational, not editorial. Report what the speaker said. Do not call the stance ' +
  'correct, prescient, or interesting in itself.\n' +
  '- Active voice. Third person. Never address the reader.\n' +
  '- Default dry and numerate (~90% of blurbs). Lean briefly warm only when a finding ' +
  'is genuinely surprising or newsworthy (~10%). When unsure, stay dry.\n' +
  '- No emoji. No exclamation points. Max one em-dash per blurb.\n' +
  '- Quotes are optional. If you quote, the quote must be ≤ 15 words and pulled ' +
  'verbatim from the excerpts provided. If no excerpt has a clean ≤ 15-word quote that ' +
  'lands the point, do not quote.\n' +
  '- 1-2 sentences total, ≤ 45 words.\n' +
  '\nTEMPORAL FRAMING:\n' +
  '- If the speaker\'s transcripts span < 6 months OR cover a specific phase of their ' +
  'tenure, frame the stance temporally: "during her 2022 Vice Chair tenure", ' +
  '"in his pre-2024 speeches", etc.\n' +
  '- If the range spans multiple cycles or shows a visible pivot, frame the stance as ' +
  'evolution: "Waller\'s 2024-2025 pivot toward preemptive cuts".\n' +
  '- If the range is recent and unremarkable, no temporal framing needed.\n' +
  '\nOUTPUT:\n' +
  'Respond with a single JSON object, no prose around it:\n' +
  '{\n' +
  '  "blurb": "<the blurb text>",\n' +
  '  "quote_used": <true|false>,\n' +
  '  "word_count": <integer — count words in blurb>,\n' +
  '  "temporal_framing_applied": <true|false>\n' +
  '}';

function fmtDate(d) {
  if (!d) return null;
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function buildUserPrompt({
  speaker, word, llm_stance, llm_confidence, llm_rationale,
  rate_ratio, transcripts_with_word, speaker_total_transcripts,
  corpus_date_range, sentences,
}) {
  const dateLine = corpus_date_range && corpus_date_range.from && corpus_date_range.to
    ? `Corpus date range: ${corpus_date_range.from} to ${corpus_date_range.to}`
    : 'Corpus date range: unknown';
  const ratioLine = rate_ratio && isFinite(rate_ratio) && rate_ratio > 0
    ? `Rate vs corpus baseline: ${Number(rate_ratio).toFixed(2)}×`
    : 'Rate vs corpus baseline: n/a';
  const numbered = sentences.length === 0
    ? '(no excerpts available — write a generic observational blurb if possible, ' +
      'else return an empty blurb)'
    : sentences.map((s, i) => `${i + 1}. "${s}"`).join('\n\n');

  return [
    `Speaker: ${speaker}`,
    `Term: "${word}"`,
    `Verdict: ${llm_stance} (confidence: ${llm_confidence || 'unknown'})`,
    `Verdict rationale: ${llm_rationale || '(none recorded)'}`,
    '',
    `Mentions: ${transcripts_with_word} of ${speaker_total_transcripts} transcripts`,
    ratioLine,
    dateLine,
    '',
    'Excerpts:',
    numbered,
    '',
    `Write the blurb about how ${speaker} treats "${word}". Output JSON only.`,
  ].join('\n');
}

/**
 * Parse the model's JSON response. Lenient — handles surrounding prose
 * and code fences. Returns null when the response can't be parsed into
 * the contract or fails the basic voice-rule checks (length cap, emoji,
 * exclamation points). The voice checks here are minimum gates — fine-
 * grained voice review still happens via the 5+1 acceptance check.
 */
const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u;

function parseBlurb(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim()
    .replace(/^```json?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch { return null; }
  const blurb = typeof parsed.blurb === 'string' ? parsed.blurb.trim() : '';
  if (!blurb) return null;
  if (EMOJI_RE.test(blurb)) return null;
  if (blurb.includes('!')) return null;
  // Server-side word count is the source of truth — model's self-reported
  // word_count is kept as a sanity-check field but not trusted blindly.
  const serverWordCount = blurb.split(/\s+/).filter(Boolean).length;
  if (serverWordCount > MAX_BLURB_WORDS) return null;
  return {
    blurb,
    quote_used: !!parsed.quote_used,
    word_count: serverWordCount,
    temporal_framing_applied: !!parsed.temporal_framing_applied,
  };
}

/**
 * Fetch up to 5 representative sentences for one (speaker, word).
 * Same code path as the judge — deterministic, same matches.
 */
async function fetchSentences(speaker, word) {
  const { rows } = await _pool.query(
    'select id, full_text from transcripts where speaker = $1',
    [speaker]
  );
  return extractSentences(rows, word, SENTENCE_CAP);
}

/**
 * Pull min/max(transcript_date) per speaker in one query and return as a
 * Map(speaker → {from, to}). Called once per run, then read from cache
 * during row processing.
 */
async function fetchCorpusDateRanges() {
  const { rows } = await _pool.query(`
    select speaker,
           min(transcript_date) as min_date,
           max(transcript_date) as max_date
    from transcripts
    group by speaker
  `);
  const map = new Map();
  for (const r of rows) {
    map.set(r.speaker, {
      from: fmtDate(r.min_date),
      to:   fmtDate(r.max_date),
    });
  }
  return map;
}

/**
 * Generate the blurb for one row. Builds the prompt, calls the API,
 * parses the verdict. Returns { sentences, prompt, blurb, usage, error }.
 * `blurb` is null when parsing fails or the API errors.
 */
async function blurbRow(row, dateRangeMap) {
  const sentences = await fetchSentences(row.speaker, row.word);
  const corpus_date_range = dateRangeMap.get(row.speaker) || null;

  const prompt = buildUserPrompt({
    speaker:                    row.speaker,
    word:                       row.word,
    llm_stance:                 row.llm_stance,
    llm_confidence:             row.llm_confidence,
    llm_rationale:              row.llm_rationale,
    rate_ratio:                 row.rate_ratio,
    transcripts_with_word:      row.transcripts_with_word,
    speaker_total_transcripts:  row.speaker_total_transcripts,
    corpus_date_range,
    sentences,
  });

  let response;
  try {
    response = await _anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    return {
      sentences, prompt, blurb: null, usage: null,
      error: err.message || String(err),
    };
  }

  const text = response.content?.[0]?.text || '';
  const blurb = parseBlurb(text);
  return {
    sentences, prompt, blurb,
    usage: {
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
    },
    error: blurb ? null : `parse_or_voice_check_failed: ${text.slice(0, 200)}`,
  };
}

/**
 * Build the prompt for one row WITHOUT calling the API. Used by dry-run
 * to surface what would be sent.
 */
async function previewRow(row, dateRangeMap) {
  const sentences = await fetchSentences(row.speaker, row.word);
  const corpus_date_range = dateRangeMap.get(row.speaker) || null;
  const prompt = buildUserPrompt({
    speaker:                    row.speaker,
    word:                       row.word,
    llm_stance:                 row.llm_stance,
    llm_confidence:             row.llm_confidence,
    llm_rationale:              row.llm_rationale,
    rate_ratio:                 row.rate_ratio,
    transcripts_with_word:      row.transcripts_with_word,
    speaker_total_transcripts:  row.speaker_total_transcripts,
    corpus_date_range,
    sentences,
  });
  return {
    speaker: row.speaker,
    word: row.word,
    llm_stance: row.llm_stance,
    llm_confidence: row.llm_confidence,
    sentence_count: sentences.length,
    corpus_date_range,
    sentences,
    prompt,
  };
}

/**
 * Run the blurb generator over speaker_word_stance.
 * Same options shape as judge.run() for parity.
 *
 * Filter: only rows with llm_stance set and != 'insufficient_signal'
 * (104 of 150 in the current corpus). insufficient_signal rows have no
 * signal to quote — the partial index makes this filter cheap.
 */
async function run(opts = {}) {
  if (!_pool) throw new Error('blurb.init() must be called first');
  if (!_anthropic) throw new Error('blurb.init() must be called first');

  const since = opts.since || null;
  const limit = Math.max(0, parseInt(opts.limit, 10) || 0);
  const dryRun = !!opts.dryRun;
  const sample = Math.max(0, parseInt(opts.sample, 10) || 0);
  const concurrency = Math.max(1, Math.min(8, parseInt(opts.concurrency, 10) || DEFAULT_CONCURRENCY));

  const startedAt = Date.now();

  const params = [];
  // Always require a usable verdict — no point blurbing a row whose
  // judge result was null/insufficient_signal.
  let where = `where llm_stance is not null and llm_stance != 'insufficient_signal'`;
  if (since) {
    params.push(since);
    where += ` and (blurb_generated_at is null or blurb_generated_at < $${params.length})`;
  }
  let sql = `
    select id, speaker, word, llm_stance, llm_confidence, llm_rationale,
           rate_ratio, transcripts_with_word, speaker_total_transcripts
    from speaker_word_stance
    ${where}
    order by speaker, word
  `;
  if (limit > 0) {
    params.push(limit);
    sql += ` limit $${params.length}`;
  }
  const { rows } = await _pool.query(sql, params);

  if (rows.length === 0) {
    return {
      mode: dryRun ? 'dry_run' : 'live',
      rows_eligible: 0,
      rows_written: 0,
      est_cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      message: 'no rows matched filter',
    };
  }

  const dateRangeMap = await fetchCorpusDateRanges();

  // Dry-run path — build prompts, optionally hit API for the first `sample`.
  if (dryRun) {
    const previews = [];
    for (let i = 0; i < rows.length; i++) {
      const p = await previewRow(rows[i], dateRangeMap);
      const out = { ...p };
      if (i < sample) {
        const result = await blurbRow(rows[i], dateRangeMap);
        out.blurb = result.blurb;
        out.error = result.error;
        out.usage = result.usage;
      }
      previews.push(out);
    }
    return {
      mode: 'dry_run',
      rows_eligible: rows.length,
      rows_written: 0,
      sample_called: sample,
      previews,
      duration_ms: Date.now() - startedAt,
    };
  }

  // Live path — generate each blurb and write back. Bounded concurrency.
  let inputTokensTotal = 0;
  let outputTokensTotal = 0;
  let writes = 0;
  const failures = [];
  const flagCounts = {
    quote_used: 0,
    temporal_framing_applied: 0,
  };

  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= rows.length) return;
      const row = rows[idx];
      const result = await blurbRow(row, dateRangeMap);
      inputTokensTotal += result.usage?.input_tokens || 0;
      outputTokensTotal += result.usage?.output_tokens || 0;
      if (!result.blurb) {
        failures.push({ id: row.id, speaker: row.speaker, word: row.word, error: result.error });
        continue;
      }
      try {
        await _pool.query(
          `update speaker_word_stance
           set blurb = $1, blurb_generated_at = now()
           where id = $2`,
          [result.blurb.blurb, row.id]
        );
        writes++;
        if (result.blurb.quote_used) flagCounts.quote_used++;
        if (result.blurb.temporal_framing_applied) flagCounts.temporal_framing_applied++;
      } catch (err) {
        failures.push({ id: row.id, speaker: row.speaker, word: row.word, error: 'db_write_failed: ' + err.message });
      }
    }
  });

  await Promise.all(workers);

  const estCost =
    (inputTokensTotal / 1_000_000) * PRICE_INPUT_PER_1M +
    (outputTokensTotal / 1_000_000) * PRICE_OUTPUT_PER_1M;

  return {
    mode: 'live',
    rows_eligible: rows.length,
    rows_written: writes,
    flag_counts: flagCounts,
    failure_count: failures.length,
    failures: failures.slice(0, 10),
    tokens: { input: inputTokensTotal, output: outputTokensTotal },
    est_cost_usd: +estCost.toFixed(4),
    duration_ms: Date.now() - startedAt,
  };
}

module.exports = {
  init,
  run,
  // exported for testability
  buildUserPrompt,
  parseBlurb,
  SYSTEM_PROMPT,
  MODEL,
  MAX_BLURB_WORDS,
};
