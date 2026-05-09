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
