/**
 * lib/clusterer/judge.js
 *
 * Phase 2d.5 — LLM context-judgment pass over the rule-based clusterer
 * output. For each (speaker, word) row in speaker_word_stance, fetches
 * up to 5 representative sentences from that speaker's transcripts, asks
 * Claude Sonnet 4.6 to classify the speaker's posture, and writes the
 * verdict to the row's llm_* columns.
 *
 * The rule-based `stance` column stays untouched — `llm_stance` is the
 * authoritative classification downstream. Re-running overwrites cleanly.
 *
 * Model: claude-sonnet-4-6, no thinking, effort:low. The task is a 4-bucket
 * classification with a tight contract (≤5 sentences in, one JSON object
 * out) — adaptive thinking would burn tokens for no quality gain.
 *
 * Cost: ~$0.34 per full 150-row run at Sonnet 4.6 pricing. See README of
 * Phase 2d.5 commit for math.
 *
 * SDK note: package.json pins @anthropic-ai/sdk ^0.78, which predates
 * native output_config.format. We use the existing repo pattern of
 * instructing JSON output in the prompt and regex-extracting from the
 * response (matches scoreMarketResonance() in server.js:1390).
 */

'use strict';

const { extractSentences } = require('./sentence-extract');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 256;
const SENTENCE_CAP = 5;
const DEFAULT_CONCURRENCY = 4;

// Pricing as of skill cache 2026-04-15. Used only for the cost estimate
// returned by the endpoint — not for billing or hard caps.
const PRICE_INPUT_PER_1M = 3.00;
const PRICE_OUTPUT_PER_1M = 15.00;

let _pool = null;
let _anthropic = null;

function init(opts) {
  if (!opts?.pool) throw new Error('judge.init: opts.pool required');
  if (!opts?.anthropic) throw new Error('judge.init: opts.anthropic required');
  _pool = opts.pool;
  _anthropic = opts.anthropic;
}

const SYSTEM_PROMPT =
  'You classify the rhetorical posture of Federal Reserve officials on monetary-policy ' +
  'terms based on actual speech excerpts. ' +
  'Hawkish: speaker advocates restrictive policy, tighter conditions, or higher rates. ' +
  'Dovish: speaker advocates accommodative policy, looser conditions, or lower rates. ' +
  'Neutral: speaker mentions the term descriptively without taking a stance, or balances ' +
  'both sides. ' +
  'Insufficient_signal: the excerpts do not contain enough rhetorical context to judge. ' +
  '\n\n' +
  'CRITICAL: frequency does not equal stance. Judge by what the speaker advocates, not ' +
  'what they mention. A hawk saying "we must avoid premature rate cuts" is hawkish on ' +
  '"cut", not dovish, even though the word "cut" appears. A dove saying "tightening has ' +
  'gone far enough" is dovish on "tightening", not hawkish.';

/**
 * Build the user-turn prompt for one (speaker, word) row.
 * Returns the prompt string. Pure — no DB or API access.
 */
function buildUserPrompt({ speaker, word, sentences }) {
  const numbered = sentences.length === 0
    ? '(no excerpts found — judge as insufficient_signal)'
    : sentences.map((s, i) => `${i + 1}. "${s}"`).join('\n\n');

  return [
    `Speaker: ${speaker}`,
    `Term: "${word}"`,
    '',
    `Excerpts from ${speaker}'s speeches/testimony where "${word}" appears:`,
    '',
    numbered,
    '',
    'Classify the speaker\'s rhetorical posture on this specific term, based ONLY on the ' +
    'excerpts above. Respond with ONLY a single JSON object, no prose:',
    '{',
    '  "stance": "hawkish" | "dovish" | "neutral" | "insufficient_signal",',
    '  "confidence": "high" | "medium" | "low",',
    '  "rationale": "<one sentence — what specifically in the excerpts drove the call>"',
    '}',
  ].join('\n');
}

/**
 * Fetch up to 5 representative sentences for one (speaker, word) pair.
 * Joins transcripts → transcript text in a single query, then runs the
 * sentence extractor.
 */
async function fetchSentences(speaker, word) {
  const { rows } = await _pool.query(
    'select id, full_text from transcripts where speaker = $1',
    [speaker]
  );
  return extractSentences(rows, word, SENTENCE_CAP);
}

/**
 * Parse the model's JSON response. Lenient — handles surrounding prose
 * and code fences in case the model wraps its answer. Returns null when
 * the response can't be parsed into the contract.
 */
const ALLOWED_STANCES = new Set([
  'hawkish', 'dovish', 'neutral', 'insufficient_signal',
]);
const ALLOWED_CONFIDENCE = new Set(['high', 'medium', 'low']);

function parseVerdict(raw) {
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
  const stance = String(parsed.stance || '').toLowerCase();
  const confidence = String(parsed.confidence || '').toLowerCase();
  if (!ALLOWED_STANCES.has(stance)) return null;
  if (!ALLOWED_CONFIDENCE.has(confidence)) return null;
  const rationale = typeof parsed.rationale === 'string'
    ? parsed.rationale.trim().slice(0, 500)
    : '';
  return { stance, confidence, rationale };
}

