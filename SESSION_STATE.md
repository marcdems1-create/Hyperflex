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

## 2026-07-23c (Connect flow shipped: progressive UX, durable settlement cache, opt-out — plus the diagnostic bug fix)

**Real numbers came back from the ingestion-timing diagnostic:** total_ms 8,513 / 9,475 / 12,842 / 14,663 across the light/medium/heavy/reference wallets — squarely in the spec's 5-30s "progressive" band. gamma_verify_ms was 6,491 / 2,184 / 9,318 / 8,541 — up to 73% of total time on the worst wallet. Pagination itself is fast (3-12 pages). This decided the UX: progressive, not sync or async.

**Diagnostic bug fixed first:** `activity_ms` was never actually assigned in `/api/admin/ingestion-timing` (phase 1 timing was declared in a comment but the code never captured start/end) — genuinely missing from the response, not a null value. Fixed by adding the missing timer. Also added `tier`/`existing_realized_trades_rows` per wallet in the response so the light/medium/heavy identity of each result is legible without cross-referencing addresses by hand.

**Settlement cache — scoped AND shipped, not just scoped, because the fix was low-risk:** confirmed `_redeemDecisiveSettlementCache` already exists but is a plain in-memory `Map` — lost on every deploy, and this app auto-deploys on every push to `main`, so "indefinite" in the original comment really meant "until the next push." Added a durable second tier: new `market_settlement_cache` table (condition_id PK, price, winner_name, verified_at), self-healing migration in the boot block, `_verifyRedeemedSettlement` now checks DB before hitting gamma and writes through on a fresh decisive settlement. Zero behavior change to the settlement LOGIC — same `_parseOutcomeSettlement`, same decisiveness threshold — only where the cache persists. Compounds across every future wallet connect and every future backfill/cron run, not just within one process's uptime.

**Connect flow shipped — progressive per the spec's own three requirements:**
- `POST /api/connect` (address-only, no signup wall, no signature required to VIEW — trades are already public on-chain): find-or-creates a `users` row for the address, derives the proxy, runs the FAST unverified phase (paginated activity fetch + grouping, no gamma calls) synchronously and returns identity + raw activity/market counts immediately, then kicks off the full gamma-verified `backfillRealizedTrades` in the background.
- `GET /api/connect/status/:userId` — polling endpoint (in-memory Map, `running`/`done`) for the frontend to know when the verified backfill finishes.
- `public/connect.html` at `/connect` — new route, linked from nav as **"My Score"**, now the first primary link (ahead of Traders): connect wallet OR paste an address to preview (same code path either way — the spec explicitly floated this as worth offering, so it wasn't a second flow to build). Shows identity + raw unverified counts the instant `/api/connect` returns, a visible "Verifying against Polymarket settlement data…" banner while the background job runs, polls every 2s, then swaps in the fully verified record (same rendering approach as `/trader/:handle` — `_buildTraderProfile` is the single source of truth either way) once `status: 'done'`. Never a blank wait at any step — confirmed via mocked-fetch Playwright screenshots at three stages (hero → raw record → verified record), for both an eligible wallet (verdict, score+n, scope label, full receipts) and a non-qualifying one (progress bar parsed from `eligibility_note`, e.g. "3 of 10 durable resolved trades," not a rejection).
- **Listing + opt-out, per CLAUDE.md rule 5:** every connect shows the default-on listing notice plainly, with a one-click opt-out checkbox. New `users.leaderboard_opt_out` column (self-healing migration, default false); `_computeRoiLeaderboard` now filters out opted-out users at the display-join step (added `leaderboard_opt_out` to the existing per-user display query rather than touching the aggregate eligibility query). Toggling opt-out requires a fresh wallet signature (`POST /api/connect/opt-out`) so nobody else can flip someone else's listing — a lighter-weight scheme than the existing `requireAuth`-gated `/api/wallet/challenge`+`/api/wallet/verify` pair (which doesn't fit a connect-flow user who never signed up): client signs a message embedding its own timestamp, server rejects anything older than 5 minutes. Not a stored one-time nonce — a real nonce store wasn't judged worth building for an action this low-stakes (reversible, no funds, no PII).

