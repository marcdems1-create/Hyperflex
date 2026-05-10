// lib/hero-banner.js
//
// Self-rotating homepage hero banner. Picks the highest-volume,
// soonest-resolving Polymarket event meeting volume + horizon thresholds,
// caches the choice for 1 hour, and busts when the cached event resolves
// (1-min cron in server.js calls checkCachedEventResolved).
//
// Tunable knobs are constants below. All accept env-var overrides for
// emergency adjustment without redeploy. HERO_BANNER_BLACKLIST is the
// manual escape hatch — comma-separated event_slugs to exclude.

'use strict';

const polymarket = require('./polymarket');

const MIN_VOL_24H_USD = Number(process.env.HERO_BANNER_MIN_VOL_24H)  || 50000;
const MAX_DAYS        = Number(process.env.HERO_BANNER_MAX_DAYS)     || 90;
const W_24H           = Number(process.env.HERO_BANNER_W_24H)        || 0.4;
const W_7D            = Number(process.env.HERO_BANNER_W_7D)         || 0.6;
const DAYS_PENALTY    = Number(process.env.HERO_BANNER_DAYS_PENALTY) || 100;
const CACHE_TTL_MS    = Number(process.env.HERO_BANNER_CACHE_TTL_MS) || 3600000; // 1h
const IMMINENT_DAYS   = 7;

let _cache = null;  // { value: bannerObject|null, expiresAt: ms, fetchedAt: ms }

