# HYPERFLEX — Complete Product Brief
## Last updated: March 23, 2026

---

## What HYPERFLEX Is

HYPERFLEX is a **prediction market intelligence platform**. It aggregates data from Polymarket, Kalshi, Manifold, and Hyperliquid into one dashboard — giving traders the tools to find edge, track smart money, and act faster than the market.

The core insight: prediction markets are the most efficient price discovery mechanism for real-world events, but the data is fragmented across platforms, the signal-to-noise ratio is terrible, and nobody is building the Bloomberg Terminal for this asset class. HYPERFLEX is that terminal.

**One sentence:** HYPERFLEX tells you what the smartest traders are betting on, why, and whether you should follow them.

---

## The Vision

### Phase 1 (NOW): Intelligence Dashboard
Track whale movements, surface signals, compare odds across platforms. Free to use. Build audience and trust through data quality.

### Phase 2: Paid API + Agent
Gate programmatic access behind Pro/Premium plans. The HYPERFLEX Agent monitors signals 24/7 and fires recommendations when user-defined thresholds are hit. Kelly criterion sizing. Push notifications.

### Phase 3: Execution
Intent-to-execution bridge — one tap from signal to trade on Polymarket. Eventually embedded wallets (Privy) + direct CLOB execution so users never leave HYPERFLEX.

### Phase 4: Track Record as Moat
Every signal logged. Every outcome tracked. After 6 months of verified performance data, the track record sells the product better than any marketing. Competitors can copy the UI — they can't copy 6 months of logged, verified signal performance.

---

## Target User

1. **Active Polymarket/Kalshi traders** — want to know what whales are doing before the market moves
2. **Crypto traders** — already tracking Hyperliquid whales, now want prediction market alpha
3. **Finance content creators** — need data for content, want to prove their track record
4. **Degens** — want the fastest signal, the biggest edge, the most actionable intel

---

## Business Model

| Tier | Price | Access |
|------|-------|--------|
| Free | $0 | All pages, all data on site |
| Pro | $29/mo | API access (60 req/min), Agent config, advanced analytics |
| Premium | $99/mo | API access (300 req/min), all features, priority |

Revenue also from: API keys ($500/mo enterprise), future copy-trading fees, data licensing.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Server | Node.js + Express 5 |
| Database | PostgreSQL on Railway (migrated from Supabase free tier) |
| Auth | JWT + bcrypt + Google OAuth + X/Twitter OAuth |
| AI | Anthropic Claude (market analysis, scanner, Crystal Ball) |
| Frontend | Plain HTML/CSS/JS in `public/` — no framework |
| Hosting | Railway (auto-deploys from `git push origin main`) |
| Domain | hyperflex.network |
| Fonts | Syne (display) + Space Mono (mono) |
| Colors | Gold `#c9920d`, Background `#141412`, Paper `#e8e4d9` |
| Repo | github.com/marcdems1-create/Hyperflex.git |

---

## Live Pages — Complete Map

### Prediction Market Intelligence (public, no login required)

| Page | URL | What It Does |
|------|-----|-------------|
| Landing | `/` | Hero, RIGHT NOW live signal, Last Hour whale feed, Today's Watchlist, live stats, Fear & Greed |
| Whales | `/whales` | Top 50 Polymarket whale positions in real-time, $177M+ tracked. Follow whales, Copy Trade, Auto-Mirror. Hyperliquid tab with Large/Mid/Small cap filter |
| Whale Index | `/whale-index` | Auto-generated portfolio from top 50 whales. Consensus picks, simulated performance |
| Screener | `/screener` | 200+ real Polymarket markets with filters. Narrative Intelligence panel showing dominant themes by volume share |
| Signals | `/signals` | Alpha signals: whale clusters, momentum, new entries, arbitrage. Deduped by base question, 2-per-narrative cap. News catalysts. Winner Picks |
| Crystal Ball | `/crystal-ball` | AI-generated predictions: whale convergence, momentum breakout, smart vs dumb money divergence, leverage signals, expiry convergence |
| Accuracy | `/accuracy` | Signal tracking started March 22 — verification page for prediction accuracy |
| Odds | `/odds` | Cross-platform odds comparison (Polymarket vs Kalshi vs sportsbooks) |
| Data | `/data` | Whale flow by category, market movers, whale concentration table, cross-platform comparison, smart money sentiment |
| Predictors | `/predictors` | Ranked leaderboard of traders by PnL, sharp scores, platform badges. Links to trader profiles |
| Trader Profile | `/trader/:address` | Multi-platform deep dive for any EVM wallet. Polymarket positions + Hyperliquid perps, P&L chart, platform detection |
| Explore | `/explore` | Activity feed, Smart Money Divergence section (cohort intelligence), live insights, daily briefing, community browser |
| Templates | `/templates` | Market template gallery — 12 niches, 72 ready-to-use prediction questions |
| API Docs | `/api-docs` | Public API documentation with auth instructions, rate limits by plan |
| Agent Signal | `/agent/signal/:id` | Individual signal recommendation page with Kelly sizing calculator |
| Agent Performance | `/agent/performance` | Public track record — win rate, returns, best calls |

