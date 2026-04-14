# HYPERFLEX — Complete Product Brief
## Last updated: April 13, 2026

---

## What HYPERFLEX Is

HYPERFLEX is a **social network for prediction market traders** — a platform where users build verified public identities around their forecasting track record, post predictions attached to real money positions with written theses, follow the traders they trust, and trade directly across Polymarket and Kalshi from a single interface.

The core thesis is that the social graph of prediction market participants — who follows whom, whose calls others act on, whose reasoning moves markets — doesn't exist anywhere yet, and HYPERFLEX is the only platform positioned to own it. Built on Node.js/Express with a Supabase backend and hosted on Railway, the platform already has Polymarket CLOB trading live, a cross-platform portfolio aggregator, alpha signal engine, Stripe subscriptions, and creator tooling; what's being built now is the social layer — prediction posts, accuracy scoring, and the follow graph — which transforms HYPERFLEX from a trading utility into a network effect business whose data becomes the defensible B2B asset: verified forecaster accuracy by domain, thesis-linked position data, and influence cascade analytics that no exchange, data vendor, or signal bot can replicate.

**One sentence:** HYPERFLEX is where you post your prediction, prove you were right, and build a reputation that follows you.

---

## The Vision

### Phase 1 (LIVE): Intelligence + Social Layer
Whale tracking, alpha terminal, screener — the data backbone. Takes feed where every trade can become a public prediction with a thesis. Whale profiles auto-created from Polymarket leaderboard. Agree/disagree reactions as lightweight social signal. Quote-predict for counter-positions.

### Phase 2 (NOW): Social Graph
Trending takes as the front door. Notification loops ("X agreed with your take"). Resolution scoring that builds permanent track records. Predictor reputation tiers based on take accuracy. Take of the Day email. Whale profiles as discoverable content.

### Phase 3: Network Effects
"I'm top 50 on HYPERFLEX" becomes a credential. Prediction threads (take → counter-take → resolution). DMs between predictors. Prediction groups. Cross-platform share cards that drive acquisition. The feed becomes what people open every morning.

### Phase 4: Monetization
Every trade routed through HYPERFLEX earns builder fees on Polymarket. Premium features: advanced analytics, copy-trading, API access, auto-sync frequency tiers. The social graph is the moat — revenue follows attention.

---

## Why Social Wins

Every prediction market tool on Twitter right now is a **terminal** — a dashboard of data you look at and leave. Terminals don't have network effects. They don't compound. A new competitor can replicate your screener in a weekend.

Social products compound. Every take posted is content. Every follow is a connection. Every resolution scored is reputation banked. After 6 months, HYPERFLEX has:
- Thousands of scored predictions proving who's actually good
- A social graph you can't rebuild elsewhere
- Whale profiles with years of on-chain history attached
- A feed that's interesting even if you don't trade

The alpha terminal becomes a **feature** inside the social product — not the product itself.

---

## Target User

1. **Active Polymarket/Kalshi traders** — want to post takes, build reputation, see what sharps think
2. **Whale watchers** — follow whale profiles, react to their moves, see their track records
3. **Crypto/finance creators** — post takes to prove their track record, build audience
4. **Degens** — want the hottest takes, the most controversial predictions, the social energy

---

## Business Model

**Primary revenue: Polymarket builder fees.** Every trade placed through `/market/:slug` earns fees via the builder program. The social layer drives users to market pages → trades → revenue.

| Tier | Price | Access |
|------|-------|--------|
| Free | $0 | All features, all data, all social — no limits |
| Pro | $29/mo | API access (60 req/min), agent config, advanced analytics |
| Premium | $99/mo | API access (300 req/min), auto-sync, priority |

Everything is free. Revenue = volume × builder fees. The more social engagement → the more market page visits → the more trades → the more revenue.

---

## The Social Stack (Built This Session)

### Takes System
- **takes** table: user posts a prediction with optional thesis, linked to a Polymarket market
- **take_reactions** table: agree/disagree (not likes — directional signal)
- **Quote-predict**: repost someone's take with your own counter-position
- **Resolution scoring**: when a market resolves, every take is marked correct/incorrect
- **Correctness badges**: CORRECT / WRONG shown permanently on resolved takes

### Feed
- **For You**: algorithmic — recency × engagement × sharp score × source variety
- **Following**: takes from people you follow
- **Trending**: hottest takes by engagement + recency
- **Compose modal**: search for a market, pick YES/NO, write thesis, post
- Auto-polls every 45 seconds

