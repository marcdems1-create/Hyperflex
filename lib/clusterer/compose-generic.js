/**
 * lib/clusterer/compose-generic.js
 *
 * Phase 4.1 — domain-agnostic event composer. Sibling to compose.js
 * (Fed-specific). Takes a domain config and rolls up per-(speaker,
 * subject) atomic stance rows into one mention_event row. Reuses the
 * Fed composer's LLM call shape, voice charter, and stance-disagreement
 * classification logic; differs in source table, axis vocabulary, and
 * prompt language.
 *
 * Per Marc's brief: don't refactor compose.js into compose-generic
 * yet. This sibling is the test for the abstraction; once 4.1
 * validates the shape, 4.3 dedupes Fed → generic.
 *
 * Input shape (ComposeRequest):
 *   {
 *     domain:     'us_politics',                 // mention_events.domain
 *     speaker:    'Trump',
 *     subject:    'iran',
 *     comparison_speaker: 'Biden',               // optional foil
 *     event_type: 'social_post',                 // mention_events.event_type
 *   }
 *
 * Reads atomic rows from the per-domain stance table (e.g.
 * political_subject_stance), generates a 60-100 word event blurb via
 * Claude Sonnet 4.6, writes one mention_event row keyed on the
 * (speaker, subject, latest statement_date) shape, sets the slug as
 * `<speaker>-<subject>-<latest_date>`.
 *
 * Cost shape mirrors Fed compose: ~1500 input + ~140 output per call.
 */

'use strict';

const domains = require('./domains');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 600;
const MIN_ROWS_FOR_COMPOSE = 2;
const TOP_BLURBS_FOR_PROMPT = 5;
const MIN_BLURB_WORDS = 50;
const MAX_BLURB_WORDS = 110;

const PRICE_INPUT_PER_1M = 3.00;
const PRICE_OUTPUT_PER_1M = 15.00;
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

// Per-domain config: which atomic table to query, what axis vocab to
// use, how to classify disagreement, what voice the prompt anchors on.
// Adding a new domain = adding an entry here + a stance table + a
// preview-registry entry. No code change in this file beyond the
// registry.
const DOMAIN_CONFIGS = {
  us_politics: {
    atomic_table:        'political_subject_stance',
    stance_axis_id:      'escalatory_deescalatory',
    stance_values:       ['escalatory', 'deescalatory', 'ambiguous'],
    insufficient_label:  'insufficient_signal',
    // Opposite-direction pair for hard-reject. Same-axis disagreement
    // (one side ambiguous) gets soft-validated.
    opposite_directions: ['escalatory', 'deescalatory'],
    posture_noun:        'geopolitical posture',
    voice_examples:      [
      '"Trump struck escalatory across his April 2026 Iran statements, framing the Strait of Hormuz blockade as the leverage path while threatening infrastructure-level destruction."',
      '"Biden\'s 2022-2023 Iran posture pivoted deescalatory, anchoring on the August 2023 prisoner-swap deal as the diplomatic re-entry point even after declaring the JCPOA dead."',
    ],
  },
};

let _pool = null;
let _anthropic = null;

function init(opts) {
  if (!opts?.pool) throw new Error('compose-generic.init: opts.pool required');
  if (!opts?.anthropic) throw new Error('compose-generic.init: opts.anthropic required');
  _pool = opts.pool;
  _anthropic = opts.anthropic;
}

function getDomainConfig(domain) {
  return DOMAIN_CONFIGS[String(domain || '').toLowerCase()] || null;
}

const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u;

