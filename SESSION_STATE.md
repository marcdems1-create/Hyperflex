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

## 2026-07-20 (Trader cards + trader profile page built and wired — both gated, neither public)

**Shipped (with hashes):**
- `a15812d`/`3f24876` (merged to main): desktop home.html font-size + spacing fixes — separate from the trader-first rebuild, landed before the product-definition pivot below was locked. Superseded going forward per the 2026-07-19 entry: no more time on home.html's market-grid layout.
- `6092d54` (merged to main): CLAUDE.md/SESSION_STATE.md updated with the locked product definition (see 2026-07-19 entry).
- `e4db0b7` (merged to main): trader card component — `classifyCardCategory()` (deterministic keyword classifier, realized_trades has no category column), `computeVerdictLine()` (rules-based cascade, zero LLM, has an explicit honest-negative branch so losing traders get a true sentence), `_buildTraderCards()`, `GET /api/trader-cards`. Frontend: `public/trader-card.css`/`.js` (hero/feed/compact variants), `public/home-traders-preview.html` (real integration, not linked from nav, provisional banner), `public/trader-card-demo.html` (mock-data design-review page). Verified locally via a throwaway static server + the pre-installed Chromium — sandbox cannot reach hyperflex.network (proxy 403, confirmed repeatedly).
- `6ea2725` (merged to main): desktop layout pass on the same preview page. Found and fixed a genuine CSS Grid bug — `auto-fit`/`auto-fill` computes column-repetition count off a `minmax()`'s **max** bound when that max is a definite length, not the min, so `repeat(auto-fit, minmax(380px,420px))` fit only 2 columns at ~1440px despite fitting 3 fine at 1900px. Caught by dumping real DOM grid metrics via Playwright, not by eyeballing a screenshot at one width — a first screenshot pass at 1900px looked correct and would have shipped the bug. Fixed by setting `grid-template-columns` explicitly from the actual rendered card count instead of trusting `auto-fit`.
- `9f18f77` (pushed, branch `claude/trader-profile`, not yet confirmed merged): trader profile page. `_buildTraderProfile()` reuses `_buildTraderCards()` for verdict/score/n/evidence/form/streak/specialty — same function call as the card, not a recomputation, so card and profile cannot disagree. Adds headline stats, best call AND worst call (always both, never highlights-only), full per-category specialty breakdown, full trade history with filters, open positions (separate, uncounted), a disclosure note on unverifiable positions. `GET /api/trader-record/:handle` + `GET /trader/:handle` (serves `public/trader-profile.html`, same pattern as `/m/:userId`). Checked for an existing endpoint first per CLAUDE.md rule 10 — found `GET /api/trader-profile/:username`, a pre-pivot endpoint over the old HFX positions/markets tables, unreferenced by any live page (only in api-docs.html) — different data model, built fresh at `/api/trader-record` instead. `trader-card.js` links now point to `/trader/:user_id` instead of `/m/:userId`.

**Active blockers:**
- **Redeemed-win correction cron status: UNKNOWN as of this entry.** Could not check `remaining` — this sandbox has no network path to hyperflex.network (confirmed again) and no direct DB access. Marc asked for this number; it needs to come from hitting `GET /api/admin/regrade-redeemed-positions/status` directly (built in the 2026-07-18 session) or the Railway logs. Whoever picks this up next: check it and log the number here.
- **Both the trader-card surfaces AND the new profile page are GATED — same Gate 1 as everything else.** `home-traders-preview.html` and `trader-profile.html` are both real, wired to live (provisional) data, not linked from site nav, both carry a visible provisional banner. Do not link either from nav or promote any ranking/verdict shown on them until the correction cron drains and the top 10 is hand-verified.

