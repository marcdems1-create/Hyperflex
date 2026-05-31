'use strict';

// ── Alpha Engine: unified scored hot-markets cache ────────────────────────────
// Single source of truth for all scored + enriched trending markets.
// Powers /api/feed/trending, LIVE ALPHA cards, and popup filter.

let _cache = [];
let _cacheAt = 0;
const CACHE_TTL = 120_000; // 2 min

const _priceSnap = new Map(); // conditionId → { price24hAgo, recordedAt }

let _getWhaleCache    = () => null;
let _getScreenerCache = () => null;
let _fetchFn          = null;

function init(opts) {
  if (opts.getWhaleCache)    _getWhaleCache    = opts.getWhaleCache;
  if (opts.getScreenerCache) _getScreenerCache = opts.getScreenerCache;
  if (opts.fetch)            _fetchFn          = opts.fetch;
}

function _fetch(url, opts) {
  const f = _fetchFn || globalThis.fetch || require('node-fetch');
  return f(url, opts);
}

// ── Score formula ──────────────────────────────────────────────────────────────
function score(m) {
  const price    = Math.max(0.01, Math.min(0.99, m.yes_price || 0.5));
  const vol24h   = Number(m.volume_24h)  || 0;
  const volTotal = Number(m.volume_total) || 0;
  const days     = m.days_to_close != null ? m.days_to_close : 999;

  if (volTotal < 25000)             return 0;
  if (vol24h   < 100)               return 0;
  if (price < 0.03 || price > 0.97) return 0;
  if (m.closed || m.resolved)       return 0;

  const controversy = 1 - Math.abs(price - 0.5) * 2;
  if (controversy < 0.10) return 0; // kills only >90¢ or <10¢
  const momentum    = vol24h / Math.max(volTotal, 1);
  const urgency     = days < 1 ? 4 : days < 7 ? 2 : days < 30 ? 1.2 : 0.7;
  const whaleBoost  = (m.whale_count || 0) >= 2 ? 2.5 : (m.whale_count || 0) === 1 ? 1.5 : 1;
  const edgeBoost   = (m.edge_score || 0) > 6 ? 1 + ((m.edge_score - 6) * 0.2) : 1;
  const velBoost    = Math.abs(m.price_change_24h || 0) > 15 ? 2 : 1;

  // controversy^2: 74¢ market → 0.27× multiplier, 50¢ market → 1.0×
  return vol24h * Math.pow(controversy, 2) * (1 + momentum * 2) * urgency * whaleBoost * edgeBoost * velBoost;
}

// ── Badge + WHY bullets ────────────────────────────────────────────────────────
function fmtVol(v) {
  v = Number(v || 0);
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return Math.round(v / 1e3) + 'K';
  return Math.round(v).toString();
}

function enrich(m) {
  const why = [];
  let badge = 'HOT'; let icon = '🔥'; let color = '#f97316';

  if ((m.whale_count || 0) >= 1) {
    badge = 'WHALE IN'; icon = '🐋'; color = '#00d4ff';
    why.push((m.whale_count || 0) >= 2
      ? `${m.whale_count} tracked whales positioned ${m.whale_side || 'YES'} at ${m.whale_entry_price || '?'}¢`
      : `A top whale entered ${m.whale_side || 'YES'} at ${m.whale_entry_price || '?'}¢`
    );
  }

  const days = m.days_to_close != null ? m.days_to_close : 999;
  if (days > 0 && days < 1) {
    badge = 'CLOSING SOON'; icon = '⏱'; color = '#f59e0b';
    why.push(`Closes in ${Math.round(days * 24)} hours — last chance`);
  } else if (days > 0 && days < 3) {
    why.push(`Closes in ${Math.round(days)} day${Math.round(days) !== 1 ? 's' : ''}`);
  }

  if (Math.abs(m.price_change_24h || 0) >= 15) {
    if (badge === 'HOT') { badge = 'PRICE MOVE'; icon = '📉'; color = '#ef4444'; }
    why.push(`Price ${(m.price_change_24h || 0) > 0 ? 'surged' : 'dropped'} ${Math.abs(m.price_change_24h || 0)}¢ today`);
  }

  const dailyAvg = (m.volume_total || 0) / 30;
  const spike = dailyAvg > 0 ? (m.volume_24h || 0) / dailyAvg : 0;
  if (spike >= 4) {
    if (badge === 'HOT') { badge = 'VOLUME SPIKE'; icon = '🔥'; color = '#8b5cf6'; }
    why.push(`Volume ${Number(spike).toFixed(1)}x above daily average`);
  }

  if ((m.edge_score || 0) >= 7) {
    if (badge === 'HOT') { badge = 'SHARP EDGE'; icon = '⚡'; color = '#10b981'; }
    why.push(`Sharp consensus edge score: ${Number(m.edge_score || 0).toFixed(1)}`);
  }

  if (why.length === 0) {
    why.push(`$${fmtVol(m.volume_24h)} in play today`);
    if (days < 30) why.push(`Closes ${days < 1 ? 'today' : 'in ' + Math.round(days) + ' day' + (Math.round(days) !== 1 ? 's' : '')}`);
  }

  m.badge       = badge;
  m.badge_icon  = icon;
  m.badge_color = color;
  m.why         = why.slice(0, 3);
  m.score       = score(m);
  return m;
}

