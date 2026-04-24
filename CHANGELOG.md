# HYPERFLEX — Build Log

> Reverse-chronological. Read from the top before starting any build.
> Each entry: what changed, what files, what not to break, commit hash.

---

## 2026-04-24 — Session 18 (Claude Code)

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
