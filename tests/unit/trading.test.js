'use strict';

const {
  diffWhalePositions,
  filterScreenerResults,
  computeWhaleAlphaScores,
  computeMarketAlphaScore,
  _gradeMultiplier,
} = require('../../lib/trading');

// ── diffWhalePositions ────────────────────────────────────
describe('diffWhalePositions', () => {
  test('detects newly opened positions (size >= 1000)', () => {
    const oldPos = [];
    const newPos = [{ market: 'Will BTC hit 100k?', size: '5000' }];
    const changes = diffWhalePositions(oldPos, newPos, 'whale1');
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('opened');
    expect(changes[0].trader).toBe('whale1');
  });

  test('ignores small new positions (size < 1000)', () => {
    const changes = diffWhalePositions([], [{ market: 'Small bet', size: '500' }], 'whale1');
    expect(changes).toHaveLength(0);
  });

  test('detects closed positions', () => {
    const oldPos = [{ market: 'Will ETH hit 5k?', size: '2000' }];
    const newPos = [];
    const changes = diffWhalePositions(oldPos, newPos, 'whale2');
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('closed');
  });

  test('detects size increases > 20%', () => {
    const oldPos = [{ market: 'BTC market', size: '10000' }];
    const newPos = [{ market: 'BTC market', size: '13000' }];
    const changes = diffWhalePositions(oldPos, newPos, 'whale3');
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('increased');
    expect(changes[0].oldSize).toBe(10000);
    expect(changes[0].newSize).toBe(13000);
  });

  test('detects size decreases > 20%', () => {
    const oldPos = [{ market: 'BTC market', size: '10000' }];
    const newPos = [{ market: 'BTC market', size: '7000' }];
    const changes = diffWhalePositions(oldPos, newPos, 'whale4');
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('decreased');
  });

  test('ignores size changes <= 20%', () => {
    const oldPos = [{ market: 'BTC market', size: '10000' }];
    const newPos = [{ market: 'BTC market', size: '11500' }];
    const changes = diffWhalePositions(oldPos, newPos, 'whale5');
    expect(changes).toHaveLength(0);
  });

  test('handles null/undefined inputs gracefully', () => {
    expect(diffWhalePositions(null, null, 'whale')).toEqual([]);
    expect(diffWhalePositions(undefined, [], 'whale')).toEqual([]);
  });

  test('uses title field as fallback key', () => {
    const oldPos = [{ title: 'My Market', size: '5000' }];
    const newPos = [];
    const changes = diffWhalePositions(oldPos, newPos, 'whale6');
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('closed');
  });
});

// ── filterScreenerResults ─────────────────────────────────
describe('filterScreenerResults', () => {
  const markets = [
    { question: 'BTC 100k', whale_count: 5, category: 'crypto', volume: 50000, edge_score: 8, price_change_24h: 10, days_until_expiry: 30 },
    { question: 'Trump wins', whale_count: 3, category: 'politics', volume: 30000, edge_score: 6, price_change_24h: -5, days_until_expiry: 60 },
    { question: 'Lakers NBA', whale_count: 1, category: 'sports', volume: 10000, edge_score: 4, price_change_24h: 2, days_until_expiry: 10 },
    { question: 'ETH merge', whale_count: 4, category: 'crypto', volume: 40000, edge_score: 7, price_change_24h: -15, days_until_expiry: 45 },
  ];

  test('filters by min_whales', () => {
    const result = filterScreenerResults(markets, { min_whales: '4' });
    expect(result).toHaveLength(2);
    expect(result.every(m => m.whale_count >= 4)).toBe(true);
  });

  test('filters by category', () => {
    const result = filterScreenerResults(markets, { category: 'crypto' });
    expect(result).toHaveLength(2);
    expect(result.every(m => m.category === 'crypto')).toBe(true);
  });

  test('filters by min_volume', () => {
    const result = filterScreenerResults(markets, { min_volume: '35000' });
    expect(result).toHaveLength(2);
  });

  test('combines multiple filters', () => {
    const result = filterScreenerResults(markets, { category: 'crypto', min_whales: '5' });
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe('BTC 100k');
  });

  test('sorts by volume', () => {
    const result = filterScreenerResults(markets, { sort: 'volume' });
    expect(result[0].volume).toBe(50000);
    expect(result[result.length - 1].volume).toBe(10000);
  });

  test('sorts by edge_score (default)', () => {
    const result = filterScreenerResults(markets, {});
    expect(result[0].edge_score).toBe(8);
  });

  test('sorts by price_change (absolute value)', () => {
    const result = filterScreenerResults(markets, { sort: 'price_change' });
    expect(Math.abs(result[0].price_change_24h)).toBeGreaterThanOrEqual(Math.abs(result[1].price_change_24h));
  });

  test('sorts by whale_count', () => {
    const result = filterScreenerResults(markets, { sort: 'whale_count' });
    expect(result[0].whale_count).toBe(5);
  });

  test('does not mutate original array', () => {
    const copy = [...markets];
    filterScreenerResults(markets, { sort: 'volume' });
    expect(markets).toEqual(copy);
  });

  test('category "all" returns everything', () => {
    const result = filterScreenerResults(markets, { category: 'all' });
    expect(result).toHaveLength(4);
  });
});