### Whale Profiles
- Every top-50 Polymarket whale automatically gets a user profile at `/m/:userId`
- Profile shows: purple WHALE badge, rank, PnL, wallet address, Polygonscan link
- Whale takes auto-synthesized from $50k+ trades and consensus signals
- Whale profiles are followable via the existing predictor follow system

### Cold Start Solution
The feed is **never empty** because whale activity IS content:
- $50k+ whale trades → auto-generated takes with position size, entry price, trader name
- 3+ whale consensus signals → consensus takes showing aligned capital
- Both linked to whale profiles so you can click through and follow

### Notifications
- "X agreed with your take"
- "X counter-predicted your take" (quote-predict)
- "Your take was right!" (on market resolution)

### Market Integration
- **market.html**: "Community Takes" section above comments — social proof before trading
- **Post-trade prompt**: after successful trade, bottom bar slides up with "Share your take" + thesis input
- **member.html**: Takes section on profiles — total takes, accuracy %, recent takes list

---

## Intelligence Stack (Data Backbone)

### Alpha Terminal (`/alpha-live`)
Live edge cards ranked by Edge Score (8 signals: whale + capital + volume + depth + momentum + decay + expiry + divergence). Auto-refresh 90s.

### Whale Watch (`/whales`)
Top 50 Polymarket whale positions. Real-time trade stream. Copy-trade system. Whale consensus signals.

### Screener (`/screener`)
200+ markets with filters. Narrative Intelligence panel. CLOB depth data. Live prices.

### Signals (`/signals`)
Whale clusters, momentum, new entries, arbitrage. Deduped by base question. News catalysts.

### Data Terminal (`/terminal`)
Fear & Greed index, whale flow by category, market movers, cross-platform comparison.

### Cross-Platform Portfolio
Connect Polymarket/Kalshi/Manifold. Unified P&L, calibration charts, sharp scores. Auto-sync cron.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Server | Node.js + Express 5 |
| Database | PostgreSQL (Supabase-hosted, direct connection via DATABASE_URL) |
| Auth | JWT + bcrypt + Google OAuth + X/Twitter OAuth |
| AI | Anthropic Claude (market analysis, news impact, alpha hooks — optional, non-blocking) |
| Frontend | Plain HTML/CSS/JS in `public/` — no framework |
| Hosting | Railway (auto-deploys from `git push origin main`) |
| Domain | hyperflex.network |
| Fonts | Inter (display) + JetBrains Mono (mono) |
| Trade Proxy | Cloudflare Worker (geo-block bypass for CLOB orders) |

---

## Key Metrics

- 13 connected users with portfolio sync
- 200+ Polymarket markets in screener
- $177M+ whale capital tracked
- 50 whale traders monitored with auto-profiles
- 60+ arb opportunities detected per cycle
- 244 whale positions tracked in real-time
- Builder fees active on all Polymarket trades

---

## Competitive Landscape

| Competitor | What They Do | Why We Win |
|-----------|-------------|-----------|
| Whale signal bots (Twitter) | Broadcast whale moves | We have profiles, takes, social graph — not just alerts |
| HyperDash | Hyperliquid whale tracking | We're prediction-market-specific with social layer |
| Polymarket.com | The exchange itself | We aggregate + add intelligence + social layer on top |
| Manifold Markets | Play-money prediction social | No real-money integration, no whale data, no alpha |
| Metaculus | Forecasting community | Academic, no trading, no real-money markets, no whale tracking |

**The moat is the social graph + verified track records.** Nobody else has whale profiles with linked prediction history and community reactions.

---

## What's Next

1. **Trending takes on landing page** — surface hottest takes as acquisition hook
2. **"Was I right?" email** — when a market resolves, email everyone who took a position
3. **Take of the Day** — daily email/notification featuring highest-engagement take
4. **Predictor reputation tiers** — Oracle / Sharp / Solid / Speculator based on take accuracy
5. **Prediction threads** — take → counter-take chains that create engagement loops
6. **DMs between predictors** — direct messaging for the social graph
7. **Share cards for X/Twitter** — auto-generated OG images for takes

---

## Migrations to Run (in order)

44. `supabase_migration_takes.sql` — takes + take_reactions tables
45. `supabase_migration_whale_profiles.sql` — is_whale, whale_rank, whale_pnl on users

---

*This brief is the single source of truth for HYPERFLEX. Read it before every session.*
