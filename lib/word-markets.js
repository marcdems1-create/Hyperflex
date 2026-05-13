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

// Mirrors server.js:14994 — kept in sync deliberately. Both files
// must update together. PR #133 widened this set from 3 patterns to
// 6 after a strategy review surfaced that the previous regex only
// covered "what will X say" + "will X say/mention" — missing the
// other 5 Polymarket question shapes for word-betting markets
// (tweet, post, contain, how many times, word count, use the word).
const LANGUAGE_EVENT_PATTERNS = [
  /\bwhat\s+will\s+.+?\s+(say|mention|tweet|post|do)\b/i,    // "What will Powell say"
  /\bwill\s+.+?\s+(say|mention|tweet|post)\b/i,              // "Will Powell say recession"
  /\bwill\s+.+?\s+use\s+the\s+word\b/i,                      // "Will Powell use the word X"
  /\bwill\s+the\s+.+?\s+contain\b/i,                         // "Will the FOMC statement contain X"
  /\bhow\s+many\s+times\s+will\b/i,                          // "How many times will Powell say X"
  /\bword\s+count\b/i,                                       // explicit word-count markets
];

// Gamma keyword-search seeds for the pattern-driven sweep. Speaker
// sweep alone misses markets where the speaker name isn't prominent
// in the question text (e.g. "Will the FOMC statement contain
// 'transitory'"). These seeds cast a wider net via gamma's `?search=`
// before the regex precision filter narrows it back down.
const PATTERN_SEARCH_TERMS = [
  'will say',
  'mention',
  'tweet',
  'post',
  'contain',
  'how many times',
  'word count',
  'use the word',
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

// Generic gamma keyword sweep. Used for both speaker-name and
// pattern-keyword passes — the only difference is what term we
// feed into the `?search=` query.
//
// PR #138 removed `order=volume&ascending=false`. Previously the
// volume sort was overpowering the search filter: gamma's `?search=`
// is a loose token match, and the top 30 by sitewide volume that
// happened to contain "will" or "say" anywhere in the question were
// all high-volume sports/crypto markets that never matched our
// language-event regex. Defaulting to gamma's relevance ranking
// surfaces language markets even when their absolute volume is
// dwarfed by NBA/MLB/EPL action.
async function _sweepKeyword(term, perTermLimit, tag) {
  const url = `${GAMMA}/markets/keyset?closed=false&limit=${perTermLimit}&search=${encodeURIComponent(term)}`;
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
    console.warn('[word-markets] ' + (tag || 'sweep') + ' failed for', term, '—', e.message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Legacy alias — speaker sweep is just a keyword sweep on speaker name.
async function _sweepSpeaker(speaker, perSpeakerLimit) {
  return _sweepKeyword(speaker, perSpeakerLimit, 'speaker-sweep');
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

// Direct event-slug probe for Polymarket's known language-event slug
// patterns. The Polymarket precedent (documented at
// lib/clusterer/event-previews.js:79-87) is shaped like
//   what-will-<speaker>-say-during-<month>-<suffix>
//   what-will-<speaker>-say-during-<month>-<year>-<suffix>
// where <suffix> covers FOMC pressers, congressional testimony, and
// the annual Jackson Hole speech. Bypasses the keyword search
// entirely. We hit getEventBySlug for each speculative slug and
// accept any that resolve. Cheap: one gamma call per slug, ~352
// slugs total (11 speakers × 4 months × 4 suffixes × 2 year-suffix
// variants), and gamma caches slug lookups for 5min upstream so warm
// hits are free. Testimony catches Bessent/Powell appearances that
// the FOMC-only probe missed pre-PR-#150.
const MONTH_NAMES = [
  'january','february','march','april','may','june',
  'july','august','september','october','november','december',
];

// Polymarket slug suffixes for known speaker-event types. The FOMC
// presser suffixes cover Powell-style monthly events; the testimony
// suffix covers Bessent/Powell congressional appearances; jackson-hole
// catches the annual August speech (when in-window). Each suffix is
// probed with AND without the year, since Polymarket's slug
// conventions inconsistently include the year (sometimes "during-
// june-press-conference", sometimes "during-june-2026-press-
// conference"). Speech/testimony/jackson-hole probes are non-Powell-
// targeted in practice but probed for every speaker — cost is one
// gamma call each and gamma caches slug lookups for 5min.
const SLUG_SUFFIXES = [
  'press-conference',
  'fomc',
  'testimony',
  'jackson-hole',
];

function _slugProbeCandidates(speakers, opts = {}) {
  const monthsAhead = Math.max(0, Math.min(6, Number(opts.monthsAhead) || 3));
  const now = new Date();
  const candidates = [];
  for (const speaker of speakers) {
    const sp = String(speaker).toLowerCase();
    for (let i = 0; i <= monthsAhead; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const month = MONTH_NAMES[d.getMonth()];
      const year = d.getFullYear();
      for (const suf of SLUG_SUFFIXES) {
        candidates.push(`what-will-${sp}-say-during-${month}-${suf}`);
        candidates.push(`what-will-${sp}-say-during-${month}-${year}-${suf}`);
      }
    }
  }
  return candidates;
}

async function _runSlugProbe(speakers, opts = {}) {
  const slugs = _slugProbeCandidates(speakers, opts);
  // Probe in chunks of 10 to avoid hammering gamma.
  const CHUNK = 10;
  const hits = [];
  for (let i = 0; i < slugs.length; i += CHUNK) {
    const chunk = slugs.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map(async (slug) => {
      try {
        const r = await polymarket.getEventBySlug(slug);
        if (!r || !r.event) return null;
        if (!_isLanguageEventTitle(r.event.title || '')) return null;
        return { slug, event: r.event, markets: r.eventMarkets || [] };
      } catch (_) { return null; }
    }));
    for (const r of results) if (r) hits.push(r);
  }
  return { probed: slugs.length, hits };
}

// PR #143 — broad events-sweep. Walks gamma /events (no keyword
// filter; gamma's `?search=` is non-functional per PR #135 diag) and
// applies the same LANGUAGE_EVENT_PATTERNS + speaker-attribution
// gate. Discovers language events for any whitelisted speaker, not
// just Powell's FOMC slug shape. Critical for surfacing Trump,
// Bessent, Bowman, etc. — they don't follow the FOMC convention but
// do appear as "Will Trump say/tweet/mention X" parent events on
// Polymarket's Mentions category.
//
// fetchPolymarketEvents returns events with normalized .markets[]
// already. shape-compatible with getEventBySlug for downstream
// merging (slug, event, markets).
async function _runEventsSweep(speakers, opts = {}) {
  const limit = Math.max(50, Math.min(500, Number(opts.limit) || 500));
  let events = [];
  try {
    events = await polymarket.fetchPolymarketEvents({
      active:     true,
      endDateMin: new Date().toISOString(),
      limit,
    });
  } catch (e) {
    console.warn('[word-markets] events sweep failed:', e.message);
    return { fetched: 0, hits: [], samples: [] };
  }
  if (!Array.isArray(events)) return { fetched: 0, hits: [], samples: [] };

  const samples = events.slice(0, 5).map(e => e.title || e.slug || '');
  const hits = [];
  for (const ev of events) {
    const title = ev.title || '';
    if (!_isLanguageEventTitle(title)) continue;
    const attributedSpeaker = _attributeSpeaker(title, speakers);
    if (!attributedSpeaker) continue;
    hits.push({
      slug:    ev.slug,
      event:   { ...ev, endDate: ev.end_date, title },  // shape-match slug-probe
      markets: (ev.markets || []).map(m => ({
        question:       m.question,
        slug:           m.slug,
        outcomePrices:  m.outcomePrices,
        clobTokenIds:   m.clob_token_ids,
        active:         m.active,
        closed:         m.closed,
        conditionId:    m.condition_id,
        groupItemTitle: m.groupItemTitle || '',
        volume:         m.volume,
        volumeNum:      m.volume_num,
        volume24hr:     m.volume_24hr,
        endDate:        m.end_date_iso || m.end_date,
      })),
    });
  }
  return { fetched: events.length, hits, samples };
}

// Collects candidates from BOTH speaker-keyword and pattern-keyword
// sweeps, dedupes by conditionId, returns the merged candidate set
// plus per-sweep funnel counters for diagnostics.
async function _collectCandidates({ speakers, perSpeakerLimit, perPatternLimit }) {
  // Speaker sweeps in parallel.
  const speakerResults = await Promise.all(
    speakers.map(sp =>
      _sweepKeyword(sp, perSpeakerLimit, 'speaker-sweep').then(r => ({ kind: 'speaker', term: sp, results: r }))
    )
  );
  // Pattern sweeps in parallel.
  const patternResults = await Promise.all(
    PATTERN_SEARCH_TERMS.map(p =>
      _sweepKeyword(p, perPatternLimit, 'pattern-sweep').then(r => ({ kind: 'pattern', term: p, results: r }))
    )
  );

  const byCid = new Map(); // conditionId → candidate (first sweep to surface it wins)
  const funnel = {
    speaker_sweep: {},   // speaker → { fetched, after_pattern_filter, after_speaker_attribution }
    pattern_sweep: {},   // term    → { fetched, after_pattern_filter, after_speaker_attribution }
  };

  function _processSweep(kind, term, results) {
    const bucket = (kind === 'speaker' ? funnel.speaker_sweep : funnel.pattern_sweep);
    const entry = bucket[term] = {
      fetched: results.length,
      after_pattern_filter: 0,
      after_speaker_attribution: 0,
      samples: [],
      raw_samples: [],   // first 3 questions regardless of filter — tells us what gamma is actually returning
    };
    for (const m of results) {
      const q = m.question || m.title || '';
      const cid = m.conditionId || m.condition_id;
      if (!cid) continue;
      if (entry.raw_samples.length < 3 && q) entry.raw_samples.push(q);
      if (!_isLanguageEventTitle(q)) continue;
      entry.after_pattern_filter++;
      const attributedSpeaker = _attributeSpeaker(q, speakers);
      if (!attributedSpeaker) {
        if (entry.samples.length < 3) entry.samples.push({ q, reason: 'no_speaker_match' });
        continue;
      }
      entry.after_speaker_attribution++;
      if (entry.samples.length < 3) entry.samples.push({ q, speaker: attributedSpeaker });
      if (byCid.has(cid)) continue;  // already collected via another sweep
      byCid.set(cid, { market: m, attributedSpeaker });
    }
  }

  for (const { kind, term, results } of speakerResults) _processSweep(kind, term, results);
  for (const { kind, term, results } of patternResults) _processSweep(kind, term, results);

  return { candidates: Array.from(byCid.values()), funnel };
}

async function _selectFresh({ speakers, perSpeakerLimit, perPatternLimit, returnFunnel }) {
  // eventSlug → group accumulator
  const eventGroups = new Map();

  const { candidates, funnel } = await _collectCandidates({ speakers, perSpeakerLimit, perPatternLimit });

  for (const { market: m, attributedSpeaker } of candidates) {
    const q = m.question || m.title || '';
    const eventSlug = m.eventSlug || m.event_slug || null;
    if (!eventSlug) continue;
    const cid = m.conditionId || m.condition_id;

    let group = eventGroups.get(eventSlug);
    if (!group) {
      group = {
        event_slug:    eventSlug,
        event_title:   '',
        speaker:       attributedSpeaker,
        end_date:      m.endDate || m.end_date || null,
        total_volume:  0,
        markets:       [],
      };
      eventGroups.set(eventSlug, group);
    }

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

  // Direct slug-probe layer. Bypasses keyword search entirely — hits
  // known Polymarket language-event slug patterns and accepts any that
  // resolve. Fills in events the keyword sweep missed (gamma's
  // ?search= is loose; rare slug-shaped hits get buried).
  const probe = await _runSlugProbe(speakers, {}).catch(() => ({ probed: 0, hits: [] }));
  funnel.slug_probe = {
    probed: probe.probed,
    hits:   probe.hits.length,
    sample: probe.hits.slice(0, 3).map(h => h.slug),
  };
  for (const hit of probe.hits) {
    const eventSlug = hit.slug;
    if (eventGroups.has(eventSlug)) continue;  // already collected via keyword sweep
    const attributedSpeaker = _attributeSpeaker(hit.event.title || '', speakers);
    const group = {
      event_slug:    eventSlug,
      event_title:   hit.event.title || '',
      speaker:       attributedSpeaker,
      end_date:      hit.event.endDate || hit.event.end_date || null,
      total_volume:  0,
      markets:       [],
      // PR #139: a parent event listed by Polymarket can have all
      // sub-markets in closed state — either because the event already
      // resolved (May Powell FOMC after the presser) or because the
      // sub-markets haven't been activated yet (Polymarket lists the
      // event shell ~2-4 weeks before activating the "Will X say Y"
      // children). Keep both kinds: closed-because-resolved tells the
      // UI to show historical word counts; closed-because-pending tells
      // it to show "markets open soon" placeholder. Tag each row with
      // its status so the calendar UI can branch.
    };
    for (const m of hit.markets) {
      const cid = m.conditionId;
      if (!cid) continue;
      const vol = parseFloat(m.volume || m.volumeNum || 0) || 0;
      group.markets.push({
        condition_id: cid,
        slug:         m.slug || null,
        question:     m.question || '',
        label:        _candidateLabel(m, hit.event.title || ''),
        yes_price:    _parseYesPrice(m.outcomePrices),
        volume:       vol,
        volume_24h:   parseFloat(m.volume24hr || 0) || 0,
        closed:       m.closed === true,
        active:       m.active !== false,
      });
      group.total_volume += vol;
    }
    // Add the group even when markets array is empty — the parent
    // event itself is the signal. Calendar UI can render an
    // "event listed, sub-markets pending" state for these.
    eventGroups.set(eventSlug, group);
  }

  // PR #143 — broad events-sweep. Catches speakers whose slug shape
  // doesn't match the FOMC pattern (Trump, Bessent, Bowman, etc.).
  // Reuses the same hit-to-group shape so dedup-by-eventSlug works
  // against the slug-probe set.
  const eventsSweep = await _runEventsSweep(speakers, {}).catch(() => ({ fetched: 0, hits: [], samples: [] }));
  funnel.events_sweep = {
    fetched:  eventsSweep.fetched,
    hits:     eventsSweep.hits.length,
    sample:   eventsSweep.hits.slice(0, 5).map(h => h.event && h.event.title).filter(Boolean),
    raw_samples: eventsSweep.samples || [],
  };
  for (const hit of eventsSweep.hits) {
    const eventSlug = hit.slug;
    if (!eventSlug) continue;
    if (eventGroups.has(eventSlug)) continue;  // already collected via slug-probe / keyword sweep
    const attributedSpeaker = _attributeSpeaker(hit.event.title || '', speakers);
    const group = {
      event_slug:    eventSlug,
      event_title:   hit.event.title || '',
      speaker:       attributedSpeaker,
      end_date:      hit.event.endDate || hit.event.end_date || null,
      total_volume:  0,
      markets:       [],
    };
    for (const m of hit.markets) {
      const cid = m.conditionId;
      if (!cid) continue;
      const vol = parseFloat(m.volume || m.volumeNum || 0) || 0;
      group.markets.push({
        condition_id: cid,
        slug:         m.slug || null,
        question:     m.question || '',
        label:        _candidateLabel(m, hit.event.title || ''),
        yes_price:    _parseYesPrice(m.outcomePrices),
        volume:       vol,
        volume_24h:   parseFloat(m.volume24hr || 0) || 0,
        closed:       m.closed === true,
        active:       m.active !== false,
      });
      group.total_volume += vol;
    }
    eventGroups.set(eventSlug, group);
  }

  if (!eventGroups.size) return returnFunnel ? { groups: [], funnel } : [];

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

  return returnFunnel ? { groups, funnel } : groups;
}

async function getUpcomingWordMarketEvents(opts = {}) {
  const limit            = Math.max(1, Math.min(50, Number(opts.limit) || 20));
  const perSpeakerLimit  = Math.max(5, Math.min(50, Number(opts.perSpeakerLimit) || PER_SPEAKER_LIMIT));
  const perPatternLimit  = Math.max(5, Math.min(50, Number(opts.perPatternLimit) || PER_SPEAKER_LIMIT));
  const now = Date.now();

  if (_cache && _cache.expiresAt > now && _cache.perSpeakerLimit >= perSpeakerLimit) {
    return _cache.value.slice(0, limit);
  }

  const speakers = _speakerList();
  const fresh = await _selectFresh({ speakers, perSpeakerLimit, perPatternLimit });
  _cache = {
    value:           fresh,
    expiresAt:       now + CACHE_TTL_MS,
    fetchedAt:       now,
    speakers,
    perSpeakerLimit,
  };
  return fresh.slice(0, limit);
}

// Diagnostic — bypasses cache, runs the full pipeline, returns the
// merged events PLUS the per-sweep funnel counters and sample
// questions per stage. One curl tells us exactly where supply is
// being dropped (sweep returns 0 → no matches; pattern_filter
// rejects all → regex too narrow; speaker_attribution rejects all
// → speaker name not in question text). Admin-only because it
// triggers ~20 gamma keyword searches.
async function runDiag(opts = {}) {
  const perSpeakerLimit = Math.max(5, Math.min(100, Number(opts.perSpeakerLimit) || PER_SPEAKER_LIMIT));
  const perPatternLimit = Math.max(5, Math.min(100, Number(opts.perPatternLimit) || PER_SPEAKER_LIMIT));
  const speakers = _speakerList();
  const start = Date.now();
  const { groups, funnel } = await _selectFresh({ speakers, perSpeakerLimit, perPatternLimit, returnFunnel: true });
  return {
    elapsed_ms:        Date.now() - start,
    speakers,
    per_speaker_limit: perSpeakerLimit,
    per_pattern_limit: perPatternLimit,
    pattern_count:     LANGUAGE_EVENT_PATTERNS.length,
    pattern_terms:     PATTERN_SEARCH_TERMS,
    funnel,
    events_grouped:    groups.length,
    events:            groups.slice(0, 5).map(g => ({
      event_slug:    g.event_slug,
      event_title:   g.event_title,
      speaker:       g.speaker,
      market_count:  g.markets.length,
      total_volume:  g.total_volume,
      sample_market: g.markets[0] ? { question: g.markets[0].question, label: g.markets[0].label, yes_price: g.markets[0].yes_price } : null,
    })),
  };
}

async function getWordMarketsByEventSlug(slug) {
  if (!slug) return null;
  try {
    const result = await polymarket.getEventBySlug(slug);
    if (!result || !result.event) return null;
    const parentTitle = result.event.title || '';
    const isLang      = _isLanguageEventTitle(parentTitle);
    // PR #144: keep closed sub-markets so resolved events (e.g.
    // post-FOMC Powell May) still show their historical sub-markets
    // + total volume on /event/<slug>. Pre-fix, the closed-filter
    // stripped all rows on resolved events → page rendered
    // "0 sub-markets · $0 traded". Each row carries closed/active
    // flags so the detail page can render Open / Pending / Resolved
    // sections separately.
    const subMarkets  = (result.eventMarkets || [])
      .map(m => ({
        condition_id: m.conditionId,
        slug:         m.slug || null,
        question:     m.question || '',
        label:        _candidateLabel(m, parentTitle),
        yes_price:    _parseYesPrice(m.outcomePrices),
        volume:       parseFloat(m.volume || m.volumeNum || 0) || 0,
        volume_24h:   parseFloat(m.volume24hr || 0) || 0,
        end_date:     m.endDate || m.end_date_iso || null,
        closed:       m.closed === true,
        active:       m.active !== false,
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

// PR #147 — find the next upcoming event for a given speaker.
// Used by /event/:slug to power the "Pick now →" CTA on past
// events so the resolved page funnels into the next live one.
// Returns null when the speaker has no upcoming events.
async function getNextUpcomingForSpeaker(speaker) {
  if (!speaker) return null;
  try {
    const events = await getUpcomingWordMarketEvents({ limit: 50 });
    if (!Array.isArray(events) || !events.length) return null;
    const norm = String(speaker).toLowerCase();
    const matches = events.filter(ev =>
      String(ev.speaker || '').toLowerCase() === norm
    );
    if (!matches.length) return null;
    // Earliest future end_date wins (closest upcoming). Events with
    // null end_date sort last so they don't beat a real date.
    matches.sort((a, b) => {
      const ta = Date.parse(a.end_date || '');
      const tb = Date.parse(b.end_date || '');
      if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if (!Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb)) return -1;
      return ta - tb;
    });
    // Skip the past matches; we want the next future one.
    const now = Date.now();
    for (const ev of matches) {
      const t = Date.parse(ev.end_date || '');
      if (!Number.isFinite(t) || t > now) {
        return {
          event_slug:  ev.event_slug,
          event_title: ev.event_title,
          speaker:     ev.speaker,
          end_date:    ev.end_date || null,
        };
      }
    }
    return null;
  } catch (_) { return null; }
}

module.exports = {
  getUpcomingWordMarketEvents,
  getWordMarketsByEventSlug,
  getNextUpcomingForSpeaker,
  runDiag,
  bustCache,
  getCachedSnapshot,
  DEFAULT_SPEAKERS,
  LANGUAGE_EVENT_PATTERNS,
  PATTERN_SEARCH_TERMS,
  _internals: { _isLanguageEventTitle, _candidateLabel, _parseYesPrice, _gammaUnwrap, _attributeSpeaker, _speakerList, _collectCandidates },
};
