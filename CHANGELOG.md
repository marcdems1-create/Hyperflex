# HYPERFLEX — Build Log

> Reverse-chronological. Read from the top before starting any build.
> Each entry: what changed, what files, what not to break, commit hash.

---

## 2026-06-11 — Edge receipts session (Claude Code, branch `claude/clever-goldberg-zv6aqi`)

### fix(intelligence): the 0.4% accuracy stat was a denominator bug — decided-only grading (commit e502d54)
- **Files:** `server.js` → `updatePlatformMetrics`, `updateConfidenceCalibration`, `updateSourceAccuracy`, `/api/intelligence`, `resolveSignalOutcomes`, `logSignalOutcome`, 5 signal-source builders in `/api/signals`
- **Root cause (prod fire #4, filed May 10):** `updatePlatformMetrics` computed accuracy as `correct / COUNT(outcome IS NOT NULL)` — and that denominator included `'expired'` rows. Before the closed-market lookup landed in `resolveSignalOutcomes`, nearly every signal aged out as `expired` (final price never findable), so 21,866 "resolved" signals were overwhelmingly expired rows → 0.4%. The resolver was fixed earlier; the metric denominators never were. Now: accuracy = `correct / (correct + wrong)` everywhere (platform metrics, confidence calibration, `/api/intelligence` recent outcomes + by-type). Expired is reported as its own count. 30d rolling record added to the `platform_accuracy` context blob.
- **Rescue pass:** `resolveSignalOutcomes` now also pulls `outcome='expired'` rows inside the 60-day window and re-grades them when the closed-market lookup finds a final price (prematurely-expired signals from before the lookup existed get graded for real). Bounded LIMIT 200, no re-expire writes on miss.
- **Entry-price standardization:** the grader's PnL math (`1/entry−1` YES, `1/(1−entry)−1` NO) always assumed `market_price_at_signal` was the YES price, but whale_cluster/new_entry logged side-relative prices and the fallback whale_cluster logged consensus-% (not a price at all). All 5 sources now attach explicit `yes_price` (NULL = unknown, stored as NULL); `logSignalOutcome` prefers it; the resolver leaves `pnl_if_followed`/`edge_cents` NULL when entry is unknown instead of fabricating an evens cost basis. Correct/wrong grading was never affected (side vs resolution only) — this fixes the PnL/edge ledger going forward.
- **Don't break:** accuracy denominators must stay `IN ('correct','wrong')`. If you add a new outcome state (e.g. 'void'), it must NOT enter the denominator. The `total_resolved` key in the context blob is kept as an alias of `total_decided` for any stale consumer — don't repoint it at a count that includes expired. New-source rule: any new signal source pushed into `/api/signals` MUST set `yes_price` (YES-equivalent, or explicit `null`).

### feat(edge): GET /api/edge/receipts + RECEIPTS strip on /alpha-live — the terminal grades itself in public (commit e502d54)
- **Files:** `server.js` (new route after `/api/intelligence`), `public/alpha-live.html`
- **Endpoint:** public, 5-min in-memory cache (`_edgeReceiptsCache`), computed live from `signal_outcomes` so it can't drift from a stale `platform_intelligence` row. Returns `record` (last30d + alltime decided-only: graded/correct/wrong/hit_rate_pct/avg_pnl_per_dollar/avg_edge_cents, pending count, 30d by_type top 8, tracking_since) + `receipts` (last 24 graded calls: side, `entry_yes_cents`, `cost_cents` = side cost basis, outcome, pnl, timestamps).
- **Frontend:** RECEIPTS section between signal rail and edge grid — summary line (`Last 30 days: N graded · X.X% hit · +0.XX per $1 if followed · N pending`) + horizontal chip strip, CORRECT green / WRONG red border-left. 30d hit-rate added as 5th hero stat (`#s-hit`). Falls back to all-time window (relabeled) when 30d graded < 10.
- **Supply gates (don't remove):** whole section hidden under 5 graded calls all-time; hero hit-rate stays "—" under 10 graded in the chosen window. Per CLAUDE.md anti-pattern rule — no playful/flex surfaces on empty data. Also replaced the hardcoded "71% of the time" explainer line (unverifiable claim) with a pointer to the live record.
- **Voice charter compliance:** zero emoji, mono numbers, hit rate 1 decimal, PnL signed 2 decimals with U+2212 minus, no second person, no editorializing on outcomes — CORRECT/WRONG labels describe mechanics.

### feat(feed): edge ticker strip with 2-min auto-refresh (commit e502d54)
- **File:** `public/feed.html` — `.edge-ticker` CSS + `#edge-ticker` div between header and tabs + `loadEdgeTicker()`
- Top 8 edges from `/api/alpha/top?n=8` (slug-bearing only) as score-colored chips → `/market/:slug`, trailing `Terminal →` chip → `/alpha-live`. Refreshes every 2 min; when the #1 slug changes between refreshes the new leader chip flashes green for 3s. Hidden under 3 items or on any fetch failure — the ticker is optional and never blocks the feed.
- **Don't break:** boot is now a single `DOMContentLoaded` listener calling `loadNews()` + `loadEdgeTicker(false)` + the interval. If you add more boot work, extend that listener — don't add a second competing one for the same concerns.

---

## 2026-04-28 — Session 19 (Claude Code)

### milestone: first V2 trade accepted by Polymarket CLOB (pre-cutover)
- **When:** 2026-04-28 02:18:11 UTC (~9h before Polymarket's scheduled V2 cutover at ~11:00 UTC)
- **Where:** market `mlb-nyy-tex-2026-04-27`, BUY side, 1.0 USDC → 1.0626 shares @ 94.1¢ limit (book walked from top-of-book 94.0¢ + 1 tick slippage)
- **Order ID:** `0xc118b787f3e0e00eb26108cf0594c56a9535e443ecf6025e1a343d71c80657f3`
- **Wallet:** EOA `0x43493952…`, proxy `0x51f0d8d8…` (POLY_GNOSIS_SAFE, sigType=2)
- **Routed to:** `clob-v2.polymarket.com/order` → exchange `0xE111180000d2663C0091e4f400237545B87B996B` (CTF Exchange V2, non-NegRisk)
- **Builder:** `0x7439e528420d6ed0be9ce10c9698e9a7d490f12e828f7ef8c0992f3fd1eb49b8` attached in the bytes32 `builder` field of the signed struct ✓
- **Response:** HTTP 200, `success:true`, `errorMsg:""`, `status:"delayed"`, `takingAmount:""`, `makingAmount:""`
- **What confirms V2:**
  - V2 order shape — `salt`, `maker`, `signer`, `tokenId`, `makerAmount`, `takerAmount`, `side`, `signatureType`, `timestamp` (ms), `metadata`, `builder`. Zero V1 fields (`nonce`, `expiration`, `feeRateBps`, `taker`) in the EIP-712 signed payload.
  - Wire body: `deferExec:false`, `postOnly:false`, `orderType:'FAK'`, `owner:apiKey`, plus the V1-compat string fields (`feeRateBps:'0'`, `nonce:'0'`, `expiration:'0'`) we keep for cutover-window safety per CLAUDE.md note 2.
  - signTypedData against `verifyingContract = 0xE111…996B` (V2) with `domain.name = "Polymarket CTF Exchange"`, `version = "2"`, `chainId = 137`.
  - V2 pre-flight matrix all green: `CTF V2 (pUSD) ✓`, `NegRisk V2 (pUSD) ✓`, `Onramp (USDC.e) ✓`, `CT→CTF V2 ✓`, plus the V1 legacy USDC.e allowances still in place from prior onboarding.
- **Why this is the milestone:** every prior V2 attempt failed at one of `invalid signature` (sigType bug, PRs #33–34), `not enough balance / allowance` (missing pUSD matrix, PRs #36–42), `wrap reverts in MetaMask sim` (missing USDC.e→Onramp approval, PR #41), or `deceptive approval` Blockaid banner (MaxUint256 cap, fixed earlier). This is the first attempt where every guard fired correctly, the order was signed end-to-end, transmitted to the V2 host, and **the V2 CLOB validated the signature, accepted the order, and assigned it an order ID**. That's the path being live.

### investigation: `status:"delayed"` on the first V2 trade — what we know vs. don't
- **Symptom:** order accepted (200 OK, `success:true`) but `status:"delayed"` with `takingAmount`/`makingAmount` empty. Polymarket's `data-api` shows 0 positions for the proxy on this market 30+ minutes after submission. The "1.1 shares @ 94¢" the UI shows is a *client-side optimistic injection* (`[trade] Local position injected for YES 1.1 shares @ 94¢` in the console — see `market.html` line 5535), not a real fill.
- **What `delayed` means in V2:** order was accepted into the book/queue but not matched on receipt. Distinct from V1's binary `MATCHED` / `LIVE` / `CANCELED`. Pre-cutover V2 may be acknowledging orders before the matching engine is fully online for the underlying market — orders sit until the cutover completes.
- **Three plausible causes, ranked:**
  1. **Pre-cutover V2 matching engine not fully online for this market** *(most likely)*. CLAUDE.md: "Polymarket's production URL `clob.polymarket.com` takes over V2 April 28, 2026 (~11:00 UTC) per official migration doc. Until then, V2 traffic routes to `clob-v2.polymarket.com`." We submitted at 02:18 UTC, ~9h before the cutover. Pre-cutover the dedicated host accepts and signature-verifies V2 orders, but the matching engine may queue them rather than match against V1 liquidity. If this is the cause, the order should match itself once the cutover completes (or be silently re-keyed onto V1 by Polymarket's migration process — TBD).
  2. **`feeRateBps=1000` from `getClobMarketInfo()`** — the CLOB metadata returned a 10% taker fee for this market. That's an order of magnitude higher than the 0-200 bps standard. With a 10% taker fee, the matcher's effective break-even on our 94.1¢ limit is ~103.5¢ all-in — there's no counter-order it can clear. Could be (a) a special-market state (closing window, restricted, etc.), (b) a default placeholder V2 metadata returns pre-cutover before the real schedule is wired, or (c) a real punitive fee that should make us reject the trade client-side before submitting. We do NOT pass `feeRateBps` in the V2 EIP-712 struct (V2 strips that field) — protocol fees are computed at match time — but the high metadata reading does affect what the matcher will accept.
  3. **Sub-cent tick + 1-tick slippage** *(probably not the cause but worth noting)*. tickSize=0.001, our limit is 94.1¢ vs top-of-book 94.0¢ — that's 0.1¢ of slack. If the top-of-book vanished between the book walk and the submit, FAK has nothing to match and "delayed" is what V2 returns instead of V1's `"order couldn't be fully filled"`. The book at submit time had >1 share at 94¢ per the walk log, so this is unlikely but not impossible.
- **What we'd need to confirm cause:** check the order ID against Polymarket's order detail endpoint after cutover (~11:00 UTC). If it auto-fills post-cutover → cause 1. If it's still `delayed` 24h later → cause 2 (fee rate). If it's `CANCELED` with "no liquidity" → cause 3. Sandbox can't reach Polymarket from this environment, so this part is on Marc to verify from the browser.
- **Action items:**
  1. Watch the order ID at `clob.polymarket.com/order/0xc118b787…` after the 11:00 UTC cutover.
  2. If `feeRateBps=1000` persists on this market post-cutover, treat it as a market-disabled signal and reject client-side with a clear "trading restricted" toast — submitting a doomed order at 10% fee is bad UX.
  3. Add a `delayed` post-submit indicator in the UI — currently we render the fake "Order placed!" success state on `success:true` regardless of whether `status === "matched" | "delayed" | "live"`. A `status === "delayed"` should surface "Order accepted, waiting to match — check back in a few minutes" instead of confetti.

### docs: CLAUDE.md V2 status updated to reflect first-trade milestone
- **File:** `CLAUDE.md` → Session 15 / V2 status section
- Changed `V2 status (2026-04-22, session 15): End-to-end live trading works…` to note first **CLOB-accepted** V2 trade on 2026-04-28 with the order ID and pending-fill caveat. The Apr-22 testing was up to and including signature verification; the Apr-28 trade is the first where Polymarket's CLOB returned an order ID and accepted the order into its book.
- **Don't break:** the surrounding pre-cutover checklist in CLAUDE.md still matters — V1 wire-body compat fields (`feeRateBps:'0'`, `nonce:'0'`, `expiration:'0'`) and the builder HMAC headers stay attached through the cutover window. Don't strip them based on this milestone — wait until at least 24h post-cutover with confirmed fills before declaring V2 stable.

### feat(feed): Alpha Drop popup — first-touch dopamine on /feed (commit 3ff33e9)
- **File:** `public/feed.html` → +427 lines: CSS (modal overlay, gradient aura keyed to score tier, score count-up animation, mobile bottom-sheet variant), HTML (modal markup with score row, 3 metric tiles, resolving strip, dual-button action row), JS (`maybeShowAlphaDrop`, `_alphaDropShouldShow`, `_alphaDropMarkShown`, `_alphaDropCountUp`, `closeAlphaDrop`, ESC handler, `_alphaDropEscHandler`).
- **Trigger:** fires once per calendar day on `/feed` load, OR when the #1 edge slug changes after a 4h cooloff (rewards alpha refresh during the day). `?nodrop=1` disables for testing, `?drop=1` force-shows.
- **Data:** reuses the same `loadHotAlpha()` fetch — no extra request. Top item from `/api/alpha/top` becomes the hero; the nearest <24h-resolving market becomes the urgency strip.
- **Voice charter compliance:** dry/numerate copy, no greeting, no exclamation, no decorative emoji. Functional glyphs only (`●`, `↑`, `↓`, `→`). Tier labels: "Edge" / "Hot Edge" / "Mega Edge" — no "🔥" anywhere.
- **Don't break:** the localStorage gate uses three keys: `hf_alpha_drop_v1_date` (last calendar date shown), `hf_alpha_drop_v1_slug` (top slug last shown), `hf_alpha_drop_v1_ts` (ms timestamp). All three are read together in `_alphaDropShouldShow`. If you change the gate logic, version-bump the keys (v1 → v2) so existing users don't see a stale dismissed state forever. The score count-up uses `requestAnimationFrame` and a `performance.now()` start anchor — don't replace with `setInterval` (jitters under load). Modal animation uses `cubic-bezier(.18,.9,.32,1.18)` for a slight overshoot — that's intentional pop, not a typo.

---

## 2026-04-24 — Session 18 (Claude Code)

### fix: port the full V2 allowance matrix to market.html (the 'still not fixed' case)
- **File:** `public/market.html` → new `NEG_RISK_ADAPTER` constant, new `isPmctApprovedForSpender` + `approvePmctForSpender` helpers with localStorage caching + in-flight dedup, `isCtfApprovedForOperator` upgraded with the same caching pattern, V2 SELL pre-flight in `executeTrade()` rewritten to dispatch the full PR #38 matrix.
- **Symptom:** After PRs #33–42 landed on the dashboard path, users trading from `/market/:slug` were still hitting "Order rejected: invalid signature" and "not enough balance / allowance". The market.html V2 pre-flight had been frozen at the pre-PR-#38 state — only `CT.setApprovalForAll(exchangeAddr)`, missing the four pUSD approvals and the NegRisk Adapter approvals. PR #38's own "Don't break" note explicitly flagged market.html as not yet covered; this is the follow-up.
- **Fix:** market.html's V2 pre-flight now runs for BOTH BUY and SELL (was SELL-only) and dispatches the full matrix:
  - Binary: `CT→CTF V2` + `pUSD→CT` + `pUSD→CTF V2` (3 popups first time, 0 after)
  - NegRisk: above + `CT→NR Adapter` + `CT→NegRisk V2` + `pUSD→NegRisk V2` + `pUSD→NR Adapter` (up to 7 popups first time, 0 after)
- **Sibling helper symmetry:** `isPmctApprovedForSpender` / `approvePmctForSpender` mirror the dashboard's `dashIs*/dashApprove*` versions. Both use the same 10B `APPROVAL_CAP` to avoid Blockaid's "Unlimited / known for scams" banner. Both cache in localStorage under `hfx_ctf_ok_…` / `hfx_pusd_ok_…` keys — these keys are SHARED across market.html and creator-dashboard.html (same cache namespace) so approving on one page is remembered on the other.
- **In-flight dedup:** `_ctfApprovalInFlight` and `_pmctApprovalInFlight` maps keyed by spender prevent rapid-click from stacking concurrent approval SafeTxes against the same target (same fix pattern as PR #27).
- **Don't break:** `NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296'` must match the dashboard's `DASH_NEG_RISK_ADAPTER`. They're two declarations of the same contract; rename one and you break the matrix. The pre-flight is gated on `clobVersion === 2 && makerAddr` (no side filter). If you narrow that gate back to SELL-only, V2 BUYs fail the same way SELLs did. Leave it universal.

### fix: PR #41 ordering bug — USDC.e→Onramp approval must fire BEFORE the wrap, not in the post-wrap allowance pre-flight
- **File:** `public/creator-dashboard.html` → `dashWrapUsdcToPmct()`
- **Symptom:** after PR #41 landed, tester retried BUY. MetaMask again showed "This transaction is likely to fail", tester cancelled. Railway logs confirmed the tx hitting our `/safe-submit` endpoint was `to: 0x93070a847efEf7F7073…` (CollateralOnramp) with a body length consistent with `wrap()` — not the new `approve()` call we added. So the approval was never dispatched before the wrap.
- **Root cause:** PR #41 added the USDC.e→Onramp approval to the V2 pre-flight matrix in `confirmTrade()` — but in `confirmTrade()` the pUSD-wrap step runs *before* the allowance pre-flight. That code structure is baked into the flow (you need the wrap to complete to know how much pUSD you have, and the allowance block only fires for the rest of the approvals once pUSD is available). So the approval was scheduled to run, but only after the wrap would have needed it.
- **Fix:** moved the USDC.e→Onramp approval check+dispatch inline into `dashWrapUsdcToPmct()` itself, right before the wrap call. Every caller of `dashWrapUsdcToPmct` now gets the correct ordering for free. Still cached via `hfx_usdce_ok_…` localStorage so a repeat wrap is zero-popup. If the approve doesn't land on-chain we throw a descriptive error instead of letting the wrap attempt proceed and MetaMask-cancel the user again.
- **Also:** removed the duplicate `const USDC = '0x2791Bca1…'` inside `dashWrapUsdcToPmct` and switched to the shared `DASH_USDC_E_ADDRESS` constant now that it exists at module scope.
- **Don't break:** the V2 pre-flight still includes `usdceApprovals` for completeness, so a SELL-first user also gets the approval set before they later BUY. Those two paths are now redundant but harmless (the cache makes the pre-flight check a no-op once the inline path has run). If you ever remove `usdceApprovals` from the pre-flight, don't remove the inline path — that's the one that actually fires in time for a fresh wallet's first BUY.

### fix: V2 BUY wrap reverts in MetaMask sim — add USDC.e→CollateralOnramp approval
- **File:** `public/creator-dashboard.html` → new `DASH_USDC_E_ADDRESS` constant, new `dashIsUsdceApprovedForSpender` + `dashApproveUsdceForSpender` helpers, V2 pre-flight extended with a `usdceApprovals` matrix
- **Symptom:** user onboarded on polymarket.com, came back to HYPERFLEX, pressed Buy. UI showed `Balance: $2.00` (USDC.e from the deposit), started "Wrapping 1.0 USDC → pUSD before order..." and then MetaMask displayed "This transaction is likely to fail" → user cancelled → "Transaction cancelled!" toast. The wrap never landed so no pUSD was ever minted and every BUY attempt hit the same wall.
- **Root cause:** `dashWrapUsdcToPmct` calls `CollateralOnramp.wrap(USDC.e, proxy, amount)`. Internally the onramp does `IERC20(USDC.e).transferFrom(msg.sender, address(this), amount)` — pulling the proxy's USDC.e into the onramp contract. That requires `USDC.e.allowance(proxy, onramp) >= amount`. A freshly-onboarded polymarket.com wallet doesn't have that allowance — Polymarket's frontend handles it with a separate approval prompt the first time the user interacts with the onramp. Our flow was dispatching the `wrap()` before setting the allowance. MetaMask simulates, finds the transferFrom would revert, warns the user, user cancels. The V2 SDK's `approve_allowances.py` doesn't cover this because it assumes the USDC.e/onramp approval was set during V1 onboarding on polymarket.com; that assumption breaks for wallets that only just onboarded.
- **Fix:** added a third approval category to the V2 pre-flight (alongside CT and pUSD). Now the pre-flight checks/sets `USDC.e.allowance(proxy, CollateralOnramp)` before the order lifecycle begins. One-time +1 MetaMask popup on the first V2 trade of any kind. localStorage-cached via `hfx_usdce_ok_<ownerSuffix>_<spenderSuffix>` mirroring the pUSD cache pattern.
- **Why both sides:** added to both BUY and SELL pre-flight (universal `useClobV2 && proxyAddress` gate, not side-specific) so a user who sells before buying doesn't hit the same wall when they later click Buy. The extra popup on SELL is worth it to avoid the surprise-revert on a subsequent BUY.
- **Don't break:** `DASH_USDC_E_ADDRESS` is a new sibling to `DASH_CONDITIONAL_TOKENS`/`DASH_NEG_RISK_ADAPTER`/`DASH_PMCT_ADDRESS`. Keep the naming pattern. If you ever support a different collateral token, add a parallel approval category — do NOT swap this one out in-place, since users may have legacy pUSD allowances set on the old pair. The in-flight dedup (`_dashUsdceApprovalInFlight`) mirrors the pUSD one; keep it. Approval cap is the same 10B atomic as USDC approvals in `market.html` — this IS the same token, same contract, so the `MaxUint256`/Blockaid concern is the same. Do not change the cap without also checking that market.html's existing approvals still match.

### fix: V2 SELL `not enough balance / allowance` with green on-chain state → auto-refresh stale apikey
- **File:** `public/creator-dashboard.html` → `confirmTrade()` 400/`not enough balance` handler
- **Evidence:** after PRs #36/38/39 a testing wallet showed all 3 required V2 approvals ✓ on-chain for a binary market (`CT→CTF V2 ✓`, `pUSD→CT ✓ (∞)`, `pUSD→CTF V2 ✓ (∞)`), 28.57 shares on-chain > 28.53 sell size, correct routed-to exchange, `sigType=2`, and CLOB still rejected with `{"error":"not enough balance / allowance"}`. Proxy pUSD balance was 0 but that's expected for a maker on a SELL — the taker provides pUSD. Railway logs across every session terminated with `[polymarket derive-api-key] FINAL: … apiKey=d60fc46c… keysVerified=false proxy=NONE`. That `d60fc46c…` is the deterministic "we don't know you" response CLOB gives for unregistered EOAs — auth passes, but CLOB can't map the apikey to any maker address in their DB, so the generic balance check comes back zero and CLOB surfaces the generic "not enough balance / allowance" rejection. The stale key was cached in localStorage from before the user completed polymarket.com onboarding (deposit or first trade on their side) and our retry logic only force-re-derives on a literal `401` or `"api key"` in the error body — never on the generic balance/allowance wording.
- **Fix:** after rendering the diagnostic dump, if `clobSide === 'SELL'` and on-chain state is fully green (`CT→{routed exchange}` ✓, `pUSD→CT` ✓, `pUSD→{routed exchange}` ✓, shares > 0), auto-clear the six cached CLOB credential keys in localStorage and call `derivePolymarketApiKey()` to force a fresh L1 POST to CLOB. Guarded by `_tradeModalData._apikeyRefreshFired` so a persistently-unregistered EOA can't loop; user sees the normal banner on the second identical rejection. On success the fresh apikey is cached and `confirmTrade()` recurses automatically — order goes out with the new key, which CLOB now maps to the registered maker address.
- **Why this works for the onboarding case:** a freshly-onboarded user on polymarket.com (deposit + first trade through their UI) becomes registered in CLOB's DB. Any subsequent `POST /auth/api-key` for that EOA returns a REAL apikey bound to their maker address, not the deterministic fallback. The re-derive picks that up.
- **Why the `POLY_API_KEY` header in every `[v2-order]` log still read `d60fc46c…`:** our existing recovery path only fires on 401 or "api key" error — never on generic "not enough balance / allowance". The stale key was cached forever. This PR closes that specific gap.
- **Don't break:** the guard is per-trade-attempt (`_tradeModalData._apikeyRefreshFired`), not per-session. Each new trade attempt gets one refresh opportunity. Do not remove the guard or turn it into a session-wide `window` flag — that would block a legitimate re-derive after the user re-connects a different wallet. The `onchainGreen` gate is intentionally strict: `CT→CTF V2` ✓ (the routed exchange), `pUSD→CT` ✓, `pUSD→CTF V2` ✓, shares > 0. If future NR markets hit this path, extend the gate to also check the NR-specific approvals and use the routed exchange's specific pUSD allowance, not hardcoded CTF V2.

### diag: V2 banner now reads pUSD allowances + NR-Adapter CTF approval directly from chain
- **File:** `public/creator-dashboard.html` → banner in the `not enough balance / allowance` handler inside `confirmTrade()`
- **Symptom after PR #38:** user retried a binary-market SELL on a "Proxy pUSD: 0.0000" wallet and hit the same `{"error":"not enough balance / allowance"}`. sigType ✓, routed-to CTF V2 ✓, both setApprovalForAll checkmarks ✓. Railway logs show the pre-flight fired our new `pUSD.approve(...)` calls, the relayer returned 401 (expected — see CLAUDE.md #2), and the direct `execTransaction` fallback should have taken over — but we had no visibility into whether those approvals actually landed on-chain or if the fallback bounced silently.
- **Added to the banner:** direct `pUSD.allowance(proxy, spender)` RPC reads (bypassing the `hfx_pusd_ok_…` localStorage cache) for all four V2 spenders — `CT`, `CTF V2`, `NegRisk V2`, `NegRisk Adapter` — plus `CT.isApprovedForAll(proxy, NegRiskAdapter)`. Rendered as ✓(∞) / ✓(N) / ✗(0) so a screenshot surfaces on-chain state unambiguously. Re-labeled the CT rows as `CT→CTF V2`, `CT→NegRisk V2`, `CT→NR Adapter` to distinguish them from the new pUSD rows.
- **Why:** next screenshot should pin whether the PR #38 approvals are genuinely set on-chain. If any pUSD row reads ✗, our dispatch path is broken (most likely: relayer 401 → direct execTransaction fallback threw something we didn't surface, or the user silently dismissed the MetaMask popup). If all rows are ✓ and CLOB still rejects, the problem is not allowances at all (CLOB indexer lag, apikey owner mismatch, or something the SDK's allowance scripts don't cover).
- **Don't break:** banner is diag-only. The direct RPC reads use `getDashboardPublicProvider()` — same provider the balance-of read already uses. If you refactor the provider, both need to update together. The cached helpers `dashIsPmctApprovedForSpender` are still used by the pre-flight; do not make the banner use them — its job is to bypass the cache so we can tell when the cache lies.

### fix: V2 SELL `not enough balance / allowance` — we were missing the pUSD allowance matrix
- **Files:** `public/creator-dashboard.html` → new `DASH_NEG_RISK_ADAPTER` constant, new `dashIsPmctApprovedForSpender` + `dashApprovePmctForSpender` helpers, rewritten V2 allowance pre-flight inside `confirmTrade()`
- **Diagnostic that pinned it:** after PR #37 landed, the banner on a failing SELL showed `Routed to: CTF V2 (0xE1111800…996B)`, both approvals ✓, 28.57 shares on-chain for the exact tokenId, sell size 11.36 shares → 0.999680 pUSD @ tick 0.001, and `CLOB said: {"error":"not enough balance / allowance"}` with `Proxy pUSD: 0.0000`. Every maker-side check we knew about was green — so CLOB was rejecting for a reason our pre-flight didn't even consider.
- **Root cause:** the V2 SDK's [`examples/account/approve_allowances.py`](https://github.com/Polymarket/py-clob-client-v2/blob/main/examples/account/approve_allowances.py) and [`approve_neg_risk_allowances.py`](https://github.com/Polymarket/py-clob-client-v2/blob/main/examples/account/approve_neg_risk_allowances.py) show the full maker-side setup is **three ERC-20 pUSD approvals + two-or-three `setApprovalForAll` on the ConditionalTokens contract**. Our SELL pre-flight was only doing `CT.setApprovalForAll(CTF_EXCHANGE_V2)` + the NegRisk exchange analog. CLOB V2's balance/allowance check is unified across BUY and SELL — it wants the complete setup before it routes anything, which is why SELL was rejected even though the maker receives pUSD rather than giving it.
- **The full matrix (from the SDK):**

  | Purpose | Approval | Binary | NegRisk |
  | --- | --- | :-: | :-: |
  | Share transfer | `CT.setApprovalForAll(CTF_EXCHANGE_V2)` | ✅ | ✅ |
  | Share transfer | `CT.setApprovalForAll(NEG_RISK_EXCHANGE_V2)` | — | ✅ |
  | Split through adapter | `CT.setApprovalForAll(NEG_RISK_ADAPTER)` | — | ✅ |
  | Collateral flow | `pUSD.approve(CT)` | ✅ | ✅ |
  | Matching fees/collateral | `pUSD.approve(CTF_EXCHANGE_V2)` | ✅ | — |
  | Matching fees/collateral | `pUSD.approve(NEG_RISK_EXCHANGE_V2)` | — | ✅ |
  | Split through adapter | `pUSD.approve(NEG_RISK_ADAPTER)` | — | ✅ |

- **Fix:** the V2 pre-flight now runs before BOTH BUY and SELL (gated on `useClobV2 && proxyAddress`, no longer SELL-only) and checks/sets every approval in the matrix above. Helpers are cached in `localStorage` (`hfx_pusd_ok_<ownerSuffix>_<spenderSuffix>` mirrors the existing `hfx_ctf_ok_…` pattern) so a repeat trade is zero-popup. NegRisk Adapter contract address is `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` (mainnet, chainId 137 — from `py_clob_client_v2/config.py`). pUSD address `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` was already defined as `DASH_PMCT_ADDRESS`.
- **Approval cap:** same 10B-token cap as USDC approvals in `market.html` (`APPROVAL_CAP = '10000000000000000'`). MetaMask Blockaid flags `MaxUint256` approvals to low-reputation spenders as "Unlimited / known for scams"; the V2 contracts deployed April 22 haven't been whitelisted so we stay under the cap.
- **First-trade UX:** a fresh proxy on a binary market sees up to 3 MetaMask popups (CT→CTF V2, pUSD→CT, pUSD→CTF V2) — cached-approved after that. If `_negRisk` is `undefined` (unknown), the pre-flight also sets the NegRisk Adapter + NegRisk V2 approvals so a later NR trade doesn't block. If `_negRisk === false` explicitly, only the binary 3 fire.
- **Don't break:** the pUSD approvals are part of the same pre-flight as the CT approvals — if you split them back apart, the error-surfacing/recovery path must stay symmetric. The allowance cache is keyed on wallet-suffix + spender-suffix; if you rotate the approval cap or invalidate approvals you need to bust these cache entries. `DASH_NEG_RISK_ADAPTER` is a new sibling to `DASH_CONDITIONAL_TOKENS`. Does NOT cover `market.html` yet — that file has its own V2 SELL pre-flight (`isCtfApprovedForOperator` + `approveCtfForOperator`) that still only sets one approval; same treatment needed in a follow-up PR.

### diag: V2 SELL "not enough balance/allowance" banner dumps routed exchange + raw amounts + CLOB body
- **File:** `public/creator-dashboard.html` → 400/`not enough balance` handler in `confirmTrade()`
- **Context:** After PR #36 unblocked the invalid-signature bug, the next blocker on `hyperflex.network` Quick Trade is CLOB rejecting SELL with "not enough balance / allowance" even when the proxy holds the tokenId and both V2 operator approvals are set on-chain. Existing banner only showed `EOA`, `Proxy`, two approval checks, single-tokenId balance, and a truncated token ID — not enough to reason about the rejection.
- **Added to the banner:** `Routed to: {CTF V2 | NegRisk V2} ({addr})` — what `verifyingContract` we actually signed against; `Proxy pUSD` — in case any path reads maker's pUSD for fees/spread; `Sell size: {makerHuman} shares → {takerHuman} pUSD @ tick {tickSize}` — human-readable order amounts; `CLOB said: {…}` — first 120 chars of the raw error body so we see CLOB's exact phrasing, not just our re-labeled error message. Tokenid row now also shows the last 6 chars so copy-paste can identify the specific outcome token.
- **Why:** one screenshot from a failing SELL should now be enough to pin the cause to one of: wrong proxy, wrong outcome token held, exchange-address mismatch against what CLOB expected, a rounding bug in makerAmt/takerAmt at non-0.01 tick sizes, or a genuine CLOB bug/indexer lag. Before this we were guessing.
- **Don't break:** banner is diag-only, no trade-flow change. If `dashGetPmctBalance` or `getDashboardPublicProvider` is refactored, the new reads here need to follow. `errStr` and `data` are still in scope at this handler — if someone moves the `JSON.parse` above this block, update accordingly.

### fix: V2 invalid-signature on both exchanges — sigType 2→1 remap was the real bug
- **Files:** `public/market.html` → `buildOrderForClob()`, `executeTrade()` sigType computation, stop-loss SELL signer; `public/creator-dashboard.html` → `confirmTrade()` sigTypeInt
- **Symptom:** After PRs #33/#34/#35 the auto-retry would try CTF V2, flip to NegRisk V2, and still hit "Order rejected: invalid signature (tried both exchanges)". Users couldn't sell anything via `creator-dashboard.html` Quick Trade.
- **Root cause — PR #33's signatureType 2→1 remap was wrong.** The commit claimed "V2 consolidated sig types; 2=POLY_GNOSIS_SAFE became 1=CONTRACT/SAFE". That's not true. Verified against the official py-clob-client-v2 SDK source (`order_utils/model/signature_type_v2.py`): V2 still uses the same three values as V1 plus a new 3 for smart contract wallets: `0 = EOA, 1 = POLY_PROXY, 2 = POLY_GNOSIS_SAFE, 3 = POLY_1271`. Our proxies come from the Safe factory (`0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b`), so they MUST sign with 2. PR #33 routed every post-cutover proxy order through the POLY_PROXY EIP-1271 path, which can't recover to the Safe address → "invalid signature" on both binary and NegRisk markets (session 15's CLAUDE.md entry says V2 SELL was working live on April 22 — PR #33 on April 24 broke it).
- **Fix:** `sigType` computation no longer remaps 2→1 in either file — it passes the V1 value (`2` for Safe, `0` for EOA) through to V2 unchanged. `creator-dashboard.html` now uses the simpler `proxyAddress ? 2 : 0`.
- **Bonus fix (stop-loss GTC order in `market.html:~6254`):** replaced the legacy `'ClobExchange'` domain name with `'Polymarket CTF Exchange'` — a latent bug; that code path had never matched an on-chain exchange so every stop-loss sell would've been rejected.
- **What does NOT need changing: the EIP-712 domain `name`.** Both standard AND NegRisk exchanges share `"Polymarket CTF Exchange"` in V1 and V2. Confirmed against the SDK's `ctf_exchange_v1_typed_data.py` + `ctf_exchange_v2_typed_data.py` — only `verifyingContract` flips per market. A draft of this fix briefly edited the name to `"Polymarket Neg Risk CTF Exchange"` based on a third-party cheatsheet; the cheatsheet was wrong and that edit was reverted before landing. Do not split the name.
- **Why both retries failed:** first attempt signed with wrong sigType (1 instead of 2) against the correct domain → invalid sig. Retry flipped `verifyingContract` to the other exchange but still had wrong sigType → invalid sig again. Fixing sigType unblocks first-try success when `_negRisk` is correct from the market's `neg_risk` metadata; the existing auto-retry still covers cases where the flag is stale or missing.
- **Source:** [`Polymarket/py-clob-client-v2`](https://github.com/Polymarket/py-clob-client-v2) → `py_clob_client_v2/order_utils/model/signature_type_v2.py` + `ctf_exchange_v{1,2}_typed_data.py` + `exchange_order_builder_v2.py`. This is the canonical SDK; believe it over any third-party doc.
- **Don't break:** keep the retry — it's still useful when `_negRisk` is genuinely unknown. Do not re-introduce the 2→1 sigType remap. Do not re-split the domain name by NegRisk — the SDK uses one name for both. If a future PR claims V2 migration doc examples say sig type is 1, remember those examples use a POLY_PROXY user (legacy Polymarket proxy, not Safe); our users are on Safe so they need 2.

---

## 2026-04-23 — Session 17 (Claude Code)

### chore: kill V1 CLOB path — 100% V2 traffic starting now
- **Files:** `public/market.html` → `isClobV2Enabled()` always returns `true`; `public/creator-dashboard.html` → `useClobV2 = true` (hard-coded).
- **Why:** we need attribution volume on the Builder Leaderboard before the grant application. Every V1 order sent before 4/28 is attribution wasted (HMAC headers aren't attributing and that system is sunset on 4/28 anyway). Every V2 order carries our builder bytes32 on-chain and WILL attribute. Forcing V2 means every trade from here on is evidence.
- **Overrides removed:** `?clob_v2=1/0` URL param, `window.HF_USE_CLOB_V2`, `localStorage.hf_use_clob_v2` sticky flag. Any of those previously set to `'0'` are purged on page load so users who toggled to V1 for testing aren't quietly stuck.
- **V1 code paths still physically present** in `buildOrderForClob()` (v1 branch) and the dashboard V1 order-struct branch — unreachable but kept for quick revert if V2 breaks catastrophically. Don't rely on them as a fallback; the 4/28 migration deletes V1 from Polymarket's side regardless.
- **Don't break:** if V2 genuinely regresses, the rollback is revert this commit — NOT re-introducing the flag-based fallback. The 4/28 cutover removes V1 entirely so we have <5 days either way.

### feat: V2 order verbose log for grant-application evidence
- **File:** `server.js` → `_v2OrderVerbose` counter + `_logV2OrderTraceIfApplicable()` helper inside `getBuilderHeaders()`
- Independent counter (50) that fires whenever a `/order` body contains a V2 order (detected via `order.builder` presence). Logs the full V2-relevant fields: `builder` bytes32, `timestamp`, `metadata`, `side`, `signatureType`, `tokenId`, `maker`, `signer`, amounts, salt, signature prefix, `owner`, `orderType`. Path-agnostic so it captures orders regardless of whether HMAC is still active post-4/28.
- **Why:** Grant application + Polymarket support diagnostics need byte-exact evidence that we're shipping the on-chain `builder` field. When support says "order 0xabc… didn't attribute", we can grep Railway logs for the bytes32 and prove what we sent.
- **Don't break:** Logs only the first 50 V2 orders to avoid log spam. To reset the counter for fresh evidence, redeploy or set `_v2OrderVerbose = 50` directly.

### fix: deposit flow now lands USDC.e, not native USDC
- **File:** `public/market.html` → deposit modal (Jumper widget config), `fetchUsdcBalance()`, modal state, balance display
- **Bug:** Jumper/LI.FI widget `toToken` was pointed at **native USDC** (`0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`). Polymarket CTF V1 trading collateral is **USDC.e** (`0x2791Bca1…`) and V2's pUSD wraps USDC.e. Users who deposited via Bridge & Swap got a non-zero trading-wallet balance that couldn't place any order — "insufficient balance" at CLOB submit despite the UI saying there was $X.
- **Fixes:**
  1. Jumper `toToken` flipped to USDC.e. All new bridge deposits land correctly.
  2. `fetchUsdcBalance()` now returns `{ usdce, native, total }` instead of a single number so the deposit modal can distinguish tradeable (USDC.e) from needs-conversion (native).
  3. Legacy rescue: if proxy already holds native USDC, modal shows a "⚠ $X native USDC — Convert to USDC.e →" banner linking to a Jumper same-chain swap.
  4. Direct Transfer MAX / input gated on USDC.e only (was summing both). Native USDC in EOA gets a subtle "swap it to use it" blue banner.
  5. "No USDC on Polygon" copy now branches: shows "$X native USDC detected, use Bridge & Swap to convert" when that's the actual situation.
- **Don't break:** `fetchUsdcBalance` return type changed from `number | null` to `{usdce, native, total} | null`. Only two callers updated (`openDepositModal`). If you add new callers, read `.total` for the number-equivalent or `.usdce` for the tradeable-only amount.

### fix: market page now sees native USDC + pUSD (matches dashboard)
- **File:** `public/market.html` → `fetchTradeBalance()` + setup-panel balance block
- User deposited native USDC from MetaMask. Dashboard showed it correctly; market page showed $0. Cause: dashboard uses `/api/portfolio/alchemy/:address` which sums USDC.e + native USDC + pUSD; market page was doing a direct `USDC.e.balanceOf(proxy)` RPC call that missed the native USDC.
- **Fix:** Both balance-read sites in `market.html` now call the Alchemy endpoint first (`usdc_total + pusd`), fall back to the existing RPC / Polymarket profile-API path if Alchemy is unreachable (503/error). Dashboard and market page now show the same number.
- **Caveat:** This only fixes the *display*. Polymarket V1 trading collateral is USDC.e specifically. A user holding only native USDC will see a non-zero balance but still fail at order submit with "insufficient balance." Future work: auto-swap native USDC → USDC.e on deposit, or show per-token breakdown so users know what to do.
- **Don't break:** The 3-tier fallback order matters: Alchemy → RPC → Polymarket profile API. Each one only fires if the previous returned null.

### chore: retire /arbitrage page (API stays alive)
- **Files:** deleted `public/arbitrage.html`; edited `public/nav.js` (removed 2 nav entries); `server.js` (turned the route into a 301 → `/`).
- The standalone page wasn't driving value. Users get the same cross-platform spread signal on `/odds` and inside the creator dashboard, both of which still consume `/api/arbitrage` and `/api/v1/arbitrage`.
- **Don't break:** the two API endpoints stay live. `odds.html` and `creator-dashboard.html` both read `/api/arbitrage`; `api-docs.html` still documents `/api/v1/arbitrage`. If you delete those endpoints you break three surfaces. `'arbitrage'` stays in `RESERVED_SLUGS` so nobody can create a community with that name.

### feat: related-markets carousel on market page + drop duplicate Comments block
- **File:** `public/market.html`
- Market page had two identical `<div class="mkt-comments" id="mktCommentsSection">` blocks (plus duplicate `mktTakesSection`, `commentList`, `commentInput` IDs). `getElementById` returns the first match, so the second copy was dead DOM with no JS hooks. Dropped the duplicate block that sat between Holder Distribution and Crystal Ball.
- In its place, added a **Related Markets** horizontal-scroll carousel driven by `GET /api/alpha/top?n=12`. Filters out the current market by slug + conditionId, renders up to 8 cards with question, YES/NO odds, and edge score. Auto-hides if the fetch fails or filters to 0. Pure front-end — no new server code; piggybacks on the already-cached `buildAlphaList()`.
- **Don't break:** `loadRelatedMarkets()` runs inside `loadMarket()` AFTER `renderMarket()` so `_market.conditionId` is populated before filter-self. If you reorder, the current market may appear in its own "related" list. Each `.related-card` links to `/market/<slug>` — preserves standard navigation.

---

## 2026-04-23 — Session 16 (Claude Code)

### fix: markets/keyset sort param (`5a53c38`)
- **File:** `server.js` → `buildAlphaList()`
- `order=volume24hr` is only valid on `events/keyset` — not on `markets/keyset`. Gamma returns 0 results with that param, causing 502 on `/api/alpha/top`.
- **Fix:** Changed to `order=volume` (what all other `markets/keyset` calls in the codebase use).
- **Don't break:** If you add more `markets/keyset` calls, use `order=volume`. Use `order=volume24hr` only on `events/keyset`.

### fix: SELL max amount uses live CLOB bid, not entry price (`516b8a0`)
- **File:** `public/creator-dashboard.html` → `setMaxShares()`
- **Bug:** `current_price` on a position is the ENTRY price (e.g. 11.4¢), not the live market price. SELL was pre-filling `shares × entryPrice` ($3.88) instead of `shares × liveBid` ($1.39), immediately triggering "Selling more than you hold."
- **Fix:** `setMaxShares` SELL branch now uses `_tradeModalData._limitPrice` (set by `loadOrderbook` to the live CLOB bid before `_fillMax` fires).
- **Don't break:** `_limitPrice` must be set before `_fillMax` fires — the order is: orderbook fetches → `_updateLimitFromOrderbook()` → `setMaxShares()`. If you change `loadOrderbook` timing, verify `_limitPrice` is populated first.

### merge: `claude/fix-clob-order-attribution-UiZjd` → `main` (`77a45bc`)
- **Files:** `server.js`, `public/creator-dashboard.html`, `public/explore.html`, `public/market.html`, `public/member.html`, `public/nav.js`, `public/utils.js`
- **What landed:**
  - Alpha page fix (see `835dd63` below)
  - HOT ALPHA mobile carousel on explore.html (horizontal swipe ≤640px)
  - creator-dashboard SELL share calc now uses `posCurrentPrice` not `_limitPrice` for share count
  - SDK-matching rounding (`sizeDec`/`amountDec`) for FOK SELL orders
  - Whale open positions rendered on member profiles (`loadWhalePositions`)
  - member.html analytics/trophy/whale wiring fixed (removed dead `_origLoad` override)
  - `/rewards` removed from nav, redirected to `/`
  - `public/utils.js` shared utility module added
  - Dead pages deleted: `alpha-preview.html`, `user-dashboard.html`, `meet-kevin-oil-market.html`, `twitter-banner.html`
  - Profile routing: UUID user_ids → `/m/:userId`, wallet addresses → `/trader/:wallet`

### fix: Gamma API 0 edges (`835dd63`, `0399146`)
- **File:** `server.js` → `buildAlphaList()`
- **Bug:** `order=volumeNum` is not a valid Gamma sort param — API returned an error object, silently producing 0 markets. Also still used deprecated `/markets` endpoint.
- **Fix:** Changed to `order=volume24hr` + `markets/keyset` endpoint + `_gammaUnwrap()` + explicit throw on empty array.
- **Don't break:** Variable is `_rawArr` (not `_rawAll`) downstream at `_sortedAll = _rawArr.sort(...)`. There is exactly ONE call to `buildAlphaList` — don't add a second.

---

## 2026-04-23 — Session 15 (Claude Code, pre-merge)

### feat: HOT ALPHA mobile carousel (`5c5958a`)
- **File:** `public/explore.html`
- Horizontal scroll carousel showing top edge cards, swipeable on mobile (≤640px).
- Fetches `/api/alpha/top?n=10`.

### Alchemy CTF position discovery (`7b41bfa`, `333f87a`, `cea0324`)
- **Files:** `server.js`, `public/creator-dashboard.html`
- New endpoint `GET /api/polymarket/alchemy-positions/:address` — uses Alchemy NFT API to pull ConditionalToken ERC-1155 holdings directly (bypasses data-api.polymarket.com pagination limits).
- Frontend uses Alchemy endpoint first, falls back to public RPC.
- `ALCHEMY_API_KEY` env var required. If missing, falls back gracefully.
- **Don't break:** The Alchemy endpoint maps token IDs to markets via the CLOB `/markets` → `condition_id` lookup. The mapping cache is `_alchemyMarketCache` with 5-min TTL.

### Cleanup + profile fix (Session 15 main work, commit `101f195`)
- member.html: `loadWhalePositions`, `loadAnalytics`, `loadTrophyCard`, `loadInviteSection`, `showOwnerTools`, `loadSocialPredictions` all wired directly at end of `load()`. The dead `_origLoad` override that was shadowing them is gone.
- predictors.html: UUID user_ids now route to `/m/:userId`; wallet addresses still go to `/trader/:wallet`.

---

## 2026-04-22 — Session 15 (V2 SELL, Claude Code)

### V2 SELL end-to-end confirmed live (`c021ae7`, `841a13e`, `3ccc191`, `654f2aa`)
- **Files:** `public/creator-dashboard.html`, `public/market.html`
- CTF `setApprovalForAll` pre-flight for V2 SELL exchanges wired in both files.
- Dollar-rounding overshoot (≤2%) silently clamped to on-chain balance.
- FOK auto-fallback to GTC on thin-book fills (guarded by `_fokFallbackFired`).
- Bounded approval cap (`APPROVAL_CAP = 10B tokens`) to avoid Blockaid scam warning — do NOT revert to `MAX_UINT256`.
- **Don't break:** Six-step V2 SELL flow must stay intact in both `executeTrade` (market.html) AND `confirmTrade` (creator-dashboard.html). See CLAUDE.md "Consolidated V2 SELL flow."

### Trade modal premium glass redesign (`6535818` → `7b41bfa`)
- **File:** `public/creator-dashboard.html`
- Old inline-style modal replaced with `.tm-backdrop` / `.tm-sheet` CSS classes. All JS (`confirmTrade`, `setTradeMode`, `adjustPrice`, `setMaxShares`, `quickAmount`, `toggleOrderType`, `loadOrderbook`) keeps same IDs and function names — only HTML/CSS changed.
- Yes/No picker (`tm-side-row`) replaces the old Buy/Sell tab structure. The `setTradeMode('buy'|'sell')` function still exists but controls BUY vs SELL direction; the side (YES/NO) is separate.

---

## 2026-04-22 — Polymarket CLOB V2 cutover (canonical)

- V2 is the default as of Apr 22. `window.HF_USE_CLOB_V2 = true` is the default.
- V2 host: `clob-v2.polymarket.com`. V1 host: `clob.polymarket.com`. Route by presence of `order.builder`.
- pUSD (`0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB`) is the collateral token. BUY orders need pUSD in proxy; wrap via CollateralOnramp (`executeViaProxy`).
- HYPERFLEX V2 builder code: `0x7439e528420d6ed0be9ce10c9698e9a7d490f12e828f7ef8c0992f3fd1eb49b8` — builder fees at 0% until Polymarket verification lands.
- CTF V2 exchange: `0xE111180000d2663C0091e4f400237545B87B996B`. NegRisk V2: `0xe2222d279d744050d28e00520010520000310F59`. Both need separate `setApprovalForAll`.

---

## 2026-04-13 — Session 14 (Social Media Pivot)

### Takes system (`6a85728`, `bd7b41b`, `1c809bc`)
- **Files:** `server.js`, `public/explore.html`, `public/market.html`, `public/member.html`
- `takes` + `take_reactions` tables (migrations #44, #45).
- Whale takes auto-synthesized from $50k+ trades and consensus signals.
- `scoreTakesForMarket()` fires on resolution — marks takes correct/incorrect.
- Feed endpoints: `GET /api/takes/feed`, `/api/takes/trending`, `/api/takes/market/:slug`.
- **Migrations needed:** #44 `supabase_migration_takes.sql`, #45 `supabase_migration_whale_profiles.sql`.

---

## Standing rules (read before any build)

- **Single order route:** exactly ONE `app.post('/api/polymarket/order')` in server.js (~line 35915). Adding a duplicate causes permanent 401 loops.
- **`_confirmTradeRetryCount` guard:** caps API key re-derive retries at 1. Do not remove.
- **`deferExec: false`** must be in every order body.
- **FOK decimal caps:** BUY maker=2dec USDC / taker=4dec shares. SELL maker=2dec shares / taker=4dec USDC. (SDK `ROUNDING_CONFIG` at tick 0.01.)
- **Never use `order=volumeNum`** in any Gamma API URL — it is not a valid param.
- **Never make Railway the primary trade route** — US IP is geo-blocked by Polymarket.
- **Never approve `MAX_UINT256`** on V2 contracts — Blockaid flags as scam.
- **Book walk required before FOK submit** — see CLAUDE.md Trade Failure Runbook.
- **`getPolymarketProxy()` is duplicated intentionally** between market.html and creator-dashboard.html — do not consolidate without reading the CLAUDE.md note.
- **Never start/stop the server locally** — Railway handles production. Edit files and push.
- **Production DB is Railway Postgres**, not Supabase. Run migrations in Railway SQL console.
- **Font system:** Inter (display) + JetBrains Mono (mono). Palette: gold `#c9920d`, green `#00e68a`, red `#ff4d6a`, blue `#4d9fff`, purple `#a855f7`.