// ── computeWhaleAlphaScores ───────────────────────────────
describe('computeWhaleAlphaScores', () => {
  test('returns empty Map for null input', () => {
    expect(computeWhaleAlphaScores(null)).toEqual(new Map());
    expect(computeWhaleAlphaScores({ whales: null })).toEqual(new Map());
  });

  test('computes scores for whale data', () => {
    const whaleData = {
      whales: [
        { proxyWallet: '0xAAA', trader: 'Whale1', trader_rank: 1, trader_pnl: 500000, market: 'Will Bitcoin hit 100k?', side: 'YES', size: 10000, current_price: 0.75 },
        { proxyWallet: '0xAAA', trader: 'Whale1', trader_rank: 1, trader_pnl: 500000, market: 'Will Trump win?', side: 'YES', size: 12000, current_price: 0.6 },
        { proxyWallet: '0xAAA', trader: 'Whale1', trader_rank: 1, trader_pnl: 500000, market: 'NBA Finals winner', side: 'NO', size: 8000, current_price: 0.3 },
        { proxyWallet: '0xBBB', trader: 'Whale2', trader_rank: 30, trader_pnl: -10000, market: 'ETH to 5k', side: 'YES', size: 5000, current_price: 0.4 },
      ]
    };

    const scores = computeWhaleAlphaScores(whaleData);
    expect(scores.size).toBe(2);

    const whale1 = scores.get('0xAAA');
    expect(whale1).toBeDefined();
    expect(whale1.score).toBeGreaterThanOrEqual(1);
    expect(whale1.score).toBeLessThanOrEqual(99);
    expect(['A+', 'A', 'B', 'C', 'D']).toContain(whale1.grade);
    expect(whale1.breakdown).toHaveProperty('win_rate');
    expect(whale1.breakdown).toHaveProperty('category');
    expect(whale1.breakdown).toHaveProperty('early_entry');
    expect(whale1.breakdown).toHaveProperty('sizing');
    expect(whale1.breakdown).toHaveProperty('recency');

    // Whale1 (high PnL, diversified, top rank) should score higher than Whale2 (negative PnL, single category)
    const whale2 = scores.get('0xBBB');
    expect(whale1.score).toBeGreaterThan(whale2.score);
  });

  test('skips whales without proxyWallet', () => {
    const whaleData = {
      whales: [
        { trader: 'NoWallet', trader_rank: 1, trader_pnl: 100000, market: 'BTC', side: 'YES', size: 5000, current_price: 0.7 },
      ]
    };
    const scores = computeWhaleAlphaScores(whaleData);
    expect(scores.size).toBe(0);
  });

  test('grade thresholds are correct', () => {
    // Verify grade multipliers exist
    expect(_gradeMultiplier['A+']).toBe(1.0);
    expect(_gradeMultiplier['A']).toBe(0.9);
    expect(_gradeMultiplier['B']).toBe(0.75);
    expect(_gradeMultiplier['C']).toBe(0.55);
    expect(_gradeMultiplier['D']).toBe(0.35);
  });
});

// ── computeMarketAlphaScore ───────────────────────────────
describe('computeMarketAlphaScore', () => {
  test('returns 0 for null inputs', () => {
    expect(computeMarketAlphaScore(null, [], new Map())).toBe(0);
    expect(computeMarketAlphaScore({}, null, new Map())).toBe(0);
  });

  test('returns 0 when market not found in whale index', () => {
    const market = { question: 'Unknown market', market_id: 'mkt_999' };
    const whaleIndex = [{ market: 'Other market', whale_count: 5, market_id: 'mkt_1' }];
    expect(computeMarketAlphaScore(market, whaleIndex, new Map())).toBe(0);
  });

  test('returns 0 when whale_count < 2', () => {
    const market = { question: 'BTC 100k' };
    const whaleIndex = [{ market: 'BTC 100k', whale_count: 1 }];
    expect(computeMarketAlphaScore(market, whaleIndex, new Map())).toBe(0);
  });

  test('computes positive alpha score when whales diverge from market price', () => {
    const market = { question: 'BTC 100k', yes_price: 0.3 };
    const whaleIndex = [{
      market: 'BTC 100k',
      whale_count: 5,
      consensus_side: 'YES',
      consensus_pct: 80,
      total_capital: 500000,
      wallets: ['0xA', '0xB'],
    }];
    const eliteScores = new Map();
    eliteScores.set('0xA', { grade: 'A+' });
    eliteScores.set('0xB', { grade: 'A' });

    const score = computeMarketAlphaScore(market, whaleIndex, eliteScores);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  test('score is bounded 0-10', () => {
    const market = { question: 'BTC 100k', yes_price: 0.01 };
    const whaleIndex = [{
      market: 'BTC 100k',
      whale_count: 10,
      consensus_side: 'YES',
      consensus_pct: 99,
      total_capital: 10000000,
      wallets: ['0xA'],
    }];
    const eliteScores = new Map();
    eliteScores.set('0xA', { grade: 'A+' });

    const score = computeMarketAlphaScore(market, whaleIndex, eliteScores);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });
});
