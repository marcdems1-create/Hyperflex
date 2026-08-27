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

  // ── IDENTITY GLYPH — deterministic, colorful, zero network calls. Not an
  // initials-in-circle avatar (Marc, on this exact component: "the score
  // should be a number instead of having an image with the first two
  // letters... put the score there and make it pop") — the Flex Score stays
  // the number the eye lands on first. This is a small decorative pattern
  // (abstract shapes, no letters) hashed from the wallet/handle so the same
  // trader always renders the same glyph, purely for visual scannability in
  // dense grids/rails. ──
  var PALETTE = ['#c9920d', '#00e68a', '#ff4d6a', '#4d9fff', '#a855f7', '#f59e0b'];
  function hashStr(s) {
    s = String(s || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }
  function avatarHtml(seed, size) {
    size = size || 34;
    var h = hashStr(seed);
    var c1 = PALETTE[h % PALETTE.length];
    var c2 = PALETTE[(h >> 3) % PALETTE.length];
    var c3 = PALETTE[(h >> 7) % PALETTE.length];
    var rot = h % 360;
    var uid = 'av' + (h % 1000000);
    var shapes = [
      { x: 6 + (h % 14), y: 4 + ((h >> 2) % 12), r: 13 + ((h >> 4) % 9), fill: c1, op: 0.9 },
      { x: 20 + ((h >> 6) % 16), y: 20 + ((h >> 8) % 16), r: 10 + ((h >> 5) % 10), fill: c2, op: 0.75 },
      { x: (h >> 9) % 34, y: 26 + ((h >> 3) % 12), r: 8 + ((h >> 10) % 8), fill: c3, op: 0.6 }
    ];
    var circles = shapes.map(function (s) { return '<circle cx="' + s.x + '" cy="' + s.y + '" r="' + s.r + '" fill="' + s.fill + '" opacity="' + s.op + '"/>'; }).join('');
    return '<svg class="tcard-avatar" width="' + size + '" height="' + size + '" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<defs><clipPath id="' + uid + '"><circle cx="20" cy="20" r="20"/></clipPath></defs>'
      + '<g clip-path="url(#' + uid + ')" transform="rotate(' + rot + ' 20 20)">'
      + '<rect width="40" height="40" fill="' + c1 + '" opacity="0.16"/>' + circles
      + '</g></svg>';
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

  // Plain (unsigned) percentage — for win rate, which isn't a +/- delta.
  function fmtPlainPct(p) {
    if (p == null) return '—';
    return p.toFixed(1) + '%';
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
    var roiPositive = (card.raw_weighted_roi_pct != null ? card.raw_weighted_roi_pct : 0) >= 0;
    var flexKnown = card.flex_score != null;
    var flexDisplay = flexKnown ? String(card.flex_score) : '—';
    var ev = evidenceLine(card.evidence);
    var streakCls = card.streak && card.streak.type ? ('tcard-streak is-' + card.streak.type) : '';
    var streakText = card.streak && card.streak.count
      ? card.streak.count + (card.streak.type === 'win' ? 'W' : card.streak.type === 'loss' ? 'L' : 'P') + ' streak'
      : null;
    // Canonical trader profile is /@handle (per CLAUDE.md, since 2026-07-30)
    // — /trader/:param only resolves a REAL 0x wallet address (redirecting
    // to /@handle server-side); anything else, including card.user_id
    // (an internal UUID, not an address), falls through to the legacy
    // trader.html page and prints "INVALID WALLET ADDRESS". Link straight
    // to the canonical route when a handle exists; fall back to the real
    // wallet address (which /trader/:address DOES handle correctly) only
    // when there's no handle yet.
    var profileHref = card.username ? '/@' + esc(card.username)
      : card.polymarket_address ? '/trader/' + esc(card.polymarket_address)
      : '#';

    // "Get in the trade" — only when the server has confirmed (live gamma)
    // the evidence trade's market is genuinely still open, and only on a
    // WIN (never prompt toward the same trade that lost this wallet
    // money). A closed-trade evidence line can easily point at a market
    // that has since resolved; a CTA that can't work must never render
    // (same rule home-kings.html's live-calls CTA follows). copy_user_id
    // attributes the resulting trade to this call — provenance, not a
    // claim the trader currently holds the position.
    var ctaHtml = '';
    if (variant !== 'compact' && card.evidence && card.evidence.result === 'win' && card.evidence.trade) {
      var trade = card.evidence.trade;
      var sideLower = card.evidence.side.toLowerCase();
      var priceC = Math.round(trade.current_price * 100) + '¢';
      // esc() the fully-assembled href, not its pieces — a raw "&" inserted
      // via innerHTML is live HTML, not a literal character (e.g.
      // "&copy_user_id" parses as the legacy "&copy" named entity).
      var tradeHref = '/market/' + encodeURIComponent(trade.slug)
        + '?from=trader&side=' + encodeURIComponent(sideLower) + '&size=25'
        + (card.user_id ? '&copy_user_id=' + encodeURIComponent(card.user_id) : '');
      ctaHtml = '<a class="tcard-cta" href="' + esc(tradeHref) + '">Trade ' + esc(card.evidence.side) + ' at ' + esc(priceC) + ' on Polymarket &rarr;</a>';
    }

    var html = '<article class="' + cls + '" data-user-id="' + esc(card.user_id) + '">'
      + '<a class="tcard-link" href="' + profileHref + '">';

    // Identity glyph ring reflects current streak — green hot, red cold,
    // neutral otherwise — so the eye can scan a rail for "who's on a run"
    // before reading a single number.
    var avSeed = card.polymarket_address || card.username || card.user_id;
    var ringCls = card.streak && card.streak.type === 'win' ? 'is-hot' : card.streak && card.streak.type === 'loss' ? 'is-cold' : '';

    html += '<div class="tcard-identity">'
      + '<div class="tcard-avatar-wrap ' + ringCls + '">' + avatarHtml(avSeed, variant === 'hero' ? 40 : variant === 'compact' ? 26 : 34) + '</div>'
      + '<div class="tcard-handle">' + esc(handle(card)) + '</div>'
      + (card.whale_rank ? '<div class="tcard-rank">#' + esc(card.whale_rank) + '</div>' : '')
      + '</div>';

    // Hero number = Flex Score (composite, sample-adjusted 0-100 rating —
    // lib/flex-score.js), not raw ROI. '—' when this wallet's nightly
    // recompute hasn't produced one yet; never fabricate a number.
    // "?" opens an inline explainer (toggleFlexInfo below) rather than a
    // floating tooltip — this component renders inside horizontally
    // scrolling rails on some hosts, and a positioned popover would clip.
    // stopPropagation/preventDefault since the whole card is an <a>.
    html += '<div class="tcard-flexhero' + (flexKnown ? '' : ' is-mute') + '">'
      + '<span class="tcard-flexscore">' + esc(flexDisplay) + '</span>'
      + '<span class="tcard-flexlabel">Flex Score'
        + '<button type="button" class="tcard-flexinfo-btn" aria-label="What is Flex Score?" onclick="event.preventDefault();event.stopPropagation();HFXTraderCard.toggleFlexInfo(this);">?</button>'
      + '</span>'
      + '</div>'
      + '<div class="tcard-flexinfo" hidden>A 0–100 rating built from five weighted parts: accuracy (35), calibration (25), P&amp;L quality (20), consistency (10), breadth (10). Recomputed as trades resolve — bad calls lower it, good calls raise it, inactivity decays it.</div>';

    html += '<div class="tcard-verdict">' + esc(card.verdict) + '</div>';

    // Supporting stat row — win rate, realized ROI, trade count. Smaller and
    // muted; the Flex Score above is what the eye lands on first. n stays
    // visible (score never renders without its sample size) as plain
    // language ("N trades") instead of "n=" notation.
    html += '<div class="tcard-stats">'
      + '<div class="tcard-stat"><span class="tcard-stat-val">' + esc(fmtPlainPct(card.win_rate_pct)) + '</span><span class="tcard-stat-lbl">win rate</span></div>'
      + '<div class="tcard-stat"><span class="tcard-stat-val ' + (roiPositive ? 'is-positive' : 'is-negative') + '">' + esc(fmtPct(card.raw_weighted_roi_pct)) + '</span><span class="tcard-stat-lbl">ROI</span></div>'
      + '<div class="tcard-stat"><span class="tcard-stat-val">' + esc(card.n) + '</span><span class="tcard-stat-lbl">trades</span></div>'
      + '</div>';

    if (card.scope_label) {
      html += '<div class="tcard-scope">' + esc(card.scope_label) + '</div>';
    }

    // Compact style/risk flag — so a promoted card never shows a win rate
    // with no context on how it was earned (rule 3: no naked win). Full
    // disclosure is on the profile; this is the one-line version.
    if (card.style_flag && card.style_flag.text) {
      var sfCls = 'tcard-styleflag' + (card.style_flag.key === 'early_exit' ? ' is-warn' : '');
      html += '<div class="' + sfCls + '">' + esc(card.style_flag.text) + '</div>';
    }

    // Evidence callout — restyled as the card's proof-of-call moment (louder
    // than a plain text line: colored band, tag, bigger multiplier) since
    // this IS the receipt the rest of the card's score is built on. Still a
    // resolved, past-tense call (never a live "buy now" prompt) — score+n
    // above it and the win/loss framing keep rule 3 intact either way.
    if (variant !== 'compact' && ev) {
      var evResult = card.evidence && card.evidence.result === 'win' ? 'is-win' : 'is-loss';
      var evTag = evResult === 'is-win' ? 'VERIFIED WIN' : 'VERIFIED LOSS';
      html += '<div class="tcard-evidence ' + evResult + '">'
        + '<div class="tcard-evidence-tag">' + evTag + '</div>'
        + '<div class="tcard-evidence-line">' + ev.line + '</div>'
        + '<div class="tcard-evidence-q">' + esc((ev.question || '').slice(0, 90)) + '</div>'
        + '</div>';
    }

    html += '<div class="tcard-form">'
      + sparkline(card.form)
      + (streakText ? '<span class="' + streakCls + '">' + esc(streakText) + '</span>' : '')
      + '</div>';

    html += '</a>' // close .tcard-link
      + ctaHtml
      + '</article>';
    return html;
  }

  // Toggles the inline explainer below the Flex Score hero. `btn` is the
  // "?" button itself; the explainer div is its next sibling up the tree
  // (button -> tcard-flexlabel -> tcard-flexhero -> next sibling).
  function toggleFlexInfo(btn) {
    var hero = btn.closest('.tcard-flexhero');
    var info = hero && hero.nextElementSibling;
    if (!info || !info.classList.contains('tcard-flexinfo')) return;
    info.hidden = !info.hidden;
  }

  window.HFXTraderCard = { render: render, sparkline: sparkline, esc: esc, toggleFlexInfo: toggleFlexInfo, avatarHtml: avatarHtml };
})();
