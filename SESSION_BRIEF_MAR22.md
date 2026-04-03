# HYPERFLEX — Claude Code Handoff Brief
# Last updated: March 22, 2026 (Cowork session)
# Paste this as your FIRST message in any new Claude Code session.

---

## Your job
You are the CTO of HYPERFLEX. The repo is at `/Users/marcdems/Desktop/HYPERFLEX`. Read this entire brief before touching anything. Then run `git log --oneline -5` and `git status` and show me the output.

**Critical rule: Do not spawn sub-agents or use the Task tool. Do everything yourself directly. When done with any task, show me exactly which files you changed and which lines.**

---

## What HYPERFLEX is now

The product has pivoted significantly. It is now a **prediction market intelligence dashboard** — not just a portfolio tracker. The live site at hyperflex.network has these pages:

| Page | URL | Status |
|------|-----|--------|
| Landing | / | ✅ Works — "Prediction market intelligence" hero |
| Whales | /whales | ✅ Works — real Polymarket data, $177M+ tracked |
| Whale Index | /whale-index | ✅ Works — top 50 whale portfolio, consensus picks |
| Screener | /screener | ✅ Works — 200 real markets, filters, Trade buttons |
| Data | /data | ✅ Works — whale flow, smart money sentiment |
| Signals | /signals | ✅ Works — alpha signals, Fear & Greed |
| Crystal Ball | /crystal-ball | ⚠️ Broken — all confidence scores show 100/100 |
| Accuracy | /accuracy | ❌ Broken — shows 0%, 0 predictions, empty chart |
| Leaderboard | /leaderboard | ❌ 404 — page doesn't exist |
| Odds | /odds | ✅ Works — cross-platform comparison |
| Templates | /templates | ✅ Works |
| Explore | /explore | ✅ Works |
| Predictors | /predictors | ✅ Works |
| Dashboard | /creator/dashboard | ✅ Works — My Positions, Portfolio tabs |
| API Docs | /api-docs | ✅ Works |
| Creator Login | /creator/login | ⚠️ Google OAuth broken in MetaMask browser |
| Creator Signup | /creator/signup | ⚠️ Google OAuth broken in MetaMask browser |

---

## Stack
- Node.js + Express 5 + Supabase + Anthropic SDK
- Plain HTML/CSS in `public/`
- Railway auto-deploys from `git push origin main`
- Repo: https://github.com/marcdems1-create/Hyperflex.git
- Live: https://hyperflex.network

---

## 5 fixes needed — do these ONE AT A TIME

### Fix 1 — Polymarket Trade links all 404
**Problem:** Every "Trade →" and "View →" button across screener.html, signals.html, whales.html, crystal-ball.html, whale-index.html constructs Polymarket URLs by slugifying question text. This produces wrong URLs that 404.
**Fix:** Use the market's `slug` field from the API response directly: `https://polymarket.com/event/${market.slug}`. If slug is missing, fall back to `https://polymarket.com`.
**Files to check:** `public/screener.html`, `public/signals.html`, `public/whales.html`, `public/crystal-ball.html`, `public/whale-index.html`
**Commit message:** `fix: polymarket trade link slugs`

### Fix 2 — Remove Leaderboard from all navs
**Problem:** `/leaderboard` is a 404 but it appears in multiple navs. Users click it and hit a dead page.
**Fix:** Find every HTML file in `public/` with a nav link to `/leaderboard` or text "Leaderboard" in a `<nav>` element. Remove only those nav links. Don't delete the page file if it exists.
**Commit message:** `fix: remove broken leaderboard nav link`

### Fix 3 — Accuracy page empty state
**Problem:** `/accuracy` shows 0%, 0 predictions, empty chart. Looks dead and broken.
**Fix:** In `public/accuracy.html` — replace all zero values in stat cards with `—` dashes. Add a banner: "Signal tracking started March 22, 2026 — check back in 30 days for verified results." Hide the empty chart section with `display:none`.
**Commit message:** `fix: accuracy page empty state`

### Fix 4 — Crystal Ball confidence scores
**Problem:** Every signal shows 100/100 confidence which looks fake. Traders won't trust it.
**Fix:** In `public/crystal-ball.html` — add `Math.min(95, score)` so nothing exceeds 95. If score is 0 or 100 as a default, use signal-type defaults: momentum=72, arbitrage=88, whale_cluster=81, divergence=65, expiry=70.
**Commit message:** `fix: crystal ball confidence score cap`

### Fix 5 — Google OAuth broken in MetaMask + add X sign-in
**Problem:** When users (especially crypto traders) try to sign in via MetaMask's built-in browser or any in-app browser, Google returns `Error 403: disallowed_useragent`. This blocks the entire target audience.
**Fix:** In `public/creator-login.html` AND `public/creator-signup.html`:
1. Detect in-app browsers at page load: `const isInApp = /MetaMask|FBAV|FBAN|Instagram|Twitter|wv|WebView/.test(navigator.userAgent)`
2. If `isInApp` is true: hide Google sign-in button, show message "Google sign-in doesn't work in this browser — open hyperflex.network in Chrome or Safari to continue" + a Copy Link button that runs `navigator.clipboard.writeText(window.location.href)`
3. Add "Continue with X" button on both pages wired to the existing X OAuth route in server.js. Style it same as Google button.
**Commit message:** `fix: metamask auth detection + X sign-in button`

---

## Known Claude Code session issues

The previous Claude Code session was hitting this API error repeatedly:
`API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.8: user messages must have non-empty content"}}`

This crashes the session mid-task. Caused by chained tool calls where one returns empty.

**To avoid it:**
- Use `claude-sonnet-4-6` model (not Opus)
- Do one fix at a time, start a new session for each fix if needed
- Keep prompts short — one task, a few sentences max
- Never chain all 5 fixes in one prompt

---

## Current Railway deployment
- Last known good commit in Cowork VM: `d174551`
- Claude Code has made additional commits after this (the new whale/signals/screener pages)
- Railway auto-deploys on every push to `main`
- If Railway is stuck: go to railway.app → poetic-manifestation → Deployments → click ⋮ → Redeploy

---

## Key facts
- DB table: `creator_settings` (not `communities`)
- Plan values in DB: `'free'`, `'pro'`, `'platinum'` — display as Free/Pro/Premium
- Beta override: `const plan = 'platinum'` in `renderDashboard()` forces all accounts to Premium visually
- Fonts: Syne (display) + Space Mono (mono)
- Gold: `#c9920d` | Background: `#141412`
- Do NOT run `node server.js` or start/stop the server locally — Railway handles production

---

## Marketing context
- Target user: Polymarket/Kalshi traders, crypto traders, finance content creators
- Key outreach: @Tradermayne (560K followers) — replied to his Fed tweet from @HyperFlexapp
- Viral tweet drafted (ready to post from @HyperFlexapp):
  > "The #1 Polymarket trader just put $2,540,778 on Real Madrid losing today. The crowd says 77% chance Madrid wins. He says no. We track the top 50 whales in real time → hyperflex.network/whales"
- Tag @Polymarket — they retweet content like this

---

## What NOT to do
- Do not rewrite pages that are already working
- Do not change the visual design
- Do not rename DB columns or plan values
- Do not run the server locally
- Do not spawn sub-agents
