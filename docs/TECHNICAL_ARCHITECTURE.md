# HYPERFLEX — Technical Architecture: Social Prediction Network

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                  │
│  Web App    Mobile (PWA)    Chrome Extension    Telegram Bot    │
└──────┬──────────┬───────────────┬──────────────────┬────────────┘
       │          │               │                  │
       ▼          ▼               ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API GATEWAY (Express)                       │
│  Auth · Rate Limiting · CORS · Request Routing                  │
└──────┬──────────┬───────────────┬──────────────────┬────────────┘
       │          │               │                  │
       ▼          ▼               ▼                  ▼
┌───────────┐ ┌──────────┐ ┌───────────┐ ┌────────────────────┐
│  Social   │ │ Trading  │ │  Alpha    │ │  Notifications     │
│  Service  │ │  Service │ │  Engine   │ │  Service           │
│           │ │          │ │           │ │                    │
│ Profiles  │ │ CLOB     │ │ Signals   │ │ Push / Email       │
│ Follows   │ │ Orders   │ │ Whale     │ │ Telegram           │
│ Feed      │ │ Portfolio │ │ Edge      │ │ In-app             │
│ Predict.  │ │ P&L      │ │ Screener  │ │                    │
│ Comments  │ │ History  │ │           │ │                    │
│ Groups    │ │          │ │           │ │                    │
└─────┬─────┘ └────┬─────┘ └─────┬─────┘ └──────┬─────────────┘
      │            │             │               │
      ▼            ▼             ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA LAYER                                  │
│                                                                 │
│  Supabase (PostgreSQL)          Redis (Cache + Realtime)        │
│  ├─ users                       ├─ Feed cache                   │
│  ├─ profiles                    ├─ Leaderboard cache            │
│  ├─ predictions                 ├─ Online presence              │
│  ├─ follows                     ├─ Rate limiting                │
│  ├─ comments                    └─ Session store                │
│  ├─ groups                                                      │
│  ├─ reactions                   Polymarket CLOB (External)      │
│  ├─ leaderboard_snapshots       ├─ Order execution              │
│  ├─ notification_queue          ├─ Market data                  │
│  └─ trade_history               └─ Builder attribution          │
│                                                                 │
│                        Kalshi API (External)                    │
│                        ├─ Markets + Orderbook                   │
│                        └─ Portfolio sync                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Core Tables (Supabase / PostgreSQL)

