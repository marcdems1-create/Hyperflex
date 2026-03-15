# NEW CLAUDE — Full Handoff Document
# HYPERFLEX — Everything You Need To Know
# Last updated: March 14, 2026

---

## WHO YOU ARE

You are the CTO of HYPERFLEX. Marc is the founder. You are proactive, stay in context, and never ask what we're building — you already know. At the start of every session you read this file, CLAUDE.md, HYPERFLEX_Brief.md, and TODO.md before touching anything. You update all of them at session end.

---

## WHAT THIS PRODUCT IS

**HYPERFLEX** is a B2B SaaS platform where creators set up branded prediction markets for their communities. Play-money only (Flex Points — no real money). AI-powered market generation via YouTube scanner. Three tiers: Free / Pro ($29/mo) / Premium ($99/mo).

**Live site:** https://hyperflex.network
**Demo community:** https://hyperflex.network/wallstreetbets
**Railway:** auto-deploys from `git push origin main`
**Stack:** Node.js + Express + Supabase + Anthropic SDK. All frontend is plain HTML/CSS in `public/`. No React, no build step.

---

## CREDENTIALS & ACCOUNTS

- **Demo login (for all seeded communities):** `HyperflexDemo2026!`
- **Demo user emails:** `demo@hyperflex.network`, `tradermayne@hyperflex.network`, `coinbureau@hyperflex.network`, `andreijikh@hyperflex.network`, `meetkevin@hyperflex.network`, `grahamstephan@hyperflex.network`, `whiteboardfinance@hyperflex.network`
- **bcrypt hash for demo password:** `$2b$12$Uy14b4qs8nx/qK5/Ceudwe29q1htH5fG2hhze/IM4IYBKTsdvkxCy`

---

## FILE MAP

| File | What it is |
|------|-----------|
| `public/index.html` | Creator marketing landing page (B2B homepage) |
| `public/creator-signup.html` | Creator registration |
| `public/creator-login.html` | Creator login |
| `public/creator-dashboard.html` | Creator dashboard — markets, YouTube scanner, analytics, rewards, settings |
| `public/community.html` | Member-facing page at `/:slug` |
| `public/creator-terms.html` | Terms of Service |
| `public/admin.html` | Internal ops dashboard at `/admin` |
| `server.js` | Express backend — ALL API routes, Claude scanner, settlement cron, email |
| `CLAUDE.md` | Session memory — read every session |
| `HYPERFLEX_Brief.md` | Full product brief |
| `TODO.md` | Active task list |
| `NEW_CLAUDE.md` | This file — full handoff |
| `index.html` | ⚠️ OLD React trading app at project root — NOT served, ignore |
| `seeds/` | Supabase seed SQL files for demo communities |
| `supabase_ALL_MIGRATIONS.sql` | All 9 migrations in one paste block |
| `OUTREACH_TRACKER.html` | Creator outreach status + DM templates |
| `HYPERFLEX_Pitch_Kit.html` | Full cold outreach pitch kit |
| `WSB.html` | WSB-specific pitch |

---

## DESIGN SYSTEM (NEVER DEVIATE)

- **Fonts:** Syne (display/headings) + Space Mono (mono/body) — loaded from Google Fonts
- **Gold:** `#c9920d`
- **Background:** `#141412`
- **Cream/surface:** `#1c1c19`
- **Text:** `#ddd8cc`
- **No React, no Tailwind, no build step** — pure HTML/CSS/JS only

---

## DATABASE RULES

- **`creator_settings`** is the canonical creator table — NOT `communities`
- **Plan values in DB:** `'free'`, `'pro'`, `'platinum'` — display as Free / Pro / Premium in UI. NEVER change `'platinum'` to `'premium'` in DB.
- **Centpoints:** All balances and bets stored as 100× points. `100000 centpoints = 1,000 pts`. Always divide by 100 for display.
- **Community balances** live in `community_balances` table (per-user per-creator), NOT `users.balance`
- **PL/pgSQL:** Always use `v_` prefix for variables (e.g., `v_creator_id`) to avoid ambiguity with column names

---

## CURRENT STATE (March 14, 2026)

**Latest commit:** `9b00eab` — all pushed to Railway

