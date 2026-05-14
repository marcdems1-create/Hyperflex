// lib/mention-sync.js
//
// MP-2d orchestrator. Bridges word-markets discovery to our curated
// mention_events table by writing rows into mention_markets.
//
// Two passes:
//   rulePass()  -- runs every 15 min. Fetches all live mention_events,
//                  runs the Polymarket discovery sweep via word-markets.js,
//                  scores each (group, mention_event) pair via
//                  scoreEventGroupAgainstMentionEvent, and upserts
//                  mention_markets rows. Score >= 0.85 -> method='rule'.
//                  0.40-0.85 -> method=NULL (left for LLM). <0.40 -> skipped.
//                  Always refreshes market metrics on existing rows.
//
//   llmPass()   -- runs every hour. SELECTs mention_markets rows with
//                  classification_method IS NULL (rule-pass ambiguities).
//                  Asks Claude Sonnet 4.6 per row: does this Polymarket
//                  market actually belong to this mention_event? Confirm
//                  -> method='llm' + LLM's confidence. Reject -> method='none'
//                  (so neither pass re-evaluates it next cycle; mention_event
//                  metadata edits would need a manual re-classify trigger).
//
// Per Marc's spec: LLM pass SKIPS method='rule' rows. Locked matches don't
// burn budget every hour. Manual overrides ('manual') are sacred -- nothing
// in either pass touches them.
//
// Both passes log to classification_runs. Health endpoint reads from there.

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const wm = require('./word-markets');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 280;
const LLM_TIMEOUT_MS = 25000;
const LLM_MAX_PER_RUN = 30;  // cap budget per hourly invocation

let _anthropic = null;
function _claude() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

// Mention_event row shape needed by the matcher. Keep the SELECT
// tight so we're not pulling blurbs into every classification run.
const MENTION_EVENT_COLS = `
  id, slug, title, speaker, subject, domain,
  event_type, event_date, event_at, published, status
`;

async function _fetchCuratedMentionEvents(dbQuery) {
  // All non-archived rows. Published=false events are still classifiable
  // (they're the bulk of the 86 composed events). Drafts will surface
  // their linked markets once promoted to published.
  const rows = await dbQuery(`
    SELECT ${MENTION_EVENT_COLS}
    FROM mention_events
    WHERE status IS NULL OR status != 'archived'
  `);
  return rows || [];
}

async function _openRun(dbQuery) {
  const rows = await dbQuery(`
    INSERT INTO classification_runs (started_at, status)
    VALUES (NOW(), 'running')
    RETURNING id, started_at
  `);
  return rows && rows[0] ? rows[0] : null;
}

async function _closeRun(dbQuery, runId, fields) {
  if (!runId) return;
  const f = fields || {};
  await dbQuery(`
    UPDATE classification_runs
    SET finished_at         = NOW(),
        candidates_examined = $2,
        rule_matched        = $3,
        llm_matched         = $4,
        llm_calls           = $5,
        no_match            = $6,
        duration_ms         = $7,
        status              = $8,
        error               = $9,
        notes               = $10
    WHERE id = $1
  `, [
    runId,
    f.candidates_examined | 0,
    f.rule_matched        | 0,
    f.llm_matched         | 0,
    f.llm_calls           | 0,
    f.no_match            | 0,
    f.duration_ms         | 0,
    f.status || 'success',
    f.error  || null,
    f.notes  || null,
  ]);
}

// Upsert one (mention_event, sub-market) pair. Market metrics always
// refresh; classification fields refresh only when nothing higher-trust
// is locked in (i.e. not 'manual', 'llm', or 'none').
async function _upsertMentionMarket(dbQuery, args) {
  const { mentionEventId, market, runId, method, confidence } = args;
  await dbQuery(`
    INSERT INTO mention_markets (
      event_id, condition_id, market_question,
      yes_price, no_price, volume_24h, last_synced_at,
      classification_method, classification_confidence, classification_run_id, last_classified_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, NOW())
    ON CONFLICT (event_id, condition_id) DO UPDATE SET
      market_question = COALESCE(EXCLUDED.market_question, mention_markets.market_question),
      yes_price       = EXCLUDED.yes_price,
      no_price        = EXCLUDED.no_price,
      volume_24h      = EXCLUDED.volume_24h,
      last_synced_at  = NOW()
  `, [
    mentionEventId,
    market.condition_id,
    market.question || null,
    market.yes_price != null ? market.yes_price : null,
    market.yes_price != null ? (1 - market.yes_price) : null,
    market.volume_24h || 0,
    method,
    confidence,
    runId,
  ]);

  // Classification refresh: only when nothing more trusted is locked.
  // 'manual' is sacred; 'llm' and 'none' are LLM-pass decisions that
  // shouldn't be clobbered by the cheap rule pass.
  await dbQuery(`
    UPDATE mention_markets
    SET classification_method     = $3,
        classification_confidence = $4,
        classification_run_id     = $5,
        last_classified_at        = NOW()
    WHERE event_id = $1 AND condition_id = $2
      AND coalesce(classification_method, '') NOT IN ('manual', 'llm', 'none')
  `, [mentionEventId, market.condition_id, method, confidence, runId]);
}

