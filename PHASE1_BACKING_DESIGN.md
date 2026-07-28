# Phase 1 — Reputation-Backing Mechanic (DESIGN DOC, not yet built)

Status: **awaiting Marc's approval.** Nothing in this doc is implemented. Per the phased build instruction, Phase 1 stops here — the mechanic gets built only after this model is approved.

## The choice: discrete vs. continuous

**A — DISCRETE:** each new verified call by a backed predictor settles backers incrementally (hit → credit, miss → debit), pro-rata to stake. Reuses the existing capped/weighted-ROI math the scoring pipeline already computes per trade. No live price, no AMM.

**B — CONTINUOUS PRICE:** predictor has a reputation price on a bonding curve driven by `score_pct`. Backing = buy in; exit anytime for gain/loss versus current price. New AMM primitive.

## Recommendation: A

Arguing against B fairly, since Marc asked to be argued out of A if B is clearly better — it isn't, for one structural reason: **`score_pct` is shrinkage-adjusted against a population mean that moves independently of the backed predictor** (`_computeRoiLeaderboard`'s `popWeightedRoi` — the shrinkage prior every wallet's score is pulled toward). If a bonding curve prices off `score_pct` directly, a backer's P&L would be driven partly by *other traders' unrelated activity* shifting the population mean, not by anything the backed predictor did. That's a real integrity problem for a product whose entire pitch is "your price moves because of *your* record" — B can't cleanly promise that without first stripping the shrinkage term out of the priced metric, which is its own unscoped project.

A doesn't have this problem: it settles off the predictor's own newly-resolved trade only (see math below), never touching the population-relative `score_pct`. It also reuses proven math (capped ROI, time-decay-style weighting) instead of inventing pricing/liquidity mechanics from scratch, and it has no exit-slippage or price-impact surface to design — a backer's stake is exactly what it is between settlement events, no AMM curve to get wrong. B is more "alive" visually (a price ticking in real time reads better for the addiction/dopamine-loop mandate), but that's a v2 problem once A is proven, not a reason to build the harder, riskier thing first.

**Recommendation stands: build A.**

## Model A, fully specified

### Settlement math

On each of a backed predictor's newly-resolved **durable** trades (a new row appearing in `realized_trades` with `realized_pnl`/`closed_at` populated, `market_durability='durable'` — the same population `_computeRoiLeaderboard` scores):

```
capped_roi      = LEAST(GREATEST(realized_roi, -1.0), ROI_CAP)     -- identical clamp to the scoring pipeline
per_call_move   = SETTLEMENT_SENSITIVITY * (capped_roi / ROI_CAP)   -- e.g. SETTLEMENT_SENSITIVITY = 0.05 (5%)
backer_delta    = ROUND(backer_stake_on_predictor * per_call_move)
```

`ROI_CAP` is the existing constant (`server.js`, currently 10.0 / 1000%), reused verbatim — not redefined. `SETTLEMENT_SENSITIVITY` is the one new tunable this doc asks you to sign off on: at 0.05, a maxed-out 1000%-ROI call moves 5% of a backer's stake; an ordinary small win/loss moves proportionally less. No single call can wipe or double a backer's position — movement compounds across many calls, which is what makes the price "track the record" without needing a live curve.

Every settlement writes two rows: a `flex_backing_settlements` audit row (which trade triggered it, the capped ROI, the delta) and a `flex_wallet_ledger` row (`reason='back_predictor_settlement'`, `ref_id` = the settlement id) — same append-only discipline as Phase 0, so a backer's balance is never adjusted without a paper trail.

### New infrastructure this actually requires (flagging honestly, not assuming it exists)

**There is currently no recurring job that re-syncs `realized_trades` for an already-connected wallet.** `backfillRealizedTrades` runs exactly once, in the background, at initial `/api/connect` — confirmed by grep, its only call site is that route. The hourly `syncAllUserPositions` cron only touches `cached_positions` (open positions), never `realized_trades`. So today, a wallet's scored record is frozen at whatever it was when they last connected, even if they keep trading.

