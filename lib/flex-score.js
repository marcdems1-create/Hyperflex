// Unified Flex Score — pure function.
//
// Replaces three separate scoring systems (sports-flex-score, whale
// sharp_score, legacy predictor composite) with one formula that means
// the same thing across Polymarket traders, sports predictors, and any
// future domain.
//
// A Polymarket trader at Flex 75 is equivalently sharp to an NBA capper
// at Flex 75. Same number on every profile card, same tier ladder, same
// leaderboards. Charter §8: derived rating (not an accumulated currency),
// bounded 0–100, profile + leaderboard surfaces only.
//
// Formula (100 pts total, signed off):
//   Accuracy        35   win rate normalised around 50%; capped at 60% WR
//                        until 10 settled events (small-sample guard)
//   Calibration/CLV 25   Brier on Polymarket + cents-beaten-vs-close on
//                        sports picks, blended; 0 when no data either way
//   PnL quality     20   ROI% on a log curve — rate not $, small bankrolls
//                        climb as fast as whales
//   Consistency     10   % of trailing-90d weeks that were profitable
//                        (needs ≥4 active weeks to count)
//   Breadth         10   +10 when active in ≥2 categories (crypto /
//                        politics / sports / culture / macro)
//
// Gates:
//   settled_events < 10  → accuracy raw WR capped at 0.60 inside the
//                          formula (prevents 2-0 going straight to Oracle)
//   settled_events < 25  → qualifies=false, score=null, UI shows BUILDING
//                          badge, user NOT on public leaderboard
//
// Output shape matches sports-flex-score for cron writer reuse.

const THRESHOLDS = {
  BUILDING_MAX_SETTLED: 25,   // below this → BUILDING, no leaderboard
  ACCURACY_CAP_SETTLED: 10,   // below this → raw WR capped at 60% inside formula
  ACCURACY_CAP_WR:       0.60,
  CONSISTENCY_MIN_WEEKS:   4, // <4 active weeks → consistency component = 0
};

// ── Component curves (each returns 0..1) ───────────────────────────────────

// Accuracy: win rate normalised around 50% breakeven.
// 50% → 0, 60% → 1.0 (saturated). Below 50% → 0.
// Small-sample guard: if settled_events < 10, raw WR capped at 60% before
// normalisation, so 2-0 reads as 60% (→ 1.0 curve output) instead of 100%.
// The qualification gate (n<25) still prevents these tiny samples from
// ever being publicly scored.
function _accuracyCurve(wins, settledEvents) {
  if (!Number.isFinite(settledEvents) || settledEvents <= 0) return 0;
  let wr = wins / settledEvents;
  if (settledEvents < THRESHOLDS.ACCURACY_CAP_SETTLED) {
    wr = Math.min(wr, THRESHOLDS.ACCURACY_CAP_WR);
  }
  // Linear from 50% to 60%. Under 50% → 0. At 60% → 1.0.
  return Math.max(0, Math.min(1, (wr - 0.50) * 10));
}

// Calibration/CLV: blend Brier (Polymarket) + CLV (sports).
// Brier: 0 = perfect, 0.25 = random coin flip. Normalise so brier 0 → 1.0
// and brier 0.25 → 0. (brier_norm = 1 - brier*4, clamped.)
// CLV: cents-beaten-vs-close. +5c avg → 1.0 (genuinely sharp).
// Blend: average of the two when both present. If only one source has
// data, use it alone. If neither, component = 0.
function _calibrationCurve(brierScore, avgClvCents) {
  const brierHas = brierScore != null && Number.isFinite(brierScore);
  const clvHas   = avgClvCents != null && Number.isFinite(avgClvCents);
  if (!brierHas && !clvHas) return 0;
  let brierNorm = null, clvNorm = null;
  if (brierHas) brierNorm = Math.max(0, Math.min(1, 1 - brierScore * 4));
  if (clvHas)   clvNorm   = Math.max(0, Math.min(1, avgClvCents / 5));
  if (brierNorm != null && clvNorm != null) return (brierNorm + clvNorm) / 2;
  return brierNorm != null ? brierNorm : clvNorm;
}