### Community Markets (login required for betting)

| Page | URL | What It Does |
|------|-----|-------------|
| Community | `/:slug` | Community prediction market page (e.g., `/wallstreetbets`). Market cards with odds, betting, cohort sentiment, comments, leaderboard |
| Creator Dashboard | `/creator/dashboard` | Full dashboard: markets, portfolio, analytics, members, settings, Quick Trade, Find Markets, YouTube/Twitch scanner |
| Creator Login | `/creator/login` | Email/password + Google OAuth + X OAuth. Forgot password flow |
| Creator Signup | `/creator/signup` | Redirects to login#signup |
| Reset Password | `/reset-password` | Token-based password reset page |
| Member Profile | `/m/:userId` | Public member stats, P&L, platform cards, trophy card |
| Creator Profile | `/u/:slug` | Creator public profile with market discussion + community wall |
| Admin | `/admin` | Internal ops dashboard — creator management, plan control, platform stats, outreach, password reset |

---

## Key Features Built This Session (March 23, 2026)

### Intelligence Features
1. **Country/region flags** on all market displays (30+ countries detected from question text)
2. **Category emoji badges** (🏈 Sports, ₿ Crypto, 🏛️ Politics, etc.) across all pages
3. **Narrative Intelligence** on screener — groups markets into 9 themes, shows dominance %, weekly change, click-to-filter
4. **Signal deduplication** — strips date variants ("by March 31" / "by April 15"), keeps strongest signal, shows "+N similar markets"
5. **Per-narrative cap** — max 2 signals per theme to prevent feed flooding
6. **News catalyst layer** — surfaces breaking news behind whale signals via NewsAPI
7. **Cohort intelligence** — segments bettors into Sharp/Experienced/Retail, shows where smart money disagrees with retail
8. **Smart Money Divergence** section on explore page
9. **Trader profile page** `/trader/:address` — multi-platform analytics (Polymarket + Hyperliquid)
10. **Crystal Ball price fix** — shows "YES odds: 2c to 99c" instead of misleading "+4900%"

### Bug Fixes
1. Crystal Ball/momentum: filter near-zero baseline, expired markets, resolved markets
2. Momentum signal direction: BUY now matches actual price movement
3. AI Analysis: graceful fallback instead of 500 error
4. Trader profile: losses no longer labeled as WIN
5. Member profile: epoch-0 date ("Dec 1969") hidden
6. HL whale table: $0 entry/mark prices show "—"
7. Signal score icons: consistent emoji (🔥/⚡/📊) at all scores
8. Winner Picks: hides traders with no active positions
9. Find Markets search: relevance scoring + odds display fixed
10. Data page: whale concentration rows clickable + cross-platform auto-load

### UX Improvements
1. **Unified navbar** — single `nav.js` component across all 11 pages. One file to maintain.
2. **Sign In + Get Started buttons** added back to navbar (were removed during nav unification)
3. **Dashboard link** added to every page
4. **Auto-Copy renamed to Auto-Mirror** with tooltip + confirmation
5. **HL Large Cap filter** — defaults to large cap coins (BTC, ETH, SOL, etc.) with tier badges
6. **Password reset flow** — forgot password, email with reset link, standalone reset page, admin trigger
7. **Signup slug fix** — auto-generates URL slug from display name