### What's live:
- Full B2B creator platform — signup, login, dashboard, community page
- Stripe payments — Pro ($29/mo) + Premium ($99/mo) checkout + webhook + billing portal
- Admin dashboard at `/admin` (password-gated)
- Google + X/Twitter OAuth
- YouTube scanner — AI market generation from video content
- Flex Points gamification — streak multipliers (3→1.5×, 5+→2×), streak badges (🔥3+, ⚡7+)
- Weekly Power Predictor panel (Pro/Premium)
- Inner Circle panel — members with 2,000+ points (Premium only)
- Per-community points economy — `community_balances`, min/max bet, economy settings
- Analytics dashboard — trade activity chart, top markets, economy health, referrals
- Custom domain routing (CNAME + DNS verify, Premium only)
- Community challenges + shareable win cards
- Leaderboard: All Time / Monthly / Weekly + win rate % + accuracy tier badges
- Creator announcements — post/pin/delete from dashboard, rendered above market grid
- Market comments — inline expandable threads, lazy loaded, 280 char limit
- Resolution notes — creator adds context on resolve, shown in resolved banner
- Email notifications — `sendResolutionEmails()` fires on manual + cron resolution (opt-in via SMTP env vars)
- Member market suggestion queue
- Polymarket-style community page — 2-col card grid, featured hero card, big odds, category pills, hot badge
- Free tier: 5 active markets
- Mobile-responsive — all known issues fixed

### Railway env vars needed:
```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRO_PRICE_ID
STRIPE_PLATINUM_PRICE_ID
ADMIN_SECRET
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
ANTHROPIC_API_KEY
JWT_SECRET
SMTP_HOST (optional — enables email)
SMTP_PORT (optional, default 587)
SMTP_USER (optional)
SMTP_PASS (optional)
SMTP_FROM (optional)
```

---

## MIGRATIONS — MUST RUN IN ORDER IN SUPABASE

All 9 in one file: `supabase_ALL_MIGRATIONS.sql` (paste and run in Supabase SQL editor)

Or individually in this order:
1. `supabase_migration_community_economy.sql`
2. `supabase_migration_refill_history.sql`
3. `supabase_migration_cpmm.sql`
4. `supabase_migration_referrals.sql`
5. `supabase_migration_custom_domains.sql`
6. `supabase_migration_challenges.sql`
7. `supabase_migration_plan_trial.sql`
8. `supabase_migration_market_suggestions.sql`
9. `supabase_migration_announcements_comments.sql`

---

## SEEDED DEMO COMMUNITIES

All use password `HyperflexDemo2026!` and are on `platinum` plan.

| Creator | URL | Seed File | Status |
|---------|-----|-----------|--------|
| WallStreetBets | /wallstreetbets | `seed_demo_wallstreetbets.sql` | ✅ Live |
| TraderMayne | /tradermayne | `seeds/seed_tradermayne.sql` | ✅ Run |
| Coin Bureau | /coinbureau | `seeds/seed_coinbureau.sql` | Pending |
| Andrei Jikh | /andreijikh | `seeds/seed_andrei_jikh.sql` | Pending |
| Meet Kevin | /meetkevin | `seeds/seed_meet_kevin.sql` | Pending |
| Graham Stephan | /grahamstephan | `seeds/seed_graham_stephan.sql` | Pending |
| Whiteboard Finance | /whiteboardfinance | `seeds/seed_whiteboard_finance.sql` | Pending |

To run a seed: paste the entire file contents directly into the Supabase SQL editor and run. Do NOT copy from chat — open the file and copy from there, or use `cat seeds/seed_NAME.sql | pbcopy` in terminal.

---

## CREATOR OUTREACH CAMPAIGN

We are gifting free Premium accounts to finance/crypto YouTubers to seed the platform with real communities before charging. Strategy: build their community with markets tailored to their niche, DM them with the live link, no strings attached.

**DM template (X/Twitter):**
```
Hey [Name] — big fan of the content.

I built a platform called Hyperflex that lets creators like you run branded prediction markets for your community. Your audience debates price calls constantly — this gives them live odds, leaderboards, and skin in the game.

I set up a free Premium community for you at hyperflex.network/[slug] — fully loaded with [niche] markets your audience would bet on.

No cost, no commitment. Just wanted to show you what it could look like. Happy to chat if you're curious.
```

**Outreach status:** See `OUTREACH_TRACKER.html` for full tracker with copy-paste DMs.

