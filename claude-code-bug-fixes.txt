# Claude Code: Bug Fixes — Live Site Audit (March 23, 2026)

Full audit of all public-facing pages complete. Fix the following bugs in priority order. All changes are in `server.js` and the relevant `public/` HTML files.

---

## BUG 1 (HIGH): Crystal Ball / Momentum signals — expired markets + near-zero price bug

**Symptoms:**
- Crystal Ball shows 10 predictions, ALL on expired or near-expired markets (0h left)
- All predictions are markets that moved from 0¢ → small value (5¢, 15¢, 25¢, 48¢)
- "La U win Colombian chamber" shows 0¢ → 0¢ (no move at all) being flagged
- All 10 have identical 87 confidence — algorithm isn't differentiating
- Daily Briefing on explore.html shows: `"Ethereum above 2,135 on March 22, 8PM ET?" moved up 4900.0%`

**Root cause:**
Markets with near-zero prices (0¢ or 1¢ baseline) get flagged as "momentum" because any move looks like a massive % gain. Expired markets aren't filtered out.

**Fixes needed in `server.js`:**

### 1A. Fix the momentum/crystal ball market detection

Find the function that generates momentum signals / crystal ball predictions (likely `getCrystalBallPredictions()` or similar, searches for markets with recent price movement). Add these filters:

```js
// Filter 1: Skip expired markets
if (new Date(market.endDateIso || market.end_date) < new Date()) continue;

// Filter 2: Skip markets expiring within 2 hours (no trading value)
const hoursLeft = (new Date(market.endDateIso || market.end_date) - new Date()) / 3600000;
if (hoursLeft < 2) continue;

// Filter 3: Skip near-zero price baseline (noise filter)
// Only flag momentum if starting price was at least 3¢ (0.03)
const priorPrice = parseFloat(market.priorPrice || market.prior_price || 0);
if (priorPrice < 0.03) continue;

// Filter 4: Require meaningful absolute move (at least 3¢)
const currentPrice = parseFloat(market.currentPrice || market.price || 0);
const absoluteMove = Math.abs(currentPrice - priorPrice);
if (absoluteMove < 0.03) continue;

// Filter 5: Cap percentage display at 999% to avoid "4900%" in UI
const pctMove = priorPrice > 0 ? ((currentPrice - priorPrice) / priorPrice) * 100 : 0;
const displayPct = Math.min(Math.abs(pctMove), 999).toFixed(0);
```

### 1B. Fix the Daily Briefing momentum percentage display

In the function that generates daily briefing text (likely `generateDailyBriefing()` or the `/api/briefing` or `/api/activity` endpoint), find where it formats the momentum move and cap it:

```js
// Replace any raw % calculation in briefing copy with capped version
// Change: `moved up ${pct.toFixed(1)}%`
// To:
const cappedPct = Math.min(pct, 999);
const moveStr = priorPrice < 0.02
  ? `surged from near-zero to ${(currentPrice * 100).toFixed(0)}¢`
  : `moved up ${cappedPct.toFixed(0)}%`;
// Use moveStr in the briefing bullet
```

**Also**: In the signals page (`public/signals.html` or wherever signals are rendered), find the momentum signal card rendering and apply the same cap to the displayed percentage.

---

## BUG 2 (HIGH): Signals page — Momentum signal direction is wrong

**Symptom:** A Momentum signal shows `BUY YES — odds: 7¢ → 2¢` with `Move: +5pts` — price DROPPED from 7¢ to 2¢ but it's flagged as a positive momentum BUY signal.

**Fix in `server.js`:** In the momentum signal detection, verify the direction filter. Momentum BUY signals should only fire when `currentPrice > priorPrice`. Add:

```js
// Only flag as momentum BUY if price actually increased
if (currentPrice <= priorPrice) continue; // skip if price dropped
```

Also fix the Move display in `public/signals.html`:
- If `move < 0`, render as red negative, not green positive
- The `Move:` label should show actual signed value: `Move: ${move > 0 ? '+' : ''}${move}pts`

---

## BUG 3 (MEDIUM): AI Analysis button — "Unable to analyze this market right now"

**Symptom:** Clicking "AI Analysis" on signals page populates the input box with the market question but returns `Unable to analyze this market right now.`

**Investigate:** Check the `/api/signals/analyze` (or similar) endpoint in server.js. The likely cause is:
1. The endpoint is hitting Anthropic API but failing (check `ANTHROPIC_API_KEY` env var is set on Railway)
2. Or the market lookup by question string isn't finding the market (title mismatch)

**Fix:**
- Add better error logging to the analyze endpoint: `console.error('AI analysis error:', err.message, err.stack)`
- Add a fallback message if Claude fails: `"AI analysis temporarily unavailable. The whale data above provides the key signal."`
- If the issue is the market lookup, try matching by partial title or slug instead of exact title

