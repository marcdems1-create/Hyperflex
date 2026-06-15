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

## 2026-06-15 (World Cup Live Odds Hub — flagship consumer surface)

**Shipped (with hashes, on `main`):**
- `97a50e4`: World Cup hub — `getWorldCupData()` (reads `_screenerCache` only), `GET /api/worldcup` + `/api/worldcup/match/:slug`, `/worldcup` + `/worldcup/:slug` pages with per-match OG injection, `public/worldcup.html` + `public/worldcup-match.html` (Bebas Neue hero numbers, flash-on-tick, 7d chart, whale flow, cached Haiku line), `lib/market-summary.js` `maxAgeMs` param for 10-min live regen.
- `7dd207d`: nav.js World Cup link (top + bottom nav) + `nav.js?v=23→v=24` cache-bust across 15 pages.

**Active blockers:**
- (none in code) — but ALL 5 VERIFY items are unrun: sandbox egress blocks `hyperflex.network`, gamma, the DB, Railway logs, and a browser. Only Marc can run them against prod.

**Queued (priority order):**
1. **Marc runs VERIFY (post-deploy):**
   - #1 count: `curl -s https://hyperflex.network/api/worldcup | jq '.counts, .screener_size'` — if `winner_markets`/`match_events` are 0, WC markets aren't in `_screenerCache` (data-scope issue, not UI) — report before trusting pages.
   - #2 render: same curl shows real markets in `.winners`/`.matches`.
   - #3 live tick: open `/worldcup/<a live fifwc- slug>` during a match; number polls every 12–20s + flashes on each bet.
   - #4 og: `curl -s https://hyperflex.network/worldcup/<slug> | grep -i 'og:title'` (NOT `curl -I` — og is in body).
   - #5 logs: watch for `[worldcup]`/`[worldcup/match]`/`[worldcup/:slug]` errors (all try/caught, shouldn't spam).
2. If counts are 0 or thin: confirm the `fifwc-` slug prefix + winner-question pattern against a real `/api/screener` sample, adjust `_wcIsMatch`/`_wcIsWinner`.

**Notes for next session:**
- The hub is screener-cache-only by design (honest "what we hold" count, zero new infra). If completeness needs more than top-200 markets, that's a screener-scope decision, not a WC-page change.
- Bottom nav: World Cup replaced Finance (kept 5 items); Finance still in top nav + hamburger.


## 2026-06-12 (grading root-cause: gamma envelope + starved sweeps — on `main`)

**Shipped (with hashes):**
- `c964930` (merge to main, pushed): edge-receipts branch `claude/clever-goldberg-zv6aqi` merged — Railway now deploys the receipts endpoint + decided-only accuracy. The work was branch-only before this; prod was still running old denominators (Marc caught it via the old-format log line).
- `824fe40` (main, pushed): THE root cause of "0 graded / N skipped (no price data)" — gamma `markets/keyset` returns `{markets:[...]}` envelope; both graders' closed-market lookups iterated `[]` since they shipped. Unwrapped via `_gammaUnwrap` + bounded prediction_log backfill (400/cycle + 25 targeted condition_id lookups + terminal 'expired' at 5 attempts + tweet-spam guard) + closing-prices sweep LRU round-robin (was head-of-line starved re-scanning the same 40 rows every 5 min) + signal-agent IMMUTABLE index/ON CONFLICT fix (persists were failing on every insert) + prediction_thesis uuid→text FK fix + email-queue retry/backoff with host:port in failure logs.

**Active blockers:**
- (none new) — Surgical FLEX fix still parked (inherited)

**Queued (priority order):**
1. **Verify post-deploy (Marc, ~1h after Railway picks up `824fe40`):** (a) `curl -s https://hyperflex.network/api/edge/receipts` → JSON with `record` non-null; (b) Railway logs: new-format `[intelligence] Platform: X% accuracy across N decided signals (M expired excluded, ...)`; (c) `[accuracy/grade] Done: N graded` with N > 0 (the envelope fix proves itself here); (d) `[closing-prices] sweep ... skip_reasons={...}` — snapped should go nonzero within hours as at-close markets rotate in.
2. **Receipts on explore/landing** — still deliberately held until the record proves out (unchanged from 06-11 entry).

**Open questions / unverified:**
- Whether prod `agent_signals` has legacy duplicate rows — the pre-index dedup DELETE handles it; if the unique index still can't build, `[signal-agent] dedup index error:` names why.
- How much of the 2600 prediction_log backlog is rescuable vs terminal — the targeted lookups answer it organically over ~2 days; watch the `terminally expired (5+ attempts)` counts.