### Infrastructure
1. **Migrated database from Supabase free tier to Railway Postgres** — 5ms queries vs 440ms+
2. **Full auto-migration on boot** — creates all 20+ tables automatically on fresh DB
3. **API auth fix** — blocks direct browser navigation to gated endpoints (Sec-Fetch-Mode check)
4. **Admin routes** rewritten to use pg pool directly (bypass broken supabase-js client)
5. **DB connection reliability** — proper client checkout/release, 15s timeouts, no connection leaks
6. **Supabase-js pinned to 2.46.0** (2.99.0 incompatible with legacy JWT keys)
7. **Supabase client auth options** — persistSession: false, autoRefreshToken: false

---

## API Endpoints — Complete List

### Public (no auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Live counts: markets, predictions, communities, predictors |
| GET | `/api/whale-watch` | Top 50 Polymarket whale positions |
| GET | `/api/whale-index` | Whale consensus portfolio — top picks |
| GET | `/api/signals` | Alpha signals: whale clusters, momentum, new entries, arbitrage |
| GET | `/api/crystal-ball` | AI-generated predictions |
| GET | `/api/screener` | 200+ markets with filters, whale enrichment |
| GET | `/api/screener/narratives` | Narrative intelligence — theme dominance % |
| GET | `/api/market-movers` | Biggest price changes in 24h |
| GET | `/api/odds/search?q=` | Cross-platform odds comparison |
| GET | `/api/markets/search?q=` | Search across Polymarket + Kalshi + sportsbooks |
| GET | `/api/fear-greed` | Fear & Greed index |
| GET | `/api/daily-briefing` | Whale briefing with headline, movers, picks |
| GET | `/api/content-stream` | Live insights for explore page |
| GET | `/api/trader/:address/profile` | Multi-platform trader profile |
| GET | `/api/market/:id/cohort-sentiment` | Smart money vs retail sentiment |
| GET | `/api/explore/smart-money-divergence` | Top markets where sharp disagrees with retail |
| GET | `/api/catalyst?q=` | News catalyst for a market question |
| GET | `/api/catalysts?markets=` | Batch news catalysts |
| GET | `/api/agent/performance` | Public signal performance stats |
| GET | `/api/agent/sharpness` | Rolling last-10-signal return |
| GET | `/api/community/:slug` | Community data + markets |
| GET | `/api/polymarket/positions/:address` | Polymarket wallet lookup |
| GET | `/api/health` | Server health + DB status |
| POST | `/api/auth/forgot-password` | Send password reset email |
| POST | `/api/auth/reset-password` | Set new password with token |
| POST | `/api/ai/market-analysis` | Claude-powered market analysis |
| POST | `/api/subscribe` | Email newsletter signup |

### Auth Required (JWT)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/creator/signup` | Create account |
| POST | `/api/creator/login` | Sign in |
| GET | `/api/creator/settings` | Get creator settings |
| PUT | `/api/creator/settings` | Update settings |
| POST | `/api/markets` | Create market |
| PUT | `/api/markets/:id` | Update/resolve market |
| POST | `/trade` | Place a bet |
| GET | `/api/user/wallets` | Get connected wallets |
| PUT | `/api/user/wallets` | Save wallet connections |
| GET | `/api/portfolio/:userId` | Unified cross-platform portfolio |
| GET | `/api/predictors/:userId/analytics` | P&L analytics, calibration, sharp score |
| GET | `/api/agent/config` | Get agent configuration |
| PUT | `/api/agent/config` | Save agent configuration |
| GET | `/api/agent/decisions` | Agent decision history |

### API Key Required (Pro/Premium)
All public endpoints above (except `/api/stats`) require an `Authorization: Bearer hfx_...` key for programmatic access. Rate limits: Pro = 60/min, Premium = 300/min.

### Admin (x-admin-secret header)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/creators` | All creators with stats |
| POST | `/api/admin/set-plan` | Set creator plan |
| GET | `/api/admin/users` | All users with activity |
| GET | `/api/admin/platform-stats` | Platform-wide metrics |
| POST | `/api/admin/gift-trial` | Gift Premium trial |
| POST | `/api/admin/transfer-creator` | Transfer creator ownership |
| POST | `/api/admin/reset-password` | Admin-triggered password reset |
| POST | `/api/admin/invite` | Send creator invite email |

---

## Database Schema (Railway Postgres)

