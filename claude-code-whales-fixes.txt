# Claude Code: Whales Page — 2 UX Fixes

Both changes are in `public/whales.html`. No server.js changes needed.

---

## FIX 1: "Auto-Copy" button — make it clear what it does

### Problem
The actions column shows three buttons: `+ Follow`, `Copy Trade`, `Auto-Copy`. Users don't understand what "Auto-Copy" does or how it differs from "Copy Trade".

### What the buttons should communicate:
- **Copy Trade** — one-time action: replicate this specific open position right now
- **Auto-Copy** — ongoing: mirror ALL future trades from this wallet automatically

### Changes

**1A. Rename and add tooltip to "Auto-Copy":**

Find the button rendering code in `whales.html` (in the Polymarket whale table rows). Change:
```html
<!-- BEFORE -->
<button class="btn-auto-copy" onclick="setupAutoCopy(...)">🤖 Auto-Copy</button>
```
To:
```html
<!-- AFTER -->
<button class="btn-auto-copy" onclick="setupAutoCopy(...)" title="Mirror all future trades from this wallet automatically">
  🤖 Auto-Mirror
</button>
```

**1B. Add a small descriptor line under each button pair.** After the two action buttons row, add:
```html
<div style="font-size:10px; color:#888; margin-top:3px; text-align:center;">
  Copy: this trade · Mirror: all future
</div>
```

**1C. When "Auto-Mirror" is clicked**, show a confirmation modal (or toast) that explains what's happening:
```js
function setupAutoCopy(address, traderName) {
  // Show confirmation instead of silently setting up
  const confirmed = confirm(
    `Auto-Mirror: We'll notify you every time ${traderName} opens a new position, ` +
    `so you can copy their trades in real time.\n\nEnable for this wallet?`
  );
  if (!confirmed) return;
  // ... rest of existing auto-copy logic
}
```

**1D. Style the two buttons distinctly** so the hierarchy is clear:
```css
/* Copy Trade = secondary (outlined) */
.btn-copy-trade {
  background: transparent;
  border: 1px solid #c9920d;
  color: #c9920d;
}
/* Auto-Mirror = primary (filled) — the more powerful action */
.btn-auto-copy {
  background: #c9920d;
  color: #141412;
  font-weight: 600;
}
```

---

## FIX 2: Hyperliquid whales — Large Cap filter + tier badges

### Problem
The HL tab shows positions in coins like PUMP, BLAST, and other micro-cap tokens. Traders want to see where smart money is in **real assets** (BTC, ETH, SOL, etc.), not shitcoins. Currently there's no way to filter.

### Solution
Add a **Large Cap filter** that defaults ON when switching to the HL tab, with per-row tier badges.

---

### 2A. Define large cap coins (top of script section or in the HL render function)

```js
const HL_LARGE_CAP = new Set([
  'BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','TRX','LINK',
  'DOT','MATIC','UNI','LTC','BCH','SUI','ARB','OP','APT','ATOM',
  'NEAR','FIL','ICP','INJ','WLD','MKR','AAVE','SNX','CRV','GMX',
  'PENDLE','WIF','PEPE','SHIB','TON','STX','RUNE','SEI','TIA','JUP'
]);

const HL_MID_CAP = new Set([
  'BLUR','ENS','DYDX','LDO','COMP','BAL','YFI','SUSHI','1INCH',
  'CAKE','ZRX','BAND','API3','UMA','BADGER','PERP','IMX','BOBA',
  'MAGIC','HFT','HOOK','GMX','RDNT','VELA','UMAMI'
]);

function getHLTier(coin) {
  if (HL_LARGE_CAP.has(coin)) return 'large';
  if (HL_MID_CAP.has(coin)) return 'mid';
  return 'small';
}

