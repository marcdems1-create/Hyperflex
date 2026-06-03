/**
 * HYPERFLEX CLV Engine
 * Closing Line Value — the only metric that separates skill from noise.
 *
 * CLV = closing_price - entry_price (for YES buys)
 *     = entry_price - closing_price (for NO buys)
 *
 * Positive CLV = you got a better price than the market settled at.
 * Consistent positive CLV = genuinely sharp. Not lucky.
 *
 * Wallet classification:
 *   SHARP    — avg CLV > +3¢, sample >= 10
 *   GOOD     — avg CLV > 0¢,  sample >= 5
 *   SQUARE   — avg CLV <= 0¢, sample >= 10
 *   FADE     — avg CLV < -5¢, sample >= 10 (consistently wrong = fade signal)
 *   PENDING  — not enough resolved trades yet
 */

'use strict';

let _pool = null;

function init({ pool }) {
  _pool = pool;
  console.log('[clv-engine] initialized');
}

// ── Compute CLV for all wallets with resolved trades ─────────────────────────
async function computeAll() {
  if (!_pool) return { updated: 0 };
  console.log('[clv-engine] computing CLV for all wallets...');

  const { rows } = await _pool.query(`
    SELECT
      wth.wallet,
      wth.user_id,
      wth.side,
      wth.price                        AS entry_price,
      wth.slug,
      wth.resolved_outcome,
      wth.is_correct,
      wth.resolved_at,
      -- closest snapshot at or after resolution
      ms.yes_price                     AS closing_price
    FROM whale_trade_history wth
    LEFT JOIN LATERAL (
      SELECT yes_price
      FROM market_snapshots
      WHERE market_id = wth.condition_id
         OR question ILIKE wth.question
      ORDER BY ABS(EXTRACT(EPOCH FROM (snapshot_at - wth.resolved_at)))
      LIMIT 1
    ) ms ON true
    WHERE wth.resolved_at IS NOT NULL
      AND wth.price IS NOT NULL
      AND ms.yes_price IS NOT NULL
  `);

  // Group by wallet
  const walletData = new Map();
  for (const row of rows) {
    const key = row.wallet || row.user_id;
    if (!key) continue;

    const entryPrice  = parseFloat(row.entry_price)  || 0;
    const closingPrice = parseFloat(row.closing_price) || 0;
    const side = (row.side || 'YES').toUpperCase();

    // CLV in cents — positive = got better price than close
    let clvCents;
    if (side === 'YES') {
      clvCents = Math.round((closingPrice - entryPrice) * 100);
    } else {
      clvCents = Math.round((entryPrice - closingPrice) * 100);
    }

    if (!walletData.has(key)) {
      walletData.set(key, { wallet: key, user_id: row.user_id, clvs: [] });
    }
    walletData.get(key).clvs.push(clvCents);
  }

  // Upsert wallet_scores
  let updated = 0;
  for (const [key, data] of walletData.entries()) {
    if (!data.clvs.length) continue;
    const avg = data.clvs.reduce((a, b) => a + b, 0) / data.clvs.length;
    const n   = data.clvs.length;
    const cls = classify(avg, n);

    try {
      await _pool.query(`
        INSERT INTO wallet_scores (user_id, clv_avg_cents, clv_sample_size, wallet_class, clv_computed_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          clv_avg_cents    = EXCLUDED.clv_avg_cents,
          clv_sample_size  = EXCLUDED.clv_sample_size,
          wallet_class     = EXCLUDED.wallet_class,
          clv_computed_at  = NOW()
      `, [data.user_id || key, Math.round(avg * 10) / 10, n, cls]);
      updated++;
    } catch (e) {
      console.warn('[clv-engine] upsert error:', e.message);
    }
  }

  console.log(`[clv-engine] computed CLV for ${updated} wallets`);
  return { updated };
}

// ── Classify a wallet based on CLV ───────────────────────────────────────────
function classify(avgClvCents, sampleSize) {
  if (sampleSize < 5)  return 'pending';
  if (avgClvCents > 5 && sampleSize >= 10) return 'sharp';
  if (avgClvCents > 3 && sampleSize >= 10) return 'sharp';
  if (avgClvCents > 0 && sampleSize >= 5)  return 'good';
  if (avgClvCents < -5 && sampleSize >= 10) return 'fade';
  if (avgClvCents <= 0 && sampleSize >= 10) return 'square';
  return 'pending';
}

// ── Get classification for a specific wallet ──────────────────────────────────
async function getWalletClass(userId) {
  if (!_pool) return null;
  try {
    const { rows } = await _pool.query(`
      SELECT wallet_class, clv_avg_cents, clv_sample_size, clv_computed_at
      FROM wallet_scores WHERE user_id = $1
    `, [userId]);
    return rows[0] || null;
  } catch { return null; }
}

// ── Top sharp wallets ─────────────────────────────────────────────────────────
async function getTopSharp(limit = 20) {
  if (!_pool) return [];
  try {
    const { rows } = await _pool.query(`
      SELECT user_id, wallet_class, clv_avg_cents, clv_sample_size,
             sharpness_score, realized_pnl_usd, total_volume_usd
      FROM wallet_scores
      WHERE wallet_class IN ('sharp', 'good')
        AND clv_sample_size >= 5
      ORDER BY clv_avg_cents DESC, clv_sample_size DESC
      LIMIT $1
    `, [limit]);
    return rows;
  } catch { return []; }
}

// ── Top fade wallets (consistently wrong = their trades = contrarian signal) ──
async function getTopFade(limit = 10) {
  if (!_pool) return [];
  try {
    const { rows } = await _pool.query(`
      SELECT user_id, wallet_class, clv_avg_cents, clv_sample_size
      FROM wallet_scores
      WHERE wallet_class = 'fade'
        AND clv_sample_size >= 10
      ORDER BY clv_avg_cents ASC
      LIMIT $1
    `, [limit]);
    return rows;
  } catch { return []; }
}

// ── Distribution summary ──────────────────────────────────────────────────────
async function getSummary() {
  if (!_pool) return {};
  try {
    const { rows } = await _pool.query(`
      SELECT
        wallet_class,
        COUNT(*) as count,
        ROUND(AVG(clv_avg_cents)::numeric, 1) as avg_clv,
        ROUND(AVG(clv_sample_size)::numeric, 1) as avg_trades
      FROM wallet_scores
      WHERE clv_computed_at IS NOT NULL
      GROUP BY wallet_class
      ORDER BY avg_clv DESC
    `);
    return rows;
  } catch { return []; }
}

module.exports = { init, computeAll, classify, getWalletClass, getTopSharp, getTopFade, getSummary };
