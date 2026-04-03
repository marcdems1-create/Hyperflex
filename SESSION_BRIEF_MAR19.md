# HYPERFLEX Session Brief — March 19, 2026
> Load this + CLAUDE.md + HYPERFLEX_Brief.md at the start of any new session.

---

## Who You Are Talking To
- **Marc** — founder of HYPERFLEX. You are the CTO.
- **Workflow rule (critical):** Cowork = research, planning, writing prompts only. Claude Code (Mac terminal at `/Users/marcdems/Desktop/HYPERFLEX`) = all file edits, git commits, git pushes. Never write code in Cowork.
- **VirtioFS sync issue:** Cowork VM edits do NOT flush to Mac in real time. Claude Code will show a clean working tree even after Cowork makes changes. Always write prompts for Claude Code to implement — never patch files directly in Cowork.

---

## Current Deployment State

- **Live site:** https://hyperflex.network
- **Repo:** https://github.com/marcdems1-create/Hyperflex.git (branch: `main`)
- **Deploy:** Railway auto-deploys on push. Project name: `poetic-manifestation`.
- **Latest committed:** `d174551` — Dashboard topbar cleanup (Mar 18, 20:41 EDT)
- **Railway status as of this session:** Was in a crash loop due to `_polyCache is not defined` (ReferenceError at server.js:11807). Claude Code committed fix in `8ae4ddd` — adds `const _polyCache = new Map();` at line ~278 alongside other cache declarations. If Railway is still crashing, this fix may not have deployed. Tell Claude Code to verify `_polyCache` is declared near lines 275–278 in server.js alongside `_kalshiCache` and `_manifoldCache`.

---

## This Session's Work

### 1. Railway Crash Diagnosed
- **Root cause:** `_polyCache` was used at two places in server.js (lines 8288 and 11807) but never declared. Every Polymarket API request crashed the server → Railway restart loop.
- **Fix:** Add `const _polyCache = new Map();` near line 278 (after `_manifoldCache` declaration).
- **Status:** Fix committed by Claude Code as `8ae4ddd`. Verify it deployed cleanly.

### 2. UX Audit — Full Site Review
Reviewed: landing, /predictors, /odds, /explore, /templates, /creator/dashboard

**Critical findings:**

#### Nav is inconsistent on every page (the main UX maze)
Each page has a completely different nav structure. A user can't build a mental model.
- Landing: `Predictors · 🔴Live · Odds · Templates · Pricing` + `[Explore] [Sign in] [Get started free]`
- Predictors: `Predictors · Live · Odds · Templates` + `[Dashboard]`
- Odds: `Explore · Predictors · Dashboard`
- Explore: `Explore · Odds · [My Dashboard] [Sign out]`
- Templates: `Home · Explore · Odds · Dashboard`