**Notes for next session:**
- ⛔ Lesson now in CHANGELOG: every gamma `*/keyset` response goes through `_gammaUnwrap`. `Array.isArray(body) ? body : []` is the silent-empty anti-pattern that caused months of 0-graded cycles.
- ⛔ Never write `outcomePrices` (settlement) into `market_closing_prices` — CLV needs the closing LINE; provenance is in the new `price_source` column.
- Sandbox cannot curl prod (egress allowlist) or reach the DB — deployed-endpoint curls are the verification path, which is why receipts/intelligence endpoints exist as one-curl diagnostics.

## 2026-06-11 (edge receipts — "best place to find polymarket edge")

**Shipped (with hashes):**
- `e502d54` (branch `claude/clever-goldberg-zv6aqi`, pushed): intelligence grading fix (prod fire #4 — 0.4% accuracy was 'expired' rows in the denominator; now decided-only everywhere + 30d rolling record + expired-rescue pass + YES-price standardization across all 5 signal sources) + new public `GET /api/edge/receipts` + RECEIPTS strip & 30d hit-rate hero stat on `/alpha-live` + 2-min auto-refresh edge ticker on `/feed`
- Docs commit (this entry + CHANGELOG + CLAUDE.md fire #4 annotation) — hash in `git log origin/claude/clever-goldberg-zv6aqi`

**Active blockers:**
- (none new) — Surgical FLEX fix still parked on Marc's curl (inherited)

**Queued (priority order):**
1. **Merge `claude/clever-goldberg-zv6aqi` → main**, then verify: (a) Railway log shows `[intelligence] Platform: X% accuracy across N decided signals (M expired excluded, ...)` with a sane X after the first 30-min resolve cycle; (b) `/api/edge/receipts` returns a non-null record; (c) RECEIPTS strip renders on `/alpha-live` once ≥5 graded calls exist
2. **Receipts on explore/landing** — once the record proves out, surface the 30d hit rate on `/` hero (acquisition-side proof). Deliberately NOT shipped until real numbers are verified post-merge
3. **TAKES tab** (inherited) — still deferred, no human creator content
4. **Hyperliquid strip** (inherited) — still no public endpoint

**Open questions / unverified:**
- Post-merge: how many of the 21,866 expired-era rows are recent enough (<60d) for the rescue pass to actually re-grade? The bulk are likely too old to ever match the 400-market closed lookup — they stay 'expired' and simply no longer pollute the stat. That's the intended end state, not a bug.
- `/api/signals` + `/api/alpha/top` 403-to-curl question (inherited from 06-08): routes have NO auth middleware in code — if curl still 403s it's a CDN/bot layer, not the app. Browser users unaffected; feed ticker + receipts both fetch same-origin.

**Notes for next session:**
- The directive this session was "make hyperflex the best place to find polymarket edge." The positioning answer: every screener shows edges; nobody grades their own calls in public. `signal_outcomes` already had the ledger — it was just broken (0.4%) and invisible. Now it's fixed and on the terminal. Keep compounding: receipts → trust → follows → builder-fee flow.
- New-source rule (also in CHANGELOG): any new signal pushed into `/api/signals` MUST set `yes_price` (YES-equivalent, or explicit null). The grader assumes it.
- Receipts UI thresholds: section hidden <5 graded, hero rate hidden <10 graded in window. Don't lower them to make the page look alive — that's the empty-playfulness anti-pattern.

## 2026-06-08 (feed signal-first redesign)

**Shipped (with hashes):**
- `f8bb6c2`: fix(feed/theses) — widen image match, bidirectional fuzzy + slug fallback
- `605f048`: fix(feed) — 8s AbortController timeout + retry button on NEWS tab; DOMContentLoaded boot guard
- `33bf83e`: feat(feed) — FULL signal-first redesign: tab renamed SIGNALS, hero card (top market by edge score via `/api/alpha/top?n=1`), live signal stream (up to 10 from `/api/signals`, type-colored), structural edge card ("NO resolves 4x more than YES"), wallet CTA for anonymous users
- Also in this session (earlier): PRs #178–#184 (cherry-picks from pre-reset branches + feed/theses source filter + take_reactions schema evolution)

**Active blockers:**
- (none)

**Queued (priority order):**
1. **TAKES tab** — deferred, no human creator content yet; re-enable when there are real takes to surface
2. **Hyperliquid strip** — no public HL feed endpoint exists server-side; placeholder was omitted rather than faked
3. **Surgical FLEX fix** — still blocked on Marc's curl result from prior session

**Open questions / unverified:**
- `/api/signals` and `/api/alpha/top` return 403 from unauthenticated curl — verify both return real data for logged-in users in browser
- Wallet CTA visibility: shown when `window.__USER__?.id` is falsy — confirm nav.js populates `window.__USER__` correctly for anonymous visitors

**Notes for next session:**
- Feed is now signal-first. The mantra: "What is sharp money doing right now?" — every surface answers it.
- Signal type color coding: whale_cluster=blue, new_entry=green, momentum=amber, volume_surge=purple
- Next lever: auto-refresh signal stream (poll `/api/signals` every 2 min, flash new items) — that's what makes the FOMO loop run

## 2026-05-29 (passport reconciliation)

**Shipped (with hashes):**
- `938d7ba`: passport.html — fix score source (flex_score not flex_score_90d/alltime), tier from s.flex_tier then lib/flex-score.js thresholds, strip all decorative emoji (streak 🔥, badge 🛂, avatar 🐋, tweet text 🎯📊💰⚡👇, share buttons 🐦📋), remove tierIcon undefined reference

**Active blockers:**
- **Surgical FLEX fix** still blocked on Marc's curl on `/api/admin/flex/rebuild` for LaBradford.

**Queued (priority order):**
1. **Surgical FLEX fix** — blocked on curl result.
2. **dog-card-v1 verification** — backend + page already shipped; visual spot-check of `/dogs` and feed showcase section.
3. **messaging-v1 polish** — shipped bare-bones; optional: notifications, mark-read on focus.

**Open questions / unverified:**
- PR #102 (rolling hero banner) and PR #103 (SESSION_STATE ledger) still await Marc's visual verify.

**Notes for next session:**
- Passport reconciliation complete. All 4 items from Decision #1 queue are shipped.
- Next pick is Marc's — either unblock FLEX fix (curl result) or verify dog-cards visually.

## 2026-05-28 (WHALE SCORE split + messaging-v1 + onboarding fix + username backfill)

**Shipped (with hashes):**
- `cad7f72`: WHALE SCORE label split (Decision #1 Option C) — predictors.html tabs renamed SHARPEST→FLEX SCORE, BIGGEST WHALES→WHALE SCORE; whales tab now sorts/displays `flex_score_90d` (purple accent); feed.html hero card "Top Predictor" → "Top Whale"; onboarding trigger moved from dead code in explore.html to working home.html redirect; Copy Link button removed from member.html
- `4d20d43`: username NULL backfill in auto-migration — derives from display_name (slugified) or email prefix, idempotent
- `a3ad1f0`: messaging-v1 full build — schema (dm_conversations + dm_messages + dm_reads), 5 endpoints (/api/messages/*), public/messages.html two-panel UI (?with= param auto-opens convo), Message button on member.html profiles, Messages nav link (auth-only) + 30s unread badge in nav.js

**Open PRs (not yet merged):**
- PR #102: rolling hero banner v1 (commit `2a0a25f`) — awaiting Marc's visual verify on `/feed` + `/`
- PR #103: SESSION_STATE.md 2026-05-10 ledger (commit `30ba19c`)

**Active blockers:**
- **Surgical FLEX fix** still blocked on Marc's curl on `/api/admin/flex/rebuild` for LaBradford. Diag triplet `(rt_rows_returned, rt_dedup_keyset_size, rt_contributed.rtCount)` names the fix.

**Queued (priority order):**
1. **Surgical FLEX fix** — blocked on curl result. Branch TBD once diag names the cause.
2. **dog-card-v1** — spec is at `docs/specs/dog-card-v1.md`. Backend + page already shipped (per grep). Verify `/dogs` renders correctly and the feed showcase section works; may just need a visual spot-check.
3. **Passport ↔ main profile reconciliation** — 5-whale divergence query to confirm field discrepancies, then `lib/profile-stats.js` shared aggregator.
4. **messaging-v1 polish** — shipped bare-bones. Potential follow-ups: notifications for new messages, mobile nav badge in hamburger menu, mark-read on focus.

**Notes for next session:**
- First action: check if `/dogs` page renders correctly (dog-cards backend was already built).
- Second action: if Marc has the FLEX rebuild curl result, run the diag and ship the surgical fix.
- Messages nav link is auth-only — logged-out users won't see it. Unread badge polls `/api/messages/unread-count` every 30s from nav.js.

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
