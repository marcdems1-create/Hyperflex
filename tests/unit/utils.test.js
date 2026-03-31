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