---

## KEY TECHNICAL PATTERNS

### Authentication
- Creators: JWT in localStorage (`creator_token`), verified via `authenticateCreator` middleware
- Members: JWT in localStorage (`hf_token`), verified via `authenticateUser` middleware
- OAuth: Google (email returned), X/Twitter (name + username only — no email by design)

### CPMM Odds
- `yes_price = yes_pool / (yes_pool + no_pool)`
- All bets use constant product market maker

### Settlement
- Cron runs hourly via `node-cron`
- Manual resolve via `POST /api/creator/resolve/:marketId`
- Both fire `sendResolutionEmails()` after settlement
- Streak multipliers applied at settlement: 3 wins → 1.5×, 5+ wins → 2×

### Email (Nodemailer)
- `createMailTransport()` — returns null if `SMTP_HOST` not set (no-op, never crashes)
- `sendResolutionEmails(market, outcome, creatorSlug, resolutionNote)` — fire and forget
- Branded HTML email with outcome, resolution note, CTA back to community

### Per-community economy
- `getCommunityBalance(userId, slug)` — reads from `community_balances`
- `setCommunityBalance(userId, slug, amount)` — upserts
- `getCreatorSlugForMarket(marketId)` — joins markets → creator_settings

---

## API ENDPOINTS (key ones)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/creator/signup` | — | Creator registration |
| POST | `/api/creator/login` | — | Creator login |
| GET | `/api/creator/dashboard` | creator | Dashboard data |
| PUT | `/api/creator/settings` | creator | Update settings + economy |
| POST | `/api/creator/scan-youtube` | creator | YouTube AI scanner |
| POST | `/api/creator/resolve/:marketId` | creator | Resolve market |
| GET | `/api/community/:slug` | — | Community page data |
| GET | `/api/user/community-balance/:slug` | user | Member balance |
| POST | `/trade` | — | Place trade |
| GET | `/api/leaderboard` | — | Top 20 |
| GET | `/admin` | — | Admin dashboard (password gated) |
| POST | `/stripe/webhook` | — | Stripe events |
| GET | `/:slug` | — | Serves community.html |

---

## KNOWN ISSUES / NEXT UP

- [ ] Run remaining seed SQLs for pending communities (Coin Bureau, Andrei Jikh, Meet Kevin, Graham Stephan, Whiteboard Finance)
- [ ] DM all seeded creators — use templates in OUTREACH_TRACKER.html
- [ ] Landing page video section needs real YouTube VIDEO_ID in `public/index.html` (search for `VIDEO_ID`)
- [ ] Old `index.html` at project root should be deleted eventually
- [ ] Streak-broken toast when user loses after a streak (Economy Phase 3)
- [ ] WSB DM sent on X — waiting for reply
- [ ] 3-4 more creator seeds to reach 10 total (suggestions: Coffeezilla, Patrick Boyle, Watcher Guru, InvestAnswers)

---

## GIT HISTORY (recent)

```
9b00eab Creator outreach: 5 new Premium seeds + outreach tracker
93641fd Mobile audit fixes: overflow, word-break, announcement wrap, tablet breakpoint
ee3f8a5 Remove fake testimonials, add live demo CTA + WSB seed
8616871 Update package-lock.json for nodemailer
a6934f4 Update CLAUDE.md — session state March 13 final
81b5c65 Engagement features: announcements, comments, resolution notes, emails
2c9897e Community page UI overhaul — Polymarket-style cards
e06ecc2 Member market suggestion queue — full implementation
```

---

## SESSION RULES

1. Read `CLAUDE.md` + `HYPERFLEX_Brief.md` + `TODO.md` at session start before touching anything
2. Update all three files at session end — what was done, what's committed, what's next
3. **Never push** — Marc pushes from his terminal (`git push origin main`)
4. Always run `git status` before assuming what's deployed vs local
5. Font/color system: Syne + Space Mono, gold `#c9920d`, paper `#141412`
6. `creator_settings` is the main creator table — NOT `communities`
7. Plan values: `'free'`, `'pro'`, `'platinum'` in DB — display as Free / Pro / Premium
8. Centpoints: always divide by 100 for display
9. PL/pgSQL seeds: always use `v_` prefix for variables
10. When giving SQL to run in Supabase — paste the FULL SQL as a code block in chat, never refer to a file path
