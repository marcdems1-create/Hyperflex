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
| `public/win-card.html` | Shareable win card page at `/win-card.html?m=&u=` — includes acquisition CTA |
| `public/templates.html` | Market template gallery at `/templates` — 12 niches, 72 markets, SEO-friendly |
| `public/nominate.html` | "Nominate your creator" fan-facing page at `/nominate` |
| `server.js` | Express backend — all API routes, Claude scanner, settlement cron |
| `index.html` | ⚠️ OLD React trading app at project root — NOT served, ignore |
| `HYPERFLEX_Brief.md` | Full detailed brief — read this for deep context |
| `CLAUDE.md` | This file — auto-loaded session memory |

---

## Current State (last updated March 16, 2026 — session 7)

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

## Known Issues / Next Up

**Next highest-ROI builds:**
- One-click market share card for X/Twitter (drives member acquisition)
- "Send to community" weekly email digest button (creator → all members)
- YouTube scanner demo mode for free tier (show blurred suggestions → upgrade trigger)

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
19. `supabase_migration_email_unsubscribe.sql`
20. `supabase_migration_multi_option.sql`
21. `supabase_migration_discord_webhook.sql`
22. `supabase_migration_notifications.sql`
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
