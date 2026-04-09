/**
 * HYPERFLEX live-stream — Polymarket real-time data client
 *
 * Connects to wss://ws-live-data.polymarket.com and subscribes to
 * `activity/trades` (all markets). Every incoming trade event carries
 * `price` + `asset` (tokenId) + `slug`, so the trade feed doubles as a
 * real-time price tick stream — every time someone trades on Polymarket,
 * we see the new execution price for that token within milliseconds.
 *
 * Maintains an in-memory Map of latest price per tokenId/slug and a
 * lightweight listener list so the SSE endpoint can forward ticks to
 * connected browser clients without polling the map.
 *
 * Auto-reconnect with exponential backoff (max 30s). Ping every 5s
 * per Polymarket's protocol. No authentication — activity/trades is
 * a public stream.
 *
 * Usage:
 *   const live = require('./lib/live-stream');
 *   live.start();                        // begins connection
 *   live.getPrice(tokenId);              // { price, ts, side, size, slug } | null
 *   live.getPriceBySlug(slug);           // same, keyed by slug
 *   live.onTrade(fn);                    // fn({asset, slug, price, side, size, ts, ...})
 *   live.offTrade(fn);                   // unsubscribe
 *   live.getStats();                     // { connected, totalTrades, tokens, uptimeMs }
 */
'use strict';

const WS_URL = 'wss://ws-live-data.polymarket.com';
const PING_INTERVAL_MS = 5000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const MAX_LISTENERS = 1000; // safety cap so a buggy caller can't leak

// _livePrices: Map<tokenId, { price, side, size, ts, slug, eventSlug, title }>
const _livePrices = new Map();
// Also keyed by slug (the market slug, not event slug) for convenience
const _pricesBySlug = new Map();

let _ws = null;
let _pingTimer = null;
let _reconnectTimer = null;
let _reconnectDelay = RECONNECT_BASE_MS;
let _started = false;
let _startTs = 0;
let _totalTrades = 0;
let _lastMessageTs = 0;
let _connected = false;

// Trade listeners — called for every incoming trade, regardless of token.
// SSE endpoints fan this out to their connected clients.
const _listeners = new Set();

function _log(...args) { console.log('[live-stream]', ...args); }
function _warn(...args) { console.warn('[live-stream]', ...args); }

function _clearTimers() {
  if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
}

function _handleTrade(payload) {
  if (!payload || typeof payload !== 'object') return;
  const asset = payload.asset || payload.token_id || null;
  if (!asset) return;
  const price = parseFloat(payload.price);
  if (!isFinite(price) || price <= 0 || price >= 1) return;

  const tick = {
    price: price,
    side: (payload.side || '').toUpperCase(),
    size: parseFloat(payload.size) || 0,
    ts: payload.timestamp ? Number(payload.timestamp) : Date.now(),
    slug: payload.slug || null,
    eventSlug: payload.eventSlug || null,
    title: payload.title || null,
    outcome: payload.outcome || null,
    asset: asset,
  };

  _livePrices.set(asset, tick);
  if (tick.slug) _pricesBySlug.set(tick.slug, tick);
  _totalTrades++;
  _lastMessageTs = Date.now();

  // Fan out to listeners — catch errors so one bad listener can't kill the loop
  for (const fn of _listeners) {
    try { fn(tick); } catch (e) { _warn('listener error:', e.message); }
  }
}

function _subscribe() {
  if (!_ws || _ws.readyState !== 1) return;
  try {
    _ws.send(JSON.stringify({
      action: 'subscribe',
      subscriptions: [{ topic: 'activity', type: 'trades' }]
    }));
    _log('subscribed to activity/trades');
  } catch (e) { _warn('subscribe failed:', e.message); }
}

function _connect() {
  if (_ws) {
    try { _ws.removeAllListeners(); } catch {}
    try { _ws.terminate(); } catch {}
    _ws = null;
  }
  _clearTimers();

  let WebSocket;
  try {
    WebSocket = require('ws');
  } catch (e) {
    _warn('ws module not installed — live streaming disabled');
    return;
  }

  try {
    _ws = new WebSocket(WS_URL);
  } catch (e) {
    _warn('connection init failed:', e.message);
    _scheduleReconnect();
    return;
  }

  _ws.on('open', () => {
    _connected = true;
    _reconnectDelay = RECONNECT_BASE_MS;
    _log('connected');
    _subscribe();
    // Ping every 5s per Polymarket's protocol — plain string, not a frame
    _pingTimer = setInterval(() => {
      if (_ws && _ws.readyState === 1) {
        try { _ws.send('ping'); } catch {}
      }
    }, PING_INTERVAL_MS);
  });

  _ws.on('message', (data) => {
    const text = data.toString();
    // Server sometimes sends bare "pong" or other control strings — ignore
    if (!text || text.length === 0) return;
    if (text === 'pong' || text === 'ping') return;
    let msg;
    try { msg = JSON.parse(text); }
    catch (e) { return; /* silent — not all frames are JSON */ }
    if (!msg || !msg.payload) return;
    // activity/trades messages come through with topic:"activity", type:"trades"
    if (msg.topic === 'activity' && msg.type === 'trades') {
      _handleTrade(msg.payload);
    }
  });

  _ws.on('close', (code, reason) => {
    _connected = false;
    _log('closed', code, reason && reason.toString());
    _clearTimers();
    _scheduleReconnect();
  });

  _ws.on('error', (err) => {
    _warn('error:', err.message);
    // 'close' will fire after error — no need to schedule reconnect here
  });
}

function _scheduleReconnect() {
  if (_reconnectTimer) return;
  const delay = Math.min(_reconnectDelay, RECONNECT_MAX_MS);
  _log('reconnect in', delay, 'ms');
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _reconnectDelay = Math.min(_reconnectDelay * 2, RECONNECT_MAX_MS);
    _connect();
  }, delay);
}

// ── Public API ──────────────────────────────────────────────────────────────

function start() {
  if (_started) return;
  _started = true;
  _startTs = Date.now();
  _log('starting');
  _connect();
}

function stop() {
  _started = false;
  _clearTimers();
  if (_ws) {
    try { _ws.removeAllListeners(); } catch {}
    try { _ws.close(); } catch {}
    _ws = null;
  }
  _connected = false;
}

function getPrice(tokenId) {
  return _livePrices.get(tokenId) || null;
}

function getPriceBySlug(slug) {
  return _pricesBySlug.get(slug) || null;
}

function getAllPrices() {
  // Returns a shallow snapshot — callers shouldn't mutate the map
  const out = {};
  for (const [k, v] of _livePrices) out[k] = v;
  return out;
}

function onTrade(fn) {
  if (typeof fn !== 'function') return;
  if (_listeners.size >= MAX_LISTENERS) {
    _warn('listener cap reached; refusing new listener');
    return;
  }
  _listeners.add(fn);
}

function offTrade(fn) {
  _listeners.delete(fn);
}

function getStats() {
  return {
    connected: _connected,
    total_trades: _totalTrades,
    tracked_tokens: _livePrices.size,
    listeners: _listeners.size,
    uptime_ms: _started ? Date.now() - _startTs : 0,
    last_message_ms_ago: _lastMessageTs ? Date.now() - _lastMessageTs : null,
    reconnect_delay_ms: _reconnectDelay,
  };
}

module.exports = {
  start,
  stop,
  getPrice,
  getPriceBySlug,
  getAllPrices,
  onTrade,
  offTrade,
  getStats,
};
