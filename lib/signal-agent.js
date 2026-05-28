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
    this._ensureTable().then(() => {
      // Seed existing signals after a short delay to let DB warm up
      setTimeout(() => this._seedExisting(), 8000);
    });
    console.log('[signal-agent] initialized');
    return this;
  }

  // ── Seed existing whale-consensus signals that predate this deploy ───────
  async _seedExisting() {
    if (!this.pool) return;
    try {
      // Pull top whale clusters from last 72h that haven't been evaluated yet
      const { rows } = await this.pool.query(`
        SELECT
          pt.market_title   AS market,
          pt.side,
          COUNT(DISTINCT pt.proxy_wallet) AS whale_count,
          SUM(pt.usd_amount)              AS total_capital,
          AVG(pt.price)                   AS avg_price,
          MIN(pt.community_slug)          AS slug,
          MIN(pt.condition_id)            AS condition_id
        FROM polymarket_trades pt
        WHERE pt.is_whale = true
          AND pt.created_at > now() - interval '72 hours'
          AND pt.market_title IS NOT NULL
        GROUP BY pt.market_title, pt.side
        HAVING COUNT(DISTINCT pt.proxy_wallet) >= 2
           AND SUM(pt.usd_amount) >= 500000
        ORDER BY SUM(pt.usd_amount) DESC
        LIMIT 25
      `);

      if (!rows.length) {
        console.log('[signal-agent] no existing signals to seed');
        return;
      }

      console.log(`[signal-agent] seeding ${rows.length} existing whale consensus signals`);

      for (const row of rows) {
        const avgPrice   = parseFloat(row.avg_price) || 0.5;
        const marketPrice = row.side === 'YES'
          ? Math.round(avgPrice * 100)
          : Math.round((1 - avgPrice) * 100);

        await this.onWhaleConsensus({
          market:        row.market,
          side:          row.side,
          whale_count:   parseInt(row.whale_count),
          total_capital: parseFloat(row.total_capital),
          market_price:  marketPrice,
          slug:          row.slug || '',
        });

        // Stagger 1.5s between calls — don't hammer Claude
        await new Promise(r => setTimeout(r, 1500));
      }

      console.log('[signal-agent] seeding complete');
    } catch (err) {
      console.warn('[signal-agent] seed error:', err.message);
    }
  }

  // ── Called by whale-consensus when N whales pile into a market ──────────
  async onWhaleConsensus({ market, side, whale_count, total_capital, market_price, slug }) {
    const key = `${slug || market}:${side}`;
    if (this.processing.has(key)) return;
    this.processing.add(key);

    try {
      const capitalM = total_capital / 1e6;
      if (capitalM < 0.5 || whale_count < 2) return;

      const signal = await this._evaluate({ market, side, whale_count, total_capital, market_price, slug });
      if (!signal || signal.edge_rating < 5) return;

      await this._persist(signal);
      this._addToCache(signal);
      this._broadcast(signal);

      console.log(`[signal-agent] 🎯 ${signal.edge_rating}/10 — ${signal.headline}`);
    } catch (err) {
      console.warn('[signal-agent] evaluation error:', err.message);
    } finally {
      setTimeout(() => this.processing.delete(key), 60_000);
    }
  }

  // ── Claude evaluates the signal ──────────────────────────────────────────
  async _evaluate({ market, side, whale_count, total_capital, market_price, slug }) {
    const capitalM   = (total_capital / 1e6).toFixed(1);
    const priceSide  = side === 'YES' ? market_price : (100 - market_price);
    const multiplier = (100 / Math.max(1, priceSide)).toFixed(2);

    const prompt = `You are a sharp prediction market analyst for HYPERFLEX, a Polymarket analytics platform.

A whale cluster signal has fired:
- Market: "${market}"
- Whales buying: ${side}
- Number of whales: ${whale_count}
- Total capital deployed: $${capitalM}M
- Current market price: ${market_price}¢ YES
- Side being bought: ${side} at ${priceSide}¢
- Implied multiplier if correct: ${multiplier}x

Your job: evaluate this signal and return JSON only (no markdown, no preamble).

Return this exact shape:
{
  "worth_surfacing": true or false,
  "edge_rating": 1 to 10,
  "action": "BUY_YES" or "BUY_NO" or "WATCH",
  "headline": "one punchy sentence under 80 chars explaining the play",
  "rationale": "2-3 sentences: why whales are buying this, what they likely know, and the risk",
  "x_copy": "tweet under 240 chars — sharp, dry, one 🚨 at start, include the multiplier and capital figure, end with hyperflex.network",
  "risk_flag": null or "SHORT WINDOW" or "HIGH VOLATILITY" or "BINARY EVENT"
}

Be decisive. edge_rating >= 6 means worth_surfacing = true. Rate honestly.`;

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
      console.warn('[signal-agent] parse error:', text.slice(0, 120));
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
          SET edge_rating    = EXCLUDED.edge_rating,
              headline       = EXCLUDED.headline,
              total_capital  = GREATEST(agent_signals.total_capital, EXCLUDED.total_capital)
      `, [
        signal.market_slug || '', signal.market_title, signal.side,
        signal.whale_count, signal.total_capital, signal.market_price,
        signal.multiplier, signal.edge_rating, signal.action,
        signal.headline, signal.rationale, signal.x_copy,
        signal.risk_flag, signal.worth_surfacing,
      ]);
    } catch (err) {
      // Table may not exist yet — fail silently, cache still works
      if (!err.message.includes('does not exist')) {
        console.warn('[signal-agent] persist error:', err.message);
      }
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
    const recent = this.cache.slice(-10);
    if (recent.length) {
      try { res.write(`event: snapshot\ndata: ${JSON.stringify(recent)}\n\n`); } catch {}
    }
    res.on('close', () => this.clients.delete(res));
  }

  _addToCache(signal) {
    this.cache.push(signal);
    if (this.cache.length > 50) this.cache.shift();
  }

  // ── Latest signals for API ───────────────────────────────────────────────
  async getRecent(limit = 20) {
    if (this.cache.length) return this.cache.slice(-limit).reverse();
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
          market_slug     TEXT NOT NULL DEFAULT '',
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
        CREATE INDEX IF NOT EXISTS agent_signals_fired_at_idx ON agent_signals(fired_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS agent_signals_dedup_idx
          ON agent_signals(market_slug, side, (fired_at::date));
      `);
    } catch (err) {
      console.warn('[signal-agent] table ensure error:', err.message);
    }
  }
}

module.exports = new SignalAgent();
