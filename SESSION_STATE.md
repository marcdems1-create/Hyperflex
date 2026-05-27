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

## 2026-05-27 (retention build sprint — notifications, pushes, voice charter, nav bell)

**Shipped (with hashes):**
- `4c5c76a` — feat(feed): cold-start empty state, suggested predictors + inline follow
- `6627179` — feat: take_viral push on trending threshold (5/10/25 agrees)
- `ff5d827` — feat: take aged well — price movement notification
- `dd20eb5` — fix(explore): voice charter cleanup on leaderboard
- `90f5026` — fix(passport): voice charter — dry tweet copy, emoji out of share bar
- `ec0aa15` — fix(take): voice charter — emoji sweep
- `e2dee7a` — fix: voice charter batch — 4 pages
- `b17e269` — feat(admin): Mentions tab + 3 endpoints (mention-stats/drafts/publish)
- `85c0c73` — feat(retention): streak-at-risk push (20:00 UTC) + rival disagree copy
- `fe9728d` — feat(retention): tier upgrade push + nav toast coverage for all 8 types
- `875d6e7` — feat(retention): wrong-take resolution push ("Post a counter take") + full notification coverage
- `ebdaec2` — fix: final emoji sweep (explore/passport/member/alpha-live)
- `56f9bfd` — feat(nav): notification bell with unread badge + emoji cleanup in nav links
- `5642e0a` — feat: /notifications page + API ?limit/?unread params + nav bell → /notifications
- `ace6722` — feat(retention): today-at-stake morning push (08:00 UTC) — takes resolving today

All pushed to `claude/mention-pages-feature-sNd4n`.

**Active blockers:**
- (none)

**Queued (priority order):**
1. **Intelligence accuracy grading bug** — 21,866 signals at 0.4% is a grading bug. Separate workstream, investigate `scoreTakesForMarket` vs `wallet_scores` sharpness pipeline. Do NOT start without understanding root cause first.
2. **WHALE SCORE label split** (from 2026-05-10 entry) — still queued; Decision #1 locked.
3. **Surgical FLEX fix** (from 2026-05-10 entry) — still queued; needs LaBradford diag curl.
4. **Phase 2f mention compose bulk run** — admin UI now has "Run Compose" button hitting `/api/clusterer/compose`. Trigger from admin panel once 3 leaked secrets are rotated.
5. **3 leaked secrets pending rotation** (CLAUDE.md backlog — must do before Phase 2f bulk ingest).

**Open questions / unverified:**
- `today-at-stake` cron (ace6722) uses a JS-side slug filter from screener cache — if screener cache is cold at 08:00 UTC, zero fires. Monitor logs for `[today-at-stake]` after first UTC 08:00.
- Tier upgrade notification reads `prev_tier` before UPDATE — one extra DB read per FLEX recompute. Acceptable if recompute cron is not hitting 1000s of users per cycle; verify if load spikes.

**Notes for next session:**
- Branch `claude/mention-pages-feature-sNd4n` is 15 commits ahead of main. Needs a merge into main before Railway redeploys pick them up.
- The `_typeMap` in nav.js now covers: market_resolving, tier_upgrade, new_follower, take_viral, take_reaction, whale_alert, take_correct, take_incorrect, streak_warning, challenge_won, agent_signal. All notification types are toast-covered.
- `/notifications` page is live at `ace6722`. The mark-read-on-click UX updates the badge count in the nav immediately client-side.

---

## 2026-05-10 (pool hotfix + homepage scale + rolling banner + flex instrumentation)

**Shipped (with hashes):**
- PR #98: db pool max 5→25, idle 30s, connect 5s — production triage under +133% traffic (squash `26ee7ab`)
- PR #101: homepage desktop scale-up — body font 15→18, layout max-width 1440→1600, mobile `<768px` reverts (squash `8fd07b4`)
- PR #100: `_fetchFlexStats` + `recomputeFlexScore` + `/api/admin/flex/rebuild` instrumentation — three-tier UPDATE fallback (full → existing-schema → minimal `flex_computed_at` stamp), diag captures all intermediate counts + previously-swallowed `.catch` errors, response surfaces diag for one-curl diagnosis (squash `6a75543`)