Model A needs a new cron — scoped only to predictors who currently have active backers (cheap, not a full-platform resync) — that re-runs the backfill/settlement check on a short interval (proposing every 15 min, matching this file's existing cron cadence for similar jobs) and fires settlement for any newly-resolved durable trade since the last check. This is real, new, scoped work — called out here so it doesn't get silently assumed away.

### Tables

```sql
-- One row per backer→predictor relationship. staked_centpoints is the live,
-- current stake (moves via settlement, not a static snapshot of what was
-- put in).
CREATE TABLE flex_backings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backer_address      TEXT NOT NULL,
  predictor_user_id   TEXT NOT NULL,      -- users.id — the join key _computeRoiLeaderboard already uses
  staked_centpoints    BIGINT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'withdrawn'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (backer_address <> '' )
);
CREATE INDEX idx_flex_backings_backer ON flex_backings (backer_address);
CREATE INDEX idx_flex_backings_predictor ON flex_backings (predictor_user_id, status);

-- Audit trail: which verified call triggered which settlement, for which backing.
CREATE TABLE flex_backing_settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backing_id        UUID NOT NULL REFERENCES flex_backings(id),
  trade_id          UUID NOT NULL,   -- realized_trades.id — the specific call
  capped_roi        NUMERIC NOT NULL,
  delta_centpoints  BIGINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_flex_backing_settlements_once ON flex_backing_settlements (backing_id, trade_id);
-- ^ idempotency guard, same pattern as Phase 0's one-grant index: a given
-- (backing, trade) pair can only ever settle once, at the DB level.
```

`idx_flex_backing_settlements_once` is the load-bearing safety constraint here, same role as Phase 0's signup-grant unique index — it makes the settlement cron safe to re-run or retry without double-paying a backer for the same call.

### Self-dealing

Two distinct risks, both real, both addressed differently:

1. **A predictor backs their own address.** Blocked at the write layer: `back a predictor` rejects if `backer_address` resolves to the same `user_id` as `predictor_user_id`. Simple, sufficient for the direct case.
2. **A predictor backs themselves via other wallets they control (Sybil), to manufacture fake backing volume as social proof.** This is not fully solvable in Phase 1 — and it's the same open risk CLAUDE.md already flags for the leaderboard itself ("a wallet can be farmed... needs a real answer before scale"). Two mitigations worth having now regardless: (a) never surface backing count/volume as a public metric — this is already consistent with the existing charter's "no follower counts as a prominent metric," so it costs nothing to hold that line here too; (b) the Phase-0 signup grant itself is what a Sybil would need to farm first (fresh wallets for free FP) — that's a pre-existing Phase 0 exposure this build inherits, not a new one. Flagging honestly rather than claiming it's solved.

### Inactive predictor

Clean by construction: no new resolved trade → no settlement event → the backer's `staked_centpoints` simply sits unchanged, neither gaining nor losing, for as long as the predictor is inactive. A backer can withdraw at any time (`status='withdrawn'`, stake returns to their `flex_wallet_balance` via the standard ledgered adjust) — since nothing moves between settlement events, there's no exit slippage or timing cost to withdrawing on an inactive predictor. This is a genuine advantage of the discrete model over a continuous curve, where "when do I exit" carries real price-impact risk.

### Early-backer advantage

Backing before a predictor's next win captures that win's settlement; backing after captures nothing retroactively. This reads as **legitimate, not gameable** — the predictor's pending trades are live, already-placed Polymarket positions whose real-world resolution is unknown to everyone, including us; there's no crystal ball to front-run. The only way this becomes unfair is if a backer had non-public information about a *specific pending trade's* outcome — a risk that exists independent of Hyperflex (same as any market), not something this design introduces. Rewarding early conviction on a public track record is the entire point of a reputation market, not a bug in it.

### Integrity — record → price, never price → record

Structurally guaranteed by not touching the oracle at all: `_computeRoiLeaderboard` and `_buildTraderCards` are not modified anywhere in this build, and nothing in `flex_backings`/`flex_backing_settlements` is ever joined into those functions' queries. Settlement reads `realized_trades` (the same table the scoring pipeline reads) but writes only to the new backing tables and the wallet ledger. A predictor's card still shows score+n exactly as computed today — backing is a consumer of the oracle, never a contributor to it.

## Endpoints planned (not built yet — pending approval)

- `POST /api/flex/back` — stake FP on a predictor (`predictor_user_id`, `amount_centpoints`); debits the backer's `flex_wallet_balance` via the existing Phase-0 `_flexWalletAdjust`, creates/increments a `flex_backings` row.
- `GET /api/flex/backings?address=` — a backer's own active + withdrawn backings, current staked amount, settlement history.
- `POST /api/flex/unback` — withdraw an active backing, credit back to `flex_wallet_balance`.
- A new scoped cron (see "new infrastructure" above) that re-syncs backed predictors' `realized_trades` and fires settlement via `flex_backing_settlements`.

## Open item requiring your input

`SETTLEMENT_SENSITIVITY = 0.05` is a guess, not a derived number — worth sanity-checking against a real predictor's call frequency before launch (someone with 189 durable trades over months settles very differently, in aggregate, than someone with 10). Fine to lock at 0.05 for a first build and tune after watching it run against real data.

---

**Stopping here per instruction. Waiting for approval on: the model (A), the settlement formula and `SETTLEMENT_SENSITIVITY`, the self-dealing mitigation (block same-user backing; no public backing-volume metric), and the new scoped resync cron before any of Phase 1's code gets written.**
