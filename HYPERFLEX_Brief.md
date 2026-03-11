# HYPERFLEX Project Brief — Updated March 11, 2026

> **RULE:** Claude must update this file at the END of every session with what was done, what's committed, and what's next. No exceptions.

---

## 1. Project Status

**LIVE:** https://hyperflex-production-4294.up.railway.app
**Repo:** Railway auto-deploys from `main` branch on push.

---

## 2. What This Product Is (The Pivot)

HYPERFLEX has pivoted from a **consumer prediction market** (competing with Polymarket) to a **B2B SaaS tool for creators**. Creators sign up, get a branded community page at `/their-slug`, and their audience predicts on markets the creator builds (often via YouTube AI scanner). No real money — play-money Flex Points only. Monetized via Free/Pro ($29/mo)/Platinum ($99/mo) tiers.

---

## 3. Full File Map

| File | Purpose |
|------|---------|
| `server.js` | Express backend, all API routes, Claude scanner, settlement cron |
| `public/index.html` | **Creator marketing landing page** (homepage, B2B SaaS pitch) |
| `public/creator-signup.html` | Creator registration (name, slug, points name, color, etc.) |
| `public/creator-login.html` | Creator login |
| `public/creator-dashboard.html` | Creator dashboard — markets, analytics, YouTube scanner, rewards, settings |
| `public/community.html` | Member-facing community page at `/:slug` |
| `public/creator-terms.html` | Creator Terms of Service |
| `index.html` | ⚠️ OLD consumer trading app (React/Web3Modal) — kept at root, NOT served |
| `hyperflex-deploy/` | Solidity contracts (HyperFlexMarket, Factory, Router) — separate Foundry project, mostly dormant |

---

## 4. Tech Stack

| Package | Version | Use |
|---------|---------|-----|
| `@anthropic-ai/sdk` | ^0.78.0 | YouTube scanner + market generation + AI resolution |
| `@supabase/supabase-js` | ^2.99.0 | Database (users, markets, positions, communities, rewards) |
| `bcryptjs` | ^3.0.3 | Password hashing |
| `cors` | ^2.8.6 | CORS middleware |
| `dotenv` | ^17.3.1 | Env vars |
| `express` | ^5.2.1 | HTTP server |
| `jsonwebtoken` | ^9.0.3 | Creator auth tokens |
| `node-cron` | ^4.2.1 | Hourly settlement cron |

**Runtime:** Node.js >= 20
**Fonts:** Syne (display) + Space Mono (mono) — used across all pages
**Colors:** `--gold: #c9920d`, `--paper: #141412`, `--cream: #1c1c19`, `--text: #ddd8cc`

---

## 5. All API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | — | Legacy user signup |
| POST | `/login` | — | Legacy user login |
| GET | `/markets` | — | All open markets |
| GET | `/markets/:id` | — | Single market |
| POST | `/markets` | creator | Create market |
| PUT | `/markets/:id` | creator | Edit market |
| DELETE | `/markets/:id` | creator | Delete market |
| POST | `/trade` | — | Place trade (user_id, market_id, side, amount) |
| GET | `/positions/:user_id` | — | User positions |
| GET | `/api/leaderboard` | — | Top 20 by PnL |
| GET | `/api/prices` | — | Live commodity prices |
| POST | `/api/scan-markets` | — | Manual Claude scanner trigger |
| POST | `/api/creator/resolve/:marketId` | creator | Resolve a market |
| GET | `/api/creator/:slug/theme` | — | Community theme/branding |
| GET | `/api/templates/:id` | — | Market templates |
| GET | `/api/creator/check-slug` | — | Slug availability |
| POST | `/api/creator/signup` | — | Creator registration |
| POST | `/api/creator/login` | — | Creator login |
| GET | `/api/creator/dashboard` | creator | Dashboard data (markets, stats, leaderboard, rewards) |
| PUT | `/api/creator/settings` | creator | Update community settings |
| POST | `/api/creator/validate-question` | creator | AI question quality check |
| GET | `/api/creator/:slug/rewards` | — | Community reward tiers |
| POST | `/api/creator/rewards` | creator | Create reward tier |
| PUT | `/api/creator/rewards/:id` | creator | Edit reward tier |
| DELETE | `/api/creator/rewards/:id` | creator | Delete reward tier |
| POST | `/api/creator/markets/:id/suggest-resolution` | creator | AI resolution suggestion |
| POST | `/markets/:id/resolve` | creator | Resolve market (outcome true/false) |
| POST | `/api/suggest-markets` | — | AI market suggestions |
| POST | `/api/creator/scan-youtube` | creator | YouTube video scanner |
| GET | `/api/community/:slug` | — | Community page data |
| POST | `/api/creator/waitlist` | creator | Pro/Platinum waitlist signup |
| GET | `/creator/signup` | — | Serves creator-signup.html |
| GET | `/creator/login` | — | Serves creator-login.html |
| GET | `/creator/dashboard` | — | Serves creator-dashboard.html |
| GET | `/creator/terms` | — | Serves creator-terms.html |
| GET | `/:slug` | — | Serves community.html (wildcard) |