**Open PRs (not yet merged):**
- PR #102: rolling hero banner v1 — `lib/hero-banner.js` (selection + cache + resolution-check), `GET /api/hero-banner`, `POST /api/admin/hero-banner/refresh`, 1-min cron for cache bust on resolution, `public/hero-banner.js` dual-mode (imminent ≤7d / anchor >7d), script-tag swap in `feed.html` + `explore.html` (commit `2a0a25f`). Replaces dead UFC 328 banner (KILL_AT passed 03:00 UTC today). Awaiting Marc's visual verify on `/feed` + `/` after Railway redeploys.
- PR #103: this entry — SESSION_STATE.md 2026-05-10 ledger + locked decision capture (commit `30ba19c` + follow-up locking Decision #1 to Option C).

**Active blockers:**
- **Marc's curl on `/api/admin/flex/rebuild` for LaBradford** → diag paste → drives surgical FLEX fix queue position #1.

**Queued (priority order):**
1. **Surgical FLEX fix** — based on PR #100 diag (pending curl). Expected small targeted PR. Diag triplet `(rt_rows_returned, rt_dedup_keyset_size, rt_contributed.rtCount)` identifies dedup-wipe vs query-path vs writer-side. Branch: TBD (`claude/flex-surgical-<cause>` once diag names it).
2. **WHALE SCORE label split** — claude/whale-score-label-split. Pure UI work, no data migration. See Decision #1 (LOCKED) below for full spec. Ships AFTER surgical FLEX fix so the FLEX SCORE side of the split has real numbers populating for whale-imported users.
3. **dog-card-v1** (UNBLOCKED) — UPDATED per Decision #2 (RESOLVED): parallel FLEX-sharps section (reads `flex_score`, `flex_qualifies=true` filter) + WHALES-on-side section (reads `flex_score_90d` top 3, no qualification gate). Two parallel lineups, distinct labels. Spec body needs an addendum but otherwise complete. Ships after WHALE SCORE label split lands so the UI surfaces it parallels exist.
4. (Inherited from 2026-05-09 entry) Passport ↔ main profile reconciliation, messaging-v1 UI, etc.

**Decision items:**

### Decision #1 — Canonical scoring system — **LOCKED 2026-05-10: Option C (semantic split)**

Marc confirmed "both" — two scores, two labels, no overlap. No column changes, no data migration. Pure UI + label work.

**FLEX SCORE** (`flex_score` column, calibration path):
- Brand framing: "Demonstrated ROI through settled predictions"
- Writer: `/api/admin/flex/rebuild` + 04:30 cron, formula `lib/flex-score.js`
- Surfaces: profile hero gate, FLEX leaderboard, dog-card sharps lineup
- Qualification: `flex_qualifies = true` (25-settled threshold remains)

**WHALE SCORE** (`flex_score_90d` column, heuristic path):
- Brand framing: "Capital-weighted Polymarket signal"
- Writer: `ensureWhaleProfile()` leaderboard sweep, formula `computePolymarketFlexScore` at server.js:17651
- Surfaces: Top Whales rail (relabel from "Top Predictors"), whale-flow surfaces, profile WHALE SCORE badge
- No qualification gate — heuristic populates for any user with whale data