function fmtDate(d) {
  if (!d) return null;
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function fmtDateLong(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Compute dominant stance + confidence from atomic rows. Same shape
 * as Fed compose, parameterized on the axis values.
 */
function computeDominant(rows, axisValues) {
  if (!rows.length || !axisValues?.length) return { dominant_stance: null, dominant_confidence: null };
  const stanceCounts = {};
  for (const v of axisValues) stanceCounts[v] = 0;
  const confCounts = { high: 0, medium: 0, low: 0 };
  for (const r of rows) {
    if (r.stance_value in stanceCounts) stanceCounts[r.stance_value]++;
    if (r.stance_confidence in confCounts) confCounts[r.stance_confidence]++;
  }
  let dominant_stance = axisValues[0];
  for (const v of axisValues) if (stanceCounts[v] > stanceCounts[dominant_stance]) dominant_stance = v;
  if (stanceCounts[dominant_stance] === 0) dominant_stance = null;
  const confOrder = ['high', 'medium', 'low'];
  let dominant_confidence = confOrder[0];
  for (const c of confOrder) if (confCounts[c] > confCounts[dominant_confidence]) dominant_confidence = c;
  if (confCounts[dominant_confidence] === 0) dominant_confidence = null;
  return { dominant_stance, dominant_confidence };
}

function buildStanceSummary(rows, axisValues) {
  const out = {};
  for (const v of axisValues) out[v] = [];
  for (const r of rows) {
    if (r.stance_value in out) {
      // Use statement_id as the "key" for the bucket, matching the
      // Fed schema's word-keyed structure as closely as possible.
      out[r.stance_value].push(r.statement_id || r.statement_date || r.id);
    }
  }
  return out;
}

function pickTopBlurbs(rows, n) {
  return [...rows]
    .filter(r => r.blurb && r.blurb.trim().length > 0)
    .sort((a, b) => {
      const ca = CONFIDENCE_RANK[a.stance_confidence] || 0;
      const cb = CONFIDENCE_RANK[b.stance_confidence] || 0;
      if (cb !== ca) return cb - ca;
      // Recency tiebreak: newer first
      const da = a.statement_date ? new Date(a.statement_date).getTime() : 0;
      const db = b.statement_date ? new Date(b.statement_date).getTime() : 0;
      return db - da;
    })
    .slice(0, n);
}

/**
 * Hard-reject opposite-direction disagreement (e.g. computed=escalatory,
 * model_called=deescalatory). Soft-validate same-axis disagreement
 * (one side is the third value — 'ambiguous' for politics, 'neutral'
 * for Fed). Mirrors Fed compose's classifyStanceDisagreement.
 */
function classifyStanceDisagreement(computed, modelCalled, opposites) {
  if (!computed || !modelCalled) return { action: 'accept' };
  if (computed === modelCalled) return { action: 'accept' };
  const isOpposite =
    (computed === opposites[0] && modelCalled === opposites[1]) ||
    (computed === opposites[1] && modelCalled === opposites[0]);
  if (isOpposite) return { action: 'hard_reject' };
  return {
    action: 'soft_validate',
    disagreement: { computed, model_called: modelCalled, axis: 'same' },
  };
}

function buildSystemPrompt(cfg) {
  return [
    `You write event-level narrative blurbs about public figures' ${cfg.posture_noun} on a specific subject across multiple statements over time.`,
    'Voice rules (locked):',
    '- Observational, not editorial. Report what the speaker said. Do not call the stance correct, prescient, or notable.',
    '- Active voice. Third person. Never address the reader.',
    '- Default dry and numerate. Lean briefly warm only when a finding is genuinely surprising.',
    '- No emoji. No exclamation points. Max one em-dash.',
    '- At most one quote, ≤ 15 words, pulled verbatim from the atomic blurbs supplied.',
    '- 60 to 100 words.',
    '- Banned editorial flourishes: notably, interestingly, remarkably, importantly.',
    '',
    'Requirements specific to the event blurb:',
    `- Lead with the dominant stance call ("Trump struck ${cfg.stance_values[0]} across his...")`,
    '- Reference 2-3 specific statements or framings by date or subject reference',
    '- If a comparison speaker is supplied, include exactly one divergence sentence',
    '',
    'Voice exemplars (do not copy; match the shape):',
    ...cfg.voice_examples.map(ex => `  ${ex}`),
    '',
    'Output a single JSON object, no surrounding prose:',
    '{',
    '  "event_blurb": "<60-100 words>",',
    `  "dominant_stance_called": "${cfg.stance_values.join('" | "')}",`,
    '  "comparison_used": <true|false>,',
    '  "word_count": <integer>,',
    '  "statements_referenced": ["<id>", "<id>"]',
    '}',
  ].join('\n');
}

function buildUserPrompt({
  speaker, subject, event_date,
  dominant_stance, dominant_confidence,
  stance_summary, top_blurbs,
  comparison_speaker, comparison_blurbs, comparison_dominant,
  cfg,
}) {
  const lines = [
    `Speaker: ${speaker}`,
    `Subject: ${subject}`,
    `Latest statement date: ${event_date || 'unknown'}`,
    '',
    `Computed dominant stance: ${dominant_stance || 'n/a'} (confidence: ${dominant_confidence || 'n/a'})`,
    `Stance summary by value (counts):`,
  ];
  for (const v of cfg.stance_values) {
    const count = (stance_summary[v] || []).length;
    lines.push(`  ${v}: ${count}`);
  }
  lines.push('');
  lines.push(`Top atomic blurbs (highest confidence first):`);
  top_blurbs.forEach((b, i) => {
    const dateBit = b.statement_date ? fmtDateLong(b.statement_date) : '';
    lines.push(`${i + 1}. [${b.stance_value} / ${b.stance_confidence}${dateBit ? ' / ' + dateBit : ''}] ${b.blurb}`);
    if (b.statement_quote) lines.push(`   Quote: "${b.statement_quote}"`);
  });

  if (comparison_speaker && comparison_blurbs?.length) {
    lines.push('');
    lines.push(`Comparison speaker: ${comparison_speaker}`);
    lines.push(`${comparison_speaker}'s dominant on the same subject: ${comparison_dominant || 'n/a'}`);
    lines.push(`${comparison_speaker}'s top atomic blurbs:`);
    comparison_blurbs.forEach((b, i) => {
      const dateBit = b.statement_date ? fmtDateLong(b.statement_date) : '';
      lines.push(`${i + 1}. [${b.stance_value} / ${b.stance_confidence}${dateBit ? ' / ' + dateBit : ''}] ${b.blurb}`);
    });
    lines.push('Include exactly one divergence sentence in the event blurb.');
  }

  lines.push('');
  lines.push('Write the event blurb. Output JSON only.');
  return lines.join('\n');
}

function parseEventBlurb(raw, cfg) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch { return null; }
  const blurb = typeof parsed.event_blurb === 'string' ? parsed.event_blurb.trim() : '';
  if (!blurb) return null;
  if (EMOJI_RE.test(blurb)) return null;
  if (blurb.includes('!')) return null;
  const wordCount = blurb.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_BLURB_WORDS || wordCount > MAX_BLURB_WORDS) return null;
  const stance = String(parsed.dominant_stance_called || '').toLowerCase();
  if (!cfg.stance_values.includes(stance)) return null;
  return {
    event_blurb: blurb,
    dominant_stance_called: stance,
    comparison_used: !!parsed.comparison_used,
    word_count: wordCount,
    statements_referenced: Array.isArray(parsed.statements_referenced) ? parsed.statements_referenced.slice(0, 10) : [],
  };
}

