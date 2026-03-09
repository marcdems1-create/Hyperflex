# HYPERFLEX Project Brief — March 2026

## 1. Project Status

**LIVE:** https://hyperflex-production-4294.up.railway.app

Backend and frontend are deployed on Railway. The app serves a prediction-market UI (markets, trading, settlement, leaderboard) with a Claude-powered market scanner and real-price settlement.

---

## 2. What Was Built Today (March 9, 2026)

- **Railway / Node:** Nixpacks config (`nixpacks.toml`) and `package.json` engines/start script for Node 18+ and `node server.js`.
- **Production API URL:** Frontend (`index.html`) pointed to production API `https://hyperflex-production-4294.up.railway.app` (later updated to final domain).
- **Market detail fixes:** Market title uses `market.question` (with fallback to `m.q`); order book guarded against NaN (baseYes default 0).
- **Claude AI market scanner:** `@anthropic-ai/sdk` added; `scanAndCreateMarkets()` calls Claude (claude-sonnet-4-20250514) with a system prompt to generate 5 prediction markets (question, category, resolution_date, target_price, direction), parses JSON, dedupes by question, inserts into Supabase with required fields (question, category, resolution_date, commodity, target_price, direction, resolved: false). Cron every 6 hours (`0 */6 * * *`); manual trigger `POST /api/scan-markets`. Prompt updated to use dynamic “today” and require 2026 resolution dates.
- **Scanner payload and frontend fetch logging:** Console logs for each market insert and raw `/markets` response for debugging.
- **Real price settlement:** `fetchCurrentPrice(commodity)` added (CoinGecko for bitcoin/ethereum, metals.live for gold/silver, Yahoo Finance chart for WTI). `settleMarkets()` uses live price as `settlement_price`; skips resolution if price is null (retry next hour).
- **Leaderboard:** `GET /api/leaderboard` aggregates settled positions and users, computes total PnL (sum of payouts where won minus sum of amount), win rate, total trades; returns top 20. BOARD tab in `index.html` fetches and displays rank, username, PnL, win rate, total trades; highlights current user row; crown for rank 1.
- **Scanner insert completeness:** All required market fields (including category, resolution_date, commodity) inserted; frontend shapes API markets (q, sector, yes, closes, hot, etc.) so missing fields don’t hide rows.

---

## 3. Current Tech Stack

From `package.json` (exact dependencies):

| Package              | Version  |
|----------------------|----------|
| @anthropic-ai/sdk    | ^0.78.0  |
| @supabase/supabase-js| ^2.99.0  |
| bcryptjs             | ^3.0.3   |
| cors                 | ^2.8.6   |
| dotenv               | ^17.3.1  |
| express              | ^5.2.1   |
| jsonwebtoken         | ^9.0.3   |
| node-cron            | ^4.2.1   |

- **Runtime:** Node.js >= 18.0.0  
- **Frontend:** Single-page app in `index.html` (React via CDN, Babel, Ethers, Web3Modal), static assets in `public/`.  
- **Hosting:** Railway (production); start command `node server.js`.

---

## 4. All API Endpoints

Every route defined in `server.js`:

| Method | Path                  | Description |
|--------|------------------------|-------------|
| POST   | `/register`            | Create account (email, password, display_name); returns user. |
| POST   | `/login`               | Auth; returns token and user (id, email, display_name, balance). |
| GET    | `/markets`             | List open markets (resolved = false), ordered by expiry_date. |
| GET    | `/markets/:id`         | Single market by id. |
| POST   | `/markets`             | Create market (admin): question, commodity, target_price, direction, expiry_date. |
| POST   | `/trade`               | Place trade (user_id, market_id, side, amount); deducts balance, creates position. |
| GET    | `/positions/:user_id`  | All positions for user with market details. |
| GET    | `/api/leaderboard`     | Top 20 users by PnL (rank, user_id, username, total_pnl, win_rate, total_trades). |
| POST   | `/api/scan-markets`    | Manually trigger Claude market scanner; returns `{ ok: true }`. |

