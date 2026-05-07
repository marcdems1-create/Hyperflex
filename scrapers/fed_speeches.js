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
// Speaker selection note: the user spec asked for Williams (NY Fed) and
// optionally Bostic / Daly. All three are regional Fed presidents whose
// speeches live on newyorkfed.org / atlantafed.org / frbsf.org — not
// federalreserve.gov, which is what this scraper is restricted to.
// Substituting Vice Chair Jefferson (centrist tone, FRB) and Governor
// Cook (dovish-leaning, FRB) keeps the multi-speaker shape without
// extending the scraper to additional hosts. Phase 2g can broaden hosts
// when production speech ingest ships.
const KNOWN_SPEECHES = [
  // ── Waller (Governor, hawkish-leaning archive) ──────────────────────────
  { speaker: 'Waller', date: '2022-02-24', eventType: 'speech', expectedStance: 'hawkish',
    title: 'fighting inflation with rate hikes and balance sheet reduction',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20220224a.pdf' },
  { speaker: 'Waller', date: '2022-05-30', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook and thoughts on a soft landing',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20220530a.pdf' },
  { speaker: 'Waller', date: '2023-03-31', eventType: 'speech', expectedStance: 'hawkish',
    title: 'the unstable Phillips Curve',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20230331a.pdf' },
  { speaker: 'Waller', date: '2023-06-16', eventType: 'speech', expectedStance: 'hawkish',
    title: 'financial stability and macroeconomic policy',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20230616a.pdf' },
  { speaker: 'Waller', date: '2023-07-13', eventType: 'speech', expectedStance: 'hawkish',
    title: 'economic outlook',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20230713a.pdf' },
  { speaker: 'Waller', date: '2023-10-10', eventType: 'speech', expectedStance: 'hawkish',
    title: 'the evolution of monetary policy',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20231010a.pdf' },
  { speaker: 'Waller', date: '2023-11-28', eventType: 'speech', expectedStance: 'hawkish',
    title: 'economic outlook (inflation still too high)',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20231128a.pdf' },
  { speaker: 'Waller', date: '2024-03-01', eventType: 'speech', expectedStance: 'hawkish',
    title: 'thoughts on quantitative tightening',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20240301a.pdf' },
  { speaker: 'Waller', date: '2024-05-21', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20240521a.pdf' },
  { speaker: 'Waller', date: '2024-07-17', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook (data dependent)',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20240717a.pdf' },
  { speaker: 'Waller', date: '2024-09-06', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook (labor cooling)',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20240906a.pdf' },
  { speaker: 'Waller', date: '2024-10-14', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook (Hoover Institution)',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20241014a.pdf' },
  { speaker: 'Waller', date: '2024-12-02', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20241202a.pdf' },
  { speaker: 'Waller', date: '2025-07-17', eventType: 'speech', expectedStance: 'dovish',
    title: 'economic outlook (close to neutral, not restrictive)',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20250717a.pdf' },
  { speaker: 'Waller', date: '2025-11-17', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/waller20251117a.pdf' },

  // ── Brainard (Vice Chair, dovish-leaning, archive ends Feb 2023) ────────
  { speaker: 'Brainard', date: '2022-04-05', eventType: 'speech', expectedStance: 'neutral',
    title: 'variation in the inflation experiences of households',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/brainard20220405a.pdf' },
  { speaker: 'Brainard', date: '2022-09-07', eventType: 'speech', expectedStance: 'hawkish',
    title: 'bringing inflation down',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/brainard20220907a.pdf' },
  { speaker: 'Brainard', date: '2022-09-30', eventType: 'speech', expectedStance: 'neutral',
    title: 'global financial stability considerations in a high-inflation environment',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/brainard20220930a.pdf' },
  { speaker: 'Brainard', date: '2022-10-10', eventType: 'speech', expectedStance: 'neutral',
    title: 'restoring price stability in an uncertain economic environment',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/brainard20221010a.pdf' },
  { speaker: 'Brainard', date: '2022-11-28', eventType: 'speech', expectedStance: 'dovish',
    title: 'what we can learn from the pandemic (supply-side framing)',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/brainard20221128.pdf' },
  { speaker: 'Brainard', date: '2023-01-19', eventType: 'speech', expectedStance: 'dovish',
    title: 'economic outlook (her last FRB speech)',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/brainard20230119a.pdf' },

  // ── Cook (Governor, dovish-leaning supplement to Brainard) ──────────────
  { speaker: 'Cook', date: '2024-03-25', eventType: 'speech', expectedStance: 'dovish',
    title: 'the dual mandate and the balance of risks',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/cook20240325a.pdf' },
  { speaker: 'Cook', date: '2024-07-10', eventType: 'speech', expectedStance: 'neutral',
    title: 'global inflation and monetary policy challenges',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/cook20240710a.pdf' },
  { speaker: 'Cook', date: '2024-09-26', eventType: 'speech', expectedStance: 'neutral',
    title: 'artificial intelligence and the labor force',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/cook20240926a.pdf' },
  { speaker: 'Cook', date: '2024-11-20', eventType: 'speech', expectedStance: 'dovish',
    title: 'economic outlook (inflation moving sustainably toward 2%)',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/cook20241120a.pdf' },
  { speaker: 'Cook', date: '2025-01-06', eventType: 'speech', expectedStance: 'dovish',
    title: 'economic outlook and financial stability',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/cook20250106a.pdf' },
  { speaker: 'Cook', date: '2025-11-03', eventType: 'speech', expectedStance: 'dovish',
    title: 'economic outlook and monetary policy',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/cook20251103a.pdf' },

  // ── Jefferson (Vice Chair, centrist, substitute for Williams) ───────────
  { speaker: 'Jefferson', date: '2024-04-16', eventType: 'speech', expectedStance: 'neutral',
    title: 'monetary policy during periods of uncertainty',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/jefferson20240416a.pdf' },
  { speaker: 'Jefferson', date: '2024-05-20', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook and housing price dynamics',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/jefferson20240520a.pdf' },
  { speaker: 'Jefferson', date: '2025-02-04', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook and monetary policy',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/jefferson20250204a.pdf' },
  { speaker: 'Jefferson', date: '2025-02-05', eventType: 'speech', expectedStance: 'neutral',
    title: 'do non-inflationary economic expansions promote shared prosperity',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/jefferson20250205a.pdf' },
  { speaker: 'Jefferson', date: '2025-04-03', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook and central bank communications',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/jefferson20250403a.pdf' },
  { speaker: 'Jefferson', date: '2025-05-14', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/jefferson20250514a.pdf' },
  { speaker: 'Jefferson', date: '2025-10-03', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook and monetary policy framework',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/jefferson20251003a.pdf' },
  { speaker: 'Jefferson', date: '2025-11-17', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook and monetary policy',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/jefferson20251117a.pdf' },
  { speaker: 'Jefferson', date: '2026-01-16', eventType: 'speech', expectedStance: 'neutral',
    title: 'economic outlook and monetary policy implementation',
    url: 'https://www.federalreserve.gov/newsevents/speech/files/jefferson20260116a.pdf' },
];

// Sourcing notes for the entries above:
//   - 36 URLs total (vs ~45 in original spec). Hard cap on Brainard at 6 — she
//     left FRB Feb 2023 so her relevant archive is bounded; Cook supplements
//     the dovish bucket.
//   - All PDF URLs follow the /newsevents/speech/files/<lastname><yyyymmdd>a.pdf
//     pattern. brainard20221128.pdf is the one exception (no trailing 'a'),
//     matching what the search result actually returned.
//   - URLs pulled from federalreserve.gov search results; speech existence
//     is verified at the URL level (search returned them) but PDF reachability
//     wasn't fetch-tested from this sandbox (federalreserve.gov returns 403
//     to outbound calls from here). Run with --dry-run first locally; any
//     404s will surface in the seed CLI's failure list and can be swapped.
//   - expectedStance is editorial judgment from the speech title alone, not
//     from reading body text. Calibrating those tags against the rule-based
//     classifier output is exactly the seed for Phase 2d.5.

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
