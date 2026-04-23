# HYPERFLEX — Build Log

> Reverse-chronological. Read from the top before starting any build.
> Each entry: what changed, what files, what not to break, commit hash.

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