```sql
-- ═══════════════════════════════════════════
-- SOCIAL IDENTITY
-- ═══════════════════════════════════════════

-- User profile (extends existing auth.users)
CREATE TABLE profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id),
  username        TEXT UNIQUE NOT NULL,          -- @handle
  display_name    TEXT,
  bio             TEXT,
  avatar_url      TEXT,
  banner_url      TEXT,
  
  -- Verified wallet addresses (prove P&L is real)
  poly_address    TEXT,                          -- Polymarket wallet
  kalshi_id       TEXT,                          -- Kalshi user ID
  wallets_verified BOOLEAN DEFAULT FALSE,       -- on-chain verification done
  
  -- Computed stats (updated by cron/trigger)
  total_pnl       DECIMAL(12,2) DEFAULT 0,      -- all-time P&L in USD
  win_rate        DECIMAL(5,4) DEFAULT 0,        -- 0.0000 - 1.0000
  brier_score     DECIMAL(5,4),                  -- prediction accuracy
  total_volume    DECIMAL(14,2) DEFAULT 0,       -- lifetime volume traded
  prediction_count INTEGER DEFAULT 0,
  follower_count  INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  
  -- Badges (computed, stored as array for fast reads)
  badges          JSONB DEFAULT '[]',            -- ["whale","top1_crypto","verified"]
  
  -- Settings
  is_public       BOOLEAN DEFAULT TRUE,
  allow_copy_trade BOOLEAN DEFAULT FALSE,
  
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_username ON profiles(username);
CREATE INDEX idx_profiles_pnl ON profiles(total_pnl DESC);
CREATE INDEX idx_profiles_poly ON profiles(poly_address) WHERE poly_address IS NOT NULL;


-- ═══════════════════════════════════════════
-- SOCIAL GRAPH
-- ═══════════════════════════════════════════

CREATE TABLE follows (
  follower_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  following_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX idx_follows_following ON follows(following_id);
-- "Who follows X" = WHERE following_id = X
-- "Who does X follow" = WHERE follower_id = X


-- ═══════════════════════════════════════════
-- PREDICTIONS (Core content unit)
-- ═══════════════════════════════════════════

CREATE TABLE predictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- What market
  platform        TEXT NOT NULL,                 -- 'polymarket' | 'kalshi'
  market_slug     TEXT NOT NULL,                 -- polymarket slug or kalshi ticker
  condition_id    TEXT,                          -- polymarket condition_id
  market_title    TEXT NOT NULL,                 -- denormalized for display
  
  -- The prediction
  side            TEXT NOT NULL,                 -- 'YES' | 'NO'
  entry_price     DECIMAL(6,4) NOT NULL,         -- price when prediction posted
  amount_usd      DECIMAL(10,2),                 -- size of position (optional, can be hidden)
  show_size       BOOLEAN DEFAULT FALSE,         -- user choice to show position size
  
  -- The thesis (why)
  thesis          TEXT,                           -- markdown text, max 2000 chars
  
  -- Verification
  tx_hash         TEXT,                           -- on-chain proof of trade (optional)
  verified        BOOLEAN DEFAULT FALSE,         -- position confirmed on-chain
  
  -- Resolution
  status          TEXT DEFAULT 'active',          -- 'active' | 'closed' | 'resolved_win' | 'resolved_loss'
  exit_price      DECIMAL(6,4),                  -- price when closed/resolved
  pnl             DECIMAL(10,2),                 -- profit/loss in USD
  resolved_at     TIMESTAMPTZ,
  
  -- Engagement
  comment_count   INTEGER DEFAULT 0,
  reaction_count  INTEGER DEFAULT 0,
  share_count     INTEGER DEFAULT 0,
  
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_predictions_author ON predictions(author_id, created_at DESC);
CREATE INDEX idx_predictions_market ON predictions(market_slug, created_at DESC);
CREATE INDEX idx_predictions_status ON predictions(status) WHERE status = 'active';
CREATE INDEX idx_predictions_hot ON predictions(reaction_count DESC, created_at DESC);


-- ═══════════════════════════════════════════
-- COMMENTS / DISCUSSION
-- ═══════════════════════════════════════════

CREATE TABLE comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Polymorphic parent: comment on a prediction OR a market
  prediction_id   UUID REFERENCES predictions(id) ON DELETE CASCADE,
  market_slug     TEXT,                          -- for market-level discussion
  parent_id       UUID REFERENCES comments(id) ON DELETE CASCADE,  -- threaded replies
  
  body            TEXT NOT NULL,                  -- markdown, max 1000 chars
  
  reaction_count  INTEGER DEFAULT 0,
  
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  
  CHECK (prediction_id IS NOT NULL OR market_slug IS NOT NULL)
);

CREATE INDEX idx_comments_prediction ON comments(prediction_id, created_at)
  WHERE prediction_id IS NOT NULL;
CREATE INDEX idx_comments_market ON comments(market_slug, created_at)
  WHERE market_slug IS NOT NULL;
CREATE INDEX idx_comments_parent ON comments(parent_id);


-- ═══════════════════════════════════════════
-- REACTIONS (likes / agrees / disagrees)
-- ═══════════════════════════════════════════

CREATE TABLE reactions (
  user_id         UUID REFERENCES profiles(id) ON DELETE CASCADE,
  target_type     TEXT NOT NULL,                  -- 'prediction' | 'comment'
  target_id       UUID NOT NULL,
  reaction_type   TEXT NOT NULL DEFAULT 'like',   -- 'like' | 'agree' | 'disagree' | 'fire'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE INDEX idx_reactions_target ON reactions(target_type, target_id);


-- ═══════════════════════════════════════════
-- GROUPS
-- ═══════════════════════════════════════════

CREATE TABLE groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  description     TEXT,
  avatar_url      TEXT,
  
  is_public       BOOLEAN DEFAULT TRUE,
  is_paid         BOOLEAN DEFAULT FALSE,
  price_monthly   DECIMAL(8,2),                  -- if paid group
  
  member_count    INTEGER DEFAULT 0,
  prediction_count INTEGER DEFAULT 0,
  
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE group_members (
  group_id        UUID REFERENCES groups(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role            TEXT DEFAULT 'member',          -- 'owner' | 'admin' | 'member'
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members(user_id);


-- ═══════════════════════════════════════════
-- FEED (Materialized for fast reads)
-- ═══════════════════════════════════════════

CREATE TABLE feed_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES profiles(id) ON DELETE CASCADE,  -- who sees this
  
  actor_id        UUID REFERENCES profiles(id),  -- who did the action
  action          TEXT NOT NULL,                  -- 'prediction' | 'comment' | 'follow' | 'trade' | 'signal'
  
  -- Reference to the content
  prediction_id   UUID REFERENCES predictions(id) ON DELETE CASCADE,
  comment_id      UUID REFERENCES comments(id) ON DELETE CASCADE,
  market_slug     TEXT,
  
  -- Denormalized for fast rendering (no JOINs)
  preview_json    JSONB,                         -- { title, thesis_excerpt, side, price, author_name, avatar }
  
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Feed query: SELECT * FROM feed_items WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50
CREATE INDEX idx_feed_user_time ON feed_items(user_id, created_at DESC);

-- Cleanup: keep 30 days of feed items
-- Cron: DELETE FROM feed_items WHERE created_at < NOW() - INTERVAL '30 days';


-- ═══════════════════════════════════════════
-- LEADERBOARDS (Snapshot-based)
-- ═══════════════════════════════════════════

CREATE TABLE leaderboard_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period          TEXT NOT NULL,                  -- 'weekly' | 'monthly' | 'alltime'
  category        TEXT NOT NULL,                  -- 'overall' | 'crypto' | 'politics' | 'sports'
  period_start    DATE NOT NULL,
  
  rankings        JSONB NOT NULL,                -- [{user_id, username, avatar, pnl, win_rate, predictions, rank}]
  
  computed_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(period, category, period_start)
);


-- ═══════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════

CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES profiles(id) ON DELETE CASCADE,
  
  type            TEXT NOT NULL,                  -- 'follow' | 'reaction' | 'comment' | 'prediction_resolved' | 'leaderboard' | 'whale_alert'
  actor_id        UUID REFERENCES profiles(id),
  
  -- Reference
  prediction_id   UUID,
  comment_id      UUID,
  market_slug     TEXT,
  
  body            TEXT,                           -- rendered notification text
  read            BOOLEAN DEFAULT FALSE,
  
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);
```