// Pick the single best mention_event per Polymarket event group. A
// Polymarket event corresponds to at most one mention_event in our
// schema; if two mention_events tie, surface the conflict as a NOTE
// on the run rather than double-link.
function _pickBestMatch(group, mentionEvents) {
  let best = { score: 0, mentionEvent: null, reasons: [], runnerUp: 0 };
  for (const me of mentionEvents) {
    if (String(me.speaker || '').toLowerCase() !== String(group.speaker || '').toLowerCase()) continue;
    const { score, reasons } = wm.scoreEventGroupAgainstMentionEvent(group, me);
    if (score > best.score) {
      best.runnerUp = best.score;
      best = { score, mentionEvent: me, reasons, runnerUp: best.runnerUp };
    } else if (score > best.runnerUp) {
      best.runnerUp = score;
    }
  }
  return best;
}

/**
 * Rule pass. Runs every 15 min. Pure speaker+date+subject scoring.
 *
 * Returns { runId, examined, ruleMatched, ambiguous, rejected, durationMs }.
 */
async function rulePass(dbQuery, opts = {}) {
  const log = opts.log || (() => {});
  const startedAt = Date.now();
  const run = await _openRun(dbQuery).catch(() => null);
  const runId = run && run.id;
  let examined = 0, ruleMatched = 0, ambiguous = 0, rejected = 0;
  const conflicts = [];

  try {
    const [mentionEvents, groups] = await Promise.all([
      _fetchCuratedMentionEvents(dbQuery),
      wm.getUpcomingWordMarketEvents({ limit: 50 }),
    ]);

    log(`[mention-sync] rule pass: ${mentionEvents.length} mention_events x ${groups.length} polymarket event-groups`);

    for (const group of groups) {
      const best = _pickBestMatch(group, mentionEvents);
      examined++;
      if (!best.mentionEvent) { rejected++; continue; }

      const bucket = wm.classifyScore(best.score);
      if (bucket === 'auto_reject') { rejected++; continue; }

      // Surface near-tie conflicts so curator can disambiguate later.
      if (best.score - best.runnerUp < 0.05 && best.runnerUp >= wm.RULE_PASS_AUTO_REJECT) {
        conflicts.push({
          group_slug:    group.event_slug,
          best_score:    best.score,
          runner_up:     best.runnerUp,
          best_mention:  best.mentionEvent.slug,
        });
      }

      const method = bucket === 'auto_confirm' ? 'rule' : null;
      const conf = Number(best.score.toFixed(2));

      for (const market of (group.markets || [])) {
        if (!market || !market.condition_id) continue;
        await _upsertMentionMarket(dbQuery, {
          mentionEventId: best.mentionEvent.id,
          market,
          runId,
          method,
          confidence: conf,
        }).catch(err => log(`[mention-sync] upsert failed for cid=${market.condition_id}: ${err.message}`));
      }
      if (bucket === 'auto_confirm') ruleMatched++;
      else if (bucket === 'ambiguous') ambiguous++;
    }

    const durationMs = Date.now() - startedAt;
    await _closeRun(dbQuery, runId, {
      candidates_examined: examined,
      rule_matched:        ruleMatched,
      llm_matched:         0,
      llm_calls:           0,
      no_match:            rejected,
      duration_ms:         durationMs,
      status:              'success',
      notes:               JSON.stringify({ pass: 'rule', ambiguous, conflicts: conflicts.slice(0, 10) }),
    });
    log(`[mention-sync] rule pass done: examined=${examined} rule=${ruleMatched} ambiguous=${ambiguous} rejected=${rejected} ${durationMs}ms`);
    return { runId, examined, ruleMatched, ambiguous, rejected, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    await _closeRun(dbQuery, runId, {
      candidates_examined: examined,
      rule_matched:        ruleMatched,
      no_match:            rejected,
      duration_ms:         durationMs,
      status:              'failed',
      error:               String(err && err.message || err).slice(0, 1000),
    }).catch(() => {});
    log(`[mention-sync] rule pass FAILED: ${err.message}`);
    throw err;
  }
}

const LLM_PROMPT_SYSTEM = [
  'You arbitrate whether a Polymarket prediction market belongs to a specific HYPERFLEX mention event.',
  'Output strict JSON: {"decision":"confirm"|"reject","confidence":0.0-1.0,"reason":"<10 words>"}.',
  'CONFIRM only when the market is unambiguously about this speaker AND this event/date AND (for subject-based events) this subject.',
  'REJECT when the market is about a different speaker, different event, different date window, or different subject.',
  'When uncertain, REJECT.',
].join(' ');

function _buildLlmPrompt(mentionEvent, market, group) {
  return [
    `MENTION EVENT:`,
    `  speaker: ${mentionEvent.speaker}`,
    `  event_date: ${mentionEvent.event_date || mentionEvent.event_at || 'unknown'}`,
    `  event_type: ${mentionEvent.event_type || 'unknown'}`,
    `  subject: ${mentionEvent.subject || '(none)'}`,
    `  domain: ${mentionEvent.domain || 'unknown'}`,
    `  slug: ${mentionEvent.slug}`,
    `  title: ${mentionEvent.title || ''}`,
    ``,
    `POLYMARKET CANDIDATE:`,
    `  event_title: ${(group && group.event_title) || ''}`,
    `  event_end_date: ${(group && group.end_date) || 'unknown'}`,
    `  market_question: ${market.market_question || market.question || ''}`,
    `  condition_id: ${market.condition_id}`,
    ``,
    `Return strict JSON.`,
  ].join('\n');
}

function _parseLlmDecision(raw) {
  if (!raw) return null;
  let txt = String(raw).trim();
  // Strip ``` fences if Claude wraps the JSON
  txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const obj = JSON.parse(txt);
    const decision = String(obj.decision || '').toLowerCase();
    if (decision !== 'confirm' && decision !== 'reject') return null;
    const confidence = Math.max(0, Math.min(1, Number(obj.confidence) || 0));
    const reason = String(obj.reason || '').slice(0, 120);
    return { decision, confidence, reason };
  } catch (_) { return null; }
}

