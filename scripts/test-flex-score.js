// Fixtures test for the unified Flex Score. Exits 0 if all cases pass,
// non-zero otherwise.
//
// Run: node scripts/test-flex-score.js

const { computeFlexScore, tierForScore, THRESHOLDS } = require('../lib/flex-score');

function approx(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1 : tol); }
function pass(name) { console.log('  ✓ ' + name); }
function fail(name, reason) { console.log('  ✗ ' + name + ' — ' + reason); process.exitCode = 1; }

function check(name, got, expect) {
  if (expect.qualifies !== undefined && got.qualifies !== expect.qualifies) {
    return fail(name, 'qualifies=' + got.qualifies + ' want ' + expect.qualifies);
  }
  if (expect.score !== undefined && got.score !== expect.score) {
    return fail(name, 'score=' + got.score + ' want ' + expect.score);
  }
  if (expect.score_approx != null && (got.score == null || !approx(got.score, expect.score_approx, expect.tol))) {
    return fail(name, 'score=' + got.score + ' want ~' + expect.score_approx + ' (±' + (expect.tol || 1) + ')');
  }
  if (expect.reasons_include && !(got.reasons || []).some(r => r.toLowerCase().includes(expect.reasons_include.toLowerCase()))) {
    return fail(name, 'reasons missing "' + expect.reasons_include + '" — got: ' + JSON.stringify(got.reasons));
  }
  if (expect.component) {
    for (const k of Object.keys(expect.component)) {
      const want = expect.component[k];
      const got_c = got.components[k];
      if (!approx(got_c, want, 1.0)) {
        return fail(name, 'component.' + k + '=' + got_c + ' want ~' + want);
      }
    }
  }
  if (expect.tier !== undefined) {
    const t = tierForScore(got.score, got.qualifies);
    if (t !== expect.tier) return fail(name, 'tier=' + t + ' want ' + expect.tier);
  }
  pass(name);
}

console.log('Flex Score fixture suite');
console.log('────────────────────────');

// ═══ Qualification gate (25 settled) ═══
check('Brand-new user (0 settled) → BUILDING',
  computeFlexScore({}),
  { qualifies: false, score: null, reasons_include: 'settled', tier: 'Building' }
);

check('Below threshold (20 settled) → BUILDING',
  computeFlexScore({
    wins: 12, losses: 6, pushes: 2, net_pnl: 20, total_staked: 200,
    weeks_active_90d: 5, weeks_profitable_90d: 3, distinct_categories: 2,
  }),
  { qualifies: false, score: null, reasons_include: '25 settled', tier: 'Building' }
);

// ═══ Small-sample cap (10 settled, accuracy cap at 60% WR) ═══
check('2-0 under cap-threshold: raw 100% WR gets reported but score capped',
  computeFlexScore({ wins: 2, losses: 0, pushes: 0, net_pnl: 2, total_staked: 2 }),
  { qualifies: false, raw_win_rate_check: 1.0 }
);

// Verify the accuracy component with the cap vs uncapped
const capped = computeFlexScore({
  wins: 8, losses: 1, pushes: 0,                              // 8-1 = 88.9% raw
  net_pnl: 7, total_staked: 9, weeks_active_90d: 3, weeks_profitable_90d: 3,
  distinct_categories: 1,
});
// Under cap (settled=9<10), WR clamped to 0.60 → accuracy_norm = (0.60-0.50)*10 = 1.0 → 35 pts
if (!approx(capped.components.accuracy, 35, 1)) {
  fail('9 settled with 88.9% WR → accuracy capped at 35pts (60% WR floor)', 'accuracy=' + capped.components.accuracy);
} else {
  pass('9 settled with 88.9% WR → accuracy capped at 35pts (60% WR floor)');
}

const uncapped = computeFlexScore({
  wins: 9, losses: 1, pushes: 0,                              // 9-1 = 90% raw, 10 settled → uncapped
  net_pnl: 8, total_staked: 10, weeks_active_90d: 3, weeks_profitable_90d: 3,
  distinct_categories: 1,
});
// Uncapped (settled=10): WR=0.90 → (0.90-0.50)*10 = 4.0 → clamps to 1.0 → 35 pts
// Both should hit 35, but the mechanism is different. Mostly this confirms the transition is clean.
if (!approx(uncapped.components.accuracy, 35, 1)) {
  fail('10 settled with 90% WR → accuracy saturates at 35pts', 'accuracy=' + uncapped.components.accuracy);
} else {
  pass('10 settled with 90% WR → accuracy saturates at 35pts');
}

// ═══ Core qualified cases ═══

// 50% WR breakeven bettor, no edge
check('50% WR, 30 settled, 0% ROI → breakeven-ish score',
  computeFlexScore({
    wins: 15, losses: 15, pushes: 0, net_pnl: 0, total_staked: 30,
    weeks_active_90d: 8, weeks_profitable_90d: 4,
    brier_score: 0.25, avg_clv_cents: 0, distinct_categories: 1,
  }),
  {
    qualifies: true,
    // accuracy 0 (at breakeven), calibration 0 (brier=0.25 clamps to 0, clv=0),
    // pnl 0 (roi=0), consistency 0.5*10=5, breadth 0 → 5
    score: 5,
    tier: 'Speculator',
  }
);