---

## API Design

### Social Endpoints

```
# ── Profiles ──
GET    /api/profile/:username              → Public profile + stats
PUT    /api/profile                         → Update own profile (auth required)
POST   /api/profile/verify-wallet           → Verify wallet ownership (sign message)
GET    /api/profile/:username/predictions   → User's prediction history
GET    /api/profile/:username/stats         → Detailed stats (P&L chart, accuracy by category)

# ── Follow ──
POST   /api/follow/:userId                  → Follow a user
DELETE /api/follow/:userId                  → Unfollow
GET    /api/profile/:username/followers     → Follower list (paginated)
GET    /api/profile/:username/following     → Following list (paginated)

# ── Predictions ──
POST   /api/predictions                     → Create prediction (with optional trade)
GET    /api/predictions/:id                 → Single prediction with comments
PUT    /api/predictions/:id                 → Update thesis / close position
DELETE /api/predictions/:id                 → Delete (only if no engagement)
GET    /api/predictions/market/:slug        → All predictions on a market

# ── Feed ──
GET    /api/feed                            → Personalized feed (auth required)
GET    /api/feed/trending                   → Trending predictions (public)
GET    /api/feed/latest                     → Chronological public feed
GET    /api/feed/market/:slug               → Market-specific feed

# ── Comments ──
POST   /api/comments                        → Post comment (on prediction or market)
GET    /api/comments/prediction/:id         → Comments on a prediction
GET    /api/comments/market/:slug           → Market discussion thread
DELETE /api/comments/:id                    → Delete own comment

# ── Reactions ──
POST   /api/reactions                       → React to prediction/comment
DELETE /api/reactions/:targetType/:targetId → Remove reaction

# ── Leaderboards ──
GET    /api/leaderboard/:period/:category   → Weekly/monthly/alltime rankings
GET    /api/leaderboard/badges/:username    → User's badges

# ── Groups ──
POST   /api/groups                          → Create group
GET    /api/groups/:slug                    → Group page
POST   /api/groups/:slug/join               → Join group
GET    /api/groups/:slug/predictions        → Group prediction feed
POST   /api/groups/:slug/predictions        → Post prediction to group

# ── Notifications ──
GET    /api/notifications                   → User's notifications (paginated)
PUT    /api/notifications/read              → Mark as read
GET    /api/notifications/unread-count      → Badge count

# ── Search ──
GET    /api/search?q=                       → Search users, predictions, markets
```

