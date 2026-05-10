# SESSION_STATE.md

> **Read at session start. Append a new entry at session end.** Both Claude instances (strategy-Claude and Code) read this before doing anything; whichever Claude is active appends a fresh entry when work concludes. Marc is the kicker-off and the picker-of-next-item, not the per-message relay.

## How to use this

**At session start** (every Claude, every time):
1. Read the most recent 1-3 entries below.
2. If there are open blockers or queued items, surface them in the first response so Marc doesn't have to re-explain.
3. If anything in the most recent entry contradicts what Marc just asked for, ask once before assuming the entry is stale.

**At session end** (the active Claude appends):
1. Add a new entry at the **top** of the chronological log (newest first).
2. Use the entry template below — fixed sections, short bullets, no paragraphs.
3. PR numbers + commit hashes are required for "shipped" claims (per CLAUDE.md rule: no shipped without a verifiable hash).
4. If a queued item is now done, remove it from the queue, don't just strike through it.
5. If something is broken or unverified, name it explicitly in **Active blockers** — silent omission breaks the contract.

**Pruning** — entries older than 14 days that aren't active blockers can be removed. Git history preserves them. Keep the file under ~300 lines so the read-at-start cost stays low.

**Format discipline** — short bullets, not prose. If an entry needs a paragraph of context, that context belongs in CHANGELOG.md or a CLAUDE.md note. SESSION_STATE.md is for the handoff signal only.

---

## Entry template

```markdown
## YYYY-MM-DD (session label)

**Shipped (with hashes):**
- PR #N: title (squash hash `abcd123`)
- ...

**Active blockers:**
- (none)  ← or list explicitly

**Queued (priority order):**
1. Item — pre-work / dependency
2. ...

**Open questions / unverified:**
- ...

**Notes for next session:**
- One-line concrete actions only. No "consider doing X."
```

---

## Chronological log (newest first)

## 2026-05-10 (pool hotfix + homepage scale + rolling banner + flex instrumentation)

**Shipped (with hashes):**
- PR #98: db pool max 5→25, idle 30s, connect 5s — production triage under +133% traffic (squash `26ee7ab`)
- PR #101: homepage desktop scale-up — body font 15→18, layout max-width 1440→1600, mobile `<768px` reverts (squash `8fd07b4`)

**Open PRs (not yet merged):**
- PR #100: `_fetchFlexStats` + `recomputeFlexScore` + `/api/admin/flex/rebuild` instrumentation — three-tier UPDATE fallback (full → existing-schema → minimal `flex_computed_at` stamp), diag captures all intermediate counts + previously-swallowed `.catch` errors, response surfaces diag for one-curl diagnosis (commit `be571e3`). **Awaiting merge + Marc's curl on LaBradford + diag paste → cuts surgical follow-up.**
- PR #102: rolling hero banner v1 — `lib/hero-banner.js` (selection + cache + resolution-check), `GET /api/hero-banner`, `POST /api/admin/hero-banner/refresh`, 1-min cron for cache bust on resolution, `public/hero-banner.js` dual-mode (imminent ≤7d / anchor >7d), script-tag swap in `feed.html` + `explore.html` (commit `2a0a25f`). Replaces dead UFC 328 banner (KILL_AT passed 03:00 UTC today).

**Active blockers:**
- **PR #100 merge + diag** — bottleneck for the surgical FLEX fix
- **Canonical-scoring decision (A/B/C below)** — gates dog-card-v1 implementation

**Queued (priority order):**
1. **Surgical FLEX fix** — based on PR #100 diag, expected to be a small targeted PR (dedup gate removal, schema column addition, or query path correction). Diag triplet `(rt_rows_returned, rt_dedup_keyset_size, rt_contributed.rtCount)` identifies which.
2. **Canonical-scoring decision** (see "Decision items" below) — Marc's call. No code change until locked.
3. **dog-card-v1** — DEFERRED from prior queue position #5 to "post-canonical-decision." Spec is complete and locked except the sharps_query column reference + qualification gate (see Decision items #2 below).
4. (Inherited from 2026-05-09 entry) Passport ↔ main profile reconciliation, messaging-v1 UI, etc.

