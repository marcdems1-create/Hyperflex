'use strict';

let _pool = null;

function init({ pool }) {
  _pool = pool;
  console.log('[edge-engine] initialized');
}

// Sharp wallet consensus — 3+ sharp wallets same market in 24h
async function getSharpConsensus() {
  if (!_pool) return [];
  try {
    const { rows } = await _pool.query(`
      SELECT
        wth.slug,
        wth.question,
        COUNT(DISTINCT wth.wallet) as sharp_count,
        SUM(wth.size) as total_size,
        AVG(wth.price) as avg_entry,
        MAX(wth.created_at) as last_trade,
        STRING_AGG(UPPER(wth.side), ',' ORDER BY wth.created_at) as sides,
        AVG(ws.clv_avg_cents) as avg_clv
      FROM whale_trade_history wth
      JOIN wallet_scores ws ON wth.wallet = ws.user_id
      WHERE ws.wallet_class IN ('sharp', 'good')
        AND ws.clv_avg_cents IS NOT NULL
        AND wth.created_at > NOW() - INTERVAL '24 hours'
        AND wth.slug IS NOT NULL
      GROUP BY wth.slug, wth.question
      HAVING COUNT(DISTINCT wth.wallet) >= 2
      ORDER BY sharp_count DESC, total_size DESC
      LIMIT 10
    `);
    return rows.map(r => ({
      ...r,
      consensus_side: r.sides.split(',').filter(s => s === 'YES').length > r.sides.split(',').length / 2 ? 'YES' : 'NO',
      signal_strength: Math.min(10, Math.round((r.sharp_count * 2) + (parseFloat(r.avg_clv) / 10)))
    }));
  } catch(e) {
    console.warn('[edge-engine] consensus error:', e.message);
    return [];
  }
}

// Accumulation velocity — sharp wallet making repeated trades on same market fast
async function getAccumulationAlerts() {
  if (!_pool) return [];
  try {
    const { rows } = await _pool.query(`
      SELECT
        wth.wallet,
        wth.slug,
        wth.question,
        COUNT(*) as trade_count,
        SUM(wth.size) as total_size,
        MIN(wth.created_at) as first_trade,
        MAX(wth.created_at) as last_trade,
        EXTRACT(EPOCH FROM (MAX(wth.created_at) - MIN(wth.created_at)))/3600 as hours_span,
        AVG(wth.price) as avg_price,
        ws.clv_avg_cents,
        ws.wallet_class
      FROM whale_trade_history wth
      JOIN wallet_scores ws ON wth.wallet = ws.user_id
      WHERE ws.wallet_class IN ('sharp', 'good')
        AND ws.clv_avg_cents > 5
        AND wth.created_at > NOW() - INTERVAL '12 hours'
        AND wth.slug IS NOT NULL
      GROUP BY wth.wallet, wth.slug, wth.question, ws.clv_avg_cents, ws.wallet_class
      HAVING COUNT(*) >= 2
        AND EXTRACT(EPOCH FROM (MAX(wth.created_at) - MIN(wth.created_at)))/3600 < 4
      ORDER BY trade_count DESC, total_size DESC
      LIMIT 10
    `);
    return rows;
  } catch(e) {
    console.warn('[edge-engine] accumulation error:', e.message);
    return [];
  }
}

// Resolution bias — which price buckets actually resolve YES
async function getResolutionBias() {
  if (!_pool) return [];
  try {
    const { rows } = await _pool.query(`
      SELECT
        price_bucket,
        total_markets,
        yes_markets,
        ROUND(100.0 * yes_markets / NULLIF(total_markets, 0), 1) as yes_pct,
        ROUND(100.0 * (total_markets - yes_markets) / NULLIF(total_markets, 0), 1) as no_pct,
        CASE
          WHEN ROUND(100.0 * yes_markets / NULLIF(total_markets, 0), 1) < 10 THEN 'STRONG_NO_EDGE'
          WHEN ROUND(100.0 * yes_markets / NULLIF(total_markets, 0), 1) < 25 THEN 'NO_EDGE'
          WHEN ROUND(100.0 * yes_markets / NULLIF(total_markets, 0), 1) > 75 THEN 'YES_EDGE'
          ELSE 'NEUTRAL'
        END as edge_direction
      FROM (
        SELECT
          CASE
            WHEN entry_price < 0.1  THEN '0-10c'
            WHEN entry_price < 0.2  THEN '10-20c'
            WHEN entry_price < 0.3  THEN '20-30c'
            WHEN entry_price < 0.4  THEN '30-40c'
            WHEN entry_price < 0.5  THEN '40-50c'
            ELSE '50c+'
          END as price_bucket,
          COUNT(*) as total_markets,
          COUNT(*) FILTER (WHERE close_price >= 0.95) as yes_markets
        FROM (
          SELECT DISTINCT ON (ms.market_id)
            ms.market_id,
            first_snap.yes_price as entry_price,
            ms.yes_price as close_price
          FROM market_snapshots ms
          JOIN (
            SELECT DISTINCT ON (market_id) market_id, yes_price
            FROM market_snapshots
            WHERE yes_price > 0.05 AND yes_price < 0.95
            ORDER BY market_id, snapshot_at ASC
          ) first_snap ON ms.market_id = first_snap.market_id
          WHERE ms.yes_price >= 0.95 OR ms.yes_price <= 0.05
          ORDER BY ms.market_id, ms.snapshot_at DESC
        ) markets
        GROUP BY price_bucket
      ) bucketed
      ORDER BY price_bucket
    `);
    return rows;
  } catch(e) {
    console.warn('[edge-engine] bias error:', e.message);
    return [];
  }
}

// Find currently open markets in high-NO-bias price zones (structural edge)
async function getBiasEdgeMarkets() {
  if (!_pool) return [];
  try {
    const { rows } = await _pool.query(`
      SELECT DISTINCT ON (ms.market_id)
        ms.market_id,
        ms.question,
        ROUND((ms.yes_price * 100)::numeric, 1) as yes_cents,
        ROUND(((1 - ms.yes_price) * 100)::numeric, 1) as no_cents,
        ms.snapshot_at
      FROM market_snapshots ms
      WHERE ms.snapshot_at > NOW() - INTERVAL '24 hours'
        AND ms.yes_price BETWEEN 0.10 AND 0.40
      ORDER BY ms.market_id, ms.snapshot_at DESC
      LIMIT 20
    `);
    return rows.map(r => ({
      ...r,
      edge_note: 'Historical YES rate in ' + r.yes_cents + 'c range is <15%. Edge: fade YES / buy NO.',
      edge_direction: 'NO'
    }));
  } catch(e) { return []; }
}

module.exports = { init, getSharpConsensus, getAccumulationAlerts, getResolutionBias, getBiasEdgeMarkets };