// PnL quality: ROI on a log curve. Rate, not $.
// ROI as decimal: 0.05 = +5%. Log curve saturates at ~+50% ROI.
// Negative ROI → 0.
function _pnlCurve(roi) {
  if (!Number.isFinite(roi) || roi <= 0) return 0;
  // log10(1 + 100*roi) / log10(51): 0.05 → ~0.46, 0.20 → ~0.77, 0.50 → 1.0
  return Math.min(1, Math.log10(1 + 100 * roi) / Math.log10(51));
}

// Consistency: % of trailing-90d weeks profitable.
// Needs ≥4 active weeks to avoid "2 for 2 = 100% consistent" nonsense.
function _consistencyCurve(weeksActive, weeksProfitable) {
  if (!Number.isFinite(weeksActive) || weeksActive < THRESHOLDS.CONSISTENCY_MIN_WEEKS) return 0;
  const frac = weeksProfitable / weeksActive;
  return Math.max(0, Math.min(1, frac));
}

// Breadth: binary flag, ≥2 distinct categories.
function _breadthFlag(distinctCategories) {
  return (Number.isFinite(distinctCategories) && distinctCategories >= 2) ? 1 : 0;
}

// ── Main entry ─────────────────────────────────────────────────────────────
//
// Input shape:
//   {
//     wins, losses, pushes,            // settlement counts (voids excluded)
//     net_pnl,                         // signed sum, $ or units (same unit as total_staked)
//     total_staked,                    // denominator for ROI
//     brier_score,                     // null if no Polymarket trades
//     avg_clv_cents,                   // null if no CLV data
//     weeks_active_90d,
//     weeks_profitable_90d,
//     distinct_categories,             // count across all domains
//   }
//
// Output:
//   {
//     score,                           // 0..100 or null when !qualifies
//     qualifies,                       // true when settled_events ≥ 25
//     components: { accuracy, calibration, pnl, consistency, breadth },
//     settled_events,                  // derived convenience
//     raw_win_rate,                    // derived, uncapped (for UI)
//     reasons,                         // ['need 25 settled (have 8)', ...]
//   }

function computeFlexScore(stats) {
  const s = stats || {};
  const wins     = Number(s.wins) || 0;
  const losses   = Number(s.losses) || 0;
  const pushes   = Number(s.pushes) || 0;
  const settled  = wins + losses + pushes;

  const roi = (Number(s.total_staked) > 0)
    ? (Number(s.net_pnl) / Number(s.total_staked))
    : 0;

  const acc  = +( _accuracyCurve(wins, settled)                                             * 35 ).toFixed(2);
  const cal  = +( _calibrationCurve(s.brier_score, s.avg_clv_cents)                         * 25 ).toFixed(2);
  const pnl  = +( _pnlCurve(roi)                                                            * 20 ).toFixed(2);
  const cons = +( _consistencyCurve(s.weeks_active_90d, s.weeks_profitable_90d)             * 10 ).toFixed(2);
  const brd  = +( _breadthFlag(s.distinct_categories)                                       * 10 ).toFixed(2);

  const components = { accuracy: acc, calibration: cal, pnl, consistency: cons, breadth: brd };
  const raw = acc + cal + pnl + cons + brd;

  const reasons = [];
  if (settled < THRESHOLDS.BUILDING_MAX_SETTLED) {
    reasons.push(`need ${THRESHOLDS.BUILDING_MAX_SETTLED} settled events (have ${settled})`);
  }
  const qualifies = reasons.length === 0;
  const score = qualifies ? Math.round(Math.max(0, Math.min(100, raw))) : null;

  return {
    score,
    qualifies,
    components,
    settled_events: settled,
    raw_win_rate: settled > 0 ? +(wins / settled).toFixed(4) : null,
    reasons,
  };
}

// Tier ladder — pure function of score. 'Building' for pre-qualification.
// Matches the existing vocabulary (Oracle / Sharp / Solid / Speculator).
function tierForScore(score, qualifies) {
  if (!qualifies || score == null) return 'Building';
  if (score >= 80) return 'Oracle';
  if (score >= 65) return 'Sharp';
  if (score >= 50) return 'Solid';
  return 'Speculator';
}

module.exports = {
  computeFlexScore,
  tierForScore,
  THRESHOLDS,
  _internals: {
    _accuracyCurve, _calibrationCurve, _pnlCurve, _consistencyCurve, _breadthFlag,
  },
};