**Decision items (for Marc, no action until ready):**

### Decision #1 — Canonical scoring system

HYPERFLEX has two parallel scoring systems writing to two columns:

- `flex_score` (calibration: picks + polymarket_trades + realized_trades UNION, Brier-weighted, `/api/admin/flex/rebuild` + 04:30 cron, formula in `lib/flex-score.js`)
- `flex_score_90d` (heuristic: PnL/vol/wr/rank from Polymarket leaderboard sweep, `ensureWhaleProfile()` every ~5min, formula at `server.js:17651` `computePolymarketFlexScore`)

Both read by different surfaces (profile hero gate reads `flex_score`; Top Predictors rail reads `flex_score_90d`). Same brand label "FLEX SCORE" exposed in UI for both. Documented as deferred in PR #96 commit; surfaced again 2026-05-10 on LaBradford profile (`flex_score=NULL`, `flex_score_90d=65`, profile gate locked while Top Predictors rail ranks him #2).

Three options, **Marc's call, not tonight:**

- **Option A — `flex_score` canonical (calibration wins).** Profile hero, Top Predictors, leaderboards, dog-card sharps lineup all read `flex_score`. `flex_score_90d` either deprecated or kept as internal-only heuristic for cold-start. Most whale-imported users show "Building" until they accumulate 25+ settled events through `realized_trades`. Leaderboard goes thin until the `realized_trades` backfill matures. Brand-promise honored: every visible score is demonstrated ROI, not flow-derived heuristic.
- **Option B — `flex_score_90d` canonical (heuristic wins).** Profile hero, Top Predictors all read `flex_score_90d`. `flex_score` becomes a hidden internal calibration column or gets dropped. Leaderboard stays populated, FLEX brand label persists everywhere, but the score no longer means "demonstrated ROI through settled predictions" — it's a leaderboard-derived heuristic. Loses the FLEX brand purity.
- **Option C — Two distinct labels (split the concepts).** "FLEX SCORE" reads `flex_score` (calibration). New label like "WHALE SCORE" or "FLOW SCORE" reads `flex_score_90d` (heuristic). Two scores on profile, two leaderboards, no overlap. User sees both without confusion. More UI work, but no fragmentation.

Do NOT unify columns or change reads/writes until Marc explicitly green-lights one of A/B/C. For tonight: surgical FLEX fix from PR #100 diag → just makes the `flex_score` path persist. Doesn't pick a canonical system.

### Decision #2 — dog-card-v1 sharps-query column reference

Dog-card spec references `flex_qualifies` + `flex_score` for the sharps lineup ranking. Hard dependency on Decision #1:

