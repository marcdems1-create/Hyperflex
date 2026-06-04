'use strict';

let _pool = null;
let _anthropic = null;

function init({ pool, anthropic }) {
  _pool = pool;
  _anthropic = anthropic;
  console.log('[inference-engine] initialized');
}

// Given a sharp trade, find correlated open markets
async function inferCorrelated(trade) {
  if (!_pool || !_anthropic) return [];
  try {
    // Get 80 recent open markets from market_snapshots to give Claude context
    const { rows: openMarkets } = await _pool.query(`
      SELECT DISTINCT ON (market_id) market_id, question, yes_price
      FROM market_snapshots
      WHERE snapshot_at > NOW() - INTERVAL '24 hours'
        AND yes_price > 0.03 AND yes_price < 0.97
      ORDER BY market_id, snapshot_at DESC
      LIMIT 80
    `);

    if (!openMarkets.length) return [];

    const marketList = openMarkets
      .map((m, i) => i + '. ' + m.question + ' (currently ' + Math.round(m.yes_price * 100) + '¢)')
      .join('\n');

    const prompt = `A sharp trader (proven +${trade.clv_avg_cents}¢ CLV edge) just bought ${(trade.side||'').toUpperCase()} on this market at ${Math.round((trade.price||0)*100)}¢:

"${trade.question}"

Here are 80 currently open Polymarket markets:
${marketList}

Identify exactly 3 markets from the list above that would be MOST affected by the same underlying thesis. For each, explain in one sentence WHY it's correlated and which direction the edge points (YES or NO).

Respond ONLY with valid JSON array, no markdown:
[
  {"market_id": "...", "question": "...", "yes_price": 0.XX, "correlated_side": "YES|NO", "reasoning": "one sentence"},
  ...
]`;

    const response = await _anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0]?.text || '[]';
    const clean = text.replace(/```json|```/g, '').trim();
    const correlated = JSON.parse(clean);

    return Array.isArray(correlated) ? correlated.slice(0, 3) : [];
  } catch (e) {
    console.warn('[inference-engine] error:', e.message);
    return [];
  }
}

module.exports = { init, inferCorrelated };
