// Hyperliquid fill-grade — pure-logic tests for lib/hl-fill-grade.js.
//
// No database, no network. Locks: Close* only, n≥10, wins AND losses,
// fees deducted, inventory closers flagged (not hidden).
//
// Run: node --test test/hl-fill-grade.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HL_FILL_GRADE_MIN_N,
  gradeHyperliquidFills,
  rankFillGraded
} = require('../lib/hl-fill-grade');

function fill(overrides) {
  return Object.assign({
    dir: 'Close Long',
    closedPnl: '10',
    fee: '1',
    sz: '1',
    px: '100',
    coin: 'ETH'
  }, overrides);
}

function nFills(count, overrides) {
  return Array.from({ length: count }, () => fill(overrides));
}

test('n floor: fewer than 10 closes does not qualify', () => {
  const g = gradeHyperliquidFills(nFills(HL_FILL_GRADE_MIN_N - 1));
  assert.equal(g.qualify, false);
  assert.equal(g.n, 9);
});

test('opens are inventory, not a result', () => {
  const fills = [
    ...nFills(12, { dir: 'Open Long', closedPnl: '50' }),
    ...nFills(5, { dir: 'Close Long', closedPnl: '2' })
  ];
  const g = gradeHyperliquidFills(fills);
  assert.equal(g.qualify, false);
  assert.equal(g.n, 5);
});

test('wins and losses both count; fees deducted from net', () => {
  const fills = [
    ...nFills(6, { closedPnl: '10', fee: '1', coin: 'BTC' }),
    ...nFills(6, { closedPnl: '-4', fee: '1', coin: 'ETH' })
  ];
  const g = gradeHyperliquidFills(fills);
  assert.equal(g.qualify, true);
  assert.equal(g.n, 12);
  assert.equal(g.wins, 6);
  assert.equal(g.losses, 6);
  assert.equal(g.win_rate, 50);
  assert.equal(g.realized_pnl, 36); // 6*10 + 6*(-4)
  assert.equal(g.fees, 12);
  assert.equal(g.net_pnl, 24);
  assert.equal(g.unique_coins, 2);
  assert.deepEqual(g.flags, []);
});

test('zero-PnL close is neither win nor loss', () => {
  const fills = [
    ...nFills(8, { closedPnl: '1' }),
    ...nFills(4, { closedPnl: '0' })
  ];
  const g = gradeHyperliquidFills(fills);
  assert.equal(g.wins, 8);
  assert.equal(g.losses, 0);
  assert.equal(g.n, 12);
});

test('2000-0 same-coin closer is flagged inventory, not hidden', () => {
  const g = gradeHyperliquidFills(nFills(200, { closedPnl: '0.01', fee: '0', coin: 'ETH' }));
  assert.equal(g.qualify, true);
  assert.equal(g.win_rate, 100);
  assert.ok(g.flags.includes('inventory_closer'));
  assert.ok(g.flags.includes('single_coin_closer'));
});

test('real W–L book is not flagged', () => {
  const fills = [
    ...nFills(80, { closedPnl: '5', coin: 'SOL' }),
    ...nFills(70, { closedPnl: '-3', coin: 'BTC' })
  ];
  const g = gradeHyperliquidFills(fills);
  assert.equal(g.flags.length, 0);
});

test('rank: directional books sit above inventory closers even if closer PnL is larger', () => {
  const ranked = rankFillGraded([
    { display_name: 'MM', net_pnl: 9000, flags: ['inventory_closer'] },
    { display_name: 'Trader', net_pnl: 100, flags: [] }
  ]);
  assert.equal(ranked[0].display_name, 'Trader');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].display_name, 'MM');
  assert.equal(ranked[1].rank, 2);
});