async function _askLlm(prompt) {
  const client = _claude();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const resp = await client.messages.create({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     LLM_PROMPT_SYSTEM,
      messages:   [{ role: 'user', content: prompt }],
    }, { signal: ctrl.signal });
    const txt = (resp.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    return _parseLlmDecision(txt);
  } finally {
    clearTimeout(t);
  }
}

/**
 * LLM pass. Runs every hour. Resolves rule-pass ambiguities only.
 *
 * Returns { runId, examined, llmConfirmed, llmRejected, llmCalls, durationMs }.
 */
async function llmPass(dbQuery, opts = {}) {
  const log = opts.log || (() => {});
  const startedAt = Date.now();
  const run = await _openRun(dbQuery).catch(() => null);
  const runId = run && run.id;
  let examined = 0, llmConfirmed = 0, llmRejected = 0, llmCalls = 0;
  const errors = [];

  try {
    // Pick up ambiguities. Locked rows (rule/llm/manual/none) are skipped.
    // Ordered by ambiguity-score-descending so we burn budget on the
    // best candidates first if we hit LLM_MAX_PER_RUN.
    const ambiguous = await dbQuery(`
      SELECT mm.event_id, mm.condition_id, mm.market_question,
             mm.classification_confidence,
             me.id AS me_id, me.slug AS me_slug, me.speaker, me.subject,
             me.domain, me.event_type, me.event_date, me.event_at,
             me.title AS me_title
      FROM mention_markets mm
      JOIN mention_events  me ON me.id = mm.event_id
      WHERE mm.classification_method IS NULL
      ORDER BY mm.classification_confidence DESC NULLS LAST
      LIMIT $1
    `, [LLM_MAX_PER_RUN]);

    log(`[mention-sync] llm pass: ${ambiguous.length} ambiguous rows`);

    for (const row of ambiguous) {
      examined++;
      const mentionEvent = {
        id: row.me_id, slug: row.me_slug, speaker: row.speaker,
        subject: row.subject, domain: row.domain, event_type: row.event_type,
        event_date: row.event_date || row.event_at, title: row.me_title,
      };
      const prompt = _buildLlmPrompt(mentionEvent, {
        condition_id:    row.condition_id,
        market_question: row.market_question,
      }, null);

      let decision = null;
      try {
        decision = await _askLlm(prompt);
        llmCalls++;
      } catch (e) {
        errors.push(`llm_error cid=${row.condition_id}: ${(e.message || e).toString().slice(0, 120)}`);
        continue;
      }

      if (!decision) {
        errors.push(`llm_unparseable cid=${row.condition_id}`);
        continue;
      }

      if (decision.decision === 'confirm') {
        await dbQuery(`
          UPDATE mention_markets
          SET classification_method     = 'llm',
              classification_confidence = $3,
              classification_run_id     = $4,
              last_classified_at        = NOW()
          WHERE event_id = $1 AND condition_id = $2
            AND classification_method IS NULL
        `, [row.event_id, row.condition_id, Number(decision.confidence.toFixed(2)), runId]);
        llmConfirmed++;
      } else {
        await dbQuery(`
          UPDATE mention_markets
          SET classification_method     = 'none',
              classification_confidence = $3,
              classification_run_id     = $4,
              last_classified_at        = NOW()
          WHERE event_id = $1 AND condition_id = $2
            AND classification_method IS NULL
        `, [row.event_id, row.condition_id, Number(decision.confidence.toFixed(2)), runId]);
        llmRejected++;
      }
    }

    const durationMs = Date.now() - startedAt;
    await _closeRun(dbQuery, runId, {
      candidates_examined: examined,
      rule_matched:        0,
      llm_matched:         llmConfirmed,
      llm_calls:           llmCalls,
      no_match:            llmRejected,
      duration_ms:         durationMs,
      status:              errors.length ? 'partial' : 'success',
      error:               errors.length ? errors.slice(0, 5).join(' | ').slice(0, 1000) : null,
      notes:               JSON.stringify({ pass: 'llm' }),
    });
    log(`[mention-sync] llm pass done: examined=${examined} confirmed=${llmConfirmed} rejected=${llmRejected} calls=${llmCalls} ${durationMs}ms`);
    return { runId, examined, llmConfirmed, llmRejected, llmCalls, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    await _closeRun(dbQuery, runId, {
      candidates_examined: examined,
      llm_matched:         llmConfirmed,
      llm_calls:           llmCalls,
      no_match:            llmRejected,
      duration_ms:         durationMs,
      status:              'failed',
      error:               String(err && err.message || err).slice(0, 1000),
    }).catch(() => {});
    log(`[mention-sync] llm pass FAILED: ${err.message}`);
    throw err;
  }
}

// Health summary for the /api/mention-sync/health endpoint. Service-role
// only on the caller side; this function is unprivileged. Returns last
// successful rule run, last successful LLM run, lag from now, and the
// most recent failed run if any.
async function getHealth(dbQuery) {
  const [lastRule, lastLlm, lastFail] = await Promise.all([
    dbQuery(`
      SELECT id, started_at, finished_at, status, candidates_examined,
             rule_matched, no_match, duration_ms
      FROM classification_runs
      WHERE status = 'success' AND notes LIKE '%"pass":"rule"%'
      ORDER BY started_at DESC LIMIT 1
    `),
    dbQuery(`
      SELECT id, started_at, finished_at, status, candidates_examined,
             llm_matched, llm_calls, duration_ms
      FROM classification_runs
      WHERE status IN ('success','partial') AND notes LIKE '%"pass":"llm"%'
      ORDER BY started_at DESC LIMIT 1
    `),
    dbQuery(`
      SELECT id, started_at, finished_at, status, error
      FROM classification_runs
      WHERE status = 'failed'
      ORDER BY started_at DESC LIMIT 1
    `),
  ]);

  const now = Date.now();
  function _lag(row) {
    if (!row || !row.started_at) return null;
    const t = new Date(row.started_at).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.round((now - t) / 1000);
  }

  return {
    now: new Date(now).toISOString(),
    last_rule_pass: lastRule && lastRule[0] ? { ...lastRule[0], lag_seconds: _lag(lastRule[0]) } : null,
    last_llm_pass:  lastLlm  && lastLlm[0]  ? { ...lastLlm[0],  lag_seconds: _lag(lastLlm[0])  } : null,
    last_failure:   lastFail && lastFail[0] ? lastFail[0] : null,
    thresholds: {
      rule_pass_max_age_seconds: 30 * 60,   // alarm if rule lag > 30min (2x cadence)
      llm_pass_max_age_seconds:  3 * 60 * 60,
    },
  };
}

module.exports = {
  rulePass,
  llmPass,
  getHealth,
  // exported for tests / admin diag
  _internals: {
    _pickBestMatch,
    _buildLlmPrompt,
    _parseLlmDecision,
  },
  MODEL,
  LLM_MAX_PER_RUN,
};
