# Claude Code Task: Trader Profile Page (`/trader/:address`) + Cohort Intelligence

Build a deep-dive multi-platform trader profile page at `/trader/:address` — HYPERFLEX's answer to HyperDash. Any EVM wallet gets its own analytics page. Auto-detects Polymarket and Hyperliquid activity. Also adds cohort intelligence to the signals and explore pages — the feature HyperDash has for crypto, that nobody has built yet for prediction markets.

---

## PART 1: `/trader/:address` — Trader Profile Page

### Core concept
Both Polymarket and Hyperliquid use EVM addresses (`0x...`). Fetch both in parallel, show whichever has data. Platform badges: `POLY` / `HL` / `HFX`.

### 1A. Server routes

```js
// Serve page
app.get('/trader/:address', (req, res) => res.sendFile(path.join(__dirname, 'public', 'trader.html')));

// API
// GET /api/trader/:address/profile  — public, no auth, 3-min cache
```

### 1B. API logic: `GET /api/trader/:address/profile`

Validate `0x[0-9a-fA-F]{40}`. Cache in `_polyCache` for 3 min.

**Polymarket** (2 parallel fetches):
```
GET https://data-api.polymarket.com/positions?user=${address}&limit=100&sortBy=CURRENT&winning=false
GET https://data-api.polymarket.com/positions?user=${address}&limit=100&sortBy=CURRENT&winning=true
```

Note: `winning=false` is confirmed working in production (existing `/api/polymarket/positions/:address`). `winning=true` is the logical complement for resolved winning positions — if it returns empty, also try `?closed=true` as a fallback. Both calls should use the same field mapping.

**Hyperliquid** (2 parallel POST requests to `https://api.hyperliquid.xyz/info`):
```json
{ "type": "clearinghouseState", "user": "0xADDRESS_LOWERCASE" }
{ "type": "userFills", "user": "0xADDRESS_LOWERCASE", "startTime": Date.now() - 30*24*60*60*1000 }
```

**HFX account check:**
```js
const { data: hfxUser } = await supabase
  .from('creator_settings')
  .select('user_id, display_name')
  .eq('polymarket_address', address.toLowerCase())
  .maybeSingle();
```

**Hyperliquid clearinghouseState response shape:**
```json
{
  "assetPositions": [{
    "position": {
      "coin": "BTC",
      "szi": "0.05",           // positive = long, negative = short
      "entryPx": "65000",
      "unrealizedPnl": "312.50",
      "returnOnEquity": "0.15",
      "liquidationPx": "58000",
      "marginUsed": "650",
      "positionValue": "3250"
    }
  }],
  "marginSummary": {
    "accountValue": "8200",
    "totalNtlPos": "12000",
    "totalMarginUsed": "1200",
    "withdrawable": "7000"
  }
}
```

**userFills response** — array of:
```json
{
  "coin": "BTC", "px": "65000", "sz": "0.01",
  "side": "B",  // B=buy/long, A=sell/short
  "time": 1700000000000,
  "closedPnl": "45.00",  // non-empty string on close trades
  "dir": "Open Long"     // or "Close Long", "Open Short", etc.
}
```

**Return shape:**
```json
{
  "address": "0x...",
  "has_hfx_account": false,
  "hfx_user_id": null,
  "platforms": ["polymarket", "hyperliquid"],
  "polymarket": {
    "active": true,
    "open_positions": [...],
    "won_positions": [...],
    "open_pnl": 450.00,
    "won_pnl": 890.00,
    "open_value": 3200.00,
    "total_invested": 4500.00,
    "roi_pct": 18.2,
    "win_count": 14
  },
  "hyperliquid": {
    "active": true,
    "open_positions": [...],
    "account_value": 8200.00,
    "total_notional": 12000.00,
    "unrealized_pnl": 312.50,
    "realized_pnl": 1450.00,
    "margin_used": 1200.00,
    "withdrawable": 7000.00,
    "fills": [...],
    "win_count": 8,
    "loss_count": 3,
    "total_volume": 245000.00
  },
  "summary": {
    "total_pnl": 3102.50,
    "open_count": 11,
    "platforms_active": 2
  },
  "fetched_at": "..."
}
```

