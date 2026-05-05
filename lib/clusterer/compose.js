/**
 * lib/clusterer/compose.js
 *
 * Phase 2f — speaker-driven mention_event composition. For each transcript,
 * rolls up the speaker's atomic stance calls (from speaker_word_stance ×
 * transcript_word_counts), generates an event-level narrative blurb via
 * Claude Sonnet 4.6, and writes one mention_event row per transcript.
 *
 * Path A only — one event per (speaker, transcript). Path B (term-cluster
 * events spanning multiple speakers) is deferred.
 *
 * Decisions baked in (Phase 2f brief + concrete proposal):
 *   - Bulk compose all 86 transcripts; published defaults false (preserved
 *     across recompose — composer never flips published)
 *   - MIN_ROWS_FOR_COMPOSE = 3 (below: row exists, blurb null, published false)
 *   - Hard-reject opposite-direction stance disagreement (hawkish ↔ dovish)
 *     with one retry; if still opposite, blurb=null + editorial review
 *   - Soft-validate same-axis disagreement (hawkish↔neutral, dovish↔neutral):
 *     accept blurb, log to stance_disagreement field
 *   - comparison_yielded_no_divergence flag when compared_to_speaker is set
 *     but no same-word divergent rows exist (don't fabricate divergence)
 *   - Test fixture via MENTION_COMPARISON_OVERRIDES env var
 *     (format: "transcript_id_1:Powell,transcript_id_2:Powell")
 *
 * Cost: ~$0.57 per full pass at Sonnet 4.6 pricing.
 */

'use strict';

const domains = require('./domains');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 600;
const MIN_ROWS_FOR_COMPOSE = 3;
const TOP_BLURBS_FOR_PROMPT = 5;
const DEFAULT_CONCURRENCY = 4;
const MIN_BLURB_WORDS = 50;
const MAX_BLURB_WORDS = 110;

const PRICE_INPUT_PER_1M = 3.00;
const PRICE_OUTPUT_PER_1M = 15.00;

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

let _pool = null;
let _anthropic = null;

function init(opts) {
  if (!opts?.pool) throw new Error('compose.init: opts.pool required');
  if (!opts?.anthropic) throw new Error('compose.init: opts.anthropic required');
  _pool = opts.pool;
  _anthropic = opts.anthropic;
}

/**
 * Parse MENTION_COMPARISON_OVERRIDES env var into a Map(transcript_id → speaker).
 * Format: "uuid1:Powell,uuid2:Powell". Bad entries are skipped, not thrown.
 */
function parseOverrides(envStr) {
  const map = new Map();
  if (!envStr) return map;
  for (const pair of String(envStr).split(',')) {
    const [tid, sp] = pair.split(':').map(s => (s || '').trim());
    if (tid && sp) map.set(tid, sp);
  }
  return map;
}

const SYSTEM_PROMPT =
  'You write event-level narrative blurbs about U.S. Federal Reserve officials\' rhetorical posture across a single speech, press conference, or testimony. ' +
  'Voice rules (locked):\n' +
  '- Observational, not editorial. Report what the speaker said. Do not call the stance correct, prescient, or notable.\n' +
  '- Active voice. Third person. Never address the reader.\n' +
  '- Default dry and numerate. Lean briefly warm only when a finding is genuinely surprising.\n' +
  '- No emoji. No exclamation points. Max one em-dash.\n' +
  '- At most one quote, ≤ 15 words, pulled verbatim from the atomic blurbs supplied.\n' +
  '- 60 to 100 words.\n' +
  '- Banned editorial flourishes: notably, interestingly, remarkably, importantly.\n' +
  '\nRequirements specific to the event blurb:\n' +
  '- Lead with the dominant stance call ("Brainard struck hawkish across...")\n' +
  '- Reference 2-3 specific terms by name from the atomic blurbs\n' +
  '- Include the event date in natural prose form ("at the Sep 2022 FOMC presser")\n' +
  '- If a comparison speaker is supplied AND divergent rows are listed, include exactly one divergence sentence\n' +
  '- If no divergent rows are listed (comparison_yielded_no_divergence), do NOT mention the comparison speaker — write a solo stance summary instead\n' +
  '\nOutput a single JSON object, no surrounding prose:\n' +
  '{\n' +
  '  "event_blurb": "<60-100 words>",\n' +
  '  "dominant_stance_called": "hawkish" | "dovish" | "neutral",\n' +
  '  "comparison_used": <true|false>,\n' +
  '  "word_count": <integer>,\n' +
  '  "terms_referenced": ["<word>", "<word>"]\n' +
  '}';

