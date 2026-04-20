// T5 — Flex Score for Sports v1 — pure formula.
//
// Isolated here so scripts/test-sports-flex.js can exercise the math with
// hand-crafted fixtures without touching Postgres. server.js also imports
// these helpers.
//
// Input shape:
//   {
//     net_units,            // signed sum of settled_units (winning bets +, losing −)
//     settled_bets,         // count of picks with settlement_status IN ('win','loss','push')
//     total_staked_units,   // sum of units for non-void settled picks
//     active_days,          // count distinct days with at least one locked pick
//     distinct_sports,      // count distinct sport values on settled picks
//     distinct_bet_types,   // count distinct bet_type values on settled picks
//     weeks_active_90d,     // count distinct iso-weeks in last 90d with ≥1 settled bet
//     weeks_profitable_90d, // of those, how many had net_units > 0
//     avg_clv_cents,        // time-decayed avg CLV from polymarket_trades, null if no data
//   }
//
// Gate thresholds are constants so the UI can reason about "why" a user
// isn't scored yet.

const THRESHOLDS = {
  MIN_SETTLED_BETS:   25,
  MIN_STAKED_UNITS:  500,
  MIN_ACTIVE_DAYS:    14,
  MIN_WEEKS_CONSISTENCY: 4, // below this, consistency component stays 0
};

// Curves. Each clamps to 0..1.
function _pnlCurve(netUnits) {
  // Log curve. net_units=0→0, 5→0.41, 50→1.0 (saturated). Negative → 0.
  if (!Number.isFinite(netUnits) || netUnits <= 0) return 0;
  return Math.min(1, Math.log10(1 + netUnits) / Math.log10(51));
}

function _volumeCurve(settledBets) {
  // Log curve with 25 floor. 25→0, 100→~0.46, 500→1.0 (saturated).
  if (!Number.isFinite(settledBets) || settledBets < THRESHOLDS.MIN_SETTLED_BETS) return 0;
  const above = settledBets - THRESHOLDS.MIN_SETTLED_BETS + 1;
  return Math.min(1, Math.log10(above) / Math.log10(475 + 1));
}

function _consistencyFraction(weeksActive, weeksProfitable) {
  if (!Number.isFinite(weeksActive) || weeksActive < THRESHOLDS.MIN_WEEKS_CONSISTENCY) return 0;
  const frac = weeksProfitable / weeksActive;
  return Math.max(0, Math.min(1, frac));
}

function _clvCurve(avgClvCents) {
  // +5c avg → 1.0 (sharp). 0 → 0. Negative clamps to 0. Null → 0.
  if (avgClvCents == null || !Number.isFinite(avgClvCents)) return 0;
  if (avgClvCents <= 0) return 0;
  return Math.min(1, avgClvCents / 5);
}

function _diversityFlag(distinctSports, distinctBetTypes) {
  return (distinctSports >= 2 || distinctBetTypes >= 2) ? 1 : 0;
}

// Main entry point. Returns:
//   { score, qualifies, components: {pnl, volume, consistency, clv, diversity}, reasons }
// When qualifies=false, score is NULL and `reasons` lists the failing gates.
function computeSportsFlexScore(stats) {
  const s = stats || {};
  const pnlC  = +( _pnlCurve(s.net_units) * 40 ).toFixed(2);
  const volC  = +( _volumeCurve(s.settled_bets) * 20 ).toFixed(2);
  const consC = +( _consistencyFraction(s.weeks_active_90d, s.weeks_profitable_90d) * 15 ).toFixed(2);
  const clvC  = +( _clvCurve(s.avg_clv_cents) * 15 ).toFixed(2);
  const divC  = +( _diversityFlag(s.distinct_sports, s.distinct_bet_types) * 10 ).toFixed(2);

  const components = { pnl: pnlC, volume: volC, consistency: consC, clv: clvC, diversity: divC };

  const reasons = [];
  if (!(s.settled_bets       >= THRESHOLDS.MIN_SETTLED_BETS))  reasons.push(`need ${THRESHOLDS.MIN_SETTLED_BETS} settled bets (have ${s.settled_bets || 0})`);
  if (!(s.total_staked_units >= THRESHOLDS.MIN_STAKED_UNITS))  reasons.push(`need ${THRESHOLDS.MIN_STAKED_UNITS}u total staked (have ${s.total_staked_units || 0})`);
  if (!(s.active_days        >= THRESHOLDS.MIN_ACTIVE_DAYS))   reasons.push(`need ${THRESHOLDS.MIN_ACTIVE_DAYS} active days (have ${s.active_days || 0})`);
  const qualifies = reasons.length === 0;

  const rawScore = pnlC + volC + consC + clvC + divC;
  const score = qualifies ? Math.round(Math.max(0, Math.min(100, rawScore))) : null;

  return { score, qualifies, components, reasons };
}

module.exports = {
  computeSportsFlexScore,
  THRESHOLDS,
  _internals: {
    _pnlCurve, _volumeCurve, _consistencyFraction, _clvCurve, _diversityFlag,
  },
};