Map Polymarket positions:
```js
{
  conditionId, question, side: p.outcome || 'YES',
  shares: parseFloat(p.size), current_price: parseFloat(p.currentPrice),
  cash_value: parseFloat(p.currentValue), cost_basis: parseFloat(p.initialValue),
  pnl: parseFloat(p.cashPnl), pnl_pct: parseFloat(p.percentPnl),
  market_url: `https://polymarket.com/event/${p.conditionId}`,
  end_date: p.endDateIso, payout: parseFloat(p.value)
}
```

Map HL positions:
```js
{
  coin: p.position.coin,
  side: parseFloat(p.position.szi) > 0 ? 'LONG' : 'SHORT',
  size: Math.abs(parseFloat(p.position.szi)),
  entry_price: parseFloat(p.position.entryPx),
  position_value: parseFloat(p.position.positionValue),
  unrealized_pnl: parseFloat(p.position.unrealizedPnl),
  roi_pct: parseFloat(p.position.returnOnEquity) * 100,
  liquidation_price: parseFloat(p.position.liquidationPx),
  margin_used: parseFloat(p.position.marginUsed)
}
```

---

### 1C. `public/trader.html` layout

Design: `#141412` bg, `#c9920d` gold, Syne + Space Mono. Address from `window.location.pathname`.

```
┌─────────────────────────────────────────────────────────────┐
│  HYPERFLEX nav                                              │
│  ← Back to Predictors                                       │
├─────────────────────────────────────────────────────────────┤
│  [Avatar]  0xABCD...1234   [POLY] [HL] [HFX]   [Follow]   │
│                                                             │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌─────────┐ │
│  │ Total P&L  │ │ HL Value   │ │ Open Pos   │ │Platforms│ │
│  │ +$14,200   │ │ $8,200     │ │    11      │ │    2    │ │
│  └────────────┘ └────────────┘ └────────────┘ └─────────┘ │
├─────────────────────────────────────────────────────────────┤
│  [TABS: Overview | Polymarket | Hyperliquid | History]      │
├─────────────────────────────────────────────────────────────┤
│  [Combined P&L Timeline — canvas chart]                     │
├──────────────────────┬──────────────────────────────────────┤
│  POLYMARKET          │  HYPERLIQUID                         │
│  (if active)         │  (if active)                         │
└──────────────────────┴──────────────────────────────────────┘
│  [PNL CALENDAR — GitHub-style heatmap]                      │
│  [Per-Market Performance table]                             │
│  [Full Trade History / Fills table]                         │
│  CTA: Get Started Free →                                    │
└─────────────────────────────────────────────────────────────┘
```

**Hero header:**
- Avatar: chars at index 2–3 of address (first 2 chars after `0x`), gold bg, uppercase
- Full address with copy-to-clipboard (shows "Copied!" toast)
- Platform badges: POLY (blue `#0066ff`), HL (purple `#7c3aed`), HFX (gold)
- Stat pills row: Total P&L (green/red), HL Account Value (if active), Open Positions, Platforms Active
- Follow button: only if `has_hfx_account` — calls `/api/predictors/:userId/follow-status`

**P&L Timeline (canvas):**
- Merge HL fills (sorted by `time`) + Polymarket won positions (sorted by `end_date`) into one timeline
- Compute cumulative P&L at each point, draw gold fill-chart on `#1a1814`
- Horizontal zero line in `rgba(255,255,255,0.1)`
- Skip if < 3 data points total

**PNL Calendar (GitHub-style heatmap):**
- 52 columns × 7 rows grid, each cell = one day
- Color intensity from gold `rgba(201,146,13,0.15)` → `rgba(201,146,13,1.0)` based on absolute P&L
- Red tint for loss days, gold tint for win days
- Build from fills data (use `time` field) + Polymarket resolved positions (use `end_date`)
- Tooltip on hover: date + P&L for that day
- Show last 6 months minimum

**Per-Market Performance table:**
- Group fills by `coin` (HL) and by `conditionId` (Poly)
- Columns: Market/Asset | Trades | Win Rate (mini bar) | Net P&L
- Sort by |PNL| desc
- Empty: "No resolved trade history available"

