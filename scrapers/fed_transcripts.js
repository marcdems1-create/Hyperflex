/**
 * scrapers/fed_transcripts.js
 *
 * Federal Reserve FOMC press conference transcript ingester.
 *
 * Pulls HTML transcripts from federalreserve.gov, extracts the article body,
 * and inserts into the `transcripts` table (migration #50). Triggers
 * computeWordCounts(transcript_id) after each successful insert. Idempotent —
 * the table's UNIQUE (speaker, transcript_date, event_type) constraint plus
 * an explicit pre-insert check make re-running safe.
 *
 * Usage:
 *   const fedTranscripts = require('./scrapers/fed_transcripts');
 *   fedTranscripts.init({ fetch: _nodeFetch, supabase, computeWordCounts });
 *   await fedTranscripts.ingestOnePresconf('20240131');
 *   await fedTranscripts.backfill(fedTranscripts.KNOWN_PRESSER_DATES);
 *
 * Phase 2b of the mention-pages build. Speeches/testimony/op-eds are NOT
 * handled here — they ship as a separate ingest path in Phase 2g (manual
 * stance-entry seed for Warsh).
 */

'use strict';

const FED_BASE = 'https://www.federalreserve.gov';
// PDF transcripts (per phase 2b.1 — the .htm landing pages are video
// players with no transcript text). Casing matters on fed.gov:
// FOMCpresconf is camelCase, all-caps F-O-M-C.
const PRESCONF_PATH = '/mediacenter/files/FOMCpresconf';
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
  if (!opts?.fetch) throw new Error('fed_transcripts.init: opts.fetch required');
  if (!opts?.supabase) throw new Error('fed_transcripts.init: opts.supabase required');
  if (!opts?.computeWordCounts) throw new Error('fed_transcripts.init: opts.computeWordCounts required');
  _fetch = opts.fetch;
  _supabase = opts.supabase;
  _computeWordCounts = opts.computeWordCounts;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── robots.txt ──────────────────────────────────────────────────────────────
// Intentionally simple: scans the User-agent: * block and rejects when a
// Disallow path is a prefix of the path we want. Does NOT handle wildcards,
// crawl-delay, or per-bot rules. fed.gov is currently permissive on
// /monetarypolicy/, but if rules tighten the parser errs on the side of NOT
// scraping.
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
    console.warn('[fed_transcripts] robots.txt fetch failed, assuming permissive:', err.message);
  }
  _robotsCache = '';
  _robotsCachedAt = Date.now();
  return _robotsCache;
}

function pathAllowedByRobots(robotsTxt, path) {
  if (!robotsTxt) return true;
  const lines = robotsTxt.split('\n').map(l => l.trim());
  let inStarBlock = false;
  for (const line of lines) {
    if (/^user-agent:\s*\*/i.test(line)) { inStarBlock = true; continue; }
    if (/^user-agent:/i.test(line)) { inStarBlock = false; continue; }
    if (!inStarBlock) continue;
    const m = line.match(/^disallow:\s*(\S+)/i);
    if (m && m[1] && path.startsWith(m[1])) return false;
  }
  return true;
}

// ── HTTP with backoff ───────────────────────────────────────────────────────
async function fetchWithBackoff(url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await _fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 404) return { notFound: true };
      if (res.status === 429 || res.status === 503) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 30000);
        console.warn(`[fed_transcripts] ${res.status} on ${url}, waiting ${wait}ms`);
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

// ── PDF extraction ──────────────────────────────────────────────────────────
// fed.gov FOMC press conference transcripts are PDFs. We strip page
// numbers, repeating headers, normalise speaker labels, and clean common
// PDF artifacts (ligatures, soft hyphens, smart quotes) so word counts
// in phase 2c get clean input.
//
// pdf-parse is required lazily inside the function (not at module top)
// because v1.1.1 has a known footgun: it tries to read a debug fixture
// at require-time when NODE_ENV is unset, which crashes on Railway boot
// if the fixture file isn't shipped. Lazy require dodges that.
/**
 * Parse a Fed FOMC presser PDF buffer to clean transcript text.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>} cleaned transcript text
 */
