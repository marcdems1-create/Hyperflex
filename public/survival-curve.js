// HYPERFLEX <SurvivalCurve> — fight forecast SVG primitive.
//
// Mounts on /fight/<slug> directly under the main event hero, above
// the TradeComposer. Renders the round-by-round "P(fight still going)"
// area chart from the round-threshold + method markets at
// /api/fight/forecast?key=<fight-key>.
//
// Generic enough to drive any duration market — boxing rounds, tennis
// sets, soccer halftime/full-time, debate length. Caller passes
// thresholds + method markets + a duration unit ("Round" by default).
//
// USAGE
//   HFXSurvivalCurve.mount(targetEl, {
//     thresholds: [{round: 0.5, prob: 0.96}, {round: 1.5, prob: 0.78}, ...],
//     methods:    [{name: 'Submission', prob: 0.50}, {name: 'Decision', prob: 0.30}],
//     leagueAvg:  { Submission: 0.22, KO: 0.18, TKO: 0.30, Decision: 0.30 },
//     unit:       'Round',          // axis label, defaults to 'Round'
//     terminal:   'DEC',            // last X-axis tick label, defaults to 'DEC'
//     eventTitle: 'UFC 328 — Chimaev vs Strickland',
//   });
//
// Returns a handle with .update({thresholds, methods}) for live
// repaint without re-mounting, and .destroy() for cleanup.

