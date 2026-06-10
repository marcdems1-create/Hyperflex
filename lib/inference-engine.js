'use strict';

let _pool = null;
let _anthropic = null;
let _lastError = null;
let _lastRaw = null;

function init({ pool, anthropic }) {
  _pool = pool;
  _anthropic = anthropic;
  console.log('[inference-engine] initialized. pool:', !!pool, 'anthropic:', !!anthropic);
}

async function inferCorrelated(trade) {
  _lastError = null;
  _lastRaw = null;
  if (!_pool || !_anthropic) {
    console.warn('[inference-engine] missing pool or anthropic');
    return [];
  }
  try {
    const { rows: openMarkets } = await _pool.query(`
      SELECT DISTINCT ON (market_id) market_id, question, yes_price
      FROM market_snapshots
      WHERE snapshot_at > NOW() - INTERVAL '24 hours'
        AND yes_price > 0.03 AND yes_price < 0.97
      ORDER BY market_id, snapshot_at DESC
      LIMIT 20
    `);

    if (!openMarkets.length) {
      console.warn('[inference-engine] no open markets found');
      return [];
    }

    const marketList = openMarkets
      .map((m, i) => i + '. ' + m.question + ' (currently ' + Math.round(m.yes_price * 100) + '¢)')
      .join('\n');

    const prompt = 'Sharp trader (+' + trade.clv_avg_cents + '¢ CLV) bought ' + (trade.side||'').toUpperCase() + ' on: "' + trade.question + '"\n\nOpen markets:\n' + marketList + '\n\nPick 3 correlated markets. JSON only:\n[{"market_id":"...","question":"...","yes_price":0.0,"correlated_side":"YES","reasoning":"one sentence"}]';

    console.log('[inference-engine] calling Haiku for:', trade.question.slice(0, 60));

    let response;
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Haiku timeout after 25s')), 25000)
      );
      response = await Promise.race([
        _anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: prompt }]
        }),
        timeout
      ]);
    } catch (apiErr) {
      console.error('[inference-engine] Haiku API error:', apiErr.message);
      _lastError = apiErr.message;
      return [];
    }

    const text = (response.content && response.content[0] && response.content[0].text) || '[]';
    _lastRaw = text.slice(0, 500);
    console.log('[inference-engine] raw response:', _lastRaw);

    const clean = text.replace(/```json|```/g, '').trim();
    const firstBracket = clean.indexOf('[');
    const lastBracket = clean.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1) {
      console.warn('[inference-engine] no JSON array found in response');
      return [];
    }
    const jsonStr = clean.slice(firstBracket, lastBracket + 1);
    const correlated = JSON.parse(jsonStr);
    console.log('[inference-engine] parsed', correlated.length, 'correlated markets');
    return Array.isArray(correlated) ? correlated.slice(0, 3) : [];
  } catch (e) {
    console.error('[inference-engine] FAILED:', e.message);
    _lastError = e.message;
    return [];
  }
}

function getState() {
  return { hasPool: !!_pool, hasAnthropic: !!_anthropic, lastError: _lastError, lastRaw: _lastRaw };
}

module.exports = { init, inferCorrelated, getState };