function fmtDate(d) {
  if (!d) return null;
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Compute dominant stance + confidence from a list of stance rows.
 * Dominant stance = mode (most-frequent llm_stance excluding insufficient).
 * Dominant confidence = mode of llm_confidence values across rows.
 * Ties broken: hawkish > dovish > neutral on stance; high > medium > low on confidence.
 */
function computeDominant(rows) {
  if (!rows.length) return { dominant_stance: null, dominant_confidence: null };
  const stanceCounts = { hawkish: 0, dovish: 0, neutral: 0 };
  const confCounts = { high: 0, medium: 0, low: 0 };
  for (const r of rows) {
    if (r.llm_stance in stanceCounts) stanceCounts[r.llm_stance]++;
    if (r.llm_confidence in confCounts) confCounts[r.llm_confidence]++;
  }
  const stanceOrder = ['hawkish', 'dovish', 'neutral'];
  const confOrder = ['high', 'medium', 'low'];
  let dominant_stance = stanceOrder[0];
  for (const s of stanceOrder) {
    if (stanceCounts[s] > stanceCounts[dominant_stance]) dominant_stance = s;
  }
  if (stanceCounts[dominant_stance] === 0) dominant_stance = null;
  let dominant_confidence = confOrder[0];
  for (const c of confOrder) {
    if (confCounts[c] > confCounts[dominant_confidence]) dominant_confidence = c;
  }
  if (confCounts[dominant_confidence] === 0) dominant_confidence = null;
  return { dominant_stance, dominant_confidence };
}

/**
 * Build stance_summary jsonb from rows.
 * Shape: { hawkish: [word, word, ...], dovish: [...], neutral: [...] }
 */
function buildStanceSummary(rows) {
  const out = { hawkish: [], dovish: [], neutral: [] };
  for (const r of rows) {
    if (r.llm_stance in out) out[r.llm_stance].push(r.word);
  }
  return out;
}

/**
 * Pick the top-N atomic blurbs to feed the event-level prompt.
 * Rank by llm_confidence (high>medium>low), then by rate_ratio descending.
 */
function pickTopBlurbs(rows, n) {
  return [...rows]
    .filter(r => r.blurb && r.blurb.trim().length > 0)
    .sort((a, b) => {
      const ca = CONFIDENCE_RANK[a.llm_confidence] || 0;
      const cb = CONFIDENCE_RANK[b.llm_confidence] || 0;
      if (cb !== ca) return cb - ca;
      const ra = parseFloat(a.rate_ratio) || 0;
      const rb = parseFloat(b.rate_ratio) || 0;
      return rb - ra;
    })
    .slice(0, n);
}

/**
 * Find same-word divergent rows between this speaker's stance set and the
 * comparison speaker's stance set. Returns [{ word, this_stance, other_stance, other_blurb }].
 * "Divergent" = different non-insufficient_signal llm_stance values on the same word.
 */
async function fetchDivergentRows(speakerWords, comparedSpeaker) {
  if (!comparedSpeaker || speakerWords.length === 0) return [];
  // speakerWords is [{ word, llm_stance }]; we want comparison rows on those same words.
  const words = speakerWords.map(w => w.word);
  const { rows: otherRows } = await _pool.query(
    `select word, llm_stance, llm_confidence, blurb
     from speaker_word_stance
     where speaker = $1 and word = any($2)
       and llm_stance is not null
       and llm_stance != 'insufficient_signal'`,
    [comparedSpeaker, words]
  );
  const otherByWord = new Map(otherRows.map(r => [r.word, r]));
  const divergent = [];
  for (const sw of speakerWords) {
    const other = otherByWord.get(sw.word);
    if (!other) continue;
    if (other.llm_stance !== sw.llm_stance) {
      divergent.push({
        word: sw.word,
        this_stance: sw.llm_stance,
        other_stance: other.llm_stance,
        other_blurb: other.blurb || '',
      });
    }
  }
  return divergent;
}

function buildUserPrompt({
  speaker, event_date, event_type, source_url,
  dominant_stance, dominant_confidence,
  stance_summary, top_blurbs, divergent_rows,
  compared_to_speaker, comparison_yielded_no_divergence,
}) {
  const lines = [
    `Speaker: ${speaker}`,
    `Event date: ${event_date || 'unknown'}`,
    `Event type: ${event_type}`,
    source_url ? `Source: ${source_url}` : null,
    '',
    `Computed dominant stance: ${dominant_stance || 'n/a'} (confidence: ${dominant_confidence || 'n/a'})`,
    `Stance summary by word:`,
    `  hawkish: ${stance_summary.hawkish.join(', ') || '(none)'}`,
    `  dovish:  ${stance_summary.dovish.join(', ') || '(none)'}`,
    `  neutral: ${stance_summary.neutral.join(', ') || '(none)'}`,
    '',
    `Top atomic blurbs (highest confidence first):`,
  ].filter(Boolean);

  top_blurbs.forEach((b, i) => {
    lines.push(`${i + 1}. [${b.word} / ${b.llm_stance} / ${b.llm_confidence}] ${b.blurb}`);
  });

  if (compared_to_speaker) {
    lines.push('');
    if (comparison_yielded_no_divergence) {
      lines.push(`Comparison speaker: ${compared_to_speaker}`);
      lines.push('NO same-word divergent rows found. Do NOT mention the comparison speaker. Write a solo stance summary.');
    } else {
      lines.push(`Comparison speaker: ${compared_to_speaker}`);
      lines.push(`Same-word divergent rows (${compared_to_speaker} differed on these terms):`);
      divergent_rows.forEach((d, i) => {
        lines.push(`${i + 1}. "${d.word}": this speaker = ${d.this_stance}, ${compared_to_speaker} = ${d.other_stance}`);
        if (d.other_blurb) lines.push(`   ${compared_to_speaker}'s blurb: ${d.other_blurb}`);
      });
      lines.push('Include exactly one divergence sentence in the event blurb.');
    }
  }

  lines.push('');
  lines.push('Write the event blurb. Output JSON only.');
  return lines.join('\n');
}

const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u;

function parseEventBlurb(raw) {
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
  const blurb = typeof parsed.event_blurb === 'string' ? parsed.event_blurb.trim() : '';
  if (!blurb) return null;
  if (EMOJI_RE.test(blurb)) return null;
  if (blurb.includes('!')) return null;
  const wordCount = blurb.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_BLURB_WORDS || wordCount > MAX_BLURB_WORDS) return null;
  const stance = String(parsed.dominant_stance_called || '').toLowerCase();
  if (!['hawkish', 'dovish', 'neutral'].includes(stance)) return null;
  return {
    event_blurb: blurb,
    dominant_stance_called: stance,
    comparison_used: !!parsed.comparison_used,
    word_count: wordCount,
    terms_referenced: Array.isArray(parsed.terms_referenced) ? parsed.terms_referenced.slice(0, 10) : [],
  };
}

