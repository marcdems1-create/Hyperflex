/**
 * HYPERFLEX DATA API — /api/v1/ routes
 *
 * Clean, documented endpoints for normalized market data.
 * These are the foundation of the external API business (Pillar 1).
 *
 * Usage: require('./lib/data-api-routes')(app, dataEngine);
 */

'use strict';

module.exports = function mountDataAPI(app, dataEngine, opts) {
  var _getWhaleCache = (opts && opts.getWhaleCache) || function() { return null; };
  var _getAlphaList = (opts && opts.getAlphaList) || null;
  var _dbQuery = (opts && opts.dbQuery) || null;

  // ── GET /api/v1/markets — list all normalized markets ──────────────────
  // Query params: source, category, status, search, sort, order, limit, offset
  app.get('/api/v1/markets', async (req, res) => {
    try {
      const result = await dataEngine.getMarkets({
        source: req.query.source,
        category: req.query.category,
        status: req.query.status || 'active',
        search: req.query.search || req.query.q,
        sort: req.query.sort,
        order: req.query.order,
        limit: req.query.limit,
        offset: req.query.offset
      });
      res.json(result);
    } catch (err) {
      console.error('[api/v1/markets]', err.message);
      res.status(500).json({ error: 'Failed to fetch markets', detail: err.message });
    }
  });

  // ── GET /api/v1/markets/:hfxId — single market detail ─────────────────
  app.get('/api/v1/markets/:hfxId', async (req, res) => {
    try {
      // hfxId format: "polymarket:slug" or "sportsbook:id"
      const hfxId = req.params.hfxId;
      const market = dataEngine.getMarketById(hfxId);
      if (!market) {
        // Try refreshing cache in case it's a new market
        await dataEngine.refreshAll();
        const fresh = dataEngine.getMarketById(hfxId);
        if (!fresh) return res.status(404).json({ error: 'Market not found' });
        return res.json(fresh);
      }
      res.json(market);
    } catch (err) {
      console.error('[api/v1/markets/:id]', err.message);
      res.status(500).json({ error: 'Failed to fetch market', detail: err.message });
    }
  });

  // ── GET /api/v1/markets/:hfxId/prices — historical price data ─────────
  app.get('/api/v1/markets/:hfxId/prices', async (req, res) => {
    try {
      const hours = Math.min(parseInt(req.query.hours) || 24, 720); // Max 30 days
      const result = await dataEngine.getPriceHistory(req.params.hfxId, hours);
      res.json(result);
    } catch (err) {
      console.error('[api/v1/markets/:id/prices]', err.message);
      res.status(500).json({ error: 'Failed to fetch price history', detail: err.message });
    }
  });

  // ── GET /api/v1/arbitrage — cross-platform arb opportunities ──────────
  app.get('/api/v1/arbitrage', async (req, res) => {
    try {
      const result = await dataEngine.getCrossRefs({
        min_spread: req.query.min_spread || 0.02, // Default: 2¢ minimum
        category: req.query.category,
        source: req.query.source,
        limit: req.query.limit
      });
      res.json(result);
    } catch (err) {
      console.error('[api/v1/arbitrage]', err.message);
      res.status(500).json({ error: 'Failed to fetch arbitrage data', detail: err.message });
    }
  });

  // ── GET /api/v1/cross-refs — all cross-platform matches (incl. small spreads)
  app.get('/api/v1/cross-refs', async (req, res) => {
    try {
      const result = await dataEngine.getCrossRefs({
        min_spread: req.query.min_spread || 0,
        category: req.query.category,
        source: req.query.source,
        limit: req.query.limit
      });
      res.json(result);
    } catch (err) {
      console.error('[api/v1/cross-refs]', err.message);
      res.status(500).json({ error: 'Failed to fetch cross-references', detail: err.message });
    }
  });

  // ── GET /api/v1/stats — platform-wide statistics ──────────────────────
  app.get('/api/v1/stats', (req, res) => {
    try {
      res.json(dataEngine.getStats());
    } catch (err) {
      console.error('[api/v1/stats]', err.message);
      res.status(500).json({ error: 'Failed to get stats', detail: err.message });
    }
  });

  // ── GET /api/v1/sources — available data sources ──────────────────────
  app.get('/api/v1/sources', (req, res) => {
    res.json({
      sources: [
        {
          id: 'polymarket',
          name: 'Polymarket',
          type: 'prediction_market',
          status: 'live',
          markets_tracked: 'Top 200 by volume',
          update_frequency: '90 seconds',
          data_available: ['prices', 'volume', 'liquidity', 'whale_positions']
        },
        {
          id: 'sportsbook',
          name: 'Sports Books',
          type: 'sportsbook_aggregator',
          status: process.env.ODDS_API_KEY ? 'live' : 'inactive',
          bookmakers: ['DraftKings', 'FanDuel', 'BetMGM', 'Bet365'],
          update_frequency: '90 seconds',
          data_available: ['prices']
        }
      ],
      api_version: 'v1',
      documentation: '/api-docs'
    });
  });

  // ── GET /api/v1/smart-money/flow — aggregate whale flow direction ─────
  app.get('/api/v1/smart-money/flow', async (req, res) => {
    try {
      const whaleCache = _getWhaleCache();
      const whaleData = (whaleCache && whaleCache.data) || {};
      const positions = whaleData.whales || [];

      // Compute aggregate flow
      let yesCapital = 0, noCapital = 0, yesCount = 0, noCount = 0;
      for (const p of positions) {
        const size = parseFloat(p.size) || 0;
        if (p.side === 'Yes' || p.side === 'YES') { yesCapital += size; yesCount++; }
        else { noCapital += size; noCount++; }
      }

      const totalCapital = yesCapital + noCapital;
      const sentiment = totalCapital > 0 ? Math.round((yesCapital / totalCapital) * 100) : 50;

      // Top movers: whales with biggest recent position changes
      const traderMap = new Map();
      for (const p of positions) {
        const size = parseFloat(p.size) || 0;
        const existing = traderMap.get(p.trader) || { name: p.trader, pnl: p.pnl || 0, totalCapital: 0, positions: 0, rank: p.rank };
        existing.totalCapital += size;
        existing.positions++;
        traderMap.set(p.trader, existing);
      }
      const topMovers = Array.from(traderMap.values())
        .sort((a, b) => b.totalCapital - a.totalCapital)
        .slice(0, 10);

      // Conviction heatmap: markets ranked by whale capital concentration
      const marketCap = new Map();
      for (const p of positions) {
        const size = parseFloat(p.size) || 0;
        const key = p.question || p.market || 'unknown';
        const existing = marketCap.get(key) || { question: key, totalCapital: 0, whaleCount: 0, dominantSide: null, yesCap: 0, noCap: 0, slug: p.slug };
        existing.totalCapital += size;
        existing.whaleCount++;
        if (p.side === 'Yes' || p.side === 'YES') existing.yesCap += size;
        else existing.noCap += size;
        existing.dominantSide = existing.yesCap >= existing.noCap ? 'YES' : 'NO';
        marketCap.set(key, existing);
      }
      const convictionMap = Array.from(marketCap.values())
        .sort((a, b) => b.totalCapital - a.totalCapital)
        .slice(0, 15);

      // active_consensus was previously hardcoded to 0 — whale_consensus_signals
      // is real, populated data (3+ whales aligned on the same market+side,
      // written by the whale-fetch pipeline in server.js). Query it for real.
      var activeConsensusCount = 0;
      if (_dbQuery) {
        try {
          var countRows = await _dbQuery(
            `SELECT COUNT(*)::int AS n FROM whale_consensus_signals
             WHERE status = 'active' AND last_seen_at > NOW() - INTERVAL '4 hours'`,
            []
          );
          activeConsensusCount = (countRows[0] && countRows[0].n) || 0;
        } catch (e) { /* leave at 0 if db unavailable */ }
      }

      res.json({
        sentiment_pct: sentiment,
        direction: sentiment > 55 ? 'bullish' : sentiment < 45 ? 'bearish' : 'neutral',
        yes_capital: yesCapital,
        no_capital: noCapital,
        yes_positions: yesCount,
        no_positions: noCount,
        total_tracked_capital: totalCapital,
        active_consensus: activeConsensusCount,
        top_movers: topMovers,
        conviction_heatmap: convictionMap,
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[api/v1/smart-money/flow]', err.message);
      res.status(500).json({ error: 'Failed to compute smart money flow', detail: err.message });
    }
  });

  // ── GET /api/v1/anomalies — live anomaly detection ────────────────────
  app.get('/api/v1/anomalies', async (req, res) => {
    try {
      const anomalyEngine = require('./anomaly-engine');
      const result = await anomalyEngine.getAnomalies({
        type: req.query.type,
        severity: req.query.severity,
        limit: req.query.limit
      });
      res.json(result);
    } catch (err) {
      console.error('[api/v1/anomalies]', err.message);
      res.status(500).json({ error: 'Failed to fetch anomalies', detail: err.message });
    }
  });

  // ── GET /api/v1/smart-money/consensus — active whale consensus signals ──
  // Full detail behind the count that /smart-money/flow's active_consensus
  // reports: which markets, which side, how many whales, how much capital.
  app.get('/api/v1/smart-money/consensus', async (req, res) => {
    try {
      if (!_dbQuery) return res.json({ signals: [], updated_at: new Date().toISOString() });
      const hours = Math.min(72, Math.max(1, parseInt(req.query.hours) || 4));
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
      const signals = await _dbQuery(
        `SELECT market, side, whale_count, total_capital, avg_price,
                slug, condition_id, clob_token_ids, market_url,
                first_seen_at, last_seen_at
         FROM whale_consensus_signals
         WHERE status = 'active' AND last_seen_at > NOW() - INTERVAL '${hours} hours'
         ORDER BY whale_count DESC, total_capital DESC
         LIMIT $1`,
        [limit]
      ).catch(() => []);
      res.json({ signals, count: signals.length, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[api/v1/smart-money/consensus]', err.message);
      res.status(500).json({ error: 'Failed to fetch consensus signals', detail: err.message });
    }
  });

  // ── GET /api/v1/liquidity — live orderbook depth per market ────────────
  // Depth is only computed by the alpha pipeline for markets above its volume
  // floor (currently $100k/24h) — see fetchClobDepth in server.js. Markets
  // below that floor simply have no depth_ratio and are omitted here rather
  // than returned with misleading nulls.
  app.get('/api/v1/liquidity', async (req, res) => {
    try {
      if (!_getAlphaList) return res.status(503).json({ error: 'Liquidity data unavailable' });
      const minDepthTotal = parseFloat(req.query.min_depth) || 0;
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
      const markets = await _getAlphaList();
      const withDepth = markets
        .filter(m => m.depth_ratio != null && (m.depth_total || 0) >= minDepthTotal)
        .map(m => ({
          market_id: m.market_id,
          question: m.question,
          slug: m.slug,
          url: m.url,
          volume: m.volume,
          yes_price: m.yes_price,
          depth_ratio: m.depth_ratio,
          depth_side: m.depth_side,
          depth_total: m.depth_total,
          days_until_expiry: m.days_until_expiry
        }))
        .sort((a, b) => (b.depth_total || 0) - (a.depth_total || 0))
        .slice(0, limit);
      res.json({ markets: withDepth, count: withDepth.length, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[api/v1/liquidity]', err.message);
      res.status(500).json({ error: 'Failed to fetch liquidity data', detail: err.message });
    }
  });

  // ── GET /api/v1/liquidity/:marketId/history — depth trend over time ────
  // marketId is the same value returned as market_id by /api/v1/liquidity
  // and /api/v1/edge-scores. Snapshots are written at ~5min resolution (see
  // recordLiquiditySnapshots in server.js) so this shows real depth trend —
  // a squeeze forming, a market drying up before resolution — not just the
  // single live read /api/v1/liquidity gives you.
  app.get('/api/v1/liquidity/:marketId/history', async (req, res) => {
    try {
      if (!_dbQuery) return res.json({ market_id: req.params.marketId, snapshots: [] });
      const hours = Math.min(720, Math.max(1, parseInt(req.query.hours) || 24));
      const rows = await _dbQuery(
        `SELECT slug, question, volume, yes_price, depth_ratio, depth_side, depth_total, snapshot_at
         FROM market_liquidity_snapshots
         WHERE market_id = $1 AND snapshot_at > NOW() - INTERVAL '${hours} hours'
         ORDER BY snapshot_at ASC`,
        [req.params.marketId]
      ).catch(() => []);
      res.json({
        market_id: req.params.marketId,
        slug: rows.length ? rows[rows.length - 1].slug : null,
        question: rows.length ? rows[rows.length - 1].question : null,
        snapshots: rows.map(r => ({
          depth_ratio: r.depth_ratio, depth_side: r.depth_side, depth_total: r.depth_total,
          yes_price: r.yes_price, volume: r.volume, snapshot_at: r.snapshot_at
        })),
        count: rows.length
      });
    } catch (err) {
      console.error('[api/v1/liquidity/:marketId/history]', err.message);
      res.status(500).json({ error: 'Failed to fetch liquidity history', detail: err.message });
    }
  });

  // ── GET /api/v1/edge-scores — proprietary 8-signal edge score per market ─
  app.get('/api/v1/edge-scores', async (req, res) => {
    try {
      if (!_getAlphaList) return res.status(503).json({ error: 'Edge score data unavailable' });
      const minScore = parseFloat(req.query.min_score) || 0;
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const markets = await _getAlphaList();
      const scored = markets
        .filter(m => (m.edge_score || 0) >= minScore)
        .sort((a, b) => (b.edge_score || 0) - (a.edge_score || 0))
        .slice(0, limit)
        .map(m => ({
          market_id: m.market_id,
          question: m.question,
          slug: m.slug,
          url: m.url,
          volume: m.volume,
          yes_price: m.yes_price,
          edge_score: m.edge_score,
          edge_components: m.edge_components,
          model_probability: m.model_probability,
          alpha_edge: m.alpha_edge,
          whale_count: m.whale_count,
          total_whale_capital: m.total_whale_capital,
          depth_ratio: m.depth_ratio,
          depth_side: m.depth_side,
          trade: m.trade,
          days_until_expiry: m.days_until_expiry
        }));
      res.json({ markets: scored, count: scored.length, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[api/v1/edge-scores]', err.message);
      res.status(500).json({ error: 'Failed to fetch edge scores', detail: err.message });
    }
  });

  // ── POST /api/v1/refresh — force cache refresh (admin only) ───────────
  app.post('/api/v1/refresh', async (req, res) => {
    // Simple admin gate — check for admin secret in header
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret && req.headers['x-admin-secret'] !== adminSecret) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    try {
      const result = await dataEngine.refreshAll();
      res.json({
        success: true,
        markets: result.markets.length,
        cross_refs: result.crossRefs.length,
        errors: result.errors,
        elapsed_ms: result.elapsed
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log('[data-api] Mounted /api/v1/ routes');
};
