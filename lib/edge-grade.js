'use strict';

// ── Edge Grade ───────────────────────────────────────────────────────────────
// Single source of truth for one question: "Is this a TRUE potential high-reward
// market, and how strong is it?" Every market the engine surfaces gets graded
// here. Grade A/B picks are recorded to the public ledger at detection and graded
// when the market resolves — so the markets we flag as high-reward are held
// accountable in public (see /api/edge/track-record + /transparency).
//
// Pure + deterministic + no I/O — exercised by test/edge-grade.test.js and
// consumed by buildAlphaList() in server.js. Keep it dependency-free.
//
// A market is a high-reward edge pick only if ALL hold:
//   1. Live price is in-band [0.15, 0.85] — real two-sided uncertainty, real
//      reward. Outside the band the outcome is all but decided; the "reward" is
//      a rounding error and the edge is illusory.
//   2. It carries a directional trade (a side to take + an entry cost).
//   3. It is liquid enough to actually fill (>= $25k 24h volume).
//   4. Its Edge Score clears the pick floor (real multi-signal confluence).
//
// These constants intentionally mirror server.js EDGE_BAND_LO/HI and the
// screener's volume floor so the definition is identical everywhere it's read.

const BAND_LO = 0.15;        // below this, YES is near-settled
const BAND_HI = 0.85;        // above this, YES is near-settled
const MIN_VOLUME = 25000;    // 24h volume floor — reward you can actually capture

const GRADE_A_SCORE = 75;    // highest conviction
const GRADE_B_SCORE = 67;    // strong
const GRADE_C_SCORE = 60;    // qualifying ("withEdge" floor used elsewhere in server.js)

// Grade A additionally requires real upside: profit per $1 staked on the chosen
// side. At 0.45 a 69¢ entry still qualifies; an 80¢ entry (0.25 reward) does not
// — a high score on a market with no room to run is a B, not an A.
const GRADE_A_MIN_REWARD = 0.45;

function num(v) {
  // Number(null) and Number('') are 0 — treat absent values as null so a market
  // with no price reads as "no price", not as a near-settled 0.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Reward asymmetry for the chosen side. entryCostCents is the side's cost in
// cents (1-99). Returns profit-per-$1-staked: a 40¢ entry returns 1.50, an 80¢
// entry returns 0.25. Null if the cost is degenerate.
function rewardRatio(entryCostCents) {
  const c = num(entryCostCents);
  if (c == null || c <= 0 || c >= 100) return null;
  return Math.round(((100 - c) / c) * 100) / 100;
}

// Grade a single buildAlphaList market object. Returns a verdict with the grade
// (or null), whether it qualifies as a pick, the reward ratio, the side, and a
// short list of human-readable reasons (gates failed, or what earned the grade).
function gradeEdgePick(market) {
  const m = market || {};
  const reasons = [];
  const score = num(m.edge_score) || 0;
  const yes = num(m.yes_price);
  const volume = num(m.volume) || 0;
  const trade = m.trade || null;
  const entryCost = trade && trade.entry_cost != null ? num(trade.entry_cost) : null;

  const out = {
    is_edge_pick: false,
    grade: null,
    confidence: null,
    score,
    side: trade && trade.side ? trade.side : null,
    entry_cost_cents: entryCost,
    reward_ratio: null,
    max_roi_pct: trade && trade.roi_pct != null ? num(trade.roi_pct) : null,
    reasons,
  };

  // Gate 1 — real two-sided uncertainty
  if (yes == null) { reasons.push('no live price'); return out; }
  if (yes < BAND_LO || yes > BAND_HI) { reasons.push('near-settled (outside 15-85¢)'); return out; }

  // Gate 2 — a real directional trade
  if (!trade || !trade.side || entryCost == null) { reasons.push('no directional trade'); return out; }

  // Gate 3 — real liquidity
  if (volume < MIN_VOLUME) { reasons.push('illiquid (<$25k 24h volume)'); return out; }

  // Gate 4 — a real edge score
  if (score < GRADE_C_SCORE) { reasons.push('edge score below pick floor'); return out; }

  const reward = rewardRatio(entryCost);
  out.reward_ratio = reward;

  if (score >= GRADE_A_SCORE && (reward == null || reward >= GRADE_A_MIN_REWARD)) {
    out.grade = 'A';
    reasons.push('high edge score with real upside');
  } else if (score >= GRADE_A_SCORE) {
    // Score is A-tier but the upside is thin — call it what it is.
    out.grade = 'B';
    reasons.push('high edge score but limited upside');
  } else if (score >= GRADE_B_SCORE) {
    out.grade = 'B';
    reasons.push('strong edge score');
  } else {
    out.grade = 'C';
    reasons.push('qualifying edge score');
  }

  out.is_edge_pick = true;
  out.confidence = out.grade === 'A' ? 'HIGH' : out.grade === 'B' ? 'MEDIUM' : 'LOW';
  return out;
}

// Published methodology — the honest, self-documenting spec the transparency
// page and /api/edge/track-record render so "where does this grade come from?"
// is answerable straight from the source. Signal maxes mirror the actual
// contributions computed in buildAlphaList().
function methodology() {
  return {
    grades: [
      { grade: 'A', min_score: GRADE_A_SCORE, note: 'highest conviction — strong score and real upside' },
      { grade: 'B', min_score: GRADE_B_SCORE, note: 'strong confluence of signals' },
      { grade: 'C', min_score: GRADE_C_SCORE, note: 'qualifying edge — surfaced, not recorded' },
    ],
    band_cents: { lo: Math.round(BAND_LO * 100), hi: Math.round(BAND_HI * 100) },
    min_volume_usd: MIN_VOLUME,
    grade_a_min_reward_ratio: GRADE_A_MIN_REWARD,
    recorded: 'Grade A and B picks are logged the moment they are detected and graded when the market resolves. Grade C markets are surfaced but not recorded.',
    denominator: 'Hit rate counts only DECIDED picks (correct + wrong), deduped to one row per distinct market and side. Pending and never-resolved picks never inflate the rate.',
    signals: [
      { key: 'whale', max: 35, label: 'Whale positions', desc: 'Top-50 Polymarket traders holding this side, matched by conditionId.' },
      { key: 'whale_velocity', max: 25, label: 'Whale velocity', desc: 'Whales who opened or added in the last 60 minutes — smart money moving before price catches up.' },
      { key: 'volume', max: 20, label: 'Volume tier', desc: '24h traded volume. Liquidity is reward you can actually capture.' },
      { key: 'capital', max: 15, label: 'Capital at risk', desc: 'Total whale capital committed to the position.' },
      { key: 'news', max: 15, label: 'News alignment', desc: 'Market referenced in current high-signal headlines.' },
      { key: 'decay', max: 12, label: 'Time-decay discount', desc: 'Late-stage markets in the retail discount zone (15-40¢ or 60-85¢).' },
      { key: 'volume_spike', max: 12, label: 'Volume spike', desc: '24h volume against the 7-day baseline — something breaking now.' },
      { key: 'divergence', max: 10, label: 'Price divergence', desc: 'Price far from 50% with three or more whales aligned.' },
    ],
  };
}

module.exports = {
  gradeEdgePick,
  rewardRatio,
  methodology,
  constants: { BAND_LO, BAND_HI, MIN_VOLUME, GRADE_A_SCORE, GRADE_B_SCORE, GRADE_C_SCORE, GRADE_A_MIN_REWARD },
};
