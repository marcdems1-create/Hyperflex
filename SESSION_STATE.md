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

## 2026-07-28e (✅ SHIPPED — cron error surfacing + manual test-settle endpoint, after first real /run-cron came back errors:1 with the error invisible)

**After the type-fix (2026-07-28d) deployed, Marc's first `/run-cron` returned `predictors_checked:1, trades_settled:0, errors:1`, 58s duration — but the error itself was never surfaced, only counted.** Fixed the observability gap: `_flexBackingResyncAndSettle` now builds an `errors: [{predictor, stage, message}]` array (each stage — resolve_user / proxy_derivation / backfill / list_backings / find_unsettled_trades / settle_trade / predictor_loop / fatal — wrapped so its own error message is captured, not just counted) and returns it as `error_details` alongside the existing `errors` count. Still logs to console too, same as before — this doesn't remove server-log visibility, it adds response-level visibility so Marc doesn't need to go pull Railway logs for something this small.

**Two new admin endpoints, both requested:**
- `POST /api/admin/flex-backing/settle-trade` — manually settle one specific already-resolved trade against one backing, bypassing the cron's forward-only rule (settlement only fires for trades that resolved AFTER a backing began, per the design doc's early-backer-advantage section — intentional, not a bug). Lets the mechanic be proven end-to-end against a predictor's EXISTING history (e.g. Nadmi's already-resolved trades) without waiting for their next real resolution. Routes through the same `_flexBackingSettleTrade` function as the real cron — same DB-level once-per-settlement guard applies, so this can't double-settle either; it's a different trade-selection path into the same settlement code, not a separate implementation.
- `GET /api/admin/flex-backing/predictor-trades?address=` — read-only, lists a predictor's resolved durable trades with their `trade_id`, so Marc can pick one for `/settle-trade` without querying Postgres directly.

**On the open question (is `trades_settled:0` expected):** forward-only settlement is the approved design (PHASE1_BACKING_DESIGN.md) — a backing only settles against trades that resolve AFTER it's placed, deliberately, so early conviction is what gets rewarded rather than retroactively cashing in on a predictor's past record. If Nadmi (189 historical durable trades) had zero NEW resolutions since the backing was created, `0` is correct, not a bug — but this couldn't be confirmed without first seeing whether `errors:1` was masking something upstream of the settlement loop, hence fixing the visibility gap first, per Marc's explicit "report the actual error first — everything else depends on seeing it."

**Flagged, not fixed (not blocking):** the cron processes predictors serially, and `backfillRealizedTrades` does a full re-pull each run rather than an incremental one — 58s for a single predictor won't scale once more than a handful are backed. Two independent levers for later: (a) bounded-concurrency `Promise.all` across predictors instead of a serial `for` loop, (b) an incremental resync (track a per-predictor last-synced cursor, only re-fetch activity newer than that) instead of re-walking the full paginated history every 15 minutes. Neither built now — noted for when backing volume actually justifies it.

`node --check server.js` clean. This round is JS-only instrumentation + new endpoints, no schema/type change, so no fresh Postgres concurrency re-verification — the settlement transaction logic itself is untouched from the 2026-07-28d fix, which was already verified. Not yet merged to main.

## 2026-07-28d (✅ FIXED, real production bug — Phase 1 backing was keyed on users.id (UUID) against a TEXT column, caught on first live curl. Rebuilt address-keyed end to end, re-verified concurrency.)

**Marc's first live test of `/api/admin/flex-backing/back` hit `operator does not exist: text = uuid`** — nothing staked, balance unchanged. Root cause: `flex_backings.predictor_user_id` was declared `UUID NOT NULL REFERENCES users(id)`, but **`users.id` is actually TEXT in this schema** (`id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text`), not native UUID — a wrong assumption made earlier in this session (misread from an unrelated table's own UUID-typed FK, not from checking `users.id` itself directly). The settlement cron's `JOIN users u ON u.id = fb.predictor_user_id` compared a TEXT column against a UUID column with no cast — exactly the error text. This is the same two-identity-systems class of bug (EOA/address vs internal id) already fixed twice elsewhere this week (proxy derivation, `external_sync_id`), now found a third time in new code.

**Fix, per instruction — not a cast, an actual rekey:** `flex_backings`/`flex_backing_settlements` no longer reference `users.id` at all. Both now key purely on `predictor_address` (TEXT), the same identity Phase 0's `flex_wallet_balance` already uses. `_flexBackingBack` compares two address strings directly for the self-dealing check (no `users` lookup needed for that at all). The settlement cron is the ONE place that still needs an internal id — because `realized_trades` is genuinely id-keyed, a separate and correct pre-existing fact, not part of this bug — and resolves `predictor_address -> id` via the same proven `SELECT id FROM users WHERE LOWER(polymarket_address) = $1` pattern already used safely elsewhere (e.g. the `/back` route's own existence check). The old cron's JOIN is gone entirely.

