// Fixtures test for the T5 Flex Score for Sports formula. Exits 0 if all
// cases pass, non-zero otherwise. Acceptance criteria per the T5 spec:
// "deterministic recompute passes a fixtures test with known inputs/
// outputs per your component spec."
//
// Run: node scripts/test-sports-flex.js

const { computeSportsFlexScore, THRESHOLDS } = require('../lib/sports-flex-score');

function approx(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.5 : tol); }

const CASES = [
  {
    name: 'Empty / brand-new user',
    stats: {
      net_units: 0, settled_bets: 0, total_staked_units: 0, active_days: 0,
      distinct_sports: 0, distinct_bet_types: 0,
      weeks_active_90d: 0, weeks_profitable_90d: 0, avg_clv_cents: null,
    },
    expect: { qualifies: false, score: null, reasons_include: 'settled bets' },
  },
  {
    name: 'Below minimum threshold (22 bets) — reasons reported',
    stats: {
      net_units: 5, settled_bets: 22, total_staked_units: 400, active_days: 10,
      distinct_sports: 1, distinct_bet_types: 1,
      weeks_active_90d: 5, weeks_profitable_90d: 3, avg_clv_cents: 2,
    },
    expect: { qualifies: false, score: null, reasons_include: 'settled bets' },
  },
  {
    name: 'Break-even qualifier (no profit, no CLV, no diversity)',
    stats: {
      net_units: 0, settled_bets: 30, total_staked_units: 600, active_days: 20,
      distinct_sports: 1, distinct_bet_types: 1,
      weeks_active_90d: 8, weeks_profitable_90d: 4, avg_clv_cents: 0,
    },
    expect: {
      qualifies: true,
      score_between: [8, 14],   // volume + half consistency, no P&L/CLV/div
    },
  },
  {
    name: 'Solid sharp — 10u profit, 100 bets, consistent, positive CLV, 2 sports',
    stats: {
      net_units: 10, settled_bets: 100, total_staked_units: 1000, active_days: 45,
      distinct_sports: 2, distinct_bet_types: 1,
      weeks_active_90d: 12, weeks_profitable_90d: 9, avg_clv_cents: 2.5,
    },
    expect: {
      qualifies: true,
      score_between: [55, 72],
      divC: 10, // 2 sports → full diversity
    },
  },
  {
    name: 'Oracle-grade — 40u profit, 300 bets, 80% consistency, +4c CLV, diversity',
    stats: {
      net_units: 40, settled_bets: 300, total_staked_units: 5000, active_days: 80,
      distinct_sports: 3, distinct_bet_types: 3,
      weeks_active_90d: 12, weeks_profitable_90d: 10, avg_clv_cents: 4,
    },
    expect: {
      qualifies: true,
      score_between: [85, 100],
    },
  },
  {
    name: 'Losing user (should score low but qualify)',
    stats: {
      net_units: -15, settled_bets: 80, total_staked_units: 1500, active_days: 40,
      distinct_sports: 1, distinct_bet_types: 1,
      weeks_active_90d: 10, weeks_profitable_90d: 3, avg_clv_cents: -1,
    },
    expect: {
      qualifies: true,
      pnlC: 0,           // net negative → 0
      clvC: 0,           // negative CLV → 0
      score_between: [10, 22],
    },
  },
  {
    name: 'Diversity trigger: 2 bet types, 1 sport',
    stats: {
      net_units: 5, settled_bets: 30, total_staked_units: 600, active_days: 20,
      distinct_sports: 1, distinct_bet_types: 2,
      weeks_active_90d: 8, weeks_profitable_90d: 5, avg_clv_cents: null,
    },
    expect: {
      qualifies: true,
      divC: 10,
    },
  },
  {
    name: 'CLV saturates at +5c',
    stats: {
      net_units: 5, settled_bets: 30, total_staked_units: 600, active_days: 20,
      distinct_sports: 1, distinct_bet_types: 1,
      weeks_active_90d: 8, weeks_profitable_90d: 4, avg_clv_cents: 10, // well over 5c
    },
    expect: { qualifies: true, clvC: 15 },
  },
  {
    name: 'P&L log curve: 1u should be tiny, 50u should be saturated',
    stats: {
      net_units: 1, settled_bets: 30, total_staked_units: 600, active_days: 20,
      distinct_sports: 1, distinct_bet_types: 1,
      weeks_active_90d: 8, weeks_profitable_90d: 4, avg_clv_cents: null,
    },
    expect: { qualifies: true, pnlC_between: [0, 8] }, // 1u profit under 50u saturation = ~7pts
  },
  {
    name: 'Threshold-constant check — passes exact gate values',
    stats: {
      net_units: 3,
      settled_bets: THRESHOLDS.MIN_SETTLED_BETS,
      total_staked_units: THRESHOLDS.MIN_STAKED_UNITS,
      active_days: THRESHOLDS.MIN_ACTIVE_DAYS,
      distinct_sports: 1, distinct_bet_types: 1,
      weeks_active_90d: 6, weeks_profitable_90d: 3, avg_clv_cents: null,
    },
    expect: { qualifies: true },
  },
];

let pass = 0, fail = 0;
for (const tc of CASES) {
  const r = computeSportsFlexScore(tc.stats);
  const e = tc.expect;
  const errs = [];

  if (e.qualifies !== undefined && r.qualifies !== e.qualifies) errs.push(`qualifies=${r.qualifies} exp ${e.qualifies}`);
  if (e.score !== undefined && r.score !== e.score) errs.push(`score=${r.score} exp ${e.score}`);
  if (e.score_between && !(r.score >= e.score_between[0] && r.score <= e.score_between[1])) {
    errs.push(`score=${r.score} not in [${e.score_between[0]}, ${e.score_between[1]}]`);
  }
  if (e.pnlC !== undefined && !approx(r.components.pnl, e.pnlC))   errs.push(`pnlC=${r.components.pnl} exp ${e.pnlC}`);
  if (e.volC !== undefined && !approx(r.components.volume, e.volC)) errs.push(`volC=${r.components.volume} exp ${e.volC}`);
  if (e.consC !== undefined && !approx(r.components.consistency, e.consC)) errs.push(`consC=${r.components.consistency} exp ${e.consC}`);
  if (e.clvC !== undefined && !approx(r.components.clv, e.clvC))   errs.push(`clvC=${r.components.clv} exp ${e.clvC}`);
  if (e.divC !== undefined && !approx(r.components.diversity, e.divC)) errs.push(`divC=${r.components.diversity} exp ${e.divC}`);
  if (e.pnlC_between && !(r.components.pnl >= e.pnlC_between[0] && r.components.pnl <= e.pnlC_between[1])) {
    errs.push(`pnlC=${r.components.pnl} not in [${e.pnlC_between[0]}, ${e.pnlC_between[1]}]`);
  }
  if (e.reasons_include && !r.reasons.some(x => x.toLowerCase().includes(e.reasons_include.toLowerCase()))) {
    errs.push(`reasons [${r.reasons.join('; ')}] missing "${e.reasons_include}"`);
  }

  if (errs.length) {
    fail++;
    console.log('FAIL ' + tc.name);
    errs.forEach(x => console.log('     ' + x));
    console.log('     computed: ' + JSON.stringify(r));
  } else {
    pass++;
    console.log(' ok  ' + tc.name + ' · score=' + r.score + ' · ' + JSON.stringify(r.components));
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
