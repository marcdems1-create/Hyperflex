/**
 * HYPERFLEX Signal Agent
 * Autonomous AI agent that evaluates whale consensus signals,
 * decides if they represent real edge, and broadcasts actionable plays.
 *
 * Architecture:
 *   whale-consensus fires → agent evaluates via Claude → persist → broadcast → draft X
 */

'use strict';

const EventEmitter = require('events');

class SignalAgent extends EventEmitter {
  constructor() {
    super();
    this.pool      = null;
    this.anthropic = null;
    this.clients   = new Set(); // SSE clients
    this.cache     = [];        // last 50 signals in memory
    this.processing = new Set(); // dedupe in-flight
  }

  init({ pool, anthropic }) {
    this.pool      = pool;
    this.anthropic = anthropic;
    this._ensureTable();
    console.log('[signal-agent] initialized');
    return this;
  }

  // ── Called by whale-consensus when N whales pile into a market ──────────
  async onWhaleConsensus({ market, side, whale_count, total_capital, market_price, slug }) {
    const key = `${slug}:${side}`;
    if (this.processing.has(key)) return;
    this.processing.add(key);

    try {
      // Only evaluate signals with meaningful capital + price inefficiency
      const capitalM = total_capital / 1e6;
      if (capitalM < 0.5 || whale_count < 2) return;

      const signal = await this._evaluate({ market, side, whale_count, total_capital, market_price, slug });
      if (!signal || signal.edge_rating < 5) return;

      await this._persist(signal);
      this._addToCache(signal);
      this._broadcast(signal);

      console.log(`[signal-agent] ${signal.edge_rating}/10 edge — ${signal.headline}`);
    } catch (err) {
      console.warn('[signal-agent] evaluation error:', err.message);
    } finally {
      setTimeout(() => this.processing.delete(key), 60_000); // 1min cooldown per market+side
    }
  }

  // ── Claude evaluates the signal ──────────────────────────────────────────
  async _evaluate({ market, side, whale_count, total_capital, market_price, slug }) {
    const capitalM   = (total_capital / 1e6).toFixed(1);
    const impliedPct = side === 'YES' ? market_price : (100 - market_price);
    const whalePct   = side === 'YES' ? Math.min(95, market_price + 15) : Math.max(5, market_price - 15);
    const edgePts    = Math.abs(whalePct - impliedPct);
    const multiplier = side === 'YES'
      ? (100 / market_price).toFixed(2)
      : (100 / (100 - market_price)).toFixed(2);

    const prompt = `You are a sharp prediction market analyst for HYPERFLEX, a Polymarket analytics platform.

A whale cluster signal has fired:
- Market: "${market}"
- Whales buying: ${side}
- Number of whales: ${whale_count}
- Total capital deployed: $${capitalM}M
- Current market price: ${market_price}¢ (${market_price}% YES)
- Side being bought: ${side} at ${side === 'YES' ? market_price : 100 - market_price}¢
- Implied multiplier if correct: ${multiplier}x
- Estimated whale-vs-market edge: ~${edgePts} points

Your job: evaluate this signal and return JSON only (no markdown, no preamble).

Return this exact shape:
{
  "worth_surfacing": true/false,
  "edge_rating": 1-10,
  "action": "BUY_YES" | "BUY_NO" | "WATCH",
  "headline": "one punchy sentence under 80 chars explaining the play",
  "rationale": "2-3 sentences explaining why whales are buying this, what they likely know, and the risk",
  "x_copy": "tweet under 240 chars — sharp, dry, no emojis except one 🚨 at start, include the multiplier and capital figure, end with hyperflex.network",
  "risk_flag": null or "SHORT WINDOW" or "HIGH VOLATILITY" or "BINARY EVENT"
}

Be decisive. If edge_rating >= 6, worth_surfacing = true. Rate honestly — not every whale trade is a signal.`;

    const resp = await this.anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text = (resp.content[0]?.text || '').trim();
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      console.warn('[signal-agent] failed to parse Claude response:', text.slice(0, 100));
      return null;
    }

    return {
      ...parsed,
      market_slug:   slug,
      market_title:  market,
      side,
      whale_count,
      total_capital,
      market_price,
      multiplier:    parseFloat(multiplier),
      capital_m:     parseFloat(capitalM),
      fired_at:      new Date().toISOString(),
    };
  }

  // ── Persist to DB ────────────────────────────────────────────────────────
  async _persist(signal) {
    if (!this.pool) return;
    try {
      await this.pool.query(`
        INSERT INTO agent_signals
          (market_slug, market_title, side, whale_count, total_capital, market_price,
           multiplier, edge_rating, action, headline, rationale, x_copy, risk_flag, worth_surfacing, fired_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (market_slug, side, fired_at::date) DO UPDATE
          SET edge_rating = EXCLUDED.edge_rating,
              headline    = EXCLUDED.headline,
              total_capital = GREATEST(agent_signals.total_capital, EXCLUDED.total_capital)
      `, [
        signal.market_slug, signal.market_title, signal.side,
        signal.whale_count, signal.total_capital, signal.market_price,
        signal.multiplier, signal.edge_rating, signal.action,
        signal.headline, signal.rationale, signal.x_copy,
        signal.risk_flag, signal.worth_surfacing,
      ]);
    } catch (err) {
      console.warn('[signal-agent] persist error:', err.message);
    }
  }

  // ── SSE broadcast ────────────────────────────────────────────────────────
  _broadcast(signal) {
    const data = JSON.stringify(signal);
    for (const res of this.clients) {
      try {
        res.write(`event: signal\ndata: ${data}\n\n`);
      } catch { this.clients.delete(res); }
    }
    this.emit('signal', signal);
  }

  addClient(res) {
    this.clients.add(res);
    // Send last 10 cached signals on connect
    const recent = this.cache.slice(-10);
    if (recent.length) {
      try {
        res.write(`event: snapshot\ndata: ${JSON.stringify(recent)}\n\n`);
      } catch {}
    }
    res.on('close', () => this.clients.delete(res));
  }

  _addToCache(signal) {
    this.cache.push(signal);
    if (this.cache.length > 50) this.cache.shift();
  }

  // ── Latest signals for API ───────────────────────────────────────────────
  async getRecent(limit = 20) {
    // Return from memory cache first (fast)
    if (this.cache.length) return this.cache.slice(-limit).reverse();
    // Fall back to DB
    if (!this.pool) return [];
    try {
      const { rows } = await this.pool.query(`
        SELECT * FROM agent_signals
        WHERE worth_surfacing = true
        ORDER BY fired_at DESC
        LIMIT $1
      `, [limit]);
      return rows;
    } catch { return []; }
  }

  async _ensureTable() {
    if (!this.pool) return;
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS agent_signals (
          id              SERIAL PRIMARY KEY,
          market_slug     TEXT NOT NULL,
          market_title    TEXT,
          side            TEXT,
          whale_count     INTEGER,
          total_capital   NUMERIC,
          market_price    NUMERIC,
          multiplier      NUMERIC,
          edge_rating     INTEGER,
          action          TEXT,
          headline        TEXT,
          rationale       TEXT,
          x_copy          TEXT,
          risk_flag       TEXT,
          worth_surfacing BOOLEAN DEFAULT true,
          fired_at        TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS agent_signals_slug_side_date_idx
          ON agent_signals(market_slug, side, (fired_at::date));
        CREATE INDEX IF NOT EXISTS agent_signals_fired_at_idx ON agent_signals(fired_at DESC);
      `);
    } catch (err) {
      console.warn('[signal-agent] table ensure error:', err.message);
    }
  }
}

module.exports = new SignalAgent();