/**
 * Judge one row. Builds the prompt, calls the API, parses the verdict.
 * Returns { sentences, prompt, verdict, usage, error } — `verdict` is
 * null when parsing fails or the API errors. Caller decides whether to
 * write to the DB.
 */
async function judgeRow({ speaker, word }) {
  const sentences = await fetchSentences(speaker, word);
  const prompt = buildUserPrompt({ speaker, word, sentences });

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
      sentences, prompt, verdict: null, usage: null,
      error: err.message || String(err),
    };
  }

  const text = response.content?.[0]?.text || '';
  const verdict = parseVerdict(text);
  return {
    sentences, prompt, verdict,
    usage: {
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
    },
    error: verdict ? null : `parse_failed: ${text.slice(0, 200)}`,
  };
}

/**
 * Build the prompt for one row WITHOUT calling the API. Used by the
 * dry_run path to surface what would be sent.
 */
async function previewRow({ speaker, word }) {
  const sentences = await fetchSentences(speaker, word);
  const prompt = buildUserPrompt({ speaker, word, sentences });
  return { speaker, word, sentence_count: sentences.length, sentences, prompt };
}

/**
 * Run the LLM pass over speaker_word_stance.
 *
 * Options:
 *   - since:        ISO timestamp; skip rows already judged after this.
 *                   Pass null/undefined to re-judge everything.
 *   - limit:        cap how many rows are processed this run.
 *   - dryRun:       true → don't call the API or write the DB; return
 *                   prompts only. Use `sample` to live-call N of them.
 *   - sample:       in dry-run mode, hit the API for the first N rows
 *                   and include their verdicts in the response without
 *                   writing.
 *   - concurrency:  parallel API calls (default 4 — Anthropic SDK
 *                   handles 429s automatically with backoff).
 */
async function run(opts = {}) {
  if (!_pool) throw new Error('judge.init() must be called first');
  if (!_anthropic) throw new Error('judge.init() must be called first');

  const since = opts.since || null;
  const limit = Math.max(0, parseInt(opts.limit, 10) || 0);
  const dryRun = !!opts.dryRun;
  const sample = Math.max(0, parseInt(opts.sample, 10) || 0);
  const concurrency = Math.max(1, Math.min(8, parseInt(opts.concurrency, 10) || DEFAULT_CONCURRENCY));

  const startedAt = Date.now();

  const params = [];
  let where = '';
  if (since) {
    params.push(since);
    where = `where llm_judged_at is null or llm_judged_at < $${params.length}`;
  }
  let sql = `select id, speaker, word, stance from speaker_word_stance ${where} order by speaker, word`;
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
      stance_breakdown: { hawkish: 0, dovish: 0, neutral: 0, insufficient_signal: 0 },
      flips_from_rule_based: 0,
      est_cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      message: 'no rows matched filter',
    };
  }

  // Dry-run path — build prompts, optionally hit API for the first `sample`.
  if (dryRun) {
    const previews = [];
    for (let i = 0; i < rows.length; i++) {
      const p = await previewRow(rows[i]);
      const out = { ...p, rule_based_stance: rows[i].stance };
      if (i < sample) {
        const judged = await judgeRow(rows[i]);
        out.verdict = judged.verdict;
        out.error = judged.error;
        out.usage = judged.usage;
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

  // Live path — judge each row and write back. Bounded concurrency.
  const stanceBreakdown = { hawkish: 0, dovish: 0, neutral: 0, insufficient_signal: 0 };
  let flipsFromRuleBased = 0;
  let inputTokensTotal = 0;
  let outputTokensTotal = 0;
  let writes = 0;
  const failures = [];

  // Simple worker pool — pulls from the queue in order.
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= rows.length) return;
      const row = rows[idx];
      const result = await judgeRow(row);
      inputTokensTotal += result.usage?.input_tokens || 0;
      outputTokensTotal += result.usage?.output_tokens || 0;
      if (!result.verdict) {
        failures.push({ id: row.id, speaker: row.speaker, word: row.word, error: result.error });
        continue;
      }
      try {
        await _pool.query(
          `update speaker_word_stance
           set llm_stance = $1,
               llm_confidence = $2,
               llm_rationale = $3,
               llm_judged_at = now(),
               llm_sentence_count = $4
           where id = $5`,
          [
            result.verdict.stance,
            result.verdict.confidence,
            result.verdict.rationale,
            result.sentences.length,
            row.id,
          ]
        );
        writes++;
        stanceBreakdown[result.verdict.stance]++;
        if (result.verdict.stance !== row.stance) flipsFromRuleBased++;
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
    stance_breakdown: stanceBreakdown,
    flips_from_rule_based: flipsFromRuleBased,
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
  parseVerdict,
  SYSTEM_PROMPT,
  MODEL,
};