/**
 * Decide what to do with a stance disagreement between computed dominant
 * and model's self-reported dominant_stance_called.
 *
 * Returns:
 *   { action: 'accept' }                                — match
 *   { action: 'soft_validate', disagreement: {...} }   — same-axis (one is neutral)
 *   { action: 'hard_reject' }                           — opposite-direction (hawkish ↔ dovish)
 */
function classifyStanceDisagreement(computed, modelCalled) {
  if (!computed || !modelCalled) return { action: 'accept' };
  if (computed === modelCalled) return { action: 'accept' };
  const oppositeDirection =
    (computed === 'hawkish' && modelCalled === 'dovish') ||
    (computed === 'dovish' && modelCalled === 'hawkish');
  if (oppositeDirection) return { action: 'hard_reject' };
  return {
    action: 'soft_validate',
    disagreement: { computed, model_called: modelCalled, axis: 'same' },
  };
}

/**
 * Compose one transcript into a mention_event row. Returns:
 *   { row, prompt, parsed, error, usage, stance_disagreement,
 *     comparison_yielded_no_divergence, skipped_reason }
 *
 * Pure orchestration around the SQL + prompt; doesn't write to DB.
 * Caller decides whether to upsert.
 */
async function composeOne(transcript, overrides) {
  const compared_to_speaker = overrides.get(transcript.id) || null;

  // Pull stance rows for this speaker on words that appear in this transcript.
  const { rows: stanceRows } = await _pool.query(
    `select sws.id, sws.word, sws.llm_stance, sws.llm_confidence, sws.llm_rationale,
            sws.blurb, sws.rate_ratio
     from speaker_word_stance sws
     join transcript_word_counts twc
       on twc.word = sws.word and twc.raw_count > 0
     where sws.speaker = $1
       and twc.transcript_id = $2
       and sws.llm_stance is not null
       and sws.llm_stance != 'insufficient_signal'
     order by sws.word`,
    [transcript.speaker, transcript.id]
  );

  if (stanceRows.length < MIN_ROWS_FOR_COMPOSE) {
    return {
      row: {
        source_transcript_id: transcript.id,
        speaker: transcript.speaker,
        event_date: fmtDate(transcript.transcript_date),
        event_type: transcript.event_type,
        source_url: transcript.source_url,
        domain: transcript.domain || domains.forSpeaker(transcript.speaker),
        stance_summary: buildStanceSummary(stanceRows),
        dominant_stance: null,
        dominant_confidence: null,
        compared_to_speaker,
        composer_model: MODEL,
        comparison_yielded_no_divergence: false,
      },
      prompt: null,
      parsed: null,
      usage: null,
      skipped_reason: `below MIN_ROWS_FOR_COMPOSE (${stanceRows.length} < ${MIN_ROWS_FOR_COMPOSE})`,
    };
  }

  const stance_summary = buildStanceSummary(stanceRows);
  const { dominant_stance, dominant_confidence } = computeDominant(stanceRows);
  const top_blurbs = pickTopBlurbs(stanceRows, TOP_BLURBS_FOR_PROMPT);

  let divergent_rows = [];
  let comparison_yielded_no_divergence = false;
  if (compared_to_speaker) {
    const speakerWords = stanceRows.map(r => ({ word: r.word, llm_stance: r.llm_stance }));
    divergent_rows = await fetchDivergentRows(speakerWords, compared_to_speaker);
    comparison_yielded_no_divergence = divergent_rows.length === 0;
  }

  const prompt = buildUserPrompt({
    speaker: transcript.speaker,
    event_date: fmtDate(transcript.transcript_date),
    event_type: transcript.event_type,
    source_url: transcript.source_url,
    dominant_stance, dominant_confidence,
    stance_summary, top_blurbs, divergent_rows,
    compared_to_speaker, comparison_yielded_no_divergence,
  });

  // Up to 2 attempts on hard-reject; soft-validate accepts on first pass.
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
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      lastError = err.message || String(err);
      break;
    }
    usage.input_tokens += response.usage?.input_tokens || 0;
    usage.output_tokens += response.usage?.output_tokens || 0;
    const candidate = parseEventBlurb(response.content?.[0]?.text || '');
    if (!candidate) {
      lastError = `parse_or_voice_check_failed (attempt ${attempt + 1})`;
      continue;
    }
    const verdict = classifyStanceDisagreement(dominant_stance, candidate.dominant_stance_called);
    if (verdict.action === 'accept') {
      parsed = candidate;
      break;
    }
    if (verdict.action === 'soft_validate') {
      parsed = candidate;
      stance_disagreement = verdict.disagreement;
      break;
    }
    // hard_reject: retry once
    lastError = `opposite_direction_disagreement (attempt ${attempt + 1}): computed=${dominant_stance} model=${candidate.dominant_stance_called}`;
  }

  return {
    row: {
      source_transcript_id: transcript.id,
      speaker: transcript.speaker,
      event_date: fmtDate(transcript.transcript_date),
      event_type: transcript.event_type,
      source_url: transcript.source_url,
      stance_summary,
      dominant_stance,
      dominant_confidence,
      compared_to_speaker,
      composer_model: MODEL,
      comparison_yielded_no_divergence,
    },
    prompt,
    parsed,
    usage,
    stance_disagreement,
    error: parsed ? null : lastError,
  };
}

