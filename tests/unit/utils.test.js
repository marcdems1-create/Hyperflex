'use strict';

const {
  rateLimit,
  _resetRateLimits,
  getStreakMultiplier,
  getWeekStart,
  timeAgoStr,
  escHtmlStr,
  extractKeywords,
  classifyNarrative,
  detectSentiment,
  polyRef,
  REWARD_POINTS,
  REDEMPTION_TIERS,
  calcSyncRewardPoints,
  canRedeemTier,
} = require('../../lib/utils');

// ── rateLimit ─────────────────────────────────────────────
describe('rateLimit', () => {
  beforeEach(() => _resetRateLimits());

  test('allows requests within the limit', () => {
    expect(rateLimit('login', 'user1', 3, 60000)).toBe(true);
    expect(rateLimit('login', 'user1', 3, 60000)).toBe(true);
    expect(rateLimit('login', 'user1', 3, 60000)).toBe(true);
  });

  test('blocks requests exceeding the limit', () => {
    rateLimit('login', 'user1', 2, 60000);
    rateLimit('login', 'user1', 2, 60000);
    expect(rateLimit('login', 'user1', 2, 60000)).toBe(false);
  });

  test('separate keys do not interfere', () => {
    rateLimit('login', 'user1', 1, 60000);
    expect(rateLimit('login', 'user2', 1, 60000)).toBe(true);
  });

  test('resets after window expires', () => {
    const realNow = Date.now;
    let now = 1000000;
    Date.now = () => now;

    rateLimit('login', 'user1', 1, 1000);
    expect(rateLimit('login', 'user1', 1, 1000)).toBe(false);

    now += 1001; // past window
    expect(rateLimit('login', 'user1', 1, 1000)).toBe(true);

    Date.now = realNow;
  });
});

// ── getStreakMultiplier ───────────────────────────────────
describe('getStreakMultiplier', () => {
  test('returns 1.0 for streak 0', () => {
    expect(getStreakMultiplier(0)).toBe(1.0);
  });

  test('returns 1.0 for streak 2', () => {
    expect(getStreakMultiplier(2)).toBe(1.0);
  });

  test('returns 1.5 for streak 3', () => {
    expect(getStreakMultiplier(3)).toBe(1.5);
  });

  test('returns 1.5 for streak 4', () => {
    expect(getStreakMultiplier(4)).toBe(1.5);
  });

  test('returns 2.0 for streak 5', () => {
    expect(getStreakMultiplier(5)).toBe(2.0);
  });

  test('returns 2.0 for streak 10', () => {
    expect(getStreakMultiplier(10)).toBe(2.0);
  });
});

// ── getWeekStart ──────────────────────────────────────────
describe('getWeekStart', () => {
  test('returns Monday for a Wednesday input', () => {
    // 2026-03-25 is a Wednesday
    const result = getWeekStart(new Date('2026-03-25T14:30:00Z'));
    expect(result.toISOString()).toBe('2026-03-23T00:00:00.000Z'); // Monday
  });

  test('returns same Monday for a Monday input', () => {
    const result = getWeekStart(new Date('2026-03-23T10:00:00Z'));
    expect(result.toISOString()).toBe('2026-03-23T00:00:00.000Z');
  });

  test('rolls back to previous Monday for Sunday', () => {
    // 2026-03-29 is a Sunday
    const result = getWeekStart(new Date('2026-03-29T23:59:59Z'));
    expect(result.toISOString()).toBe('2026-03-23T00:00:00.000Z');
  });

  test('handles Saturday correctly', () => {
    // 2026-03-28 is a Saturday
    const result = getWeekStart(new Date('2026-03-28T12:00:00Z'));
    expect(result.toISOString()).toBe('2026-03-23T00:00:00.000Z');
  });

  test('defaults to current date when no arg given', () => {
    const result = getWeekStart();
    expect(result.getUTCDay()).toBe(1); // always a Monday
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
  });
});

// ── timeAgoStr ────────────────────────────────────────────
describe('timeAgoStr', () => {
  test('returns <1m ago for recent timestamps', () => {
    const now = new Date().toISOString();
    expect(timeAgoStr(now)).toBe('<1m ago');
  });

  test('returns minutes for timestamps within the hour', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgoStr(fiveMinAgo)).toBe('5m ago');
  });

  test('returns hours for timestamps within the day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect(timeAgoStr(threeHoursAgo)).toBe('3h ago');
  });

  test('returns days for older timestamps', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
    expect(timeAgoStr(twoDaysAgo)).toBe('2d ago');
  });
});