/**
 * Compose one mention_event for the given (domain, speaker, subject).
 * Returns { row, prompt, parsed, usage, stance_disagreement, error }.
 * Caller upserts on success.
 */
async function composeOne({ domain, speaker, subject, comparison_speaker, event_type }) {
  const cfg = getDomainConfig(domain);
  if (!cfg) throw new Error(`compose-generic: unknown domain '${domain}'`);

  // Pull atomic rows for this speaker + subject. Filter out
  // insufficient_signal rows so the dominant rollup only weighs
  // judgable calls.
  const { rows: atomic } = await _pool.query(
    `select id, speaker, subject, statement_id, statement_date,
            statement_source_url, statement_quote, stance_value,
            stance_confidence, blurb, rationale
     from ${cfg.atomic_table}
     where speaker = $1 and subject = $2
       and stance_value != $3
     order by statement_date desc nulls last`,
    [speaker, subject, cfg.insufficient_label]
  );

  if (atomic.length < MIN_ROWS_FOR_COMPOSE) {
    return {
      row: null,
      skipped_reason: `below MIN_ROWS_FOR_COMPOSE (${atomic.length} < ${MIN_ROWS_FOR_COMPOSE})`,
    };
  }

  const stance_summary = buildStanceSummary(atomic, cfg.stance_values);
  const { dominant_stance, dominant_confidence } = computeDominant(atomic, cfg.stance_values);
  const top_blurbs = pickTopBlurbs(atomic, TOP_BLURBS_FOR_PROMPT);
  const eventDate = atomic[0]?.statement_date ? fmtDate(atomic[0].statement_date) : null;

  // Comparison speaker pull (optional)
  let comparison_blurbs = [];
  let comparison_dominant = null;
  if (comparison_speaker) {
    const { rows: compRows } = await _pool.query(
      `select id, speaker, subject, statement_id, statement_date,
              statement_quote, stance_value, stance_confidence, blurb
       from ${cfg.atomic_table}
       where speaker = $1 and subject = $2
         and stance_value != $3
       order by statement_date desc nulls last`,
      [comparison_speaker, subject, cfg.insufficient_label]
    );
    if (compRows.length >= 1) {
      comparison_blurbs = pickTopBlurbs(compRows, 3);
      const compDominant = computeDominant(compRows, cfg.stance_values);
      comparison_dominant = compDominant.dominant_stance;
    }
  }

  const sysPrompt = buildSystemPrompt(cfg);
  const userPrompt = buildUserPrompt({
    speaker, subject, event_date: eventDate,
    dominant_stance, dominant_confidence,
    stance_summary, top_blurbs,
    comparison_speaker,
    comparison_blurbs,
    comparison_dominant,
    cfg,
  });

  // Up to 2 attempts on hard-reject. Soft-validate accepts on first pass.
  let parsed = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  let stance_disagreement = null;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await _anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: sysPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
    } catch (err) {
      lastError = err.message || String(err);
      break;
    }
    usage.input_tokens += response.usage?.input_tokens || 0;
    usage.output_tokens += response.usage?.output_tokens || 0;
    const candidate = parseEventBlurb(response.content?.[0]?.text || '', cfg);
    if (!candidate) {
      lastError = `parse_or_voice_check_failed (attempt ${attempt + 1})`;
      continue;
    }
    const verdict = classifyStanceDisagreement(dominant_stance, candidate.dominant_stance_called, cfg.opposite_directions);
    if (verdict.action === 'accept') { parsed = candidate; break; }
    if (verdict.action === 'soft_validate') {
      parsed = candidate;
      stance_disagreement = verdict.disagreement;
      break;
    }
    lastError = `opposite_direction_disagreement (attempt ${attempt + 1}): computed=${dominant_stance} model=${candidate.dominant_stance_called}`;
  }

  return {
    row: {
      domain,
      speaker,
      subject,
      event_type: event_type || 'statement',
      event_date: eventDate,
      stance_axis: cfg.stance_axis_id,
      stance_value: dominant_stance,
      dominant_stance,                     // schema-shared with Fed
      dominant_confidence,
      stance_summary,
      compared_to_speaker: comparison_speaker || null,
      comparison_yielded_no_divergence: comparison_speaker && (!comparison_blurbs.length || comparison_dominant === dominant_stance),
      composer_model: MODEL,
      // Source URL for the event = most recent statement URL
      source_url: atomic[0]?.statement_source_url || null,
    },
    parsed,
    usage,
    stance_disagreement,
    error: parsed ? null : lastError,
  };
}

