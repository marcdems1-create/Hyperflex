# Claude Code: Signals — Winner Picks "No active whale positions" fix

File: `public/signals.html` (and possibly `server.js` if Winner Picks data comes from an API endpoint)

---

## The Problem

The Winner Picks widget shows traders ranked by historical PnL/win rate.
Some of those traders have zero currently open positions (they've exited everything).
The card renders correctly but shows "No active whale positions detected" — useless to the user.

Example: `0xa4f5650a655502b2e2bc66636d347a2fd8281079` — W: +$76K but no open positions.

---

## FIX 1: Filter winners with no active positions out of the displayed list

Find the Winner Picks rendering code in `signals.html`. It likely:
1. Fetches a list of top winners
2. For each winner, fetches/shows their active positions
3. Renders a card regardless of whether positions exist

Change the render logic to **skip** winners with no active positions:

```js
function renderWinnerPicks(winners) {
  // Filter to only winners who have at least 1 active position
  const withPositions = winners.filter(w =>
    w.activePositions && w.activePositions.length > 0
  );

  if (withPositions.length === 0) {
    document.getElementById('winner-picks-container').innerHTML =
      '<div style="color:#555; font-family:\'Space Mono\',monospace; font-size:12px; padding:12px 0; text-align:center;">No active whale positions right now</div>';
    return;
  }

  // Render only winners with active positions
  document.getElementById('winner-picks-container').innerHTML =
    withPositions.map(w => renderWinnerCard(w)).join('');
}
```

---

## FIX 2: If positions are fetched async per winner, filter after load

If Winner Picks works by fetching positions for each winner separately (lazy loading),
the filter needs to happen after each position fetch resolves:

```js
async function loadWinnerPick(winner, cardEl) {
  try {
    const res = await fetch(`/api/polymarket/positions/${winner.address}`);
    const data = await res.json();
    const positions = (data.positions || data || []).filter(p =>
      p.size > 0 && !p.resolved
    );

    if (positions.length === 0) {
      // Hide the entire card — don't show "No active positions"
      cardEl.style.display = 'none';
      return;
    }

    // Render positions into card
    renderPositionsInCard(cardEl, positions, winner);
  } catch (e) {
    cardEl.style.display = 'none'; // hide on error too
  }
}
```

---

## FIX 3: If Winner Picks data comes from the backend (`/api/signals` or similar)

Find the backend endpoint that powers Winner Picks. Add a position check before including a winner:

```js
// When building the winner picks array, filter out wallets with no open positions
const winnersWithPositions = await Promise.all(
  topWinners.map(async (winner) => {
    const positions = await getPolymarketPositions(winner.address);
    const activePositions = (positions || []).filter(p =>
      parseFloat(p.size || p.shares || 0) > 0 &&
      !p.market?.closed &&
      !p.market?.resolved
    );
    return { ...winner, activePositions, hasActive: activePositions.length > 0 };
  })
);

const filtered = winnersWithPositions.filter(w => w.hasActive);
// Return filtered
```

Note: if this makes the endpoint too slow (many parallel fetches), cache position results
for 5 min using the existing `_polyCache` or a similar Map keyed by address.

---

## FIX 4: Minimum — if you can't filter, change the empty state message

Worst case (can't filter without major refactor), at least make the empty state useful:

Change:
```
"No active whale positions detected"
```
To hide the card entirely, OR show:
```
"Closed all positions — check back soon"
```
with a dimmed style so it's clearly not actionable:

```js
if (!positions || positions.length === 0) {
  cardEl.style.opacity = '0.4';
  cardEl.querySelector('.positions-area').innerHTML =
    '<span style="font-size:11px; color:#444; font-family:Space Mono,monospace;">· No open positions right now</span>';
}
```

But FIX 1 or 2 (hiding the card entirely) is strongly preferred.

---

## Commit

```bash
git add public/signals.html server.js
git commit -m "fix: winner picks — hide traders with no active positions instead of showing empty state"
git push origin main
```
