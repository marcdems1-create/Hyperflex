# HYPERFLEX — Trader/Wallet Data Inventory (for mobile profile redesign)

Compiled 2026-08-08. Research-only, no code changed. Method notes and caveats are inline — read them, several sections carry unresolved schema drift that should be checked live before designing against it.

**No live DB connection was available in this environment** (no `DATABASE_URL`/`PG*` in `.env`, no `railway` CLI). Section 1 is reconstructed from `CREATE TABLE`/`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements in `server.js` + root `supabase_migration_*.sql` files, in execution order where determinable. Get this live-verified via `scripts/schema-diff.js` (exists in-repo) before finalizing any design around it — three tables below have **unresolved schema drift** (conflicting `CREATE TABLE IF NOT EXISTS` definitions across files).

---

## 1. DATABASE COLUMNS (per wallet/user)

### `users` — base identity + cached scores
```
users.id — TEXT PK — primary key
users.email — TEXT UNIQUE — login email (JWT-auth users only)
users.display_name — TEXT
users.polymarket_address — TEXT — PRIMARY WALLET IDENTITY, the /connect join key
users.polymarket_proxy — TEXT — derived Gnosis Safe proxy address
users.handle — TEXT — canonical @handle, backs /@handle route
users.username — TEXT — ⚠️ DRIFT: second, similarly-purposed field alongside `handle` — unclear which is authoritative, check live for divergence
users.avatar_url / banner_url / bio — TEXT — profile cosmetic fields
users.wallet_verified — BOOLEAN — signature-verified wallet ownership
users.archetype / archetype_color / archetype_rarity — TEXT — user-set persona label (live-used)
users.topic_preferences — TEXT[] — onboarding topic picks
users.onboarded — BOOLEAN
users.is_whale / whale_rank / whale_pnl — legacy capital-deployed whale flags. Superseded as leaderboard GATE by market_durability (CLAUDE.md Gate 1, 2026-07-20) but fields still populated and still read in places
users.total_predictions / prediction_win_rate / brier_score / prediction_pnl — NUMERIC/INTEGER — legacy prediction-tracking cache, distinct from FLEX system
users.follower_count / following_count — INTEGER — denormalized social counts
users.realized_trade_count — INTEGER — cached count from realized_trades backfill
users.flex_computed_at — TIMESTAMPTZ
users.flex_score — NUMERIC — ⚠️ DRIFT: 3 overlapping score columns, see flex_score_90d/alltime below. IMPORTANT: computeTraderCard() (the function that actually backs the live trader profile) does NOT read any of these three — it computes everything fresh from realized_trades per request. These columns are written by a separate FLEX subsystem and used elsewhere (leaderboards), not by the profile page's own card object.
users.flex_tier — TEXT — Building/TRADER/PROFITABLE/SHARP/SHARK/WHALE/FLEXIN ladder label
users.flex_qualifies — BOOLEAN — whether wallet clears the ranking gate
users.flex_settled_events — INTEGER — sample size input to FLEX score
users.flex_raw_win_rate — NUMERIC
users.flex_c_accuracy / flex_c_calibration / flex_c_pnl / flex_c_consistency / flex_c_breadth — NUMERIC — the 5 FLEX Score components
users.flex_score_90d — NUMERIC DEFAULT 0 — ⚠️ DRIFT, see flex_score above
users.flex_score_alltime — NUMERIC DEFAULT 0 — ⚠️ DRIFT, see flex_score above
users.predictions_resolved — INTEGER
users.telegram_chat_id — TEXT
users.balance — NUMERIC — legacy JWT-gated play-money balance. NOT what backs a /connect wallet-only user — see flex_wallet_balance table below
users.leaderboard_opt_out — BOOLEAN — the default-on/opt-out flag from CLAUDE.md rule 5
users.login_streak / last_login_date / streak_multiplier — retention mechanics
users.is_new_polymarket_wallet / first_trade_count_at_connect / polymarket_connected_at — snapshot fields captured at connect time
users.rebate_program_enrolled — BOOLEAN DEFAULT TRUE — builder-fee rebate enrollment
users.last_active_at — TIMESTAMPTZ
users.kalshi_api_key / kalshi_username / manifold_username — SUSPECT LEGACY. Kalshi dropped 2026-04-30 per CLAUDE.md active-fires; fields still exist, not promoted in UI
users.tipster_handle — SUSPECT DEAD. Tied to a dropped tipster-gate feature (supabase_migration_drop_tipster_gate.sql exists)
```

### `wallet_scores` — CLV/sharpness classification, one row per wallet
```
wallet_scores.user_id — TEXT PK, join key
wallet_scores.sharpness_score — NUMERIC — 0-100 composite (written by a DIFFERENT subsystem than clv-engine.js, ~server.js:3797)
wallet_scores.realized_pnl_usd — NUMERIC
wallet_scores.take_accuracy — NUMERIC 0..1, null if <5 resolved takes
wallet_scores.resolved_takes / closed_positions / total_volume_usd — counts/volume
wallet_scores.wallet_class — TEXT DEFAULT 'pending' — 'sharp'/'good'/'square'/'fade'/'pending', computed by lib/clv-engine.js classify()
wallet_scores.clv_avg_cents — NUMERIC — average closing-line-value in cents, lib/clv-engine.js
wallet_scores.clv_sample_size — INTEGER
wallet_scores.clv_computed_at — TIMESTAMPTZ — written but never read/displayed anywhere (checked)
```

### `realized_trades` — the core per-trade ledger backing computeTraderCard()
```
realized_trades.id — BIGSERIAL PK
realized_trades.user_id — UUID — ⚠️ type mismatch vs users.id (TEXT); queries cast ::text
realized_trades.polymarket_address / condition_id / token_id / market_question / side
realized_trades.shares / entry_price / exit_price / entry_cost_usd / exit_value_usd
realized_trades.realized_pnl / realized_roi
realized_trades.opened_at / closed_at
realized_trades.close_reason — 'sold-profit'/'sold-loss'/'redeemed-win'/'redeemed-loss'
realized_trades.market_durability — 'durable'/'ephemeral' — THE leaderboard-eligibility gate column (CLAUDE.md Gate 1)
realized_trades.regraded_at — one-time correction-pass tracking column
```
Related: `realized_trades_quarantine` (snapshot of purged fabricated rows, reversible), `market_settlement_cache` (flagged in CLAUDE.md as previously poisoned/purged), `market_resolutions` (newer trusted permanent archive: condition_id, question, winner_name, winner_index, winner_price, outcome_prices, gamma_closed, source).

### `cached_positions` — ⚠️ SCHEMA DRIFT, 3 conflicting `CREATE TABLE IF NOT EXISTS` definitions found (server.js boot code vs root `.sql` vs `public/*.sql`), different id/user_id types (TEXT vs UUID) and different column names (`size` vs `shares`). Live shape unknown without a DB check — do not design assuming a specific shape until verified.

### `sports_flex_scores` — ⚠️ SCHEMA DRIFT, 2 conflicting definitions. Downstream query usage (server.js:23108, 24066-24091) strongly implies the migration-file shape is live:
```
sports_flex_scores.user_id — TEXT PK
sports_flex_scores.score — INTEGER — nullable when below threshold gate
sports_flex_scores.pnl_component / volume_component / consistency_component / clv_component / diversity_component — NUMERIC(5,2) each
sports_flex_scores.settled_bets / total_staked_units / net_units / active_days / distinct_sports / distinct_bet_types
sports_flex_scores.avg_clv_cents
sports_flex_scores.qualifies — BOOLEAN — public-ranking gate
sports_flex_scores.computed_at
```

### `polymarket_trades` — CLOB order-derived trade log (distinct from realized_trades)
```
polymarket_trades.eoa_address / proxy_address / market_slug / condition_id / token_id / side
polymarket_trades.trade_mode / order_type / entry_price / entry_price_cents / amount_usd / shares
polymarket_trades.status — 'open' etc / exit_price / exit_amount_usd / pnl / pnl_percent / closed_at / close_reason
polymarket_trades.clv_cents / clv_computed_at — ⚠️ SUSPECT NOT APPLIED. Only added via a standalone migration file, not boot-time DDL; server.js code explicitly handles "column does not exist" as an expected case — meaning even the codebase isn't sure this migration ran in prod. Check live before using.
```

### `flex_wallet_balance` / `flex_wallet_ledger` — the NEW wallet-native play-money system (2026-07-26), keyed by address, NOT user_id — this is what a /connect wallet-only user (no login) can actually hold a balance in
```
flex_wallet_balance.address — TEXT PK (lowercase EOA)
flex_wallet_balance.balance_centpoints — BIGINT
flex_wallet_ledger.delta_centpoints / reason / ref_id / created_at
```
Per CLAUDE.md: hard no-cashout, no-purchase rule on this system. Distinct from the retired `flex_points`/`flex_points_log` (below).

### `flex_points` / `flex_points_log` — SUSPECT DEAD per product direction (not code-dead, but CLAUDE.md Voice & Posture §8 explicitly retires this earn/accumulate/spend framing in favor of the single bounded FLEX Score rating). Do not surface on redesigned profile.
```
flex_points.user_id PK, total_points, trade_count, last_earned_at
flex_points_log.user_id, points, source, trade_amount_usd, created_at
```

### `predictions` — separate table from `takes`, still actively queried (14 refs)
```
predictions.user_id / platform / market_id / market_title / posted_at / direction
predictions.entry_price / position_size_usd / size_display / conviction / thesis_text / category_tags
predictions.resolved_at / outcome / brier_contribution / pnl_usd / cascade_ids
```

### Social graph — ⚠️ TWO parallel follow tables found: `predictor_follows` (follower_id/following_id) and `follows` (follower_id/following_id/followed_at/follow_reason). Confirm which is canonical before building follow counts into the redesign — do not assume they're kept in sync.

### `watchlist` — user_id (UUID, same drift pattern), market_slug, alert_above/below, last_alerted_at. Low relevance to profile redesign (price-alert scratch state, not a score/position record).

**SUSPECT DEAD/UNPOPULATED FLAGS (section 5, consolidated):**
- `users.username` vs `users.handle` — verify which is canonical for `/@handle`
- `users.tipster_handle` — dead feature
- `users.kalshi_api_key`, `kalshi_username`, `manifold_username` — legacy, not promoted in UI
- `flex_points` / `flex_points_log` — retired currency model, don't design around it
- `wallet_scores.clv_computed_at` — written, never read anywhere
- `polymarket_trades.clv_cents` / `clv_computed_at` — migration may not have run in prod
- `sports_flex_scores` boot-time minimal shape (`sport`, `flex_score`, `sample_size`, `win_rate`, `roi`) — very likely dead vs the full per-user shape
- `cached_positions` — do not trust any specific column shape until live-verified (3-way drift)

---

## 2. ENGINE OUTPUTS PER WALLET (lib/*.js)

Only **`lib/clv-engine.js`** genuinely computes/persists a wallet-keyed score. The other five engines are market-level or signal-level — they don't take a wallet address as primary key and don't write to a wallet-keyed row.

```
clv-engine.js computeAll() → wallet_scores.user_id/clv_avg_cents/clv_sample_size/wallet_class/clv_computed_at — see table above, this IS the persistence layer for wallet_scores' CLV fields
clv-engine.js classify(avgClvCents, sampleSize) — pure function, 5-value enum: sharp/good/square/fade/pending
clv-engine.js getWalletClass(userId) — single-wallet read of wallet_scores row — backs /api/clv/wallet/:userId → member.html
clv-engine.js getTopSharp(limit) / getTopFade(limit) / getSummary() — ranked/aggregate reads — endpoints exist (/api/clv/sharp, /api/clv/fade, /api/clv/summary) but NO FRONTEND CALLER FOUND anywhere in public/*.html — confirm with Marc before assuming this is reachable UI data

edge-engine.js — MARKET-level, not wallet-level. getSharpConsensus/getAccumulationAlerts/getResolutionBias/getBiasEdgeMarkets. Only getAccumulationAlerts() rows carry a per-wallet field (`wallet`, `clv_avg_cents`, `wallet_class` foreign-read) but the entire function's output is apparently unused downstream (computed inside /api/edge/all but never read by the frontend handler for that response).

inference-engine.js — Claude-Haiku "correlated market" suggester. Takes a wallet's trade as an input signal (side/question/clv) but OUTPUTS market suggestions, not wallet data. Not wallet-descriptive.

signal-ledger.js — writes to signal_history keyed loosely by `source_wallet` (mostly a literal string like 'bias_engine', not real wallet addresses in most rows). getSummary()/getRecent() are platform-wide aggregates pooling ALL wallets, not single-wallet lookups.

bias-caller.js — zero wallet identity. source_wallet is a hardcoded literal 'bias_engine'. Pure market-price-bucket historical-rate engine.

edge-grade.js — zero wallet awareness. Grades MARKETS only (is_edge_pick, grade A/B/C, confidence, reward_ratio). Never takes a wallet/user id as input.
```

**Bottom line: engines contribute exactly 4 wallet-level fields not already covered by API endpoints below** — `wallet_scores.sharpness_score`, `.realized_pnl_usd`, `.total_volume_usd`, `.take_accuracy`, `.resolved_takes`, `.closed_positions` (written by an uninventoried third subsystem at ~server.js:3797, readable for free via clv-engine's read functions) — worth knowing these exist on the same row as CLV even though clv-engine.js itself doesn't write them.

---

## 3. API ENDPOINTS — response shapes (field names, from actual `res.json()` literals)

### The canonical profile endpoint — backs `/@handle`
**`GET /api/user/profile/:handle`** (server.js:31378, public) — via `computeTraderCard()`
```
id, handle, display_name, avatar_url, banner_url, bio, wallet_verified
flex_score, flex_tier, flex_qualifies, flex_c_accuracy, flex_c_pnl, flex_c_calibration, flex_c_consistency, flex_c_breadth
follower_count, following_count, predictions_resolved, prediction_win_rate, polymarket_address
wallet_class, clv_avg_cents, clv_sample_size, realized_pnl_usd, total_volume_usd, sharpness_score   (from wallet_scores join)
takes[] — id, question, side, entry_price, thesis, agree_count, disagree_count, is_correct, created_at, market_slug (last 25)
trade_bio — auto-generated one-line bio
card{} (null if <1 resolved trade):
  n, wins, losses, win_rate_pct, realized_roi_pct, realized_pnl_usd, total_staked_usd
  avg_hold_days, avg_hold_known_n, avg_size_usd
  categories[] (top-3 by trade count)
  roi_series[] — {t, roi_pct} cumulative ROI over time, chart-ready
  resolutions[] — {question, side, outcome(win/loss/push), staked_usd, entry_price, exit_price, pnl_usd, held_days, durable}
  risk_profile{} (null if n<5, from computeTraderRiskProfile):
    n, style (plain-English sentence)
    resolution_style{sold_early_pct, held_to_resolution_pct, sold_count, resolved_count}
    concentration{top_trade_pct, top3_pct}
    capital_deployed_usd, avg_hold_days
    flags[] — {key, severity, label, detail} (integrity/anti-farming disclosures get appended here server-side too)
durable_verified — bool, is this wallet on the current durable board
durable_scope_label — string|null, e.g. "Ranked on durable markets — n=X"
```

### The RICHEST single-wallet payload — used by /connect, arguably the better base for a redesign
**`GET /api/trader-record/:handle`** (server.js:14192, public) — via `_buildTraderProfile()`, which internally calls the same trader-card builder as `/api/trader-cards`
```
user_id, display_name, username, polymarket_address, whale_rank, eligible, eligibility_note
verdict, score_pct, raw_weighted_roi_pct, n, trend
evidence{question, side, entry_price, exit_price, result, roi_pct, multiplier, pnl_usd, days_ago}
form[] (last 8 results as 1/0/0.5), streak{type, count}
specialty{best, worst}, scope_label
provisional{} (sub-threshold wallets only) — score_pct, raw_weighted_roi_pct, win_rate_pct, n, trend, label
headline{realized_roi_pct, win_rate_pct, n, total_capital_usd, avg_return_pct}
best_call / worst_call — {question, side, entry_price, exit_price, pnl, roi, closed_at, result}
specialty_full[] — {category, n, win_rate_pct, avg_roi_pct, small_sample}
trade_history[] (up to 500) — {question, side, entry_price, exit_price, entry_cost_usd, realized_pnl, realized_roi_pct, result, closed_at, close_reason, category, market_durability}
trade_history_total, ephemeral_excluded_count, ephemeral_excluded_note
open_positions[] — {question, side, probability, topic}, open_positions_count
void_note — methodology disclosure string
```

### Positions
**`GET /api/polymarket/positions/:address`** (server.js:35709, public)
```
positions[] — id, token_id, condition_id, question, side, shares, current_price, cash_value, cost_basis, pnl, pnl_pct, market_url, icon, end_date, redeemable, redeemed, settled, platform
totals{total_positions, open_positions, settled_positions, wins, losses, total_volume_usd, realized_pnl, unrealized_pnl, activity_trade_count, activity_unique_markets, activity_total_volume, total_volume_usd_src}
address, fetched_at
```
**`GET /api/polymarket/positions/:address/enriched`** (server.js:36041, public, creator-dashboard only) — same + per-position `avg_cost` and `whale{count, capital, consensus_side, consensus_pct, aligned, edge}`

### Verification / receipts
**`GET /api/verify-record/:handle`** (server.js:66076, public)
```
handle, address, status(verified/partial/failed), summary, checked_at
on_chain{trades_in_our_record, markets_in_our_record, trades_counting_toward_score, on_chain_trade_events_examined, trades_with_no_matching_on_chain_activity, pnl_direction_disagreements, coverage_complete, unconfirmed_trades[]{reason, condition_id, our_pnl_usd, onchain_net_usd}}
resolutions{held_to_resolution_rows, outcomes_confirmed, outcomes_unconfirmable, graded_on_unresolved_markets, graded_against_actual_outcome}
how_to_read — methodology string
```

### Similar traders
**`GET /api/similar-traders/:handle`** (server.js:14178, public)
```
your_categories{category → {n, roi_pct}}
matches[] — user_id, display_name, username, polymarket_address, similarity_pct, shared_categories[], their_score_pct, your_score_pct, edge_pct, headline_category, headline{category, your_roi_pct, your_n, their_roi_pct, their_n}, confidence(strong/moderate/thin), confidence_n, scope_label
candidate_pool
```

### Flex Wallet (play-money, unrelated to trading score)
**`GET /api/flex/balance?address=`** (server.js:14336, public) — `address, balance_centpoints, balance_fp, exists`

### Trader-card / leaderboard family
**`GET /api/trader-cards?user_id=`** (server.js:13479, public, single-wallet filter supported) — one card per row: `user_id, display_name, username, polymarket_address, whale_rank, n, score_pct, raw_weighted_roi_pct, flex_score, total_capital_usd, trend, verdict, evidence{...}, form[], streak{...}, specialty{...}, win_rate_pct, sold_early_pct, style_flag{key,text}|null, scope_label`

**`GET /api/kings`** (server.js:13518, public, drives live homepage) — `overall[]` (trader-card shape), `categories[]{category, label, qualifying_count, card{...}}`

**`GET /api/predictors/leaderboard?mode=roi|flex|whale`** (server.js:12872, public) — per-mode field set, includes `calibration_score`, `whale_score` in flex/whale modes not seen elsewhere

### Legacy/fallback profiles
**`GET /api/trader/:wallet`** (server.js:12121, public) — `profile{wallet,display_name,bio,twitter_handle,verified_sharp}`, `clv{classification,avg_clv,sample_size}`, `flex_score`, `stats{total_theses,hit,partial,miss,hit_rate,open}`, `theses{resolved[],open[]}`

**`GET /api/trader/:address/profile`** (server.js:12213, public) — cross-venue, live-fetches Polymarket + Hyperliquid directly. `polymarket{...}`, `hyperliquid{active, open_positions[]{coin,side,size,entry_price,position_value,unrealized_pnl,roi_pct,liquidation_price,margin_used}, account_value, total_notional, ...}`, `summary{total_pnl, open_positions_count, platforms_active}` — **the only place Hyperliquid per-wallet data surfaces today**, worth knowing even though Gate 2 says Hyperliquid isn't an active workstream — this is live data already flowing, not scoped work.

**`GET /api/member/:userId`** (server.js:18043, public, backs `/m/:userId` legacy fallback) — LARGEST single payload found. `user{...}`, `stats{total_predictions, settled_predictions, wins, win_rate, total_bet, total_won, streak, flex_score, flex_tier, ..., flex_points, followers, following}`, `take_stats{...}`, `recent_takes[]`, `communities[]`, `recent_wins[]`, `polymarket_stats{...}`, `recent_trades[]`

**`GET /api/predictors/:userId/analytics`** (server.js:17356, public) — `win_rate, total_pnl, sharp_score, platforms{hyperflex,polymarket,kalshi,manifold}{wins,losses,total,pnl}, calibration[9 buckets]{label,predicted,correct,total,actual}, timeline[30d]{date,pnl}` — **calibration chart data exists and isn't used anywhere in profile-trader.html.**

**`GET /api/sports-predictors/:userId`** (server.js:24774, public) — full `sports_flex_scores` row (see section 1)

**`GET /api/whale-profile/:name`** (server.js:39114, public) — `name, rank, trader_pnl, style, stats{...}, categories{cat:{count,capital}}, positions[]{...}, history[]{action,question,side,size,old_size,new_size,price,...,timestamp}` — **position-change history over time isn't surfaced on the regular trader profile at all**, only on whale-specific pages.

### Dead/duplicate endpoints found in passing (cleanup candidates, not data sources to design around)
```
GET /api/trader-profile/:username — dead, only referenced from api-docs.html
GET /api/whales/:address/portfolio — dead
GET /api/user/:userId/social-profile — dead, returns predictions:[] unconditionally (source table dropped 2026-04)
GET /api/profile/:username/stats — dead
GET /api/tipster/:handle — dead
GET /api/predictions/user/:userId — registered twice (27189 live, 70499 dead/shadowed)
GET /api/clv/wallet/:userId — registered twice (38896 live, 41638 dead/shadowed)
GET /api/whale-profile/:param — registered twice (39114 live, 54153 dead/shadowed — different param name, same path pattern, Express matches first)
```

---

## 4. profile-trader.html — fetched vs. rendered (THE GAP)

Page fires 3 requests: `/api/user/profile/:handle`, `/api/verify-record/:handle`, `/api/polymarket/positions/:address`.

**Fetched but NOT rendered anywhere:**
```
d.durable_scope_label — ⚠️ HIGHEST-PRIORITY GAP. CLAUDE.md explicitly mandates "every score-bearing surface carries scope_label ... alongside score+n" — this field is computed server-side specifically to satisfy that rule and the hero FLEX score renders with ZERO scope context today. Direct violation of a stated product rule, not just an omission.
d.takes[] — a full 25-take feed is computed server-side (comment in server.js literally says "no /api/takes?user_id= route exists" implying this was built to compensate) and completely unused client-side, not even read into a JS variable.
d.polymarket_address — fetched, used only as a param to trigger loadOpenPositions, never shown as text
d.durable_verified — used only as a boolean gate for the Copy button, never shown as text
d.id — used only inside the copy-trade link's query param, never shown as text
v.markets_in_our_record, v.on_chain_trade_events_examined, v.pnl_direction_disagreements, v.coverage_complete, v.held_to_resolution_rows, v.outcomes_confirmed, v.outcomes_unconfirmable, v.graded_against_actual_outcome, v.how_to_read, v.checked_at — the verify-record endpoint computes a full audit-trail object (explicit code comment: "for anyone who wants to check the disagreement themselves") and the page only links out to the raw JSON instead of surfacing any of it inline
p.totals{} (the whole pre-aggregated object from /api/polymarket/positions) — page ignores it and hand-rolls its own open-exposure aggregate client-side from raw positions[] instead — creates two independent, never-reconciled win/loss computations (EP1's realized_trades-based ledger vs EP3's Polymarket-/positions-based totals)
p.icon — market thumbnail URL supplied by the API; open-position rows are text-only, no image
p.shares, p.condition_id, p.token_id, p.redeemable, p.redeemed, p.platform — per-position, never rendered
```

**Rendered today (confirms what's currently live):** handle/display_name (header), flex_score (hero number, no context), trade_bio, wallet_class + clv_sample_size, clv_avg_cents (as letter grade), win_rate_pct/n, realized_roi_pct/total_staked_usd, avg_hold_days/avg_hold_known_n/avg_size_usd, categories, roi_series (chart), risk_profile.style + resolution_style bar + flags, resolutions[] (ledger rows), verify-record status badge + 3 summary numbers, open positions (side/question/cost_basis/pnl/pnl_pct/current_price/end_date, gated Copy button).

**Available from OTHER endpoints, not fetched by this page at all:**
```
/api/trader-record/:handle — provisional{} scoring for sub-threshold wallets, specialty{best,worst} + specialty_full[] (per-category breakdown), best_call/worst_call, ephemeral_excluded_count/note
/api/similar-traders/:handle — "traders like you but better" comparison, entirely unused on the canonical profile
/api/predictors/:userId/analytics — calibration[9 buckets] + timeline[30d] chart data, entirely unused
/api/trader/:address/profile — Hyperliquid cross-venue positions (account_value, unrealized_pnl, margin_used, recent_fills), entirely unused
/api/whale-profile/:name — position-change history[] over time (accumulate/reduce/exit events), entirely unused
wallet_scores.sharpness_score / take_accuracy / resolved_takes / closed_positions — sit unused on the same row as clv_avg_cents
```

---

## 5. Cross-cutting notes for the redesign

1. **Three separate endpoints independently compute a wallet's card/score today**: `/api/user/profile/:handle` (via `computeTraderCard`), `/api/trader-cards`/`/api/kings` (via `_buildTraderCards`), `/api/trader-record/:handle` (via `_buildTraderProfile`, which itself wraps `_buildTraderCards`). `_buildTraderProfile` is the superset — full trade history, open positions, provisional scoring, specialty breakdown. A redesign converging on `/api/trader-record/:handle` as the single source (vs. profile-trader.html's current 3-request pattern) would both close several of the gaps above and reduce round-trips.
2. The actual trader score/verdict shown today is **computed live from `realized_trades` per request**, not read from any of the `users.flex_score*` columns — don't design the DB-column section as if those are the source of truth for the profile; they're a parallel FLEX leaderboard subsystem.
3. `cached_positions` and `sports_flex_scores` both have live schema drift (2-3 conflicting `CREATE TABLE IF NOT EXISTS` definitions) — don't build UI copy assuming specific column names from either until verified live.
4. Hyperliquid per-wallet data (`/api/trader/:address/profile`) is already flowing live today despite Gate 2 saying Hyperliquid integration is "documented, not active" — that gate is about the second GRADING engine (scoring perps trades), not about this read-only position display, but flag it before using it prominently in case Marc wants it kept out of view for Gate 2 reasons.