**Full Fills History table (paginated, 20 per page):**
- Columns: Platform | Asset/Market | Direction | Size | Price | P&L | Time
- Direction pill: "Open Long" green, "Close Long" grey, "Open Short" red, etc.
- WIN/LOSS badge on close trades with PNL
- Relative time ("2h ago", "3d ago")

**Polymarket section** (only if `polymarket.active`):
```
📊 POLYMARKET POSITIONS [POLY badge]

Market                    Side   Value    P&L      Odds
────────────────────────────────────────────────────
Will X happen by Y?      YES    $410    +$60     82¢
```
- Market name links to `https://polymarket.com/event/${conditionId}`
- Side pill: gold = YES, dark = NO
- P&L green/red, sorted by |pnl| desc

Won positions section: last 10 wins with WIN 🟢 badge + payout.

**Hyperliquid section** (only if `hyperliquid.active`):
```
⚡ HYPERLIQUID PERPS [HL badge]

Account Value: $8,200  |  Unrealized PNL: +$312  |  Margin Used: $1,200  |  Withdrawable: $7,000
```

Open positions table:
```
Asset    Side     Size    Entry      Liq        Value      Unr. P&L
BTC      LONG     0.05   $65,000    $58,000    $3,250     +$312
ETH      SHORT    2.00   $3,200     $3,520     $6,400     -$180
```
- Side: green pill = LONG, red pill = SHORT
- Sort by `|unrealized_pnl|` desc

**Bottom CTA:**
```
Track your own portfolio on HYPERFLEX →
Polymarket + Kalshi + Manifold in one dashboard.
[Get Started Free →]
```

**Style notes:**
- Loading: dark grey skeleton pulse on card areas
- Error/empty: "No activity found for this address on Polymarket or Hyperliquid"
- HL badge: `#7c3aed`, POLY: `#0066ff`, HFX: `#c9920d`
- LONG: `rgba(0,200,100,0.15)` bg, `#00c864` text
- SHORT: `rgba(231,76,60,0.15)` bg, `#e74c3c` text
- Numbers > $1000: format as `$1.2K`, `$45.6K`
- Page title: `0xABCD...1234 — Trader Profile | HYPERFLEX`
- Hyperliquid API: always lowercase address; if `assetPositions` empty → `active: false`

---

## PART 2: Cohort Intelligence on Signal Pages

This is the feature HyperDash built for crypto — we're building it for prediction markets. The insight: segment bettors by track record quality and show how each cohort is positioned on a given market.

### 2A. New API endpoint: `GET /api/market/:marketId/cohort-sentiment`

No auth. Cache 5 min.

Logic:
1. Get all bets on this market from the `positions` table:
   ```js
   const { data: mktPositions } = await supabase
     .from('positions')
     .select('user_id, side, amount')
     .eq('market_id', marketId);
   ```
2. Get per-user win rates by aggregating ALL their settled positions:
   ```js
   const userIds = [...new Set(mktPositions.map(p => p.user_id))];
   const { data: userStats } = await supabase
     .from('positions')
     .select('user_id, won')
     .in('user_id', userIds)
     .eq('settled', true);
   // Build map: userId -> { wins, total }
   const statsMap = {};
   for (const p of userStats || []) {
     if (!statsMap[p.user_id]) statsMap[p.user_id] = { wins: 0, total: 0 };
     statsMap[p.user_id].total++;
     if (p.won) statsMap[p.user_id].wins++;
   }
   ```
3. Segment each bettor by their historical win rate:
   - **Sharp** (≥65% win rate AND ≥10 total predictions): "Sharp Money"
   - **Experienced** (50-65% win rate AND ≥5 predictions): "Experienced"
   - **Retail** (<50% win rate OR <5 predictions): "Retail"
4. For each cohort, compute:
   - Total centpoints on YES vs NO (divide by 100 for display)
   - Number of bettors YES vs NO
   - Implied sentiment %
5. Return:
```json
{
  "market_id": "...",
  "cohorts": [
    {
      "label": "Sharp Money",
      "description": "≥65% win rate, 10+ bets",
      "yes_pct": 74,
      "no_pct": 26,
      "yes_count": 8,
      "no_count": 3,
      "yes_volume": 4500,
      "no_volume": 1200,
      "total_bettors": 11
    },
    { "label": "Experienced", "yes_pct": 58, "no_pct": 42, ... },
    { "label": "Retail", "yes_pct": 51, "no_pct": 49, ... }
  ],
  "gap": 23,   // Sharp pct - Retail pct (the alpha signal)
  "signal": "SHARP_YES"  // or "SHARP_NO" or "CONSENSUS" or "SPLIT"
}
```