**Fix (for Claude Code):** Standardize to one nav across all pages. Logged-out: `Odds · Predictors · Explore · Templates · [Sign in] [Get started free]`. Logged-in: same + `[Dashboard]`, remove Sign in. Remove the redundant `[Explore]` styled button from the landing nav (it's already a nav link).

#### `🔴 Live` nav item is ambiguous
Looks like a status indicator, not a clickable link. Should be renamed `Explore` or removed (Explore already covers it).

#### Landing nav has 3 competing CTAs
Top right: `[Explore]` button + `Sign in` + `[Get started free]`. Drop the `[Explore]` button.

#### Logo inconsistency across pages
- Landing: gold hex logo
- Predictors: "HF" square
- Explore/Templates: wordmark text only
Should be the same hex logo on every page.

#### Dashboard sidebar — two "ACCOUNT" section headers
One says `ACCOUNT` with item `Account`, another says `ACCOUNT` with item `My Account`. Deduplicate.

#### Dashboard still shows FREE badge + "Upgrade to Pro"
Beta Premium override (`const plan = 'platinum'`) should already be in code. Confirm it's in `renderDashboard()` in creator-dashboard.html. If Railway is serving old code this may explain it.

#### Footer tagline contradicts hero messaging
Footer: "Prediction markets for creator communities. Play-money, AI-powered, no code required."
Hero: aggregator-first (Polymarket/Kalshi/Manifold portfolio tracker)
Fix footer to: "Cross-platform prediction market dashboard. Track Polymarket, Kalshi, and Manifold in one place."

#### /odds page search is broken
The search on /odds.html queries the DB (cached_positions) instead of `/api/markets/search?q=`. Fix: update the search handler to `fetch('/api/markets/search?q='+query)`. Response shape: `{ polymarket: [], kalshi: [] }`.

#### Find Markets tab — wrong input handler (duplicate ID bug)
In creator-dashboard.html there are two elements with `id="mktSearchInput"`:
- Line ~3142: Markets tab input — rename to `id="dashMktSearchInput"`, `oninput="onDashMarketSearch(this.value)"`
- Line ~4774: Find Markets tab input — keep `id="mktSearchInput"`, change `oninput` to `debouncedMktSearch(this.value)`

---

## Prompts Ready to Give Claude Code

### Prompt A — Nav standardization + /odds fix + Find Markets input fix
Give Claude Code this:

> In `/Users/marcdems/Desktop/HYPERFLEX`, make these 4 changes:
>
> **1. Fix /odds page search (public/odds.html)**
> Find the search function. Replace it so it calls `/api/markets/search?q=<query>`. Response: `{ polymarket: [], kalshi: [] }`. Each item has `question`, `yes_price`/`no_price` (0–1), `end_date`, `url`. Show results side-by-side by platform with question, badge, YES%/NO%, expiry, "Bet →" link.
>
> **2. Standardize nav across all public pages**
> In predictors.html, explore.html, templates.html, odds.html, member.html, profile.html — add a `Dashboard` link to `/creator/dashboard` shown only when `localStorage.getItem('hf_token')` is truthy. Match existing nav style per file.
>
> **3. Add "Odds" to landing page nav (public/index.html)**
> In the nav links, add `Odds` pointing to `/odds` between Live and Templates.
>
> **4. Fix Find Markets tab duplicate ID (public/creator-dashboard.html)**
> - Line ~3142 (Markets tab input): rename `id` to `"dashMktSearchInput"`, set `oninput="onDashMarketSearch(this.value)"`
> - Line ~4774 (Find Markets tab input): keep `id="mktSearchInput"`, change `oninput` to `debouncedMktSearch(this.value)`
>
> Commit: `git commit -m "fix: nav standardization, odds search, Find Markets input handler"`

---

## Marketing — Trader Mayne Outreach

**Target:** @Tradermayne on X — 560K followers, 70K YouTube subs, hosts "The Order Book" show on Polymarket. Runs @breakoutprop (prop trading firm, acq by @krakenfx). Finance/macro trader covering Fed, oil, crypto, geopolitics. Posts live Polymarket positions publicly.

**Why he's the perfect fit:** He actively bets on Polymarket, publicly announces positions to 560K people, has a show literally called "The Order Book" on Polymarket. His audience has no way to track his positions or compete on a leaderboard. That's HYPERFLEX's exact pitch.

**Tweet that triggered the outreach (Mar 18, 11:52 PM):**
> "No rate cuts today but I do think we are due. Next FOMC meeting is in late April. I bet on yes to 25bps cut last week, I doubled down the position yesterday bringing my avg down. The upside asymmetry is crazy so I'm ok being wrong a couple times. When I hit it'll hit big."
> Attached: Order Book video "Fed Rate Cuts & Bitcoin: What's Next?" showing Polymarket interface.

**Reply drafted (from @HyperFlexapp):**
> 560K people watching you double down on 25bps with no way to track your position or bet alongside you on a leaderboard.
>
> That's the gap. hyperflex.network

**Status:** Reply was typed into X compose box, link preview card generated (showed "All Your Predictions. One Place." with Poly/Kalshi/Manifold badges). Marc to confirm post.

**DM angle (if no reply to tweet):**
Pitch: "You already have a prediction market show. HYPERFLEX turns it into an actual prediction market community — your followers track your calls, compete on a leaderboard, win when you win. The Order Book audience bets alongside you in real time."

**Other creators to target with same playbook:**
- Anyone on "The Order Book" Polymarket show
- Kalshi creators posting public positions
- Finance YouTubers/podcasters who talk about their market calls

---

## Known Bugs / Open Issues

| Issue | Status | Notes |
|-------|--------|-------|
| `_polyCache` crash loop | Fix committed `8ae4ddd` | Verify Railway deployed it |
| "Could not load dashboard" toast | Caused by above crash | Should clear after Railway fix |
| /odds search returns nothing | Not yet fixed | Needs Claude Code prompt A above |
| Find Markets wrong input handler | Not yet fixed | Needs Claude Code prompt A above |
| FREE badge showing on beta accounts | May be deployment lag | `const plan = 'platinum'` should be in renderDashboard() |
| Nav inconsistency across pages | Not yet fixed | Needs Claude Code prompt A above |
| Footer tagline wrong messaging | Not yet fixed | Minor, do with nav pass |
| Predictor leaderboard empty | No data yet | Not a bug, content gap |
| Video section on landing needs real YouTube ID | Pre-existing | Not urgent |

---

## Key Technical Facts

- **Stack:** Node.js + Express 5 + Supabase + Anthropic SDK. Plain HTML/CSS in `public/`.
- **DB table:** `creator_settings` (NOT `communities`) is the main creator table.
- **Plan values in DB:** `'free'`, `'pro'`, `'platinum'` — display as Free / Pro / Premium in UI. Never change `'platinum'` to `'premium'` in DB.
- **Beta override:** `const plan = 'platinum'` in `renderDashboard()` in creator-dashboard.html — forces all accounts to Premium visually during Early Access.
- **Fonts:** Syne (display) + Space Mono (mono).
- **Colors:** Gold `#c9920d`, paper/bg `#141412`.
- **Caches in server.js (around line 275):** `_kalshiCache`, `_manifoldCache`, `_predictorFollowCache`, `_polyCache` — all `new Map()`.
- **Auto-sync cron:** `syncAllUserPositions()` runs hourly — fetches all connected users' Poly/Kalshi/Manifold positions into `cached_positions`.
- **`/api/markets/search`:** Queries Polymarket Gamma API + Kalshi public markets in parallel, 3-min cache. Returns `{ query, polymarket: [], kalshi: [], fetched_at }`.

---

## Migrations Run in Supabase (confirmed through #30)
All 30 migrations up to `supabase_migration_cached_positions.sql` have been run. Do not re-run them. Any new features needing DB changes require a new numbered migration file.

---

## Session Goals Not Yet Done
1. Full nav standardization across all pages
2. /odds search fix
3. Find Markets input handler fix
4. DM to Trader Mayne (if tweet reply doesn't get response)
5. FORS-inspired features (arbitrage badge, Best Entry highlight, Smart Money bar) — designed, not yet built