**Explicitly NOT built, deferred on purpose:**
- The category-browse destination for non-qualifying wallets (rule 4: sports/finance/politics/macro/crypto markets as the path to building a record). `connect.html` shows an honest placeholder linking to `/traders` instead of a dead end, but the real by-category market browse is a separate design/build pass.
- `connect.html`'s rendering functions (`render`, `callCardHtml`, formatting helpers) are duplicated from `trader-profile.html` rather than extracted into a shared file — same known-duplication tradeoff already made between `market.html`/`creator-dashboard.html` elsewhere in this codebase. Worth consolidating later, not now.
- A known race: two near-simultaneous first-time connects for the same brand-new address could both pass the "not found" check in `_ensureConnectedUser` and both INSERT — `users.polymarket_address` has no unique constraint today. Not fixed this pass (would need to audit existing data for pre-existing duplicates before adding one blind); low-probability edge case (same wallet connecting from two places in the same instant), noted rather than silently ignored.

**Active blockers:** none — the flow is real, wired end-to-end, and verified locally against mocked responses (server is not started per CLAUDE.md rule 7; no live traffic has hit it yet).

**Queued (priority order):**
1. Deploy, then run a real connect end-to-end against `/api/connect` with a real wallet and confirm `total_ms` roughly matches the diagnostic's earlier numbers now that the settlement cache is live (expect gamma_verify_ms to drop on any wallet sharing markets with previously-verified wallets).
2. Build the category-browse destination for non-qualifying wallets (the one deferred piece of the spec's own spine).
3. Consider extracting the duplicated trader-record rendering code (`trader-profile.html` + `connect.html`) into one shared file if a third consumer ever needs it.
4. Optional hardening: unique constraint (or `ON CONFLICT`) on `users.polymarket_address` to close the race noted above.

**Notes for next session:**
- `market_settlement_cache` is additive and safe — it only ever caches DECISIVE settlements (price >0.95 or <0.05), same threshold as before; nothing about what counts as "resolved" changed.
- `_connectBackfillStatus` is an in-memory Map, not persisted — a server restart mid-verification loses status for any in-flight connect (the user's browser would poll forever). Acceptable for now given Railway doesn't restart mid-request under normal operation, but worth a TTL/cleanup pass if this Map grows unbounded over time (currently nothing ever deletes an entry).

## 2026-07-23b (Connect-flow spec, step zero: real ingestion-timing diagnostic shipped; found & fixed a real pagination gap along the way)

**The connect-flow spec's own step zero says: measure ingestion latency before designing anything.** A connecting wallet has zero rows in `realized_trades` — first connect means pulling that address's whole Polymarket history on demand, and whether that takes 3s or 45s decides sync-spinner vs. progressive-load vs. async-notify. Code's sandbox has no network path to hyperflex.network or polymarket.com (confirmed again, same as every prior entry this arc) so it cannot produce those numbers itself — this entry ships the one-shot diagnostic instead, per the "don't make him run multi-step diagnostics, build an endpoint and have him hit it once" operating rule.

**Real bug found and fixed while building the diagnostic, before any timing was even taken:** `backfillRealizedTrades`'s sold-path `/activity` fetch was a single un-paginated call (`limit=500`, no offset loop) — while the redeemed-positions fetch a few lines below it already paginated correctly. Confirmed via the same reference wallet from the original coverage-gap investigation: `0x4de883380632ffff2dd68116ac89cee5c1e776ba` (luficdm) has 1,316 activity events; the un-paginated call would only ever see the newest 500. This is exactly the bug shape the spec's step zero explicitly asked to check for ("whether the /activity pagination fix is in the live ingestion path") — it was NOT, in the actual production ingestion function, even though a read-only diagnostic earlier this arc (`_heldLossDiagnosticForAddress`) had already applied the identical fix to its own copy of the fetch. Per the "don't volley — ship the fix that's correct under either hypothesis" rule: this needed fixing regardless of what the timing numbers turn out to be, since a heavy wallet's FIRST connect would otherwise silently truncate at 500 events with no error. Fixed in place, same pagination pattern as the redeemed-path (PAGE_LIMIT=500, offset loop, 10,000-event safety cap).

**Shipped:**
- Pagination fix in `backfillRealizedTrades`'s sold-path `/activity` fetch (mirrors the existing redeemed-path pattern).
- `GET /api/admin/ingestion-timing` — read-only diagnostic, no required params. Auto-selects a light/medium/heavy spread from wallets already in `realized_trades` (by existing row count) plus the known heavy reference wallet, or accepts `?addresses=` to override. Mirrors `backfillRealizedTrades`'s full pipeline (paginated activity fetch → grouping → paginated redeemed fetch → gamma settlement verification) phase-by-phase with timing on each, but performs ZERO writes — deliberately not the real function, since writing under a synthetic user_id could leak untracked rows into the ROI leaderboard, and writing under a real user_id would silently no-op via `ON CONFLICT DO NOTHING` for anyone already ingested, undercounting the real first-connect cost. Reports `activity_events`, `activity_pages_fetched`, `sold_groups`, `grouping_ms`, `redeemed_positions`, `redeemed_fetch_ms`, `unique_redeemed_markets`, `gamma_verify_ms`, `gamma_verified_count`, and `total_ms` per wallet — `total_ms` is the number that should drive the UX decision.

**Active blockers:**
- **The actual three timing numbers (light/medium/heavy) are not in this entry — nobody has run the endpoint yet.** Everything above is code, not a measurement. Whoever picks this up next: `curl "https://hyperflex.network/api/admin/ingestion-timing?secret=$ADMIN_SECRET"` (single call, no wallet addresses needed — it self-selects) and log the `total_ms` figures here before touching any connect-flow UI.

**Queued (priority order):**
1. Run the diagnostic, log the three (or more) `total_ms` readings here.
2. Per the spec: <5s → synchronous; 5-30s → progressive load; >30s → async "we'll have it shortly" with live update. Do not design the connect-flow UI before this number is in hand.
3. Then: build the connect flow itself (wallet connect + optional paste-address preview, everyone gets a record with no minimum, ranking gated at n≥10 durable trades shown as a progress bar not a rejection, non-qualifying category-browse path, default-on listing with stated opt-out).

**Notes for next session:**
- `gamma_verify_ms` is the most likely dominant cost on a heavy wallet with many distinct resolved markets — each unverified conditionId in the redeemed path is a real external gamma call, bounded by `_mapLimit(..., 6, ...)` concurrency. If total_ms comes back high, check whether it's the activity fetch (Polymarket API latency, fixed cost) or gamma verification (scales with unique redeemed markets, and gamma has its own process-wide cache so repeat wallets should be faster) before assuming the whole pipeline needs rearchitecting.
- The pagination fix means real future backfills (via `backfillRealizedTrades`, called for real connects) will now capture full history for heavy wallets that were previously silently truncated — this is a correctness improvement independent of the connect flow, worth remembering if leaderboard numbers shift slightly for any already-connected heavy wallet on their next resync.

## 2026-07-23 (Trader surface goes live — ALONGSIDE home.html, not replacing it)

**Marc authorized items 1-3 from the 2026-07-21 entry's queue outright, and modified item 4 rather than approving it as proposed.** Item 4 as originally framed was "flip `home-traders-preview.html` → `/`." Marc's actual instruction: launch alongside, not replacing — put the trader surface on a real route (`/traders`), link it prominently in nav, leave `home.html` at `/` untouched. Reasoning on record: the trader page is structurally right but visually unfinished (a design pass was deliberately deferred), and swapping the homepage before that pass would make the least-polished surface the front door. Trader-first is still the stated destination and `home.html`'s market grid is still "on borrowed time" — the swap happens after the design pass, not before it.

**Shipped, this branch:**
1. **Stripped `provisional`/`provisional_note`** from every emission point: `_buildTraderCards`' return object, both early-return branches and the success response in `GET /api/trader-cards`, and `_buildTraderProfile`'s return object. `ephemeral_excluded_note` and `void_note` were left alone — those are permanent disclosure copy per the product definition (disclose, not hide), not gate-era provisional flags.
2. **Removed the `.gate-banner` divs** from `home-traders-preview.html` and `trader-profile.html`, and the per-card `<div class="tcard-provisional">` badge + its CSS from `trader-card.js`/`trader-card.css`. Also dropped stale gate-era copy: the homepage preview's empty-state message referencing "the correction cron is still draining" (that cron finished draining on 2026-07-21) and the `noindex, nofollow` robots meta + "(preview, not live)" page titles on both files.
3. **Linked the trader surface from site nav** (`public/nav.js`): added `{ href: '/traders', label: 'Traders', gold: true }` as the first primary link (ahead of World Cup/Feed), and added a `Traders` entry to the Cmd+K search index.
4. **Added a real Express route**, `app.get('/traders', ...)` serving `home-traders-preview.html` — mirrors the existing `/trader/:handle` pattern. Both files gained the shared `#nav-root` + `/nav.js` include so they're consistent with the rest of the site now that they're real, linked pages (they didn't have the shared nav before — they were unlinked static files with their own header only).

**What was explicitly NOT done, per Marc's own reasoning:** no visual/design polish pass on `home-traders-preview.html` or `trader-profile.html`, and `home.html` was not touched — it stays at `/` exactly as-is.

**Verification:** `node --check server.js` / `nav.js` / `trader-card.js` all pass. Locally mocked both pages' fetch calls (scratch copies, never committed) and screenshotted via the pre-installed Chromium at 1440px and mobile widths — nav renders correctly on both pages with the Traders link active/highlighted, no leftover banner, scope label shows, a losing trade renders correctly (red, "LOST"), and an ephemeral trade correctly displays dimmed with "Ephemeral — excluded" in the Scope column. One real bug caught and fixed in the process: the homepage preview's empty-state copy was stale (referenced a cron that already finished). No bugs found in the actual shipped page code — two false alarms during verification were both bugs in my own throwaway test mocks (wrong field names on mock trade/call objects), not in the real code; confirmed by cross-checking the mock against `_buildTraderProfile`'s actual field names (`pnl`/`roi`/`result` on best/worst call, `realized_pnl`/`realized_roi_pct`/`result`/`category` on trade_history rows) before re-testing.

**Active blockers:** none for this go-live step. Deferred by explicit instruction: the design pass on the trader surface, and the eventual `home.html` → trader-first swap (not scheduled, no date attached).

**Queued (priority order):**
1. Whenever picked back up: the deferred design pass on `home-traders-preview.html`/`trader-profile.html`, informed by real traffic on `/traders` now that it's live and linked.
2. Optional, lower priority, carried over from 2026-07-21: spot-check TB14's lifetime ("All") P&L window on Polymarket, since the original hand-verification only checked "Past Day."
3. Not this session: the `home.html` → trader-first homepage swap. Explicitly gated on the design pass, no other precondition.

## 2026-07-21b (PRODUCT PIVOT: participant-first — connect wallet, see your own score)

**Marc reframed the product. CLAUDE.md's definition section is rewritten; read it before building anything.**

**From spectator-first to participant-first.** Everything built so far assumed you browse *other* traders. The product is now: **connect your wallet → see YOUR score, YOUR profile, YOUR record.** The leaderboard is what you're measured against, not the main event.

Why this is stronger: it solves cold-start (every visitor is a potential leaderboard entry, vs. 76 hand-selected wallets), and it's inherently shareable — people post their own numbers, not a stranger's. "What's my score?" is a far better hook than "here are traders you've never heard of."

**Three decisions locked by Marc:**
1. **Connect → score immediately.** No gate, no signup wall. The score IS the acquisition.
2. **Non-qualifying wallets (<10 durable resolved trades) get markets by category** — sports, finance, politics, macro, crypto — as the path to building a record. This is the ONE place markets lead, because the user has no record to lead with yet. A dead end here is a failed first experience.
3. **Listed on the public leaderboard by default, with a visible one-click opt-out stated at connect time** (Option B, chosen over fully-automatic-no-opt-out). Rationale on record: trades are already public on-chain, but being *ranked* is a different act than existing on-chain, and the user clicked connect to see their own score — not to be published. Default-on gets the network effect; visible opt-out keeps it defensible.

**⚠️ Unsolved risk, logged deliberately:** automatic listing means the board can be farmed — 10 cherry-picked durable trades and you're on it. The board's honesty is the whole moat. Candidate mitigations (min capital, min account age, min time span across trades, anomaly detection on suspiciously clean records) are NOT implemented. Must be answered before the board is worth gaming.

**What this means for existing work:** the trader cards, profile page, verdict line, specialty breakdown, best/worst call components all still apply — the scoring machinery is identical, it just gets pointed at a connected wallet. The homepage question changes though: it's now "connect your wallet" as the hero, not a curated showcase of featured traders.

**Existing decision still standing:** trader surface goes public alongside `home.html`, not replacing it, until the design pass happens.

**Sequencing note (added when this entry was merged into the log, 2026-07-23):** this pivot landed the same day Gate 1 cleared (see the entry directly below) but before the 2026-07-23 go-live work above. The go-live work shipped the *existing* trader-showcase surface (cards/profile/leaderboard) at `/traders` — that shipment is still correct under this pivot (the scoring machinery is unchanged), but it is not the participant-first connect flow described here. The connect flow (wallet connect → score computation → profile, non-qualifying path, opt-out notice) has not been built yet — that is the next spec.

## 2026-07-21 (MILESTONE: Gate 1 clears — durable-market leaderboard hand-verified against real Polymarket profiles)

**The gate that has blocked every trader-facing surface since 2026-07-18 is cleared.** Marc ran the actual backfill and hand-verified the resulting top of the leaderboard directly against polymarket.com. This is the first time in this whole arc that a leaderboard has survived that check.

**Backfill, run for real (not the diagnostic estimate):** 21,934 rows processed, 3,992 classified durable. Close to the read-only survey's projection (21,879 / 3,986) — the small delta is new rows ingested between the survey and the actual run, not a discrepancy to chase.

**Hand-verification, 3 wallets checked directly against polymarket.com:**
- **taerv534** — 1,866 real Polymarket predictions, we score n=10. Highly selective, which is the point: only 10 of those 1,866 are durable and independently verifiable.
- **TB14** — 689 predictions, scored n=26 at 46.2% win rate — and Polymarket shows them actually losing (down on the day, every visible position deep red: -29%, -84%, -94%, -82%). **This is the exact check that would have caught an inverted model or a residual fabrication bug, and it passed** — a losing trader is correctly ranked as losing, same discipline as the gloriafoster catch that started this whole investigation, except this time the system got it right.
- **MELOCOTON007** — 136 predictions, scored n=20 at 80% win rate, biggest win $8,318, no open positions.

**Caveat on the record, stated plainly rather than glossed over:** the Polymarket P&L panels checked were "Past Day," not lifetime "All" — TB14's -$450 figure is one day, not a career total. The position-level detail (multiple deeply-red individual positions) supports the losing-trader read regardless of the P&L window, but the lifetime figure itself was not pulled. Worth a lifetime-window spot-check before leaning on exact P&L numbers anywhere public-facing.

**Also worth logging honestly: this hand-verification was performed by Marc directly against polymarket.com, not by Code.** Code's sandbox still has no network path to hyperflex.network or polymarket.com (confirmed repeatedly throughout this arc) — every number in the backfill/rebuild was written and reasoned about by Code, but the actual real-world check that clears Gate 1 was necessarily done outside this sandbox.

**Active blockers:**
- (none — Gate 1's hand-verification requirement is satisfied for the first time this arc)

**Queued (priority order):**
1. CLAUDE.md Gate 1 updated in this same entry's commit — see below.
2. Bring the trader surface off the provisional flag: remove the provisional banners from `home-traders-preview.html`/`trader-profile.html`, strip `provisional:true`/`provisional_note` from the API responses, link trader cards from site nav, and decide whether `home-traders-preview.html` becomes the real `/` (replacing home.html's market grid) or a new route. **Not done in this entry — a distinct, higher-visibility action from writing documentation, held for explicit confirmation before touching anything public-facing.**
3. Optional, lower priority: spot-check TB14's lifetime ("All") P&L window per the caveat above.

**Notes for next session:**
- If the "go public" step above is approved: `provisional`/`provisional_note` currently appear in `_buildTraderCards`' and `_buildTraderProfile`'s return objects, `/api/trader-cards`, and `/api/trader-record/:handle` — grep for `provisional` in server.js to find every emission point before stripping.

## 2026-07-20b (MAJOR: whale-set selection was structurally wrong — leaderboard rebuilt on durable markets, not capital)

**Resolves the "Redeemed-win correction cron status: UNKNOWN" blocker from the entry below: Marc confirmed `remaining: 0` directly.** But draining the backlog surfaced a second, deeper bug: `/api/trader-cards` still showed a 100% win rate at n=35 for luficdm (0x4de88338...) — same fabrication signature as the original redeemed-win bug, on a wallet the correction cron claimed to have cleared.

**Root cause (NOT the redeemed-win bug recurring — a genuinely new one): `backfillRealizedTrades` only ever captures actively-SOLD positions and REDEEMED positions.** A position bought and simply held to a losing resolution generates neither event — nothing to sell, nothing to claim on a $0 payout — so it's structurally invisible to ingestion. Confirmed: luficdm has 571 real Polymarket predictions, we held 35 rows, all wins.

**Investigation arc (all shipped, all read-only until the rebuild commit):**
- `605812b`/`807410d`: `GET /api/admin/held-loss-diagnostic[/batch]` — FIFO-matches `/activity` BUY/SELL (paginated — the existing 500-event cap undercounted luficdm's real 1316), keeps unmatched BUY lots, verifies each via the same gamma check the redeemed path trusts. First verdict logic (n-growth-based) was wrong — gloriafoster's n only moved 6→13 (2.2x, would have failed a `>=3x` bar) but win rate cratered 100%→46.2%, which IS the mechanism working. Fixed to key on `win_rate_delta_pct`/`verify_rate_pct` instead.
- **Batch survey result: 19/20 stratified whales came back ungradeable, median verify rate 0%.** gloriafoster (88%) is the exception. The capital-selected whale set structurally over-represents high-frequency bots on ephemeral markets (5-min crypto up/down binaries, parlays) that age out of gamma before they can ever be verified — a volume cohort, not a skill cohort. **Do not run a held-loss backfill on the capital-selected whale set — it would recover almost nothing.**
- `785748f`/`51e4f46`: `GET /api/admin/durable-market-scope` — classifies ALL realized_trades by durability (title-pattern + duration heuristic, `classifyMarketDurability()`). Result: **76 wallets qualify with >=10 durable resolved trades** (top n: 290/192/172/120/103); durable/ephemeral split across existing data is 3,986 vs 17,893 (18.2% durable). Also fixed a real bug here: the durable-scoped verify-rate sample came back empty because `users.id` is TEXT in this schema, not native uuid — `= ANY($1::uuid[])` threw and a silent `.catch(() => [])` masked it as a clean empty result instead of an error. Fixed by folding the lookup into the main query (same cast direction as the working `_computeRoiLeaderboard` precedent) instead of patching the cast.

**Shipped — the rebuild (`e4ce5f8`, includes two previously-unmerged branches folded in mid-task, see below):**
- New persisted `realized_trades.market_durability` column ('durable'|'ephemeral'), stamped at insert time by `backfillRealizedTrades` (both paths) going forward; `POST /api/admin/backfill-market-durability` for the ~21,879 existing rows (pure in-DB classification, no external calls, safe to re-run).
- `_computeRoiLeaderboard`: eligibility gate changed from `u.is_whale = true` to `rt.market_durability = 'durable'`. Capital/whale status no longer gates the leaderboard anywhere.
- `_buildTraderCards` and `_buildTraderProfile` (best/worst call, specialty, headline) now source from durable trades only — full trade history on the profile stays UNFILTERED (nothing hidden), with an explicit `ephemeral_excluded_count`/note and a per-row Scope column.
- New `scope_label` field ("Ranked on durable markets — resolving weeks or months out — n=X") travels with score+n on the leaderboard row, the card, and the profile header — same discipline as score-and-n-always-together.
- CLAUDE.md Gate 1 rewritten: premise is now "verify the durable-market cohort," not "verify the capital-selected whale set."

**Important process note — found mid-task: two previously-pushed branches had never actually reached `origin/main`** (`claude/trader-profile` @ `9f18f77`, and the `2026-07-20` SESSION_STATE.md entry below @ `b9e221d`). Earlier assumption in this session was that every pushed branch gets fast-forward-merged quickly by an external process — that's true for SOME branches but evidently not all. Merged both into this work rather than losing them. **Worth checking `git merge-base --is-ancestor <hash> origin/main` before assuming prior work landed, not just checking if the branch was pushed.**

**Active blockers:**
- **Still gated, still nothing public.** The durable-market top-10 has NOT been hand-verified against real polymarket.com profiles yet — that's the exact step that caught both the original redeemed-win bug and this selection-bias bug. Do not skip it a third time.
- **Nothing in this arc has been run against live data.** Every number above (76 wallets, 19/20 ungradeable, 18.2% durable split) came from Marc running the diagnostics against production — Code's sandbox has no network path to hyperflex.network (confirmed repeatedly) and cannot verify any of this directly. The rebuild code is written and pushed but its actual output on real data is unseen by Code.

**Queued (priority order):**
1. Deploy this branch, run `POST /api/admin/backfill-market-durability` (should clear in one call — no external dependency, unlike the redeemed-win correction).
2. Re-run `/api/admin/durable-market-scope` and `/api/predictors/leaderboard?mode=roi` to confirm the new numbers match what the diagnostics projected.
3. Hand-verify the new (durable-market, ~76-wallet) top 10 against real polymarket.com profiles. Non-negotiable, same as always.
4. Only then: flip `home-traders-preview.html` → `/` and link trader cards from nav (per the 2026-07-20 entry's queue below, still applies).

**Notes for next session:**
- `classifyMarketDurability()` (title-pattern primary, duration fallback) and `durableScopeLabel()` are the two new shared helpers — reuse them, don't recompute durability or re-derive the disclosure copy elsewhere.
- Redeemed-origin `realized_trades` rows have `opened_at` hardcoded NULL (always have — not new), so their durability classification is title-pattern-only, never duration-based. Documented in the classifier's own comment, not a silent gap.

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
