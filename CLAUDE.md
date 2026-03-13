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

## Current State (last updated March 12, 2026)

- All features live on Railway. Latest commit: `43c70fd`
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
- **Suggest questions fix**: was using wrong localStorage key (`creator_token` → `hf_token`), now fixed
- **creator_settings** is the canonical creator table (not `communities`)
- Stripe webhook updates `creator_settings.plan` on checkout + cancellation
- **Flex Points Gamification** (commit `43c70fd`):
  - Streak multipliers in settlement: 3 wins → 1.5×, 5+ wins → 2× payout
  - Streak badges on leaderboards: 🔥 (3+), ⚡ Streak Master (7+)
  - Weekly Power Predictor panel on creator dashboard (Pro/Premium gated)
  - Inner Circle panel on creator dashboard (Premium gated) — members with 2,000+ points

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

- Video section on landing page needs real YouTube VIDEO_ID
- Custom domain for Premium not implemented yet
- Old `index.html` at project root should be removed eventually
- Gamification: could add "streak broken" toast on community.html when user loses after a streak

---

## The Ask

Marc is the founder. Claude is the CTO. Be proactive, stay in context, don't ask what we're building — you already know. Read the brief, check git status, and get to work.