function getHLTierBadge(coin) {
  const tier = getHLTier(coin);
  if (tier === 'large') return '<span class="hl-tier-badge hl-large">🔵 L</span>';
  if (tier === 'mid')   return '<span class="hl-tier-badge hl-mid">🟡 M</span>';
  return '<span class="hl-tier-badge hl-small">🔴 S</span>';
}
```

---

### 2B. Add filter pills above the HL table

Find where the HL tab content is rendered. Above the HL positions table, add:

```html
<div id="hl-cap-filter" style="display:flex; gap:8px; margin:12px 0 8px; align-items:center;">
  <span style="font-size:11px; color:#888; font-family:'Space Mono',monospace; text-transform:uppercase; letter-spacing:.05em;">FILTER:</span>
  <button class="hl-filter-pill active" data-filter="large" onclick="setHLFilter('large')">🔵 Large Cap</button>
  <button class="hl-filter-pill" data-filter="mid" onclick="setHLFilter('mid')">🟡 Mid Cap</button>
  <button class="hl-filter-pill" data-filter="small" onclick="setHLFilter('small')">🔴 Small Cap</button>
  <button class="hl-filter-pill" data-filter="all" onclick="setHLFilter('all')">All</button>
  <span id="hl-filter-count" style="font-size:11px; color:#888; margin-left:4px;"></span>
</div>
```

CSS for the pills:
```css
.hl-filter-pill {
  background: transparent;
  border: 1px solid #333;
  color: #888;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  cursor: pointer;
  font-family: 'Space Mono', monospace;
  transition: all .15s;
}
.hl-filter-pill.active {
  background: #1a1a18;
  border-color: #c9920d;
  color: #c9920d;
}
.hl-tier-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 4px;
  font-family: 'Space Mono', monospace;
}
```

---

### 2C. Filter logic

```js
let _hlFilter = 'large'; // default to large cap

function setHLFilter(filter) {
  _hlFilter = filter;
  // Update pill active states
  document.querySelectorAll('.hl-filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filter === filter);
  });
  // Re-render the table with current data
  renderHLWhaleTable(window._hlPositionsCache || []);
}

function renderHLWhaleTable(positions) {
  window._hlPositionsCache = positions; // cache for re-filtering

  const filtered = _hlFilter === 'all'
    ? positions
    : positions.filter(p => getHLTier(p.coin) === _hlFilter);

  // Update count label
  const countEl = document.getElementById('hl-filter-count');
  if (countEl) countEl.textContent = `${filtered.length} positions`;

  // ... render filtered positions into the table
  // (replace the existing table body render with filtered array)
}
```

---

### 2D. Add tier badge to each table row's COIN column

In the row template for HL positions, change the COIN cell:
```html
<!-- BEFORE -->
<td class="hl-coin">${pos.coin}</td>

<!-- AFTER -->
<td class="hl-coin">
  ${pos.coin}
  ${getHLTierBadge(pos.coin)}
</td>
```

---

### 2E. Default to "Large Cap" when switching to HL tab

Find where the HL tab is activated (the `onclick` for the "Hyperliquid" tab button). Add:

```js
// When HL tab is clicked, default filter to 'large'
function switchToHLTab() {
  _hlFilter = 'large';
  document.querySelectorAll('.hl-filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filter === 'large');
  });
  // ... existing HL tab switch logic
}
```

---

### 2F. HL tab summary stats — show large cap stats by default

In the HL tab's summary cards (TOTAL CAPITAL, LARGEST POSITION, MOST POPULAR MARKET, AVG POSITION SIZE), compute these for large-cap positions only when large cap filter is active.

Add a subtle label to the stats cards when filtered:
```html
<div class="stat-label">TOTAL CAPITAL <span style="color:#c9920d; font-size:9px;">(LARGE CAP)</span></div>
```

---

## SUMMARY

| File | Changes |
|------|---------|
| `public/whales.html` | Rename Auto-Copy → Auto-Mirror, add tooltip + confirmation modal + button styling |
| `public/whales.html` | Add HL cap filter pills, `HL_LARGE_CAP` / `HL_MID_CAP` sets, tier badges, `setHLFilter()`, default to large cap on tab switch |

After changes:
```bash
git add public/whales.html
git commit -m "fix: whales — clarify Auto-Mirror button, add HL large/mid/small cap filter"
git push origin main
```
