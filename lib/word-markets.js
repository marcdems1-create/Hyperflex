// lib/word-markets.js
//
// Polymarket word-market sourcing pipeline. Powers the /mentions
// calendar-first rebuild (Path B): word-markets are Polymarket's
// "Mentions" category — events shaped like "What will Powell say
// during June Press Conference" with N binary sub-markets
// ("Will Powell say recession", "Will Powell say inflation", …).
//
// This module sweeps the gamma /markets/keyset endpoint with one
// keyword query per tracked speaker, classifies matches via the
// language-event regex, groups by Polymarket's native eventSlug,
// and returns calendar-ready event tiles. No manual market→event
// mapping needed because Polymarket exposes the grouping natively.
//
// SPEAKER_WHITELIST env var (comma-separated) overrides the default
// list. CACHE_TTL_MS env var (ms) overrides the 1hr default.

'use strict';

const polymarket = require('./polymarket');
const fetch = require('node-fetch');

const GAMMA = 'https://gamma-api.polymarket.com';

// Default whitelist — Fed + Treasury + executive speakers we already
// have transcript / stance pipelines for. Order doesn't matter (all
// results merged + ranked by total event volume after the sweep).
const DEFAULT_SPEAKERS = [
  'Powell', 'Warsh', 'Trump', 'Biden', 'Bowman', 'Waller',
  'Jefferson', 'Cook', 'Brainard', 'Bessent', 'Shelton',
];

const CACHE_TTL_MS         = Number(process.env.WORD_MARKETS_CACHE_TTL_MS) || (60 * 60 * 1000);
const PER_SPEAKER_LIMIT    = Number(process.env.WORD_MARKETS_PER_SPEAKER) || 30;
const REQUEST_TIMEOUT_MS   = 8000;

// Mirrors server.js:14994 — kept in sync deliberately. When this regex
// set changes there it must change here too (or factor to a shared
// module; for now both call sites have visibility on the patterns).
const LANGUAGE_EVENT_PATTERNS = [
  /\bwhat\s+will\s+.+\s+(say|mention)\b/i,
  /\bwhat\s+\w+\s+will\s+.+\ssay\b/i,
  /\bwill\s+.+\s+(say|mention|use\s+the\s+word)\b/i,
];

let _cache = null;  // { value, expiresAt, fetchedAt, speakers, perSpeakerLimit }

function _speakerList() {
  const raw = process.env.SPEAKER_WHITELIST;
  if (raw && String(raw).trim()) {
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  }
  return DEFAULT_SPEAKERS.slice();
}

function _isLanguageEventTitle(title) {
  if (!title) return false;
  return LANGUAGE_EVENT_PATTERNS.some(re => re.test(title));
}