// ── escHtmlStr ────────────────────────────────────────────
describe('escHtmlStr', () => {
  test('escapes & < > "', () => {
    expect(escHtmlStr('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  test('handles null/undefined gracefully', () => {
    expect(escHtmlStr(null)).toBe('');
    expect(escHtmlStr(undefined)).toBe('');
  });

  test('passes through safe strings unchanged', () => {
    expect(escHtmlStr('hello world')).toBe('hello world');
  });

  test('prevents XSS script injection', () => {
    const result = escHtmlStr('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });
});

// ── extractKeywords ───────────────────────────────────────
describe('extractKeywords', () => {
  test('extracts meaningful words and skips stop words', () => {
    const result = extractKeywords('Will Bitcoin hit $100k by the end of 2026?');
    expect(result).toContain('Bitcoin');
    expect(result).not.toContain('Will');
    expect(result).not.toContain('the');
  });

  test('returns max 4 words joined by space', () => {
    const result = extractKeywords('Apple Microsoft Google Tesla Nvidia Amazon');
    const words = result.split(' ');
    expect(words.length).toBeLessThanOrEqual(4);
  });

  test('handles empty/null input', () => {
    expect(extractKeywords('')).toBe('');
    expect(extractKeywords(null)).toBe('');
  });

  test('strips punctuation', () => {
    const result = extractKeywords('Trump vs. Biden: who wins?');
    expect(result).not.toContain('?');
    expect(result).not.toContain(':');
  });
});

// ── classifyNarrative ─────────────────────────────────────
describe('classifyNarrative', () => {
  test('classifies crypto questions', () => {
    expect(classifyNarrative('Will Bitcoin hit $100k?')).toBe('Crypto & DeFi');
    expect(classifyNarrative('Ethereum ETF approval date')).toBe('Crypto & DeFi');
  });

  test('classifies politics questions', () => {
    expect(classifyNarrative('Will Trump win the Republican primary?')).toBe('Trump & US Politics');
  });

  test('classifies NBA questions', () => {
    expect(classifyNarrative('Will the Lakers make the NBA playoffs?')).toBe('NBA & Basketball');
  });

  test('classifies AI questions', () => {
    expect(classifyNarrative('Will OpenAI release GPT-5?')).toBe('AI & Big Tech');
  });

  test('returns Other for unclassifiable questions', () => {
    expect(classifyNarrative('Will it rain tomorrow in my backyard?')).toBe('Other');
  });

  test('handles empty input', () => {
    expect(classifyNarrative('')).toBe('Other');
    expect(classifyNarrative(null)).toBe('Other');
  });

  test('is case-insensitive', () => {
    expect(classifyNarrative('BITCOIN PRICE PREDICTION')).toBe('Crypto & DeFi');
  });
});

// ── detectSentiment ───────────────────────────────────────
describe('detectSentiment', () => {
  test('detects bullish sentiment', () => {
    expect(detectSentiment('Bitcoin surges to new record high, rally continues')).toBe('bullish');
  });

  test('detects bearish sentiment', () => {
    expect(detectSentiment('Markets crash as crisis deepens, stocks plunge and decline')).toBe('bearish');
  });

  test('returns neutral when balanced', () => {
    expect(detectSentiment('The weather is nice today')).toBe('neutral');
  });

  test('returns neutral for empty input', () => {
    expect(detectSentiment('')).toBe('neutral');
    expect(detectSentiment(null)).toBe('neutral');
  });

  test('is case-insensitive', () => {
    expect(detectSentiment('SURGE RALLY BOOST')).toBe('bullish');
  });
});

// ── polyRef ───────────────────────────────────────────────
describe('polyRef', () => {
  const REF = 'hyperflex';

  test('appends ?via= to polymarket.com URLs', () => {
    expect(polyRef('https://polymarket.com', REF)).toBe('https://polymarket.com?via=hyperflex');
  });

  test('appends ?via= to event URLs', () => {
    expect(polyRef('https://polymarket.com/event/btc-100k', REF))
      .toBe('https://polymarket.com/event/btc-100k?via=hyperflex');
  });

  test('uses &via= when URL already has query params', () => {
    expect(polyRef('https://polymarket.com/event/btc?tab=chart', REF))
      .toBe('https://polymarket.com/event/btc?tab=chart&via=hyperflex');
  });

  test('does not double-tag URLs that already have via=', () => {
    const tagged = 'https://polymarket.com/event/btc?via=someone';
    expect(polyRef(tagged, REF)).toBe(tagged);
  });

  test('skips data-api.polymarket.com', () => {
    const api = 'https://data-api.polymarket.com/v1/leaderboard';
    expect(polyRef(api, REF)).toBe(api);
  });

  test('skips clob.polymarket.com', () => {
    const clob = 'https://clob.polymarket.com/auth/derive-api-key';
    expect(polyRef(clob, REF)).toBe(clob);
  });

  test('skips gamma-api.polymarket.com', () => {
    const gamma = 'https://gamma-api.polymarket.com/events';
    expect(polyRef(gamma, REF)).toBe(gamma);
  });

  test('skips docs.polymarket.com', () => {
    const docs = 'https://docs.polymarket.com/trading/fees';
    expect(polyRef(docs, REF)).toBe(docs);
  });

  test('skips non-polymarket URLs', () => {
    expect(polyRef('https://kalshi.com/market/xyz', REF)).toBe('https://kalshi.com/market/xyz');
    expect(polyRef('https://manifold.markets/q', REF)).toBe('https://manifold.markets/q');
  });

  test('returns empty string for null/undefined/empty input', () => {
    expect(polyRef(null, REF)).toBe('');
    expect(polyRef(undefined, REF)).toBe('');
    expect(polyRef('', REF)).toBe('');
  });

  test('returns URL unchanged when no ref code', () => {
    expect(polyRef('https://polymarket.com/event/btc', '')).toBe('https://polymarket.com/event/btc');
    expect(polyRef('https://polymarket.com/event/btc', null)).toBe('https://polymarket.com/event/btc');
  });

  test('tags profile URLs', () => {
    expect(polyRef('https://polymarket.com/profile/0xabc', REF))
      .toBe('https://polymarket.com/profile/0xabc?via=hyperflex');
  });
});

// ── calcSyncRewardPoints ──────────────────────────────────
describe('calcSyncRewardPoints', () => {
  test('calculates points for mixed platform positions', () => {
    const positions = [
      { platform: 'polymarket', external_id: '1' },
      { platform: 'polymarket', external_id: '2' },
      { platform: 'kalshi', external_id: '3' },
      { platform: 'manifold', external_id: '4' },
    ];
    const result = calcSyncRewardPoints(positions);
    expect(result.total).toBe(25 * 2 + 50 * 1 + 15 * 1); // 115
    expect(result.breakdown.polymarket).toBe(2);
    expect(result.breakdown.kalshi).toBe(1);
    expect(result.breakdown.manifold).toBe(1);
  });

  test('returns 0 for empty input', () => {
    expect(calcSyncRewardPoints([]).total).toBe(0);
    expect(calcSyncRewardPoints(null).total).toBe(0);
  });

  test('handles polymarket-only positions', () => {
    const positions = [
      { platform: 'polymarket' },
      { platform: 'polymarket' },
      { platform: 'polymarket' },
    ];
    expect(calcSyncRewardPoints(positions).total).toBe(75);
  });

  test('kalshi earns highest per position', () => {
    expect(REWARD_POINTS.sync_kalshi).toBeGreaterThan(REWARD_POINTS.sync_polymarket);
    expect(REWARD_POINTS.sync_kalshi).toBeGreaterThan(REWARD_POINTS.sync_manifold);
  });

  test('ignores unknown platforms', () => {
    const positions = [{ platform: 'unknown_exchange' }];
    expect(calcSyncRewardPoints(positions).total).toBe(0);
  });
});

// ── canRedeemTier ─────────────────────────────────────────
describe('canRedeemTier', () => {
  test('returns true when balance meets tier', () => {
    expect(canRedeemTier(3000, 0)).toBe(true);
    expect(canRedeemTier(5000, 0)).toBe(true);
  });

  test('returns false when balance is insufficient', () => {
    expect(canRedeemTier(2999, 0)).toBe(false);
    expect(canRedeemTier(0, 0)).toBe(false);
  });

  test('returns false for invalid tier index', () => {
    expect(canRedeemTier(100000, 99)).toBe(false);
    expect(canRedeemTier(100000, -1)).toBe(false);
  });

  test('tier 0 is cheapest, tier 3 is most expensive', () => {
    expect(REDEMPTION_TIERS[0].points).toBeLessThan(REDEMPTION_TIERS[3].points);
    expect(REDEMPTION_TIERS[0].credit_cents).toBeLessThan(REDEMPTION_TIERS[3].credit_cents);
  });

  test('all tiers have required fields', () => {
    REDEMPTION_TIERS.forEach(tier => {
      expect(tier).toHaveProperty('points');
      expect(tier).toHaveProperty('credit_cents');
      expect(tier).toHaveProperty('label');
      expect(tier.points).toBeGreaterThan(0);
      expect(tier.credit_cents).toBeGreaterThan(0);
    });
  });
});
