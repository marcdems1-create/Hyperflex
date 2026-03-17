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
| `public/admin.html` | Internal ops dashboard at `/admin` — includes ✉️ Outreach tab |
| `public/explore.html` | Global discover/explore page with Twitter-like activity feed |
| `public/profile.html` | Creator public profile at `/u/:slug` |
| `public/embed.html` | Embeddable widget at `/embed/:slug` (iframeable, themed) |
| `public/member.html` | Member public profile at `/m/:userId` |
| `public/win-card.html` | Shareable win card page at `/win-card.html?m=&u=` |
| `public/nominate.html` | "Nominate your creator" fan-facing page at `/nominate` |
| `server.js` | Express backend — all API routes, Claude scanner, settlement cron |
| `index.html` | ⚠️ OLD React trading app at project root — NOT served, ignore |
| `HYPERFLEX_Brief.md` | Full detailed brief — read this for deep context |
| `CLAUDE.md` | This file — auto-loaded session memory |

---

## Current State (last updated March 16, 2026 — session 4)

- All features committed locally. Latest commit pending — needs push
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

## This session (March 16, session 5) — committed `140755e`, pushed

- **Rewards tab fix**: `'rewards'` was missing from `showTab()` array — tab was permanently invisible. Fixed.
- **Reward unlocks in explore feed**: `reward_unlocks` table + `maybeLogRewardUnlocks()` in `setCommunityBalance` + `reward_unlock` card in explore.html. Migration: `supabase_migration_reward_unlocks.sql`
- **Market burst consolidation**: 2+ markets from same creator within 5 min → single `markets_burst` card in explore feed showing count + preview list.
- **A — Live stats bar**: Public `/api/stats` endpoint (5-min cache). Landing page shows live markets / predictions / communities below hero.
- **B — Admin outreach tool**: ✉️ Outreach tab in admin.html. Compose + send personalized invite emails to creators. `creator_invites` table tracks sent/accepted. Auto-marks accepted on creator signup.
- **C — Embeddable widget**: `/embed/:slug` + `/api/embed/:slug`. Lightweight iframeable widget showing top 3 markets, branded colors. Creator dashboard Settings tab has "Get Embed Code" section.
- **D — Creator referral**: `/ref/:slug` → redirects to `/creator/signup?ref=slug`. `creator_referrals` table. Share tab shows referral link + stats. Referrer gets credited on tracked signups.
- **E — Resolution disputes**: Members can file dispute within 24h of resolution via ⚠ Dispute button. `market_disputes` table. Creator reviews (uphold/overturn) in Resolution Queue tab. Email notification on dispute filed.
- **F — Cross-community follows**: `creator_follows` table + `/api/community/:slug/follow-social` toggle + `/api/user/following`. Follow button on community hero + creator profile page. Explore sidebar shows Following card.

**New migrations to run (in order after existing list):**
12. `supabase_migration_reward_unlocks.sql`
13. `supabase_migration_creator_invites.sql`
14. `supabase_migration_creator_referrals.sql`
15. `supabase_migration_market_disputes.sql`
16. `supabase_migration_creator_follows.sql`

---

## Known Issues / Next Up

- **Creator referral acceptance**: `accepted` on `creator_referrals` currently stays false — need to flip it to true when the referred creator publishes their first market (currently manual via admin or future automation)
- **Embed widget**: No auth in embed — members can't bet from inside the iframe. Intentional for now (links out to community page). Could add predict-in-iframe later.
- **Admin invite emails**: Require SMTP configured in Railway env vars — silently skips if not set (invite still logged to DB)
- **Remote URL**: Update git remote to `https://github.com/marcdems1-create/Hyperflex.git` (capital H) to stop redirect warnings

---

## ⚠️ MUST DO BEFORE DEPLOY — Run ALL migrations in order in Supabase SQL editor:
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

## The Ask

Marc is the founder. Claude is the CTO. Be proactive, stay in context, don't ask what we're building — you already know. Read the brief, check git status, and get to work.