// ── Whale enrichment ───────────────────────────────────────────────────────────
function _attachWhaleData(markets) {
  const wc = _getWhaleCache();
  console.log('[alpha-engine] whale cache sample:', JSON.stringify(wc?.data?.whales?.[0])?.slice(0, 200));
  const whales = (wc && wc.data && Array.isArray(wc.data.whales)) ? wc.data.whales : [];
  const posMap = new Map();

  for (const whale of whales) {
    for (const pos of (whale.positions || [])) {
      if (!pos.conditionId || (pos.size || pos.size_usd || 0) < 3000) continue;
      const e = posMap.get(pos.conditionId) || { count: 0, yes: 0, no: 0, priceSum: 0 };
      e.count++;
      if ((pos.outcome || pos.side || '').toUpperCase() === 'NO') e.no++; else e.yes++;
      e.priceSum += Number(pos.avgPrice || pos.avg_price || pos.price || 0.5);
      posMap.set(pos.conditionId, e);
    }
  }

  for (const m of markets) {
    const d = posMap.get(m.conditionId);
    if (d) {
      m.whale_count       = d.count;
      m.whale_side        = d.yes >= d.no ? 'YES' : 'NO';
      m.whale_entry_price = Math.round((d.priceSum / d.count) * 100);
    } else {
      m.whale_count = 0;
    }
  }
}

// ── Price velocity ─────────────────────────────────────────────────────────────
function recordPrice(conditionId, price) {
  if (!conditionId || price == null) return;
  const rec = _priceSnap.get(conditionId);
  if (!rec || (Date.now() - rec.recordedAt) > 23 * 3600_000) {
    _priceSnap.set(conditionId, { price24hAgo: Number(price), recordedAt: Date.now() });
  }
}

setInterval(() => {
  const cutoff = Date.now() - 25 * 3600_000;
  for (const [k, v] of _priceSnap) { if (v.recordedAt < cutoff) _priceSnap.delete(k); }
}, 3600_000);

