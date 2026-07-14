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

## 2026-07-14 (MAJOR: resolver bug found — 23.6% was false, real number is 58.3% / n=24)

**The single most important finding to date. Read this before touching the edge/grading system.**

**What happened:** The edge hit rate showed 23.6-24.5% (worse than random) and looked like the whale-cluster thesis was dead. Full audit (`/api/admin/edge-audit`, extended this session with `thesis_test_excluding_fast_and_sports`, `non_yes_no_side_check`, `both_sides_logged_check`) proved it was a GRADING BUG, not a signal failure.

**The bug:** `resolveSignalOutcomes` compared `predicted_side` against string literals `'YES'`/`'NO'`. But multi-outcome markets have named sides ("NOVAK DJOKOVIC", "MOROCCO", "ADOLFO VALLEJO"). Those can NEVER match `'YES'`/`'NO'`, so they were graded `wrong` unconditionally — regardless of the real outcome. 32-35 rows (grew slightly as more signals resolved mid-investigation) were structurally incapable of ever grading correct. Zero of them did.

**Confirmed clean (NOT the cause):** no out-of-band leakage (`out_of_band_in_set: 0`), no dupe/prefix-collision inflation (`prefix_collision_cluster_count: 0`), price well-distributed across the band. So this was NOT a regression of the June 22.6% three-bug incident — different bug entirely.

**Also found (confirmed, not fixed):** signal was firing mostly on fast-resolving LIVE SPORTS (42 of 55 resolved <24h — Wimbledon matches, MLB games), and the whale-consensus detector logs BOTH sides of the same event as separate signals whenever 3+ whales sit on each side (`consensusMap` keyed by `market+'||'+side`, server.js ~34950, no cross-side check before pushing a candidate) — confirmed empirically at massive scale (25 markets, up to 954 raw rows on one NBA futures market alone, spanning sports AND politics/macro/crypto). This is a real, separate detection-side bug — NOT fixed this session, deliberately deferred.

**Fixes shipped (all on `main`):**
- PR #204 (squash `a52e352`): resolver now compares named-outcome sides against the ACTUAL winning outcome name (case-insensitive, trimmed) via new shared helpers `_parseOutcomeSettlement` + `_fetchGammaKeyset`. Literal YES/NO signals keep byte-identical behavior. New signals grade correctly going forward.
- PR #205 (squash `07fb8b3`): bounded the new `POST /api/admin/regrade-named-outcomes` one-time-correction endpoint to `REGRADE_BATCH_MAX=60`/call at concurrency 5 (`_mapLimit`) — the original fully-sequential version timed out (truncated non-JSON response) against the real row count.
- PR #206 (squash `6348b4c`): instrumented *why* rows fail to regrade (`no_key` / `no_gamma_match` / `gamma_matched_but_not_decisive_or_no_outcomes_array`) — all affected rows came back `no_gamma_match`: their source markets (resolved Mar–Jun 2026) have aged out of gamma's direct condition_id/slug lookup retention. Condition_ids verified well-formed (66-char bytes32); same query shape as 5 other working call sites in the file. Not a code bug — a hard data-availability wall.
- Commit `b724f9d` (merged directly by Marc, `git merge` — GitHub connector was mid-reauth): the regrade endpoint now STAMPS unrecoverable rows `outcome='void_ungradeable'` (previously reported-only, left untouched) — excluded from correct/wrong and hit-rate math everywhere. `GET /api/edge/receipts` → `record.alltime.void_ungradeable` (count) + `void_reason` (full explanation), computed from the same deduped population as `graded`/`correct`/`wrong`. **The wound is visible, not hidden — this is deliberate and must stay: a track-record product cannot silently shrink its denominator.**

**The real number now (live-verified post-deploy):** `alltime` = graded 24, correct 14, wrong 10, **hit_rate 58.3%**, avg_pnl_per_dollar 0.92, void_ungradeable 35.

**Against the publish gate (n≥30 AND ≥58%):** hit rate CLEARS 58% (58.3%); sample size does NOT (n=24, need 30). **STILL UNPUBLISHED.** Do not publish the hit rate, do not touch landing, no founder posting until n≥30 holds ≥58%.

**Status of the thesis:** was "possibly broken," now "looks real, unproven — needs ~6 more decided events to cross n=30." Fundamentally healthier failure mode. The resolver fix means n now climbs cleanly on its own; the moat (compounding graded record) is finally accumulating instead of being corrupted.