Static: `public/` served at `/` (e.g. `index.html` at project root is the main app).

---

## 5. Database Schema (Supabase)

Tables and fields used in the codebase:

**users**

- `id` — primary key  
- `email` — unique  
- `password_hash` — bcrypt  
- `display_name` — optional  
- `balance` — numeric (paper balance for in-app trading)

**markets**

- `id` — primary key  
- `question` — text  
- `commodity` — text (e.g. crypto, gold, silver, oil)  
- `category` — text (scanner)  
- `resolution_date` — date (scanner)  
- `target_price` — number (for settlement: above/below)  
- `direction` — 'above' | 'below'  
- `expiry_date` — timestamp (market closes; settlement runs when past)  
- `resolved` — boolean  
- `settlement_price` — number (set on resolution)  
- `outcome` — boolean (true = YES wins)  
- `yes_price`, `no_price` — used in trade pricing (e.g. 0–1 or cents)

**positions**

- `id` — primary key  
- `user_id` — FK → users.id  
- `market_id` — FK → markets.id  
- `side` — 'YES' | 'NO'  
- `amount` — number (stake)  
- `potential_payout` — number (paid if won)  
- `settled` — boolean  
- `won` — boolean (set when market resolves)

---

## 6. Environment Variables

- **SUPABASE_URL** — Supabase project URL (required).  
- **SUPABASE_ANON_KEY** — Supabase anon key (required).  
- **ANTHROPIC_API_KEY** — For Claude market scanner; scanner no-ops if missing.  
- **JWT_SECRET** — Optional; defaults to `'hyperflex_secret'` for login tokens.  
- **PORT** — Optional; defaults to `3000` (Railway sets this in production).

`.env` is loaded via `dotenv`; `.env` is in `.gitignore`.

---

## 7. Dev Workflow — Cursor First, Paste Prompts, Run to Push

1. Open project in Cursor; work in `server.js`, `index.html`, or other repo files.  
2. Use Cursor chat/Composer: paste prompts (e.g. “add endpoint …”, “fix leaderboard to …”).  
3. Apply suggested edits; run `node server.js` locally if desired (ensure `.env` has SUPABASE_* and optionally ANTHROPIC_API_KEY).  
4. Commit and push (e.g. “commit and push with message …” in the prompt); Railway deploys from the connected repo.

---

## 8. Known Issues / Next Session Tasks

- **Markets table:** Scanner and manual create use `expiry_date` / `resolution_date`; confirm Supabase columns match (e.g. `expiry_date` may be date/timestamptz).  
- **Trade pricing:** `/trade` uses `market.yes_price` and `market.no_price`; new scanner-created markets may not set these (default or migration may be needed).  
- **fetchCurrentPrice:** Commodity mapping is fixed (bitcoin, ethereum, gold, silver, oil/wti); scanner categories (crypto, commodities, earnings, macro) may need mapping to a specific commodity for settlement (e.g. “commodities” → gold or a default).  
- **Leaderboard:** Currently all-time only; weekly/monthly tabs in the UI are not wired to the API.  
- **Remove or gate debug logs:** `[scanAndCreateMarkets] inserting` and `[markets fetch] raw response` in production if noisy.

---

## 9. Grand Vision — Competing with Polymarket

HYPERFLEX aims to be a real-money prediction market platform that competes with Polymarket, with a focus on:

- **Commodities and macro:** Differentiating via gold, silver, oil, and macro outcomes, not just crypto and politics.  
- **Automated market creation:** Claude-generated markets on a schedule (e.g. every 6 hours) to keep the catalog fresh.  
- **Real settlement:** Resolution using live prices (CoinGecko, metals.live, Yahoo) instead of simulated data.  
- **Single app:** Auth, markets, trading, leaderboard, and wallet (e.g. MetaMask/Web3Modal) in one stack, deployable to Railway with minimal config.

Longer term: more asset classes, real-money integration, and scale comparable to Polymarket while keeping a commodity/macro edge.
