/**
 * HYPERFLEX DATA API — /api/v1/ routes
 *
 * Clean, documented endpoints for normalized market data.
 * These are the foundation of the external API business (Pillar 1).
 *
 * Usage: require('./lib/data-api-routes')(app, dataEngine);
 */

'use strict';

module.exports = function mountDataAPI(app, dataEngine) {

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
      // hfxId format: "polymarket:slug" or "kalshi:ticker" or "sportsbook:id"
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
          id: 'kalshi',
          name: 'Kalshi',
          type: 'prediction_market',
          status: 'live',
          markets_tracked: 'All active events',
          update_frequency: '90 seconds',
          data_available: ['prices', 'volume', 'open_interest']
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