/**
 * Upsert the composed mention_event. Slug encodes subject:
 * `<speaker>-<subject>-<date>` (e.g. trump-iran-2026-05-01). Preserves
 * `published` across recompose; never flips it.
 */
async function upsertEvent(client, row, parsed, stance_disagreement) {
  const slug = `${row.speaker}-${row.subject}-${row.event_date}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const title = `${row.speaker} · ${row.subject} · ${row.event_date}`;
  const event_at = row.event_date ? `${row.event_date}T12:00:00Z` : new Date().toISOString();
  const blurb = parsed ? parsed.event_blurb : null;
  const sourceOrg = (domains.get(row.domain) || {}).source_org || 'Public statement';

  await client.query(`
    insert into mention_events
      (slug, title, speaker, event_type, event_at, source_org, blurb, status,
       event_date, source_url, stance_summary,
       dominant_stance, dominant_confidence, compared_to_speaker,
       composed_at, composer_model, stance_disagreement,
       comparison_yielded_no_divergence, domain,
       subject, stance_axis, stance_value)
    values
      ($1,$2,$3,$4,$5,$6,$7,$8,
       $9,$10,$11,
       $12,$13,$14,
       now(),$15,$16,
       $17,$18,
       $19,$20,$21)
    on conflict (slug)
    do update set
      title = excluded.title,
      blurb = excluded.blurb,
      event_at = excluded.event_at,
      source_url = excluded.source_url,
      stance_summary = excluded.stance_summary,
      dominant_stance = excluded.dominant_stance,
      dominant_confidence = excluded.dominant_confidence,
      compared_to_speaker = excluded.compared_to_speaker,
      composed_at = now(),
      composer_model = excluded.composer_model,
      stance_disagreement = excluded.stance_disagreement,
      comparison_yielded_no_divergence = excluded.comparison_yielded_no_divergence,
      domain = excluded.domain,
      subject = excluded.subject,
      stance_axis = excluded.stance_axis,
      stance_value = excluded.stance_value,
      updated_at = now()
  `, [
    slug, title, row.speaker, row.event_type, event_at, sourceOrg, blurb, 'past',
    row.event_date, row.source_url, JSON.stringify(row.stance_summary),
    row.dominant_stance, row.dominant_confidence, row.compared_to_speaker,
    row.composer_model, stance_disagreement ? JSON.stringify(stance_disagreement) : null,
    row.comparison_yielded_no_divergence, row.domain,
    row.subject, row.stance_axis, row.stance_value,
  ]);
  return slug;
}

/**
 * Public entry — compose one event end-to-end.
 * Returns { mode, slug, est_cost_usd, ... } similar to compose.run().
 */
async function run(opts = {}) {
  if (!_pool) throw new Error('compose-generic.init() must be called first');
  if (!_anthropic) throw new Error('compose-generic.init() must be called first');

  const { domain, speaker, subject, comparison_speaker, event_type, dryRun } = opts;
  if (!domain || !speaker || !subject) {
    throw new Error('compose-generic.run: domain, speaker, subject required');
  }

  const startedAt = Date.now();
  const result = await composeOne({ domain, speaker, subject, comparison_speaker, event_type });

  if (result.skipped_reason) {
    return {
      mode: 'skipped',
      reason: result.skipped_reason,
      duration_ms: Date.now() - startedAt,
    };
  }

  if (dryRun) {
    return {
      mode: 'dry_run',
      row: result.row,
      parsed: result.parsed,
      usage: result.usage,
      duration_ms: Date.now() - startedAt,
    };
  }

  if (!result.parsed) {
    return {
      mode: 'error',
      error: result.error,
      duration_ms: Date.now() - startedAt,
    };
  }

  let slug;
  const client = await _pool.connect();
  try {
    slug = await upsertEvent(client, result.row, result.parsed, result.stance_disagreement);
  } finally {
    client.release();
  }

  const inputT = result.usage?.input_tokens || 0;
  const outputT = result.usage?.output_tokens || 0;
  const estCost = (inputT / 1_000_000) * PRICE_INPUT_PER_1M + (outputT / 1_000_000) * PRICE_OUTPUT_PER_1M;

  return {
    mode: 'live',
    slug,
    speaker,
    subject,
    domain,
    dominant_stance: result.row.dominant_stance,
    dominant_confidence: result.row.dominant_confidence,
    stance_disagreement: result.stance_disagreement,
    tokens: { input: inputT, output: outputT },
    est_cost_usd: +estCost.toFixed(4),
    duration_ms: Date.now() - startedAt,
  };
}

module.exports = {
  init,
  run,
  // exported for testability + Phase 4.3 dedup
  getDomainConfig,
  computeDominant,
  buildStanceSummary,
  pickTopBlurbs,
  classifyStanceDisagreement,
  parseEventBlurb,
  buildSystemPrompt,
  buildUserPrompt,
  DOMAIN_CONFIGS,
  MODEL,
  MIN_ROWS_FOR_COMPOSE,
};
