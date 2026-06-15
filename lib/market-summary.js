'use strict';

// lib/market-summary.js — one-sentence plain-language probability summaries
// for market cards. AI-generated (Haiku) with rule-based fallback.
// Cached in market_summaries DB table with a 4h TTL.

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MODEL = 'claude-haiku-4-5-20251001';

function ruleBasedSummary(market) {
  const price = market.yes_price != null ? Number(market.yes_price) : null;
  const question = market.market_question || market.question || market.title || '';
  if (price === null || !question) return null;
  const pct = Math.round(price * 100);
  const change = market.yes_price_change_7d != null ? Number(market.yes_price_change_7d) : null;
  const changePts = change != null ? Math.round(Math.abs(change * 100)) : null;
  const dir = change != null && change > 0 ? 'up' : 'down';
  let summary = `Markets give ${pct}% chance`;
  if (changePts && changePts >= 2) {
    summary += `, ${dir} ${changePts} points this week`;
  }
  summary += '.';
  return summary;
}

async function generateSummary(market, anthropic) {
  const price = market.yes_price != null ? Number(market.yes_price) : null;
  const question = market.market_question || market.question || market.title || '';
  if (!question || price === null) return ruleBasedSummary(market);
  if (!anthropic) return ruleBasedSummary(market);

  const pct = Math.round(price * 100);
  const change = market.yes_price_change_7d != null ? Number(market.yes_price_change_7d) : null;
  const changePts = change != null ? Math.round(Math.abs(change * 100)) : null;
  const dir = change != null ? (change > 0 ? 'up' : 'down') : null;
  const vol = market.volume_24h_label || '';

  const contextLines = [`Current YES probability: ${pct}%`];
  if (changePts && changePts >= 2 && dir) contextLines.push(`7-day change: ${dir} ${changePts} points`);
  if (vol) contextLines.push(`24h volume: ${vol}`);

  const prompt = `Write one short sentence (max 15 words) summarizing this prediction market in plain language. Be specific about the probability. Dry, numerate style — no exclamation points, no emoji.

Market: "${question}"
${contextLines.join('\n')}

Examples:
- "Markets give 73% chance Fed cuts rates in September, up 12 points this week."
- "Traders put 41% odds on Trump winning the popular vote."
- "42% probability of a Bitcoin ETF approval by year-end."

Reply with ONLY the one sentence, nothing else.`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (msg.content[0] && msg.content[0].text || '').trim();
    if (text && text.length > 10 && text.length < 200) return text;
    return ruleBasedSummary(market);
  } catch (e) {
    console.warn('[market-summary] Haiku error:', e.message);
    return ruleBasedSummary(market);
  }
}

async function getSummary(slug, market, { db, anthropic, maxAgeMs } = {}) {
  if (!slug) return null;

  // Live surfaces (e.g. an in-progress match) can request a shorter freshness
  // window so the line keeps pace with moving odds. Defaults to the standard
  // 4h TTL — callers that don't pass maxAgeMs are unaffected. Regeneration is
  // still TTL-gated (at most one Haiku call per window), never per-pageview.
  const ttl = (typeof maxAgeMs === 'number' && maxAgeMs > 0) ? maxAgeMs : CACHE_TTL_MS;

  if (db) {
    try {
      const res = await db.query(
        `SELECT summary, updated_at FROM market_summaries WHERE slug = $1 LIMIT 1`,
        [slug]
      );
      if (res.rows.length) {
        const row = res.rows[0];
        const age = Date.now() - new Date(row.updated_at).getTime();
        if (age < ttl && row.summary) return row.summary;
      }
    } catch (e) {
      console.warn('[market-summary] DB read error:', e.message);
    }
  }

  const summary = await generateSummary(market, anthropic);
  if (!summary) return null;

  if (db) {
    try {
      await db.query(
        `INSERT INTO market_summaries (slug, summary, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (slug) DO UPDATE SET summary = EXCLUDED.summary, updated_at = NOW()`,
        [slug, summary]
      );
    } catch (e) {
      console.warn('[market-summary] DB write error:', e.message);
    }
  }

  return summary;
}

module.exports = { getSummary, ruleBasedSummary, generateSummary };