### Feed Generation Logic

```
When user U posts a prediction:
  1. INSERT into predictions
  2. For each follower F of U:
     INSERT into feed_items (user_id=F, actor_id=U, action='prediction', ...)
  3. INSERT into feed_items for the market feed (market_slug)
  4. If whale-sized ($10K+):
     INSERT into feed_items for ALL users following that market category
  5. Fire notification to followers with notifications enabled

When market resolves:
  1. UPDATE all active predictions on that market
  2. Compute P&L for each prediction
  3. UPDATE author profile stats (pnl, win_rate, brier_score)
  4. Fire notifications to authors
  5. Recompute affected leaderboards
```

---

## Real-time Architecture

```
Supabase Realtime (WebSocket)
├─ Channel: feed:{userId}
│  └─ New feed items pushed in real-time
├─ Channel: market:{slug}
│  └─ New predictions, comments, price changes
├─ Channel: notifications:{userId}
│  └─ New notification badge updates
└─ Channel: leaderboard:{period}:{category}
   └─ Live rank changes during active periods
```

For the initial build, Supabase Realtime handles all WebSocket needs. If we outgrow it (>10K concurrent connections), migrate to a dedicated Socket.IO or Ably layer.

---

## Wallet Verification Flow

To prevent fake P&L claims, wallet ownership must be cryptographically verified:

```
1. User connects wallet (MetaMask / WalletConnect)
2. Frontend requests a challenge: GET /api/profile/verify-challenge
   → Server returns: { message: "HYPERFLEX verify wallet 0x... at 1710000000", nonce: "abc123" }
3. User signs the message with their private key (MetaMask popup)
4. Frontend sends: POST /api/profile/verify-wallet { signature, nonce }
5. Server:
   a. Recovers signer address from signature using ethers.verifyMessage()
   b. Confirms it matches the claimed address
   c. Sets wallets_verified = true on profile
   d. Fetches historical positions from Polymarket CLOB for that address
   e. Backfills prediction history and computes initial P&L stats
6. Profile now shows "Verified" badge with real on-chain P&L
```

---

## Prediction Lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  CREATE   │────▶│  ACTIVE  │────▶│    CLOSED     │     │   RESOLVED   │
│           │     │          │     │  (user exit)  │     │  (market     │
│ User posts│     │ Visible  │     │  P&L locked   │     │   settles)   │
│ prediction│     │ in feed  │     │               │     │  P&L final   │
└──────────┘     └──────────┘     └──────────────┘     └──────────────┘
                       │                                       │
                       │          Market resolves               │
                       └──────────────────────────────────────▶┘
                       
On resolution:
  - pnl = (exit_price - entry_price) * amount / entry_price
  - status → 'resolved_win' or 'resolved_loss'
  - Profile stats recomputed
  - Leaderboard updated
  - Notification sent