**Queued (priority order):**
1. Get the correction cron's current `remaining` — see blocker above.
2. Once `remaining` ≈ 0: hand-verify the new top-10 against real Polymarket profiles (same step that caught the gloriafoster bug — do not skip it twice).
3. Then: flip `home-traders-preview.html` → the real `/` (replacing home.html's market grid) and link trader cards from nav. Verdict/score/n logic doesn't change at that point — only the gate/linking does.
4. Open question from 2026-07-19 is still open: ranked-table vs trader-cards homepage lead. This session built cards (per the two specs handed down), so that question is likely resolved in practice, but Marc hasn't said so explicitly — confirm before treating it as decided.

**Open questions / unverified:**
- Every screenshot verifying the trader-card and trader-profile work this session was taken against LOCAL MOCK DATA (hardcoded JSON, no DB), not the live gated data — the sandbox cannot reach prod. The code is reviewed and the render logic exercised, but nobody has looked at what these pages render with real (provisional) wallet data yet.

**Notes for next session:**
- `_buildTraderCards(roiRows)` is the single source of truth for verdict/score/n/evidence/form/streak/specialty-pair — both `/api/trader-cards` and `/api/trader-record/:handle` call it with a filtered `_computeRoiLeaderboard()` row. Any future surface showing a trader's score should call this too, not recompute.
- The CSS Grid `auto-fit`-uses-minmax-max-not-min gotcha (see `6ea2725` above) is worth remembering anywhere else a fixed-max `minmax()` grid gets used — it's viewport-width-dependent, so it can pass a spot-check at one width and fail at another.

## 2026-07-19 (PRODUCT DEFINITION LOCKED — trader scoreboard, not market browser)

**Marc locked the product definition. It is now the top section of CLAUDE.md and governs every feature decision. Read it before building anything.**

**Hyperflex is an on-chain trader scoreboard. We track and score traders. We do NOT promote markets.**
- Homepage promotes **people** — best traders, their scores, their records. Markets are evidence of a call, never the headline.
- Venue order: **Polymarket first, Hyperliquid second**, same scoring layer across both.
- **A win never appears naked** — score + n travel with every showcased trade, everywhere.

**Consequence for existing UI:** the current homepage is largely the WRONG page under this definition — "Hot Right Now", "Closing Soon", "Events in Focus", market carousels are all market-browsing surfaces. They come off the homepage and get replaced by trader rankings + trader cards. **Do not spend more time polishing market-grid layout** — six rounds of desktop font/sizing patches were spent on a page that's being replaced. (Desktop type is still inconsistent across widgets; each is separately hardcoded. If it's worth fixing at all it needs ONE pass applying a single type scale to every hardcoded font-size in home.html, or a designer with the browser open — Code's sandbox is hard-blocked from hyperflex.network by proxy 403 and cannot visually verify.)

**Open question for next session:** does the homepage lead with a ranked leaderboard table (Bloomberg-style) or trader cards with verdict lines (social-style)? Marc hasn't answered yet. Both are trader-first.

**Gates that still block the build (all three in CLAUDE.md):**
1. **Do not promote any trader** until the redeemed-win correction cron drains (~262K rows) AND the new top 10 is hand-verified against real polymarket.com profiles, all-time window.
2. **No Hyperliquid work** until the Polymarket grader is defensible. Perps = second grading engine (entry→exit, leverage, funding), not a new data source.
3. **Publish nothing from the grader.** Latest: **n=83, 53.0% — BELOW the n≥30/58% gate.** Trend is falling as n grows (62.5%@32 → 58.5%@41 → 53%@83) — small-sample regression toward true value. The "smart money is predictably right" premise is weaker than assumed and needs re-examining once the correction finishes.

**Buildable NOW while the cron drains:** the trader-first structure — homepage layout, leaderboard surface, trader card component, profile page. Build the container; don't trust the contents until gate 1 clears.


## 2026-07-18 (Wallet ROI leaderboard — redeemed-position ingestion bug found & fixed; trader-showcase spec locked, gated on backlog clearing)

**Shipped (with hashes):**
- PR #211 (`8fcce2d`): resolver matcher/probe-budget fix — raised `RESOLVE_PROBE_MAX`, condition_id-priority probing, `/public-search` fallback for keyless pending signals, `ok`/failure-vs-genuine-empty distinction on every gamma fetch path (a transient timeout must never be treated as "confirmed gone"). Confirmed live: `matched>0`, `graded` climbed 41→54.
- PR #212 (`c2ebc41`): Wallet ROI Leaderboard v1 — new `mode=roi` on `/api/predictors/leaderboard`, capital-weighted + 90-day-decay + shrinkage-adjusted (K=20) score sourced from `realized_trades` (reused the existing pipeline, did not fork a new resolver). New `/resolved-trades` profile endpoint, new ROI SCORE tab on `/predictors`, new "Resolved Positions" card on `member.html`.
- PR #213 (`643c14d`): winsorized `realized_roi` at 1000% in all three ROI aggregates — first live run showed 25,000%+ scores from unbounded per-trade ratio averaging polluting the shrinkage-anchor population mean.
- PR #214/#215 (`af05ccc`/`0e5b0c4`): read-only `/api/admin/roi-audit` staged-breakdown diagnostic (raw → capital-weighted → decayed → capped → shrunk) + a timeout fix (was running the same population aggregate twice per request).
- PR #216 (`e49b201`): row-level `/api/admin/roi-audit/rows` diagnostic — found the real bug (below).
- PR #217 (`d36b1e4`): **the actual fix.** `backfillRealizedTrades`'s redeemed-position path trusted Polymarket's `cashPnl` as the sole win/loss signal, with zero check against the market's real outcome. Confirmed fabricating wins: 4 different NFL MVP candidates AND 4 different World Cup teams all "won" the same exclusive-outcome market for one wallet (gloriafoster); positions "redeemed" for elections scheduled years in the future. Ingestion now independently verifies settlement via gamma (`_verifyRedeemedSettlement`, reuses the existing `_parseOutcomeSettlement`) before trusting anything. New one-time correction logic + `realized_trades.regraded_at` progress-tracking column.
- PR #218/#219 (`27f088e`/`d65f851`): the correction backlog is **261,773 rows** — far too large for manual curls. Converted to a 2-min background cron (1500 rows/tick, `_mapLimit` concurrency), and fixed a status-visibility gap where a silently-failing cron looked identical to one that had never fired.

**Active blockers:**
- **Redeemed-position correction cron is RUNNING but NOT DONE.** Confirmed live and working (`/api/admin/regrade-redeemed-positions/status`): one observed tick cleared 1500 rows (all deletions — genuinely-unresolved dust positions wrongly marked redeemed), `remaining` dropped 261,773 → 245,773. At that rate, full clear is several hours out, unattended — no manual action needed, just time.
- **ROI leaderboard is UNPUBLISHED — do not trust the numbers or the top-10 until `remaining` is at/near 0 AND the new top-10 is hand-re-verified** against real Polymarket data. gloriafoster / Just2SeeULaugh / Desy were the confirmed-corrupted wallets; expect the whole top-10 to look different and much more modest post-correction.

**Queued (priority order):**
1. Check `GET /api/admin/regrade-redeemed-positions/status` — once `remaining` ≈ 0, re-run `/api/admin/roi-audit` + `/api/predictors/leaderboard?mode=roi` and hand-verify the new top-10 against real Polymarket profiles. Do not skip this — it's the exact step that caught the bug in the first place.
2. **Then, and only then: build the Trader-First Showcase & Profiles spec** (uploaded this session, direction locked). The spec's own hard prerequisite: "Ship fix → recompute → hand-check top 10 → then build this." Locked decisions:
   - Non-negotiable: score + n travel with EVERY showcased win, on every surface (feed/homepage/share images/embeds) — no "clean" variant without the record.
   - Showcase ranking = "called it early" (CLV-style: entry price vs. resolution price), NOT biggest-ROI — biggest-ROI is exactly what surfaced the corrupted longshot wins this session. Explicit guard: exclude sub-cent longshot noise, the same rows that corrupted this leaderboard.
   - Trader profile prominence order: verdict line (one computed sentence, e.g. "sharp on macro, reckless on sports") → score+n → specialty breakdown (hit rate per category — this is what makes honest losers interesting, e.g. "down 12% overall, 71% on macro across 34 trades") → best/worst call side by side, equal weight → recent form (time-weighted) → full trade history (wins+losses+open+ungradeable, all visible, never dropped).
   - Explicitly excluded: follower count as a prominent metric, any trust score blending performance with social signals, any loss-hiding/collapsing anywhere.

**Open questions / unverified:**
- Correction-cron throughput projection (~5-6h to clear) is based on one observed tick, not a full run. Gamma settlement cache is process-wide and persists across ticks, so later ticks should speed up as popular markets get cached — not yet empirically confirmed.

**Notes for next session:**
- This whole arc is a live case study in why the trader-showcase spec's hand-verify step is non-negotiable: the leaderboard passed every internal sanity check (bounded scores, plausible #1 by whale_rank) right up until Marc manually checked gloriafoster's real Polymarket profile and found it net negative. Don't skip hand-verification for the showcase build either.
- `_verifyRedeemedSettlement` / `_redeemDecisiveSettlementCache` (server.js, near `_parseOutcomeSettlement`) is the shared gamma-settlement-verification helper — reuse it for the showcase's "called it early" CLV computation rather than building a second one.

## 2026-07-14 (MAJOR: resolver bug found — 23.6% was false, real number is 58.3% / n=24)

**The single most important finding to date. Read this before touching the edge/grading system.**

**What happened:** The edge hit rate showed 23.6-24.5% (worse than random) and looked like the whale-cluster thesis was dead. Full audit (`/api/admin/edge-audit`, extended this session with `thesis_test_excluding_fast_and_sports`, `non_yes_no_side_check`, `both_sides_logged_check`) proved it was a GRADING BUG, not a signal failure.

**The bug:** `resolveSignalOutcomes` compared `predicted_side` against string literals `'YES'`/`'NO'`. But multi-outcome markets have named sides ("NOVAK DJOKOVIC", "MOROCCO", "ADOLFO VALLEJO"). Those can NEVER match `'YES'`/`'NO'`, so they were graded `wrong` unconditionally — regardless of the real outcome. 32-35 rows were structurally incapable of ever grading correct. Zero of them did.

**Also found (confirmed, not fixed):** the whale-consensus detector logs BOTH sides of the same event as separate signals whenever 3+ whales sit on each side (`consensusMap` keyed by `market+'||'+side`, server.js ~34950, no cross-side check before pushing a candidate) — confirmed at massive scale (25 markets, up to 954 raw rows on one NBA futures market alone). Real, separate detection-side bug — deliberately deferred, not fixed.

**Fixes shipped (all on `main`):**
- PR #204 (`a52e352`): resolver now compares named-outcome sides against the ACTUAL winning outcome name (case-insensitive, trimmed) via shared helpers `_parseOutcomeSettlement` + `_fetchGammaKeyset`.
- PR #205/#206 (`07fb8b3`/`6348b4c`): bounded the regrade endpoint (`REGRADE_BATCH_MAX=60` @ concurrency 5) + instrumented failure reasons — all affected historical rows came back `no_gamma_match`: their source markets aged out of gamma's direct-lookup retention (hard data-availability wall, not a code bug).
- Commit `b724f9d`: unrecoverable rows STAMPED `outcome='void_ungradeable'`, excluded from hit-rate math but always visibly counted via `/api/edge/receipts` → `record.alltime.void_ungradeable` + `void_reason`. **Never silently shrink the denominator — this principle is now load-bearing across the whole edge/ROI system.**

**The real number (live-verified):** `alltime` = graded 24, correct 14, wrong 10, **hit_rate 58.3%**, void_ungradeable 35. Against the publish gate (n≥30 AND ≥58%): hit rate clears, sample size doesn't yet. **STILL UNPUBLISHED.**

**Next when picking this back up:** re-run `/api/admin/edge-audit` once n has grown past 30. Separately, the both-sides-logged detection bug is CONFIRMED but UNFIXED — Marc's call on priority.

## 2026-07-14 (Mantra change, Anthropic credit outage, desktop UI status)

**Mantra changed** (in CLAUDE.md): from "industry standard for building on top of Polymarket" → **"On-chain needs a real track record. HYPERFLEX is the verified track record layer for on-chain traders."** On-chain expansion (Hyperliquid named first candidate) DOCUMENTED but PARKED — no second venue until the Polymarket grader produces a defensible number.

**Anthropic API was OUT OF CREDITS** (platform-wide) as of this session. Grading does NOT depend on Anthropic — 100% deterministic SQL/arithmetic, confirmed independently twice now. News-feed matching hardened separately (PR #200, `f73f579`) to degrade to keyword matching on Haiku-call failure rather than silently nulling every headline.

**Desktop homepage UI:** still not right per Marc as of last check — cards resized, but text still reported too small + dead space remains. Not picked back up this session.