/**
 * Upsert one composed row into mention_events. Preserves `published`
 * across recompose (never flips it). Slug is derived from speaker + date.
 */
async function upsertEvent(client, row, parsed, stance_disagreement) {
  const slug = `${row.speaker}-${row.event_date}-${row.event_type}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const title = `${row.speaker} · ${row.event_type} · ${row.event_date}`;
  const event_at = row.event_date ? `${row.event_date}T12:00:00Z` : new Date().toISOString();
  const blurb = parsed ? parsed.event_blurb : null;
  // Domain resolution: prefer the explicit value the caller passed in
  // (read from transcripts.domain by composeOne), fall back to speaker
  // lookup, ultimately default to 'fed' for back-compat with the
  // existing Fed-only corpus. source_org is keyed off the domain so
  // future ingestions (Trump → 'White House', Musk → 'Tesla') get the
  // right attribution without a per-call argument.
  const domain = row.domain || domains.forSpeaker(row.speaker) || 'fed_monetary_policy';
  const domainCfg = domains.get(domain) || {};
  const sourceOrg = domainCfg.source_org || 'Federal Reserve';
  // stance_axis is per-domain; stance_value mirrors the per-event
  // dominant for now (free-text in DB, registry-driven enum in app).
  // Subject is null for Fed events — Powell/Warsh don't carry a
  // single named subject the way Trump→Iran does. Future per-domain
  // ingestion writes subject explicitly.
  const stanceAxis = domainCfg.stance_axis_id || null;
  const stanceValue = row.dominant_stance || null;
  const subject = row.subject || null;
  const marketRelevanceScore = row.market_relevance_score != null ? row.market_relevance_score : null;

  // Insert or update by source_transcript_id (1:1 grain). Preserve published.
  await client.query(`
    insert into mention_events
      (slug, title, speaker, event_type, event_at, source_org, blurb, status,
       source_transcript_id, event_date, source_url, stance_summary,
       dominant_stance, dominant_confidence, compared_to_speaker,
       composed_at, composer_model, stance_disagreement,
       comparison_yielded_no_divergence, domain,
       subject, stance_axis, stance_value, market_relevance_score)
    values
      ($1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12,
       $13, $14, $15,
       now(), $16, $17,
       $18, $19,
       $20, $21, $22, $23)
    on conflict (source_transcript_id) where source_transcript_id is not null
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
      market_relevance_score = coalesce(excluded.market_relevance_score, mention_events.market_relevance_score),
      updated_at = now()
  `, [
    slug, title, row.speaker, row.event_type, event_at, sourceOrg,
    blurb, 'past',
    row.source_transcript_id, row.event_date, row.source_url, JSON.stringify(row.stance_summary),
    row.dominant_stance, row.dominant_confidence, row.compared_to_speaker,
    row.composer_model, stance_disagreement ? JSON.stringify(stance_disagreement) : null,
    row.comparison_yielded_no_divergence, domain,
    subject, stanceAxis, stanceValue, marketRelevanceScore,
  ]);
}

/**
 * Run the composer.
 *
 * Options (mirror judge / blurb endpoints):
 *   - transcript_id:  compose one specific transcript
 *   - limit:          cap rows
 *   - dryRun:         build prompts only; no API call, no DB write
 *   - sample:         in dry-run, also live-call first N
 *   - concurrency:    parallel API calls (default 4, max 8)
 */
async function run(opts = {}) {
  if (!_pool) throw new Error('compose.init() must be called first');
  if (!_anthropic) throw new Error('compose.init() must be called first');

  const transcript_id = opts.transcript_id || null;
  const limit = Math.max(0, parseInt(opts.limit, 10) || 0);
  const dryRun = !!opts.dryRun;
  const sample = Math.max(0, parseInt(opts.sample, 10) || 0);
  const concurrency = Math.max(1, Math.min(8, parseInt(opts.concurrency, 10) || DEFAULT_CONCURRENCY));

  const startedAt = Date.now();
  const overrides = parseOverrides(process.env.MENTION_COMPARISON_OVERRIDES);

  const params = [];
  let where = '';
  if (transcript_id) {
    params.push(transcript_id);
    where = `where id = $${params.length}`;
  }
  let sql = `select id, speaker, event_type, source_url, transcript_date, domain from transcripts ${where} order by transcript_date desc`;
  if (limit > 0) {
    params.push(limit);
    sql += ` limit $${params.length}`;
  }
  const { rows: transcripts } = await _pool.query(sql, params);

  if (transcripts.length === 0) {
    return {
      mode: dryRun ? 'dry_run' : 'live',
      transcripts_processed: 0,
      events_written: 0,
      message: 'no transcripts matched filter',
      duration_ms: Date.now() - startedAt,
    };
  }

  // Dry-run path
  if (dryRun) {
    const previews = [];
    for (let i = 0; i < transcripts.length; i++) {
      const result = await composeOne(transcripts[i], overrides);
      const out = {
        transcript_id: transcripts[i].id,
        speaker: transcripts[i].speaker,
        event_date: fmtDate(transcripts[i].transcript_date),
        compared_to_speaker: result.row.compared_to_speaker,
        comparison_yielded_no_divergence: result.row.comparison_yielded_no_divergence,
        stance_summary: result.row.stance_summary,
        dominant_stance: result.row.dominant_stance,
        skipped_reason: result.skipped_reason || null,
        prompt: result.prompt,
      };
      if (i < sample && !result.skipped_reason) {
        out.parsed = result.parsed;
        out.error = result.error;
        out.usage = result.usage;
        out.stance_disagreement = result.stance_disagreement;
      }
      previews.push(out);
    }
    return {
      mode: 'dry_run',
      transcripts_processed: transcripts.length,
      events_written: 0,
      sample_called: sample,
      previews,
      duration_ms: Date.now() - startedAt,
    };
  }

  // Live path
  let inputTokensTotal = 0;
  let outputTokensTotal = 0;
  let writes = 0;
  let skipped = 0;
  const failures = [];
  const counters = {
    by_dominant_stance: { hawkish: 0, dovish: 0, neutral: 0, null: 0 },
    soft_validated: 0,
    no_divergence_flagged: 0,
  };

  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= transcripts.length) return;
      const t = transcripts[idx];
      const result = await composeOne(t, overrides);
      inputTokensTotal += result.usage?.input_tokens || 0;
      outputTokensTotal += result.usage?.output_tokens || 0;

      if (result.skipped_reason) {
        // Still upsert the row (so downstream FK joins work) but with null blurb.
        try {
          const client = await _pool.connect();
          try { await upsertEvent(client, result.row, null, null); writes++; }
          finally { client.release(); }
          skipped++;
        } catch (err) {
          failures.push({ transcript_id: t.id, speaker: t.speaker, error: 'db_write_failed: ' + err.message });
        }
        continue;
      }
      if (!result.parsed) {
        // Hard-reject after retry → write row without blurb for editorial review.
        try {
          const client = await _pool.connect();
          try { await upsertEvent(client, result.row, null, null); writes++; }
          finally { client.release(); }
          failures.push({ transcript_id: t.id, speaker: t.speaker, error: result.error });
        } catch (err) {
          failures.push({ transcript_id: t.id, speaker: t.speaker, error: 'db_write_failed: ' + err.message });
        }
        continue;
      }
      try {
        const client = await _pool.connect();
        try { await upsertEvent(client, result.row, result.parsed, result.stance_disagreement); writes++; }
        finally { client.release(); }
        const ds = result.row.dominant_stance;
        counters.by_dominant_stance[ds || 'null']++;
        if (result.stance_disagreement) counters.soft_validated++;
        if (result.row.comparison_yielded_no_divergence) counters.no_divergence_flagged++;
      } catch (err) {
        failures.push({ transcript_id: t.id, speaker: t.speaker, error: 'db_write_failed: ' + err.message });
      }
    }
  });

  await Promise.all(workers);

  const estCost =
    (inputTokensTotal / 1_000_000) * PRICE_INPUT_PER_1M +
    (outputTokensTotal / 1_000_000) * PRICE_OUTPUT_PER_1M;

  return {
    mode: 'live',
    transcripts_processed: transcripts.length,
    events_written: writes,
    skipped_below_threshold: skipped,
    failure_count: failures.length,
    failures: failures.slice(0, 10),
    counters,
    tokens: { input: inputTokensTotal, output: outputTokensTotal },
    est_cost_usd: +estCost.toFixed(4),
    duration_ms: Date.now() - startedAt,
  };
}

module.exports = {
  init,
  run,
  // exported for testability
  parseOverrides,
  computeDominant,
  buildStanceSummary,
  pickTopBlurbs,
  classifyStanceDisagreement,
  parseEventBlurb,
  buildUserPrompt,
  SYSTEM_PROMPT,
  MODEL,
  MIN_ROWS_FOR_COMPOSE,
};
