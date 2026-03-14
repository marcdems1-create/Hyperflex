# HYPERFLEX — Claude Session Memory

> This file is auto-read by Claude at the start of every session. Keep it updated.
> Full details in HYPERFLEX_Brief.md. Read that too.

---

## What This Project Is

**HYPERFLEX** is a B2B SaaS platform where creators set up branded prediction markets for their communities. Play-money only (Flex Points). AI-powered market generation via YouTube scanner. Free / Pro ($29) / Premium ($99) tiers.

**Live:** https://hyperflex.network
**Railway:** auto-deploys from `git push origin main`
**Stack:** Node.js + Express + Supabase + Anthropic SDK. All frontend is plain HTML/CSS in `public/`.

---

## File Map (what's what)

| File | What it is |
|------|-----------|
| `public/index.html` | Creator marketing landing page (homepage) |
| `public/creator-signup.html` | Creator registration |
| `public/creator-login.html` | Creator login |
| `public/creator-dashboard.html` | Creator dashboard (markets, YouTube scanner, analytics, rewards) |
| `public/community.html` | Member-facing page at `/:slug` |
| `public/creator-terms.html` | Terms of Service |
| `public/admin.html` | Internal ops dashboard at `/admin` |
| `server.js` | Express backend — all API routes, Claude scanner, settlement cron |
| `index.html` | ⚠️ OLD React trading app at project root — NOT served, ignore |
| `HYPERFLEX_Brief.md` | Full detailed brief — read this for deep context |
| `CLAUDE.md` | This file — auto-loaded session memory |

---

## Current State (last updated March 13, 2026)

- All features live on Railway. Latest commit: `e06ecc2` (local, not yet pushed)
- **Stripe payments live** — Pro ($29/mo) + Premium ($99/mo) checkout + billing portal
  - Railway env vars needed: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_PLATINUM_PRICE_ID`
  - Webhook endpoint registered at: `https://hyperflex.network/stripe/webhook`
  - Webhook events: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.updated`
- **Admin dashboard** at `/admin` — password-gated, creator table, inline plan control
  - Railway env var needed: `ADMIN_SECRET`
- **OAuth**: Google fully working. X/Twitter works (name + username only — Twitter doesn't return email via API)
- **Premium rebrand**: "Platinum" renamed to "Premium" in all UI. DB value stays `'platinum'` — do NOT change DB value.
- **Watermark**: shown on Free + Pro, hidden on Premium only
- **Video section**: added to landing page — replace `VIDEO_ID` in `public/index.html` with real YouTube video ID when ready
- **creator_settings** is the canonical creator table (not `communities`)
- Stripe webhook updates `creator_settings.plan` on checkout + cancellation
- **Flex Points Gamification** (commit `43c70fd`):
  - Streak multipliers in settlement: 3 wins → 1.5×, 5+ wins → 2× payout
  - Streak badges on leaderboards: 🔥 (3+), ⚡ Streak Master (7+)
  - Weekly Power Predictor panel on creator dashboard (Pro/Premium gated)
  - Inner Circle panel on creator dashboard (Premium gated) — members with 2,000+ points
- **Per-Community Points Economy** (commit `c55f856`) — ⚠️ REQUIRES Supabase migration first:
  - `community_balances` table: per-user per-creator balance (centpoints: 100,000 = 1,000 pts)
  - `creator_settings` new columns: `starting_balance`, `min_bet`, `max_bet`, `refill_enabled`, `refill_amount`, `refill_cadence`, `activity_gate`
  - Balance helpers: `getCommunityBalance(userId, slug)`, `setCommunityBalance()`, `getCreatorSlugForMarket()`
  - Settlement (cron + manual) credits `community_balances`, not `users.balance`
  - `GET /api/user/community-balance/:slug` — auth'd endpoint for member balance
  - `GET /api/community/:slug` — now includes `starting_balance`, `min_bet`, `max_bet`
  - `PUT /api/creator/settings` — accepts all economy fields
  - Economy Settings panel on creator dashboard (Settings tab)
  - community.html: shows community balance, enforces min/max bet in UI
  - **CENTPOINTS**: all balances/bets stored as 100× pts. Always divide by 100 for display.
  - **Migration file**: `supabase_migration_community_economy.sql` — run in Supabase SQL editor

## To deploy: `git push origin main` (Claude cannot push — no internet from VM)

---

## Rules Claude Must Follow Every Session

1. **Read this file + HYPERFLEX_Brief.md + TODO.md at session start** before touching anything
2. **Update all three files at session end** — what was done, what's committed, what's next
3. **Never push** — user pushes from their terminal or Claude Code
4. **Always check git status** before assuming what's deployed vs local
5. **Font/color system:** Syne (display) + Space Mono (mono), gold `#c9920d`, paper `#141412`
6. **DB:** `creator_settings` is the main creator table (not `communities`)
7. **Plan values in DB:** `'free'`, `'pro'`, `'platinum'` — display as Free / Pro / Premium in UI

---

## Known Issues / Next Up

- **⚠️ MUST DO BEFORE DEPLOY**: Run ALL migrations in order in Supabase SQL editor:
  1. `supabase_migration_community_economy.sql`
  2. `supabase_migration_refill_history.sql`
  3. `supabase_migration_cpmm.sql`
  4. `supabase_migration_referrals.sql`
  5. `supabase_migration_custom_domains.sql`
  6. `supabase_migration_challenges.sql`
  7. `supabase_migration_plan_trial.sql` (adds plan_trial_expires_at)
  8. `supabase_migration_market_suggestions.sql` ← NEW (adds market_suggestions table + suggestions_enabled column)
- Video section on landing page needs real YouTube VIDEO_ID
- Old `index.html` at project root should be removed eventually
- **This session (March 13, continued)** — all committed, needs push (latest: `e06ecc2`):
  - Analytics crash fix: getWeekStart() double-definition → .toISOString() on string (commit `d25b17f`)
  - Delete account: case-insensitive + inline error in modal (commit `d25b17f`)
  - Landing page fresh markets: 4 viral diverse markets replacing finance-only (Sports/Culture/Crypto/Politics)
  - Refill slider fix: duplicate display style removed from refillFields div
  - Referral + reward preset cards now scale dynamically with starting balance
  - Challenge quick-start templates (Surge Week, Member Drive, Volume Push)
  - 🎁 Rewards tab: new dashboard tab with scaled suggested rewards + your rewards list (commit `a34384f`)
  - ?ref= landing page display fix (removed code tag)
  - Member market suggestion queue (commit `e06ecc2`):
    - `supabase_migration_market_suggestions.sql` — new table
    - community.html: 💡 Suggest a Market button + modal (gated by suggestions_enabled)
    - creator-dashboard.html: suggestion queue in Markets tab with approve/reject
    - creator-dashboard.html: approve pre-fills create market modal
    - creator-dashboard.html: 🧩 Community Features section in Settings with toggle
    - server.js: fix requireUser → getUserIdFromReq(), add suggestions_enabled to dashboard API
- **Economy Phase 3** (not built):
  - Streak broken toast when user loses after a streak

---

## The Ask

Marc is the founder. Claude is the CTO. Be proactive, stay in context, don't ask what we're building — you already know. Read the brief, check git status, and get to work.
