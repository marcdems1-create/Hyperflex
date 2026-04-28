# HYPERFLEX — Claude Session Memory

> This file is auto-read by Claude at the start of every session. Keep it updated.
> Full details in HYPERFLEX_Complete_Brief.md. Read that too.
> **CHANGELOG.md** — read this before every build. Every code change is logged there with commit hash, files touched, and "don't break" notes for the next agent.

---

## 🎯 NORTH STAR — RETENTION & ADDICTION (read this before every response)

**Goal:** build the most addicting gambling/investing platform ever built. Every feature, every UI decision, every endpoint, every piece of copy must be evaluated through this lens:

> **"Does this make the user want to come back tomorrow, and again the day after?"**

When Claude is asked to ship *anything* — a new feature, a UI tweak, a copy change, a bugfix — the default thought process is:
1. **What's the dopamine loop?** Every interaction should produce a small reward. Wins get celebrated. Losses get re-engagement (streak warnings, "your take came close," revenge-trade prompts). Neutral states should be rare.
2. **What's the return hook?** Unread count. Streak at risk. Market resolving in 2h. Whale just took a side. Someone agreed with your take. Your passport got a new follower. Something new since last visit, surfaced the moment they open the app.
3. **What's the social proof?** Leaderboards, profile flex, ORACLE/SHARP/FLEXIN tiers, "X just made $Y," "N traders are watching this." Status is the only infinite resource.
4. **What's the variable reward?** Every whale signal, every market flip, every resolution outcome is a pull of the slot-machine lever. Make them feel like that — even when the data is the same, the *framing* should shift (new leader, divergence spike, sharp vs crowd).
5. **What's the identity attachment?** Every FLEX point, every take with a CORRECT badge, every tier upgrade is something the user can't get back once they leave. Sunk identity = retention.