---

## BUG 4 (MEDIUM): Trader profile — "Recent Wins" labels ALL resolved positions as "WIN"

**Symptom:** On `/trader/:address`, the "RECENT WINS" section shows positions with PnL of `-$22.5K`, `-$21.7K`, `-$86.3K` all labeled with green `WIN` badges.

**Location:** In `public/trader.html`, find the `RECENT WINS` section rendering.

**Fix:**
```js
// In the renderRecentWins() function or wherever wins are rendered:
// Change section title from hardcoded "RECENT WINS" to dynamic

const resolvedPositions = data.polymarket?.resolved || [];
const actualWins = resolvedPositions.filter(p => p.pnl > 0);
const actualLosses = resolvedPositions.filter(p => p.pnl <= 0);

// Show wins and losses separately, or just wins:
// Section header: `RECENT WINS (${actualWins.length})`
// Only show actualWins in this section
// Add separate "RECENT LOSSES" section or just omit losses from wins
```

Also fix the badge: only show green `WIN` if `pnl > 0`, otherwise show red `LOSS`.

---

## BUG 5 (LOW): Member profile — "Member since Dec 1969"

**Symptom:** On `/p/:address` profile pages, "Member since Dec 1969" — Unix epoch 0 date.

**Location:** In `public/member.html` or wherever the profile page renders the join date.

**Fix:**
```js
// Replace this pattern (wherever joined_at / created_at is formatted):
const joinDate = user.created_at || user.joined_at;
// Guard against epoch 0 or null:
const joinDisplay = (!joinDate || new Date(joinDate).getFullYear() < 2020)
  ? null  // don't show
  : new Date(joinDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

// In template: only render if joinDisplay is non-null
if (joinDisplay) {
  memberSinceEl.textContent = `Member since ${joinDisplay}`;
} else {
  memberSinceEl.style.display = 'none';
}
```

---

## BUG 6 (LOW): HL Whale table — Entry and Mark price showing $0

**Symptom:** On `/whales` Hyperliquid tab, ENTRY and MARK columns show `$0` for all positions.

**Location:** In `server.js`, the Hyperliquid whale data fetch. Check the HL position object — `entryPx` and `markPx` (or `liquidationPx`) may be inside a nested object.

The HL API `clearinghouseState` returns position data like:
```js
position.position.entryPx  // might be string "0" for some positions
position.position.markPx   // might not exist at top level
```

**Fix in `server.js`:**
```js
// When building the HL position object, use the correct field path:
entry_price: parseFloat(p.position.entryPx) || null,
mark_price: parseFloat(p.position.markPx || p.position.unrealizedPnl ?
  (p.position.positionValue / Math.abs(p.position.szi)) : null) || null,
```

**Fix in the whale table HTML:** Show `—` when value is 0 or null:
```js
const entryDisplay = pos.entry_price && pos.entry_price > 0
  ? `$${pos.entry_price.toFixed(4)}` : '—';
const markDisplay = pos.mark_price && pos.mark_price > 0
  ? `$${pos.mark_price.toFixed(4)}` : '—';
```

---

## BUG 7 (LOW): Signals score icon inconsistency

**Symptom:** High-score signals (≥8.0) show `🔥 9.0`, but lower-score signals show `• 5.6` (bare bullet point, no emoji).

**Location:** `public/signals.html` — wherever signal score is rendered.

**Fix:** Use a consistent icon at all scores:
```js
const scoreIcon = score >= 8 ? '🔥' : score >= 6 ? '⚡' : '📊';
// Render: `${scoreIcon} ${score.toFixed(1)}`
```

---

## SUMMARY OF CHANGES

| File | Changes |
|------|---------|
| `server.js` | Crystal Ball/momentum: add expired market filter, near-zero price filter, direction filter; fix AI analysis error logging |
| `server.js` | Daily Briefing: cap momentum % at 999%, use descriptive language for near-zero moves |
| `public/signals.html` | Fix momentum direction display, cap % display, fix score icon consistency |
| `public/trader.html` | Fix Recent Wins to show only actual wins (pnl > 0), fix badge labels |
| `public/member.html` (or wherever `/p/:address` renders) | Guard against epoch-0 join date |
| `public/whales.html` | Show `—` for null/zero entry and mark prices on HL tab |

After making all changes:
1. `git add -p` to review each change
2. `git commit -m "fix: crystal ball momentum filter, signal direction, trader wins display, epoch date bug"`
3. `git push origin main`

---

## PATCH REMINDER

At end of session, run:
```bash
cd /Users/marcdems/Desktop/HYPERFLEX
git diff HEAD > cowork-latest.patch
```
Then apply in Claude Code with `git apply cowork-latest.patch`.