**Next when picking this back up:** re-run `/api/admin/edge-audit` once n has grown past 30; confirm 58%+ holds before any publish decision. Separately, the both-sides-logged detection bug is CONFIRMED but UNFIXED — decide whether whale_cluster should exclude fast-resolving sports/live markets entirely, add a mutual-exclusivity check (suppress logging both sides of one event), or both. Not scoped yet — Marc's call on priority.

## 2026-07-14 (Mantra change, Anthropic credit outage, desktop UI status)

**Mantra changed** (in CLAUDE.md): from "industry standard for building on top of Polymarket" → **"On-chain needs a real track record. HYPERFLEX is the verified track record layer for on-chain traders."** Mission is on-chain-wide; Polymarket is venue #1, not the identity or ceiling. On-chain expansion (Hyperliquid named as first candidate, per PR on branch `claude/onchain-expansion-thesis-9trllr`) is DOCUMENTED but PARKED — no second venue until the Polymarket grader produces a defensible number. Perps = a second grading engine (entry/exit, leverage, funding, no resolution event), not a config change.

**⚠️ Anthropic API was OUT OF CREDITS** (platform-wide) as of this session. The single `ANTHROPIC_API_KEY` powers news→market matching, market auto-creation, YouTube scanner, news-impact sentiment, thesis generation. **IMPORTANT: grading does NOT depend on Anthropic** — traced the whole whale_cluster grade pipeline, it's 100% deterministic SQL/arithmetic (confirmed again independently by the resolver-bug investigation above). So the credit outage never affected the edge number. News-feed matching itself was hardened separately (PR #200, squash `f73f579`): `_haikuPickMarket` now returns `{result, apiError}` and `_resolveMatchCached` falls back to keyword matching only when the Haiku CALL fails (billing/rate-limit/network), never when Haiku genuinely judges "no match" — so a future outage degrades to keyword matching instead of silently nulling every headline.

**Desktop homepage UI:** still not right per Marc as of last check. Cards were resized via inline-style fix (CSS was being overridden by JS inline styles — that was the recurring "nothing changes" bug). Cards now larger, but Marc reported text still too small + dead space remains. Some dead space is empty AI-fed rows (was credit-blocked). Font sizing may be the same inline-style issue one layer over (card title/label fonts set inline in JS). Viewport meta confirmed correct (`width=device-width,initial-scale=1`) — NOT a viewport bug. Not picked back up this session — still open if Marc wants it next.

## 2026-06-21 (Grader fix — resolved markets that aged out now grade)

**Diagnosis (confirmed live):** pending climbed but graded frozen at 13. `resolveSignalOutcomes` runs fine; its only resolved-outcome source was a bounded recent/high-volume closed-market gamma fetch (~400 markets). WC matches settled days ago are in none of it → never grade, never expire (<60d) → pending forever. It was case (c).

**Shipped (branch `claude/keen-ride-do3ml2`):** Source 4 — targeted resolution probe in `resolveSignalOutcomes` (`server.js:~58807`). Per still-unmatched pending call, search gamma CLOSED markets by question, pull settlement into priceLookup. Bounded 30/run, 200ms-spaced, deduped. Purely additive + conservative (only adds resolvable markets; still requires definitive 0/1 to grade) → no regression risk.