**UI changes required (single PR — `claude/whale-score-label-split`):**
1. Top Predictors rail → rename to "Top Whales", read from `flex_score_90d`
2. Profile: keep existing "FLEX SCORE" hero card reading `flex_score` (the Building/locked badge today)
3. Profile: add new "WHALE SCORE" badge below FLEX, reading `flex_score_90d` (LaBradford's 65 surfaces here — profile no longer feels empty)
4. Leaderboards page: add FLEX leaderboard + WHALES leaderboard as separate tabs

Ship order: PR #100 instrumentation (DONE) → surgical FLEX fix → WHALE SCORE label split → dog-card V1 with parallel sections.

### Decision #2 — dog-card-v1 sharps-query — **RESOLVED 2026-05-10 (follows from Option C)**

Spec stays as written for the FLEX sharps lineup: `sharps_on_dog_side` reads `flex_score`, `flex_qualifies = true` filter remains. **Addition:** parallel "WHALES ON THIS SIDE" section below the FLEX sharps, reading `flex_score_90d` top 3 from users with a take on the dog side, no qualification filter. Two parallel lineups, distinct labels — same semantic pattern as the two scores. The dog-card spec body needs this addendum captured before implementation.

**Open questions / unverified:**
- **Actual cause of LaBradford `flex_settled_events=0`** — pending diag curl from PR #100. `close_reason` filter ruled out (doesn't exist in code, verified twice). Ranked hypotheses, each tied to its diag signature:
  1. **Dedup wipes everything** — polymarket_trades has rows with `(condition_id, side)` collisions against realized_trades. Signature: `rt_rows_returned: 747, rt_dedup_keyset_size: >0, rt_contributed.rtSkippedDedup: 747, rt_contributed.rtCount: 0`. **Highest likelihood.** If confirmed: surgical fix is dropping the `if (polyStats.has_trades > 0)` gate at `server.js:19294`, OR fixing the underlying `polymarket_trades` row population for whale-imported users (deeper cause).
  2. **Wallet lookup spurious-positive** — polymarket_address populated despite whale-import; polymarket_trades count query then matches on the proxy. Signature: `wallet_addr_present: true, poly_stats_after_pt.has_trades: >0`. Surgical fix: stricter wallet filter (e.g., require wallet_verified=true) or distinct `polymarket_proxy` vs `polymarket_address` semantics.
  3. **Silent error in realized_trades query** (transient pool-exhaustion pre-PR #98). Signature: `rt_rows_returned: 0, errors[]` contains `{stage:'rt_query',...}`. Lower likelihood now that pool was bumped, and PR #100's instrumented `.catch` writes to `errors[]` instead of swallowing. Surgical fix: probably none, just re-run rebuild.
  4. **Schema drift** — `flex_c_consistency` or another column missing → UPDATE throws → previously caught silently. Signature: `update.stage: 'fallback_existing'` or `'minimal_stamp'` with `errors[]` containing `{stage:'full_update',...}`. PR #100's Tier 2/3 fallback surfaces it directly. Surgical fix: add missing migration.

**Notes for next session:**
- **First action:** if Marc hasn't curled `/api/admin/flex/rebuild` for LaBradford yet, that's the gate. Once paste lands, the diag triplet names the surgical fix in one read.
- **Second action:** PR #102 verify on `/feed` + `/`. If something off-brand surfaces from the rolling banner, `HERO_BANNER_BLACKLIST=<slug>` env var + `POST /api/admin/hero-banner/refresh` clears it without a code deploy.
- **Third action:** queue position #2 (WHALE SCORE label split) is a clean, scoped UI PR. Spec is locked in Decision #1 — execute when surgical FLEX fix lands.
- **Fourth action:** dog-card V1 spec body needs the "WHALES ON THIS SIDE" parallel section added before implementation. The spec currently lives in this session's chat history; capture the addendum into a real spec file (e.g., `docs/specs/dog-card-v1.md`) when starting that ticket.

**Process notes / lessons committed (don't re-learn these):**
- "Filter exists, drop it" diagnoses get verified against the actual current code (`git show <pr-commit>`) before drafting a fix. PR #100 was almost shipped as a no-op `close_reason` filter drop based on a wrong premise; refused, instrumented instead.
- File-isolation scoping is a valid alternative to selector-scoping when CSS lives inline in a single HTML file. PR #101 didn't need a `.home` class because `feed.html`'s `<style>` block can't bleed into other pages — they don't load it.
- Speculative retries / mutations on write paths are forbidden (already in CLAUDE.md #14). PR #100's three-tier UPDATE fallback is the *correct* shape: each tier is structurally distinct, errors surface to `errors[]`, no silent state mutation. Speculative *retries that change parameters* are the anti-pattern; *fallbacks that degrade gracefully* are fine.
- One-min crons that look heavy are fine when they're guarded — PR #102's `checkCachedEventResolved` is a no-op on cold cache and does one gamma-cached fetch on warm cache. The lightweight signature was important enough to surface in the PR body up front.
- When two systems with the same brand label coexist, the resolution isn't always unification. Option C (split the labels) preserves both signals without forcing a value judgment between calibration and capital-flow, and avoids the "leaderboard goes thin" outcome that Option A would have produced post-FLEX-fix.

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