---

## 6. Database Schema (Supabase)

**users** — `id`, `email`, `password_hash`, `display_name`, `balance`

**communities** — `id`, `slug`, `creator_id`, `name`, `points_name`, `primary_color`, `description`, `plan` (free/pro/platinum)

**markets** — `id`, `question`, `commodity`, `category`, `resolution_date`, `target_price`, `direction`, `expiry_date`, `resolved`, `settlement_price`, `outcome`, `yes_price`, `no_price`, `creator_slug`, `volume`, `trader_count`

**positions** — `id`, `user_id`, `market_id`, `side`, `amount`, `potential_payout`, `settled`, `won`

**rewards** — `id`, `creator_slug`, `name`, `description`, `points_required`, `is_active`

**pro_waitlist** — `id`, `creator_id`, `email`, `tier`, `created_at`

---

## 7. Environment Variables

- `SUPABASE_URL` — required
- `SUPABASE_ANON_KEY` — required (falls back from SERVICE_KEY)
- `SUPABASE_SERVICE_KEY` — optional, preferred
- `ANTHROPIC_API_KEY` — Claude scanner; no-ops if missing
- `JWT_SECRET` — defaults to `'hyperflex_secret'`
- `PORT` — Railway sets this; defaults to 3000

---

## 8. Pricing Tiers

| Tier | Price | Key features |
|------|-------|-------------|
| Free | $0 | 3 active markets, leaderboard, basic analytics, Flex Points |
| Pro | $29/mo | Unlimited markets, full analytics, YouTube scanner, AI gen, rewards, custom branding, "Built with HYPERFLEX" footer note |
| Platinum | $99/mo | Everything in Pro + white-label (no watermark), custom domain, dedicated support, SLA, onboarding call |

**Current state:** All creators are on Free tier. Pro/Platinum on waitlist (`pro_waitlist` table). Upgrade modal in dashboard captures email + tier.

---

## 9. Session History

### March 11, 2026 — Session 2 (this session)
- **Committed:** `public/index.html` rewritten as creator B2B landing page (was cut off last session, committed now — commit `febf3c5`)
- **Committed:** Updated `HYPERFLEX_Brief.md` (this file) to be current

### March 11, 2026 — Session 1 (cut off mid-session)
- Rewrote `public/index.html` from old consumer trading UI to creator marketing landing page
- Sections: Hero, Marquee, How it Works, Features, Demo mockup, Pricing (Free/Pro/Platinum), Testimonials, CTA, Footer
- Session hit usage limit before commit

### March 11, 2026 — Session 0 (last committed session)
- Commit `f34ae8e`: Platinum tier added to pricing modal in creator dashboard
- Pro/Platinum pricing: 3-column modal (Free / Pro $29 / Platinum $99)
- Community watermark redesigned: HYPERFLEX hex logo + tagline + CTA pill
- `pro_waitlist` table integration for upgrade flow

### March 9–10, 2026 — Earlier sessions
- Full B2B pivot: creator signup, dashboard, community page, Flex Points, rewards
- YouTube scanner (comments + transcript + live chat modes)
- AI market generation, AI resolution suggestions, AI question validation
- Railway deployment, Supabase integration, Node 20 pin

---

## 10. Known Issues / Next Up

- **Leaderboard:** Weekly/monthly tabs in community UI not wired to API (only all-time works)
- **Trade pricing:** Scanner-created markets may not have `yes_price`/`no_price` set — defaults may be needed
- **Settlement:** `fetchCurrentPrice()` commodity mapping is rough; scanner categories (crypto, commodities, macro) may not map cleanly to a specific settlement price source
- **Debug logs:** `[scanAndCreateMarkets] inserting` and `[markets fetch] raw response` still in production — noisy
- **Custom domain:** Platinum tier promises custom domain support — not implemented yet
- **`/index.html` at root:** Old React trading app still sitting at project root; should eventually be removed or repurposed

---

## 11. Dev Workflow

1. Edit files directly in the `~/hyperflex` folder
2. Commit + push → Railway auto-deploys
3. **Claude must update this brief at the END of every session**