(function() {
  'use strict';
  if (window.HFXSurvivalCurve) return; // singleton

  // ── Style injection — runs once per page ────────────────────────────
  var STYLE_INJECTED = false;
  function injectStyles() {
    if (STYLE_INJECTED) return;
    STYLE_INJECTED = true;
    var s = document.createElement('style');
    s.id = 'hfx-survival-curve-styles';
    s.textContent = [
      '.hfx-sc{background:#0d0d0d;border:1px solid #1f1f1f;border-radius:14px;padding:24px;font-family:Inter,system-ui,sans-serif;color:#f0f0f5;margin-bottom:18px}',
      '.hfx-sc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px;padding-left:10px;border-left:3px solid #f5c518}',
      '.hfx-sc-h{font-family:Inter,system-ui,sans-serif;font-size:18px;letter-spacing:-0.005em;color:#f0f0f5;font-weight:700}',
      '.hfx-sc-meta{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#6e6790;padding:4px 10px;border:1px solid #1f1f1f;background:#141414;border-radius:999px}',
      '.hfx-sc-meta .live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#3db468;box-shadow:0 0 6px #3db468;margin-right:6px;vertical-align:middle;animation:hfx-sc-pulse 1.6s ease-in-out infinite}',
      '@keyframes hfx-sc-pulse{0%,100%{opacity:1}50%{opacity:0.4}}',
      '.hfx-sc-topline{font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.45;color:#c5bedd;margin-bottom:18px;display:flex;gap:10px;align-items:flex-start}',
      '.hfx-sc-topline .arrow{color:#f5c518;font-weight:700;flex-shrink:0;margin-top:1px}',
      '.hfx-sc-topline strong{color:#f0f0f5;font-weight:700}',
      '.hfx-sc-svg-wrap{position:relative;width:100%;background:#0a0a0a;border-radius:10px;padding:10px;box-sizing:border-box}',
      '.hfx-sc-svg{display:block;width:100%;height:auto}',
      '.hfx-sc-axis-lbl{font-family:JetBrains Mono,ui-monospace,monospace;font-size:10px;letter-spacing:0.06em;color:#6e6790;text-transform:uppercase}',
      '.hfx-sc-pct-lbl{font-family:JetBrains Mono,ui-monospace,monospace;font-size:13px;font-weight:800;fill:#f0f0f5}',
      '.hfx-sc-modal-lbl{font-family:JetBrains Mono,ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:0.12em;fill:#f5c518}',
      '.hfx-sc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}',
      '.hfx-sc-stat{background:#141414;border:1px solid #1f1f1f;border-radius:10px;padding:14px 16px}',
      '.hfx-sc-stat.accent{background:rgba(245,197,24,0.06);border-color:rgba(245,197,24,0.32)}',
      '.hfx-sc-stat-lbl{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#6e6790;margin-bottom:8px;font-weight:700}',
      '.hfx-sc-stat-val{font-family:JetBrains Mono,ui-monospace,monospace;font-size:24px;font-weight:800;color:#f0f0f5;letter-spacing:-0.02em;line-height:1.1;font-variant-numeric:tabular-nums}',
      '.hfx-sc-stat.accent .hfx-sc-stat-val{color:#f5c518}',
      '.hfx-sc-stat-cap{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.10em;text-transform:uppercase;color:#4a4570;margin-top:6px}',
      '.hfx-sc-empty{font-family:JetBrains Mono,ui-monospace,monospace;font-size:12px;color:#6e6790;text-align:center;padding:24px;letter-spacing:0.06em}',
      '.hfx-sc-hint{font-family:JetBrains Mono,ui-monospace,monospace;font-size:10px;letter-spacing:0.10em;color:#6e6790;text-align:center;margin:6px 0 10px;text-transform:uppercase}',
      '.hfx-sc-hint .ic{color:#f5c518;margin-right:6px;font-weight:800}',
      '.hfx-sc-mk{cursor:pointer;transition:transform .12s}',
      '.hfx-sc-mk-bell{cursor:default}',
      '.hfx-sc-mk:not(.hfx-sc-mk-bell):hover .hfx-sc-mk-dot{r:7;fill:#f5c518;stroke:#f5c518}',
      '.hfx-sc-mk:not(.hfx-sc-mk-bell):hover .hfx-sc-pct-lbl{fill:#f5c518}',
      '.hfx-sc-mk.active .hfx-sc-mk-dot{fill:#f5c518;stroke:#f5c518}',
      '.hfx-sc-mk.active .hfx-sc-pct-lbl{fill:#f5c518}',
      '.hfx-sc-modal-zone{cursor:pointer;transition:fill .12s}',
      '.hfx-sc-modal-zone:hover{fill:rgba(245,197,24,0.14)}',
      '.hfx-sc-lean{display:inline-block;font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid #2a2a2a;color:#a8a4be}',
      '.hfx-sc-lean.up{color:#f5c518;border-color:rgba(245,197,24,0.35);background:rgba(245,197,24,0.06)}',
      '.hfx-sc-lean.down{color:#7fb6ff;border-color:rgba(77,159,255,0.35);background:rgba(77,159,255,0.06)}',
      '@media(max-width:560px){.hfx-sc-stats{grid-template-columns:1fr;gap:10px}.hfx-sc-stat-val{font-size:20px}.hfx-sc{padding:18px}.hfx-sc-h{font-size:16px}}',
    ].join('');
    document.head.appendChild(s);
  }

  // ── Forecast math primitives ────────────────────────────────────────

  // Build the curve points from thresholds. Always anchored at
  // (0, 100%) — the fight is 100% still going at the bell. Each
  // threshold P(round > N.5) becomes the next point on the curve.
  // Final point is (terminal, smallest threshold prob) — typically
  // P(decision) on UFC fights, since "fight goes to decision" =
  // "fight lasted past 4.5 rounds" for a 5-round bout.
  function buildCurve(thresholds) {
    if (!thresholds || !thresholds.length) return [];
    var pts = [{ x: 0, label: 'Bell', prob: 1, slug: null, question: null }];
    var sorted = thresholds.slice().sort(function(a, b) { return a.round - b.round; });
    for (var i = 0; i < sorted.length; i++) {
      pts.push({
        x: sorted[i].round,
        label: 'R' + Math.ceil(sorted[i].round),
        prob: sorted[i].prob,
        slug: sorted[i].slug || null,
        question: sorted[i].question || null,
      });
    }
    return pts;
  }

  // Find the round with the steepest probability drop — the modal
  // finish window. Returns { round, drop, mass } where mass is the
  // probability mass attributable to that round (curve[i] - curve[i+1]).
  function findModalDrop(curve) {
    if (curve.length < 2) return null;
    var maxDrop = 0;
    var modalIdx = 1;
    for (var i = 1; i < curve.length; i++) {
      var drop = curve[i - 1].prob - curve[i].prob;
      if (drop > maxDrop) {
        maxDrop = drop;
        modalIdx = i;
      }
    }
    return {
      round: Math.ceil(curve[modalIdx].x),
      drop: maxDrop,
      mass: maxDrop,
      slug: curve[modalIdx].slug || null,
    };
  }

  // Auto-generate the topline insight string from the curve shape +
  // top method market. Brief specced four duration reads:
  //   "Short fight"      curve drops >40 pts by R3
  //   "Goes the distance" curve stays >50% past R4
  //   "Decisive read"    total spread >40 pts
  //   "Coinflip"         total spread <15 pts
  function buildTopline(curve, methods, modal) {
    if (!curve.length) return null;
    var spread = (curve[0].prob - curve[curve.length - 1].prob) * 100;
    var probAtR3 = null, probAfterR4 = null;
    for (var i = 0; i < curve.length; i++) {
      if (curve[i].x >= 3 && probAtR3 == null) probAtR3 = curve[i].prob;
      if (curve[i].x > 4 && probAfterR4 == null) probAfterR4 = curve[i].prob;
    }
    var dropByR3 = probAtR3 != null ? (1 - probAtR3) * 100 : 0;

    var durationRead;
    if (dropByR3 > 40)              durationRead = 'Short fight';
    else if (probAfterR4 != null && probAfterR4 > 0.5) durationRead = 'Goes the distance';
    else if (spread > 40)           durationRead = 'Decisive read';
    else if (spread < 15)           durationRead = 'Coinflip';
    else                            durationRead = 'Open read';

    var methodClause = '';
    if (methods && methods.length) {
      var top = methods[0];
      methodClause = ', ' + top.name.toLowerCase() + ' likely (' + Math.round(top.prob * 100) + '%)';
    }
    return durationRead + methodClause + '.';
  }

  // ── SVG render ──────────────────────────────────────────────────────

  function renderSvg(curve, modal) {
    // viewBox 0..680 wide, 0..240 tall. Inner plot area:
    //   left margin 36 (Y-axis labels), right margin 16,
    //   top margin 16, bottom margin 28 (X-axis labels).
    var W = 680, H = 360;
    var ML = 44, MR = 18, MT = 22, MB = 36;
    var IW = W - ML - MR;
    var IH = H - MT - MB;

    // X scale: linear over [0, terminal_round]. Terminal = max curve x
    // or 5 for UFC (5-round main events).
    var maxX = Math.max(5, curve[curve.length - 1].x);
    function xFor(r) { return ML + (r / maxX) * IW; }
    function yFor(p) { return MT + (1 - p) * IH; }

    var pts = curve.map(function(pt) { return { x: xFor(pt.x), y: yFor(pt.prob), label: pt.label, prob: pt.prob, raw: pt.x }; });

    // Build the polyline path + the area-fill path (close down to
    // baseline + back to start so the fill is a clean trapezoid).
    var line = pts.map(function(p, i) { return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1].x.toFixed(1) + ',' + (MT + IH) + ' L' + pts[0].x.toFixed(1) + ',' + (MT + IH) + ' Z';

    // Modal-finish yellow zone: highlight the column for the steepest
    // drop, between (modalIdx-1).x and modalIdx.x. Tappable — clicking
    // the zone is a shortcut to the most-likely-finish market.
    var modalZone = '';
    if (modal && curve.length >= 2) {
      var idx = curve.findIndex(function(c) { return Math.ceil(c.x) === modal.round && c.x > 0; });
      if (idx > 0) {
        var x0 = xFor(curve[idx - 1].x);
        var x1 = xFor(curve[idx].x);
        var modalSlug = curve[idx].slug || '';
        modalZone = '<rect class="hfx-sc-modal-zone" data-slug="' + escapeHtml(modalSlug) + '" x="' + x0.toFixed(1) + '" y="' + MT + '" width="' + (x1 - x0).toFixed(1) + '" height="' + IH + '" fill="rgba(245,197,24,0.06)" />';
      }
    }

    // Y-axis horizontal gridlines at 25 / 50 / 75 / 100%
    var grid = '';
    [0.25, 0.5, 0.75, 1].forEach(function(p) {
      var y = yFor(p);
      grid += '<line x1="' + ML + '" y1="' + y + '" x2="' + (W - MR) + '" y2="' + y + '" stroke="rgba(255,255,255,0.04)" stroke-width="1" stroke-dasharray="2,3" />';
      grid += '<text x="' + (ML - 6) + '" y="' + (y + 3) + '" text-anchor="end" class="hfx-sc-axis-lbl" fill="#4a4570">' + Math.round(p * 100) + '</text>';
    });
    // Solid baseline at 0%
    grid += '<line x1="' + ML + '" y1="' + (MT + IH) + '" x2="' + (W - MR) + '" y2="' + (MT + IH) + '" stroke="rgba(255,255,255,0.10)" stroke-width="1" />';

    // X-axis labels under each curve point
    var xLabels = pts.map(function(p) {
      return '<text x="' + p.x + '" y="' + (MT + IH + 16) + '" text-anchor="middle" class="hfx-sc-axis-lbl" fill="#6e6790">' + p.label + '</text>';
    }).join('');

    // Modal annotation under the modal round's X-label — plain English.
    var modalAnno = '';
    if (modal) {
      var anchorPt = pts.find(function(p) { return Math.ceil(p.raw) === modal.round && p.raw > 0; });
      if (anchorPt) {
        modalAnno = '<text x="' + anchorPt.x + '" y="' + (MT + IH + 30) + '" text-anchor="middle" class="hfx-sc-modal-lbl">↑ Most likely to end here · ' + Math.round(modal.mass * 100) + '%</text>';
      }
    }

    // Data point markers + percent labels above each. Each non-bell
    // marker is a tappable group that maps to its threshold market —
    // clicking R2 swaps the composer to "O/U 1.5 Rounds" YES, etc.
    // The bell point is non-tradeable (no market for "fight has
    // started") so it stays visual-only.
    var markers = pts.map(function(p, i) {
      var pct = Math.round(p.prob * 100) + '%';
      if (i === 0) {
        return [
          '<g class="hfx-sc-mk hfx-sc-mk-bell">',
            '<circle cx="' + p.x + '" cy="' + p.y + '" r="4" fill="#d63848" />',
            '<text x="' + p.x + '" y="' + Math.max(MT + 12, p.y - 10) + '" text-anchor="middle" class="hfx-sc-pct-lbl">' + pct + '</text>',
          '</g>',
        ].join('');
      }
      var slug = p.slug || '';
      var qTitle = p.question ? escapeHtml(p.question) : 'Trade this round';
      return [
        '<g class="hfx-sc-mk" data-slug="' + escapeHtml(slug) + '">',
          '<title>' + qTitle + ' · ' + pct + '</title>',
          // Invisible hit area — bigger than the visible dot so taps
          // land on touch devices.
          '<circle class="hfx-sc-mk-hit" cx="' + p.x + '" cy="' + p.y + '" r="14" fill="transparent" />',
          '<circle class="hfx-sc-mk-dot" cx="' + p.x + '" cy="' + p.y + '" r="5" fill="#0d0d0d" stroke="#d63848" stroke-width="2.5" />',
          '<text x="' + p.x + '" y="' + Math.max(MT + 12, p.y - 10) + '" text-anchor="middle" class="hfx-sc-pct-lbl">' + pct + '</text>',
        '</g>',
      ].join('');
    }).join('');

    return [
      '<svg class="hfx-sc-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Fight survival curve">',
        '<text x="' + (ML + 4) + '" y="' + (MT - 6) + '" class="hfx-sc-axis-lbl" fill="#6e6790">Chance fight still going</text>',
        modalZone,
        grid,
        '<path d="' + area + '" fill="rgba(214,56,72,0.13)" stroke="none" pointer-events="none" />',
        '<path d="' + line + '" fill="none" stroke="#d63848" stroke-width="2" stroke-linejoin="round" pointer-events="none" />',
        markers,
        xLabels,
        modalAnno,
      '</svg>',
    ].join('');
  }

  // ── Stats strip ─────────────────────────────────────────────────────

  // Lean badge for HOW IT ENDS — converts (prob - leagueAvg) into a
  // small qualitative chip so the stat doesn't read like analyst noise.
  function leanBadge(prob, avg) {
    if (avg == null) return '';
    var diff = prob - avg;
    if (diff >= 0.30)  return '<span class="hfx-sc-lean up">↑ well above avg</span>';
    if (diff >= 0.15)  return '<span class="hfx-sc-lean up">↑ above avg</span>';
    if (diff <= -0.15) return '<span class="hfx-sc-lean down">↓ below avg</span>';
    return '<span class="hfx-sc-lean">≈ league avg</span>';
  }

  function renderStats(modal, methods, curve, leagueAvg) {
    // MOST LIKELY FINISH — was "MODAL FINISH". Plain English value.
    var modalCell = modal
      ? '<div class="hfx-sc-stat accent">' +
          '<div class="hfx-sc-stat-lbl">Most Likely Finish</div>' +
          '<div class="hfx-sc-stat-val">Round ' + modal.round + '</div>' +
          '<div class="hfx-sc-stat-cap">' + Math.round(modal.mass * 100) + '% chance fight ends here</div>' +
        '</div>'
      : '<div class="hfx-sc-stat"><div class="hfx-sc-stat-lbl">Most Likely Finish</div><div class="hfx-sc-stat-val">—</div></div>';

    // HOW IT ENDS — was "METHOD TILT". Drops the "vs UFC avg X% (+Y)"
    // analyst caption in favor of a small qualitative lean badge.
    var methodCell;
    if (methods && methods.length) {
      var top = methods[0];
      var avg = (leagueAvg && leagueAvg[top.name] != null) ? leagueAvg[top.name] : null;
      var lean = leanBadge(top.prob, avg);
      methodCell =
        '<div class="hfx-sc-stat">' +
          '<div class="hfx-sc-stat-lbl">How It Ends</div>' +
          '<div class="hfx-sc-stat-val">' + escapeHtml(top.name) + ' · ' + Math.round(top.prob * 100) + '%</div>' +
          '<div class="hfx-sc-stat-cap">' + (lean || 'Top market-implied finish') + '</div>' +
        '</div>';
    } else {
      methodCell = '<div class="hfx-sc-stat"><div class="hfx-sc-stat-lbl">How It Ends</div><div class="hfx-sc-stat-val">—</div><div class="hfx-sc-stat-cap">No finish markets listed</div></div>';
    }

    // FIGHT LENGTH — was "DURATION SPREAD". Replaces "70 pts" with a
    // plain-English read tied to the curve shape.
    var spread = curve.length >= 2 ? (curve[0].prob - curve[curve.length - 1].prob) * 100 : 0;
    var lengthVal, lengthCap;
    if (spread > 40)      { lengthVal = 'Likely short';     lengthCap = 'Markets agree the fight ends early'; }
    else if (spread < 15) { lengthVal = 'Could go anywhere'; lengthCap = 'Markets unsure on duration'; }
    else                  { lengthVal = 'Open read';        lengthCap = 'Mixed signals on length'; }
    var lengthCell =
      '<div class="hfx-sc-stat">' +
        '<div class="hfx-sc-stat-lbl">Fight Length</div>' +
        '<div class="hfx-sc-stat-val">' + lengthVal + '</div>' +
        '<div class="hfx-sc-stat-cap">' + lengthCap + '</div>' +
      '</div>';

    return modalCell + methodCell + lengthCell;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  // UFC league averages (rough rolling 12-month finish-method splits;
  // swap to a live lookup later). Sums to ~100%; no-contest excluded.
  var DEFAULT_LEAGUE_AVG = { Submission: 0.22, KO: 0.18, TKO: 0.30, Decision: 0.30 };

  function mount(targetEl, opts) {
    if (!targetEl) throw new Error('HFXSurvivalCurve.mount: targetEl required');
    opts = opts || {};
    injectStyles();

    var root = document.createElement('div');
    root.className = 'hfx-sc';
    targetEl.innerHTML = '';
    targetEl.appendChild(root);

    var _activeSlug = opts.activeSlug || null;

    function paint(thresholds, methods) {
      var curve = buildCurve(thresholds || []);
      if (!curve.length) {
        root.innerHTML = [
          '<div class="hfx-sc-head">',
            '<div class="hfx-sc-h">Fight Forecast</div>',
            '<span class="hfx-sc-meta">Awaiting round/method markets</span>',
          '</div>',
          '<div class="hfx-sc-empty">No round-threshold markets listed yet for this fight. Check back closer to the bell.</div>',
        ].join('');
        return;
      }
      var modal = findModalDrop(curve);
      var topline = buildTopline(curve, methods, modal);
      var leagueAvg = opts.leagueAvg || DEFAULT_LEAGUE_AVG;
      var hasPickHandler = (typeof opts.onPickSlug === 'function');

      root.innerHTML = [
        '<div class="hfx-sc-head">',
          '<div class="hfx-sc-h">Fight Forecast</div>',
          '<span class="hfx-sc-meta"><span class="live-dot"></span>Market-Implied · Live</span>',
        '</div>',
        topline ? '<div class="hfx-sc-topline"><span class="arrow">▸</span><span><strong>' + escapeHtml(topline) + '</strong></span></div>' : '',
        hasPickHandler ? '<div class="hfx-sc-hint"><span class="ic">▸</span>Tap any point on the curve to trade that round</div>' : '',
        '<div class="hfx-sc-svg-wrap">' + renderSvg(curve, modal) + '</div>',
        '<div class="hfx-sc-stats">' + renderStats(modal, methods, curve, leagueAvg) + '</div>',
      ].join('');

      // Mark the active marker (composer is currently showing this
      // market). Read post-render so the SVG nodes exist.
      paintActive();
    }

    function paintActive() {
      var nodes = root.querySelectorAll('.hfx-sc-mk[data-slug]');
      for (var i = 0; i < nodes.length; i++) {
        var slug = nodes[i].getAttribute('data-slug');
        nodes[i].classList.toggle('active', !!_activeSlug && slug === _activeSlug);
      }
    }

    // Click delegate — handles both marker taps and modal-zone taps.
    function onClick(e) {
      var hit = e.target.closest && e.target.closest('.hfx-sc-mk[data-slug], .hfx-sc-modal-zone[data-slug]');
      if (!hit) return;
      var slug = hit.getAttribute('data-slug');
      if (!slug) return;
      if (typeof opts.onPickSlug === 'function') opts.onPickSlug(slug);
    }
    root.addEventListener('click', onClick);

    paint(opts.thresholds, opts.methods);

    return {
      update: function(next) {
        if (!next) return;
        if (next.activeSlug !== undefined) _activeSlug = next.activeSlug;
        if (next.thresholds || next.methods) {
          paint(next.thresholds || opts.thresholds, next.methods || opts.methods);
        } else {
          paintActive();
        }
      },
      destroy: function() {
        root.removeEventListener('click', onClick);
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
  }

  window.HFXSurvivalCurve = { mount: mount, buildCurve: buildCurve, findModalDrop: findModalDrop };
})();