**Open follow-up (#2, not done):** WC match FINAL pages 404 — `/api/worldcup/match/:slug` reads only the active alpha cache (`server.js:36022`); resolved matches left the `closed=false` feed. Same root (no resolved-market persistence). Fix: WC page falls back to a resolution lookup instead of 404.

**Verify after deploy:** Railway `[intelligence] targeted resolution probe: searched N…` then `[intelligence] Resolved N signals` N>0; `/api/edge/track-record` last30d.graded off 0, pending draining.

## 2026-06-18b (Ledger starvation fix — wire consensus detector → ledger)

**Diagnosis (confirmed live by Marc):** `/api/signals` returned ZERO whale_cluster (only 2 momentum). The `[whale-consensus]` detector fires reliably but only wrote `whale_consensus_signals` + feed — never `logSignalOutcome`. Two parallel detectors, never connected. signal_outcomes starved ~30d (13 decided + 8 pending, all >30d old).

**Shipped (branch `claude/keen-ride-do3ml2`, in PR #188):**
- **HOLE 1 (fix):** `server.js:~35098` — consensus per-candidate loop now calls `logSignalOutcome({type:'whale_cluster', side, yes_price, whale_count, ...})` through the EXISTING band gate + dedup (no bypass). yes_price = live screener price if matched, else derived from whales' avg side price (`side==='YES'?avg:1-avg`) — so it does NOT depend on the brittle screener question-match.
- **HOLE 2 (diagnosed, not patched):** the `/api/signals` whale_cluster source (`52786`) throws away each whale-index pick's own `yes_price` and re-demands an exact lowercased screener question-match (`52800`/`52810`) → silent zero on title drift. Redundant as a ledger writer now; still feeds the /api/signals UI list. Recommendation: leave it; optionally make robust later by using the pick's own yes_price.

**Active blockers:** (none) — band gate/dedup/grading untouched per Marc.

**Verify after deploy:**
- `curl /api/signals` → whale_cluster entries appear (when consensus live + in-band)
- Railway: `logSignalOutcome` inserts after `[whale-consensus] NEW` fires
- `curl /api/edge/receipts` → `record.pending` climbs above 8
- within a day: `last30d.graded` moves off 0 as fresh calls resolve

**PR #188:** open, base main, subscribed (CI green: boot ✓ + 3 guards ✓). This fix pushes a new commit → CI re-runs.

## 2026-06-18 (Edge track record — record + grade + publish every high-reward pick)

**Shipped (branch `claude/keen-ride-do3ml2`, hash in `git log origin/claude/keen-ride-do3ml2 -1`):**
- `lib/edge-grade.js` (pure, 13 tests pass) — defines "true high-reward pick" + A/B/C grade + reward_ratio + published `methodology()`. Caught + fixed a real `Number(null)===0` price bug.
- `server.js` — `buildAlphaList` tags every market `edge_grade`/`is_edge_pick`/`reward_ratio`; `logEdgePicks()` records top A/B picks to `signal_outcomes` (`signal_type='edge_pick'`, graded by the existing resolver); new public `GET /api/edge/track-record` (decided-only, deduped, wins+losses, methodology); `/transparency` + `/track-record` routes + RESERVED_SLUGS.
- `public/transparency.html` — new charter-compliant flagship track-record page (gated, honest empty state). Nav link added; "Full track record →" link from alpha-live receipts.
- **Follow-through (Marc's two calls):** (1) `app.get('/accuracy', 301 → /transparency)` ABOVE the static handler — kills the hardcoded-"74%" landmine, one honest surface. (2) Edge grade A/B/C badge now visible on every alpha-live screener card (NO hard gate — a visible "C" is honest signal); ungraded markets show no chip.

**Active blockers:**
- (none) — but the edge_pick ledger starts EMPTY; numbers populate only after picks log + their markets resolve (days). This is correct, not a bug.

**Queued (priority order):**
1. **Marc/next session verify post-deploy:** (a) `curl -s /api/edge/track-record` → `record` (likely zeros at first) + `methodology` non-null; (b) Railway log `[edge-pick] recorded N grade A/B picks to the ledger` after a screener refresh; (c) `record.pending` > 0 within ~10 min; (d) first CORRECT/WRONG rows as markets resolve; (e) `/transparency` renders, hero stays "—" until ≥10 decided; (f) `/accuracy` 301s to `/transparency`; (g) A/B/C chips render on `/alpha-live` cards.
2. **Grade A/B as the DEFAULT screener filter** (Marc, deferred "eventually"): land new users on the quality view, keep an "all grades" toggle. UI default + filter-state work on alpha-live (and /screener if applicable) — NOT a hard gate. The badge (done) is the prerequisite; this is the next step.
3. **Surface 30d hit rate on landing once proven** (inherited, still gated until real numbers).

**Open questions / unverified:**
- Sandbox can't reach prod/DB — all 5 verify items above are prod-only (Marc or a deployed-curl).
- Will grade A/B picks actually appear regularly? Score ≥67 needs real multi-signal confluence (e.g. whale 35 + velocity 25 + volume). If few qualify, that's the honest message ("few true high-reward markets right now"), not inflation — do NOT lower the floor to manufacture picks.

**Notes for next session:**
- ⛔ `updatePlatformMetrics` headline stays whale-cluster-only (`WHALE_EDGE_SQL`). edge_pick is a SEPARATE published population on `/api/edge/track-record`. Don't merge the two denominators.
- Branch `claude/keen-ride-do3ml2` diverged from origin/main (June 4 merge-base; my branch is newer/June 18). Merge to main is Marc's call.

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