async function extractTranscriptText(pdfBuffer) {
  const pdfParse = require('pdf-parse');
  const parsed = await pdfParse(pdfBuffer);
  let text = parsed.text || '';

  // Strip recurring page header (Fed PDFs repeat date + page number on
  // every page). Patterns: "Page X of Y", "Chair Powell's Press Conference FINAL".
  text = text.replace(/Page\s+\d+\s+of\s+\d+/gi, ' ');
  text = text.replace(/Chair\s+(Powell|Warsh|Yellen)['’]s?\s+Press\s+Conference\s*FINAL/gi, ' ');

  // Normalise speaker labels to a consistent marker. Fed PDFs use:
  //   "CHAIR POWELL." or "MR. POWELL." or "MS. JONES."
  // One canonical form so word counts don't double-count names mentioned in answers.
  text = text.replace(/\b(CHAIR|MR\.|MS\.)\s+([A-Z]+)\.\s*/g, ' $1 $2. ');

  // Common PDF artifacts → ASCII; collapse whitespace.
  text = text
    .replace(/­/g, '')          // soft hyphen
    .replace(/‐|‑/g, '-')  // various hyphens → ascii
    .replace(/‘|’/g, "'")  // smart single quotes → ascii
    .replace(/“|”/g, '"')  // smart double quotes → ascii
    .replace(/\f/g, ' ')             // form feed (page break)
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

// ── Speaker switchover ──────────────────────────────────────────────────────
// Powell chaired through May 15, 2026. Warsh from June 2026 onward (pending
// confirmation). If confirmation slips, this is the one place to update.
function chairAtDate(date) {
  const d = new Date(date);
  if (d < new Date('2018-02-05')) return 'Yellen';
  if (d < new Date('2026-05-16')) return 'Powell';
  return 'Warsh';
}

function buildPresconfUrl(yyyymmdd) {
  return `${FED_BASE}${PRESCONF_PATH}${yyyymmdd}.pdf`;
}

// ── Single-presser ingest ───────────────────────────────────────────────────
/**
 * Ingest one FOMC press conference by date.
 * @param {string} yyyymmdd e.g. '20240131'
 * @returns {Promise<{ok:boolean, transcriptId?:string, skipped?:string, error?:string}>}
 */
async function ingestOnePresconf(yyyymmdd) {
  if (!_fetch) throw new Error('fed_transcripts.init() must be called first');
  if (!/^\d{8}$/.test(yyyymmdd)) {
    return { ok: false, error: `invalid yyyymmdd: ${yyyymmdd}` };
  }

  const url = buildPresconfUrl(yyyymmdd);
  const path = PRESCONF_PATH + yyyymmdd + '.pdf';

  // robots.txt gate
  const robots = await fetchRobots();
  if (!pathAllowedByRobots(robots, path)) {
    return { ok: false, skipped: 'blocked by robots.txt', error: null };
  }

  // Idempotency: skip if we already have this date
  const transcriptDate = `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}T18:30:00Z`;
  const speaker = chairAtDate(transcriptDate);
  const { data: existing } = await _supabase
    .from('transcripts')
    .select('id')
    .eq('speaker', speaker)
    .eq('transcript_date', transcriptDate)
    .eq('event_type', 'fomc_presser')
    .maybeSingle();
  if (existing) {
    return { ok: true, skipped: 'already ingested', transcriptId: existing.id };
  }

  // Fetch + parse
  const result = await fetchWithBackoff(url);
  if (result.notFound) {
    return { ok: false, skipped: '404 not found (no presser this date)', error: null };
  }
  // Sanity-check: an HTML error page masquerading as a PDF will be tiny.
  // Real Fed transcripts are 100KB+. Anything under 10KB is almost certainly
  // a fed.gov error page returned with a 200 (we've seen this before).
  if (!result.buffer || result.buffer.length < 10 * 1024) {
    return { ok: false, error: `pdf too small (${result.buffer?.length || 0} bytes), likely an error page disguised as a PDF` };
  }
  let text;
  try {
    text = await extractTranscriptText(result.buffer);
  } catch (err) {
    return { ok: false, error: `pdf parse failed: ${err.message}` };
  }
  if (!text || text.length < 1000) {
    return { ok: false, error: `extracted text too short (${text.length} chars), parse may have failed` };
  }
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Insert
  const { data: inserted, error: insertErr } = await _supabase
    .from('transcripts')
    .insert({
      speaker,
      event_type: 'fomc_presser',
      source_url: url,
      source_org: 'Federal Reserve',
      transcript_date: transcriptDate,
      full_text: text,
      word_count: wordCount,
    })
    .select('id')
    .single();

  if (insertErr) {
    return { ok: false, error: `insert failed: ${insertErr.message}` };
  }

  // Trigger word counting. Don't fail the ingest on counter errors —
  // counts can be retried later via a sweep cron.
  try {
    await _computeWordCounts(inserted.id);
  } catch (err) {
    console.error(`[fed_transcripts] computeWordCounts failed for ${inserted.id}:`, err.message);
  }

  return { ok: true, transcriptId: inserted.id };
}

// ── Backfill ────────────────────────────────────────────────────────────────
/**
 * Backfill multiple FOMC press conferences sequentially with FETCH_DELAY_MS
 * between each. Idempotent (skips already-ingested dates).
 * @param {string[]} dates yyyymmdd strings
 * @returns {Promise<{succeeded:number, skipped:number, failed:number, results:Array}>}
 */
async function backfill(dates) {
  const results = [];
  let succeeded = 0, skipped = 0, failed = 0;
  for (const date of dates) {
    const r = await ingestOnePresconf(date);
    results.push({ date, ...r });
    if (r.ok && r.skipped) skipped++;
    else if (r.ok) succeeded++;
    else failed++;
    await sleep(FETCH_DELAY_MS);
  }
  return { succeeded, skipped, failed, results };
}

// ── Known FOMC press conference dates ──────────────────────────────────────
// Last ~6 years through Powell's expected last meeting in 2026. Add new
// dates as meetings happen. Format: 'YYYYMMDD'.
const KNOWN_PRESSER_DATES = [
  // 2020
  '20200129','20200315','20200429','20200610','20200729','20200916','20201105','20201216',
  // 2021
  '20210127','20210317','20210428','20210616','20210728','20210922','20211103','20211215',
  // 2022
  '20220126','20220316','20220504','20220615','20220727','20220921','20221102','20221214',
  // 2023
  '20230201','20230322','20230503','20230614','20230726','20230920','20231101','20231213',
  // 2024
  '20240131','20240320','20240501','20240612','20240731','20240918','20241107','20241218',
  // 2025
  '20250129','20250319','20250507','20250618','20250730','20250917','20251029','20251210',
  // 2026 (through Powell's last)
  '20260128','20260318','20260429',
];

module.exports = {
  init,
  ingestOnePresconf,
  backfill,
  chairAtDate,
  KNOWN_PRESSER_DATES,
  // exported for testability
  extractTranscriptText,
  pathAllowedByRobots,
  buildPresconfUrl,
};
