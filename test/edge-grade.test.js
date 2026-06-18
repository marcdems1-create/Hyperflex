// Edge Grade — pure-logic tests for lib/edge-grade.js.
//
// No database, no network — the module is deterministic, so this suite always
// runs (unlike messaging.test.js which needs DATABASE_URL). It locks the
// definition of a "true high-reward edge pick" so a future refactor can't
// silently loosen the gates or flip a grade boundary.
//
// Run: node --test test/edge-grade.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { gradeEdgePick, rewardRatio, methodology, constants } = require('../lib/edge-grade');

// A fully-qualifying grade-A market: strong score, in-band, liquid, real upside.
function pick(overrides = {}) {
  return Object.assign({
    edge_score: 80,
    yes_price: 0.40,
    volume: 500000,
    trade: { side: 'YES', entry_cost: 40, potential_profit: 60, roi_pct: 150 },
  }, overrides);
}

test('reward ratio: profit per $1 staked', () => {
  assert.equal(rewardRatio(40), 1.5);   // 60¢ profit on 40¢ cost
  assert.equal(rewardRatio(80), 0.25);  // 20¢ profit on 80¢ cost
  assert.equal(rewardRatio(50), 1);
  assert.equal(rewardRatio(0), null);
  assert.equal(rewardRatio(100), null);
  assert.equal(rewardRatio('nope'), null);
});

test('grade A: strong score, in-band, liquid, real upside', () => {
  const v = gradeEdgePick(pick());
  assert.equal(v.is_edge_pick, true);
  assert.equal(v.grade, 'A');
  assert.equal(v.confidence, 'HIGH');
  assert.equal(v.side, 'YES');
  assert.equal(v.reward_ratio, 1.5);
});

test('grade B: strong but sub-A score', () => {
  const v = gradeEdgePick(pick({ edge_score: 70, trade: { side: 'YES', entry_cost: 45, roi_pct: 122 } }));
  assert.equal(v.grade, 'B');
  assert.equal(v.confidence, 'MEDIUM');
});

test('grade C: qualifying floor score', () => {
  const v = gradeEdgePick(pick({ edge_score: 62, trade: { side: 'NO', entry_cost: 35, roi_pct: 186 } }));
  assert.equal(v.grade, 'C');
  assert.equal(v.confidence, 'LOW');
  assert.equal(v.is_edge_pick, true);
});

test('A-tier score with thin upside downgrades to B', () => {
  // 80 score but an 80¢ entry → reward 0.25 < GRADE_A_MIN_REWARD. A high score
  // on a market with no room to run is a B, not an A.
  const v = gradeEdgePick(pick({ edge_score: 80, yes_price: 0.80, trade: { side: 'YES', entry_cost: 80, roi_pct: 25 } }));
  assert.equal(v.grade, 'B');
  assert.equal(v.reward_ratio, 0.25);
});

test('below pick floor: not a pick', () => {
  const v = gradeEdgePick(pick({ edge_score: 55 }));
  assert.equal(v.is_edge_pick, false);
  assert.equal(v.grade, null);
  assert.ok(v.reasons.some(r => r.includes('below pick floor')));
});

test('near-settled price: not a pick even with a huge score', () => {
  const hi = gradeEdgePick(pick({ edge_score: 95, yes_price: 0.93 }));
  assert.equal(hi.is_edge_pick, false);
  assert.ok(hi.reasons.some(r => r.includes('near-settled')));

  const lo = gradeEdgePick(pick({ edge_score: 95, yes_price: 0.05 }));
  assert.equal(lo.is_edge_pick, false);
});

test('band edges are inclusive', () => {
  assert.equal(gradeEdgePick(pick({ yes_price: constants.BAND_LO })).is_edge_pick, true);
  assert.equal(gradeEdgePick(pick({ yes_price: constants.BAND_HI, trade: { side: 'NO', entry_cost: 15, roi_pct: 566 } })).is_edge_pick, true);
});

test('illiquid market: not a pick', () => {
  const v = gradeEdgePick(pick({ volume: 5000 }));
  assert.equal(v.is_edge_pick, false);
  assert.ok(v.reasons.some(r => r.includes('illiquid')));
});

test('no directional trade: not a pick', () => {
  assert.equal(gradeEdgePick(pick({ trade: null })).is_edge_pick, false);
  assert.equal(gradeEdgePick(pick({ trade: { side: '', entry_cost: null } })).is_edge_pick, false);
});

test('no live price: not a pick', () => {
  const v = gradeEdgePick(pick({ yes_price: null }));
  assert.equal(v.is_edge_pick, false);
  assert.ok(v.reasons.some(r => r.includes('no live price')));
});

test('garbage input does not throw', () => {
  assert.equal(gradeEdgePick(undefined).is_edge_pick, false);
  assert.equal(gradeEdgePick({}).is_edge_pick, false);
  assert.equal(gradeEdgePick({ edge_score: 'x', yes_price: 'y', trade: 'z' }).is_edge_pick, false);
});

test('methodology is self-consistent with constants', () => {
  const m = methodology();
  assert.equal(m.band_cents.lo, Math.round(constants.BAND_LO * 100));
  assert.equal(m.band_cents.hi, Math.round(constants.BAND_HI * 100));
  assert.equal(m.min_volume_usd, constants.MIN_VOLUME);
  assert.equal(m.grades.find(g => g.grade === 'A').min_score, constants.GRADE_A_SCORE);
  assert.equal(m.signals.length, 8);
  assert.ok(m.denominator.toLowerCase().includes('decided'));
});