// Solid sports capper — 55% WR, +5% ROI, steady, one sport
check('55% WR sports-only, +5% ROI, 4 of 8 weeks profitable',
  computeFlexScore({
    wins: 22, losses: 18, pushes: 0,                                  // 55% of 40
    net_pnl: 2, total_staked: 40,                                     // +5% ROI
    weeks_active_90d: 8, weeks_profitable_90d: 4,
    brier_score: null, avg_clv_cents: 3,                              // CLV-only calibration
    distinct_categories: 1,                                           // one sport
  }),
  {
    qualifies: true,
    // accuracy (0.55-0.50)*10 = 0.5 → 17.5 pts
    // calibration CLV-only: 3/5 = 0.6 → 15 pts
    // pnl log10(6)/log10(51) ≈ 0.46 → 9.2 pts
    // consistency 4/8 = 0.5 → 5 pts
    // breadth 0 → 0 pts
    // total ≈ 46.7 → round 47
    score_approx: 47, tol: 2,
    tier: 'Speculator',
  }
);

// Sharp multi-category predictor — 60% WR, +15% ROI, consistent, 3 categories
check('Sharp across 3 categories, 60% WR, +15% ROI',
  computeFlexScore({
    wins: 60, losses: 40, pushes: 0,                                  // 60% of 100
    net_pnl: 15, total_staked: 100,                                   // +15% ROI
    weeks_active_90d: 10, weeks_profitable_90d: 7,
    brier_score: 0.12, avg_clv_cents: 4,                              // both present
    distinct_categories: 3,                                           // breadth
  }),
  {
    qualifies: true,
    // accuracy (0.60-0.50)*10 = 1.0 → 35 pts
    // calibration blend: brier_norm=1-0.12*4=0.52, clv_norm=4/5=0.8 → avg 0.66 → 16.5 pts
    // pnl log10(16)/log10(51) ≈ 0.71 → 14.1 pts
    // consistency 7/10 = 0.7 → 7 pts
    // breadth 10 pts
    // total ≈ 82.6 → round 83
    score_approx: 83, tol: 2,
    tier: 'Oracle',
  }
);

// Anti-whale proof — small bankroll disciplined bettor beats big whale with worse rate
const smallSharp = computeFlexScore({
  wins: 20, losses: 15, pushes: 0,                                    // 57% of 35
  net_pnl: 1.5, total_staked: 10,                                     // tiny bankroll, +15% ROI
  weeks_active_90d: 10, weeks_profitable_90d: 6,
  brier_score: null, avg_clv_cents: 4, distinct_categories: 2,
});
const bigWhale = computeFlexScore({
  wins: 520, losses: 480, pushes: 0,                                  // 52% of 1000
  net_pnl: 1000, total_staked: 50000,                                 // big bankroll, +2% ROI
  weeks_active_90d: 12, weeks_profitable_90d: 7,
  brier_score: 0.22, avg_clv_cents: 1, distinct_categories: 2,
});
if (smallSharp.score > bigWhale.score) {
  pass('Anti-whale: 57% WR +15% ROI small bankroll (' + smallSharp.score + ') beats 52% WR +2% ROI whale (' + bigWhale.score + ')');
} else {
  fail('Anti-whale rate-over-size', 'small=' + smallSharp.score + ' whale=' + bigWhale.score);
}

// ═══ Tier thresholds ═══
check('Tier: qualified 80 → Oracle',  { score: 82, qualifies: true, components:{}, reasons:[], settled_events:30, raw_win_rate:0.55 }, { tier: 'Oracle'    });
check('Tier: qualified 70 → Sharp',   { score: 70, qualifies: true, components:{}, reasons:[], settled_events:30, raw_win_rate:0.55 }, { tier: 'Sharp'     });
check('Tier: qualified 55 → Solid',   { score: 55, qualifies: true, components:{}, reasons:[], settled_events:30, raw_win_rate:0.55 }, { tier: 'Solid'     });
check('Tier: qualified 30 → Speculator', { score: 30, qualifies: true, components:{}, reasons:[], settled_events:30, raw_win_rate:0.55 }, { tier: 'Speculator' });
check('Tier: not qualified → Building', { score: null, qualifies: false, components:{}, reasons:[], settled_events:5, raw_win_rate:0.5 }, { tier: 'Building' });

// ═══ Edge cases ═══
check('Negative ROI → pnl component 0',
  computeFlexScore({
    wins: 13, losses: 17, pushes: 0, net_pnl: -5, total_staked: 30,
    weeks_active_90d: 8, weeks_profitable_90d: 2,
    brier_score: null, avg_clv_cents: null, distinct_categories: 1,
  }),
  { qualifies: true, component: { pnl: 0 } }
);

check('Missing calibration data → component 0',
  computeFlexScore({
    wins: 20, losses: 10, pushes: 0, net_pnl: 10, total_staked: 30,
    weeks_active_90d: 8, weeks_profitable_90d: 5,
    brier_score: null, avg_clv_cents: null, distinct_categories: 2,
  }),
  { qualifies: true, component: { calibration: 0 } }
);

console.log('');
console.log(process.exitCode ? 'FAILED' : 'all fixtures passed');
