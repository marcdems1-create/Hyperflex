'use strict';

let _pool = null;

function init({ pool }) {
  _pool = pool;
  console.log('[signal-ledger] initialized');
  _ensureTable();
}

async function _ensureTable() {
  try {
    await _pool.query(`
      CREATE TABLE IF NOT EXISTS signal_history (
        id SERIAL PRIMARY KEY,
        signal_type TEXT NOT NULL,
        market_slug TEXT,
        question TEXT NOT NULL,
        called_side TEXT NOT NULL,
        called_price NUMERIC,
        called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source_wallet TEXT,
        source_clv NUMERIC,
        resolved_outcome TEXT,
        closing_price NUMERIC,
        clv_cents NUMERIC,
        resolved_at TIMESTAMPTZ,
        UNIQUE(signal_type, question, called_side, source_wallet)
      )
    `);
    console.log('[signal-ledger] table ready');
  } catch(e) {
    console.warn('[signal-ledger] table setup:', e.message);
  }
}

async function record(signal) {
  if (!_pool) return;
  try {
    await _pool.query(`
      INSERT INTO signal_history (signal_type, market_slug, question, called_side, called_price, called_at, source_wallet, source_clv)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (signal_type, question, called_side, source_wallet) DO NOTHING
    `, [
      signal.signal_type,
      signal.market_slug || null,
      signal.question,
      signal.called_side,
      signal.called_price || null,
      signal.called_at || new Date(),
      signal.source_wallet || null,
      signal.source_clv || null
    ]);
  } catch(e) {
    console.warn('[signal-ledger] record error:', e.message);
  }
}

async function resolveAll() {
  if (!_pool) return;
  try {
    const { rows } = await _pool.query(`
      SELECT sh.id, sh.question, sh.called_side, sh.called_price
      FROM signal_history sh
      WHERE sh.resolved_at IS NULL
    `);
    for (const row of rows) {
      const { rows: snap } = await _pool.query(`
        SELECT yes_price, snapshot_at FROM market_snapshots
        WHERE question ILIKE $1
          AND (yes_price >= 0.95 OR yes_price <= 0.05)
        ORDER BY snapshot_at DESC LIMIT 1
      `, [row.question]);
      if (!snap.length) continue;
      const closing = snap[0].yes_price;
      const side = (row.called_side||'').toUpperCase();
      const clvCents = side === 'YES'
        ? Math.round((closing - (row.called_price||0)) * 100)
        : Math.round(((row.called_price||0) - closing) * 100);
      const outcome = closing >= 0.95 ? 'YES' : 'NO';
      await _pool.query(`
        UPDATE signal_history
        SET resolved_outcome=$1, closing_price=$2, clv_cents=$3, resolved_at=$4
        WHERE id=$5
      `, [outcome, closing, clvCents, snap[0].snapshot_at, row.id]);
    }
    console.log('[signal-ledger] resolved', rows.length, 'pending signals');
  } catch(e) {
    console.warn('[signal-ledger] resolveAll error:', e.message);
  }
}

async function getSummary() {
  if (!_pool) return {};
  try {
    const { rows } = await _pool.query(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(resolved_at) as resolved,
        COUNT(CASE WHEN clv_cents > 0 THEN 1 END) as profitable,
        ROUND(AVG(CASE WHEN clv_cents IS NOT NULL THEN clv_cents END)::numeric,1) as avg_clv,
        ROUND(AVG(CASE WHEN clv_cents IS NOT NULL AND called_price IS NOT NULL THEN called_price END)::numeric,3) as avg_entry
      FROM signal_history
    `);
    return rows[0];
  } catch(e) { return {}; }
}

async function getRecent(limit) {
  if (!_pool) return [];
  try {
    const { rows } = await _pool.query(`
      SELECT signal_type, question, called_side, called_price, called_at,
             source_wallet, source_clv, resolved_outcome, clv_cents, resolved_at
      FROM signal_history
      ORDER BY called_at DESC
      LIMIT $1
    `, [limit||50]);
    return rows;
  } catch(e) { return []; }
}

module.exports = { init, record, resolveAll, getSummary, getRecent };