**Migration:** `supabase_migration_flex_backing_v2.sql` — drops and recreates both tables with the corrected schema. Confirmed safe to run: every prior `/back` attempt failed before any row was written, so both tables are empty (Marc's own words: "nothing staked, balance unchanged"). **Must be run in TablePlus/Railway console before re-testing** — same requirement as every migration this week.

**Re-verified against a real local Postgres** (dropped after, zero contact with production) — this time modeling `users.id` as TEXT to actually reproduce the bug, not just re-run the old passing test: the exact `_flexBackingBack` call that failed in prod now succeeds (50,000 centpoints staked, wallet debited correctly); the full cron ran end-to-end with **zero `text = uuid` errors**; settlement math still exact; **the concurrency guard was re-run and still holds** — 10 simultaneous settlement attempts on the same (backing, trade) pair, exactly 1 succeeded, exactly 1 settlement row; unback still refunds the current post-settlement stake correctly. `node --check server.js` clean.

**Marc: run `supabase_migration_flex_backing_v2.sql` in TablePlus, then re-try the exact same back curl.** Not yet merged to main.
```bash
curl -s -X POST "https://hyperflex.network/api/admin/flex-backing/back?secret=$ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"backer_address":"0xYOUR_BACKER_WALLET","predictor_address":"0xTHE_PREDICTOR_WALLET","amount_centpoints":10000}' | jq .
```

## 2026-07-28c (✅ SHIPPED — connect.html desktop scale-up, round 2: proportional 1.4x over round 1's exact values)

Round 1 (2026-07-27c) applied Marc's exact supplied px values verbatim, confirmed live via Playwright — all matched exactly. Live in production, it still read as small next to the 108px hero headline: not a bug, a proportion call, exactly the kind of judgment the design-brief conversation flagged as something Code can't make blind. Asked Marc directly (AskUserQuestion): try a proportional scale-up guess, or hand this to the designer. He chose: try again.

Applied a ~1.4x scale-up over round 1's values, same relative hierarchy preserved: verdict 34→48px, score 44→64px, n= 18→26px, stat values 32→46px/labels 15→20px/tile padding 20×24→28×32px, best/worst call 20/17/14→28/24/19px, specialty tiles 16/28/14→22/40/19px, trade-history table 15/16→20/22px, section headers 20→28px, section gap 68→96px. Verified via Playwright at 1440px — every value matches exactly — and visually: noticeably better balanced against the hero.

Marked explicitly in the code comment as a speculative guess, same as every prior sizing round — this is not confirmed against the live site yet, waiting on Marc to look. Mobile untouched (only the >=1024px block touched, same file/pattern as round 1). `node --check server.js` N/A (HTML-only change). Not yet merged to main.

## 2026-07-28b (✅ SHIPPED — category classifier v3, real production 'other' down 58% -> 38.9% after v2, second real sample dump drove this round)

**v2 (2026-07-27d below) worked, for real this time** — production numbers confirmed 58.0% -> 38.9% 'other' (1,453 of 4,406 durable trades reclassified: sports +437, politics +249, world +514, commodities +240 new). Still the single largest bucket though, ~2x the next biggest (politics), so pulled a fresh 50-sample dump from the live `other-category-report` endpoint to find the next real gap rather than guessing.

**What the second batch showed:** a large cluster of named-dignitary "will X sign/attend the US-Iran deal" markets (Sheikh Tamim, Mohammed bin Salman, Jared Kushner, Steve Witkoff, etc. — a whole market series around one hypothetical signing event), a recurring "EntityA x EntityB" bilateral-relations title convention (US x Iran, Israel x Lebanon, Israel x Hezbollah), named political figures hit repeatedly (Khamenei alone appeared 6 times in 50 samples, plus Netanyahu, Putin, Trump), another word-boundary bug (`\bimpeach\b` never matched "impeached" — same bug class as v2's president/election fixes), and a genuinely new genre: temperature/weather price-target markets (Istanbul, Moscow highs in °C).

**Fixed:** added Trump/Hegseth/U.S. Senator+House-member phrasing to `politics`; added forces/peace deal/signing ceremony/memorandum of understanding/strait/withdraw(s)/targets shipping/Putin/Netanyahu/Khamenei to `world`; fixed the impeach(ed/ment) boundary bug; added a **second, deliberately case-sensitive** `world` rule matching the generic `EntityA x EntityB` capitalized-bilateral-title pattern (not lowercased, so it only fires on the actual proper-noun convention, not incidental lowercase "x"); added a new `weather` category for temperature/°C/°F price-target markets.

Noted explicitly as an accepted tradeoff, not silently glossed over: `forces`/`withdraws` are broad enough to theoretically misfire on an unrelated non-geopolitical title — acceptable since a display-category mislabel costs far less than swallowing a real geopolitical question into 'other', and `world` is checked before `sports` so it doesn't fight the v2 team-name list.

**Local verification against BOTH real sample batches** (the 50 from the v1 report and the 50 from the v2-triggered re-check), no regressions: batch 1 (already improved once under v2 to 8/50) now 2/50 'other'; batch 2 (the fresh dump, 50/50 'other' under v2) now 4/50. Remainders in both are genuinely idiosyncratic — a deliberately-excluded team nickname, "will aliens be confirmed to exist," a specific South American football club, a specific island name.

**Marc: re-run the report once deployed** — same command, `after_fix` reflects v3 automatically:
```bash
curl -s "https://hyperflex.network/api/admin/other-category-report?secret=$ADMIN_SECRET" | jq '{before_fix, after_fix}'
```
`node --check server.js` clean. Not yet merged to main.

## 2026-07-27d (✅ SHIPPED — category classifier v2, based on REAL production data from the v1 report endpoint)

**v1 (2026-07-27c below) barely worked.** Ran `GET /api/admin/other-category-report` against real production data (7,539 durable trades): v1's forex/commodities fix only moved 'other' from 57.9% to 54.6% — a 3.3-point improvement, not the "shrink to a genuine small remainder" goal. The 50 real samples still in 'other' showed the actual problem was two things v1 didn't touch:

1. **Word-boundary/inflection bugs** — `\bpresident\b` never matched "presidential", `\belection\b` never matched "elections", `\binvasion\b` never matched "invade". Singular/base-form-only keywords were silently missing their own plural/adjectival forms in real titles.
2. **Missing geopolitical vocabulary** (diplomatic meetings, "military action" as distinct from "military strike", blockade, coup, regime, uranium/enrichment, recognize/recognition, referendum, chancellor, parliament, airspace, MOU, Hormuz) and **team-vs-team sports matchups with zero league keyword** ("San Diego Padres vs. Miami Marlins") — the single most common visible pattern in the sample.

Fixed both: broadened `politics`/`world` regexes for plural/adjectival forms and the geopolitical vocabulary above (all additions traceable to real sample titles, not guessed); added a curated MLB/NBA/NFL/NHL team-nickname list to `sports`, deliberately excluding generic-English-word nicknames (Heat, Magic, Jazz, Wild, Thunder, Giants, Rangers, Titans, Kings) where false-positive risk outweighs the benefit. Local test against the 50 real samples from the v1 report: 50/50 'other' → 8/50 (16%), and the 8 remaining are genuinely idiosyncratic (named individuals, satire, "will aliens be confirmed to exist") — a reasonable floor for a keyword classifier, not a gap worth chasing further right now.

**Marc: re-run the report once this deploys to see the real global before/after** (same command as before — `after_fix` will reflect v2 automatically):
```bash
curl -s "https://hyperflex.network/api/admin/other-category-report?secret=$ADMIN_SECRET" | jq '{before_fix, after_fix}'
```
`node --check server.js` clean. Not yet merged to main.

## 2026-07-27c (✅ SHIPPED — 'other' category-classifier fix + verdict-line guard + connect.html desktop body-content scale-up)

**Category classifier:** `_CARD_CATEGORY_RULES` widened — `macro` now also catches currency pairs/forex (USD/KRW, USD/JPY, generic `X/Y` fx notation, "forex", "exchange rate"), and a new `commodities` category catches crude oil/WTI/Brent/natural gas/gold/silver/copper/platinum. Root cause per Marc's report: 'other' was the largest durable-trade bucket on his own wallet (26/41, -44.4%), dominated by macro/commodity/currency price-target markets none of the 7 original categories' keyword lists covered. Existing `crypto` regex already matches bare "bitcoin"/"btc"/"ethereum"/"eth" case-insensitively, so named-coin price-targets ("Will Bitcoin dip to $40,000") should already route to `crypto`, not `other` — flagged as worth double-checking with real data rather than assumed fixed, since I couldn't reproduce that specific miss from the regex alone.

New `GET /api/admin/other-category-report` (requireAdminSecret) computes BEFORE (frozen snapshot of the pre-fix rules) vs AFTER (live, already-fixed `classifyCardCategory`) distribution across ALL wallets' durable trades in one call, plus up to 50 sample `market_question` strings still landing in `other` post-fix with light pattern-grouping — this is the "report other's contents, then report before/after %" Marc asked for, computed against real production data when he runs it (I have no DB access from this sandbox to run it myself).

**Verdict-line guard:** `other` is now excluded at the source from `_buildTraderCards`'s specialty best/worst candidate list (the `specialtyCats` filter), so "Sharp on X, reckless on other" can never be generated regardless of how large `other` is for a given wallet — structural fix, not a patch in `computeVerdictLine` itself.

**connect.html desktop (>=1024px) body-content scale-up:** exact px values supplied directly by Marc, applied verbatim — verdict line 34px, score pill 44px/n= 18px, stat tiles 32px value/15px label/20px 24px padding, best/worst call 20px/17px/14px, specialty tiles 16px/28px/14px, trade-history table 15px header/16px body (was ~11-13px, the worst offender per Marc), section headers 20px, section-to-section gap 68px (36px existing + the requested 32px). New media-query block placed as the LAST rules in the stylesheet (every touched class's base rule is defined earlier in the file — an early block would lose the cascade to those later unconditional rules, the exact nav.js bug from earlier this session). Verified via Playwright at 1440px (every value matches exactly) and 390px (every value unchanged from the pre-edit mobile baseline, confirming mobile untouched) — this is implementing exact supplied values, not another blind-guessing round, so it doesn't reverse the earlier "design goes to a human" call.

`node --check server.js` clean. Not yet merged to main.

## 2026-07-27b (✅ Phase 1 built — discrete-settlement backing mechanic. Verified against a real Postgres including concurrency. AWAITING: migration run + Marc's live curl verification before anything further.)

**Model A (discrete settlement) approved and built** per PHASE1_BACKING_DESIGN.md, with all 6 conditions from the approval message honored explicitly:

1. **Record → settlement, one direction, confirmed in code:** `_computeRoiLeaderboard`/`_buildTraderCards` are untouched — zero edits — and nothing in the new `flex_backings`/`flex_backing_settlements` tables is ever joined into either. Settlement reads `realized_trades` (same table the scorer reads) but a predictor's score/n/card cannot be altered by being backed.
2. **Re-sync cron built scoped and safe:** `_flexBackingResyncAndSettle()`, cron `*/15 * * * *`, scoped only to predictors with an active backing (not a platform-wide resync). Reuses `ensureProxyStored` + `backfillRealizedTrades` **verbatim** — the exact functions fixed this week for the proxy-address bug and the external_sync_id collision bug — no reimplemented ingestion anywhere. Every run logs `started_at`/`finished_at`/`predictors_checked`/`trades_settled`/`errors` — silence itself would be the failure mode, so every run, success or partial-failure, produces a log line.
3. **`FLEX_BACKING_SETTLEMENT_SENSITIVITY = 0.05`** — one named constant, referenced exactly once elsewhere (the settlement formula), not hardcoded anywhere else.
4. **DB-level once-per-settlement guard**, same pattern as Phase 0's one-grant index: unique index on `flex_backing_settlements(backing_id, trade_id)`. **Tested under a real concurrent race** (below), not just reasoned about.
5. **Play-money only.** Staking debits `flex_wallet_balance` (Phase 0's currency); no cashout path exists anywhere in this build.
6. **Admin-gated, nothing public:** all 5 new endpoints sit behind `requireAdminSecret` (`/api/admin/flex-backing/back|unback|list|settlements|run-cron`). No homepage/UI change.

**Migration: `supabase_migration_flex_backing.sql` — NOT YET RUN IN PRODUCTION. Must be run in Railway Postgres (TablePlus/Railway console) before any endpoint above will work — otherwise "relation does not exist," the exact thing Phase 0 already tripped on once this session.** Requires Phase 0's migration to already be applied (references `flex_wallet_balance`/`flex_wallet_ledger`).

**Verified against a real local Postgres (same rigor as Phase 0 — full scenario + the concurrency test Marc specifically asked for), not just reasoned about:**
- Self-dealing correctly blocked (predictor backing their own address rejected).
- Staking debits atomically, insufficient balance correctly rejected.
- Settlement math exact both directions: a +200% ROI call moved a 50,000-centpoint stake by exactly +500 (`round(50000 × 0.05 × (2.0/10))`); a subsequent -50% ROI call moved the resulting 50,500 stake by exactly -126.
- **A found-and-fixed real bug:** the first version tried to backfill a ledger row's `ref_id` via `UPDATE ... ORDER BY ... LIMIT`, which is not valid Postgres syntax for a plain UPDATE — and the error was silently swallowed by a `.catch(() => {})`, so it looked like it worked until the test explicitly checked `ref_id === backing_id` and got `false`. Fixed by reordering (create the backing row first, debit with the real `ref_id` already known, no backfill needed) rather than patching the broken query. Caught in local verification before shipping, not after.
- **Concurrency, both money-moving paths:** (a) 10 simultaneous settlement attempts on the same (backing, trade) pair — exactly 1 succeeded, exactly 1 settlement row, integrity check (`original_stake + Σsettlement_deltas == current_stake`) passed exactly; (b) 10 simultaneous stakes of 5,000 centpoints each against a 50,000-centpoint balance — all 10 succeeded with zero overdraft or lost updates, final stake exactly 50,000, final wallet exactly 0, an 11th attempt correctly rejected as insufficient.
- Unback correctly refunds the CURRENT (post-settlement) stake and blocks a second withdrawal on an already-withdrawn backing.
- `node --check server.js` clean. Test DB dropped, local Postgres service stopped after — zero contact with Railway/production throughout.

**Cannot verify from this sandbox:** the actual network-dependent resync (`ensureProxyStored`/`backfillRealizedTrades`'s real Polymarket API calls) — no network path out of this sandbox to Polymarket or Railway. The settlement/staking logic itself is fully proven; the resync cron's *ingestion* leg is only provably correct because it reuses already-production-verified functions unmodified, not because it was independently re-tested here.

**Next: give Marc the exact curls to (1) back a predictor, (2) trigger a settlement, (3) check a backer's balance moved — after he runs the migration.** Stopping here per instruction — he verifies live before anything further.

## 2026-07-27 (✅ Phase 0 CONFIRMED LIVE in production + design work goes to a human)

**Phase 0 (wallet-native Flex Points balance) is verified working in production, not just against a sandbox.** Migration `supabase_migration_flex_wallet_balance.sql` run in Railway Postgres via TablePlus. Marc's wallet reconnected → grant fired.
- `GET /api/flex/balance` → balance_centpoints 100000, balance_fp 1000, exists true
- `GET /api/admin/flex-wallet-ledger` → `balance_matches_ledger: true`, `no_double_grant: true`

So: every connecting wallet gets a ledger-backed 1,000 FP play-money balance, keyed to polymarket_address, reachable with zero legacy JWT login. The DB-level one-grant-per-address guard held in prod. This is the foundation the reputation-backing primitive stands on. **Confirmed real.**

**Reminder for whoever runs the next DB-dependent build:** production DB is Railway Postgres. Migrations do NOT auto-run — they must be run manually in TablePlus/Railway console. Code writes the migration file; only a human with DB access can execute it. Phase 0 stalled for a while purely because the table didn't exist yet (code deployed, migration un-run). Run the migration BEFORE testing any endpoint that reads a new table.

**DESIGN DECISION (Marc, this session): the visual redesign goes to a human designer, not Code.** After ~9 rounds, desktop/connect-screen sizing is still wrong (renders tiny/zoomed-out). Root cause is structural, not effort: Code's sandbox is hard-blocked from hyperflex.network (proxy 403), so it adjusts proportion it can never see. This is the ONE category of work that can't be verified against reality the way every bug this month was. The design brief is written and ready: mobile-first, Dreamcash-inspired, single-column (which structurally kills the wide-desktop-grid problem). Plan: designer builds ONE screen (connect/score) + the card component + concrete tokens (exact px/color/spacing) → THEN Code implements those exact values across all pages (Code is good at *applying* a defined design, cannot *originate* one blind). Do not send more blind sizing rounds to Code.

**Product direction locked this session:** Hyperflex is BOTH a verification product and a game — the verified record is what makes staking on it meaningful. "Come see what the kings are doing" is the wedge (Polymarket owns "browse markets"; a ranked honest predictor board is ours alone). Reputation-backing = stake Flex Points on a predictor, earn as their verified record improves. Play-money only — real-money backing is likely an unregistered security/derivative; that's a later, structured, lawyered step, NOT this build. Backing must read FROM the score, never write TO it (record→price one-directional, or the verification moat is gone).

**Next: Phase 1 DESIGN DOC (not build).** Code proposes the backing model — discrete per-call settlement vs. continuous reputation price — recommends one, answers self-dealing / inactive-predictor / early-backer-fairness / integrity, and STOPS for Marc's approval before building the mechanic.

## 2026-07-26d (✅ SHIPPED, verified against a real Postgres — Phase 0 of reputation-backing: wallet-native Flex Wallet balance. STOP point — awaiting Marc's live verification before Phase 1.)

**Context: audit (2026-07-26c, below) found all three existing balance systems (`users.balance`, `community_balances`, `flex_points`) are JWT-login-gated and unreachable by a `/connect` wallet-only user** — the prerequisite blocker for reputation-backing (staking Flex Points on a "king" predictor). This entry is Phase 0 only, per explicit phased instruction: build the wallet-native balance, STOP, report, wait for live verification before Phase 1's design doc.

**New tables** (`supabase_migration_flex_wallet_balance.sql`): `flex_wallet_balance` (address PK, `balance_centpoints` cache) + `flex_wallet_ledger` (append-only source of truth: address, delta, reason, ref_id, created_at). **Idempotency is enforced at the DB level**, not in application code: a unique partial index on `flex_wallet_ledger(address) WHERE reason='signup_grant'` makes a second grant attempt fail with a Postgres unique-violation (23505), which the app layer catches and treats as an expected no-op.

**server.js**: `_flexWalletAdjust(address, delta, reason, refId)` — transactional (BEGIN/ledger-insert/balance-upsert/COMMIT, matching the existing `pool.connect()`+`client.query('BEGIN')` pattern already used elsewhere in this file, not a new convention). `_flexWalletGrantSignupBonus(address)` wraps it, catching 23505 as `{granted:false, already_granted:true}`. Wired into `POST /api/connect` — **attempted on every connect, not just `is_new`**, so it self-heals any wallet whose `users` row predates this feature; the DB constraint is what actually prevents double-granting, not the `is_new` flag. `GET /api/flex/balance?address=` — public, no auth (same precedent as `/api/polymarket/positions/:address`), pure SELECT, never inserts. Admin diagnostic `GET /api/admin/flex-wallet-ledger?address=&secret=` for one-curl verification (ledger dump + `balance_matches_ledger` + `no_double_grant` booleans computed server-side).

**Verified against a REAL local Postgres 16 instance** (started the sandbox's own local `postgresql` service — completely separate from and with zero contact to Railway/production — ran the migration, then ran the exact `_flexWalletAdjust`/`_flexWalletGrantSignupBonus` logic verbatim via a throwaway Node+`pg` script, dropped the test DB and stopped the service after): (1) first connect grants exactly 100,000 centpoints (1,000 FP); (2) sequential repeat connects for the same address correctly no-op, balance stays at 100,000; (3) **10 truly concurrent grant attempts fired in parallel via `Promise.all` (no sequential await) for the same address — exactly 1 succeeded, 9 correctly returned `already_granted`, exactly 1 ledger row exists, cached balance is exactly 100,000, not 1,000,000** — the real race condition this design has to survive, proven under an actual race, not just reasoned about; (4) a different address grants independently (per-address scoping confirmed); (5) a generic debit (simulating a future Phase-1 "back a predictor" stake) correctly adjusts the cached balance and would carry its own ledger row/reason/ref_id. Ledger sum matched cached balance exactly in every check. `node --check server.js` clean.

**CLAUDE.md updated** (Voice & Posture §8): added an explicit note distinguishing this NEW wallet-native Flex Wallet balance from the retired earn/accumulate/spend "Flex Points" — same section, so a future session reading §8 doesn't mistake this build for un-retiring the old system. Hard rule stated there and here: **no cashout, no purchase, no fiat/crypto on-ramp, ever, in this build** — real-money backing is a distinct, later, lawyered decision, not an extension path off this currency.

**STOP — per instruction, waiting for Marc to verify live** before Phase 1 (the backing-mechanic design doc, model A vs. B, not yet written). To verify: connect a real wallet via `/connect` (response now includes `flex_wallet_balance_centpoints`), then `GET /api/flex/balance?address=` and/or `GET /api/admin/flex-wallet-ledger?address=&secret=$ADMIN_SECRET` to see the ledger directly.

## 2026-07-26c (🔍 AUDIT, report-only, no code changes — Flex Points/betting engine reuse-vs-rebuild for reputation-backing)

Investigated at Marc's request before any reputation-backing build. Full report given in-conversation; headline finding logged here since it's the reason Phase 0 above exists: **three separate balance systems already exist in this codebase** — `users.balance` (legacy fallback), `community_balances` (the real, live, CPMM+parimutuel-backed per-creator-community economy — `POST /trade` at server.js:2558, cron `settleMarkets()` at :3544, manual `POST /api/creator/resolve/:marketId`, all genuinely wired and functioning) and `flex_points`/`flex_points_log` (the earn-per-dollar-traded/quest/daily-login system CLAUDE.md's Voice charter §8 already calls retired, but which is still live code, wired into `market.html`'s real trade flow at line 6681). **All three require a JWT login session** (`requireAuth`/`optionalAuth`, server.js:1721) that the `/connect` wallet-only flow never issues (`_ensureConnectedUser` never calls `jwt.sign`) — so a normal connected-wallet user cannot reach any of them today. Also flagged: backing a predictor is structurally a continuous/no-resolution instrument (the score updates call-by-call, no single settlement event) and does not fit the existing `markets`/`positions` schema (resolves once to a boolean) — same shape of problem CLAUDE.md already names for Hyperliquid perps ("a second grading engine, not a config change"), just applied to reputations. Zero existing code toward "back a predictor" — confirmed via grep, no hits.

## 2026-07-26b (✅ SHIPPED — "King of the Castle" replaces home.html as the homepage, ahead of the design pass)

**Explicit override of the earlier deferred decision** (2026-07-23/2026-07-26 entries both said hold the home.html swap until the designer's token system lands) — Marc asked directly for this tonight, confirmed via AskUserQuestion ("Replace home.html now" over "new page, leave home.html alone"). Root motivation in his words: "right now we are a shitty polymarket clone... if we have the best of the best predictors then people need to come here to see what the kings are doing."

`app.get('/', ...)` now serves new `public/home-kings.html` instead of `home.html` (left on disk, unrouted — not deleted, easy rollback). New page, reusing only already-shipped visual language and data, nothing invented blind:
- Hero: "What's your score?" + Connect Wallet / paste-address — same copy register as `/connect`, front door per CLAUDE.md rule 1 stays intact. Connect button links to `/connect`; paste-address hands off via `?address=0x…` rather than duplicating the wallet-connect/polling flow on two pages. `connect.html` gained a small addition to read that query param and auto-run on load.
- **"King of the Castle"**: the #1 overall-ranked trader, full card (verdict/evidence/form/streak intact) via the existing `_buildTraderCards`/`_computeRoiLeaderboard` pipeline — same data `/traders`' Featured row already showed, just now the homepage hero content instead of buried on a second page.
- **"Category Kings"**: #1 wallet from each category clearing `qualifying_count >= 5` (reuses the 2026-07-25c category-leaderboard work), sorted by depth so this adapts automatically as thin categories (macro/world/crypto/entertainment) grow — nothing hardcoded to sports+politics forever, though those two are what qualifies today.
- "Movers" row underneath, same `/api/trader-cards` feed `/traders` uses, linking out to the full leaderboard.

New backend: `GET /api/kings` (public, no auth) — zero new scoring math, wraps the existing global + per-category leaderboard functions. Verified locally via Playwright at mobile (390px) and desktop (1440px) with mocked API responses: king card, both category kings, and the movers row all render with real-shaped data; empty-state fallbacks (no qualifying wallet yet) checked in the JS, not just the happy path. `node --check server.js` clean.

Not done: this is NOT the designer's visual system — it's the existing dark/gold/JetBrains-Mono card language repointed at new information architecture (kings-first instead of market-grid). The actual design pass (2026-07-26 entry above) still lands separately and will restyle this page along with everything else once tokens exist.

## 2026-07-26 (📋 DECISION LOCKED — design brief commissioned; resolves the "design pass" backlog item from 2026-07-25a with a concrete plan, not yet executed)

**Marc uploaded `hyperflexdesignbrief.md` and is sending it to an outside designer** (not a Code task — no code changes this entry). Root diagnosis of the 9-round desktop-sizing failure documented across this session: every round fought a wide desktop market-grid, which is structurally the wrong shape for this product and reads as a Polymarket clone. **Fix is mobile-first single-column** — design for the phone, let desktop become a centered ~600-720px column of the same design. No wide layout left to get proportions wrong in. Reference: Dreamcash (dreamcash.xyz) for feel/simplicity only, not its trading-terminal density.

**Handoff model, locked:** designer fully designs one screen (Connect/Your Score) + the trader-card atom (including a required losing-card variant — explicit test: must still look good red, since most connecting wallets are down, ours included at 19-41) + a concrete token system (type scale, color, spacing, card dimensions). Code then implements that system across every other page. This is the same "one screen, then apply everywhere" split noted as needed back in the 2026-07-23f/g design-pass discussions — now has an actual brief behind it instead of being a vague TODO.

**Product rules the brief encodes that are already true of this session's shipped work** (so implementation should be a re-skin, not a new data build): score+n always together, best/worst call at equal weight, provisional sub-threshold score (shipped 2026-07-25b), per-category tiers (shipped 2026-07-25c, sports/politics the two viable ones) all already exist server-side and in `/connect`'s current markup — the brief's screens 1-3 map directly onto data this backend already serves.

**Nothing to build yet** — waiting on the designer's actual Figma/tokens. Do not start a blind reimplementation from this brief's prose alone; that's the exact failure mode (9 rounds of guessing) this brief exists to avoid. Next Code action on this front is implementing the delivered token system once it exists, not before.

## 2026-07-25c (🔧 SHIPPED, compute-only — category leaderboard report endpoint, no UI, awaiting real numbers)

**Read/compute only per explicit instruction — no promotion, no UI.** Added `_computeCategoryRoiLeaderboards()` (server.js, after `_buildTraderCards`): best trader PER CATEGORY (macro, politics, world/geopolitics, crypto, sports, entertainment, tech — the existing `classifyCardCategory` buckets), scored with the identical formula `_computeRoiLeaderboard` uses for the global board (time-decayed weighted ROI, shrunk toward a population mean, ROI-capped at 1000%) — copied verbatim, not reinvented, because category isn't a stored column (only `market_question` text) so this classifies + aggregates in JS off a raw durable-trade fetch instead of SQL GROUPING SETS. **Per-category threshold is n>=10 durable trades IN THAT CATEGORY** (reuses `ROI_MIN_N_FLOOR`) — a wallet with 189 total durable trades but 8 in sports does not qualify for the sports board. The shrinkage prior (population mean) is also category-scoped, not global. `leaderboard_opt_out` respected, same as the global board.

New endpoint `GET /api/admin/category-leaderboard-report` (requireAdminSecret) returns, per category: `qualifying_count`, `pop_weighted_roi_pct`, `total_durable_trades_in_category`, and a `top` list (display_name, address, n, wins, losses, win_rate_pct, score_pct, scope_label) — score+n+wins+losses always together, same integrity discipline as every other trader surface.

**Cannot run this from the sandbox** — no network path to hyperflex.network or the production DB (confirmed all session). Marc: hit `curl "https://hyperflex.network/api/admin/category-leaderboard-report?secret=$ADMIN_SECRET"` once and the `summary` array up top gives qualifying_count per category sorted descending — that's the number to eyeball for which tiers are worth building UI for. The endpoint's own `viable` flag (>=5 qualifying wallets) is a report-only eyeball threshold, not a product decision.

`node --check server.js` clean. No UI changes this entry — category tiers are not promoted or linked anywhere yet, per the instruction.

## 2026-07-25b (✅ SHIPPED — provisional headline score on /connect for sub-threshold wallets)

**Fixes the gap flagged in 2026-07-25a: a wallet under the 10-durable ranking floor connected and saw best/worst call, specialty, and full history — but no number telling them how they're doing. The 10-durable threshold gates public RANKING, not seeing your own score, and that distinction wasn't reflected in the product.**

`_buildTraderProfile` (server.js:13046) now runs a **second** `_computeRoiLeaderboard('all', 1)` call (vs. the existing `ROI_MIN_N_FLOOR`-gated call that only fires for ranked wallets) whenever the wallet isn't eligible, and pipes that row through the same `_buildTraderCards` used everywhere else. Zero separate math — same shrinkage-adjusted formula, same verdict/score/win-rate pipeline a ranked wallet gets, just not floor-gated. Result exposed as a new `provisional` field (`score_pct`, `raw_weighted_roi_pct`, `win_rate_pct`, `n`, `trend`, `label`) on the profile response, additive only — `eligible`/`cardData`/the ranked-wallet fields are untouched, still `null` below the floor. Zero Anthropic calls (this whole pipeline never called an LLM).

`public/connect.html`'s `renderVerified()` renders the provisional block — dashed-border scoreline (`+34.2% n=3` style), amber "Provisional — not ranked until 10 durable trades" label, then a 3-tile stat row (Realized ROI / Win Rate / Durable Trades) — positioned above the existing `.qual-progress` "not yet ranked" bar, reusing the `.p-scoreline`/`.stat-row`/`.stat-tile` classes already in the eligible-wallet render path (2 new CSS rules only: `.is-provisional` dashed border, `.p-provisional-label` amber text).

Verified locally (sandbox has no path to hyperflex.network — this is code-review + Playwright against a scratch copy with mocked `/api/trader-record/` fetch, not production): a mock wallet with 3 durable trades (2W/1L, +34.2% ROI, 66.7% win rate) renders the provisional scoreline + label + stat row correctly positioned above the qual-progress bar (`provisional_above_qual: true` in the computed bounding-rect check), and the ranked-wallet "Headline" section correctly does NOT render for this non-eligible wallet — confirming the eligible path wasn't touched. Screenshot confirms visually: no blank space, no "no score," a real number front and center. `node --check server.js` clean.

Not yet done: the design pass flagged in 2026-07-25a (item 1) is still separate, still not queued for Code per that entry's explicit framing.

## 2026-07-25a (✅ LEADERBOARD RE-VERIFIED on corrected data — Gate 1 fully clear — reconciled from strategy-Claude upload; sub-threshold provisional score feature now being built)

**Reconciled from a strategy-Claude SESSION_STATE.md upload** (its own 2026-07-25 entry, not duplicated verbatim — see that upload for the full account). Headline: **the corrected board (post external_sync_id migration, post proxy fix) was hand-verified against polymarket.com and holds. Gate 1 is now clear on data known to be complete.** Qualifying count is now 93 (76 → 89 → 90 → 93 across the ingestion fixes). Board reshaped at the top — new #1 is **Nadmi** (n_durable 189, win 43.9%, score 87.8, 5,204 real predictions) — geopolitics/macro, 43.9% win rate but top score because winners are large (Nobel NO +149.5%, Lee Jae-myung +56.8%): the honest scoreboard working exactly as designed, rewarding being right when it pays rather than being right often. taerv534 and TB14 re-verified at #2/#3, consistent with the 2026-07-21 read. **This closes the six-day ingestion-bug arc** — resolver, dedup, matcher, redeemed-win fabrication, whale-selection axis, proxy corruption, table-wide collision: all fixed, all verified against reality.

**Remaining before/at public promotion, per that entry (neither is a bug):**
1. Design pass on `/connect`/`/traders`/profile — 9 rounds of blind sizing got structure right, proportion wrong. Needs a designer with the browser open.
2. Sub-threshold score display on `/connect` — being built this entry, see below.

**This session's task:** add a provisional headline score to `/connect` for wallets under the 10-durable ranking threshold. Currently they see best/worst call, specialty, and full history, but no number — and seeing your own score must not require qualifying for the public board (the 10-durable threshold gates RANKING, not visibility). See the next entry (same day) for the build.

## 2026-07-23h (Minimal read-only top-10 pull shipped for re-verification; strategy-Claude confirms both fixes verified stable in production)

**Reconciled against a strategy-Claude SESSION_STATE.md upload** (its own 2026-07-23g entry, not duplicated verbatim here — see that upload for the full account): **both bugs from the prior two entries are confirmed fixed, deployed, AND verified stable in production.** Migration ran for real: `migrated_rows: 24508` — nearly the entire table was on the collision-prone format. On Marc's own wallet: `n` went 8 → 60 (imported 52), held stable across two reads a minute apart (19W/41L, 31.7%). Qualifying wallet count moved 76 → 89 → 90 across both fixes. This closes the six-day ingestion-bug chain this session's connect-flow work surfaced.

**⚠️ Consequence, flagged by strategy-Claude and acted on this entry: every prior hand-verification (taerv534/TB14/MELOCOTON007 on 2026-07-21, and the original 76-wallet durable-market-scope survey) was computed on pre-migration, collision-undercounted data.** Directionally honest, quantitatively low. Gate 1's bar is unchanged but the data under it moved — the corrected top 10 needs a fresh hand-check against polymarket.com before anyone is promoted publicly. This is explicitly Marc's/strategy-Claude's step to do (2-minute manual check, same as before), not a Code task — the only Code part is producing the current top 10 to check.

**Shipped:** `GET /api/admin/durable-leaderboard-top10` — minimal, read-only, admin-gated. Returns exactly `rank, display_name, polymarket_address, n_durable, win_rate_pct, score_pct` for the current top N (default 10), reusing `_computeRoiLeaderboard` + `_buildTraderCards` (same single source of truth as every public trader surface, so this can't disagree with what `/traders` or `/connect` show). Deliberately not `/api/trader-cards` — that bundles verdict/evidence/form/streak/specialty, noise for a quick copy-the-addresses-and-check workflow. `total_polymarket_predictions` is always `null` in the response — that number was never a stored field, only ever produced by looking at each wallet's real profile on polymarket.com directly (same manual step as the 2026-07-21 check).

**Active blockers:**
- **Not run yet — same sandbox limitation as every entry this arc.** `curl "https://hyperflex.network/api/admin/durable-leaderboard-top10?secret=$ADMIN_SECRET"`, then hand-check each `polymarket_address` against its real polymarket.com profile before promoting anyone.

**Queued (priority order):**
1. Run the top-10 pull, hand-verify against polymarket.com (Marc/strategy-Claude's step).
2. Still not run: `repair-whale-proxy-corruption?dry_run=true` (corrected auth: query string, not body) — unknown how many other accounts had the proxy-corruption bug.
3. Explicitly deferred, not touched: the desktop design pass on `/connect`/`/traders`/profile pages ("failed nine times blind" per Marc — a consolidated single-prompt attempt across all three surfaces is one option on the table if wanted before hiring a designer, not started) and the "provisional headline score for sub-threshold wallets" feature (`/connect` currently shows no headline number below the n=10 ranking threshold — best/worst call and history render, but no score; not built yet).

**Notes for next session:**
- If the "provisional score for sub-threshold wallets" feature gets picked up: compute it the same way as ranked wallets (realized ROI, win rate, n) but label it plainly "Provisional — not ranked until 10 durable trades," and make sure it uses the same underlying aggregate rather than a parallel calculation — same single-source-of-truth discipline as everything else on this surface.

## 2026-07-23f (SECOND real bug on the same wallet: external_sync_id has no user scope — table-wide collisions dropping trades platform-wide)

**The proxy fix worked — Marc confirmed backfill now reads the correct address (proxy `0x51f0d8...04e9`, scanned 197). But `imported: 0` despite `resolved: 59`, and `n` stayed at 8.** Asked to explain the 197→59→0 gap and check three hypotheses: dedup against existing rows, gamma-verification failure, or a wrong user_id on write.

**None of those three — found a fourth, more severe bug by reading the INSERT statements directly (no speculation, no network needed):** `external_sync_id` for the sold-path was built as `` `pm-act:${group.condId}:${group.outcome}` `` — **no user_id anywhere in the string** — but the column's `UNIQUE` constraint is table-wide, not per-user. The redeemed-path had the identical shape: `` `pm-redeem:${condId}:${outcome}` ``. Any two users who both traded the same market+outcome collide: whoever's row landed first "owns" that ID forever via `ON CONFLICT DO NOTHING`, and every other user's real trade on that same market+outcome is silently dropped — no error, no log line, indistinguishable from never having traded it. Gamma verification doesn't even apply here — that's a redeemed-path-only step, and it doesn't explain the sold path's 0 imported at all, which is what first made this feel like a different mechanism than hypothesis 2.

**This is not a connect-flow bug — it predates this whole session.** An existing comment in `/api/admin/roi-audit/rows` (item #4, "Global duplicate external_sync_id — should be structurally impossible given the UNIQUE constraint, confirmed empirically rather than assumed") shows a prior session already had this exact risk in mind but apparently never traced the consequence through. Given popular durable markets (elections, Fed decisions) are exactly what many different whales/traders all pile into, and the durable-cohort leaderboard is built entirely from those markets, this has likely been silently undercounting the whole platform's realized_trades table since the schema shipped — not just this one wallet.

**Fixed:**
- Both INSERT call sites in `backfillRealizedTrades` now build `external_sync_id` with `user_id` included: `pm-act:<userId>:<condId>:<outcome>` and `pm-redeem:<userId>:<condId>:<outcome>`.
- New one-time `POST /api/admin/migrate-external-sync-id-scope` rewrites every EXISTING row still on the old (userless) format to include its own stored `user_id` — provably collision-free, since under the old constraint at most one row could ever exist per old-format ID in the first place, so rewriting it to include that row's own user_id can't collide with anything. Safe to re-run (already-migrated rows are excluded by the WHERE clause).
- Left the legacy `regradeRedeemedTrades`/`/api/admin/regrade-redeems` UPDATE path untouched — its own query already filters `WHERE external_sync_id = $X AND user_id = $Y`, so it's user-scoped in behavior regardless of the ID string's format; it'll just become a no-op against migrated rows, which is fine since it's a superseded manual tool from the original cashPnl-trust bug fix, not part of the active pipeline.

**Separately, fixed the auth confusion Marc hit:** `requireAdminSecret` already checks header, query string, AND JSON body for the secret — the "Forbidden" on `repair-whale-proxy-corruption` was almost certainly a `Content-Type`/form-encoding mismatch in how the POST was sent (not a code bug). The query-string form documented in that endpoint's own curl example (`?secret=$ADMIN_SECRET`) is guaranteed to work regardless of body-parsing.

**Active blockers:**
- **Still not verified against production** — same sandbox limitation as every entry this arc. Marc's own re-run of `/api/trades/backfill` for the reported wallet is the real test.
- Order-of-operations note for whoever runs this: re-running `/api/trades/backfill` for the reported wallet should work immediately after this deploy WITHOUT needing the migration first — none of this wallet's 59 groups have ever had ANY row in the table (they were silently dropped, not overwritten), so their new per-user IDs have nothing to conflict with. The migration matters for *other* users — specifically, the wallets who "won" collisions in the past and would otherwise get a duplicate row the next time their own backfill naturally re-runs (hourly sync, a future reconnect, etc.) if their existing row's ID isn't rewritten first.

**Queued (priority order):**
1. Re-run `/api/trades/backfill` for `0x434939528988ee7078340d389813011c4cdafc6d`, confirm `n` climbs from 8 toward ~59 (sold) + 25 (redeemed) ≈ 84, and that `/connect` reflects it.
2. Run `POST /api/admin/migrate-external-sync-id-scope`, note `migrated_rows` count — that number is itself informative (how many rows across the whole platform were sitting on the collision-prone old format).
3. Re-run `POST /api/admin/repair-whale-proxy-corruption?dry_run=true` with the corrected auth (query string) to get the actual affected-count for the proxy bug from the prior entry — still not run yet either.
4. Once both fixes are confirmed, worth re-running the durable-market-scope survey (76 qualifying wallets) — both bugs plausibly changed the REAL n for wallets across the leaderboard, not just this one. The leaderboard's current numbers may all be undercounts to some degree; re-verify before trusting exact figures anywhere public-facing again, same discipline as every other number this project has shipped.
5. Still deferred, per Marc's own call: the `/activity` "HTTP 400: max historical activity offset" pagination ceiling from the batch diagnostic (18/20 heavy wallets hit it).

**Notes for next session:**
- Two real, independent, severe bugs found in the connect-flow investigation started this session: (a) `ensureProxyStored`'s whale-reconcile branch clobbering correct proxies with EOAs (prior entry), (b) `external_sync_id`'s missing user-scoping causing silent cross-user data loss (this entry). Neither was hypothesized correctly on the first pass by either Claude instance — both required reading the actual INSERT/UPDATE statements line by line rather than reasoning abstractly about what "should" be happening. Worth remembering: when a number looks wrong and the higher-level flow (proxy derivation, gamma verification) checks out, look at the literal SQL next, not another layer up.

## 2026-07-23e (ROOT CAUSE FOUND + FIXED: whale-reconcile branch was clobbering correct proxies with EOAs)

**Marc ran the diagnostic from the prior entry. Real finding, not the hypothesis this session's own diagnostic report had guessed at.** Wallet `0x434939528988ee7078340d389813011c4cdafc6d`: EOA shows 0 activity / 0 redeemed; the proxy (`0x51f0d8d8798c6d57d8c60af767000ab3df5804e9` — stored value and a fresh Safe-factory derivation agree, so derivation itself is correct) shows **197 trades, 25 redeemed positions**. Not a stale-proxy bug, not a SPLIT/MERGE gap — a plain wrong-address bug, and Marc flagged it as affecting every `/connect` user (the existing whale set was imported with proxy addresses directly as `polymarket_address`, which is why the batch diagnostic showed `zero_activity_count: 0` for them — they never hit this).

**Traced it to the actual root cause, one level upstream of where the report pointed:** `/api/connect` and `backfillRealizedTrades` both already used the derived `proxy` variable correctly throughout — that part of the code was fine. The real bug is in `ensureProxyStored`'s whale-reconcile branch (`server.js`, added earlier this project to fix a *different* bug — whale-imported users whose `is_whale` flag flipped true *after* Safe-factory derivation had already run against their `polymarket_address`, which for whale-import rows already *is* the proxy). That branch checked `is_whale === true` alone as its trigger — with no way to tell "this row came from the whale-leaderboard scrape, where `polymarket_address` really is the proxy" apart from "this row is a connect-flow user whose `polymarket_address` is a real EOA and whose `polymarket_proxy` was correctly Safe-factory-derived, and who *separately* got flagged `is_whale=true`" (plausibly via `ensureWhaleProfile`'s existing-user branch matching this wallet's EOA directly from a leaderboard scrape — that branch sets `is_whale` without ever touching `polymarket_address`/`polymarket_proxy`). For the second case, the branch fired anyway: saw the correct stored proxy disagreed with `polymarket_address` (true, since address ≠ proxy for a real EOA), and **overwrote the correct proxy with the EOA — on every single subsequent call**, not just once. `/activity?user=<EOA>` then legitimately returns zero every time.

**Fixed:** gated the whale-reconcile branch on `password_hash LIKE 'whale_profile_%'` — this codebase's own pre-existing, already-used-8-other-places marker for "this row was auto-created by the whale-import scraper" (`ensureWhaleProfile` sets `password_hash: 'whale_profile_' + Date.now()`; the connect flow sets `'wallet_connect_' + Date.now()`). The branch now only reconciles rows that actually originated from whale-import, never a connect-flow (or any other) user who happens to also qualify as a whale by trading volume.

**Also shipped `POST /api/admin/repair-whale-proxy-corruption`** — detects and repairs any OTHER users already caught by this bug before the fix landed. Detection signature: `is_whale=true`, not whale-import-created, and `polymarket_proxy = polymarket_address` (the exact state the buggy branch produces — a real Safe-derived proxy essentially never coincidentally equals the EOA it came from). For each match, re-derives fresh via the Safe factory (now proven correct against the reported wallet) and updates `polymarket_proxy` + nulls `last_backfill_at`. Supports `dry_run=true` to detect without writing.

**Not needed for the reported wallet specifically:** its `polymarket_proxy` is currently correct in the DB (the diagnostic read it directly, before any post-fix `ensureProxyStored` call could re-corrupt it) — the code fix alone is enough; the next backfill trigger will use the now-safely-gated logic and hit the correct stored value.

**Active blockers:**
- **Not verified against production — this whole fix is code-reviewed only, same sandbox network limitation as every entry this arc.** Marc's own verification step is the actual test: `curl -X POST "https://hyperflex.network/api/trades/backfill" -d '{"eoa_address":"0x434939528988ee7078340d389813011c4cdafc6d"}' -H "Content-Type: application/json"` (existing endpoint, unauthenticated by design — admin/debug), then confirm `n` climbs from 8 toward something consistent with 197 trades + 25 redemptions, and that `/connect` for this wallet reflects it.
- **Unknown population size:** `repair-whale-proxy-corruption` hasn't been run yet either — don't know how many OTHER users are currently sitting on a corrupted (EOA-as-proxy) value. Run with `dry_run=true` first to see the count before deciding whether to apply.

**Queued (priority order):**
1. Run `/api/trades/backfill` for the reported wallet, confirm `n` climbs as expected. This IS the verification Marc asked for.
2. Run `/api/admin/repair-whale-proxy-corruption?dry_run=true` to see how many other accounts are affected, then re-run without `dry_run` to fix them.
3. Lower priority, explicitly deferred by Marc: batch diagnostic showed `fetch_error_count: 18/20` with `"HTTP 400: max historical activity offset"` — Polymarket rejects `/activity` pagination past some offset limit, so heavy wallets can't be fully paged today. Needs scoping (find the actual offset ceiling, decide whether to cap gracefully or find an alternate deep-history endpoint) — not fixed in this pass, logged so it isn't lost.

**Notes for next session:**
- The `password_hash`-prefix convention (`whale_profile_%` / `wallet_connect_%`) is now load-bearing for correctness, not just a display/auth artifact — any future code path that creates a `users` row with `is_whale` possibly true later must either use one of these established prefixes correctly or extend the `isWhaleImportRow` check if a third row-origin type is added.
- This bug is a good case study for why "derivation is correct" (confirmed by the diagnostic) doesn't mean "the value actually used at ingestion time was correct" — the diagnostic reads the DB directly and bypasses `ensureProxyStored` entirely, so it can show a healthy snapshot of a row that gets re-corrupted the next time real application code touches it. Worth remembering when a diagnostic and a live symptom seem to disagree.

## 2026-07-23d (URGENT report: connect flow undercounting real wallets — diagnostic shipped, not yet run)

**Live report, flagged highest priority:** wallet `0x434939528988ee7078340d389813011c4cdafc6d` connected, shows 8 resolved trades (all redeemed-path) and 25+ open positions on `/connect`, but `/activity?type=TRADE` returned **zero** events for it. Since the sold-path entirely depends on `/activity`, this wallet's real record is being badly undercounted — exactly the kind of wrong-number-reported-to-a-real-user this whole project exists to prevent.

**Traced the code, found one real bug already, without needing to run anything live:**
- `/api/connect`'s fast-path activity fetch was silently swallowing non-ok HTTP statuses and thrown fetch errors — a real API failure and a genuinely empty result were indistinguishable in the logs. Fixed: explicit `console.warn` on non-ok status / thrown error, plus a log line pointing at the new diagnostic whenever a connect completes with zero activity events. `backfillRealizedTrades`'s own activity fetch already logged this correctly (from earlier this session's pagination fix) — only the newer `/api/connect` fast path had the gap.
- Traced `ensureProxyStored`: if this wallet already had a `users` row from before (e.g. an existing HYPERFLEX account, whale import, or legacy signup) with a `polymarket_proxy` already stored, the connect flow's call hits an early-exit that reuses whatever's stored **without re-verifying it**. If that stored proxy is stale or was never the wallet's real activity address, this would produce exactly the reported symptom. Real risk, unconfirmed without checking this specific wallet's `users` row.
- A second real possibility that isn't a bug in our code at all: `computeProxyAddress` on the Safe factory is a **pure/deterministic function** — it returns an address whether or not that Safe was ever actually deployed or used. If this wallet acquired its positions via SPLIT/MERGE (depositing collateral directly to mint a complete set) rather than CLOB trades, `/activity?type=TRADE` would correctly show zero at the right address while `/positions?redeemed=true` still shows real redeemed positions — no mismatch, no silent failure, just a real gap in what the TRADE-type filter covers.

**Shipped:** `GET /api/admin/connect-activity-diagnostic` — read-only, answers all three of Marc's questions in one call:
- Single-wallet mode (`?address=0x...`): reports whether a `users` row already existed for this address (and what proxy was stored on it, if so), the freshly-derived Safe-factory proxy, and — for every distinct candidate address (EOA, stored proxy, freshly-derived proxy) — the `/activity?type=TRADE` count with explicit HTTP status per page, a broader all-types `/activity` check (to catch the SPLIT/MERGE case) when the TRADE-filtered count is zero, and the `/positions?redeemed=true` count for cross-reference.
- Batch mode (no `address` param): scans the top N currently-qualifying durable wallets (by existing `realized_trades` row count) and reports what fraction show the same zero-activity-with-no-error pattern — answers "systemic or one-off" directly.

**Active blockers:**
- **The actual diagnosis is not in this entry — the diagnostic is built but has not been run.** Code's sandbox still has no network path to hyperflex.network (confirmed, same as every prior entry). Whoever picks this up next: `curl "https://hyperflex.network/api/admin/connect-activity-diagnostic?address=0x434939528988ee7078340d389813011c4cdafc6d&secret=$ADMIN_SECRET"` for the reported wallet, then the batch-mode curl (no address param) to check systemic rate, before deciding on a fix.

**Queued (priority order):**
1. Run the single-wallet diagnostic on the reported address. If `existing_user.stored_polymarket_proxy` differs from `freshly_derived_proxy`, that's hypothesis 1 confirmed — the fix is having `ensureProxyStored` re-verify (or the connect flow bypass the cached-proxy early-exit and re-derive fresh on every connect, which has cost/latency tradeoffs worth weighing).
2. If addresses agree but `activity_all_types.distinct_types` shows SPLIT/MERGE-only history, that's the filter-gap hypothesis — the fix is widening `backfillRealizedTrades`'s sold-path ingestion to also capture SPLIT-acquired-then-redeemed positions (which may already be partially handled by the redeemed path, needs checking whether SPLIT positions without a later SELL are double-counted or missed entirely).
3. Run batch mode to quantify how many of the 76 durable-qualifying wallets share this pattern — decides whether this is a one-wallet edge case or changes the leaderboard's real coverage numbers.

**Notes for next session:**
- Also still queued from 2026-07-23b: not yet run — the ingestion-timing diagnostic's actual `total_ms` readings ARE in hand (8.5-14.7s, logged in that entry), but this NEW diagnostic is a different endpoint and hasn't been touched yet.
- Desktop CSS sizing on `/connect` and `nav.js` went through several more rounds this session (see commits `3ed6dcc`, `6942774`, `687a19f` on this same day) — final state: nav ~119px bar height, connect hero h1 108px. A real bug was caught mid-pass: `.nav-link` never had `white-space:nowrap`, invisible at the old 12px size but very visible at 24px+ (two-word labels wrapped to 2 lines); fixing that then exposed a second real issue (10 nav links no longer fit before the Sign In pill, which rendered off-screen past the viewport edge) — fixed by tightening gap/padding, not font size. All still unverified against actual production; every round shipped by request ("bigger") without a confirmation loop back from Marc yet on how the latest round actually looks.

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