**Concrete mechanics already in the codebase** (keep compounding these, don't regress):
- FLEX Score — domain-agnostic composite tied to real performance (accuracy + ROI + sample + dog rate + recency). Replaces the old "FLEX Points as rep currency" framing. One number, earned by being right, visible everywhere. No accumulation currency, no spend, no shop. See Voice & Posture below for why.
- Streaks + streak-warning emails (loss aversion)
- Tier ladder (Building → TRADER → PROFITABLE → SHARP → SHARK → WHALE → FLEXIN)
- Take reactions + reaction-gated comments (forces commitment, creates feed)
- Notifications bell (always-on unread hook)
- Predictor Passport (shareable credential = off-platform flex → on-platform return)
- Weekly email digest + Predictor Spotlight (inbox hook)
- Whale-take auto-synthesis (feed never empty)
- Quote-predict (challenge mechanic → engagement flywheel)

**Forbidden anti-patterns**:
- Generic "nothing here yet" empty states. Every empty state needs a CTA with a clear path to a dopamine hit.
- Silent background updates with no user-facing signal. If a whale moves, if their tier advances, if a streak risks breaking — SURFACE IT with a badge, notification, or toast.
- Killing a lever to "clean up the UI." Streaks, badges, glows, counts, chips — these are not decoration, they're the product.
- Features that only pay off monthly/quarterly. Aim for daily dopamine, not annual ROI.
- Playful surfaces (share cards, roast cards, weekly recaps, "fade the public" feeds) firing on empty data. Gate them behind real supply thresholds — a user with 3 picks is not ready for a weekly recap. Empty playfulness reads as desperation.

**When in doubt, ask:** would a degenerate Polymarket trader check this 5x a day? If the answer is no, either add a hook or don't ship it.

---

## 🎙️ VOICE & POSTURE (canonical — read before writing any user-facing copy)

Canonical. Every copy decision on the platform references this document. If a surface contradicts the charter, the surface is wrong.

### 1. Who writes HYPERFLEX

A sharp who made it, stopped posting publicly, and runs the back room where real bettors actually hang out. Dry, numerate, controlled. Reads more like a WSJ gambling columnist who's also a degen than like anything on betting Twitter in 2026.

Assumes the reader knows spreads, odds, units, CLV. Never condescends. Never explains what a push is. Never links to a glossary.

Does not participate in the meme cycle. No "fr fr." No all-lowercase affectation. No phrase that depends on a trend younger than 24 months. Writes like the copy will still ship in 2028.

### 2. Register: 90/10 dry to warm

Default register is dry. Factual, numerate, slightly approving when earned. Reader does the emotional work.

- ✅ "Pick landed. +2.73u."
- ❌ "Nice hit! 🎯 +2.73u!"
- ❌ "Finally. +2.73u."

Warmth is reserved, not sprinkled. The only moments the platform speaks warmly:

- First locked pick ever (once per account, lifetime)
- First graded win after a 5+ loss streak (the comeback)
- 12-week continuous posting milestone, then every 26 weeks after (durability)
- Top-decile finish in a seasonal cohort (real achievement)
- Anniversary of joining (annual, "still here")

Everything else stays dry. Routine wins, daily opens, fresh signups, setup completions, feature discovery, and losses all receive default register. Tempting moments for warmth — welcome flows, onboarding, payment confirmations — are explicitly excluded.

### 3. Side-taking on losses

The platform takes a position: surviving losses publicly is status-conferring. The capper who ghosts at 0-4 loses what the survivor earns.

This is the posture Pikkit cannot copy, because their product philosophy treats a loss as private. Ours treats it as visible and, when weathered, dignified.

Concrete expressions:

- "Posted every week, 12 weeks" profile chip
- "Survived a −12u week" profile chip
- Losing cards share the same layout dignity as winning cards (different color, same weight)
- Weekly recaps don't flinch from the ugly number

What the platform does not do: mock losses, celebrate losses, or console losses. It records them.

### 4. Platform funny vs community funny

Humor lives in exactly three surfaces: loading states, empty states, and error screens (404/500/timeout/auth/rate-limit/payment-declined).

Everywhere else — notifications, feed copy, profile surfaces, email, modals, tooltips, confirmations — is numerate and neutral. Users perform jokes on top of the platform; the platform sets the stage.

The platform never editorializes on user content. It can narrate system events ("Pick locked. Cannot be edited.") but never comments on the take itself. No "🔥 Hot pick!", no "Bold call!", no "Interesting play." The content speaks for itself. Labels describe mechanics, never quality.

### 5. The meme-cycle test

Before any copy ships, ask: *Would this still read right in 2 years?*

If the phrase depends on a current meme, it fails. If it depends on permanent betting vocabulary, it passes.

| ❌ Don't | ✅ Do |
|---|---|
| "This one's cooked." | "Resolved a loss." |
| "Locked in 🔒" (decorative) | "Locked at 7:14 PM." |
| "Tailing the sharps 📈" | "Following three tipsters." |
| "We're so back." | "Four wins after four losses." |
| "It's giving sharp energy." | "Top decile this week." |
| "Chalk it up." | "Favorite covered." |
| "Fade the public." | Allowed — permanent term. |

Permanent vocabulary is welcome: units, spread, moneyline, CLV, push, cover, hedge, juice, fade, sharp, square, parlay, prop, total, ML.

### 6. Emoji policy

Zero decorative emoji. Functional glyphs only, used for semantic meaning:

- `✓` verified
- `●` live
- `—` push / void
- `🔒` on the literal "locked" state of a pick (the one permitted emoji, because it's functional shorthand the audience already reads semantically)

No 🎯 🔥 📈 💰 🏆 ⚡ 💎 anywhere, ever. No flag emoji on team names. No confetti on wins. No sad face on losses.

### 7. Numeric formatting

Dry voice is violated instantly by inconsistent numbers. Lock it.

- **Units:** always 2 decimals, always with sign. `+2.73u`, `−3.00u`, `0.00u`. Never `+2.7u`, never `+2.732u`.
- **ROI:** always signed, one decimal. `+14.3%`, `−8.1%`.
- **Win rate:** one decimal when shown as percentage. `63.4%`.
- **Odds:** American format only. `−110`, `+145`. Never decimal (`1.91`), never fractional.
- **Timestamps:** relative inside 24h (`14 min ago`, `3h ago`), absolute after (`Apr 18, 7:14 PM`). Timezone respected per user setting.
- **Sample size:** performance numbers on profiles and leaderboards show sample size inline (`63.4% (47 picks)`). On compact surfaces (pick cards, mobile tiles, embeds), sample size is accessible in one tap or hover. Never hidden, always reachable. Performance without a path to sample size is a lie.

### 8. FLEX Score rule

FLEX Score is a derived rating, not an accumulated currency. It is bounded and normalized. It appears on profiles and leaderboards — nowhere else.

- Derived from recent performance, not a sum of actions
- Posting volume does not increase FLEX Score
- Bad picks lower it; good picks raise it; dormancy decays it
- Displayed as a bounded number users read as a rating, not a balance

The old "FLEX Points" framing — earn-on-trade, accumulate, spend — is retired. No accumulation currency, no shop, no spend, no tiers to unlock. One score, earned by being right.

### 9. What the platform never does

- Never uses exclamation points in default register (reserved for the 5 warmth triggers, and even there, used once per message maximum)
- Never addresses the user by first name in copy ("Welcome back, Marc" is forbidden; "Welcome back" is fine)
- Never implies urgency it can't back up ("Act now!" / "Don't miss out!")
- Never apologizes for system events that aren't failures
- Never asks the user "How are you feeling?" or equivalent
- Never uses "we" to refer to the platform — **except** in error copy, explicit policy, or FAQ contexts. Example: `We couldn't reach the server. Try again.` is allowed (beats the passive `The server couldn't be reached.`). `We're excited to have you!` is forbidden.
- Never uses second person in data displays ("Your record: 47-32-3" → "Record: 47-32-3")
- Never compliments a take, call, thesis, or opinion
- Never uses a word where a number would communicate faster

### 10. Voice smell test

Before shipping copy, read it aloud. If any of these are true, rewrite:

- Sounds like it came from a bank app
- Sounds like it came from Duolingo
- Sounds like it came from a crypto project
- Sounds like it's trying to be your friend
- Sounds like it was written by someone who doesn't bet
- Contains a word the reader would never say out loud in this context

---

## What This Project Is

**HYPERFLEX** is the **social media of prediction markets** — the place where traders post takes, build track records, follow the smartest predictors, and act on edge. Think Twitter for predictions, where every take is scored when the market resolves, and your track record is your reputation.

**The moat is the social graph.** Whale signals and alpha terminals are commoditized — anyone with a Claude API key can build a screener. What can't be cloned overnight is a network of predictors with verified track records, social connections, and engagement history. That's what we're building.

**Primary surfaces:**
- **Landing / Explore** at `/` (file: `public/explore.html`) — the front door. Shows top edges, intelligence cards, live stats, and a **preview** of the FLEX Feed. NOT the full feed — users click through to `/feed` for the full experience. `/explore` redirects here (301).
- **FLEX Feed** at `/feed` (file: `public/feed.html`) — the full social feed. Two tabs: **For You** (algorithmic + followed users) and **Trending** (trending takes + influencer posts from X/Reddit interleaved). This is a SEPARATE file from explore.html — do NOT confuse them.
- **Alpha Terminal** at `/alpha-live` — live Polymarket edges ranked by Edge Score (8 signals). The Bloomberg layer underneath the social product.
- **Member Profiles** at `/m/:userId` (file: `public/member.html`) — trader profile with tier card, takes, trades, track record. Auto-created for every user + top-50 Polymarket whales.
- **Prediction Passport** at `/passport/:userId` (file: `public/passport.html`) — shareable credential page for verified prediction track record. Embeddable via iframe.
- **Market Pages** at `/market/:slug` — Polymarket trading with Community Takes section, post-trade "Share your take" prompt.

**⚠️ IMPORTANT: explore.html vs feed.html**
These are TWO DIFFERENT files serving TWO DIFFERENT purposes:
- `explore.html` = landing page at `/` — intelligence briefing + feed PREVIEW
- `feed.html` = full feed at `/feed` — the actual social feed with tabs
Changes to the feed tabs/rendering must be made in BOTH files or (preferably) only in `feed.html` with explore.html showing a preview that links to `/feed`.

**Target user:** Active Polymarket traders who want to post takes, build reputation, and see what sharps think. Whale-watchers who follow whale profiles. Crypto/finance creators proving their track record.

**Live:** https://hyperflex.network
**Railway:** auto-deploys from `git push origin main`
**Stack:** Node.js + Express + Supabase + Anthropic SDK. All frontend is plain HTML/CSS in `public/`.

---

## Strategy & Revenue

### Revenue Streams (prioritized)

1. **Polymarket Builder Fees** (LIVE) — every trade placed through `/market/:slug` earns builder fees. The social layer drives users to market pages → trades → revenue. This is the primary revenue engine today.

2. **Data API for Hedge Funds** (NEXT) — sell programmatic access to our enriched data:
   - Whale flow data: real-time position changes across top 50 traders
   - Consensus signals: when 3+ whales align on a market
   - Edge scores: our proprietary 8-signal scoring model
   - Historical accuracy: verified signal performance over time
   - Pricing: $500-2000/mo per API key, rate-limited by tier
   - Target customers: crypto hedge funds, quant desks, prop trading firms

3. **Grants & Ecosystem Funding** — apply to prediction market ecosystem grants:
   - Polymarket builder/ecosystem grants (we already earn builder fees)
   - Ethereum Foundation grants (prediction market infrastructure)
   - Crypto VC ecosystem funds (social + prediction market intersection)
   - The social layer + verified track record data is the unique angle for grant applications

4. **Premium Tiers** (existing infrastructure, not yet enforced):
   - Pro ($29/mo): API access, advanced analytics, faster auto-sync
   - Premium ($99/mo): full API, all features, priority
   - Currently everything is free to drive adoption. Gate later when network effects compound.

### Social Media Attack Plan

**Phase 1 — Content Engine (NOW)**
The feed must never be empty. Whale activity IS content from day one:
- $50k+ whale trades → auto-generated takes with position size, entry, thesis
- 3+ whale consensus → consensus takes showing aligned capital
- Both linked to whale profiles users can follow
- Result: social feed has real content before any human users post

**Phase 2 — Engagement Loops**
Every interaction creates a notification that brings users back:
- "X agreed with your take" → user returns to see who
- "X counter-predicted your take" → user returns to defend their position
- "Your take on ETH was RIGHT" → dopamine hit, user posts more
- "Whale #3 just made a new take" → followers check the feed
- Take of the Day email → daily re-engagement

**Phase 3 — Reputation as Moat**
Track record becomes the thing nobody can replicate:
- Every take scored on resolution (CORRECT / WRONG badge permanent)
- Predictor tiers: Oracle (70%+) / Sharp (60%+) / Solid (50%+) / Speculator
- "Top 50 on HYPERFLEX" becomes a credential people put in their X bio
- Whale profiles accumulate years of on-chain prediction history
- After 6 months: thousands of scored predictions, social graph, reputation data — unchlonable

**Phase 4 — Network Effects**
The social graph compounds:
- Prediction threads (take → counter-take → resolution)
- Quote-predict as engagement mechanic (like quote-tweet for predictions)
- Share cards for X/Twitter with take + track record
- DMs between predictors
- The feed becomes what people open every morning

### Why This Wins

Every prediction market tool on Twitter right now is a **terminal** — a dashboard of data you look at and leave. Terminals don't have network effects. A competitor can replicate your screener in a weekend.

Social products compound. Every take posted is content. Every follow is a connection. Every resolution scored is reputation banked. The alpha terminal becomes a **feature** inside the social product, not the product itself.

---

## The Social Stack (built April 2026)

### Takes System
- `takes` table: user_id, market_slug, condition_id, question, side, entry_price, amount, thesis, source ('user'/'whale'/'consensus'), parent_take_id (quote-predicts), agree_count, disagree_count, is_correct, resolved_at
- `take_reactions` table: take_id, user_id, reaction ('agree'/'disagree'), unique per user per take
- `scoreTakesForMarket()`: fires on market resolution, marks all matching takes correct/incorrect
- Notifications: reaction alerts, quote-predict alerts, "your take was right" celebration

### Whale Profiles
- `ensureWhaleProfile()`: auto-creates user records for whale wallets with rank, PnL, wallet address
- Top 30 whales get profiles on every leaderboard fetch (~5 min cycle)
- Whale takes linked via user_id → profiles show take history
- `GET /api/whale-profiles`: whale discovery endpoint with take stats
- `is_whale`, `whale_rank`, `whale_pnl` columns on users table

### Feed Endpoints
- `GET /api/takes/feed?mode=foryou|following` — algorithmic feed (recency × engagement × sharp score)
- `GET /api/takes/trending` — hot takes by trending score with category filter
- `GET /api/takes/market/:slug` — takes for a specific market
- `POST /api/takes` — create a take (auth required)
- `POST /api/takes/:id/react` — agree/disagree toggle
- `DELETE /api/takes/:id` — delete own take

### Migrations
- #44: `supabase_migration_takes.sql` — takes + take_reactions tables
- #45: `supabase_migration_whale_profiles.sql` — is_whale, whale_rank, whale_pnl on users

---

## Business Model

**100% FREE for users.** Every feature, every signal, every tool. Revenue comes from:
1. Polymarket builder fees on every trade routed through `/market/:slug`
2. Data API subscriptions for hedge funds / institutions (planned)
3. Grant funding from prediction market ecosystems (planned)
4. Premium tier SaaS for power users (infrastructure exists, not enforced yet)

**DB plan values:** `'free'`, `'pro'`, `'platinum'` columns still exist on `creator_settings` for legacy data — DO NOT touch them, but they're no longer used to gate any feature.

---

## File Map (what's what)

| File | Route | What it is |
|------|-------|-----------|
| `public/explore.html` | `/` (landing) | **Landing page + feed preview.** Intelligence briefing, top edges, live stats, feed preview. `/explore` redirects here. ⚠️ NOT the full feed — that's feed.html. |
| `public/feed.html` | `/feed` | **FLEX Feed (full).** Two tabs: For You + Trending. Influencer posts (X/Reddit) interleaved with user takes. ⚠️ SEPARATE from explore.html. |
| `public/member.html` | `/m/:userId` | **Member profile.** Tier card, takes, trades, track record, passport link. |
| `public/passport.html` | `/passport/:userId` | **Prediction Passport.** Shareable credential page. Embeddable via iframe. |
| `public/market.html` | `/market/:slug` | **Market page.** Polymarket trading, CLOB orders, community takes, stop-loss. |
| `public/alpha-live.html` | `/alpha-live` | **Alpha Terminal.** Live edge cards ranked by Edge Score (8 signals). |
| `public/predictors.html` | `/predictors` | **Predictor leaderboard.** Ranked by sharp scores, grid/list view. |
| `public/creator-dashboard.html` | `/creator/dashboard` | **Dashboard.** Portfolio, Polymarket trading, analytics, settings. |
| `public/creator-login.html` | `/creator/login` | Login / signup page. |
| `public/admin.html` | `/admin` | **Admin ops.** Users, analytics, builder fees, influencer sweep. |
| `public/community.html` | `/:slug` | Legacy community prediction market page (pre-pivot, still routed). |
| `public/profile.html` | `/u/:slug` | Legacy creator profile (redirects to `/m/:userId` when possible). |
| `public/embed.html` | `/embed/:slug` | Embeddable widget (iframeable). |
| `public/win-card.html` | `/win/:mkt/:uid` | Shareable win card with acquisition CTA. |
| `server.js` | Express backend — all API routes, Claude scanner, settlement cron |
| `index.html` | ⚠️ OLD React trading app at project root — NOT served, ignore |
| `HYPERFLEX_Brief.md` | Full detailed brief — read this for deep context |
| `CLAUDE.md` | This file — auto-loaded session memory |

---

## Alpha Engine (the trader-facing core)

`buildAlphaList()` in `server.js` is the **single source of truth** for enriched market data. Both `/api/screener` and `/api/alpha/top` read from it. `/api/signals` cross-references the same `_screenerCache`. Add new alpha surfaces by reading `buildAlphaList()` — never duplicate the enrichment loop.

**Pipeline (per refresh, 90s TTL):**
1. Fetch top 200 markets from Polymarket Gamma API
2. Hard volume floor: skip anything <$10k 24h volume (kills weather/tennis/earthquake noise)
3. Whale enrichment: match by **conditionId** first (preferred), fall back to question text
4. Compute base `edge_score` from 7 components
5. `upgradeToClobPrices()` — replace stale gamma prices with live CLOB midpoints (30s cache)
6. `fetchClobDepth()` — pull `/book` for liquid markets (>$100k vol), compute bid/ask imbalance within 5¢ of TOB (60s cache)
7. Re-score with `edgeDepth` component
8. **Freshness stamps** — `_alphaFreshness` Map tracks first time each market crosses score 60

**Edge Score components (max contribution per signal):**
| Component | Max | Source |
|---|---:|---|
| Whales | 35 | Top-50 trader positions, conditionId-matched |
| Volume | 30 | $10M=30, $5M=22, $1M=15, $500k=10, $100k=5 |
| Depth | 20 | CLOB orderbook bid/ask imbalance (≥1.5x = 8, ≥3x = 20) |
| Capital | 15 | Total whale capital ≥$1M=15, ≥$500k=10, ≥$100k=5 |
| Momentum | 15 | 24h price change ×1.5 (only fires if vol >$50k) |
| Decay | 12 | Discount-zone (15-40¢ or 60-85¢) ≤3d to expiry |
| Divergence | 10 | Price far from 50% with 3+ whales |
| Expiry | 8 | Standard time-to-resolution weight |

**API response fields per market:**
- `edge_score`, `edge_components` (object with all 8 weights), `model_probability`, `alpha_edge`
- `whale_count`, `total_whale_capital`, `depth_ratio`, `depth_side` ('bid' | 'ask'), `depth_total`
- `edge_first_seen_at`, `edge_age_minutes`, `is_new` (true if <60min), `edge_peak_score`
- `trade` ({ side, entry_cost, potential_profit, roi_pct }), `ai_hook`
- `slug` for internal `/market/:slug` linking

**Endpoints:**
- `GET /api/screener` — full enriched market list (filterable)
- `GET /api/alpha/top?n=5` — top N by edge_score (for landing/preview surfaces)
- `GET /api/signals` — alert-style cards (whale_cluster / momentum / new_entry / arbitrage / volume_surge)

**⛔ Don't:** add a new alpha surface without reading from `buildAlphaList()`. Don't compute whale matching by question text — use `conditionId`. Don't fire `edgeMomentum`/`edgeExpiry` on markets under $50k vol (it's noise).

---

## Platform Integrations (the aggregator core)

- **Polymarket**: `GET /api/polymarket/positions/:address` (public, no auth) — wallet address lookup, 5-min cache
- **Kalshi**: `GET /api/kalshi/positions` (auth'd) — UUID API key, enriched with market details
- **Manifold**: `GET /api/manifold/positions/:username` (public) — aggregates bets by contract, M$ labels
- **Unified portfolio**: `GET /api/portfolio/:userId` — merges all platforms, P&L, win rate
- **Auto-sync cron**: `syncAllUserPositions()` runs hourly — fetches all connected users' positions into `cached_positions`
- **P&L analytics**: `GET /api/predictors/:userId/analytics` — platform breakdown, calibration chart, 30d timeline, sharp score
- **Wallet/key storage**: `PUT/GET /api/user/wallets` — Polymarket address, Kalshi API key (masked in GET), Manifold username

---

## Current State (last updated March 18, 2026 — session 13)

- **Stripe payments live** — Pro ($29/mo) + Premium ($99/mo) checkout + billing portal
  - Railway env vars needed: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_PLATINUM_PRICE_ID`
  - Webhook endpoint registered at: `https://hyperflex.network/stripe/webhook`
- **Admin dashboard** at `/admin` — password-gated, creator table, inline plan control (`ADMIN_SECRET` env var)
- **OAuth**: Google fully working. X/Twitter works (name + username only)
- **Premium rebrand**: "Platinum" → "Premium" in all UI. DB value stays `'platinum'`
- **Watermark**: shown on Free + Pro, hidden on Premium only
- **creator_settings** is the canonical creator table (not `communities`)
- Stripe webhook updates `creator_settings.plan` on checkout + cancellation

### Community Markets Engine
- Per-community points economy (centpoints: 100 = 1 pt), streak multipliers, gamification
- Multi-option markets (3–6 options), resolution disputes, community-gated resolution voting
- Seasons/tournaments, Discord webhook integration, in-app notifications
- AI YouTube scanner (free demo mode + Pro unlock), auto-scan per creator, auto-resolution
- Market discovery: trending/hot/new badges, category filter pills, truth feed, carousel

### Aggregator Portfolio
- Portfolio tab in creator dashboard — connect Polymarket/Kalshi/Manifold
- Quick Preview on landing page (wallet/username → instant stats card)
- Member profiles show cross-platform stats, calibration charts, P&L timeline
- Predictor leaderboard with sharp scores, follow system, Following feed on explore
- Post-signup platform connect interstitial
- Auto-sync cron for all connected users (hourly)

---

## Rules Claude Must Follow Every Session

1. **Read this file at session start** before touching anything
2. **Font/color system:** **Inter** (display/sans) + **JetBrains Mono** (mono). Multi-accent palette: gold `#c9920d`, green `#00e68a`, red `#ff4d6a`, blue `#4d9fff`, purple `#a855f7`, amber `#f59e0b`. Paper `#0e0e15`, ink `#f0f0f5`, border `#1e1e2a`. The old Syne + Space Mono + single-gold-accent system is deprecated as of the alpha terminal redesign (commits `4188aa6` + `d48cbef`).
3. **DB:** `creator_settings` is the main creator table (not `communities`)
4. **Plan values in DB:** `'free'`, `'pro'`, `'platinum'` — display as Free / Pro / Premium in UI
5. **Always check git status** before assuming what's deployed vs local
6. **Social-first mindset:** The social feed and take system is the primary value prop. The alpha terminal and whale tracker are the data backbone underneath. When building new features, ask: "Does this make the social loop stickier?" (post take → reactions → reputation → followers → more takes)
7. **⛔ NEVER start or stop the server.** Do NOT run `node server.js`, `npm start`, `npm run dev`, `pkill node`, or any command that starts/stops a process on port 3000. Railway handles production. If you need to verify code works, edit files and commit — do not run the server locally. Killing the server disrupts the live site.
8. **Always track every user request as a todo item before starting work.** When the user gives a task or list of tasks, add them to a running todo list immediately. Mark items in-progress when starting, completed when done. Never let a request go untracked.
9. **Always read https://docs.polymarket.com/builders/overview before making CLOB trading changes.**
10. **"Does this already exist?" is step 1, not step 4.** Before proposing any new endpoint, helper, or module — especially in the Polymarket trading / collateral / balance / wrap surface — grep the codebase. This repo has been in active development for weeks; most obvious integration points are already built. Pasting reference snippets from external docs without checking what's already wired is the fastest way to waste a session.
11. **Safe-proxy check on every Polymarket doc snippet.** Polymarket docs default to EOA examples because they're simplest to publish. HYPERFLEX users are Gnosis Safe proxy users (`signatureType: 2` = POLY_GNOSIS_SAFE; funds live at the proxy; `maker = proxy`, `signer = EOA`). Every write path — approvals, wraps/unwraps, cancels, redemptions, setApprovalForAll — must dispatch via `execTransaction` through `executeViaProxy()` / `dashExecuteViaProxy()`. Raw EOA calls to Onramp/CTF/Exchange contracts revert on balance check because the EOA holds nothing. Before adopting any doc snippet that touches these contracts, confirm it accounts for the Safe proxy.
12. **Default to ethers v6 syntax in all new code.** `package.json` pins `ethers: ^6.16.0`. Use `new ethers.JsonRpcProvider(...)`, `new ethers.Interface(ABI)`, `ethers.parseUnits(...)`, `ethers.formatUnits(...)`, `ethers.ZeroAddress`. The v5 namespaces `ethers.providers.*` and `ethers.utils.*` were removed in v6 — pasting v5 code crashes at first request.
13. **Market button = FAK, never FOK. Limit = GTC (unchanged).** Polymarket V2's fee model: makers don't pay fees, only takers do; builder fees are a share of taker fees; the Maker Rebates Program funds maker rebates from those same taker fees. So a resting GTC limit order earns us **zero** builder fee even when it eventually fills — and the maker side is being paid out of the fee pool we'd otherwise earn from. **Resting limits are doubly anti-revenue.** Market orders MUST be FAK (Fill And Kill — fills as much as possible at the user's price, cancels the rest), not FOK (all-or-nothing). FOK rejects entirely on any thin-book moment, killing both the fill AND our taker-fee revenue. Polymarket's V2 migration doc defaults to `FOK` in code examples — that's a reference choice, not a recommendation. Do not revert FAK → FOK based on doc snippets. The wire-body field name to send is `orderType: 'FAK'` for both `market.html` order submission and `creator-dashboard.html` Quick Trade. Limit orders (when the user explicitly chooses Limit) stay `'GTC'`. Auto-fallback from FAK to GTC on rejection is also forbidden — silently turning a market order into a resting limit is the same anti-revenue path. Surface "couldn't fill at this price" cleanly and let the user choose Limit explicitly if they want to rest.
14. **No speculative auto-retry layers that mutate order parameters.** Specifically: do NOT add retry logic that flips `signatureType` (1 ↔ 2), flips `isNegRisk` (false ↔ true), or otherwise auto-mutates trade fields based on error text without explicit user confirmation. Every speculative retry layer cascades into existing retry layers below it — and existing retry layers can have on-chain side effects (`isNegRisk` flip dispatches real Safe approvals at lines 21924+, costing real gas, on the WRONG market type). PR #50 shipped a `_sigTypeOverride` flip that retried Safe wallets with sigType=1, which always fails sig recovery for Safe-deployed proxies, AND triggered the existing isNegRisk-flip retry that fired on-chain NegRisk approvals on a non-NegRisk market. Reverted same day. Lesson: speculative retries → cascading damage. If a balance/allowance reject fires, surface the original error directly with the actionable info ("sum of active orders: X") and let the user act. Do not auto-mutate fields you didn't verify against the user's actual wallet shape and market type. Surface, don't speculate.

---

## ⚠️ Polymarket CLOB Trading Reference — DO NOT REGRESS

Canonical spec for `market.html` order flow. Every field verified against the official `@polymarket/clob-client` SDK.

### Proxy wallet discovery
- **Single source of truth:** `computeProxyAddress(eoa)` on Safe factory `0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b`
- **Use public RPC** (no MetaMask popup): `polygon-bor-rpc.publicnode.com` primary, `1rpc.io/matic` fallback
- **Deploy check:** Polymarket relayer API `https://relayer-v2.polymarket.com/deployed?address=`
- **If not deployed:** show "Visit polymarket.com to activate" — do NOT deploy from our app
- **Balance reads from PROXY, not EOA**

### EIP-712 order struct (for signing)
All fields match the CTF Exchange contract. Types are uint256/address/uint8:
- `salt`: number (not string) — `Math.floor(Math.random() * 9007199254740991)`
- `side`: integer — `0` = BUY, `1` = SELL
- `signatureType`: integer — `2` = POLY_GNOSIS_SAFE (proxy), `0` = EOA
- `maker`: proxy address (where funds live)
- `signer`: EOA address (MetaMask key)
- `feeRateBps`: from CLOB `/fee-rate?token_id=` endpoint

### POST /order JSON body (different from signing struct!)
SDK's `orderToJson()` converts before posting:
- `salt`: **number** — `parseInt(order.salt, 10)` (SDK does `Number.parseInt`)
- `side`: **string** — `"BUY"` or `"SELL"` (SDK's `Side` enum, NOT integer)
- `signatureType`: integer `2`
- `deferExec`: `false` (always include)
- `feeRateBps`: string `"0"` (scope outside try block — 0 is falsy!)
- `orderType`: `"GTC"`

### CLOB API endpoints (snake_case params)
- Tick size: `GET /tick-size?token_id=`
- Neg risk: `GET /neg-risk?token_id=`
- Fee rate: `GET /fee-rate?token_id=`
- Submit: `POST /order` with L2 auth headers

### Auth headers (L2)
```
POLY_ADDRESS, POLY_API_KEY, POLY_PASSPHRASE, POLY_TIMESTAMP, POLY_SIGNATURE
```
HMAC: `timestamp + 'POST' + '/order' + body` signed with API secret (base64url decoded)

### CLOB auth key lifecycle
1. `POST /auth/api-key` (create) — try first
2. `GET /auth/derive-api-key` (derive) — fallback
Matches official SDK order.

### Contract addresses
- USDC.e: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- USDC native: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
- Safe factory: `0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b`
- CTF Exchange (V1): `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`
- NegRisk Exchange (V1): `0xC5d563A36AE78145C45a50134d48A1215220f80a`

### Polymarket CLOB V2 — canonical reference

**⚠️ DO NOT CHANGE WITHOUT READING `@polymarket/clob-client-v2` SOURCE**

SDK: `@polymarket/clob-client-v2` (installed, verified against `node_modules/@polymarket/clob-client-v2/dist/index.js`). V1 `@polymarket/clob-client` is deprecated in our codebase as of April 22, 2026 (client-default cutover, commit `f7c30d3`). Polymarket's production URL `clob.polymarket.com` takes over V2 April 28, 2026 (~11:00 UTC) per official migration doc. Until then, V2 traffic routes to `clob-v2.polymarket.com`; after, both URLs serve V2.

V2 Order struct fields: `salt` (uint256), `maker` (proxy), `signer` (EOA), `tokenId`, `makerAmount`, `takerAmount`, `side` (uint8 in signing payload: 0=BUY, 1=SELL; string "BUY"/"SELL" in wire body), `signatureType` (2 = POLY_GNOSIS_SAFE), `timestamp` (ms — replaces nonce), `metadata` (bytes32, zero default), `builder` (bytes32 builderCode, currently `0x7439e528420d6ed0be9ce10c9698e9a7d490f12e828f7ef8c0992f3fd1eb49b8`).

Removed in V2: `nonce`, `expiration`, `taker`, `feeRateBps`. Do NOT re-add.

EIP-712 domains — both standard and NegRisk exchanges share the SAME `name`. Only `verifyingContract` differs. Verified against SDK constant at `node_modules/@polymarket/clob-client-v2/dist/index.js:640` (`CTF_EXCHANGE_V2_DOMAIN_NAME = "Polymarket CTF Exchange"`):

- Exchange (standard + NegRisk): `{ name: "Polymarket CTF Exchange", version: "2", chainId: 137, verifyingContract: params.isNegRisk ? NEG_RISK_EXCHANGE_V2 : CTF_EXCHANGE_V2 }`
- ClobAuth: `{ name: "ClobAuthDomain", version: "1", chainId: 137 }` — stays at "1", do NOT bump

Pick `verifyingContract` based on `params.isNegRisk`. The deployed NegRisk exchange is a different contract but the EIP-712 domain name is identical — this is NOT a V1 holdover, V2 deploys both from the same `CTFExchange.sol` source.

Contract addresses (Polygon mainnet):
- CTF Exchange V2: `0xE111180000d2663C0091e4f400237545B87B996B`
- NegRisk CTF Exchange V2: `0xe2222d279d744050d28e00520010520000310F59`
- Collateral Onramp: `0x93070a847efEf7F70739046A929D47a521F5B8ee`
- pUSD (PMCT): `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB`
- USDC.e (unchanged): `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- Safe Factory (unchanged): `0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b`

Collateral: pUSD (aka PMCT in contract source) replaces USDC.e for settlement. Our users are POLY_GNOSIS_SAFE (signatureType=2); funds live at the proxy, not the EOA. Any wrap/approve/unwrap write path MUST route through Safe `execTransaction` via `executeViaProxy()` (`market.html:3459`) or `dashExecuteViaProxy()` (`creator-dashboard.html:21632`) — a raw EOA call to `Onramp.wrap()` reverts because `msg.sender` is the EOA which holds no USDC.e. The EOA signs; the Safe executes. Wrap flow: approve onramp (not pUSD token) for USDC.e spend, then call `wrap(USDC.e, proxy_address, amount)` — both dispatched as SafeTx. Client-side wrap helper: `wrapUsdcToPmct()` at `market.html:3466`, working live per session 15 mainnet test.

Fees: protocol-set, taker-only, computed at match time. Do NOT set `feeRateBps` in orders — field no longer exists in V2 struct. Query fee params via `getClobMarketInfo(conditionID)` if needed.

Builder attribution: single mechanism — `builderCode` embedded in the signed order `builder` field (bytes32). Per the official V2 migration doc (April 2026), the `POLY_BUILDER_*` HMAC request headers from V1 are REMOVED for order attribution in V2; only the on-chain `builder` bytes32 counts. Our code at `server.js:40019` still attaches them via `getBuilderHeaders()` — V2 ignores them harmlessly (confirmed live per session 15), but stripping them is safe post-Apr-28 cutover and is filed as part of the post-cutover cleanup commit alongside the V1 wire-body compat fields (`feeRateBps: '0'`, `nonce: '0'`, `expiration: '0'`).

The HMAC creds themselves (`POLY_BUILDER_API_KEY` / `POLY_BUILDER_SECRET` / `POLY_BUILDER_PASSPHRASE` env vars + `getBuilderHeaders()` helper at `server.js:38803-38818`) must be kept — Polymarket's Relayer (gasless tx flow, `relayer-v2.polymarket.com/submit`) still authenticates with them. Do NOT delete the env vars or the helper. Just stop attaching the headers to the `/order` POST.

Proxy discovery: unchanged — `computeProxyAddress(eoa)` via Safe Factory. Proxy is `maker`, EOA is `signer`. USDC.e and pUSD balances read from proxy address, not EOA.

HMAC L2 auth headers (standard CLOB API auth, separate from builder HMAC): unchanged — `POLY_ADDRESS`, `POLY_TIMESTAMP`, `POLY_API_KEY`, `POLY_PASSPHRASE`, `POLY_SIGNATURE` (HMAC-SHA256 with url-safe base64 with padding, `!== undefined` check on fee rate).

Cancel behavior: V2 replaces on-chain cancel with operator-controlled `pauseUser`/`unpauseUser`. User-initiated cancels still go through the CLOB cancel API; no direct on-chain contract call path.

Order book wipe at cutover: All open orders are wiped during the ~1h maintenance window on Apr 28. Our default trade path is FOK (no resting state — nothing to lose), but any user with an open GTC limit order across the window will have it silently cancelled. Cutover banner on `market.html` + dashboard around Apr 27-28 should warn users.

**Legacy V2 reference (kept for context):** addresses + Amoy parity:
- pUSD (PMCT) collateral token: `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` — 6 decimals, wraps USDC.e or native USDC 1:1
- CollateralOfframp (unwrap): `0x2957922Eb93258b93368531d39fAcCA3B4dC5854` — `unwrap(address asset, address to, uint256 amount)`
- HYPERFLEX V2 builder code: provisioned 3/31/2026, status Enabled, fees 0% until polymarket.com/settings?tab=builder verification lands
- All addresses identical on Amoy testnet (chainId 80002)
- Wrap relayer fallback: `POST /api/polymarket/safe-submit` → `relayer-v2.polymarket.com/submit`, with direct `execTransaction` as fallback when relayer 401s

**Feature flag:** `window.HF_USE_CLOB_V2 = true` or `?clob_v2=1` URL param routes a single trade through V2. Default is V2 as of the April 22 cutover.

**V2 status (2026-04-22, session 15):** End-to-end live trading works on both `market.html` and the creator-dashboard portfolio Quick Trade. Wrap + CTF approve + BUY + SELL all confirmed on mainnet with real positions. The only remaining gate is **Polymarket verifying our builder profile** at polymarket.com/settings?tab=builder so we can set a non-zero maker/taker fee rate — attributed V2 trades earn 0 builder fees until then. Do not flip fees on until verification lands; the infrastructure is otherwise complete.

**V2 first CLOB-accepted trade (2026-04-28, session 19):** First successfully signed V2 order accepted by Polymarket CLOB at 02:18 UTC, ~9h before the official Apr-28 ~11:00 UTC cutover. Order ID `0xc118b787f3e0e00eb26108cf0594c56a9535e443ecf6025e1a343d71c80657f3` on `mlb-nyy-tex-2026-04-27`, BUY 1.0626 shares @ 94.1¢, routed to `clob-v2.polymarket.com/order` against exchange `0xE111180000d2663C0091e4f400237545B87B996B` (CTF Exchange V2, non-NegRisk), POLY_GNOSIS_SAFE sigType=2. Builder bytes32 attached, V2 struct shape ✓ (no V1 fields in EIP-712 payload), full pre-flight matrix green. CLOB returned 200 + `success:true` + `status:"delayed"` with empty `takingAmount`/`makingAmount` — the order was accepted into the V2 book but not yet matched. Three plausible causes ranked: (1) pre-cutover V2 matching engine queues orders pending the 11:00 UTC backend flip, (2) `feeRateBps=1000` (10%) returned by `getClobMarketInfo` for this market makes the matcher's effective break-even unreachable at our 94.1¢ limit, (3) top-of-book vanished between book walk and submit. Verify post-cutover whether the order auto-matches. **Two follow-ups before declaring V2 production-stable:** (a) treat `status:"delayed"` as a non-success state in the post-trade UI — currently we fire confetti on `success:true` regardless, which lies to users about a fill that hasn't happened (`market.html` line 5499); (b) if `feeRateBps≥500` from `getClobMarketInfo`, reject client-side with a "trading restricted" toast rather than submit a doomed order. See CHANGELOG.md 2026-04-28 entry for full evidence and analysis.

**Pre-cutover checklist — resolved:**
1. ✅ Polymarket Safe singleton confirmed v1.3.0-compatible via live execTransaction dispatch. EIP-712 domain `{chainId, verifyingContract}` (no name/version) is what works on mainnet.
2. ✅ `POST /api/polymarket/safe-submit` relayer path verified live. Relayer returns 401 on some calls (notably CTF `setApprovalForAll`) but the direct `execTransaction` fallback succeeds as long as the user's EOA has MATIC for gas. Users without MATIC on their EOA will hit the approval step and bounce — consider a MATIC top-up flow later.
3. ✅ V2 approvals (ERC-20 + CTF operator) working through `executeViaProxy` SafeTx. Both `market.html` and `creator-dashboard.html` have the full dispatch chain.
4. ✅ Live-tested on mainnet rather than Amoy — V2 contracts deployed to mainnet ahead of cutover made testnet unnecessary.
5. ⏳ Builder profile verification pending on Polymarket's side. Maker/taker fees stay at 0% until approved. No code change needed on our end when it lands.

### Market vs Limit order rules — decimal constraints (corrected 2026-04-21)

**SDK ground truth** (verified against `Polymarket/clob-client/src/order-builder/helpers.ts`, `getMarketOrderRawAmounts`):

The SDK applies precision based on **position (maker vs taker)**, NOT asset type or side. At every tick size, `roundConfig.size` caps the maker amount and `roundConfig.amount` caps the taker amount:

```js
ROUNDING_CONFIG = {
  "0.1":    { price: 1, size: 2, amount: 3 },
  "0.01":   { price: 2, size: 2, amount: 4 },   // most markets
  "0.001":  { price: 3, size: 2, amount: 5 },
  "0.0001": { price: 4, size: 2, amount: 6 },
}
```

**At tick 0.01 (the standard for most Polymarket markets):**

| Side | makerAmount (size=2) | takerAmount (amount=4) |
|------|---------------------|------------------------|
| BUY  | USDC, 2 decimals    | shares, 4 decimals     |
| SELL | shares, 2 decimals  | USDC, 4 decimals       |

`maker = always 2 decimals, taker = always 4 decimals` at tick 0.01. The asset (USDC vs shares) flips with side. **This is the same for V1, V2, FOK, and GTC** — there's no per-side or per-version asymmetry in the SDK.

**Historical note (and why this confused us)**: prior CLAUDE.md said FOK SELL had `maker=4 dec, taker=2 dec`. That was wrong but V1's CLOB was lenient and accepted it. V2 enforces SDK exactly — sending V1's inverted SELL caps produces:
```
{"error":"invalid amounts, the sell orders maker amount supports a max accuracy of 2 decimals, taker amount a max of 4 decimals"}
```

**SELL maker/taker semantics are NOT swapped between V1 and V2.** Empirically verified: swapping `rawMakerAmt ↔ rawTakerAmt` on a V2 SELL produced `{"error":"invalid price, price must be greater than 0 and less than 1"}` — V2 still computes SELL price as `takerAmount/makerAmount`, so maker MUST be shares and taker MUST be USDC.

**Build market-BUY `makerAmt` from the user-entered USDC `amount` directly** (already 2 decimals), NOT from `shares × price` (the multiplication introduces float drift).

**For market orders, walk the live orderbook before submit** via `GET /book?token_id=` and use the worst price the order would touch as the limit (rounded UP to tick). FOK requires the FULL size to fill at ≤ limit — a thin top-of-book causes "order couldn't be fully filled" rejections if you just use the current mid. Same pattern as the SDK's `calculateMarketPrice()` helper.

### V2 pre-cutover lessons (2026-04-21, hard-won)

When V2 was first defaulted on a day before Polymarket's canonical cutover, every error became a learning opportunity. Codifying these so a future session doesn't re-discover them in production:

**1. `clob-v2.polymarket.com` IS live pre-Polymarket-cutover (Apr 28).** The dedicated V2 host accepts V2-signed orders today. `clob.polymarket.com` runs V1's parser **until Polymarket flips the backend on Apr 28**; sending a V2 order there returns `{"error":"invalid signature"}` because V1 reconstructs the EIP-712 hash over V1 fields (taker/nonce/feeRateBps/expiration) and gets a different hash than what the V2 struct signed. **Route V2 orders to `clob-v2.polymarket.com`** — detect by presence of `order.builder` field in the body. After Apr 28, `clob.polymarket.com` becomes canonical and the dedicated host is redundant (still works, but no longer required).

**2. V1's parser demands wire-body fields V2's struct drops.** If you ever route a V2 order through V1's parser (e.g. you forget to flip the host), V1 rejects in this specific order:
- `{"error":"error parsing fee rate bps () to int64"}` → add `feeRateBps: '0'` to wire body
- `{"error":"error parsing nonce () to int64"}` → add `nonce: '0'`
- `{"error":"error parsing expiration () to int64"}` → add `expiration: '0'`

These fields are NOT in the V2 EIP-712 signed struct, so they don't break signature verification — they're wire-body-only compat. Keep them through cutover. After cutover, both hosts run V2 parser and the extras become harmless.

**3. The local `parseUnits()` returns a string, not a BigInt.** Inside `executeTrade` there's a hand-rolled `parseUnits()` (NOT `ethers.parseUnits`) that returns a numeric string. The V2 BUY pre-flight calls `getPmctBalance()` (returns BigInt) and does `pUsdBal < makerAmt` and `makerAmt - pUsdBal`. Mixing string with BigInt throws `TypeError: Cannot mix BigInt and other types`. Coerce: `var makerAmtBI = BigInt(makerAmt)` before the comparison.

**4. setMaxShares() can race against the positions cache on multi-outcome markets.** `_market.conditionId` is the PARENT event's conditionId, but cached positions key by CHILD outcome conditionId. Use `_sortedEventMarkets[_activeOutcomeIndex].conditionId` for the lookup, or — better — pass the panel's already-resolved `r.size` directly to `sellPositionRow(outcomeIdx, sideIdx, shareCount)` and skip the re-lookup entirely. The position panel walked the cache once already; re-doing it inside setMaxShares is just a way to introduce drift.

**5. V2 maker/taker SEMANTICS = same as V1; only DECIMAL CAPS differ historically (because our V1 caps were wrong, see above).** Don't swap maker↔taker for V2 SELL. Just make sure caps follow SDK config at the active tick size.

**6. Default V2 cutover via `V2_CUTOVER_MS` in market.html and `_V2_CUTOVER_MS_DASH` in creator-dashboard.html.** Keep aligned. URL `?clob_v2=1`/`=0` and localStorage `hf_use_clob_v2` override the date gate (sticky across navigations).

**7. V2 SELL needs a fresh CTF setApprovalForAll.** The V2 exchange (`CTF_EXCHANGE_V2` / `NEG_RISK_EXCHANGE_V2`) is a new operator on the ConditionalTokens ERC-1155 contract (`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`). V1 exchanges were auto-approved during polymarket.com onboarding, so our V1 SELL flow never had to set this. V2 rejects with `{"error":"not enough balance / allowance"}` even when the proxy holds the shares. Pre-flight in `executeTrade`: `isCtfApprovedForOperator(proxy, exchangeAddr)` → if false, dispatch `setApprovalForAll(exchangeAddr, true)` via `executeViaProxy` (one extra SafeTx MetaMask popup, one-time per exchange per proxy). Same operator pattern applies to NegRisk V2 vs non-NegRisk V2 — they're different operators and need separate approvals.

**8. `checkTradingSetup` only checks ERC-20 allowances (USDC/pUSD), NOT CTF approvals.** Don't rely on the green "setup complete" banner to mean V2 SELL is ready. The CTF check fires lazily inside executeTrade. If we want to make the setup panel comprehensive, add a CTF V2 row alongside the existing 5 ERC-20 rows.

### V2 SELL lessons (2026-04-22, session 15 — portfolio-tab path)

Five separate guards have to all line up for a V2 SELL from the creator-dashboard `#portfolio` tab to succeed. All five were hit in one debugging session — codify so nobody re-lives it.

**9. Never approve `type(uint256).max` on fresh V2 contracts — Blockaid flags as scam.** MetaMask's Blockaid layer treats `MAX_UINT256` approvals to low-reputation spenders as "deceptive — known for scams". The V2 exchanges (`CTF_EXCHANGE_V2` / `NEG_RISK_EXCHANGE_V2` / `COLLATERAL_ONRAMP`) deployed Apr 22 and haven't been whitelisted. Use `APPROVAL_CAP = '10000000000000000'` (10B tokens at 6 decimals) in `market.html` `approveTokens()`. `MAX_UINT256` is still defined as a harmless named constant, but all `.approve(spender, ...)` callsites must use `APPROVAL_CAP`. The `checkTokenApproval` threshold is 1M (atomic `1e12`) so 10B still registers as OK — no re-prompt on already-approved users. Don't "clean this up" by reverting to MaxUint — users will bounce on the scam banner.

**10. `creator-dashboard.html` Quick Trade has its own `confirmTrade` — duplicate of `market.html`'s `executeTrade`.** Every V2 fix in `market.html` must be ported to `creator-dashboard.html`. The Quick Trade panel's confirmTrade was missing the V2 CTF `setApprovalForAll` pre-flight (#7 above) for months after `market.html` got it. Port pattern: next to `dashWrapUsdcToPmct`, add `dashIsCtfApprovedForOperator` + `dashApproveCtfForOperator` (both go through `dashExecuteViaProxy`), and wire the pre-flight in `confirmTrade` after the V2 BUY pUSD-wrap block. Before porting: grep `market.html` for `isCtfApprovedForOperator` / `setApprovalForAll` / `pUSD` and make sure `creator-dashboard.html` has an equivalent `dash`-prefixed copy for each callsite.

**11. `proxyAddress` / `eoaAddress` must be hoisted to the top of `confirmTrade`.** The pre-sell on-chain CTF balance check references both; historically they were declared `const` ~60 lines below the check, making every on-chain verify silently throw `ReferenceError` via TDZ. The catch fell back to the cache and looked like it worked. After hoisting, DO NOT re-declare them lower in the function — the `const` redeclaration is a parse-time syntax error that kills every JS on the page (loadPortfolio, toggleConnectionsPanel, etc. all ReferenceError). Single declaration, at the top of `confirmTrade`, right after `errEl`/`btn` reads.

**12. USD↔shares round-trip inflates — silent-clamp to on-chain, don't block.** User types `$1.56` at 5.7¢ → `confirmTrade` computes `shares = 1.56 / 0.057 = 27.37`, but on-chain is 27.29 (2-decimal USD rounding drift). Blocking with "Selling more than you hold" on a 0.3% overshoot is bad UX. In the pre-sell on-chain branch: if `onchainShares < shares` but overshoot ≤ 2%, clamp `shares = onchainShares` and back-compute `amount = shares * price` so the downstream maker/taker math uses the real number. Over 2% is almost certainly a real mistake and still errors. `amount` and `shares` at the top of `confirmTrade` must be `let`, not `const`, for the clamp to work. Apply to both the primary RPC path AND the RPC-failure cache-fallback branch — otherwise RPC flakiness breaks the clamp.

**13. FOK auto-fallback to GTC on thin books.** V2 book walker sees the top of book (e.g. 48 shares at 4.1¢) but FOK all-or-nothing requires the FULL size to match at submit — if the lone bid vanishes between walk and submit, FOK rejects with `"order couldn't be fully filled"`. Auto-retry the same order as Limit GTC at the walked limit price: partial fill + resting order is strictly better than zero fill. Recursion-guarded via `_tradeModalData._fokFallbackFired` boolean so we can't loop. `openTradeModal` spreads a fresh `pos` every modal open, so the guard resets naturally between trades. Show a `showToast` to tell the user the retry is happening so the extra MetaMask sign prompt doesn't feel random.

**Consolidated V2 SELL flow (both market.html executeTrade AND creator-dashboard.html confirmTrade):**
1. Pre-sell on-chain CTF balance check (guard 12 clamp, guard 11 hoist)
2. V2 BUY only: pUSD wrap via CollateralOnramp
3. V2 SELL only: CTF setApprovalForAll pre-flight (guard 10 port)
4. Build + sign + submit FOK order
5. On FOK rejection: auto-retry as GTC (guard 13)
6. Token approvals use APPROVAL_CAP not MAX_UINT256 (guard 9)

Any new branch that touches `confirmTrade` or `executeTrade` must preserve all six steps. If a new session removes any of them to "simplify," trades will regress. Add a regression test before refactoring.

### Builder fees + Cloudflare Worker proxy

Trades route through `cloudflare-trade-proxy/` (Worker) as the **primary** path to bypass geo-blocking. Direct CLOB is the fallback for non-geo-restricted users.

**Builder fee headers** (returned by `POST /api/polymarket/builder-sign` in `server.js`, forwarded by browser → Worker → CLOB):
```
POLY_BUILDER_API_KEY, POLY_BUILDER_PASSPHRASE, POLY_BUILDER_TIMESTAMP, POLY_BUILDER_SIGNATURE
```

**⚠️ Cross-file invariant**: the Worker's `BUILDER_HEADERS` CORS allowlist (`cloudflare-trade-proxy/src/worker.js`) MUST be a superset of whatever names `server.js`'s `/api/polymarket/builder-sign` returns. CORS doesn't allow wildcards on header names. If you change the builder-sign header set on the server, also update the Worker's `BUILDER_HEADERS` array. The GitHub Actions workflow at `.github/workflows/deploy-cf-worker.yml` auto-deploys the Worker on push to `main` when worker source changes.

**Stale-Worker symptom**: browser fetch to `hyperflex-trade-proxy.hyperflex.workers.dev/order` throws `Failed to fetch` because CORS preflight rejects the unknown header → trade falls through to direct CLOB (which works for non-geo-blocked users but fails for everyone else).

**Worker secrets** (in GitHub repo Settings → Secrets and variables → Actions, NOT in `server.js`):
- `CLOUDFLARE_API_TOKEN` — "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID`

### ⚠️ KNOWN duplication — DO NOT auto-consolidate

`getPolymarketProxy()` and `POLYGON_RPCS` are **deliberately duplicated** between `market.html` and `creator-dashboard.html`:

| Symbol | Location | Notes |
|---|---|---|
| `getPolymarketProxy(eoa)` | `market.html:1734`, `creator-dashboard.html:12803` | Same name, may have subtle behavioral differences |
| `POLYGON_RPCS` | `market.html:1717`, `creator-dashboard.html:12789`, `:17175`, `:18072` | 4 copies; market.html has 3 RPCs, creator-dashboard has 2 |

This is **NOT** part of the `HFXWallet` shared module (`public/wallet.js`) intentionally. Reasons:
1. The two files load **different ethers minor versions** (`6.13.2` vs `6.9.0`). The signer-cache extraction worked because the `BrowserProvider`/`getSigner` API is identical between minor versions, but `Contract` ABI encoding and RPC error formats can differ subtly.
2. Proxy discovery uses a **public RPC** (not `window.ethereum`), so it does NOT have the EIP-1193 `-32002` race that `HFXWallet` exists to solve. The signer extraction was a bug fix; proxy extraction would be pure refactoring.
3. The 11 callsites across both files have per-callsite error/fallback wrappers that aren't trivially equivalent.
4. Per CLAUDE.md rule: **proxy wallet discovery "finally works" after burning 2 days of debug**. Working code in this area is precious.

**If you find yourself wanting to consolidate**: don't, unless you're also fixing an active bug there. Update both files in lockstep instead. If you must consolidate, diff the two `getPolymarketProxy` implementations line-by-line first and verify behavioral equivalence under both ethers versions.

---

## 🚨 TRADE FAILURE RUNBOOK — Read this FIRST before debugging

Trade failures have been fixed multiple times. **Do NOT guess.** Follow this decision tree.

### Error: "Trading restricted in your region"
**Cause:** Geo-blocking. Polymarket blocks by IP. The US, UK, France, Germany, Italy, Netherlands, Australia + 25 others are blocked.
**Diagnosis:** `GET https://hyperflex.network/api/polymarket/geocheck` — shows what IP/country the Railway server has.
**Fix rules:**
- Railway is US-based (IP 54.153.42.107, CA) → **ALWAYS geo-blocked**. NEVER make Railway the primary trade route.
- User's browser IP (Sweden) is NOT blocked → **Direct CLOB from browser works**.
- Correct routing order: **Direct CLOB → CF Worker → Railway (last resort)**
- If user moves to a blocked country: CF Worker also blocked (runs at nearest edge). Need a proxy in an allowed country.
- **NEVER** re-introduce Railway as primary for orders. It was tried and failed. The US is blocked.

### Error: "order couldn't be fully filled. FOK orders are fully filled or killed"
**Cause:** FOK (Fill-or-Kill) market order can't find enough liquidity at the limit price.
**Diagnosis checklist:**
1. **Is the book empty?** Fetch `GET https://clob.polymarket.com/book?token_id=TOKEN_ID`. If bids (for SELL) or asks (for BUY) are empty or thin, there's simply no liquidity. User should switch to Limit order or reduce size.
2. **Is the book walk code present?** Both `market.html` and `creator-dashboard.html` MUST walk the orderbook before submitting FOK. Search for `Checking depth` or `book?token_id`. If missing, the order uses mid/best-bid as limit, which fails on any depth >1 level.
3. **Is slippage buffer present?** After walking, the limit price MUST have 1 tick of slack: `SELL: Math.floor - tickSize` (1 tick below worst bid), `BUY: Math.ceil + tickSize` (1 tick above worst ask). Without this, book shifts between read and submit cause failures.
4. **Are shares recalculated after walk?** **MUST NOT** recalculate `shares = amount / walkedPrice`. The walked price is the LIMIT, not the fill price. Share count must stay as originally derived from the user's input.
5. **Are FOK decimal constraints correct?** FOK orders have HARD-CODED precision (NOT tick-driven): BUY: makerAmount (USDC) ≤ 2 decimals, takerAmount (shares) ≤ 4 decimals. SELL: makerAmount (shares) ≤ 4 decimals, takerAmount (USDC) ≤ 2 decimals. Limit (GTC) orders use tick-driven `ROUNDING_CONFIG`.

**SDK reference for amounts:**
```
BUY market:  rawMakerAmt = roundDown(usdAmount, 2);  rawTakerAmt = roundDown(usdAmount / price, 4)
SELL market: rawMakerAmt = roundDown(shares, 4);      rawTakerAmt = roundDown(shares * price, 2)
```

### Error: "API key expired" / 401 loop / multiple MetaMask popups
**Cause:** CLOB API keys expired. `derivePolymarketApiKey()` requires a MetaMask EIP-712 signature.
**Fix rules:**
- Auto-derive is implemented in `confirmTrade()` — it calls `derivePolymarketApiKey()` then retries.
- **MUST have recursion guard**: `_confirmTradeRetryCount` caps retries at 1. Without this, 401 → derive → retry → 401 → derive → infinite loop with 4+ MetaMask popups.
- If derive succeeds but trade still 401s: the issue is NOT the keys. Check if the order is hitting the wrong route (duplicate `app.post('/api/polymarket/order')` in server.js was the cause last time).
- **Check for duplicate routes**: `grep -n "app.post.*polymarket/order" server.js` — must return exactly ONE result.
- The old route at ~line 18520 (with `requireAuth`) was removed. If it reappears (e.g., from a merge), it shadows the real proxy and forwards orders WITHOUT CLOB auth headers → permanent 401.

### Error: "not enough balance"
**Cause:** Proxy wallet doesn't have enough USDC. User needs to deposit/bridge.
**Not a code bug.** Show the deposit modal.

### General trade debugging
- **Always check BOTH files**: `market.html` (`executeTrade` + `submitClobOrder`) and `creator-dashboard.html` (`confirmTrade`). They have independent trade code that MUST stay in sync.
- **Console logs**: Both files log `[qt-trade]` or `[trade]` prefixed messages. Check browser console for the exact path taken (Direct/CF/Railway) and response.
- **Test geocheck**: `curl https://hyperflex.network/api/polymarket/geocheck` shows Railway's IP and whether it's blocked.
- **`deferExec: false`** must be in the request body (both files).
- **Book walk order**: BUY walks asks cheapest→expensive, SELL walks bids expensive→cheapest.
- **SELL amount = shares, not USD.** The SDK's `getMarketOrderRawAmounts` takes shares for SELL. Our code derives shares from `amount / originalPrice` where amount is the user's USD input.

### ⛔ NEVER do these (proven to break things):
1. Never make Railway server the primary order route (US IP = blocked)
2. Never remove the book walk or slippage buffer from FOK orders
3. Never recalculate shares using the walked price (use original price)
4. Never add a second `app.post('/api/polymarket/order')` route in server.js
5. Never remove the `_confirmTradeRetryCount` guard from `confirmTrade()`
6. Never use tick-driven rounding for FOK orders (use hard-coded 2/4 decimals)
7. Never skip `deferExec: false` in the order body

---

## This session (March 16, session 6) — committed `a6a2b7d`, needs push + new commits

- **Rewards tab fix**: `'rewards'` was missing from `showTab()` array — tab was permanently invisible. Fixed.
- **Reward unlocks in explore feed**: `reward_unlocks` table + `maybeLogRewardUnlocks()` in `setCommunityBalance` + `reward_unlock` card in explore.html. Migration: `supabase_migration_reward_unlocks.sql`
- **Market burst consolidation**: 2+ markets from same creator within 5 min → single `markets_burst` card in explore feed showing count + preview list.
- **A — Live stats bar**: Public `/api/stats` endpoint (5-min cache). Landing page shows live markets / predictions / communities below hero.
- **B — Admin outreach tool**: ✉️ Outreach tab in admin.html. Compose + send personalized invite emails to creators. `creator_invites` table tracks sent/accepted. Auto-marks accepted on creator signup.
- **C — Embeddable widget**: `/embed/:slug` + `/api/embed/:slug`. Lightweight iframeable widget showing top 3 markets, branded colors. Creator dashboard Settings tab has "Get Embed Code" section.
- **D — Creator referral**: `/ref/:slug` → redirects to `/creator/signup?ref=slug`. `creator_referrals` table. Share tab shows referral link + stats. Referrer gets credited on tracked signups.
- **E — Resolution disputes**: Members can file dispute within 24h of resolution via ⚠ Dispute button. `market_disputes` table. Creator reviews (uphold/overturn) in Resolution Queue tab. Email notification on dispute filed.
- **F — Cross-community follows**: `creator_follows` table + `/api/community/:slug/follow-social` toggle + `/api/user/following`. Follow button on community hero + creator profile page. Explore sidebar shows Following card.

**Landing page embed section** — `public/index.html` now has full two-column embed showcase between VIDEO comment and PRICING section. Mock widget preview, copy bullets, embed code snippet, CTA. Committed `a6a2b7d`.

**New migrations to run (in order after existing list):**
12. `supabase_migration_reward_unlocks.sql`
13. `supabase_migration_creator_invites.sql`
14. `supabase_migration_creator_referrals.sql`
15. `supabase_migration_market_disputes.sql`
16. `supabase_migration_creator_follows.sql`

---

## Session 6 continued — email lifecycle + engagement automation

**J — Email unsubscribe** (`/unsubscribe?token=XXX` route in server.js):
- Token-based, one-click, no login needed
- `getMemberUnsubToken()` / `getCreatorUnsubToken()` helpers generate + cache UUID tokens
- `unsubscribeFooterHtml()` / `creatorUnsubscribeFooterHtml()` injected into weekly digest + streak warnings
- Weekly digest + streak warning emails now skip `email_unsubscribed = true` users
- Migration: `supabase_migration_email_unsubscribe.sql` — adds columns to `users` + `creator_settings`

**K — Creator milestone emails** (`maybeFireMilestoneEmail(slug)` in server.js):
- Fires async (fire-and-forget) from the community join/follow endpoint
- Milestones: 5, 10, 25, 50, 100, 250, 500 members
- Tracks `creator_settings.last_milestone_notified` to prevent re-sends
- Branded email with community accent color, two CTAs (dashboard + community)
- Respects `email_unsubscribed` flag on creator

**L — Dead market nudge emails** (`sendDeadMarketNudges()`, Wed 10am UTC):
- Finds markets open 7+ days with < 3 traders
- Groups by creator, sends one email per creator listing their dead markets
- Includes age + trader count per market, tip copy to share or archive
- Skips unsubscribed creators

**Migration for J + K:** `supabase_migration_email_unsubscribe.sql`
- `users`: `email_unsubscribe_token TEXT`, `email_unsubscribed BOOLEAN DEFAULT false`
- `creator_settings`: same columns + `last_milestone_notified INTEGER DEFAULT 0`

---

## AARRR gap closers (session 6 continued)

**M — Referral accepted fix**: `maybeAcceptReferral(slug)` fires from both POST /markets and PUT /markets when `is_public` flips to true. Checks if this is creator's first public market; if so, flips `creator_referrals.accepted = true` and sets `accepted_at`. Resolves the known bug.

**N — Signup drop-off email**: 2h after creator signup, `maybeFireSignupDropoffEmail()` checks if they have zero public markets and sends a "publish your first market" nudge with three paths. Fires via `setTimeout` in signup handler.

**O — Free plan limit banner**: Inline banner in Markets tab appears at 4/5 and 5/5 active markets for free creators. On 403 limit hit, banner shows + upgrade modal opens. Removes the invisible wall.

**P — Member win-back emails**: `sendMemberWinBackEmails()` every Friday 11am UTC. Targets members active at some point but idle for 14–60 days. Personalised with days-away count + 3 hot markets from their communities.

---

## SaaS Pillar features (session 6)

**G — Streak warning emails** (`sendStreakWarningEmails()` in server.js):
- Cron: daily 6pm UTC
- Targets users with streak ≥ 3 who haven't bet in last 24h
- Finds open markets in their communities, sends urgency email
- Three urgency tiers based on streak length (3+, 5+, 7+)

**H — Market template gallery** at `/templates`:
- 12 niches × 6 markets = 72 ready-to-use prediction questions
- Niches: Sports, Crypto, Podcast, Finance, Entertainment, YouTube, Tech, Gaming, Fitness, Music, Newsletter, Politics
- `GET /api/templates` returns gallery metadata; `GET /api/templates/:id` returns full market list
- Filter pills, expandable cards, "Use this template →" links to `/creator/signup?template=id`
- After signup, dashboard detects `?template=` param, auto-opens create modal with first question pre-filled
- "Templates" added to landing page nav
- `'templates'` added to RESERVED_SLUGS

**I — Win card acquisition loop**:
- `win-card.html` now shows a full acquisition CTA block below every win card
- Shows after card loads; names the community; 4 feature bullets; CTA: "Start free — takes 2 min →"
- Links to `/creator/signup?ref=wincard` for tracking
- "Free forever / No card needed" social proof
- Premium creator note: CTA shows on all tiers (win cards are a viral acquisition surface, not a Premium feature)

---

## Session 7 — Multi-option markets (commit `fb9c67d`)

**Q — Multi-option markets** — creators can now create markets with 3–6 answer options instead of just YES/NO:

- **Create modal**: Binary/Multi-option toggle. Multi-option reveals an options builder — add/remove up to 6 options, enter labels + starting %, "Balance %" auto-splits evenly. Validation: all pcts must sum to 100.
- **`POST /markets`**: accepts `options[]` array (`[{label, pct}]`), stores normalised as JSONB in `options` column. `null` = binary (unchanged).
- **`/trade`**: multi-option branch already in place (vote-share parimutuel: `payout = amount / (pct/100)`). Options array updated with new vote counts + recalculated pcts.
- **`POST /markets/:id/resolve`**: validates outcome against option labels for multi-option; winners identified by `pos.side === outcome`; payout uses stored `potential_payout`, credits `community_balances`.
- **Community card**: segmented colour bar (up to 6 colours); N coloured option bet buttons replace YES/NO.
- **Predict modal**: shows multi-option grid buttons (label + live % + payout multiplier per option); `updatePayout`/`updateMultiplier` calculate from option pct.
- **Resolve modal** (creator dashboard): renders option label buttons instead of YES/NO; AI suggestion hidden for multi-option (not yet supported).
- **Migration**: `supabase_migration_multi_option.sql` → `ALTER TABLE markets ADD COLUMN IF NOT EXISTS options JSONB`

**New migration to run:** 20. `supabase_migration_multi_option.sql`

---

## Session 7 continued — view toggle, search, Discord, notifications (commit `ee1733c`)

**R — Creator/Member view toggle:**
- Styled pill toggle in creator dashboard topbar: 🛠 Creator (active) | 👤 Member Dashboard (links to own community)
- Same toggle in community creatorLoginBar when creator views their own community: 🛠 Creator | 👤 Member Dashboard (active)
- Replaces the old plain-text "← Back to Dashboard" bar

**S — Market search on community page:**
- Instant search input above market grid; debounced 180ms, client-side on `market.question`
- Respects active category filter + sort mode simultaneously; shows result count

**T — Discord webhook integration:**
- Creator pastes incoming webhook URL in Settings → Discord Integration
- `sendDiscordWebhook()` fires from POST /markets + PUT /markets on publish transition
- Rich embed: question, category, close date, multi-option list; community brand color
- Test button sends test embed directly from browser; `PUT /api/creator/discord-webhook`
- Migration: `supabase_migration_discord_webhook.sql`

**U — In-app notification bell:**
- 🔔 bell + unread badge in community header AND creator dashboard topbar
- Dropdown: last 30 notifications, unread gold-highlighted, mark-all-read, click → navigate
- Types: `you_won`, `you_lost` (resolution payout loop), `new_market` (on publish)
- `pushNotification()` helper — non-blocking; `GET /api/notifications`, `POST /api/notifications/read`
- Migration: `supabase_migration_notifications.sql`

**New migrations to run:**
21. `supabase_migration_discord_webhook.sql`
22. `supabase_migration_notifications.sql`

---

## Session 7 continued — global search bars (commit `30e9d10`)

**V — Search bars across pages:**
- **creator-dashboard Markets tab**: debounced text search above filter pills; filters across Live/Expired/Archived by question text (`_dashMktSearchQuery` + `onDashMarketSearch()`)
- **explore.html**: full-width search bar above tabs; filters Activity feed (by question + community + username), Hot/New markets (by question + community name), and Communities tab (shows filtered community cards)
- **templates.html**: search input above filter pills; filters by template name, description, and preview questions; stacks with niche pills (`applyTemplateFilter()`)
- **profile.html**: search input on Active Markets grid; now shows ALL active markets (was capped at 6); filters by question + category (`renderProfileMarkets()`, `onProfileSearch()`)
- **community.html**: already had search (session 7, feature S above)

---

## Session 7 continued — profile page discussion + wall (commit `95d6053`)

**W — Profile page engagement tabs:**
- Two tabs on `/u/:slug` below the leaderboard: 💬 Market Discussion | 📌 Community Wall
- **Market Discussion**: aggregates recent comments from across ALL the creator's markets; each item shows username, time, market pill linking back to source market; auto-loads on page open
  - API: `GET /api/profile/:slug/comments` (joins `market_comments` × `markets` filtered by `creator_slug`)
- **Community Wall**: freestanding message board — logged-in members post directly; non-members see join nudge; new posts prepend inline without refresh; 280 char limit
  - API: `GET /api/profile/:slug/wall`, `POST /api/profile/:slug/wall` (auth required)
  - New table: `creator_wall` (id, creator_slug, user_id, content, created_at)
- Migration: `supabase_migration_creator_wall.sql` → run as #23 in ordered list

---

## Session 8 — Seasons & Tournaments (commit `553c8b4`)

**X — Prediction Seasons** — Pro/Premium only — first dedicated paid conversion driver:
- Creator creates a named season (e.g. "Q2 2026 Crypto Season") with end date + prize description
- Assigns any of their active markets to the season
- Members automatically compete on a season-specific leaderboard (PnL across season markets)
- Creator can end the season at any time (leaderboard freezes; history preserved)

**Creator dashboard — 🏆 Seasons tab:**
- Season cards showing status badge (Active/Ended), days left, market count, prize
- Create/Edit modal: name, description, end date, prize, market picker
- "End Season" button
- Free creators see upgrade gate with explanation

**Community page:**
- Active season banner auto-renders above the markets grid (non-blocking fetch)
- Shows season name, description, days remaining, prize text
- Mini top-5 season leaderboard with PnL + win count right in the banner

**API (server.js):**
- `POST /api/creator/seasons` — create (Pro/Premium gate)
- `GET /api/creator/seasons` — list creator's seasons with market counts
- `PUT /api/creator/seasons/:id` — edit / end
- `POST /api/creator/seasons/:id/markets` — assign/remove markets
- `GET /api/community/:slug/seasons` — public season list
- `GET /api/community/:slug/seasons/:id` — season detail + live leaderboard

**Migration:** `supabase_migration_seasons.sql` → run as #24 in ordered list
- `seasons` table
- `markets.season_id` nullable FK column

---

## Session 9 — Members tab + community fixes (commit `ada5a38`)

**AA — Members tab** (creator dashboard `👥 Members` nav item):
- `GET /api/creator/members` — full roster with per-member: display_name, email (Pro+ only), balance (centpoints), total_bets, wins, win_rate, joined_at, last_active. Summary: total_members, active_members (bet in last 30d), total_predictions, engagement_rate, est_engagement_value ($0.80/prediction = industry avg CPC), new_this_week
- ROI summary bar: 5 stat cards including 💰 Est. Engagement Value to anchor upgrade conversations
- Member table: Name, Balance, Predictions, Win Rate, Joined, Last Active, Actions
- Search (name/email), sort (joined, predictions, win rate, balance), CSV export
- Email column gated for Pro+ — free plan sees upgrade nudge
- `showTab('members')` triggers `loadMembers()` — tab title: "Members"

**BB — Per-market email blast** (📬 Blast to members in ⋯ menu):
- `POST /api/creator/markets/:marketId/blast` — sends market-focused email to all community members. Rate-limited: `blasted_at` column, once per market ever. Returns `{ sent, skipped }`.
- Migration: `supabase_migration_blast.sql` → `ALTER TABLE markets ADD COLUMN blasted_at TIMESTAMPTZ`
- Confirms via dialog, shows toast with send count

**⋯ dropdown menu on market rows:**
- Replaced standalone Duplicate button with ⋯ dropdown containing: Share, 📬 Blast, 📋 Duplicate, QR Code, Edit/Archive

**Critical fixes this session:**
- **PUT /api/creator/settings/slug** — cascade slug rename across markets.tenant_slug, community_balances.creator_slug, creator_follows, seasons, creator_wall, users.tenant_slug. Skips duplicate-question conflicts (returns partial success). Community URL field added to Settings tab.
- **POST /markets 23505** — catches unique constraint violation, returns friendly "A market with this question already exists". Bulk create retries one-by-one.
- **GET /api/community/:slug** + **/share/:marketId** — `select('*')` replaces explicit column list, prevents 0-markets bug caused by non-existent columns from pending migrations (e.g. season_id).
- **Carousel fix** — hot filter uses raw `trader_count >= 2` instead of `realTraders()`. Legacy CPMM markets (yes_price=0.5) had realTraders()=0, making carousel always empty.
- **predict-in-widget** (embed.html) — auth via localStorage hf_token, balance bar, YES/NO buttons, mini bottom-sheet predict modal, post-bet share nudge.
- **Post-bet share nudge** (community.html) — captures market context before closePredict() clears pendingMarket, shows "Share your YES call on X →" after successful bet.

**New migration to run:** 25. `supabase_migration_blast.sql`

---

## Session 10 — Share cards, demo mode, community-gated resolution (commits `ceda3ed` → `4a84d63`)

**Members tab wired**: `showTab('members')` now calls `loadMembers()` + tab titles object includes `'members':'Members'`. Was the final missing wire from session 9.

**One-click X/Twitter market share card** (commit `ceda3ed`):
- `openShareCard(marketId)` → modal with 1200×630 canvas preview
- `_drawShareCard()`: full canvas rendering — gradient background, card border, category pill, HYPERFLEX wordmark, word-wrapped question, YES/NO odds buttons, branded footer
- Actions: 🐦 Post on X (opens tweet intent), ⬇ Download PNG (canvas toBlob), 📋 Copy Link
- `GET /og/:marketId.png` server endpoint — builds SVG card → `sharp` converts to PNG; OG/Twitter meta tags on `/share/:marketId` and `/win/:marketId/:userId` updated to use per-market OG images
- `sharp` added to `package.json`; lazy-loaded via `getSharp()` so server starts without it
- Win card OG upgraded to `summary_large_image`

**YouTube scanner demo mode** (commits `6216449`, `477377a`):
- Free-tier creators see a multi-step animated scan (4 steps: fetch → analyze → debates → generate)
- Fetches real YouTube meta via `GET /api/public/youtube-meta/:videoId` (YouTube Data API v3) — real title, channelTitle, commentCount, viewCount, durationSec
- Category-aware demo markets: 7 sets × 6 markets each (Sports, Crypto, Gaming, Fitness, Tech, Music, Finance)
- Real thumbnail from YouTube CDN; real stats shown when available
- Deterministic seeded fallback via `_seedRand(videoId, min, max)` for consistent small-channel numbers
- Locked results with upgrade CTA; "Upgrade to Pro to unlock AI scanner →" button

**Community-gated resolution** (commit `4a84d63`):
- **Removed creator self-resolution**: creators can no longer resolve markets whenever they want
- Markets must be **expired** before resolution is possible (403 if not expired)
- Markets with ≥3 traders require **community vote threshold**: `Math.max(3, ceil(traderCount × 0.30))` resolution votes
- Auto-resolution cron bypasses gate (writes directly — not an API call)
- `POST /api/markets/:id/dispute` extended: `dispute_type` = `'resolution_vote'` | `'outcome_contest'`; `requested_outcome` = YES/NO for resolution_vote type
- `GET /api/market/:id/votes`: public endpoint → `{ vote_count, threshold, yes_votes, no_votes, unlocked, trader_count }`
- Creator dashboard Resolution Queue: vote progress bar per market, locked/unlocked Resolve button, toast with votes_needed on 403
- Community.html: expired unresolved markets show vote bar + Vote YES / Vote NO buttons; `voteOutcome()` + `loadMarketVoteData()` + `window._marketVoteCache` / `window._myVotes`
- `GET /api/public/youtube-meta/:videoId`: calls YouTube Data API v3, returns real stats
- **New migration**: `supabase_migration_dispute_votes.sql` (#26)

**New migrations to run:**
25. `supabase_migration_blast.sql`
26. `supabase_migration_dispute_votes.sql`

---

## Roadmap — Next Highest-ROI Builds

### 1. Mobile Audit ✅ (in progress — session 13)
- 44px touch targets across all pages
- Bottom sheet modals on mobile
- Single-column layouts, no horizontal scroll
- overflow-x hidden, iOS zoom prevention

### 2. Core Community Polish ✅ (in progress — session 13)
- Trending/hot/new badges with velocity detection (`📈 Trending`, `🆕 New`, `🔥 Hot 7`)
- Category filter pills with colored dots + per-category counts
- Compelling empty states with contextual CTAs per filter tab
- Carousel gains Trending + Just Added lanes

### 3. Post-Signup Onboarding ✅ (session 13)
- Full-page welcome screen replacing old modal interstitial
- All 3 platforms (Polymarket + Kalshi + Manifold) with LIVE badges
- Progress bar tracking connections, cards turn green on success
- Multi-connect before proceeding, CTA upgrades after first connect

### 4. Monetization Gating (next up)
- **Early Access → paid flip**: all platform connections currently free; need gate logic for when EA ends
- **Kalshi = Premium only**: real-money platform, highest value — gate behind $99/mo tier
- **Calibration score = Premium only**: advanced analytics feature, strong upgrade driver
- **Portfolio sync frequency tiers**: Free = manual refresh, Pro = daily auto-sync, Premium = hourly auto-sync
- Stripe checkout already wired — just need UI gates + middleware checks per feature

### Known Issues
- **Creator referral acceptance**: `accepted` on `creator_referrals` stays false — needs flip on first public market publish
- **Admin invite emails**: Require SMTP env vars — silently skips if not set
- Video section on landing page needs real YouTube VIDEO_ID
- Old `index.html` at project root should be removed eventually

---

## Workflow

**Plan in Cowork (VM), build in Claude Code (Mac).**
- Cowork sessions: strategy, feature planning, architecture decisions, CLAUDE.md updates
- Claude Code sessions: file edits, git commits, pushes, code implementation
- Only Claude Code (Mac) should run git commands

**⚠️ VirtioFS SYNC ISSUE — happens every session:**
VirtioFS does NOT reliably flush Cowork VM writes to the Mac in real time.
Claude Code at `/Users/marcdems/Desktop/HYPERFLEX` will show a clean working tree
even after Cowork has made changes.

**Fix (Cowork must do this at the end of every coding session):**
```bash
cd /sessions/relaxed-determined-euler/mnt/hyperflex
git diff HEAD > cowork-latest.patch
```
Then tell the user: "Run `git apply cowork-latest.patch` in Claude Code before committing."

**Claude Code apply + commit flow:**
```bash
cd /Users/marcdems/Desktop/HYPERFLEX
git apply cowork-latest.patch
git status   # verify files are dirty
# then commit + push as normal
```

---

## ⚠️ MUST DO BEFORE DEPLOY — Run ALL migrations in Railway Postgres (NOT Supabase)

**The production DB is Railway Postgres, not Supabase.** `server.js:799` connects via `DATABASE_URL`, which Railway sets to its own Postgres service (`centerbeam.proxy.rlwy.net` or similar). The `supabase_migration_*.sql` filename prefix is historical — keep the filenames as-is for continuity, but run them in Railway's SQL console, not Supabase's.

**To run migrations:**
1. Railway dashboard → your **Postgres** service → **Data** tab → built-in SQL editor, OR
2. `psql "$DATABASE_URL"` from a machine with `pg` installed, OR
3. Any GUI (TablePlus/DBeaver/pgAdmin) connected via the Railway `DATABASE_URL`

**To verify a migration landed:** `node scripts/schema-diff.js` — reports every table/column expected by `supabase_migration_*.sql` files vs. what Railway Postgres actually has. Run this after every migration and after every deploy that adds schema.

**If you run SQL in Supabase by mistake:** it goes into a dead DB with ~9 users and no production traffic. Symptoms: Railway logs spam `relation "foo" does not exist` every cron cycle even though the table "exists" in Supabase. Fix is always "run it again in Railway".

### Ordered migration list
  1. `supabase_migration_community_economy.sql`
  2. `supabase_migration_refill_history.sql`
  3. `supabase_migration_cpmm.sql`
  4. `supabase_migration_referrals.sql`
  5. `supabase_migration_custom_domains.sql`
  6. `supabase_migration_challenges.sql`
  7. `supabase_migration_plan_trial.sql`
  8. `supabase_migration_market_suggestions.sql`
  9. `supabase_migration_announcements_comments.sql`
  10. `supabase_migration_tweet_markets.sql`
  11. `supabase_migration_autoscan_autoresolve.sql`
  12. `supabase_migration_vote_consensus.sql`
  13. `supabase_migration_creator_rewards.sql`
  14. `supabase_migration_reward_unlocks.sql`
  15. `supabase_migration_creator_invites.sql`
  16. `supabase_migration_creator_referrals.sql`
  17. `supabase_migration_market_disputes.sql`
  18. `supabase_migration_creator_follows.sql`
19. `supabase_migration_email_unsubscribe.sql`
20. `supabase_migration_multi_option.sql`
21. `supabase_migration_discord_webhook.sql`
22. `supabase_migration_notifications.sql`
23. `supabase_migration_creator_wall.sql`
24. `supabase_migration_seasons.sql`
25. `supabase_migration_blast.sql`
26. `supabase_migration_dispute_votes.sql`
27. `supabase_migration_kalshi.sql`
28. `supabase_migration_shared_positions.sql`
29. `supabase_migration_predictor_follows.sql`
30. `supabase_migration_cached_positions.sql`
31. `supabase_migration_archived.sql` ← adds `archived` col to markets
32. `supabase_migration_banner_position.sql` ← banner focal point on creator_settings
33. `supabase_migration_branding.sql` ← custom branding cols
34. `supabase_migration_community_category.sql` ← community_category on creator_settings
35. `supabase_migration_news_scanner.sql` ← news feed settings on creator_settings
36. `supabase_migration_pending_emails.sql` ← creates pending_emails queue table
37. `supabase_migration_plan_scheduling.sql` ← plan_scheduled_change on creator_settings
38. `supabase_migration_resonance.sql` ← resonance_score on markets
39. `supabase_migration_sponsored_embed.sql` ← sponsored markets + embed attribution
40. `supabase_migration_narrative_snapshots.sql` ← narrative dominance snapshots for screener (Claude Code creates this)
41. `supabase_migration_errors.sql` ← error logging table for reliability monitoring
42. `supabase_migration_platform_referrals.sql` ← referral_code + referred_by on users, platform_referrals table
43. `supabase_migration_login_streak.sql` ← login_streak, last_login_date, streak_multiplier on users
44. `supabase_migration_normalized_snapshots.sql` ← normalized_snapshots + cross_market_refs + api_keys tables for data engine
45. `supabase_migration_influencer_feed.sql` ← external_influencers + influencer_posts tables, seed data for 30+ influencers
46. `supabase_migration_influencer_social.sql` ← influencer_post_reactions + influencer_post_comments + influencer_follows + engagement counters
47. `supabase_migration_sports.sql` ← sport_teams + sport_games + picks tables, immutable pre-game pick triggers (NBA-first tipster wedge)
48. `supabase_migration_polymarket_v2_trades.sql` ← polymarket_v2_trades table for V2 observability (gates V1 deletion on real usage evidence)
- **Email notifications**: Opt-in via Railway env vars: `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
  - Fires after both manual resolve and cron settlement
  - No-op if SMTP_HOST is not set — safe to deploy without configuring
- Video section on landing page needs real YouTube VIDEO_ID
- Old `index.html` at project root should be removed eventually
- **This session (March 13, final)** — all committed, needs push (latest: `81b5c65`):
  - Community page: full Polymarket-style 2-col card grid, featured hero card, big odds numbers, category pills, hot badge (commit `2c9897e`)
  - Free tier: 3 → 5 active markets
  - Resolution note: creator adds context on resolve; shown in resolved banner on community page
  - Creator announcements: post/pin/delete from dashboard Overview; rendered above markets grid
  - Market comments: inline expandable threads per card, lazy loaded, 280 char limit
  - Email notifications: `sendResolutionEmails()` with branded HTML email; fires on manual + cron resolution
  - `supabase_migration_announcements_comments.sql`: new tables + resolution_note column (commit `81b5c65`)
  - Member market suggestion queue (commit `e06ecc2`)
- **Economy Phase 3** — streak broken toast ✅ built (March 16)
- **This session (March 15)** — committed `068b03c`, needs push:
  - Tweet → Market feature: Tweet tab in AI Scanner modal (creator-dashboard.html)
    - Paste tweet URL + author + text → generates 1-3 focused markets via AI
    - Markets saved with `source_tweet_url`, `tweet_text`, `tweet_author` columns
    - After publish: toast with clickable `/share/:marketId` link
  - `/share/:marketId` route in server.js: public OG-friendly share page with tweet card + market odds
  - `supabase_migration_tweet_markets.sql`: adds 3 columns to markets table ← RUN THIS
  - **Community page tweet feed**: `renderTweetFeed()` renders tweet-sourced markets as X-style cards above announcements
  - **Critical bug fix** in `/api/community/:slug`:
    - Removed non-existent `resolution_outcome` column from SELECT (was silently nulling all data)
    - Fixed `is_public` filter to `.neq('is_public', false)` (was dropping legacy NULL rows)
    - Added tweet fields to SELECT
- **This session (March 16)** — committed `64b92c3`, needs push:
  - **Twitter-like activity feed** on explore.html: new ⚡ Activity tab replaces Live Feed; Twitter-style cards for bets/resolutions/market creations; live polling every 20s with "N new activities" banner; `/api/activity` endpoint
  - **Member public profiles** at `/m/:userId` — stats (win rate, streak, correct calls), recent wins, community chips; leaderboard rows now clickable → member profile
  - **Nominate your creator** page at `/nominate` — fan form with creator name/URL/message, sends admin email; "Nominate Your Creator" CTA in explore sidebar
  - **Weekly digest email** — `sendWeeklyDigests()` sends branded HTML with hot markets + top 3 leaderboard to all community members; cron: Mon 9am UTC
  - **Streak broken toast** — `checkStreakBroken()` in community.html uses localStorage to detect streak collapse ≥3→0, shows motivational toast
  - **Win cards fully wired** (commit `93428a4`): `openWinCard()` now takes marketId + userId, `shareWinOnX()` uses `/win/:marketId/:userId` URL, Copy link button added
  - **Creator public profiles** at `/u/:slug` — `public/profile.html`
  - `'m'` + `'nominate'` + `'win'` + `'u'` added to RESERVED_SLUGS

- **Audience Intelligence + AI Recommendations** (commit `16822d7`) — needs push:
  - `POST /api/creator/insights` — sends real analytics to Claude Haiku, returns 4 data-specific growth recommendations with type/priority/metric
  - Creator dashboard Analytics tab: Audience Intelligence section (engagement rate ring gauge, 14d member growth chart, category breakdown bars, sentiment by category)
  - AI Growth Recommendations panel with "Generate Insights" button
  - Community page: Community Pulse bar (category sentiment pills showing weighted avg YES% from active markets)

- **This session (March 16, session 4)** — committed, needs push:
  - **Market card redesign** on community.html: slim 4px odds bar, inline YES%/NO% bet buttons, cleaner card style matching profile page
  - **Predict modal enhancements**: expiry date, payout multiplier (e.g. 2×), optional comment field that posts to activity feed
  - **Comments → activity feed**: comment events wired to global explore.html feed as Twitter-style cards
  - **Source links**: `getMarketSource()` helper, 📰 source link on card meta + predict modal; fixed anonymous comment posting
  - **Full mobile audit**: tweet cards overflow fixed, bottom-sheet predict modal at ≤480px, all pages audited
  - **Feature 1 — Onboarding wizard**: YouTube channel ID field in step 1 (seeds auto-scan), Share on X button in step 3
  - **Feature 2 — Member display name prompt**: modal after first login if no name set; `PUT /api/user/display-name`; localStorage key `hf_named_{userId}`
  - **Feature 3 — Auto-scan per creator**: `youtube_channel_id`, `auto_scan_enabled`, `auto_scan_cadence` columns; `scanCreatorYouTubeChannels()` cron (daily 8am UTC); GET/PUT `/api/creator/youtube-scan-settings`; Auto-Scan panel in Settings tab
  - **Feature 4 — Market auto-resolution**: `autoResolveExpiredMarkets()` cron (every 30 min); fetches resolution_source URL → Claude Haiku → auto-resolves at ≥82% confidence or flags + emails creator for manual review
  - **Migration**: `supabase_migration_autoscan_autoresolve.sql` — adds `youtube_channel_id`, `auto_scan_enabled`, `auto_scan_cadence`, `auto_scan_last_run` to `creator_settings`; adds `resolution_outcome`, `resolved_at` to `markets`
  - ⚠️ Add migration to the ordered list below

- **⚠️ MUST DO BEFORE DEPLOY**: Also run `supabase_migration_autoscan_autoresolve.sql` (11th in the list)

---

## Session 11 (March 17, 2026)

**Phase 2 + 3 complete (commits e33da8d → 2153f90):**
- Follow system: predictor_follows table, toggle follow endpoint, follower count on member profiles + predictor cards
- Following feed: 👥 Following tab on explore.html — activity from followed users (external bets + HFX bets)
- Public portfolio API: `GET /api/predictors/:userId/portfolio` pulls cached_positions + HFX bets
- Auto-sync cron: `syncAllUserPositions()` runs hourly — Polymarket/Kalshi/Manifold fetched for all connected users, stored in cached_positions table; portfolio tab reads from cache first
- P&L analytics: `GET /api/predictors/:userId/analytics` — platform win/loss/PnL breakdown, calibration chart, cumulative 30d timeline, sharp score composite
- member.html: analytics section with platform stat cards, calibration canvas chart, PnL line chart, sharp score badge
- predictors.html: sharp score badge on predictor cards

**New migrations to run:**
29. `supabase_migration_predictor_follows.sql`
30. `supabase_migration_cached_positions.sql`

**Latest commit: `2153f90`**

---

## Session 12 (March 17, 2026)

**Migrations #29 + #30 confirmed run in Supabase.**

**Predictor ecosystem polish (commits `4a20ba4` → `d29d68d`):**

- **Portfolio Early Access banner + Polymarket LIVE connect UI** (`4a20ba4`): tier-gated portfolio tab — Free shows HFX-only + upgrade banner, Pro unlocks Polymarket + Manifold, Premium gets auto-sync; Polymarket card marked LIVE with wallet connect UI
- **Trophy card + share to X** (`7413493`): best-call trophy card on member profiles — shows top resolved win (question, outcome, payout), 1-click "Share on X" intent with pre-filled copy; replaces earlier draft commit `68bc9ad`
- **Predictor Spotlight weekly email + profile share stats** (`c28084f`): `sendPredictorSpotlight()` cron (Mon 9am UTC) — picks top predictor by 30d PnL, sends branded HTML email to all connected users; `GET /api/predictors/:userId/share-stats` returns win rate + top call for share cards
- **Profile referral/invite section** (`b2af9d2`): member.html owner-only panel — shows referral link, invite copy, tracks invites sent via existing `creator_referrals` system
- **Polymarket LIVE fix** (`e9476a8`): marquee updated to reflect Kalshi + Manifold now live
- **SEO meta tags on /predictors** (`9d29ce1`): full SEO head — `<title>` targeting "polymarket portfolio tracker", meta description, keywords, Open Graph (og:title, og:description, og:url `https://hyperflex.network/predictors`, og:image), Twitter card (summary_large_image)
- **Predictors tracked stat** (`9d29ce1`): `/api/stats` now returns `predictors` field (distinct user_id count from positions table, Set-dedup in JS, 5-min cache); landing page stats bar has 4th tile "Predictors Tracked" (`id="stat-predictors"`)
- **Quick Preview hook on landing page** (`d29d68d`): dark card between marquee and How It Works — wallet + username inputs, gold "Show my stats →" button; calls `GET /api/polymarket/positions/:address` (new public endpoint) or `GET /api/manifold/positions/:username`; shows inline result card with platform badge, open position count, total P&L (green/red), top market; upgrade CTA "Save your full portfolio + track Kalshi → Get started free" → `/creator/signup`; Enter key supported
- **`GET /api/polymarket/positions/:address`** (new, public, no auth): validates `0x...` hex address, proxies `data-api.polymarket.com`, 5-min cache via `_polyCache`, normalised response shape

**Latest commits: `b2af9d2`, `c28084f`, `7413493`, `4a20ba4` + `e9476a8`, `9d29ce1`, `d29d68d`**

---

## Session 13 (March 18, 2026) — Claude Code

**Mobile responsiveness** (commit `8c21f5e`):
- 44px touch targets on all interactive elements across all 6 pages
- Bottom sheet modals on explore.html auth + creator-dashboard modals
- overflow-x hidden, single-column enforcement, hamburger 44px

**Market discovery** (commit `747dfea`):
- 📈 Trending badge (velocity: 3+ traders in <72h)
- 🆕 New badge (created <24h ago)
- 🔥 Hot badge now shows trader count
- Category filter pills row with colored dots + counts
- Compelling empty states with contextual CTAs per filter
- Carousel gains Trending + Just Added lanes

**CLAUDE.md rewrite** (commit `af5da7c`):
- Aggregator-first vision in "What This Project Is"
- New Platform Integrations section
- Updated file map + current state

**Post-signup welcome screen** (commit `af3e765`):
- Full-page onboarding with all 3 platforms (Polymarket/Kalshi/Manifold)
- Progress bar, green checkmarks on connect, multi-connect flow
- CTA upgrades after first connection

---

## Session 14 (April 13, 2026) — Social Media Pivot

**The pivot:** HYPERFLEX is no longer a terminal. It's the social media of prediction markets. Whale signals are commoditized — the moat is the social graph + verified track records.

**Takes system** (commit `6a85728`):
- `takes` + `take_reactions` tables, 6 API endpoints
- Whale take synthesis: $50k+ trades and consensus signals auto-generate takes
- explore.html: Takes feed with For You / Following / Trending tabs, compose modal, agree/disagree/quote-predict
- market.html: post-trade "Share your take" bottom bar with thesis input

**Resolution scoring + notifications** (commit `bd7b41b`):
- `scoreTakesForMarket()`: marks takes correct/incorrect on market resolution
- Notification hooks: reactions notify author, quote-predicts notify parent, correct takes get celebration
- market.html: Community Takes section above comments
- member.html: Takes section on profiles with accuracy stats

**Whale profiles** (commit `1c809bc`):
- `ensureWhaleProfile()`: auto-creates user records for whale wallets
- Top 30 whales get profiles on every leaderboard fetch
- member.html: purple WHALE badge, rank, PnL, wallet address with Polygonscan link
- explore.html: take authors link to profiles, correctness badges on resolved takes
- `GET /api/whale-profiles`: whale discovery endpoint

**Strategy docs updated:**
- `HYPERFLEX_Complete_Brief.md` rewritten for social media vision
- `CLAUDE.md` updated with strategy, revenue plan, social attack plan

**New migrations:** #44 `supabase_migration_takes.sql`, #45 `supabase_migration_whale_profiles.sql`

---

## Session 15 (April 23, 2026) — Cleanup + Profile Fix

**Rewards system removal** (commits `a9d20c0`, `b843949`):
- Removed "Earn USDC" / rewards banners from explore.html and signals.html
- `/rewards` route now redirects to `/` — dead page purged
- Removed rewards nav link from nav.js (shared nav bar)

**Dead file cleanup + shared utilities** (commit `a360646`):
- Extracted `public/utils.js` — shared utility functions across pages
- Deleted 4 dead HTML pages: `alpha-preview.html`, `user-dashboard.html`, `meet-kevin-oil-market.html`, `twitter-banner.html`

**Profile data mismatch fix** (commit `101f195`):
- **Bug**: Whale profiles at `/m/:userId` showed 0/0/0 stats (no HFX bets) while hero card showed correct Polymarket PnL — confusing split between HFX `positions` table data and live Polymarket data
- **Fix**: Added `loadWhalePositions(walletAddr)` in member.html — auto-fetches live Polymarket positions via `/api/trader/:address/profile` for whale profiles; renders up to 8 open positions inline with side badge, price, size, PnL
- **Bug**: HFX user profile links in predictors.html routed UUID user_ids to `/p/:UUID` → `profile-trader.html` → display_name search → always 404
- **Fix**: Updated `renderPodium`, `renderTable`, `renderHallOfFame` in predictors.html — UUID user_ids (non-`0x`) now route to `/m/:userId`; wallet addresses still go to `/trader/:wallet`
- **Bug**: `loadSocialPredictions()` and `showOwnerTools()` in member.html were never called — dead `_origLoad` override at bottom of file ran after `load()` had already executed
- **Fix**: Removed dead override; wired `loadAnalytics`, `loadTrophyCard`, `loadInviteSection`, `loadWhalePositions`, `showOwnerTools`, `loadSocialPredictions` directly at the end of `load()`

**Latest commits:** `a360646` → `b843949` → `a9d20c0` → `101f195` (all on branch `claude/fix-clob-order-attribution-UiZjd`)

---

## The Ask

Marc is the founder. Claude is the CTO. Be proactive, stay in context, don't ask what we're building — you already know. Read the brief, check git status, and get to work.