- **If A (flex_score canonical):** ship spec as drafted. Empty-state CTA dominates V1 until `flex_score` is backfilled for whale-imported users via `realized_trades`. V2 realized_trades fallback for sharps lineup is more urgent than the original spec implies.
- **If B (flex_score_90d canonical):** rename `flex_score` → `flex_score_90d` in the sharps query and **drop the `flex_qualifies = true` filter** — `flex_score_90d` has no qualifies gate (Building gate is a `flex_score`-system concept tied to `lib/flex-score.js`'s 25-settled threshold). Sharps lineup populates immediately for ~hundreds of whales.
- **If C (two labels):** explicit choice required — likely the heuristic surface (`flex_score_90d`) for richer data, but to be locked at decision time.

Hold dog-card-v1 implementation until Decision #1 lands. Spec is otherwise complete; only the sharps-query column reference + qualification gate changes.

**Open questions / unverified:**
- **Actual cause of LaBradford `flex_settled_events=0`** — `close_reason` filter ruled out (doesn't exist in code, verified twice). Ranked hypotheses, all answerable from PR #100 diag in one curl:
  1. Dedup wipes everything — polymarket_trades has rows with `(condition_id, side)` collisions against realized_trades. Signature: `rt_rows_returned: 747, rt_dedup_keyset_size: >0, rt_contributed.rtSkippedDedup: 747, rt_contributed.rtCount: 0`. **Highest likelihood.**
  2. Wallet lookup at `server.js:19240` returns polymarket_address populated despite whale-import; polymarket_trades count query then matches on the proxy. Signature: `wallet_addr_present: true, poly_stats_after_pt.has_trades: >0`.
  3. Silent error in realized_trades query (transient pool-exhaustion pre-PR #98). Signature: `rt_rows_returned: 0, errors[]` contains `{stage:'rt_query',...}`. Lower likelihood now that pool was bumped, and PR #100's instrumented `.catch` writes to `errors[]` instead of swallowing.
  4. Schema drift — `flex_c_consistency` or another column missing → UPDATE throws → previously caught silently. Signature: `update.stage: 'fallback_existing'` or `'minimal_stamp'` with `errors[]` containing `{stage:'full_update',...}`. PR #100's Tier 2/3 fallback surfaces it directly.

**Notes for next session:**
- **First action:** if PR #100 still unmerged, eyeball + merge it. Then curl `/api/admin/flex/rebuild` on LaBradford and paste the `diag` object — that drives the next surgical PR.
- **Second action:** verify PR #102 banner on `/feed` and `/` — confirm dual-mode rendering works against whatever the current top-scored event is. If something off-brand surfaces, `HERO_BANNER_BLACKLIST=<slug>` env var + `POST /api/admin/hero-banner/refresh` clears it without a code deploy.
- **Third action:** when Marc green-lights Decision #1, update this entry's queue + unblock dog-card-v1.

**Process notes / lessons committed (don't re-learn these):**
- "Filter exists, drop it" diagnoses get verified against the actual current code (`git show <pr-commit>`) before drafting a fix. PR #100 was almost shipped as a no-op `close_reason` filter drop based on a wrong premise; refused, instrumented instead.
- File-isolation scoping is a valid alternative to selector-scoping when CSS lives inline in a single HTML file. PR #101 didn't need a `.home` class because `feed.html`'s `<style>` block can't bleed into other pages — they don't load it.
- Speculative retries / mutations on write paths are forbidden (already in CLAUDE.md #14). PR #100's three-tier UPDATE fallback is the *correct* shape: each tier is structurally distinct, errors surface to `errors[]`, no silent state mutation. Speculative *retries that change parameters* are the anti-pattern; *fallbacks that degrade gracefully* are fine.
- One-min crons that look heavy are fine when they're guarded — PR #102's `checkCachedEventResolved` is a no-op on cold cache and does one gamma-cached fetch on warm cache. The lightweight signature was important enough to surface in the PR body up front.

---

## 2026-05-09 (recovery + messaging-v1 schema)

**Shipped (with hashes):**
- PR #91: takes hotfix — drop broken `cs.avatar_url` SELECT (squash `951d292`)
- PR #92: redeem-grader URL-filter classifier (squash `e2390c2`) — **shipped with structurally broken logic, see PR #93**
- PR #93: redeem grader — `cashPnl` truth signal + paginate the fetch (squash `8b85c9c`)
- PR #94: messaging-v1 schema + 5 endpoints + tests, no UI (commit `0fc851c`, **awaiting merge**)

**Active blockers:**
- (none)

**Queued (priority order):**
1. **Passport ↔ main profile reconciliation** — pre-work: 3-5 whale divergence query (sample LaBradford + 4 others, capture passport vs main-profile values per field, check whether deltas are consistent or random). If consistent: factor `lib/profile-stats.js` shared aggregator, both endpoints import. **Collapses Finding 1 (FLEX Score "Building" gate) into the same fix** — gate threshold is correct by design (formula needs settled signal); bug is `settled_predictions` reads from `polymarket_trades` (empty for whale-imported users) instead of `realized_trades`.
2. **messaging-v1 UI** — `/messages` dashboard tab, `<ConversationList>` + `<MessageThread>` components, nav badge with unread count, Message button on profile pages in the slot Copy Link will vacate.
3. **Drop Copy Link from profile action row** — single-line removal, bundle with #2.
4. **Operational + side log triage** (none blocking, all filed):
   - `[data-engine] (raw || []).map is not a function` on every refresh — gamma envelope unwrap regression, single-callsite hunt
   - `dbQuery connect timeout` cascading across crons — pool exhaustion or one cron starving others
   - `column "video_url" does not exist` — migration #59 not applied to Railway
   - `mention_events_dominant_stance_check` constraint violation — clusterer producing `'deescalatory'` outside enum
   - `[intelligence] Platform: 0.4% accuracy` log line — separate from `realized_trades`, separate diagnosis when prioritized
5. **`users.username` NULL backfill** — affects display name fallback chain on takes + profile rendering.
6. **`polymarket_proxy` vs `polymarket_address` semantics doc** — CLAUDE.md addition; both columns hold the same value (proxy) for whale-imported users; semantics drift across new vs legacy code paths.

**Open questions / unverified:**
- **Will the 3 AM cron `computeWalletScores` heal LaBradford's `wallet_scores` row?** Destructive UPDATE earlier in session (NOT from any session-Claude) corrupted `sharpness_score: 63 → 0.0786`, `realized_pnl_usd: +$87,397 → -$3,461,027`, `closed_positions: 0 → 623`. The cron rewrites from `polymarket_trades` + `whale_pnl`, not `realized_trades`, so should restore. **Morning check (one-line SQL):**
  ```sql
  SELECT u.id, u.whale_pnl, ws.realized_pnl_usd, ws.computed_at,
         (ws.realized_pnl_usd - u.whale_pnl) AS delta
    FROM users u LEFT JOIN wallet_scores ws ON ws.user_id = u.id
   WHERE u.id = '7dc1a4b0-1966-4777-85fa-3b0ac3761e3a';
  ```
  - If `delta = 0`: cron healed it, prior gap was staleness. Question closed.
  - If `delta ≠ 0`: there's a transformation in `_scoreWallet`'s P&L picker (server.js:3581-3583, the `Math.abs(tradePnl) >= 1 ? tradePnl : whalePnl` branch). Trace and file.
- **Did anyone actually run the regrade curl post-merge of PR #93?** Unknown. If yes, paste response (`regraded`/`fetched` counts + `sample` payload). If `regraded > fetched` flagged earlier — halt before sweep, run dedupe diagnostic on `external_sync_id`.
- **Does the `[intelligence] Platform: 0.4% accuracy` aggregator read from `realized_trades`?** Unverified. Pre-work for queue item: `grep -n "0.4% accuracy\|resolved signals\|Platform: " server.js lib/`. If the JOIN graph touches `realized_trades`, expect partial (not full) movement after PR #93 + sweep land. Verify-then-claim, not the other way.

**Notes for next session:**
- First action: run the morning `wallet_scores` vs `whale_pnl` SQL above. Two-second answer to a question that's been hanging.
- Second action: PR #94 merge if not already done, then trigger Railway deploy verification (boot logs should show `[boot] Auto-migration complete` with no new errors).
- Third action: pick up queue item 1 (Passport reconciliation) starting with the 5-whale divergence query — single-source-of-truth fix collapses two findings.

**Process notes / lessons committed (don't re-learn these):**
- API-shape claim → curl/query producing the response on-screen first, code second. PR #92 was shipped on a hypothesized URL-filter behavior that one curl would have falsified in 30 seconds. Three strikes this session.
- Tool counts (`regraded: N`, `fetched: M`) get a reconciliation question before "ship it" reading. `regraded: 890` was a warning sign (bigger than the loss-row count we expected to flip), not a success number.
- "The fix is correct under either hypothesis" only applies when the hypotheses are well-formed. When the hypothesis is "the API does X" and you haven't checked, the fix is correct under one branch and destructive under the other.
- Branch protection on `main`: every change goes through PR. Direct push to main returns a misleading 403/sideband-disconnect. Push to feature branch + open PR + use the GitHub MCP merge tool when ready.
- `users.id` is `TEXT` on Railway, not UUID. Foreign keys to `users(id)` use `TEXT`. Some legacy tables (e.g. `realized_trades.user_id`) declare UUID and need explicit `$1::uuid` casts in queries.
- Two source-of-truth tables for trader data: `polymarket_trades` (legacy, requires user wallet connect, empty for whale-imported leaderboard users) and `realized_trades` (new, populated by `backfillRealizedTrades` from Polymarket `/activity` + `/positions?redeemed=true`). Surfaces that read from only one undercount whale-imported users. The reconciliation queue item factors a shared aggregator that reads from both.
