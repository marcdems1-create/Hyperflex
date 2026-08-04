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

## 2026-08-04c (Anti-farming integrity_flags now surfaced on the canonical /@handle profile)

**Ask:** "surface flags on profiles" — closing the queued item from the integrity-scan work: `integrity_flags` existed only in `/api/predictors/leaderboard?mode=roi`'s raw JSON, nothing rendered it anywhere.

**Found first:** `/@handle` (`public/profile-trader.html`, canonical per CLAUDE.md's file map) is powered by `computeTraderCard()` + `GET /api/user/profile/:handle` — a COMPLETELY SEPARATE pipeline from `_buildTraderCards`/`_buildTraderProfile` (`/trader/:handle`, built 2026-07-20, not in the current file map, likely superseded by the 2026-07-30 canonical-profile consolidation). Wiring `integrity_flags` into `_buildTraderCards` — the obvious first move — would NOT have surfaced anything on the page Marc actually meant.

**Also found:** the canonical profile already has a disclosure mechanism for exactly this purpose — `computeTraderRiskProfile()` ("how they trade" section) already ships `flags: [{key, severity, label, detail}]` for `concentrated`/`small_size`/`fast_turnover`, rendered via `public/profile-trader.html`'s existing `.flag`/`.flag-dot` markup. Reused it rather than building a second, differently-styled block.

**Shipped:** `_integrityFlagDisclosure(signals)` (server.js, right after `_computeIntegritySignals`) translates the five integrity flag keys into that same `{key, severity, label, detail}` shape — dry, factual copy, no "cherry-picked"/"farmed"/"suspicious" language (Voice & Posture charter: labels describe mechanics, never quality). `GET /api/user/profile/:handle`'s existing `_getCachedDurableLeaderboard()` lookup (already there for the copy-trading `durable_verified` gate) now also concats the translated flags onto `profile.card.risk_profile.flags` when present. Zero frontend changes needed — the existing render path picks them up automatically.

**Known gap, documented inline, not fixed this pass:** `_getCachedDurableLeaderboard()` only returns non-held rows, so a wallet with `integrity_hold: true` currently shows NO disclosure note on its own profile (its stats still render in full, it just silently doesn't appear on the ranked board). Not hit in practice — 0 wallets held as of the 2026-08-04 scan — but worth closing if `integrity_hold` ever actually fires on a live wallet. Would need `heldRows` surfaced through the cache too, not just `.rows`.

**Verified:** `node --check server.js` passes. Extracted `_integrityFlagDisclosure` + `_fmtBioUsd` into a standalone Node script and ran it against 7 cases (each real flag individually, an edge case, and a synthetic all-five-flags wallet) — output strings all correct, singular/plural handling right, counts match. Did not do a full browser round-trip: the only new code is object construction feeding an UNCHANGED render path already proven live for the three pre-existing risk flags, and both severities used (`medium`/`low`) already exist in production CSS — no new visual surface to check.

**Active blockers:** none.

**Queued (priority order):**
1. Close the held-wallet-profile-disclosure gap above if `integrity_hold` ever fires for real.
2. Same open item as before, unrelated to this: `ADMIN_SECRET` still not rotated.

**Notes for next session:**
- Two parallel trader-profile systems exist in this codebase: `/@handle` (`profile-trader.html`, `computeTraderCard`, canonical) and `/trader/:handle` (`trader-profile.html`, `_buildTraderProfile`/`_buildTraderCards`, built 2026-07-20, status unclear post-2026-07-30 consolidation — not in the current CLAUDE.md file map). Check which one is actually meant before wiring anything into "the trader profile" again.

## 2026-08-04 (fix: trading pages were wiping the CLOB session on a mere MetaMask lock, not just a real disconnect — same branch as before, `claude/hyperflex-polymarket-clob-compliance-6dxr1g`, PR #221 already merged so this restarts the branch fresh per the branch-reuse rule)

**Ask:** after the /connect wallet-remembering fix shipped, Marc said "check trading pages" — asking whether `market.html`/`creator-dashboard.html` had the same "constantly sign in" problem.

**Finding — much worse than /connect's gap, and a real bug, not just a missing feature.** Both trading pages already persisted the CLOB session correctly in the common case (`poly_api_key`/`poly_api_secret`/`poly_api_passphrase`/`poly_eoa_address` in localStorage, `updateTradingUI()` reads them on load and shows "Trading enabled" without requiring a click). The bug was in the wallet-switch detection path: `wallet.js`'s `syncCurrentAccount()` (polled on every page load AND on every tab focus/visibilitychange) calls `eth_accounts` and treats an **empty result** as "user disconnected," firing `hfx_wallet_switched` with `newEoa: null`. But `eth_accounts` returns empty in three cases, not one: a genuine disconnect, MetaMask simply being **locked** (auto-lock timeout, browser restart — extremely common), or the extension not yet finished injecting on a fresh page load. Both pages' `newEoa: null` handlers (`hfxHandleWalletSwitch` in `market.html`, `hfxDashHandleWalletSwitch` in `creator-dashboard.html`) treated all three identically: unconditionally wipe `poly_api_key`/`secret`/`passphrase` (market.html also wiped `poly_eoa_address`). Since deriving those keys requires a real EIP-712 `signTypedData` MetaMask signature (`enableTrading()` / `derivePolymarketApiKey()`), this meant: **every time a returning user's MetaMask happened to be locked, the page would silently throw away a perfectly valid trading session and force a full reconnect + a brand-new signature prompt** — the exact "have to sign in constantly" complaint, and worse than /connect's gap because it destroyed working state rather than just failing to restore it.

**Compounding bug in `creator-dashboard.html` only:** a second, separate raw `window.ethereum.on('accountsChanged', ...)` listener (commented "belt-and-suspenders backup") called the fully-destructive `disconnectBrowserWallet()` directly on any empty-accounts event — completely independent of `hfxDashHandleWalletSwitch`. Fixing the main handler alone would NOT have fixed the bug on this page; this redundant listener would have kept nuking the session regardless. `market.html` did not have this second listener.

**Fix (both files):** when `newEoa` is falsy, no longer clear the persisted CLOB credentials — only clear the live in-memory signer/provider objects (genuinely stale while locked) and show an informational status ("MetaMask locked or not connected. Unlock MetaMask to resume trading.") instead of "Wallet disconnected." A genuine switch to a **different**, non-null address still clears and re-derives everything correctly (that branch was already right, untouched). Removed `creator-dashboard.html`'s redundant raw `accountsChanged` listener entirely — `wallet.js`'s own listener + `syncCurrentAccount()` already drives the (now-fixed) `hfxDashHandleWalletSwitch` via the `hfx_wallet_switched` event, so the second listener was pure duplication that happened to be the more harmful of the two paths.

**Verified:** inline `<script>` blocks in both files parse via `new Function()` (no syntax errors introduced). Confirmed the explicit "Disconnect" button (`disconnectBrowserWallet()`, `creator-dashboard.html`) is unaffected — that's still a deliberate user action and should still fully wipe credentials; only the automatic/passive empty-accounts path changed. No live browser test possible in this environment (would need a real MetaMask session that can be locked/unlocked across page loads).

**Active blockers:** (none)

**Queued (priority order):**
1. No live test of the actual lock/unlock cycle in a real browser — worth a manual check soon after this ships (lock MetaMask, reload `market.html`/`creator-dashboard.html`, confirm "Trading enabled" survives and no new Sign prompt appears until a genuine account switch).

**Notes for next session:**
- Do not reintroduce a raw `accountsChanged` listener in `creator-dashboard.html` that calls `disconnectBrowserWallet()` (or clears `poly_api_key` et al) unconditionally on empty accounts — that's exactly the bug just fixed. Any future wallet-disconnect handling should go through `hfxHandleWalletSwitch`/`hfxDashHandleWalletSwitch`'s `newEoa` check, which now correctly distinguishes "locked" (keep credentials) from "genuine switch" (clear + re-derive).

## 2026-08-04b (Anti-farming gate: first live integrity-scan run — 0 held, real finding on why, hold logic tightened)

**Correction to prior sessions' repeated claim:** "this sandbox has no network path to hyperflex.network" — retested this session, `/health` returned 200 and the new `/api/admin/integrity-scan` route responded (403 without a secret, as expected). Network access to production works from this environment now. Whatever caused the earlier block, it isn't universally true anymore — don't assume it without retesting.

**Ran `GET /api/admin/integrity-scan` live for the first time** (Marc ran it directly, `ADMIN_SECRET` never passed through this session — see note below). Result: **165 qualifying, 0 held, 27 flagged-but-qualifying.**

**Real finding: `extreme_roi_heavy` never fired — 0 wallets out of 192 total.** It was calibrated against the OLD redeemed-cashPnl fabrication bug's exact signature (values pinned near the ±100% settlement extremes) — a bug already closed at ingestion (2026-07-29 fixes), so nothing in live data has a reason to leave that fingerprint anymore. Since the original hold rule required `thin_capital` AND `narrow_time_span` AND `extreme_roi_heavy` **all three at once**, and one leg was structurally unreachable, the gate could flag wallets but could never actually hold anyone — inert by construction, not by the data being clean. Also: `thin_capital`'s $250 floor is trivial for any funded farming attempt to clear, so it wasn't a meaningful gate either.

**Closest-to-the-actual-worry wallets** (near the n≥10 floor, `narrow_time_span` flagged — the shape CLAUDE.md's "10 cherry-picked durable trades" risk describes): C9usa (n=10), svoter (n=10), LynxTitan (n=11), Prediqa (n=11), rainbowlilies (n=12). None held under the old OR the new logic — worth a manual look if anyone wants to sanity-check the gate against a real edge case, since nothing has excluded them either way.

**Fix shipped:** hold logic changed from `thin_capital && narrow_time_span && extreme_roi_heavy` to `narrow_time_span && (thin_capital || extreme_roi_heavy || late_entry_heavy)` (server.js, `_computeIntegritySignals`, doc comment + logic both updated). Marc's call, confirmed before shipping. Makes `narrow_time_span` the necessary signal (most directly tied to the actual worry) plus any one corroborating flag, instead of requiring capital-thinness and ROI-extremity simultaneously. **Honest caveat: re-checked against today's actual 27 flagged wallets, this change still results in 0 held** — every narrow-span wallet in today's data only co-occurs with `new_wallet` (informational-only, not part of the OR set), not with `thin_capital`/`extreme_roi_heavy`/`late_entry_heavy`. This is a "more defensible going forward" change, not a "fixes something broken today" change — logged so nobody re-discovers that gap and thinks the fix was pointless.

**Credential handling note:** Marc pasted the live `ADMIN_SECRET` value directly into chat mid-session. Declined to use it or store it anywhere (prohibited action per operating rules — entering an API key/token, even user-supplied, into a request) and flagged that the value is now in chat history and should be rotated sooner than "later." Gave Marc the curl to run himself with the value inline in his own terminal instead. Not stored in this file, in code, or anywhere else.

**Post-deploy confirmation (same session, after redeploy):** re-ran the scan — identical result, 165 qualifying / 0 held / 27 flagged, same wallets and flags as pre-fix. Matches the "honest caveat" above exactly: the looser hold rule is live and correct, it just doesn't change today's outcome. Not a bug, expected.

**Active blockers:** none.

**Queued (priority order):**
1. `ADMIN_SECRET` still NOT rotated as of this confirmation — Marc re-used the same value that was typed into chat earlier in this session to run the post-deploy check. Flagged twice now; still open.
2. Still not surfaced in any UI — `integrity_flags` is API-only. Unchanged from the prior entry.

**Notes for next session:**
- Don't assume "no network path to production" without retesting first — it was true for a long stretch of sessions, isn't anymore as of this one.
- If `extreme_roi_heavy` still never fires after real trading volume grows, consider whether the 70% share / near-cap-or-floor definition is the wrong shape entirely, not just a threshold to retune.

## 2026-08-03e (wallet-remembering fix for /connect, same branch as the compliance PR — `claude/hyperflex-polymarket-clob-compliance-6dxr1g`, PR #221)

**Shipped (with hashes):** pending push this session — see commit on this branch after this entry. Landed on the same branch/PR as the 2026-08-03f compliance fix below since only one branch was designated for this session; PR #221 now covers both changes.

**Ask:** Marc asked for HYPERFLEX to "remember someone's wallet so they don't need to constantly sign in" — right after asking for a PR on the compliance fix.

**Finding:** `public/connect.html` (the wallet-first front door per CLAUDE.md's product definition) had no persistence at all. Every page load started from the "Connect Wallet" hero — no localStorage cache of a previously connected address, no silent `eth_accounts` check on load, nothing. A returning visitor had to click Connect and go through MetaMask again every single time, even seconds after their last visit.

**Fix:** `connect.html` now caches `{user_id, address, has_signer, last_full_connect_ts}` in localStorage after every successful connect. On load, `autoResumeConnection()` tries a silent `eth_accounts` call first (no popup — only resolves if the site already has permission), falling back to the cache when no live wallet is available. A live wallet matching the cache within 15 minutes takes a fast path straight to `GET /api/trader-record/:userId` (the already-computed profile) instead of re-running `/api/connect`'s full activity refetch + backfill — that endpoint is expensive (paginated Polymarket activity fetch + a background gamma-verification backfill) and firing it on every page load would have been wasteful and hammered Polymarket's API for no reason. Anything else (new wallet, cache >15min old) does a real `/api/connect` refresh.

**Active blockers:**
- (none)

**Queued (priority order):**
1. Pre-existing, not touched by this fix: the opt-out checkbox on `/connect` always renders unchecked on load regardless of the wallet's real `leaderboard_opt_out` DB value — worth fixing so a previously-opted-out wallet doesn't look listed on reload.
2. No live browser test of the silent-reconnect flow was possible in this environment (would need an actual MetaMask session across two page loads) — worth a manual check before/soon after this ships.

**Notes for next session:**
- If `/connect`'s cache logic is touched again, keep the fast-path/full-refresh split (`FULL_REFRESH_INTERVAL_MS`, currently 15 min) — don't let a naive fix start calling `/api/connect` on every page load again.

## 2026-08-03f (Polymarket CLOB ToS compliance audit, branch `claude/hyperflex-polymarket-clob-compliance-6dxr1g`)

**Shipped (with hashes):** pending push this session — see commit on this branch after this entry.

**Finding — the trade-routing fallback chain in both trade surfaces auto-circumvented Polymarket's own geo-restriction, on every trade.** `market.html`'s `submitClobOrder()` and `creator-dashboard.html`'s `confirmTrade()` (`qt-trade`) both had logic that, on detecting a `"restricted"` response from one host, automatically resubmitted the *identical signed order* through a different apparent-origin host (CF Worker edge, then Railway's static US IP) specifically *because* a geo-block was detected — not for any technical/network reason. `server.js`'s `/api/polymarket/order` doc-comment matched this framing verbatim: "Routes signed orders through Railway (US IP) to **bypass geo-restrictions**" + "do NOT forward X-Forwarded-For... the CLOB must see Railway's server IP, not the end user's IP." This is textbook circumvention of Polymarket's Terms of Use (VPN/proxy-style geographic-restriction bypass is explicitly prohibited), independent of and worse than the existing "don't make Railway primary" operating note in CLAUDE.md (which was about reliability, not compliance) — the CF Worker's Cloudflare-anycast routing means for OFAC-sanctioned countries where Cloudflare has no local PoP, this chain could plausibly get an actually-blocked trader through by landing on an edge in a neighboring unsanctioned country. Not something either Claude flagged before; found via read-through of the actual fallback code while auditing against Polymarket's public ToS/Builder Code of Conduct (fetched via WebSearch — direct WebFetch to polymarket.com/help.polymarket.com/builders.polymarket.com all 403'd in this environment, likely bot-protection on the proxy).
- **Fix:** in both files, a detected `"restricted"` response now returns/surfaces immediately to the user (honest "Trading restricted in your region" message) and **never** triggers a retry through CF Worker or Railway. Fallback to another host is now gated *only* on genuine technical failure (thrown/network exception, or — market.html only — a signature-format mismatch string, unrelated to geography). `server.js`'s route comment rewritten to state this as a hard compliance rule (⛔) instead of framing Railway routing as a geo-bypass tool, so a future session doesn't reintroduce a geo-triggered call into it.
- **Verified:** `node --check server.js` passes; both HTML files' inline `<script>` blocks parse via `new Function()` (no live trade test — would require an actual geo-blocked IP to hit the changed branch, not available in this environment).
- **Not touched:** the CF Worker itself (`cloudflare-trade-proxy/src/worker.js`) — kept as-is, since its "run at the nearest edge" behavior is a legitimate CORS/reliability mechanism when NOT chained off a detected geo-block (the fix removes the chaining, not the Worker). Builder fee disclosure checked separately — currently a non-issue since builder fees are still 0% pending Polymarket's builder-profile verification (per existing CLAUDE.md V2 section); revisit UI fee disclosure before fees go non-zero, per the Builder Code of Conduct's "don't hide fees" rule.

**Active blockers:**
- (none newly introduced by this fix)

**Queued (priority order):**
1. Before builder fees go non-zero: add an explicit fee-disclosure line to the trade confirm UI in `market.html`/`creator-dashboard.html` (Builder Code of Conduct requirement, currently moot at 0%).
2. Live-test the geo-restriction path with an actual blocked-region IP/VPN once available, to confirm the honest-surface behavior end-to-end (not just static syntax checks).

**Open questions / unverified:**
- Whether Cloudflare actually lacks PoPs in every OFAC-sanctioned country today (assumed from general Cloudflare network-map knowledge, not independently re-verified this session) — doesn't change the fix (the fix removes the geo-triggered chaining regardless of whether the worst case was reachable), but worth a real check if this ever gets audited externally.

**Notes for next session:**
- Do not add any retry/fallback call to `/api/polymarket/order` or the CF Worker that triggers off a `"restricted"`/geo-block string match. Technical-failure fallback only.
- Full official Polymarket ToS/Builder Code of Conduct text could not be fetched directly in this environment (403s across polymarket.com, help.polymarket.com, builders.polymarket.com) — findings here are from WebSearch snippets, not a full-document read. If precise legal text is ever needed verbatim, fetch from a machine without the proxy's bot-blocking issue.

## 2026-08-03g (Anti-farming integrity gate v1 — addresses the "Open risk on automatic listing" flagged in CLAUDE.md, not yet confirmed against live data)

**What shipped:** `_computeIntegritySignals()` + wiring into `_computeRoiLeaderboard` (server.js, near `ROI_CAP`/~line 12521 and the function body ~12558). Implements 3 of the 4 candidate mitigations named in CLAUDE.md's open-risk note, computed entirely from existing `realized_trades` columns — no new external calls, no schema migration:

- **`thin_capital`** — `total_capital_usd < $250` deployed across scored (durable) trades.
- **`narrow_time_span`** — first-to-last scored trade spans `< 14 days`. Durable markets resolve weeks/months out by definition, so a real diversified record hitting n≥10 almost has to span longer than this; a tight cluster is a real signal.
- **`extreme_roi_heavy`** — `>70%` of a wallet's scored trades resolve near the ROI cap (≥950%) or near total loss (≤-95%) — proxies for a record built entirely on long-shot/extreme-price bets rather than moderate-price directional calls.
- **`late_entry_heavy`** (disclosed, not part of the hold combination) — `>50%` of trades bought at an extreme price (≤3¢ or ≥97¢) within 48h of resolution. Known blind spot: redeemed-origin rows have `opened_at` always NULL, so this and `narrow_time_span` structurally can't fire for a wallet whose scored trades are 100% redeemed-origin (documented inline).
- **`new_wallet`** (informational only, not part of the hold combination) — proxy account age via `MIN(opened_at)` across ALL of a wallet's realized_trades, any durability. Explicitly labeled as "earliest activity we've ingested," not true on-chain wallet age — didn't want to overclaim a signal we can't actually verify without a new external call path.

**Posture, matching the rest of this codebase's "disclose, don't hide" discipline:** any single flag is disclosed on the row (`integrity_flags[]`) but does NOT exclude a wallet — a genuinely skilled trader can plausibly trip one alone. Hard exclusion (`integrity_hold`) only fires when `thin_capital` AND `narrow_time_span` AND `extreme_roi_heavy` are ALL true on the same wallet. Held wallets are dropped from `_computeRoiLeaderboard`'s `rows` (so they automatically drop out of the public leaderboard, trader cards, AND the copy-bot `durable_verified` gate — all three read the same function) but are NOT deleted and NOT hidden from their own trade history — same "flag, don't erase" posture as the 2026-07-29 redeemed-fabrication purge. `heldRows` is now a separate field on `_computeRoiLeaderboard`'s return value specifically so this isn't a silent drop.

**New read-only diagnostic:** `GET /api/admin/integrity-scan` (requireAdminSecret) — one curl, shows `qualifying` count, `held` count + exactly which wallets and why, `flagged_but_qualifying` (wallets carrying 1-2 flags without being held — worth eyeballing), and `flag_distribution` across the whole cohort. Same pattern as `/api/admin/record-integrity` and `/api/admin/durable-market-scope` from earlier arcs — built specifically so checking impact never needs an ad-hoc query.

**Active blockers:**
- **Thresholds ($250 capital / 14 days / 70% / 50%) are reasoned defaults, not tuned against real data — this sandbox has no network path to hyperflex.network (confirmed repeatedly across sessions) and cannot run `/api/admin/integrity-scan` itself.** Whoever picks this up next (or Marc directly): run it once against production and see how many of the current ~80-90 qualifying wallets get flagged or held. If a real, previously-verified wallet gets held, that's a signal the thresholds are too aggressive, not that the wallet is farmed — tune the constants (`INTEGRITY_MIN_CAPITAL_USD` etc., all four grouped together right after `CATEGORY_KING_MIN_N`) rather than the logic.
- Not hand-verified against a known-farmed wallet (we don't have a confirmed example on this board to test against — the three fabrication bugs found in July were settlement/grading bugs, not farming per se). This gate is a preventive measure for a risk that hasn't been observed yet on this board, not a fix for an observed incident.

**Queued (priority order):**
1. Run `GET /api/admin/integrity-scan?secret=$ADMIN_SECRET` against production, review `held_wallets` and `flagged_but_qualifying` for false positives, adjust thresholds if needed.
2. Not yet surfaced in any UI (trader cards / profile pages) — `integrity_flags` exists in the API response (`/api/predictors/leaderboard?mode=roi`) but nothing renders it. Deliberately deferred to keep this pass container-first, same pattern as the original trader-card build.
3. The 4th named mitigation (true account age, not the ingestion-timestamp proxy) would need a new external call (Polygon RPC or Polymarket API for a wallet's first-ever transaction) — not built, flagged as a possible follow-up, not started.

**Notes for next session:**
- Don't rebuild this — `_computeIntegritySignals` and its wiring are done. If tuning is needed it's four constants, not new logic.
- `heldRows` is a new field on `_computeRoiLeaderboard`'s return — any NEW caller of that function should be aware held wallets are already excluded from `.rows` and don't need separate filtering.

## 2026-08-03d (✅ SHIPPED `785e73a` — public /methodology page live, nav Track Record link repointed)

**Shipped (with hash):**
- `785e73a`: `public/methodology.html` (found as pre-existing uncommitted work, then edited) + `GET /methodology` route (`server.js` ~13982) + link from `profile-trader.html`'s strip ("How this is calculated"). Public "How the score works" page: what the score measures (90-day decay, shrinkage K=20, per-trade cap), which trades count (durable-only, ephemeral excluded and why), how it's verified (on-chain fills + gamma settlement, permanent resolution archive), and an explicit "does not predict future results" section backed by real backtest endpoints (`/api/admin/score-backtest` + `score-backtest-rolling`, both confirmed present).
- Same commit: `nav.js`'s "✓ Track Record" link (both the dropdown entry and the search-palette entry) repointed from `/transparency` (edge-signal hit rate, currently below its own n≥30/58% publish gate at 53%) to `/methodology` (trader scoring, not gated). `/transparency` stays live, cross-linked from `/methodology`'s footer so it isn't orphaned, just out of the primary nav slot.
- Removed a "This is not theoretical" card that named the 2026-07-29 596-record self-audit specifically — Marc's call: zero users right now, no audience for a public incident retelling yet. Kept the general verification-discipline copy (durable-only scoring, gamma settlement checks, the backtest disclosure); cut the specific incident narrative. Matching stale code comment in server.js (route comment referencing "596 records removed") also corrected.
- Confirmed on origin: `git log origin/main --oneline -1` → `785e73a`.

**Competitive research (web search, this session):** scanned Polycopy, Polyfollow, Convexly, Polyburg, Polymonit, Polysyncer, Predicts.guru, KalshiSpy, Laikalabs — the "top trader leaderboard + copy trading" space is crowded and commoditized. None of them (a) exclude ephemeral/unverifiable markets from scoring, (b) re-verify settlement against a live source at ingestion time, or (c) show losses with equal weight to wins. Our ephemeral/durable split + gamma-verification discipline — the thing three separate 2026-07 fabrication bugs taught us the hard way — is a genuine, hard-to-copy moat *if published*, which `/methodology.html` now does live.

**Active blockers:** none.

**Queued:** (none from this arc)

**Notes for next session:**
- `/methodology` is live and in nav. Don't rebuild it. If a future session wants to publish a specific self-audit incident again (e.g. after the platform has real users), that copy pattern is in git history at `785e73a`'s parent — reintroduce deliberately, don't restore by reflex.

## 2026-08-03c (✅ SHIPPED — resync-sold-trades: two real query bugs found live, fixed, then made self-driving. Confirmed real scale: 1,576 wallets / 41,356 old-format rows.)

Follow-up to 2026-08-03b's audit finding. Marc ran the dry-run curl and hit two SEPARATE real bugs in my own new endpoint, one at a time:

1. **`{"error":"scan query failed"}` (1st)** — the scan query joined `u.id = rt.user_id` with no cast. Postgres has no implicit text=uuid operator; `users.id` is TEXT in this schema (documented gotcha already on record at `/api/admin/durable-market-scope`, server.js:63644). Fixed to `ON u.id = rt.user_id::text`, matching that endpoint's exact working idiom. Shipped (`a307a15`) — **did not fix it.**
2. **`{"error":"scan query failed"}` (2nd, same message)** — a second, independent bug: `SELECT DISTINCT rt.user_id::text AS user_id ... ORDER BY rt.user_id` — Postgres requires ORDER BY expressions in a DISTINCT query to match a select-list item exactly, and `rt.user_id` (raw uuid) ≠ `rt.user_id::text` (cast). Fixed to `ORDER BY user_id` (the output alias). **This time verified before shipping, not just reasoned about**: installed a real local Postgres 16 via Homebrew (libpq only ships client tools — had to `brew install postgresql@16`, hit two more real obstacles getting it running locally: a macOS fork-safety crash worked around via `LC_ALL=C`, and a Unix-socket-path-length limit worked around by using `/tmp` instead of the scratchpad path), built a throwaway schema matching the real column types, and ran the literal query text copied from server.js. All 5 queries (totals, both scan-query branches, delete, after-count) ran clean. Shipped (`ceeb50c`) — this one held.

**Real prevalence, confirmed via the now-working dry run: 1,576 wallets, 41,356 old-format sold-path rows platform-wide.** This is not a rare edge case — validates the 2026-08-03b finding at real scale.

**Made it self-driving (`173e50e`)** rather than requiring ~105 manual batch curls to drain: extracted `runSoldTradesResyncBatch()`, wired a cron (every 15 min, 25 wallets/tick, ~16h to fully clear — same shape as the existing `runWhaleBackfillBatch` pattern a few hundred lines up in the same file), added `GET /api/admin/resync-sold-trades/status` for progress checks. The original endpoint still works for on-demand single-wallet fixes (`?confirm=1&user_id=X`).

**Lesson for next time this shape of fix comes up:** two misses in a row on hand-reasoned SQL was the signal to stop guessing and actually run it. A local Postgres is available in this environment (not by default, but `brew install postgresql@16` works, ~90s) — worth reaching for earlier when a query is non-trivial (DISTINCT/ORDER BY interactions, type casts across a schema with known quirks like `users.id` being TEXT) rather than after two failed live attempts.

**Active blockers:**
- Cron is now draining the backlog automatically (started ~2026-08-03, should clear by ~2026-08-04). Check `GET /api/admin/resync-sold-trades/status` to confirm it's progressing / eventually reaches `wallets_remaining: 0`. Scores for affected wallets will shift as this runs (upward for n, mixed for score_pct/durability) — expected, not a regression.

## 2026-08-03b (⛔ REAL BUG FOUND + FIXED — sold-path round-trip aggregation silently dropped repeat trades on the same market forever. Marc: "AUDIT THE SCORING MECHANISM SEE IF THERES any bugs.")

**Read the whole scoring pipeline top to bottom** (`_computeRoiLeaderboard`, `_buildTraderCards`, `_computeCategoryRoiLeaderboards`, `classifyMarketDurability`, the redeemed-path settlement verification, and `backfillRealizedTrades` — the sold-path ingestion, 98% of platform volume). The redeemed path checked out clean (already hardened by the 2026-07-28/29 fixes — `_parseOutcomeSettlement` correctly requires gamma's `closed===true`, `market_settlement_cache` has exactly one writer and it's properly gated, the retired `regradeRedeemedTrades` is genuinely dead code behind an early `return`). The sold path had a real, previously-undiscovered bug.

**The bug:** `backfillRealizedTrades` grouped every BUY/SELL event by `(condition_id, outcome)` with **no time scoping**, ran one FIFO pass over the entire group, and inserted **one aggregate row** keyed by `external_sync_id = 'pm-act:user:cond:outcome'` — no per-round-trip or time component. Since the insert is `ON CONFLICT DO NOTHING` and this function reruns on every profile view (`server.js:17507`) and every `/connect`, a wallet's **second and every later round-trip** on a market it had already traded was silently dropped forever after the first successful backfill. Not logged, not counted as skipped (unlike the redeemed path, which does track `redeemedUnverifiedSkipped`) — just gone.

**Two concrete scoring consequences:** (1) `n` undercounted for repeat-market traders — directly hits the n>=10 qualifying floor and the `n/(n+K)` shrinkage weight (K=20); a wallet with 30 real round-trips across 10 markets could score as n=10. (2) `market_durability` computed off the *aggregate* first-buy-to-last-sell span rather than each round-trip's real duration — a wallet doing genuinely rapid, ephemeral-style round-trips on one market over months could show a multi-month aggregate span and get misclassified `'durable'`, letting trading that should be excluded by design count toward the score.

**Shipped (`d8104ba` on `main`):**
- Code fix: splits each `(condition_id, outcome)` group into per-round-trip **segments** (boundary = position returning fully flat), one `realized_trades` row per segment, keyed `pm-act2:user:cond:outcome:<segment close timestamp>` — deliberately a **new prefix**, not a suffix on the old key shape (the old key has no per-segment component, and the new suffix is an ISO timestamp which itself contains colons, so parsing old-vs-new reliably would be fragile — a distinct prefix makes it unambiguous and guarantees old aggregate rows and new segment rows can never silently coexist and double-count).
- New `POST /api/admin/resync-sold-trades` (dry-run default, `?confirm=1` to execute, `?user_id=` to target one wallet, `?limit=` batch size) — follows the exact same pattern as the existing `migrate-external-sync-id-scope` fix from 2026-07-23 (a *different* external_sync_id bug, same shape of problem). For each affected wallet: deletes old-format (`pm-act:%`) sold rows, immediately re-runs `backfillRealizedTrades` in the same request so corrected rows repopulate right away — never leaves a wallet's score silently blank waiting for a lazy re-trigger. **Monotonic for qualification**: splitting an aggregate into segments can only increase a wallet's real n, never decrease it.

**Not done / blocked on Marc:** could not verify real-world prevalence or run the dry-run against production from this sandbox — no `ADMIN_SECRET` here. The dry-run curl is read-only/safe:
```
curl "https://hyperflex.network/api/admin/resync-sold-trades?secret=$ADMIN_SECRET"
```
Reports `wallets_affected_total` and `old_format_rows_total` platform-wide. Worth running before deciding how big a `confirm=1` sweep to do — some currently-qualifying wallets' scores may shift (not necessarily down — durability reclassification could go either way even though n can only go up).

**Active blockers:**
- Dry-run not yet run against production — real prevalence unknown. Recommend Marc runs the curl above next session start.

## 2026-08-03 (✅ SHIPPED — homepage consistency pass + the rule-4 category-browse destination, finally built)

Marc asked "what's next on homepage"; offered two options — (A) bring `/feed`'s freshness treatment (See-all, refresh, flash) to `home-kings.html`'s own rows, or (B) the rule-4 category-browse destination for non-qualifying `/connect` wallets, flagged as a real documented gap ("markets by category... /connect links to /traders as an honest placeholder, not a dead end, but the real browse surface is still a separate pass"). He said "both, start a."

**A — shipped (`f300fc9`):** `home-kings.html`'s Top Trader / Category Leaders / Movers now poll every 3 min (were: once, on load), category leader cards got a "See all → /traders?category=X" link, and all three flash (same one-shot CSS glow as `/feed`) on a real change — new #1, new category leader, or a genuinely new Movers entry — fingerprinted by `user_id` across polls. Caught a real bug in my own first test: a stray `curl` during mock-server setup had already advanced the poll counter past the transition point, producing a false "flash isn't firing" read — restarted the mock clean and re-verified the transition fires correctly and a no-op re-poll doesn't.

**B — shipped (`bc4c211` + `6ace9b9`):** Researched first (dedicated research pass, not assumed) — found **three incompatible category taxonomies** already in the codebase: `classifyCardCategory` (10 cats, resolved `realized_trades` only, never applied to live markets), `detectCategory` (6 cats, powers `/api/screener`'s live filter, unused by any UI), and `hotMarkets.classifyTopic`/`TOPIC_RULES` (7 topics, the ONLY one with a live, working, already-shipped UI — powers `/explore`'s topic dashboard). Standardized on the third rather than inventing a fourth: `/connect`'s non-qualifying path (`connect.html`'s old `.category-stub` placeholder, one static paragraph) is now real topic chips + a live market grid off `/api/topics`, reused as-is. Personalization: `_buildTraderProfile`'s `open_positions` now carry a `topic` (tagged via `hotMarkets.classifyTopic`, separate small commit `bc4c211`) so a wallet with zero resolved trades — the common case for a brand-new connect — still gets a "you already have open positions in X" pre-selected tab, since that reads open positions, not trade history.

**Process note, second occurrence this week:** hit the exact same concurrent-session collision as 2026-07-30h/31 (see below) — the other Claude session's `server.js` work was staged-but-uncommitted again while I needed to add code to the same file. Same fix: `git diff`/`git diff --cached` → isolate → reset to HEAD → apply+commit mine → reapply+restage theirs → byte-diff to confirm zero drift. Did this cleanly twice in one session (once for the `open_positions` topic tag, once earlier this week for `/api/category-leaderboard`). This is now a proven, repeatable procedure — worth formalizing as a named routine if a third occurrence happens.

Verified end-to-end for both via mock servers before shipping (home-kings.html: flash transitions confirmed programmatically; connect.html: full paste-address → raw → verified-non-qualifying flow, personalization hint + chip-switching + zero mobile overflow, all confirmed). Both confirmed live on production post-deploy (`loadKings`/`loadMovers` present in `/`'s served HTML; `loadCategoryBrowse` present in `/connect`'s).

**Active blockers:** (none)

## 2026-07-31b (✅ SHIPPED — /feed follow-up: reason lines, "See all" into filtered /traders, auto-refresh, new-signal flash, volume rollup)

Marc asked "any more value we can pump out with this feed" after the visual pass (2026-07-30/31 entries below); proposed 4 ranked ideas, he said "start with 2 then do them in order" (See-all link → auto-refresh → new-signal flash → volume rollup). Also fixed, mid-thread, that Live Feed cards showed a badge + market with no explanation of *why* (added `reasonFor()` using each signal's own real fields) and dropped a dead `arbitrage` map entry (that detector was removed 2026-05-10 with Kalshi).

**Shipped, one commit per item (`511d18b` → `ef66711` on `main`):**
1. **Reason lines** (`511d18b`): "7 whales on YES · 82% consensus", "Odds moved 40¢ → 58¢ in 24h", etc. — built from fields the signals already carried but weren't rendering.
2. **"See all →"** (`339bc7a`, backed by new `GET /api/category-leaderboard` in `d468f43`): each category row links to `/traders?category=X`; `home-traders-preview.html` reads that param, swaps its data source, rewrites the header so the filtered view is obvious. Caught and fixed a real mobile overflow bug on `.cat-row-head` in the process (verified via actual DOM `getBoundingClientRect()`, not just screenshots — a headless-Chrome screenshot was giving a false-positive "clipped" read that the real browser tool's DOM measurement disproved).
3. **Auto-refresh category rows** (`d7518b7`): 3-min interval (Live Feed strip already had 2-min).
4. **New-signal flash** (`c838cfa`): fingerprints signals by `type+market+detected_at` across polls, one-shot CSS glow (no JS cleanup) on anything not in the previous set; first load seeded without flashing so all 10 cards don't light up at once. Verified live by overriding `fetch()` in-browser to inject a fabricated new signal and confirming exactly one card flashed.
5. **Volume rollup** (`ef66711`): "$11.0M tracked across N categories" under the LIVE badge — sums data already being fetched, no new query.

**New public endpoint:** `GET /api/category-leaderboard?category=X&limit=N` — reuses `_computeCategoryRoiLeaderboards()` + `_buildTraderCards()`, same pipeline as everything else, no new scoring.

**Process note — concurrent-session collision, handled cleanly:** mid-thread, another Claude session was actively committing to this same repo (a resolution archive + score-predictiveness backtest, unrelated). Hit their live `HEAD.lock` mid-push (waited it out, confirmed 19h-stale before clearing — see 2026-07-30/31 entry below for the first occurrence), and separately had to commit `server.js` changes while their +110-line addition sat staged-but-uncommitted: isolated via `git diff`/`git diff --cached` into two patches, reset the file to HEAD, applied+committed only mine, then reapplied+restaged theirs and byte-diffed to confirm their patch was restored identically (only line-number offsets changed, zero content drift). No work lost on either side.

**Active blockers:** (none)

## 2026-07-31 (verification arc part 2 — permanent resolution archive + score-predictiveness backtest; strategic reframe)

**Built the "verified → permanent → predictive" stack. Shipped (origin/main):**
- `ed7430c`, `7af4bbb`, `df412a5` — **permanent resolution archive.** New immutable `market_resolutions` table + capture engine. First design (drive off our trades) failed — trade timestamps are sell dates, so they point at open or long-aged-out markets (2 sweeps: ~440-489/500 unreachable, 0 archived). Correct engine is `_sweepClosedMarketStream`: pages gamma's `?closed=true` list and archives every decisive resolution while fresh, independent of our trades (idempotent, offset cycles, every 30 min). First stream run: **1000/1000 archived, 64 already matched our trade set.** This removes the "aged out of gamma, unverifiable" wall for everything resolving GOING FORWARD (can't recover deep history gamma already dropped — that's on-chain UMA/CTF, a future build). `getArchivedResolution()` lets grading read our store first, gamma second. `GET /api/admin/resolution-archive` (?stream=1 / ?sweep=1).
- `df412a5`→`7fc1f09` — **score-predictiveness backtest.** `GET /api/admin/score-backtest`: point-in-time, no-lookahead. Scores each wallet as of past date T (only trades closed < T, exact _computeRoiLeaderboard formula), measures forward ROI on disjoint trades in [T, T+forward). Spearman impl self-tested (+1/-1/~0). n<30 guard added so it can't over-claim on tiny samples.

**🔴 BACKTEST RESULT — the score is NOT demonstrably predictive.** Signal is unstable across windows: 90/90 → Spearman +0.62 (spread +65%); 120/90 → +0.04 (+25%); 150/120 → **−0.09 (−7.9%, sign flip).** n=15-21 throughout — too small to conclude, and the sign instability is the signature of noise, not forecasting. The opening 90/90 run's +0.776 was a small-sample mirage. **No predictive claim is supportable today.** The score describes the past honestly; it does not forecast the future at available sample sizes.

**Strategic reframe (Marc: "then what's the point of a leaderboard?"):** past≠future is what an EFFICIENT market looks like — reliable forward-prediction would be arbitraged away. Same result every mutual-fund study finds; track records are TRUST INFRASTRUCTURE (like credit scores / audited financials), not crystal balls. The leaderboard's real, defensible value: (1) proof against fakes in a screenshot-and-delete space — we literally caught our own board promoting fabrications tonight; (2) permanent un-gameable reputation/credential; (3) accountability (surviving losses publicly). **Sell verification + reputation (real, ours now); treat predictive alpha as a RESEARCH BET, not a revenue foundation.** If copy-trading is built, frame it "copy a verified-real trader," never "copy a guaranteed winner."

**Named next frontiers (not started):**
- **Aggregate/basket predictiveness** — "does #1 predict" failed, but "does a top-decile BASKET beat the market on average" is a different, more robust question (top quartile beat bottom in 2/3 windows). Testable with the backtest instrument as data grows.
- **Predictive model** — current score is time-decayed ROI shrunk to prior (a fair *description*). Making it *predict* needs better features (consistency, calibration, category skill, sizing) trained/validated out-of-sample against forward returns via score-backtest. Research project, gated on more longitudinal data (only 15-21 wallets have enough before+after trades — a DATA depth problem as much as a model one).
- **On-chain resolution archive** (UMA/CTF) to recover the deep history gamma dropped — makes the archive complete, not just forward-complete.



## 2026-07-30i (✅ SHIPPED — /feed rebuilt as a category "score wall"; "Kings" copy fully retired)

**Shipped (`0eaa358` on `main`):**
- `public/feed.html` fully rebuilt per Marc's direction: replaced the old News/Edge tab layout with (1) a top "Anomalies" row reusing the existing `/api/signals` whale_cluster/momentum/arbitrage/volume_surge/new_entry detectors — no score/hit-rate number shown (that stays behind Gate 3), just the raw fact (N whales, which side, capital); (2) category rows below, most-liquid-category first, each a horizontal scroll wall of real winning trades.
- New `GET /api/feed/category-wins` (server.js, after `/api/kings`): per category, orders by total durable-trade capital our own tracked wallets have deployed there (documented as OUR tracked volume, not Polymarket's own category volume — no live Polymarket category-volume integration exists). For qualifying wallets (same n>=10 durable-board gate, same `_computeRoiLeaderboard`/`_buildTraderCards` pipeline every other trader surface uses), surfaces their single best WIN *in that category specifically* — deliberately NOT reusing `_buildTraderCards`'s wallet-wide `maxTrade` (that can be a loss, or from an unrelated category). Score_pct/n/scope_label still travel with every entry — rule 3 holds even in a "showcase wins" surface. Categories with <3 real qualifying wins are dropped rather than shown thin/empty.
- **"Kings" copy fully retired**, closing the loop from 2026-07-30h: confirmed via `grep -rnE "\bKings?\b" public/*.html server.js` that the only remaining hits are real proper nouns (`fight.html`'s UFC fighter "King Green", the NHL's "Kings" in a team-name list) — both correctly left alone. Internal identifiers (`kingRow`, `/api/kings` route, `home-kings.html` filename) also deliberately left alone, same reasoning as 2026-07-30h: no user ever sees them.
- Verified locally against a hand-written mock server (`/private/tmp/.../mock_feed_server.js`, not committed) standing in for both `/api/signals` and the new endpoint — this sandbox has no path to the real DB or hyperflex.network. Confirmed rendering at 375px (single-column, rows stack correctly) and 1440px (scaled, centered). **The real endpoint's behavior against live production data is unverified** — the SQL is copied from the same query shape `_buildTraderCards` already uses in production, but nobody has hit `/api/feed/category-wins` against the real Railway Postgres yet.

**Active blockers:**
- (none functionally, but see verification note above — worth a live hand-check of `/api/feed/category-wins` output once deployed, same discipline as every other trader-facing number in this project)

**Notes for next session:**
- The old News/Edge tabs (`/api/news-feed`, `/api/edge-feed`) are no longer linked from `/feed` — those endpoints are untouched and still live, just orphaned from this page. Flag if anyone wants that content back somewhere.

## 2026-07-30h (✅ SHIPPED, corrects 2026-07-30g — the homepage split-hero work actually landed; 2026-07-30g's target file was dead)

**2026-07-30g shipped its split-hero change to `public/home.html` without checking the live route first.** `home.html` has been unrouted since 2026-07-26 (`app.get('/', ...)` serves `public/home-kings.html` — comment right above the route in `server.js:760-765` says so explicitly). That earlier commit is harmless (dead file, nothing served from it) but had zero effect on the live site — caught when Marc screenshotted the real homepage and it matched neither the old file nor the new one. **Lesson: before editing anything described as "the homepage," grep `app.get('/'` in server.js first — don't trust CLAUDE.md's file map, which doesn't mention `home-kings.html` at all and is stale on this point.**

**What's actually live (`acafed4` on `main`):**
- `public/home-kings.html` (shipped 2026-07-26b, already connect-first + a real single "King" card below the hero) got the split-hero treatment instead: desktop (>=1024px) hero goes two-column, copy left / a rotating real trader card right, reusing `HFXTraderCard.render(card,'compact')` off the same `/api/trader-cards` fetch the Movers row already made (refactored to one fetch, feeds both) — no new endpoint, no curated selection, whatever the durable board returns (win or loss) rotates through. Mobile (<1024px) stays single-column, unchanged from the 2026-07-26 mobile-first mandate — the override is desktop-only, a scoping call made without re-confirming with Marc; flag if he wanted mobile changed too.
- Renamed "King of the Castle" → "Top Trader" and "Category Kings" → "Category Leaders" (h2 text + the one dynamically-generated note sentence that said "some kings hold a losing record") per Marc's mid-task note that the "Kings" language read as dated. Internal identifiers (`kingRow`, `catKingsGrid`, `GET /api/kings`) deliberately left alone — no user-facing surface, changing them was unnecessary risk.
- Verified: inline scripts parse (`new Function()` per block), rendered locally via static server + headless-Chrome screenshot at both 1440px (two-column, confirmed) and 375px (single-column, confirmed) — local server has no backend so `/api/kings`/`/api/trader-cards` hit their `.catch()` empty-state fallbacks; those fallbacks are what got visually verified, not the populated-card path (endpoint itself is unchanged and already live in production).

**Not done:** `public/home.html` was NOT reverted — it's already explicitly documented as intentional dead-code-for-rollback, so the 2026-07-30g commit sitting on it is just inert, not cleaned up. Low priority, flagged in case a future session wants to actually delete it rather than leave two divergent unused homepage drafts on disk.

**Active blockers:**
- (none)

## 2026-07-30g (✅ SHIPPED — homepage hero replaced with connect-first split hero, per rule 1)

Marc asked for homepage design directions; picked "split hero" (connect CTA next to a rotating real verdict card, winner+loser both) over "pure gate" and "score wall" after reviewing PNG mockups (artifact/inline rendering was broken client-side this session — screenshots sent as plain image files instead, which did work).

**Shipped (`a5f212b` on `main`, merged with a concurrent origin push, no conflicts):**
- `public/home.html`'s old carousel hero (`#hero` showing "biggest market right now" + YES/NO trade buttons) replaced with a two-column hero: left = headline + wallet-address input + Connect button, right = rotating card from the existing public `GET /api/trader-cards` endpoint (real score/n/verdict/scope_label, un-curated — includes losers as they come, not cherry-picked).
- Connect button: pasted address → validates `0x[0-9a-fA-F]{40}` → `/connect?address=…`; empty input → tries `window.ethereum.request({method:'eth_requestAccounts'})` (same pattern as `connect.html`'s `connectWallet()`) → falls back to plain `/connect`. Invalid paste shows inline error, no navigation.
- Removed the now-dead `renderHero`/`setHeroIdx`/`buildHeroDots` JS and all `#hero`/`.hero-badge`/`.btn-yes`/`.hero-dots` CSS (including the leftover overrides in the three desktop breakpoint blocks) so nothing references deleted DOM.
- Verified: all inline `<script>` blocks still parse (`new Function()` per block), rendered locally via a static server + headless Chrome screenshot (production `/api/trader-cards` unreachable from this sandbox, so the empty-state fallback — a dashed-border honest message, not a fabricated card — was what actually got exercised; the endpoint itself is unchanged and already live).

**Not done / explicitly out of scope this round:** the market-grid rows BELOW the hero (ticker, topic chips, Hot Right Now row, etc.) are untouched — rule 2 says these come off the homepage too eventually, but that's a separate decision Marc hasn't made yet, flagged to him, not assumed.

**Active blockers:**
- (none for this change — but see note below on artifact rendering)

**Notes for next session:**
- Artifact/inline-render delivery (both the Artifacts panel and `SendUserFile` with `display:"render"`) did not work for Marc this session — "page not found" even on a trivial test artifact. Plain-attachment `SendUserFile` also failed. What DID work: PNG screenshots taken via headless Chrome + sent as image files. If a future session hits the same "can't see it" report, don't loop on the artifact panel — go straight to a real screenshot.

## 2026-07-30f (✅ SHIPPED — copy-trading copy honesty pass + "Trade like the pros" tagline. Marc: "find somewhere to put it in.")

Follow-up to 2026-07-30e's behavior change (copy-bot no longer auto-fires for anyone). The UI copy across `whales.html` and `copy-trading.html` still claimed literal automatic execution in a dozen places — "Auto-Mirror", "Auto-execute", "we'll mirror it with your allocation", "Start Auto-Mirroring" — all written when the feature actually did fire trades unattended. Left as-is, this would have been the UI lying about what the product does.

**Shipped:**
- `copy-trading.html` hero title is now **"Trade like the pros"** (Marc's tagline) with the sub-copy rewritten to describe the real, current behavior (get notified → tap Copy → your wallet signs). Meta description updated to match.
- Renamed the "Auto-execute" concept to **"Priority alerts"** everywhere it appears (mode toggle, subscription badges, toasts, alerts) — the honest description of what that mode actually does now: a richer interactive banner + faster/prioritized delivery, gated to durable-verified whales, still requiring a manual Copy tap. Same rename applied consistently across both files' JS strings, not just the visible labels.
- Renamed "Auto-Mirror" (the per-whale subscribe button/modal on `whales.html`) to **"Mirror"** — keeps the existing "Copy: this trade · Mirror: all future" distinction intact, just drops the false "automatically" framing from the button title, modal header, sub-copy, and warning text.
- Modal warning copy rewritten to state the real downgrade conditions (unverified whale, slippage/expiry/concentration/portfolio filters, daily cap) and to explicitly say every alert still requires a manual Copy tap.

**Not changed:** `copy-bot.js`'s actual behavior (already fixed in 2026-07-30e) — this pass is copy/wording only, no logic touched.

Not yet merged to main — pushed to `claude/onchain-expansion-thesis-9trllr`.

## 2026-07-30e (✅ SHIPPED — copy-bot no longer auto-fires anything, for anyone. Marc's product call: "copy trading simply sends the signal... [auto-trading] once we build the app." Real auto-execution deferred entirely; signal channels widened to bell + web push + email.)

**Marc's direction after the 2026-07-30d patch:** "only the most consistent get to be auto traded, copy trading simply sends the signal and prompts email notification or phone notification once we build the app." Read as: the durable-verified gate from the prior patch is the right eligibility concept for auto-trading, but auto-trading itself isn't something this web flow should do at all right now — it's a future, app-based feature. Today, copy-bot's job is signal delivery only.

**Shipped:**
1. **Removed the auto-execute-in-background branch from `copy-bot.js` entirely.** `_handleOpportunity` used to call `_executeTrade(data)` immediately alongside showing the banner, for any subscription that passed the (now much stronger) filter chain. That call is gone — every opportunity now ALWAYS requires an explicit "Copy →" tap, for every subscriber, verified or not, auto-mode or notify-only. Top-of-file doc comment rewritten to match (was: "attempt auto-execution in background"; now: "the user taps Copy themselves — nothing fires automatically").
2. **Widened the signal channels.** `copy_bot`/`copy_bot_exit` added to `_WEB_PUSH_TYPES` (existing browser/PWA push mechanism, wasn't wired for this event type before — closest thing to "phone notification" that's actually buildable today, no app exists yet). Added a real email via the existing `sendResendEmail()` helper (same Resend/nodemailer path already used for other transactional mail), fire-and-forget, on the same trigger point as the existing bell notification. Needed `u.email` joined into the `cbSubs` query to get a recipient.
3. **Notification copy rewritten** — the old text claimed "Auto-executing if your tab is open," which would now be false; replaced with "Signal: $X on SIDE. Tap Copy in the banner (or place it yourself) — nothing fires automatically."
4. **Gate 4 in CLAUDE.md updated** to record this as the resolution of the "keep, gate, or fold in" question the 2026-07-30c audit left open: kept, gated hard (verified board + daily cap + cooldown from 2026-07-30d), and now additionally stripped of live auto-fire entirely — the durable-verified eligibility concept is preserved as the design for a FUTURE app-based auto-trade feature, not exercised by any code path today.

**Left as-is:** the server-side `pending_execution`/`notify_only`/SSE-banner distinction (still differentiates who gets the richer interactive banner vs. bell-only), the verified-gate/daily-cap/cooldown filters from 2026-07-30d (still relevant — they're the eligibility bar for whenever real auto-trading does ship), the manual "Copy →" tap path in `execute()` (unaffected — still a real user-initiated signature through the unmodified CLOB signing code).

`node --check server.js` clean. Not yet merged to main — pushed to `claude/onchain-expansion-thesis-9trllr`.

## 2026-07-30d (✅ SHIPPED — patched the pre-existing copy-bot.js auto-execute system found in the 2026-07-30c audit: verified-board gate, daily spend cap, cooldown. Marc's call: keep the feature, close the gaps.)

**Audited first (report-only, no changes), then patched on Marc's "no its all good but patch it up.":**
- **Reachability:** confirmed live — `copy-bot.js` auto-loads on every page via `nav.js`; a real Auto-Copy Modal exists on `whales.html` (mode picker + warning banner) and a dedicated `/copy-trading.html` page. Only 1 subscription existed in production total (`active=true, notify_only=false`), belonging to one account.
- **Production usage, confirmed via Marc's own TablePlus results:** 461 `copy_bot_trades` rows, **zero ever reached `filled`** — the system has never executed a real trade. Breakdown: 371 `pending` (dead legacy status — traced the code, there is exactly one `INSERT INTO copy_bot_trades` and it never writes the literal string `'pending'`, so these predate the current filter logic and are inert), 79 `notified` (filters correctly downgraded these), 6 `skipped`, 5 `pending_execution` (passed every filter, eligible for real auto-exec, never completed — likely no SSE-connected tab at the moment they fired).
- **Signing path confirmed non-custodial:** `executeOrder()`/`_executeTrade()` both route through `HFXWallet.getSigner()` → real `ethers.BrowserProvider` → `signer.signTypedData()` — a genuine `eth_signTypedData_v4` call, MetaMask prompts every time, auto-fired or not. No private key or mnemonic stored anywhere.
- **The real gap, confirmed by tracing subscribe → trigger → insert:** the whale source is an arbitrary address from the OLD capital-deployed leaderboard (`whales.html`'s list) — zero reference anywhere to `_computeRoiLeaderboard`/`durable_verified`. This is the exact axis the 2026-07-20 held-loss diagnostic found structurally biased (19/20 sampled whales ungradeable). A user could auto-copy a wallet with zero independent verification behind it.

**Patched (commit pending push):**
1. **Verified-board gate.** New shared helper `_getCachedDurableLeaderboard()` + `_isAddressDurableVerified(address, rows)` (factored out of the assisted-copy trader-card check from 2026-07-30c, now used a third time — refactored that call site to use the shared helper too). `POST /api/copy-bot/subscribe` now force-downgrades `notify_only` to `true` whenever the requested whale isn't on the durable board, returning `downgraded_reason: 'whale_not_durable_verified'` in the response. Same check runs again in the whale-watch trigger loop itself as **Filter 0** (defense in depth — catches any subscription created before this patch). Downgrade, not reject — the passive-alert use case still works, only unattended execution is gated.
2. **Daily spend cap.** New `copy_bot_subscriptions.max_daily_spend` column (default $200, matches the existing `agent_configs.max_daily_spend` default for consistency). New **Filter 5**: sums `pending_execution` + `filled` trade sizes for the user today; skips (downgrades to notify) if adding this trade would exceed the cap. There was previously no cumulative limit at all, only the existing per-trade `max_per_trade` cap.
3. **Cooldown.** New **Filter 6**: in-memory `_copyBotLastAutoFire` Map (same idiom as the existing `_agentFiredToday` dedup), 15-minute minimum between auto-fires for the same user — stops a burst of whale opens from stacking multiple unattended fires back to back.
4. **UI honesty:** both subscribe call sites (`whales.html`'s Auto-Copy Modal + per-subscription toggle, `copy-trading.html`'s modal) now surface `downgraded_reason` explicitly instead of silently showing "notify-only" with no explanation — a silent downgrade would read as a bug, not a guardrail.

**Not changed:** the 371 dead `pending` rows (harmless, nothing reads them); the slippage/expiry/whale-concentration/whale-portfolio filters (already reasonable, left as-is); the `agent_configs`/`/api/agent/*` system (confirmed alert-only, never executes — out of scope, not touched).

`node --check server.js` clean. Not yet merged to main — pushed to `claude/onchain-expansion-thesis-9trllr`.

## 2026-07-30c (✅ SHIPPED — assisted copy trading: verified board → "Copy this" on an open position → existing /market/:slug widget prefilled → user's own wallet signs. Gate 4 written down. One real pre-existing system found and flagged, not touched.)

**Built exactly what was asked, reusing existing scaffolding per instruction — grepped first, found more scaffolding than expected:**
- `market.html`'s `applyAlphaPrefill()` already had a `from=trader` case wired into its banner logic ("🎯 Copying trade — review and sign") with a comment literally saying "Copy Trade buttons on sharp profiles" — reserved for this exact feature, never actually wired to a button until now. Used it as-is; zero changes to `executeTrade`/`executeViaProxy`/the CLOB V2 signing path.
- `_bfHydrateCopyAttribution()` (the Phase-3 live-bet-feed copy-provenance stamper) only fired for `from=copy`. Broadened to also fire for `from=trader`, tolerant of `copy_bet_id` being absent (an open position isn't a `bet_feed` row, so only `copy_user_id` travels) — reuses the exact same `window._bfCopyAttribution` → `/api/bet-feed` POST stamping, no new provenance mechanism built.

**New, server-side:** `/api/user/profile/:handle` now returns `durable_verified` (bool) + `durable_scope_label`, computed by checking membership in `_computeRoiLeaderboard('all', ROI_MIN_N_FLOOR)`'s rows — reuses the public leaderboard's existing 120s `_roiLbCache`, not a fresh computation per profile view. This is the single source of truth for whether the copy button renders; never inferred client-side (a client-side check could be spoofed to show a copy button on an unverified wallet).

**New, client-side (`public/profile-trader.html`):** each open position row gets a `copyHref(p, traderId)` link — only rendered when (a) `d.durable_verified === true` from the server, (b) the position's `market_url` resolves to an internal `/market/:slug` (no button if it'd route through raw polymarket.com, off the builder-fee path), (c) side is a clean yes/no. Link shape: `/market/:slug?from=trader&side=yes|no&size=25&copy_user_id=<trader's users.id>`. `size=25` is a fixed default (matches the site's existing default trade/copy-chip amount elsewhere) — never the king's own position size, per instruction. Tapping it is a full navigation to the destination market's EXISTING trade widget, prefilled, NOT auto-submitted — same "review and sign" pattern the cross-market live-bet-feed copy already used. User changes the amount if they want, then taps Buy themselves; their wallet signs via the unmodified CLOB V2 flow.

**Gate 4 written into CLAUDE.md** (Marc's message referenced it as if already there; it wasn't — formalized now, same pattern as Gates 1-3): SAFE tier (assisted, manual-confirm) is what's live. No auto-execution, no standing authority, amount always user-set.

**🚩 Found while building this, not previously flagged anywhere: a MORE automated copy-trading system already exists and is live.** `public/copy-bot.js` — auto-loaded on EVERY page via `nav.js` (`cb.src = '/copy-bot.js?v=2'`) — plus `public/copy-trading.html` and a full `/api/copy-bot/{subscribe,pending,stream,history,trades/:id/executed,...}` backend in `server.js`. Real, wired-up feature: subscribe to a whale on `whales.html`/`copy-trading.html`, get their trades pushed via SSE, and the client attempts background execution using the user's own stored CLOB API keys (`poly_api_key`/`poly_api_secret` in localStorage) + a live browser-wallet signature via `HFXWallet.getSigner()` (confirmed by reading `executeOrder()` — it's NOT a stored private key, still non-custodial, still needs a real wallet signature per order). The material difference from what Marc described as "not built yet, Gate 4, later": the trade's side/size/market is chosen by a subscription rule and execution is attempted automatically, not reviewed per-trade by the user the way this build's SAFE tier requires. This existed before today and wasn't touched, modified, or referenced by Marc's build request — flagged in CLAUDE.md's new Gate 4 section as an open decision (keep/gate/fold in), not resolved here.

**Open questions / unverified:**
- Whether `copy-bot.js`'s subscriptions are actually in active use right now (any real rows in whatever table backs `/api/copy-bot/subscriptions`) — not checked, no production DB access from this session.
- No visible "why isn't there a copy button here" indicator for a non-verified trader's open positions — the button just silently doesn't render. Minor, not fixed, flagging in case it reads as broken rather than as intentional.

`node --check server.js` clean. Not yet merged to main — pushed to `claude/onchain-expansion-thesis-9trllr`.

## 2026-07-30b (✅ SHIPPED — /@handle is now the canonical profile URL, serving profile-trader.html/computeTraderCard instead of member.html. Resolves the "two competing profile surfaces, pick one" item from the entry below. Full feature diff below, two things flagged, not fixed.)

**Marc's decision:** the clean card (profile-trader.html, computeTraderCard) is the profile going forward, but served at `/@handle` — the shareable convention — not `/p/:handle`.

**Shipped:**
- `/@:handle` now serves `profile-trader.html` (was `member.html`).
- `/p/:handle` → 301 redirect to `/@handle` (route kept, no longer serves the page directly).
- `/:slug` catch-all fallback (no creator match) redirects to `/@${slug}` (was `/p/${slug}`).
- Internal profile links updated to `/@` instead of `/p/`: `connect.html` (similar-traders matcher card), `creator-dashboard.html` (followers empty-state), `explore.html` (×2), `whales.html`. nav.js already used `/@` — no change needed there.
- Added to profile-trader.html (present in member.html, weren't on the card): **Share on X** button and a **Passport →** link (`/@handle/passport`, route already existed). Footer text fixed from `hyperflex.network/p/` to `/@`.
- `member.html` NOT deleted — still serves `/m/:userId` for handle-less wallets (unchanged fallback behavior).

**Full diff against member.html — what's confirmed kept, what's deliberately not ported:**
- ✅ Kept/already present: auto-generated `trade_bio` (Marc's specific callout — confirmed already wired via `/api/user/profile/:handle`), CLV grade, wallet class, win rate + n, realized ROI + staked, avg hold/size, top categories, cumulative-ROI sparkline, resolution ledger, live open positions.
- ✅ Added back this pass: Share on X, Passport link.
- ❌ NOT ported — old tier ladder (FLEXIN/WHALE/SHARK/SHARP/PROFITABLE/TRADER/Building) + progress-to-next-tier bar: CLAUDE.md's own Voice & Posture §8 already retires "tiers to unlock" as part of the FLEX Score redesign — porting it forward would resurrect something the docs already call dead. (Flagging that this directly contradicts the older NORTH STAR section's "keep compounding the tier ladder" bullet — those two CLAUDE.md sections disagree with each other; treated §8's explicit retirement as authoritative since it's the more specific, dated statement.)
- ❌ NOT ported — Follow/Followers-Following+modal, Copy-trade, Challenge (quote-predict), Message (DM): separate social-graph features, no plumbing in computeTraderCard's data model at all. Real functionality loss for whoever used them on member.html. Bigger lift than a route swap — needs an explicit decision, not assumed back in.
- ❌ NOT ported — streak/oracle/sharp/verified badges: tied to `takes` (social predictions posted), not to `realized_trades`. Different data model than the on-chain trade-record card.
- ❌ NOT ported — Whale Score badge (capital-flow heuristic): deliberately left out. Gate 1's 2026-07-20 finding was that capital-deployed as a signal axis is structurally biased toward ephemeral-market bots (19/20 sampled whales ungradeable). Resurfacing it on the new canonical profile would reintroduce the axis Gate 1 moved away from.
- ❌ NOT ported — Sports FLEX score gauge (separate CLV-component gauge): a distinct, separately-active sports scoring surface (t5/t6/t7 branches exist). Wasn't asked for, deserves its own integration call.
- ❌ NOT ported — self-editable "Edit Bio" (user-authored text, distinct from auto-generated `trade_bio`) and the "Activate your profile" wallet-connect CTA for owners with no wallet yet — `/connect` already owns the "no record yet" experience per CLAUDE.md rule 4, but worth knowing `/@handle` itself has no such prompt.

**🚩 Flagged, not fixed — scoring-discipline gap, separate from feature parity:** `computeTraderCard` computes win-rate/ROI over **all** `realized_trades` with no `market_durability` filter, no `scope_label`, no ephemeral-trade disclosure — unlike the newer Gate-1-compliant `/trader/:handle` surface (`_buildTraderProfile`, this session's similar-traders-matcher/specialty-small-sample work) which carries that discipline throughout. Making computeTraderCard's output the site's most-shared URL means its numbers aren't held to the same "every score carries n + durability scope" bar Gate 1 established elsewhere. Not fixed here since it's a scoring-methodology change, not a routing change — needs Marc's call: leave as-is, or bring `/@handle` up to Gate-1 parity (durable-only score + scope_label + ephemeral disclosure) before it's the front door people actually share.

`node --check server.js` clean. Not yet merged to main — pushed to `claude/onchain-expansion-thesis-9trllr`.

## 2026-07-29b (⛔ MAJOR — verified the board "beyond reasonable doubt"; found the entire redeemed path fabricated; purged it, board 95→80)

**Marc: "make sure beyond reasonable doubt the grading promotes the right traders."** Built a reconciliation harness, ran it on the homepage-promoted set, hand-checked every flag against gamma/polymarket.com. Verdict: **sold path (98% of volume) reconciles clean; the entire redeemed path was fabricated and is now purged.**

**Shipped (all on origin/main):**
- `c47d839` — CATEGORY_KING_MIN_N=20 (a king's own in-category n must clear 20, not the n≥10 board floor; crypto king had been crowned on n=10/100%) + `GET /api/admin/verify-promoted` (sold-path reconciliation vs on-chain /activity fills).
- `7af68e2`, `8abf3e1` — fixed THREE verifier false-positive modes found by hand-checking rather than trusting the harness: (1) 3000-event fetch cap made real older trades look fabricated (Nadmi has 5,501 events); (2) held-to-resolution wins look like pnl mismatches because redemption isn't a trade event; (3) redeemed-path positions can't be reconciled via TRADE events at all. Verifier is now SOLD-PATH ONLY, honest about coverage.
- `005f77a` — `GET /api/admin/verify-promoted-redeemed`: checks redeemed grades against LIVE gamma, bypassing the (poisoned) settlement cache. **Flagged politics king ultralisk: 17/60 redeemed rows on markets gamma says are OPEN, 0 verified. Hand-confirmed 3 against gamma directly (OpenAI IPO, Romania PM — closed:false).**
- `7f8110d`, `2b59a7c` — RETIRED `regradeRedeemedTrades` + `/api/admin/regrade-redeems` (410): graded off cashPnl with no gamma check, the landmine that could re-fabricate. Added `GET /api/admin/audit-redeemed-open` (platform-wide, read-only).
- `d6d51b3` — `POST /api/admin/purge-fabricated-redeemed` (dry-run default, snapshot to `realized_trades_quarantine`, settlement-safety check).

**Root cause (traced through code, not guessed):** redeemed rows on open markets = pre-7/28-fix residue. The unguarded parser graded open markets as resolved off price extremity; the 7/29 cache purge missed them because it deleted by CACHE MEMBERSHIP and these conditions weren't in the cache. The guarded insert path + purged cache can't recreate them; only the manual cashPnl regrade endpoint could, now retired.

**The measurement:** `audit-redeemed-open` sampled 400/534 redeemed conditions — 59 gamma-reachable, **59/59 OPEN, 0 legitimately resolved.** 341 aged out (indeterminate). The redeemed path never correctly graded a still-visible resolved market. ~596 rows / 534 conditions, ~13% of durable trades.

**Executed the purge (Marc's call, after dry-run):** 596 deleted, 596 snapshotted (reversible), 0 settlement-protected. **Qualifying wallets 95 → 80, 15 dropped off** incl. politics king ultralisk (`5dad8307`). Homepage now: overall #1 Nadmi (n 118→115, verified-clean sold-path), world king Nadmi (n 46); sports/macro/crypto kings gone — but that's the n=20 floor raise (they were n=18/11/10), not the delete.

**Framing (Marc):** deletes fabricated GRADES, not traders. Dropped wallets persist with real sold-path trades as "building," re-qualify automatically. Reversible via quarantine table; legit trades re-ingest via gamma-guarded backfill.

**Active blockers / open:**
- ⏳ Post-purge confirmation still owed: re-run `audit-redeemed-open` (expect ~0 open) + `verify-promoted-redeemed` (expect clean). Marc to run (needs ADMIN_SECRET).
- The n=20 category-king floor now leaves only 1 category king (world) on the homepage — most categories lack a wallet with 20+ in-category durable trades. Tuning decision: lower the floor, or accept sparse category kings. Not a bug.
- 341 redeemed conditions were aged-out/indeterminate at purge time — deleted anyway (produced by the discredited method, 0% of checkable ones legit). If any was genuinely legit, it re-ingests correctly via backfill or is recoverable from `realized_trades_quarantine`.

**Discipline note:** the harness itself was wrong in 3+ modes; every "fabricated!" alarm got hand-checked before action. The ONE that survived hand-checking (redeemed-on-open) was real. Do not trust a checker's output without verifying the checker.

## 2026-07-29 (✅ SHIPPED — trader card rebuild, auto-gen bio, similar-trader matcher, "how they trade" risk disclosure, homepage category kings, + 3 real data-integrity bugs found & fixed)

**Shipped (all pushed to origin/main, verified on origin):**
- `56e90b2` — `computeTradeBio()`: auto-generated trade-history bio from `realized_trades` (resolved count, top categories, avg/max size, win rate, ROI, worst loss named, streak). Deterministic template, zero Anthropic calls. Returns null under 5 resolved trades. Exposed as `trade_bio` on `/api/user/profile/:handle`; distinct from self-written `users.bio`.
- `555f99c` — same bio ported to `/api/member/:userId` + rendered on `member.html` (`/@handle`) under the FLEX score. Also reverted an address-lookup change (Marc: raw-address browsing belongs on Polymarket, not duplicated here).
- `04f1008` — `computeTraderCard()` + full rebuild of `profile-trader.html` (`/p/:handle`) to match Marc's design mock: hero score, stat quad (CLV grade / win rate / realized ROI / wallet class), meta strip, inline SVG cumulative-ROI chart, resolution ledger with per-trade staked / entry→exit / hold / PnL.
- `23411cc`, `91cf9e2`, `5c911e9` — three successive type/width scale-up passes on the card (score 66→200px, width 720→1600px) plus muted-text contrast lift. Sizing remains a judgment call layered on judgment calls; flagged to Marc that further iteration probably needs a designer, not another guess.
- `4e56190` — open positions section on the trader card, fetched client-side from existing `/api/polymarket/positions/:address` (5-min cached, non-blocking). Titles link to internal `/market/:slug` to keep trades on the builder-fee path.
- `94dbe6d` + `df2201f` — **`computeSimilarBetterTraders()` + `GET /api/similar-traders/:handle`.** Per-category durable-trade vector, cosine similarity vs wallets already qualifying on the category boards, filtered to those outperforming on *shared* categories, headlining the widest gap. Candidate pool is qualifying boards only → cannot surface an unverified wallet (Gate 1); every row carries score + n.
- `33863e9` — **pre-existing bug found while testing the above:** `_resolveTraderHandle` matched `LOWER(username)` only, so every wallet-imported profile (handle set, username NULL) 404'd — affected the existing `/api/trader-record` too, not just the new endpoint.
- `ec2a401` — **two data-integrity fixes (see below).**
- `a356551`, `49c0bff` — `/connect`: `Headline` → `Your record`, desktop scale entries for the sections that had none (incl. the new matcher, which was rendering mobile-sized next to 46px tiles), `--muted` .45→.62, plus a **cumulative realized-ROI equity curve** built client-side from `trade_history` and de-duplication of the matcher's repeated "you X% over N trades" clause into a single hoisted context line.
- `f07f7ff` — homepage `/api/kings`: removed the hardcoded `.slice(0,3)` category cap (macro/commodities/crypto/tech kings were computed every request and thrown away). Now shows every category clearing the depth bar; `?min_depth=` tunes it. Added a homepage note explaining kings are ranked on return not hit rate, so the politics king's legit 3W-17L record reads as the model working, not a bug. **NOTE: only 3 categories (sports/world/politics) actually have any n≥10-in-category wallet — verified via `?min_depth=1` returning 3.**
- `969b83e` — **(other session, merged clean into `f15bb80`)** small-sample confidence tier on the similar-trader matches + specialty tiles. Complementary to the risk-profile work below; both touch `server.js`, merge preserved both, `node --check` clean. Two sessions editing `server.js` in parallel — merges clean so far, watch for it.
- `b13f321` — **`computeTraderRiskProfile()` — the "how they trade" disclosure block on every profile (Marc's ask: state history AND risks, not just a score).** Over the same rows `computeTraderCard` fetches (added `close_reason` to the SELECT, no extra query): plain style sentence, sold-early vs held-to-resolution split rendered as a bar, and severity-tagged flags — `early_exit` (≥80% sold), `never_resolved` (0 held, n≥10), `concentrated` (one trade ≥25% of profit), `small_size` (<$5k), `fast_turnover` (<2d avg hold). Rendered between the stat quad and ROI chart on `/p/:handle`. **Motivating finding: the current #1 (Nadmi, score 65, 89% win rate) is 97% early-exit scalping on $9,840 capital — the flag now says so on the card.**
- `b823f38` — **second copy of the case-sensitive-handle bug.** `/api/user/profile/:handle` matched `u.handle = $1` case-sensitively; handles are stored lowercase, display names are mixed-case, so `/p/Nadmi` 404'd while `/p/nadmi` worked. `_resolveTraderHandle` was fixed for this earlier (`33863e9`) but this second resolution path wasn't. Now `LOWER()` on both. **This is what made Nadmi's card look "null" in testing — the response was the 404 body, not a card.** ⚠️ Two handle-resolution paths now agree but still duplicated — a shared helper would stop this recurring (third time this class of bug has appeared).

**⚠️ ROOT CAUSE FOUND — future-dated `closed_at` was NOT fully fixed on 2026-07-28.** The 7/28 fix reordered the redeemed-path timestamp chain to prefer real settlement times but **left `endDate` in it as a fallback**, with an in-code comment assuming that path "shouldn't happen often." It does. A position arriving with neither `resolved_at` nor `redeemed_at` falls through to the market's *scheduled* end date — surfandturf was carrying `closed_at = 2026-10-31` when checked on 2026-07-29, three months out. `ec2a401` now **skips** the row at ingestion (not clamp-to-now: clamping asserts "resolved today", which is just a different fabricated timestamp — same reasoning the corrective-delete endpoint gives). Added `future_dated_skipped` to the backfill log line, plus an **hourly self-healing sweep** running the same corrective delete, because depending on someone remembering to curl the manual endpoint is exactly how the 7/28 delete left rows behind. Sweep keeps the manual endpoint's safety check: refuses to auto-delete any row a `flex_backing_settlements` record points at.

**⚠️ Fake `0d` hold times fixed.** Redeemed-path rows carry `opened_at` NULL (known, documented), so duration computed as 0 and the bio asserted "held 0d before resolving against" on positions with no open timestamp at all. Now omits the clause when unknown, excludes those rows from `avg_hold_days` rather than averaging in zeros, reports `avg_hold_known_n` so the UI can show "n of m timed", and renders genuine sub-day books as "<1d".

**⚠️ Two fake-precision bugs in the matcher, caught by live-testing my own commit (94dbe6d → fixed in df2201f):**
1. No minimum n on **our** side of the comparison — their side is n≥10 gated by the category boards, ours wasn't. surfandturf's *3* "other" trades got compared to a 39-trade record and the card printed **"+122% edge."** Added `SIMILAR_MIN_MY_CAT_N = 5`.
2. `'other'` — the classifier's residual bucket, ~39% of durable trades — was being treated as a trading style. Two wallets both having a big `other` book says nothing about whether they trade alike. Excluded from the similarity vector and from headlining. Net: fewer matches, thin books correctly get none.

**Active blockers:**
- (none new) — Gate 3 still below bar, unchanged this session. Nothing published.

**🔴 LATE-SESSION: hand-check done, found the real root cause — AND produced one wrong published claim (corrected).**
- **`market_settlement_cache` was 100% poisoned.** All 1,101 rows predated the 7/28 guard; **21 of 21 gamma-reachable sampled rows disagreed with live gamma**, holding "Josh Stein win the 2028 US Presidential Election" and "Houston Texans win the 2027 NFL championship" as *settled*. Measured via new audit endpoint, not inferred.
- **Root cause of why 7/28 didn't hold:** `_verifyRedeemedSettlement` reads the cache **first** and returns early, so the `m.closed === true` guard was bypassed for every already-cached condition_id. Also why the 7/28 corrective delete didn't stick — poisoned cache regenerated the rows on next backfill.
- **Purged in prod, impact now measured (`38844b5` cross-tab).** `POST /api/admin/purge-poisoned-settlement-cache` ran; cache `total: 0`, `pre_fix: 0`. Post-purge `record-integrity`: **qualifying_wallets 95** (UP from the stale 92, purge cost the board nothing net), `redeemed_origin: 611` of `38,106` total (1.6%), `sold_origin: 37,495` (98.4% — real fills, never cache-affected), `durable: 4,660`, `future_dated_rows: 0`. `no_open_timestamp: 611` exactly equals `redeemed_origin: 611` — confirms (measured) that NULL `opened_at` is exclusively a redeemed-path property. **⚠️ Still missing: durable_redeemed_share_pct** — how much of the SCORED (durable) 4,660 is redeemed-origin. That, not the all-trades 1.6%, is the real exposure denominator. Cross-tab added in `38844b5`; read it on next deploy.
- **❌ SECOND over-claim, same session, same direction:** having called tetrose fabricated, I then called the whole leaderboard compromised ("all 92 wallets suspect"). Max exposure was 1.6% of trades and qualifying wallets went UP. The bugs were real (cache genuinely 100% poisoned, guard genuinely bypassed, endDate fallback genuinely writing future rows) but I inflated severity twice before checking denominators. **Lesson for next session: discount my severity estimates until they carry a denominator.**
- **❌ MY WRONG CLAIM, corrected in `86f703d`:** I asserted tetrose's +$521,232 / +853% "US x Iran permanent peace deal" row was fabricated and that we were recommending a losing wallet. **False.** It's `sold-profit`, entry 0.1001 → exit 0.9544 — a real early exit at a real price during an optimism spike, months before the market resolved NO. Legitimate. I had compared `realized_trades` (closed round-trips) against Polymarket's `/positions` redeemed bucket (positions held to resolution) — different sets of trades, sign difference proves nothing. Method warning now in CLAUDE.md.
- **Two CLAUDE.md assumptions confirmed FALSE against the live API:** `redeemable=true` does not mean won (`redeemable=true, curPrice=0`, negative pnl observed); the `winning` param is ignored when `redeemed=true` (byte-identical payloads). Both now flagged in CLAUDE.md.

**Open questions / unverified:**
- **✅ SCORING MODEL — SETTLED, do not reopen.** Asked whether the ranking should weight held-to-resolution over early exits (since the #1 is a 97%-early-exit wallet). Marc's answer, twice: NO. ~98% of durable trades are closed early; early exit is the normal, legitimate way the market works, so a profitable early exit is real skill and ROI-on-closed-trades ranks it correctly. No weighting/bonus/penalty. Early-exit wallets are NOT suspect. (Corrected the prior session's repeated framing of early exit as a risk/defect — `da91584` removed those flags; now neutral context, only the rare held-to-resolution wallet gets a positive factual note.) Recorded in CLAUDE.md scoring section.
- Card aggregates, bio text, equity curve, risk-profile flags, matcher `edge_pct` — internally consistent, NONE hand-checked against polymarket.com except the tetrose round-trip (which held up). Per project record, that's the standing risk.
- Sizing/visual quality on `/connect` and `/p/:handle` — Marc iterated names-bolder and asked for the equity graph (both shipped); "not visually appealing" may persist. Probably needs a designer, not another guess round.

**Notes for next session:**
- Read `durable_redeemed_share_pct` from `/api/admin/record-integrity` (in `38844b5`) — the true settlement-cache exposure figure, still unread.
- Confirm the hourly future-dated sweep logged a deletion in Railway logs; if 0, the ingestion guard is what mattered and the earlier rows were already gone.
- **Consolidate handle resolution** — `_resolveTraderHandle` and the inline query in `/api/user/profile/:handle` are two paths for the same job; the case-sensitivity bug appeared in BOTH (fixed `33863e9` + `b823f38`). One shared helper stops a third occurrence.
- `member.html` (`/@handle`) still has the old cluttered hero; clean card lives on `/p/:handle`. Two competing profile surfaces, unresolved — Marc picked `/@handle` canonical then we built on `/p/`. Pick one.
- `copy_trade_subscriptions` still notification-only. The card shows open positions to copy; no execution behind it.
- Two Claudes edited `server.js` in parallel this session (`969b83e` merged clean). Fine so far — keep pushing small and rechecking `git log origin/main` before describing what shipped.

## 2026-07-28i (✅ SHIPPED + MERGED to main — full scope audit + cleanup: creator SaaS turned off, dead code removed, abandoned smart-contract project deleted)

**Relabeled from 2026-07-28f to 2026-07-28i at merge time — that label collided with a separate concurrent session's f/g/h entries below (BIGINT trade_id fix, future-dated-trades bug, corrective delete). Same work, just renumbered so both sessions' entries survive the merge without clobbering each other. See that session's f/g/h entries directly below for their thread — unrelated to this one.**

**Marc asked for a full audit of the repo to remove anything not related to the core mission ("the place traders go to see the best of the best traders do their thing").** Ran three parallel research passes (route table + HTML cross-ref, all 130 SQL migrations categorized, hyperflex-deploy/ + root-artifact investigation) before touching anything, per report-first agreement. Full findings written to a standalone audit doc and shared with Marc; headline finding was that this isn't "a trader app with clutter" — it's four stacked pivots, and the biggest one (the old B2B creator SaaS) is still fully live in production, not dead code (293 hits on `creator_settings`, real Stripe checkout, ~20 mounted routes).

**Marc's decisions, then executed:**
1. **Creator/community SaaS platform — turned OFF, not deleted.** New `CREATOR_PLATFORM_ENABLED = false` flag gates `/api/creator/*`, `/api/community/*`, `/api/creator-wallet/*`, `/api/user/community-balance/*`, `/api/user/community/*`, and the `/creator/*` pages behind a clean 503; the `/:slug` community wildcard now no-ops to `next()`. Nothing underneath deleted — routes, tables, migrations all intact, flip the flag to restore instantly. Admin creator-management endpoints (`/api/admin/creators` etc.) deliberately left ungated (back-office tooling, not the public surface). **Side effect worth knowing:** disabling the `/:slug` wildcard also un-shadows `/worldcup`, `/sports`, `/ipo`, `/unsubscribe`, which it was silently intercepting and 302-redirecting to `/p/<slug>` — those routes work again now as a free bonus fix, not a deliberate scope call on the sports/worldcup verticals themselves.
2. **`hyperflex-deploy/` deleted** — an abandoned Day-0 Solidity/HyperEVM smart-contract project (real deployed testnet contracts, `HyperFlexFactory`/`HyperFlexMarket`/etc.), zero references from `server.js`, untouched for ~4.5 months since the first commit. Also removed 4 stray root `.sol` files and the smart-contract `README.md`. **⚠️ `hyperflex-deploy/.env` was tracked in git and is now gone from the working tree but is still recoverable from git history** — rotate the deployer/feeder key if it was ever live; deleting the file does not purge history.
3. **Dead code removed from server.js**, each verified individually before deletion (first attempt at this accidentally swept up live code — wallet verification, `PUT /api/user/profile`, `prediction_groups`, the `/discuss/:slug` backing API — all interleaved in the same file region as the actually-dead `/api/social/*` handlers; caught it in the diff before committing and redid it precisely): the ~9 handlers permanently shadowed behind the existing `app.use('/api/social', ...)` deprecation guard (guard itself kept), 3 exact-duplicate route registrations (`/challenges` page, `/daily`, `/arena`), and the already-dead `/accuracy` handler.
4. **7 orphaned public/ HTML pages deleted**: `landing.html`, `screener.html`, `tipster.html`, `trader-card-demo.html`, `rewards.html`, `spread-scanner.html`, `accuracy.html`. `home.html` deliberately spared (kept on disk for rollback per the 2026-07-26 `home-kings.html` swap).
5. **16 stale root files deleted**: `TODO.md`, `NEW_CLAUDE.md`, `HYPERFLEX_Brief.md`, `creator-migrations.sql`, `seed_demo_wallstreetbets.sql`, `seeds/*.sql` (6 files), `server.js.bak`, `hyperflex-landing-final.html` (+ ` (1)` variant), `demo.html`, `Versions/hyperflex-v4-wc.html`.
6. **No SQL migrations touched** — 130 files categorized (core / legacy-SaaS / infra / "separate feature bets" like the Fed-speaker narrative tracker, NBA sports-tipster wedge, agent/copy-bot experiments) but left alone per Marc's explicit "keep, we'll go through it later."

**Found but NOT touched — flagged for a separate pass:** 10 route collisions where two genuinely different feature implementations fight over the same path (older one always wins, newer one is silently dead) — `/api/challenges` GET+POST, `/api/follows/following` GET, `/api/follows` POST, `/api/influencers` GET, `/api/predictions/:id` GET, `/api/predictions/user/:userId` GET, `/api/takes/:id/comments` GET (the newer `take_comments`-table version is the one that's dead), `/api/referral/claim` POST, and a second `PUT /api/user/profile` found during cleanup (not in the original audit report). Picking a winner on each needs product judgment, not a cleanup pass.

**Merge note:** merged on top of origin/main (which had advanced with the future-dated-trades fix below while this branch was in flight). `server.js` merged cleanly with no conflicts — the two branches touched different regions of the file. Only this file (SESSION_STATE.md) conflicted, resolved by keeping both threads and renumbering this entry. `node --check server.js` clean post-merge.

`node --check server.js` clean throughout. **Commit `d610248`/`6e8f78f` on branch `claude/scope-audit-cleanup`, merged to main.** 167 files changed, 29 insertions, 56,502 deletions.

## 2026-07-28h (✅ SHIPPED + RUN IN PROD — corrective delete for the future-dated fabrication bug. 3,075 rows removed, qualifying leaderboard 123→92. taerv534's 2026-07-21 hand-check partially invalidated.)

**`GET /api/admin/future-dated-trades-audit` (shipped 2026-07-28g) confirmed the bug was live platform-wide, not just in Nadmi's test data:** 3,075 rows with `closed_at > NOW()` (2,419 `redeemed-loss`, 656 `redeemed-win`), 162 distinct wallets, 77 of them on the then-currently-qualifying (n≥10 durable) leaderboard — effectively the whole cohort. All three of the 2026-07-21 hand-checked wallets had at least one fake row (taerv534: 1, TB14: 4; MELOCOTON007: 0, clean).

**Shipped `POST /api/admin/fix-future-dated-trades`** (commit `0cfbda0`, merged to main same commit) — deletes rows with `closed_at > NOW()` outright (no valid corrected value exists for an unresolved market), refuses and surfaces instead if any fake `trade_id` was already referenced by a real `flex_backing_settlements` row, snapshots leaderboard membership before/after.

**Marc ran it in production. Result:** `deleted: 3075`, qualifying wallets `123 → 92` (31 dropped below n=10). No tainted settlements found (backing/settlement feature has had zero real settlements yet, so this was always the expected clean case). **taerv534 (2026-07-21 hand-check) dropped off entirely** — its qualifying n=10 included a fabricated row, meaning "highly selective, correctly so" was assessed on partly-fake data. TB14 and MELOCOTON007 both still qualify post-cleanup (TB14 lost 4 from its n). CLAUDE.md's Gate 1 verification note and qualifying-count (76→92) both corrected in place with a dated addendum rather than rewritten, per the "every number... has been wrong" discipline — don't silently fix stale numbers, flag the correction.

**Active blockers:** none for this specific bug — ingestion fix + defensive settlement guard (`closed_at <= NOW()`) + corrective delete are all live. `future-dated-trades-audit` should read 0 rows now; worth a spot re-run next session to confirm no new future-dated rows have appeared (would indicate the ingestion fix didn't fully hold).

**Still open from 2026-07-28g, unblocked now:** Marc's test backing (`9e9b7dc5...`) was wiped by the v2/ALL migration and still needs recreating via `/back` before end-to-end settlement can be verified live (back a predictor → trigger settlement → confirm balance moved). This is now the next actual next-step for Phase 1, not the data-integrity issue.

## 2026-07-28g (🚨 REAL BUG, platform-wide — realized_trades held fabricated "redeemed" rows for markets that haven't resolved. Root cause fixed, defensive settlement guard added, audit endpoint shipped. Also confirms: the v2 migration's DROP TABLE wiped the earlier test backing.)

**Marc caught this from `/predictor-trades` output before testing any settlement — Nadmi's "resolved" trades included "Will Donald Trump win the 2028 US Presidential Election?" at exactly ±100% ROI with `closed_at: 2028-11-07` — a market that cannot possibly have resolved yet.** This is the same signature as the 2026-07-18 redeemed-win bug, and it's not backing-specific — this is a live gap in `backfillRealizedTrades` itself, meaning it can affect ANY wallet's `realized_trades` rows, including ones already feeding the public leaderboard.

**Root cause (traced, not guessed):** `_parseOutcomeSettlement(m)` — the function that verifies a "redeemed" position's real outcome via gamma before trusting it — only checked whether the market's live price was decisive (`>0.95` or `<0.05`). **It never checked gamma's own `closed` flag.** A market can trade at an extreme price while still fully open (an overwhelming favorite, or a near-zero longshot, years before its actual resolution) — price extremity is not proof of resolution. This exact symptom was named in this function's OWN comment when it was built ("positions redeemed for elections years in the future... impossible") but the guard against it was incomplete.

Compounding it: `closed_at` for redeemed positions was computed as `pos.endDate || pos.resolved_at || pos.redeemed_at` — trying the market's originally SCHEDULED end date before the real resolution timestamp. Even for a genuinely-resolved market, this could produce a wrong (though usually not impossible) closed_at; for a wrongly-verified one, it produced a closed_at years in the future.

**Fixed:**
1. `_parseOutcomeSettlement` now requires `m.closed === true` (gamma's own resolution flag, the same field already used as ground truth elsewhere in this file — `?closed=false` filters, `m.closed === true` checks in the screener paths) in addition to the decisive-price check. A market must be BOTH decisively priced AND actually closed to verify.
2. `closed_at` source order flipped to prefer `pos.resolved_at || pos.redeemed_at` over `pos.endDate` — real resolution timestamps first, scheduled end date only as a last-resort fallback.
3. **Defensive settlement-path guard, independent of the ingestion fix holding:** both the cron's trade-discovery query and the manual `/settle-trade` endpoint now require `closed_at <= NOW()` before any settlement can fire, full stop — no backer Flex Points move against a market that hasn't actually resolved, regardless of what upstream ingestion says.
4. New `GET /api/admin/future-dated-trades-audit` (read-only, platform-wide): counts existing `realized_trades` rows with `closed_at > NOW()` (impossible for a real resolved trade — a clean, unambiguous signature), cross-referenced against the CURRENT qualifying (n≥10 durable) leaderboard so we can see directly whether any already-public score is affected. **Not yet run against production** — this is the next thing to check before trusting the leaderboard is clean of this specific pattern.

**Point 3, confirmed plainly: yes, the earlier test backing (`9e9b7dc5...`) is gone.** Both `supabase_migration_flex_backing_v2.sql` and the consolidated `..._ALL.sql` unconditionally `DROP TABLE IF EXISTS flex_backings` — at the time those were written, no successful stake was believed to exist yet, but by the time the corrected (transaction-wrapped) `_ALL.sql` actually ran, a real backing already existed from testing in between. Running that migration wiped it. This is a real, if low-stakes (play money, one test backing) consequence of the drop-and-recreate approach — noted for the record, not glossed over. Marc needs to re-run `/back` to recreate a backing before further settlement testing.

`node --check server.js` clean. Not yet merged to main. **Recommend running the future-dated-trades-audit BEFORE any more settlement testing** — if it shows qualifying wallets affected, that's a higher-priority fix than the backing mechanic itself.

## 2026-07-28f (✅ FIXED before it could bite — realized_trades.id is BIGINT, not UUID; flex_backing_settlements.trade_id and the settle-trade endpoint both assumed UUID)

**Caught from Marc's own diagnostic output, not from an error report.** `GET /api/admin/flex-backing/predictor-trades` (shipped in 2026-07-28e) returned real trade IDs like `"1148499"`, `"1121767"` — plain sequential integers, not UUIDs. `flex_backing_settlements.trade_id` was declared `UUID NOT NULL`, and the `/settle-trade` endpoint cast the incoming id `::uuid` — both would have thrown `invalid input syntax for type uuid` on the first real settlement attempt (against either a real cron settlement or the manual test endpoint). Same family of mistake as the `users.id` bug from 2026-07-28d: assumed a column's type from convention instead of checking it, caught this time from data Marc happened to show me rather than from a failure.

**Fixed:** `supabase_migration_flex_backing_v3.sql` drops and recreates ONLY `flex_backing_settlements` with `trade_id BIGINT NOT NULL` — `flex_backings` (and any real stake already placed on it via `/back`) is untouched; the two tables are independent, settlements only references backings, not the reverse. `/settle-trade`'s cast changed `::uuid` → `::bigint`. No other code changes needed — the cron's own `NOT EXISTS` comparison and the settlement INSERT never had an explicit cast on `trade_id`, so they work correctly once the column type itself is right.

**Re-verified against a real local Postgres** with `realized_trades.id` modeled as a genuine `BIGINT GENERATED ALWAYS AS IDENTITY` (not UUID) this time, reproducing the real shape exactly: the settle-trade path against a real bigint id now succeeds (no invalid-uuid error), a duplicate settle attempt for the same trade correctly no-ops, and the concurrency guard was re-checked once more with the corrected column type — 10 simultaneous settle-trade calls on the same (backing, trade) pair, exactly 1 succeeded, exactly 1 settlement row. `node --check server.js` clean.

**Marc: run `supabase_migration_flex_backing_v3.sql` in TablePlus** (on top of v2, which should already be applied) before trying `/settle-trade` or waiting on a real cron settlement — otherwise this is the next "relation/type does not exist"-shaped surprise. Not yet merged to main.

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
