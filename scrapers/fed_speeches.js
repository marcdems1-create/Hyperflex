/**
 * scrapers/fed_speeches.js
 *
 * Federal Reserve speech / testimony transcript ingester. Sibling to
 * scrapers/fed_transcripts.js (which is presconf-only) — speeches and
 * testimony don't have a single Chair speaker derivable from date, so
 * speaker is passed in explicitly per row.
 *
 * Phase 2c.5 uses this to seed Williams / Waller / Brainard (or substitute)
 * speeches as a non-Powell baseline for the clusterer's rate-vs-corpus
 * math. Every row inserted by this module is flagged synthetic_seed=true
 * (migration #52) so downstream phases can filter them out once Phase 2g
 * ships real speech ingestion.
 *
 * Reuses extractTranscriptText() from fed_transcripts.js (the PDF parsing
 * cleanup is identical between presconfs and speeches — both are Fed PDFs
 * with the same page-header / smart-quote / soft-hyphen quirks).
 *
 * Usage:
 *   const fedSpeeches = require('./scrapers/fed_speeches');
 *   fedSpeeches.init({ fetch: _nodeFetch, supabase, computeWordCounts });
 *   await fedSpeeches.ingestOneSpeech({
 *     url:            'https://www.federalreserve.gov/newsevents/speech/files/waller20240126a.pdf',
 *     speaker:        'Waller',
 *     transcriptDate: '2024-01-26',
 *     eventType:      'speech',          // 'speech' | 'testimony'
 *   });
 *   await fedSpeeches.seedAll();         // walks KNOWN_SPEECHES
 */

'use strict';

const { extractTranscriptText, pathAllowedByRobots } = require('./fed_transcripts');

const FED_BASE = 'https://www.federalreserve.gov';
const ROBOTS_URL = `${FED_BASE}/robots.txt`;
const USER_AGENT = 'HYPERFLEX/1.0 (https://hyperflex.network; bot@hyperflex.network)';
const FETCH_DELAY_MS = 1000;
const MAX_RETRIES = 3;
const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let _fetch = null;
let _supabase = null;
let _computeWordCounts = null;
let _robotsCache = null;
let _robotsCachedAt = 0;

function init(opts) {
  if (!opts?.fetch) throw new Error('fed_speeches.init: opts.fetch required');
  if (!opts?.supabase) throw new Error('fed_speeches.init: opts.supabase required');
  if (!opts?.computeWordCounts) throw new Error('fed_speeches.init: opts.computeWordCounts required');
  _fetch = opts.fetch;
  _supabase = opts.supabase;
  _computeWordCounts = opts.computeWordCounts;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchRobots() {
  if (_robotsCache !== null && (Date.now() - _robotsCachedAt) < ROBOTS_CACHE_TTL_MS) {
    return _robotsCache;
  }
  try {
    const res = await _fetch(ROBOTS_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      _robotsCache = await res.text();
      _robotsCachedAt = Date.now();
      return _robotsCache;
    }
  } catch (err) {
    console.warn('[fed_speeches] robots.txt fetch failed, assuming permissive:', err.message);
  }
  _robotsCache = '';
  _robotsCachedAt = Date.now();
  return _robotsCache;
}

async function fetchWithBackoff(url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await _fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 404) return { notFound: true };
      if (res.status === 429 || res.status === 503) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 30000);
        console.warn(`[fed_speeches] ${res.status} on ${url}, waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        throw new Error(`fed.gov ${res.status} ${res.statusText} on ${url}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer };
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
}

/**
 * Hand-curated speech URL list. Each entry includes expectedStance — the
 * editorial guess at how the clusterer SHOULD classify this speaker on
 * average, based on the speech's known framing. After the seed runs, we
 * compare expectedStance vs. the rule-based classifier output to surface
 * exactly where rate-ratio rules disagree with editorial judgment. That
 * delta is the spec for Phase 2d.5 LLM judgment.
 *
 * Sourcing notes:
 *   - URL pattern: https://www.federalreserve.gov/newsevents/speech/files/<lastname><yyyymmdd>a.pdf
 *     (HTM landing pages also work, but the PDF path skips HTML→text
 *     extraction and matches the existing extractTranscriptText helper.)
 *   - Mix dates across 2023-2025 so per-1k normalization has variance
 *   - Pick speeches with topical density on the 30-word vocabulary —
 *     "outlook" / "policy" / "inflation" titles tend to hit; payment /
 *     supervision titles don't
 *   - Brainard left for the NEC in Feb 2023; her archive is real but
 *     thin. Substitute Bostic or Daly if Brainard volume is insufficient.
 *
 * Format per entry:
 *   { url, speaker, date: 'YYYY-MM-DD', eventType: 'speech'|'testimony',
 *     expectedStance: 'hawkish'|'dovish'|'neutral', title (optional, for grep) }
 */
const KNOWN_SPEECHES = [
  // Populated in a follow-up commit. Keep this empty for the skeleton ship
  // so the seed CLI is testable (will report 0 ingests until URLs land).
];