### Core Tables
- **users** — id, email, password_hash, display_name, google_id, x_id, polymarket_address, kalshi_api_key, manifold_username
- **creator_settings** — id, creator_id, slug, display_name, plan, custom_points_name, primary_color, community_description, logo_url, api_key, password_reset_token, all community config
- **markets** — id, creator_id, tenant_slug, question, category, expiry_date, outcome, resolved_at, is_public, trader_count, volume, options (JSONB for multi-option)
- **positions** — id, user_id, market_id, side, amount, potential_payout, won, settled
- **community_balances** — id, user_id, creator_slug, market_id, balance, side, amount, streak

### Supporting Tables
- market_comments, creator_announcements, creator_invites, creator_referrals
- market_disputes, creator_follows, notifications, creator_wall
- seasons, creator_rewards, reward_unlocks, predictor_follows
- cached_positions, subscribers, prediction_log, market_snapshots
- narrative_snapshots, agent_configs, agent_decisions
- push_subscriptions, whale_follows, copy_bot_subscriptions, referral_history

---

## Environment Variables (Railway)

| Var | Purpose |
|-----|---------|
| DATABASE_URL | Railway Postgres connection string |
| SUPABASE_URL | Supabase project URL (storage only now) |
| SUPABASE_SERVICE_KEY | Supabase service key |
| JWT_SECRET | JWT signing secret |
| ANTHROPIC_API_KEY | Claude API for AI features |
| GOOGLE_CLIENT_ID | Google OAuth |
| GOOGLE_CLIENT_SECRET | Google OAuth |
| APP_URL | https://hyperflex.network |
| ADMIN_SECRET | Admin dashboard auth |
| ODDS_API_KEY | The Odds API for sportsbook data |
| NEWS_API_KEY | NewsAPI for market catalysts |
| SMTP_HOST | Email sending (e.g., smtp.resend.com) |
| SMTP_PORT | Email port |
| SMTP_USER | Email auth user |
| SMTP_PASS | Email auth password |
| SMTP_FROM | From address |
| STRIPE_SECRET_KEY | Stripe payments |
| STRIPE_WEBHOOK_SECRET | Stripe webhook verification |
| STRIPE_PRO_PRICE_ID | Stripe Pro plan price |
| STRIPE_PLATINUM_PRICE_ID | Stripe Premium plan price |

---

## What Makes HYPERFLEX Different

1. **Multi-platform aggregation** — nobody else combines Polymarket + Kalshi + Hyperliquid + sportsbooks in one view
2. **Whale tracking at scale** — $177M+ in tracked positions across top 50 traders
3. **Cohort intelligence** — smart money vs retail sentiment on every market (the feature HyperDash has for crypto, built for prediction markets)
4. **Narrative intelligence** — which themes dominate and how that's changing week over week
5. **Signal deduplication** — strips noise, surfaces the actual alpha
6. **Public track record** — every signal logged, every outcome tracked, fully transparent
7. **Community markets** — creators can launch branded prediction markets (play-money) for engagement and retention
8. **Intent-to-execution bridge** — from signal to Polymarket in one tap (execution layer coming with Privy)

---

## Key Metrics (as of March 23, 2026)

- 19 registered users (migrated to Railway, WallStreetBets community active)
- 237+ community markets (WallStreetBets)
- 200+ Polymarket markets in screener
- $177M+ whale capital tracked
- 50+ whale traders monitored
- 9 narrative themes tracked
- 30+ countries detected via region flags
- 5ms average DB query time (Railway Postgres)

---

## Competitive Landscape

| Competitor | What They Do | What We Do Better |
|-----------|-------------|-------------------|
| HyperDash | Hyperliquid whale tracking | We add Polymarket + cohort intelligence + community markets |
| Unusual Whales | Options flow for stocks | We do prediction markets, not equities |
| Arkham | On-chain analytics | We focus on prediction outcomes, not token flows |
| Nansen | Wallet labels + DeFi | We're prediction-market-specific with cross-platform odds |
| Polymarket.com | The exchange itself | We aggregate across exchanges + add intelligence layer |

---

## What's Next

1. **Privy embedded wallets** — one-click trade execution without leaving HYPERFLEX
2. **Polymarket CLOB integration** — direct order placement from signal pages
3. **Mobile app** — React Native wrapper around the existing responsive pages
4. **Creator monetization** — paid communities, premium markets, ad placements
5. **Data licensing** — sell whale flow data to institutional traders
6. **Live arbitrage alerts** — push notification when cross-platform edge appears
7. **Copy trading** — auto-mirror whale positions with one click

---

*This brief is the single source of truth for HYPERFLEX. Read it before every session.*