// ── Main refresh ───────────────────────────────────────────────────────────────
async function refresh() {
  try {
    const r = await _fetch(
      'https://gamma-api.polymarket.com/markets?closed=false&active=true&order=volume_24h&ascending=false&limit=100',
      { headers: { 'User-Agent': 'hyperflex/1.0' }, signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) { console.error('[alpha-engine] Gamma HTTP', r.status); return; }
    const raw = await r.json();
    if (!Array.isArray(raw)) return;

    const screenerData = (() => {
      const c = _getScreenerCache();
      return (c && Array.isArray(c.data)) ? c.data : (Array.isArray(c) ? c : []);
    })();
    const edgeMap = new Map(screenerData.map(s => [s.slug || s.market_slug, s.edge_score || null]));

    let markets = raw.map(g => {
      let yesPrice = 0.5;
      try {
        const op = g.outcomePrices;
        const arr = typeof op === 'string' ? JSON.parse(op) : op;
        if (Array.isArray(arr) && arr.length > 0) yesPrice = Math.max(...arr.map(p => parseFloat(p) || 0));
      } catch (_) {}
      if (g.bestBid != null && yesPrice === 0.5) yesPrice = Number(g.bestBid);

      const condId   = g.conditionId || g.id || g.slug;
      const vol24h   = Number(g.volume24hr || g.volume_24h || g.volumeNum24hr || 0);
      const volTotal = Number(g.volume || g.volumeNum || g.volume_total || 0);
      const endDate  = g.endDate || g.end_date || null;
      const snap     = _priceSnap.get(condId);
      recordPrice(condId, yesPrice);

      return {
        market_slug:      g.slug || '',
        question:         g.question || '',
        image:            g.image || g.icon || null,
        conditionId:      condId,
        event_slug:       g.eventSlug || g.groupItemTitle || null,
        yes_price:        yesPrice,
        yes_price_pct:    Math.round(yesPrice * 100),
        volume_24h:       vol24h,
        volume_total:     volTotal,
        end_date:         endDate,
        days_to_close:    endDate ? Math.max(0, (new Date(endDate) - Date.now()) / 86400_000) : 999,
        closed:           !!g.closed,
        resolved:         !!g.resolved,
        price_change_24h: snap ? Math.round((yesPrice - snap.price24hAgo) * 100) : null,
        edge_score:       edgeMap.get(g.slug || '') || null,
        whale_count:      0,
      };
    });

    _attachWhaleData(markets);
    markets = markets.map(enrich).filter(m => m.score > 0);
    markets.sort((a, b) => b.score - a.score);
    const _rawList = markets.slice(); // full scored list for diversity injection

    // ── Event-slug dedup: max 2 per event ─────────────────────────────────────
    const evCount = new Map();
    markets = markets.filter(m => {
      const key = m.event_slug || m.market_slug || '';
      const n = evCount.get(key) || 0;
      if (n >= 2) return false;
      evCount.set(key, n + 1);
      return true;
    });

    // ── Phrase dedup: GTA VI / other flooding phrases capped at 2 each ─────────
    const PHRASE_CAP = ['gta vi', 'gta6', 'grand theft auto', 'world cup', 'nba finals',
                        'stanley cup', 'super bowl', 'nfl draft', 'nfl season'];
    const phraseCount = new Map();
    markets = markets.filter(m => {
      const q = (m.question || '').toLowerCase();
      for (const phrase of PHRASE_CAP) {
        if (q.includes(phrase)) {
          const n = phraseCount.get(phrase) || 0;
          if (n >= 2) return false;
          phraseCount.set(phrase, n + 1);
          break;
        }
      }
      return true;
    });

    // ── Sport cap: max 2 sports markets total ──────────────────────────────────
    const SPORT_PATTERNS = ['nba', 'nfl', 'nhl', 'fifa', 'world cup', 'finals',
                            'championship', 'super bowl', 'stanley cup', 'playoffs',
                            'mlb', 'match winner', 'soccer'];
    let sportCount = 0;
    markets = markets.filter(m => {
      const q = (m.question || '').toLowerCase();
      const isSport = SPORT_PATTERNS.some(p => q.includes(p));
      if (isSport) { sportCount++; return sportCount <= 2; }
      return true;
    });

    // ── Hard category caps ─────────────────────────────────────────────────────
    const CATEGORY_CAPS = { sports: 2, politics: 4, crypto: 3, other: 4 };
    function getCategory(question) {
      const q = (question || '').toLowerCase();
      if (/nba|nfl|nhl|mlb|fifa|world cup|finals|championship|playoff|tennis|ufc|golf|soccer|basketball|football|hockey|baseball/.test(q)) return 'sports';
      if (/trump|biden|democrat|republican|election|congress|senate|president|political|vote|fed|fomc|warsh|powell|tariff|ukraine|russia|china|taiwan|iran|israel|war/.test(q)) return 'politics';
      if (/bitcoin|btc|eth|crypto|solana|coin|token|defi|blockchain|microstrategy/.test(q)) return 'crypto';
      return 'other';
    }
    const catCount = { sports: 0, politics: 0, crypto: 0, other: 0 };
    markets = markets.filter(m => {
      const cat = getCategory(m.question);
      m.category = cat;
      if (catCount[cat] >= CATEGORY_CAPS[cat]) return false;
      catCount[cat]++;
      return true;
    });

    _cache   = markets;
    _cacheAt = Date.now();
    console.log(`[alpha-engine] refreshed: ${markets.length} markets, top: ${markets[0]?.market_slug || 'none'}`);
  } catch (e) {
    console.error('[alpha-engine] refresh error:', e.message);
  }
}

function getHotMarkets(limit) {
  return _cache.slice(0, limit == null ? 15 : limit);
}

function invalidate() { _cacheAt = 0; }

function recordTrade(tick) {
  if (tick && tick.asset && tick.price != null) recordPrice(tick.asset, tick.price);
  if ((tick.size || 0) >= 1000) invalidate();
}

module.exports = { init, refresh, getHotMarkets, invalidate, recordTrade, fmtVol, score };
