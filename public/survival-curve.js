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
    var pts = [{ x: 0, label: 'Bell', prob: 1 }];
    var sorted = thresholds.slice().sort(function(a, b) { return a.round - b.round; });
    for (var i = 0; i < sorted.length; i++) {
      pts.push({
        x: sorted[i].round,
        label: 'R' + Math.ceil(sorted[i].round),
        prob: sorted[i].prob,
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
    var modalClause = modal ? '. Modal: R' + modal.round + ' (' + Math.round(modal.mass * 100) + '%)' : '';
    return durationRead + methodClause + modalClause + '.';
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
    // drop, between (modalIdx-1).x and modalIdx.x.
    var modalZone = '';
    if (modal && curve.length >= 2) {
      var idx = curve.findIndex(function(c) { return Math.ceil(c.x) === modal.round && c.x > 0; });
      if (idx > 0) {
        var x0 = xFor(curve[idx - 1].x);
        var x1 = xFor(curve[idx].x);
        modalZone = '<rect x="' + x0.toFixed(1) + '" y="' + MT + '" width="' + (x1 - x0).toFixed(1) + '" height="' + IH + '" fill="rgba(245,197,24,0.06)" />';
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

    // Modal annotation under the modal round's X-label
    var modalAnno = '';
    if (modal) {
      var anchorPt = pts.find(function(p) { return Math.ceil(p.raw) === modal.round && p.raw > 0; });
      if (anchorPt) {
        modalAnno = '<text x="' + anchorPt.x + '" y="' + (MT + IH + 28) + '" text-anchor="middle" class="hfx-sc-modal-lbl">↑ MODAL · ' + Math.round(modal.mass * 100) + '%</text>';
      }
    }

    // Data point markers + percent labels above each
    var markers = pts.map(function(p, i) {
      var dot = (i === 0)
        ? '<circle cx="' + p.x + '" cy="' + p.y + '" r="4" fill="#d63848" />'
        : '<circle cx="' + p.x + '" cy="' + p.y + '" r="4" fill="#0d0d0d" stroke="#d63848" stroke-width="2" />';
      var lbl = '<text x="' + p.x + '" y="' + Math.max(MT + 12, p.y - 8) + '" text-anchor="middle" class="hfx-sc-pct-lbl">' + Math.round(p.prob * 100) + '%</text>';
      return dot + lbl;
    }).join('');

    return [
      '<svg class="hfx-sc-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Fight survival curve">',
        '<text x="' + (ML + 4) + '" y="' + (MT - 4) + '" class="hfx-sc-axis-lbl" fill="#4a4570">P(Fight still going)</text>',
        modalZone,
        grid,
        '<path d="' + area + '" fill="rgba(214,56,72,0.13)" stroke="none" />',
        '<path d="' + line + '" fill="none" stroke="#d63848" stroke-width="2" stroke-linejoin="round" />',
        markers,
        xLabels,
        modalAnno,
      '</svg>',
    ].join('');
  }

  // ── Stats strip ─────────────────────────────────────────────────────

  function renderStats(modal, methods, curve, leagueAvg) {
    var modalCell = modal
      ? '<div class="hfx-sc-stat accent">' +
          '<div class="hfx-sc-stat-lbl">Modal Finish</div>' +
          '<div class="hfx-sc-stat-val">R' + modal.round + ' · ' + Math.round(modal.mass * 100) + '%</div>' +
          '<div class="hfx-sc-stat-cap">Likeliest finish window</div>' +
        '</div>'
      : '<div class="hfx-sc-stat"><div class="hfx-sc-stat-lbl">Modal Finish</div><div class="hfx-sc-stat-val">—</div></div>';

    var methodCell;
    if (methods && methods.length) {
      var top = methods[0];
      var avg = (leagueAvg && leagueAvg[top.name] != null) ? leagueAvg[top.name] : null;
      var capParts = [];
      if (avg != null) {
        var diff = Math.round((top.prob - avg) * 100);
        var sign = diff >= 0 ? '+' : '';
        capParts.push('vs UFC avg ' + Math.round(avg * 100) + '% (' + sign + diff + ')');
      } else {
        capParts.push('Top market-implied method');
      }
      methodCell =
        '<div class="hfx-sc-stat">' +
          '<div class="hfx-sc-stat-lbl">Method Tilt</div>' +
          '<div class="hfx-sc-stat-val">' + escapeHtml(top.name) + ' · ' + Math.round(top.prob * 100) + '%</div>' +
          '<div class="hfx-sc-stat-cap">' + capParts.join(' · ') + '</div>' +
        '</div>';
    } else {
      methodCell = '<div class="hfx-sc-stat"><div class="hfx-sc-stat-lbl">Method Tilt</div><div class="hfx-sc-stat-val">—</div><div class="hfx-sc-stat-cap">No method markets listed</div></div>';
    }

    var spread = curve.length >= 2 ? (curve[0].prob - curve[curve.length - 1].prob) * 100 : 0;
    var spreadCap;
    if (spread > 40)        spreadCap = 'Decisive market read';
    else if (spread < 15)   spreadCap = 'Coinflip — market unsure';
    else                    spreadCap = 'Open read';
    var spreadCell =
      '<div class="hfx-sc-stat">' +
        '<div class="hfx-sc-stat-lbl">Duration Spread</div>' +
        '<div class="hfx-sc-stat-val">' + Math.round(spread) + ' pts</div>' +
        '<div class="hfx-sc-stat-cap">' + spreadCap + '</div>' +
      '</div>';

    return modalCell + methodCell + spreadCell;
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

      root.innerHTML = [
        '<div class="hfx-sc-head">',
          '<div class="hfx-sc-h">Fight Forecast</div>',
          '<span class="hfx-sc-meta"><span class="live-dot"></span>Market-Implied · ' + curve.length + ' pts · Live</span>',
        '</div>',
        topline ? '<div class="hfx-sc-topline"><span class="arrow">▸</span><span><strong>' + escapeHtml(topline) + '</strong></span></div>' : '',
        '<div class="hfx-sc-svg-wrap">' + renderSvg(curve, modal) + '</div>',
        '<div class="hfx-sc-stats">' + renderStats(modal, methods, curve, leagueAvg) + '</div>',
      ].join('');
    }

    paint(opts.thresholds, opts.methods);

    return {
      update: function(next) {
        if (!next) return;
        paint(next.thresholds || opts.thresholds, next.methods || opts.methods);
      },
      destroy: function() { if (root.parentNode) root.parentNode.removeChild(root); },
    };
  }

  window.HFXSurvivalCurve = { mount: mount, buildCurve: buildCurve, findModalDrop: findModalDrop };
})();