function _blacklist() {
  return String(process.env.HERO_BANNER_BLACKLIST || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function _daysUntil(endDateIso) {
  if (!endDateIso) return Infinity;
  const end = Date.parse(endDateIso);
  if (!Number.isFinite(end)) return Infinity;
  return (end - Date.now()) / 86400000;
}

function _qualifies(ev) {
  if (!ev) return false;
  if (ev.closed || ev.active === false) return false;
  const vol24h = Number(ev.volume_24hr || 0);
  if (vol24h < MIN_VOL_24H_USD) return false;
  const days = _daysUntil(ev.end_date);
  if (!Number.isFinite(days) || days <= 0 || days > MAX_DAYS) return false;
  if (_blacklist().includes(String(ev.slug || '').toLowerCase())) return false;
  return true;
}

function _scoreEvent(ev) {
  // 7d gamma value when present; fall back to 24h * 7 to keep the 60/40
  // weighting stable when an event hasn't existed long enough for a true
  // weekly figure.
  const v7  = Number(ev.volume_7d != null ? ev.volume_7d : (Number(ev.volume_24hr || 0) * 7));
  const v24 = Number(ev.volume_24hr || 0);
  const days = _daysUntil(ev.end_date);
  return (v7 * W_7D) + (v24 * W_24H) - (days * DAYS_PENALTY);
}

function _rank(events) {
  return events
    .filter(_qualifies)
    .map(ev => ({
      ev,
      score: _scoreEvent(ev),
      v24:   Number(ev.volume_24hr || 0),
      id:    String(ev.id || ''),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.v24   !== a.v24)   return b.v24   - a.v24;
      return a.id.localeCompare(b.id);
    });
}

function _formatVol(v) {
  if (!Number.isFinite(v) || v <= 0) return '$0';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
  return '$' + Math.round(v);
}

function _toBanner(ev) {
  const days = _daysUntil(ev.end_date);
  const mode = days <= IMMINENT_DAYS ? 'imminent' : 'anchor';
  const totalVol = Number(ev.volume || 0);
  const vol24h   = Number(ev.volume_24hr || 0);
  const positionCount = Number(ev.open_interest || 0) || null;

  let hoursUntilEnd = null, minutesUntilEnd = null;
  if (mode === 'imminent') {
    const ms = Date.parse(ev.end_date) - Date.now();
    if (Number.isFinite(ms) && ms > 0) {
      hoursUntilEnd   = Math.floor(ms / 3600000);
      minutesUntilEnd = Math.floor((ms % 3600000) / 60000);
    }
  }
  const category = ev.category || (Array.isArray(ev.tags) && ev.tags[0]) || null;

  let headline;
  if (mode === 'anchor') {
    const parts = [`${_formatVol(totalVol)} traded`];
    if (positionCount && positionCount > 0) parts.push(`${positionCount.toLocaleString('en-US')} positions`);
    headline = parts.join(' · ');
  } else {
    headline = `${_formatVol(vol24h)} 24h volume`;
  }

  return {
    event_slug:        String(ev.slug || ''),
    event_title:       ev.title || '',
    event_image_url:   ev.image || null,
    category:          category || null,
    end_date:          ev.end_date || null,
    days_until_end:    Math.max(0, Math.floor(days)),
    hours_until_end:   hoursUntilEnd,
    minutes_until_end: minutesUntilEnd,
    mode,
    volume_total_usd:  Math.round(totalVol),
    volume_24h_usd:    Math.round(vol24h),
    position_count:    positionCount,
    headline_stat:     headline,
    cta_label:         mode === 'imminent' ? 'OPEN EVENT' : 'TRACK MARKET',
    cta_href:          '/event/' + String(ev.slug || ''),
  };
}

async function _selectFresh() {
  const nowIso = new Date().toISOString();
  const maxIso = new Date(Date.now() + MAX_DAYS * 86400000).toISOString();
  let events;
  try {
    events = await polymarket.fetchPolymarketEvents({
      active: true,
      endDateMin: nowIso,
      endDateMax: maxIso,
      limit: 200,
    });
  } catch (e) {
    console.warn('[hero-banner] fetchPolymarketEvents failed:', e.message);
    return null;
  }
  if (!Array.isArray(events) || !events.length) return null;
  const ranked = _rank(events);
  if (!ranked.length) return null;
  return _toBanner(ranked[0].ev);
}

async function getHeroBanner() {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.value;
  const fresh = await _selectFresh();
  _cache = { value: fresh, expiresAt: now + CACHE_TTL_MS, fetchedAt: now };
  return fresh;
}

function bustCache() {
  _cache = null;
}

function getCachedSnapshot() {
  if (!_cache) return null;
  return {
    value:      _cache.value,
    expiresAt:  _cache.expiresAt,
    fetchedAt:  _cache.fetchedAt,
    age_ms:     Date.now() - _cache.fetchedAt,
  };
}

// Called by the 1-min resolution-detection cron in server.js. If the
// currently-cached event has resolved, expired, or been removed from
// gamma, bust the cache so the next /api/hero-banner fetch picks the
// next-best candidate. Returns true when a bust occurred.
async function checkCachedEventResolved() {
  if (!_cache || !_cache.value || !_cache.value.event_slug) return false;
  const slug = _cache.value.event_slug;
  try {
    const ev = await polymarket.getEventBySlug(slug);
    if (!ev) {
      bustCache();
      console.log('[hero-banner] cached event slug=' + slug + ' not found in gamma — busted cache');
      return true;
    }
    if (ev.closed || ev.active === false) {
      bustCache();
      console.log('[hero-banner] cached event slug=' + slug + ' resolved — busted cache');
      return true;
    }
    const days = _daysUntil(ev.end_date);
    if (!Number.isFinite(days) || days <= 0) {
      bustCache();
      console.log('[hero-banner] cached event slug=' + slug + ' end_date passed — busted cache');
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[hero-banner] resolution-check error:', e.message);
    return false;
  }
}

module.exports = {
  getHeroBanner,
  bustCache,
  getCachedSnapshot,
  checkCachedEventResolved,
  _config: { MIN_VOL_24H_USD, MAX_DAYS, W_24H, W_7D, DAYS_PENALTY, CACHE_TTL_MS, IMMINENT_DAYS },
  _internals: { _qualifies, _scoreEvent, _rank, _toBanner, _selectFresh, _daysUntil, _formatVol },
};