/**
 * Ingest one speech / testimony transcript by URL. Speaker, date, and
 * event_type are passed explicitly — unlike presconfs there's no
 * date-derived chair lookup that can fill them in.
 *
 * @param {object} opts
 * @param {string} opts.url             absolute fed.gov URL to a PDF
 * @param {string} opts.speaker         e.g. 'Waller', 'Williams', 'Brainard'
 * @param {string} opts.transcriptDate  'YYYY-MM-DD' (no time — speech ingest
 *                                      stamps midnight UTC for ordering)
 * @param {string} opts.eventType       'speech' | 'testimony'
 * @param {boolean} [opts.syntheticSeed=true]  flag for the Phase 2c.5 seed
 *
 * @returns {Promise<{ok, transcriptId?, skipped?, error?}>}
 */
async function ingestOneSpeech({ url, speaker, transcriptDate, eventType, syntheticSeed = true }) {
  if (!_fetch) throw new Error('fed_speeches.init() must be called first');
  if (!url || !speaker || !transcriptDate || !eventType) {
    return { ok: false, error: 'url, speaker, transcriptDate, eventType all required' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transcriptDate)) {
    return { ok: false, error: `transcriptDate must be YYYY-MM-DD, got: ${transcriptDate}` };
  }
  if (!['speech', 'testimony'].includes(eventType)) {
    return { ok: false, error: `eventType must be 'speech' or 'testimony', got: ${eventType}` };
  }
  if (!url.startsWith(FED_BASE)) {
    return { ok: false, error: `url must be on ${FED_BASE}, got: ${url}` };
  }

  // robots.txt gate against the URL's path
  const path = url.slice(FED_BASE.length);
  const robots = await fetchRobots();
  if (!pathAllowedByRobots(robots, path)) {
    return { ok: false, skipped: 'blocked by robots.txt', error: null };
  }

  // Normalize to ISO timestamp at noon UTC — keeps presconf vs speech
  // sortable on the same day without colliding with the 18:30Z presser
  // timestamp that Phase 2b uses.
  const transcriptIso = `${transcriptDate}T12:00:00Z`;

  // Idempotency check
  const { data: existing } = await _supabase
    .from('transcripts')
    .select('id')
    .eq('speaker', speaker)
    .eq('transcript_date', transcriptIso)
    .eq('event_type', eventType)
    .maybeSingle();
  if (existing) {
    return { ok: true, skipped: 'already ingested', transcriptId: existing.id };
  }

  // Fetch + parse
  const result = await fetchWithBackoff(url);
  if (result.notFound) {
    return { ok: false, skipped: '404 not found', error: null };
  }
  if (!result.buffer || result.buffer.length < 10 * 1024) {
    return { ok: false, error: `pdf too small (${result.buffer?.length || 0} bytes)` };
  }
  let text;
  try {
    text = await extractTranscriptText(result.buffer);
  } catch (err) {
    return { ok: false, error: `pdf parse failed: ${err.message}` };
  }
  if (!text || text.length < 1000) {
    return { ok: false, error: `extracted text too short (${text.length} chars)` };
  }
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Insert. synthetic_seed defaults true via the function arg so the seed
  // CLI doesn't need to repeat it on every entry; production speech ingest
  // (Phase 2g) will pass syntheticSeed: false explicitly.
  const { data: inserted, error: insertErr } = await _supabase
    .from('transcripts')
    .insert({
      speaker,
      event_type:      eventType,
      source_url:      url,
      source_org:      'Federal Reserve',
      transcript_date: transcriptIso,
      full_text:       text,
      word_count:      wordCount,
      synthetic_seed:  syntheticSeed,
    })
    .select('id')
    .single();
  if (insertErr) {
    return { ok: false, error: `insert failed: ${insertErr.message}` };
  }

  // Word counts — same fire-and-forget pattern as fed_transcripts. Don't
  // fail the ingest on counter errors; they'll be picked up by the
  // wordCounts.backfillAllPending() sweep.
  try {
    await _computeWordCounts(inserted.id);
  } catch (err) {
    console.warn(`[fed_speeches] word counts failed for ${inserted.id}:`, err.message);
  }

  return { ok: true, transcriptId: inserted.id };
}

/**
 * Walk KNOWN_SPEECHES sequentially with FETCH_DELAY_MS between fetches.
 * Idempotent (skips already-ingested rows). Returns aggregate counters
 * plus per-speaker breakdown for sanity-checking the seed shape.
 */
async function seedAll() {
  const results = [];
  let succeeded = 0, skipped = 0, failed = 0;
  const perSpeaker = new Map();

  for (let i = 0; i < KNOWN_SPEECHES.length; i++) {
    const entry = KNOWN_SPEECHES[i];
    const r = await ingestOneSpeech({
      url:            entry.url,
      speaker:        entry.speaker,
      transcriptDate: entry.date,
      eventType:      entry.eventType,
    });
    results.push({ ...entry, ...r });
    if (r.ok && r.skipped) skipped++;
    else if (r.ok) succeeded++;
    else failed++;
    perSpeaker.set(entry.speaker, (perSpeaker.get(entry.speaker) || 0) + 1);

    if (i < KNOWN_SPEECHES.length - 1) await sleep(FETCH_DELAY_MS);
  }

  return {
    total: KNOWN_SPEECHES.length,
    succeeded,
    skipped,
    failed,
    per_speaker: Object.fromEntries(perSpeaker),
    results,
  };
}

module.exports = {
  init,
  ingestOneSpeech,
  seedAll,
  KNOWN_SPEECHES,
};
