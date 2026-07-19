/* ── TRADER CARD — shared render component ────────────────────────────────
   Renders the card object returned by GET /api/trader-cards (see server.js
   _buildTraderCards). One function, three variants: 'hero' | 'feed' | 'compact'.
   Zero network calls, zero Anthropic — every field on the card object is
   already computed server-side; this only lays it out.

   Non-negotiable per the product definition (CLAUDE.md): score and n always
   render together, as one unit. There is no code path in this file that can
   emit a score without its n sitting next to it. */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function initials(card) {
    var src = card.display_name || card.username || card.polymarket_address || '?';
    var parts = String(src).replace(/^0x/, '').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(src).slice(0, 2).toUpperCase();
  }

  // Deterministic hash → hue, so the same wallet always gets the same avatar
  // color across renders without storing anything.
  function avatarColor(card) {
    var src = String(card.user_id || card.polymarket_address || card.display_name || 'x');
    var hash = 0;
    for (var i = 0; i < src.length; i++) hash = (hash * 31 + src.charCodeAt(i)) >>> 0;
    var hue = hash % 360;
    return 'hsl(' + hue + ', 62%, 62%)';
  }

  function handle(card) {
    if (card.username) return '@' + card.username;
    if (card.display_name) return card.display_name;
    if (card.polymarket_address) return card.polymarket_address.slice(0, 6) + '…' + card.polymarket_address.slice(-4);
    return 'Trader';
  }

  // Inline SVG sparkline from the form array (0=loss, 0.5=push, 1=win).
  function sparkline(form, w, h) {
    w = w || 64; h = h || 20;
    if (!form || form.length < 2) return '';
    var step = w / (form.length - 1);
    var pts = form.map(function (v, i) { return (i * step) + ',' + (h - v * h); }).join(' ');
    var lastUp = form[form.length - 1] >= (form[form.length - 2] != null ? form[form.length - 2] : 0.5);
    var stroke = form[form.length - 1] === 1 ? '#00e68a' : form[form.length - 1] === 0 ? '#ff4d6a' : 'rgba(240,240,245,.4)';
    return '<svg class="tcard-sparkline" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" fill="none">'
      + '<polyline points="' + pts + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>'
      + '</svg>';
  }

  function fmtPct(p) {
    if (p == null) return '—';
    return (p >= 0 ? '+' : '') + p.toFixed(1) + '%';
  }

  function evidenceLine(ev) {
    if (!ev) return null;
    var verb = ev.side === 'SELL' ? 'Sold' : 'Bought';
    var entryC = ev.entry_price != null ? Math.round(ev.entry_price * 100) + '¢' : null;
    var outcome = ev.result === 'win' ? 'WON' : 'LOST';
    var multClass = ev.result === 'win' ? 'mult-win' : 'mult-loss';
    var multText = ev.multiplier != null ? ev.multiplier + 'x' : fmtPct(ev.roi_pct);
    var pieces = [];
    pieces.push(verb + (entryC ? ' at ' + entryC : ''));
    pieces.push('→ ' + outcome);
    var line = pieces.join(' ') + ' <span class="' + multClass + '">' + multText + '</span>';
    return { line: line, question: ev.question };
  }

  function render(card, variant) {
    variant = variant || 'feed';
    var cls = 'tcard tcard-' + variant;
    var scorePositive = (card.score_pct != null ? card.score_pct : 0) >= 0;
    var scoreLineCls = 'tcard-scoreline ' + (scorePositive ? 'is-positive' : 'is-negative');
    var scoreDisplay = fmtPct(card.score_pct);
    var ev = evidenceLine(card.evidence);
    var streakCls = card.streak && card.streak.type ? ('tcard-streak is-' + card.streak.type) : '';
    var streakText = card.streak && card.streak.count
      ? card.streak.count + (card.streak.type === 'win' ? 'W' : card.streak.type === 'loss' ? 'L' : 'P') + ' streak'
      : null;
    var profileHref = card.user_id ? '/m/' + esc(card.user_id) : '#';

    var html = '<a class="' + cls + '" href="' + profileHref + '" data-user-id="' + esc(card.user_id) + '">';

    html += '<div class="tcard-identity">'
      + '<div class="tcard-avatar" style="background:' + avatarColor(card) + '">' + esc(initials(card)) + '</div>'
      + '<div class="tcard-handle">' + esc(handle(card)) + '</div>'
      + (card.whale_rank ? '<div class="tcard-rank">#' + esc(card.whale_rank) + '</div>' : '')
      + '</div>';

    html += '<div class="tcard-verdict">' + esc(card.verdict) + '</div>';

    html += '<div class="' + scoreLineCls + '">'
      + '<span class="tcard-score">' + esc(scoreDisplay) + '</span>'
      + '<span class="tcard-n">n=' + esc(card.n) + '</span>'
      + '</div>';

    if (variant !== 'compact' && ev) {
      html += '<div class="tcard-evidence">'
        + '<div class="tcard-evidence-line">' + ev.line + '</div>'
        + '<div class="tcard-evidence-q">' + esc((ev.question || '').slice(0, 90)) + '</div>'
        + '</div>';
    }

    html += '<div class="tcard-form">'
      + sparkline(card.form)
      + (streakText ? '<span class="' + streakCls + '">' + esc(streakText) + '</span>' : '')
      + '</div>';

    if (card.provisional) {
      html += '<div class="tcard-provisional">Provisional — pending verification</div>';
    }

    html += '</a>';
    return html;
  }

  window.HFXTraderCard = { render: render, sparkline: sparkline, esc: esc };
})();