Signal logic:
- `gap >= 15` and sharp YES > 60%: `"SHARP_YES"`
- `gap >= 15` and sharp NO > 60%: `"SHARP_NO"`
- All cohorts within 5% of each other: `"CONSENSUS"`
- Otherwise: `"SPLIT"`

### 2B. Add cohort sentiment widget to `community.html` market cards

On each market card, after the YES/NO odds bar, add a compact cohort sentiment row:

```html
<div class="cohort-row">
  <span class="cohort-label">Sharp Money:</span>
  <span class="cohort-bar">
    <span style="width:74%;background:#2ecc71"></span>
    <span style="width:26%;background:#e74c3c"></span>
  </span>
  <span class="cohort-pct">74% YES</span>
  <span class="cohort-badge sharp-yes">↑ SHARP YES</span>
</div>
```

Only show when `total_bettors >= 3`. Lazy-load: fetch after card renders, fill in data.

Badge styles:
- SHARP_YES: gold bg, dark text: "⚡ Sharp YES"
- SHARP_NO: red bg: "⚡ Sharp NO"
- CONSENSUS: grey: "✓ Consensus"
- SPLIT: no badge

### 2C. Add full cohort sentiment panel to signals page (`/signals` or wherever whale signals appear)

On each signal card, replace or augment the existing odds display with the cohort breakdown:

```
┌─────────────────────────────────────────────────┐
│  Will X happen?                                  │
│                                                  │
│  Sharp Money  [████████░░░░░░░]  74% YES  ⚡    │
│  Experienced  [██████████░░░░░]  58% YES        │
│  Retail       [███████████████]  51% YES        │
│                                                  │
│  Smart Money Gap: +23pts vs Retail               │
└─────────────────────────────────────────────────┘
```

### 2D. Cohort Overview page: `/explore` — add a "Smart Money" section

In `explore.html`, add a new section above the activity feed: **"Smart Money Positioning"**

Shows the top 5 markets where the Sharp/Retail gap is largest:

```
⚡ SMART MONEY DIVERGENCE
Markets where sharp predictors disagree most with retail

1. Will the Fed cut rates in May?
   Sharp: 78% YES  |  Retail: 44% YES  |  Gap: +34pts
   [View Market →]

2. Will BTC hit $100K by June?
   Sharp: 31% YES  |  Retail: 67% YES  |  Gap: -36pts
   ...
```

API: `GET /api/explore/smart-money-divergence` — queries all active HFX community markets, computes cohort sentiment for each, returns top 5 by absolute gap. Cache 10 min.

---

## PART 3: Fix predictors.html

In `renderCard(p)`, add "View Positions →" link if polymarket_address exists:

```html
${p.polymarket_address ? `
  <div style="padding:0 16px 12px">
    <a href="/trader/${escHtml(p.polymarket_address)}" onclick="event.stopPropagation()"
       style="font-size:10px;font-family:var(--mono);color:var(--gold);border:1px solid rgba(201,146,13,0.4);border-radius:12px;padding:3px 10px;text-decoration:none;">
      🔗 View Positions →
    </a>
  </div>` : ''}
```

Update `GET /api/predictors` to include `polymarket_address` in the SELECT from `creator_settings`.

---

## Summary of files to touch

| File | Change |
|------|--------|
| `public/trader.html` | **CREATE** — full multi-platform profile page |
| `server.js` | `GET /trader/:address` page route + `GET /api/trader/:address/profile` + `GET /api/market/:id/cohort-sentiment` + `GET /api/explore/smart-money-divergence` |
| `public/predictors.html` | Add "View Positions →" link on cards with polymarket_address |
| `public/community.html` | Add cohort sentiment row on each market card |
| `public/explore.html` | Add Smart Money Divergence section |

No new DB migrations needed. Uses existing bets, win_rate data, Polymarket API, and Hyperliquid API.