```

---

## Build Phases

### Phase 1: Social Foundation (Weeks 1-4)

**Goal:** Users can create profiles, follow each other, post predictions, and browse a feed.

| Task | Priority | Effort | Dependencies |
|---|---|---|---|
| Profiles table + API (CRUD) | P0 | 3 days | Existing auth system |
| Username registration flow | P0 | 1 day | Profiles |
| Follow/unfollow API | P0 | 2 days | Profiles |
| Predictions table + API | P0 | 4 days | Profiles |
| Basic feed (chronological) | P0 | 3 days | Predictions, Follows |
| Profile page UI | P0 | 3 days | Profile API |
| Prediction card component | P0 | 2 days | Predictions API |
| Feed page UI | P0 | 3 days | Feed API |
| Post prediction UI (tied to trade) | P0 | 3 days | Predictions API |
| Wallet verification | P1 | 3 days | ethers.js |
| **Total** | | **~4 weeks** | |

**Deliverable:** A working social feed where users post predictions linked to real markets. Every prediction is a piece of content in the feed.

### Phase 2: Engagement & Discussion (Weeks 5-8)

**Goal:** Markets become discussion hubs. Predictions get reactions and comments. Notifications keep users coming back.

| Task | Priority | Effort | Dependencies |
|---|---|---|---|
| Comments API + UI (threaded) | P0 | 4 days | Predictions |
| Reactions API + UI | P0 | 2 days | Predictions, Comments |
| Market discussion page | P0 | 3 days | Comments |
| Notification system (in-app) | P0 | 4 days | Follow, Comments, Reactions |
| Share prediction (Twitter card) | P1 | 2 days | Predictions |
| Trending feed algorithm | P1 | 3 days | Reactions, Feed |
| Search (users + markets) | P1 | 3 days | Full-text search |
| **Total** | | **~3 weeks** | |

**Deliverable:** Markets have discussion threads. Users get notified when someone reacts to or comments on their predictions. Share buttons generate Twitter cards for viral distribution.

### Phase 3: Reputation & Leaderboards (Weeks 9-12)

**Goal:** Prediction accuracy is tracked and ranked. Top predictors gain status. Trust is verifiable.

| Task | Priority | Effort | Dependencies |
|---|---|---|---|
| P&L computation engine | P0 | 4 days | Predictions, CLOB data |
| Win rate / Brier score calculator | P0 | 3 days | Resolved predictions |
| Leaderboard snapshot cron | P0 | 2 days | Stats engine |
| Leaderboard UI (weekly/monthly/alltime) | P0 | 3 days | Leaderboard API |
| Badge system (whale, top1%, etc.) | P1 | 2 days | Stats |
| Historical P&L backfill for verified wallets | P1 | 3 days | Wallet verification |
| Profile stats page (charts, breakdown) | P1 | 3 days | Stats engine |
| **Total** | | **~3 weeks** | |

**Deliverable:** Leaderboards show the best predictors by category. Profiles display verified track records. Badges signal expertise and volume.

### Phase 4: Monetization & Groups (Weeks 13-18)

**Goal:** Revenue flows. Creators can monetize. Premium features justify subscriptions.

| Task | Priority | Effort | Dependencies |
|---|---|---|---|
| Stripe integration (Pro/Alpha tiers) | P0 | 4 days | — |
| Subscription gating middleware | P0 | 2 days | Stripe |
| Pro features: unlimited predictions, alerts | P0 | 3 days | Subscriptions |
| Alpha features: API access, copy-trading | P1 | 5 days | Subscriptions |
| Groups (create, join, post) | P1 | 5 days | Social foundation |
| Paid groups (Stripe Connect for creators) | P2 | 4 days | Groups, Stripe |
| Telegram bot (free/paid tiers) | P1 | 5 days | Signal engine |
| Email digest (weekly top predictions) | P2 | 2 days | Feed |
| **Total** | | **~5 weeks** | |

**Deliverable:** Users can subscribe to Pro/Alpha. Creators can create paid groups. Revenue is flowing.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Backend | Node.js / Express (existing) | Already built, extend with new routes |
| Database | Supabase (PostgreSQL) | Already integrated, RLS, Realtime built-in |
| Cache | Supabase or Upstash Redis | Feed cache, leaderboards, rate limiting |
| Auth | Existing JWT + wallet signing | Extend with wallet verification |
| Hosting | Railway (existing) | Auto-deploy on push |
| CDN | Cloudflare | Already using for trade proxy |
| Payments | Stripe + Stripe Connect | Subscriptions + creator payouts |
| Real-time | Supabase Realtime | WebSocket channels for feed/notifications |
| Image storage | Supabase Storage or Cloudflare R2 | Avatars, banners |
| Email | Resend or Postmark | Notifications, digests, onboarding |
| Telegram | node-telegram-bot-api | Signal bot delivery |

---

## Security Considerations

| Concern | Mitigation |
|---|---|
| Fake P&L | Wallet verification + on-chain position proof |
| Spam predictions | Rate limiting (free: 3/day, Pro: unlimited) |
| Harassment | Report system, content moderation, block users |
| Data scraping | Rate limiting on public APIs, API keys for bulk access |
| Wallet security | Never store private keys; signature-only verification |
| Content manipulation | Predictions immutable once posted (can close, not edit side/price) |

---

## Migration Path from Current Architecture

HYPERFLEX today is a monolithic Express app with HTML pages. The social layer builds on top without requiring a rewrite:

```
Current:
  server.js (Express) → public/*.html (vanilla JS)
  Supabase (users, creators, rewards)

After social layer:
  server.js (Express)
  ├─ Existing routes (unchanged)
  │   ├─ /api/polymarket/* (trading)
  │   ├─ /api/alpha/* (signals)
  │   ├─ /api/admin/* (admin panel)
  │   └─ /api/screener/* (market data)
  │
  └─ New social routes (added)
      ├─ /api/profile/* 
      ├─ /api/predictions/*
      ├─ /api/feed/*
      ├─ /api/comments/*
      ├─ /api/leaderboard/*
      ├─ /api/groups/*
      └─ /api/notifications/*

  public/
  ├─ Existing pages (unchanged)
  │   ├─ market.html
  │   ├─ creator-dashboard.html
  │   ├─ alpha-live.html
  │   └─ screener.html
  │
  └─ New social pages (added)
      ├─ social-feed.html        ← Main feed
      ├─ profile.html            ← User profile (public)
      ├─ predict.html            ← Post prediction flow
      ├─ market-discuss.html     ← Market discussion thread
      ├─ leaderboard.html        ← Rankings
      └─ groups.html             ← Group pages
```

No migration needed. The social layer is additive. Existing functionality continues working. Trading, signals, and portfolio management remain as-is — the social layer wraps around them and gives them distribution.

---

## Key Architectural Decisions

### 1. Fan-out on write (not read) for feeds
When a user posts a prediction, we insert a `feed_item` row for EACH of their followers. This is expensive on write but makes reads trivial: `SELECT * FROM feed_items WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`. At <100K users, Supabase handles this fine. If we hit millions, migrate to a dedicated feed service (Stream, Algolia).

### 2. Denormalized preview_json on feed items
Each feed_item carries a `preview_json` blob with everything needed to render the card (author name, avatar, thesis excerpt, market title, side, price). This avoids JOINs on the hot read path. Trade-off: stale data if a user changes their name/avatar, but we accept that — feeds are ephemeral.

### 3. Predictions are immutable once posted
You can close a prediction (exit your position) but you cannot change the side or entry price. This prevents retroactive editing to fake accuracy. The thesis text can be updated (clearly marked as "edited").

### 4. Leaderboards are snapshot-based
We don't compute rankings on every request. A cron job runs hourly (or daily) and snapshots the top N users by category into `leaderboard_snapshots`. The API serves the latest snapshot. Fast reads, acceptable staleness.

### 5. Start with server-rendered HTML, not a SPA framework
Consistent with the existing architecture. No React/Vue overhead. Vanilla JS + HTML templates. Fast to build, fast to ship, easy to iterate. Move to a framework later if/when complexity demands it.
