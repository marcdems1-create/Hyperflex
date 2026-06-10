'use strict';

let _pool = null;

function init({ pool }) {
  _pool = pool;
  console.log('[bias-caller] initialized');
  // Run on boot and every 6 hours
  _runCalls().catch(() => {});
  setInterval(() => _runCalls().catch(() => {}), 6 * 60 * 60 * 1000);
}

// Historical YES rates by price bucket (from our data)
const BIAS_TABLE = {
  '0-5':   { yes_rate: 0.011, label: '1.1%', strength: 'EXTREME' },
  '5-10':  { yes_rate: 0.025, label: '2.5%', strength: 'EXTREME' },
  '10-15': { yes_rate: 0.04,  label: '4%',   strength: 'STRONG' },
  '15-20': { yes_rate: 0.06,  label: '6%',   strength: 'STRONG' },
  '20-25': { yes_rate: 0.10,  label: '10%',  strength: 'MODERATE' },
  '25-30': { yes_rate: 0.15,  label: '15%',  strength: 'MODERATE' },
};

function getBucket(price) {
  const p = price * 100;
  if (p < 5)  return '0-5';
  if (p < 10) return '5-10';
  if (p < 15) return '10-15';
  if (p < 20) return '15-20';
  if (p < 25) return '20-25';
  if (p < 30) return '25-30';
  return null;
}

function getEdgeMultiple(marketPrice, historicalRate) {
  return Math.round((marketPrice / historicalRate) * 10) / 10;
}

async function _runCalls() {
  if (!_pool) return;
  try {
    // Get currently open markets in bias zone (under 30c YES)
    const { rows } = await _pool.query(`
      SELECT DISTINCT ON (market_id)
        market_id, question, yes_price
      FROM market_snapshots
      WHERE snapshot_at > NOW() - INTERVAL '2 hours'
        AND yes_price BETWEEN 0.03 AND 0.30
      ORDER BY market_id, snapshot_at DESC
      LIMIT 100
    `);

    for (const row of rows) {
      const bucket = getBucket(row.yes_price);
      if (!bucket) continue;
      const bias = BIAS_TABLE[bucket];
      const multiple = getEdgeMultiple(row.yes_price, bias.yes_rate);
      if (multiple < 1.5) continue; // only surface meaningful edge

      // Record to signal_history
      try {
        await _pool.query(`
          INSERT INTO signal_history
            (signal_type, market_slug, question, called_side, called_price, source_clv, source_wallet, called_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (signal_type, question, called_side, source_wallet) DO NOTHING
        `, [
          'bias_edge',
          row.market_id,
          row.question,
          'NO',
          row.yes_price,
          multiple,  // store edge multiple in source_clv field
          'bias_engine'
        ]);
      } catch(e) { /* conflict = already recorded */ }
    }
    console.log('[bias-caller] processed', rows.length, 'markets');
  } catch(e) {
    console.warn('[bias-caller] error:', e.message);
  }
}

// Get current bias edge calls with explanation
async function getBiasCalls() {
  if (!_pool) return [];
  try {
    const { rows } = await _pool.query(`
      SELECT DISTINCT ON (ms.market_id)
        ms.market_id,
        ms.question,
        ms.yes_price,
        sh.called_at,
        sh.resolved_outcome,
        sh.clv_cents,
        sh.resolved_at,
        sh.source_clv as edge_multiple
      FROM market_snapshots ms
      JOIN signal_history sh ON sh.market_slug = ms.market_id
        AND sh.signal_type = 'bias_edge'
      WHERE ms.snapshot_at > NOW() - INTERVAL '24 hours'
        AND ms.yes_price BETWEEN 0.03 AND 0.30
      ORDER BY ms.market_id, ms.snapshot_at DESC
      LIMIT 20
    `);

    return rows.map(r => {
      const bucket = getBucket(r.yes_price);
      const bias = BIAS_TABLE[bucket] || { yes_rate: 0.10, label: '10%', strength: 'MODERATE' };
      const multiple = r.edge_multiple || getEdgeMultiple(r.yes_price, bias.yes_rate);
      return {
        question: r.question,
        market_id: r.market_id,
        yes_price: r.yes_price,
        yes_cents: Math.round(r.yes_price * 100),
        called_side: 'NO',
        called_at: r.called_at,
        historical_yes_rate: bias.yes_rate,
        historical_yes_pct: bias.label,
        edge_multiple: multiple,
        strength: bias.strength,
        resolved_outcome: r.resolved_outcome,
        clv_cents: r.clv_cents,
        resolved_at: r.resolved_at,
        explanation: 'Market priced at ' + Math.round(r.yes_price * 100) + '¢ YES. Historically, markets at this price resolve YES only ' + bias.label + ' of the time — ' + multiple + 'x overpriced. Edge: BUY NO.'
      };
    });
  } catch(e) { return []; }
}

// Track record for bias calls specifically
async function getBiasTrackRecord() {
  if (!_pool) return {};
  try {
    const { rows } = await _pool.query(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(resolved_at) as resolved,
        COUNT(CASE WHEN resolved_outcome = 'NO' THEN 1 END) as correct,
        ROUND(AVG(CASE WHEN clv_cents IS NOT NULL THEN clv_cents END)::numeric, 1) as avg_clv
      FROM signal_history
      WHERE signal_type = 'bias_edge'
    `);
    const r = rows[0];
    const resolved = parseInt(r.resolved) || 0;
    const correct = parseInt(r.correct) || 0;
    return {
      total_calls: parseInt(r.total_calls) || 0,
      resolved,
      correct,
      win_rate: resolved > 0 ? Math.round(correct / resolved * 100) : null,
      avg_clv: r.avg_clv
    };
  } catch(e) { return {}; }
}

module.exports = { init, getBiasCalls, getBiasTrackRecord };