// Sub-market candidate label resolution. Gamma provides groupItemTitle
// for multi-outcome events ("recession" / "Iran" / "Eagle"); fall back
// to extracting the word from "Will X say <word>" when absent.
function _candidateLabel(subMarket, parentTitle) {
  if (subMarket.groupItemTitle && String(subMarket.groupItemTitle).trim()) {
    return String(subMarket.groupItemTitle).trim();
  }
  const q = String(subMarket.question || '');
  const m = q.match(/\b(?:say|mention|use(?:\s+the\s+word)?)\s+([A-Za-z][\w\s'\-]{1,40}?)(?:\s+during\b|\s+at\b|\s+in\b|[?\.]|$)/i);
  if (m && m[1]) return m[1].trim();
  return q.length > 60 ? q.slice(0, 58).trim() + '…' : q;
}

function _parseYesPrice(raw) {
  try {
    const op = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(op) && op.length) {
      const v = parseFloat(op[0]);
      return Number.isFinite(v) ? v : null;
    }
  } catch (_) {}
  return null;
}

function _gammaUnwrap(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && Array.isArray(body.markets)) return body.markets;
  if (body && Array.isArray(body.events)) return body.events;
  return [];
}

async function _sweepSpeaker(speaker, perSpeakerLimit) {
  const url = `${GAMMA}/markets/keyset?closed=false&limit=${perSpeakerLimit}&order=volume&ascending=false&search=${encodeURIComponent(speaker)}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Hyperflex/1.0' },
      signal:  ac.signal,
    });
    if (!r.ok) return [];
    const body = await r.json().catch(() => null);
    return _gammaUnwrap(body);
  } catch (e) {
    console.warn('[word-markets] sweep failed for', speaker, '—', e.message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Speaker attribution. Gamma's `?search=<speaker>` is loose; a market
// matched on a query for "Trump" might actually be about Biden. So we
// re-derive the speaker from the question text and only credit a
// market to a speaker whose name actually appears in the question.
// When multiple whitelist speakers appear (rare), first hit wins.
function _attributeSpeaker(question, whitelist) {
  if (!question) return null;
  const q = String(question).toLowerCase();
  for (const sp of whitelist) {
    if (q.includes(String(sp).toLowerCase())) return sp;
  }
  return null;
}

async function _selectFresh({ speakers, perSpeakerLimit }) {
  // eventSlug → group accumulator
  const eventGroups = new Map();

  // Sweep all speakers in parallel. Polymarket gamma tolerates ~10
  // concurrent requests; the whitelist is bounded at ~15 names so we
  // can fire them all without throttling.
  const sweepResults = await Promise.all(
    speakers.map(sp => _sweepSpeaker(sp, perSpeakerLimit).then(r => ({ speaker: sp, results: r })))
  );

  for (const { results } of sweepResults) {
    for (const m of results) {
      const q = m.question || m.title || '';
      if (!_isLanguageEventTitle(q)) continue;

      // Re-derive speaker from question (gamma's loose-search false
      // positives — see _attributeSpeaker above).
      const attributedSpeaker = _attributeSpeaker(q, speakers);
      if (!attributedSpeaker) continue;

      const eventSlug = m.eventSlug || m.event_slug || null;
      if (!eventSlug) continue;
      const cid = m.conditionId || m.condition_id;
      if (!cid) continue;

      let group = eventGroups.get(eventSlug);
      if (!group) {
        group = {
          event_slug:    eventSlug,
          event_title:   '',   // resolved via getEventBySlug below
          speaker:       attributedSpeaker,
          end_date:      m.endDate || m.end_date || null,
          total_volume:  0,
          markets:       [],
        };
        eventGroups.set(eventSlug, group);
      }

      // Dedup on conditionId within group.
      if (group.markets.some(x => x.condition_id === cid)) continue;

      group.markets.push({
        condition_id: cid,
        slug:         m.slug || null,
        question:     q,
        label:        _candidateLabel(m, ''),
        yes_price:    _parseYesPrice(m.outcomePrices),
        volume:       parseFloat(m.volume || m.volumeNum || 0) || 0,
        volume_24h:   parseFloat(m.volume24hr || 0) || 0,
      });
      group.total_volume += parseFloat(m.volume || m.volumeNum || 0) || 0;
    }
  }

  if (!eventGroups.size) return [];

  // Enrichment pass: resolve canonical event title + end_date via the
  // gamma events endpoint. Each event resolved in parallel since they're
  // independent and gamma caches them server-side.
  const groups = Array.from(eventGroups.values());
  await Promise.all(groups.map(async (group) => {
    try {
      const ev = await polymarket.getEventBySlug(group.event_slug);
      if (ev && ev.event) {
        group.event_title = ev.event.title || group.event_title;
        group.end_date    = ev.event.endDate || ev.event.end_date || group.end_date;
      }
    } catch (_) { /* leave unresolved */ }
    // Sort sub-markets by volume so the candidate ladder leads with
    // the most-traded outcome.
    group.markets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
  }));

  // Final ranking: group total volume descending. Ties broken by
  // earliest end_date so resolution-soon events surface first.
  groups.sort((a, b) => {
    const dv = (b.total_volume || 0) - (a.total_volume || 0);
    if (dv !== 0) return dv;
    const ta = Date.parse(a.end_date || '');
    const tb = Date.parse(b.end_date || '');
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    return ta - tb;
  });

  return groups;
}

async function getUpcomingWordMarketEvents(opts = {}) {
  const limit            = Math.max(1, Math.min(50, Number(opts.limit) || 20));
  const perSpeakerLimit  = Math.max(5, Math.min(50, Number(opts.perSpeakerLimit) || PER_SPEAKER_LIMIT));
  const now = Date.now();

  if (_cache && _cache.expiresAt > now && _cache.perSpeakerLimit >= perSpeakerLimit) {
    return _cache.value.slice(0, limit);
  }

  const speakers = _speakerList();
  const fresh = await _selectFresh({ speakers, perSpeakerLimit });
  _cache = {
    value:           fresh,
    expiresAt:       now + CACHE_TTL_MS,
    fetchedAt:       now,
    speakers,
    perSpeakerLimit,
  };
  return fresh.slice(0, limit);
}

async function getWordMarketsByEventSlug(slug) {
  if (!slug) return null;
  try {
    const result = await polymarket.getEventBySlug(slug);
    if (!result || !result.event) return null;
    const parentTitle = result.event.title || '';
    const isLang      = _isLanguageEventTitle(parentTitle);
    const subMarkets  = (result.eventMarkets || [])
      .filter(m => m.closed !== true)
      .map(m => ({
        condition_id: m.conditionId,
        slug:         m.slug || null,
        question:     m.question || '',
        label:        _candidateLabel(m, parentTitle),
        yes_price:    _parseYesPrice(m.outcomePrices),
        volume:       parseFloat(m.volume || m.volumeNum || 0) || 0,
        volume_24h:   parseFloat(m.volume24hr || 0) || 0,
        end_date:     m.endDate || m.end_date_iso || null,
      }))
      .sort((a, b) => (b.volume || 0) - (a.volume || 0));
    return {
      event_slug:        slug,
      event_title:       parentTitle,
      is_language_event: isLang,
      end_date:          result.event.endDate || result.event.end_date || null,
      total_volume:      subMarkets.reduce((s, m) => s + m.volume, 0),
      markets:           subMarkets,
    };
  } catch (e) {
    console.warn('[word-markets] getEventBySlug failed', slug, '—', e.message);
    return null;
  }
}

function bustCache() { _cache = null; }

function getCachedSnapshot() {
  if (!_cache) return null;
  return {
    expiresAt:        _cache.expiresAt,
    fetchedAt:        _cache.fetchedAt,
    age_ms:           Date.now() - _cache.fetchedAt,
    count:            _cache.value ? _cache.value.length : 0,
    speakers:         _cache.speakers,
    per_speaker_limit: _cache.perSpeakerLimit,
  };
}

module.exports = {
  getUpcomingWordMarketEvents,
  getWordMarketsByEventSlug,
  bustCache,
  getCachedSnapshot,
  DEFAULT_SPEAKERS,
  LANGUAGE_EVENT_PATTERNS,
  _internals: { _isLanguageEventTitle, _candidateLabel, _parseYesPrice, _gammaUnwrap, _attributeSpeaker, _speakerList },
};
