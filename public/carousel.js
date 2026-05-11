// public/carousel.js
//
// Polymarket Hot Markets Carousel. Replaces the single-event rolling
// banner (public/hero-banner.js) on /feed (and /explore where loaded).
// Renders the top 7 events by 24h volume as a horizontal carousel with
// auto-rotate + swipe/arrow override.
//
// Self-injecting like hero-banner.js — drops itself in after #nav-root.
// Fetches /api/hot-markets/carousel on mount. If the endpoint returns
// zero tiles, the slot collapses silently (no empty placeholder).
//
// Tile layout (per Hantavirus reference, May 11 2026):
//   LEFT (40%): icon + title, big "X% chance" w/ delta, Yes/No prices,
//               up to 3 news citations
//   RIGHT (60%): sparkline w/ Y-axis %, X-axis dates, dotted price line,
//                current-price end marker
//   FOOTER (full-width): volume left, end date right

(function () {
  'use strict';
  if (window.__HFX_CAROUSEL_LOADED__) return;
  window.__HFX_CAROUSEL_LOADED__ = true;

  // Don't render if user dismissed the previous banner — same key as
  // hero-banner.js so opt-out carries over during the rollout.
  try { if (localStorage.getItem('hero_banner_dismissed') === '1') return; } catch (_) {}

  var AUTO_ROTATE_MS  = 5000;
  var RESUME_AFTER_MS = 10000;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtVol(v) {
    v = Number(v || 0);
    if (!isFinite(v) || v <= 0) return '$0';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  }

  function fmtEndDate(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtAxisDate(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fmtCents(p) {
    if (p == null) return null;
    var v = Number(p);
    if (!isFinite(v) || v < 0) return null;
    if (v > 1) v = v / 100;
    return Math.round(v * 100) + '¢';
  }

  function fmtChance(p) {
    if (p == null) return '—';
    var v = Number(p);
    if (!isFinite(v) || v < 0) return '—';
    if (v > 1) v = v / 100;
    var pct = v * 100;
    if (pct >= 1) return Math.round(pct) + '%';
    if (pct > 0)  return '<1%';
    return '0%';
  }

  function fmtDelta(d) {
    if (d == null || !isFinite(d)) return null;
    var pct = Math.round(Math.abs(d) * 100);
    if (pct === 0) return null;
    var sign = d > 0 ? '+' : '−';
    return { text: sign + pct + '%', up: d > 0 };
  }

  // Build the sparkline SVG with Y-axis (%) labels, X-axis date labels,
  // a dotted baseline at the current price, and an end-of-line price
  // marker. Returns '' when there aren't enough points to plot.
  function sparklineSvgFull(points, opts) {
    if (!Array.isArray(points) || points.length < 2) return '';

    var W = 420, H = 168;
    var padL = 36, padR = 12, padT = 10, padB = 22;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    var min = Math.min.apply(null, points);
    var max = Math.max.apply(null, points);
    // Pad the visible range so the line doesn't kiss the top/bottom and
    // so we get a sensible set of axis ticks for very flat series.
    var range = max - min;
    if (range < 0.04) {
      var mid = (max + min) / 2;
      min = Math.max(0, mid - 0.05);
      max = Math.min(1, mid + 0.05);
      range = max - min;
    }

    // Choose ~4 Y-axis ticks rounded to a sensible step.
    function pickStep(r) {
      var candidates = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25];
      for (var i = 0; i < candidates.length; i++) {
        if (r / candidates[i] <= 5) return candidates[i];
      }
      return 0.25;
    }
    var step = pickStep(range);
    var firstTick = Math.ceil(min / step) * step;
    var ticks = [];
    for (var v = firstTick; v <= max + 1e-9 && ticks.length < 6; v += step) ticks.push(v);

    function yFor(p) {
      return padT + (1 - (p - min) / range) * innerH;
    }
    function xFor(i) {
      return padL + (i / (points.length - 1)) * innerW;
    }

    var stroke = opts && opts.upward ? '#00e68a' : '#ff4d6a';
    var currentPrice = points[points.length - 1];
    var currentY = yFor(currentPrice);

    // Polyline.
    var coords = points.map(function (p, i) {
      return xFor(i).toFixed(1) + ',' + yFor(p).toFixed(1);
    }).join(' ');

    // Area under line for subtle fill.
    var areaCoords = padL.toFixed(1) + ',' + (padT + innerH).toFixed(1) + ' '
      + coords + ' '
      + (padL + innerW).toFixed(1) + ',' + (padT + innerH).toFixed(1);

    // Y-axis tick lines + labels.
    var yTicks = ticks.map(function (val) {
      var y = yFor(val);
      var label = Math.round(val * 100) + '%';
      return '<line x1="' + padL + '" x2="' + (padL + innerW) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>'
        + '<text x="' + (padL - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="10" fill="#6a6a7a" font-family="JetBrains Mono,monospace">' + label + '</text>';
    }).join('');

    // X-axis date labels — start, middle, end.
    var xLabels = '';
    if (opts && opts.startDate && opts.endDate) {
      var dStart = fmtAxisDate(opts.startDate);
      var dEnd   = fmtAxisDate(opts.endDate);
      xLabels = '<text x="' + padL + '" y="' + (H - 4) + '" text-anchor="start" font-size="10" fill="#6a6a7a" font-family="JetBrains Mono,monospace">' + esc(dStart) + '</text>'
        + '<text x="' + (padL + innerW) + '" y="' + (H - 4) + '" text-anchor="end" font-size="10" fill="#6a6a7a" font-family="JetBrains Mono,monospace">' + esc(dEnd) + '</text>';
    }

    // Dotted current-price baseline + end marker.
    var baseline = '<line x1="' + padL + '" x2="' + (padL + innerW) + '" y1="' + currentY.toFixed(1) + '" y2="' + currentY.toFixed(1) + '" stroke="rgba(255,255,255,0.18)" stroke-width="1" stroke-dasharray="3,3"/>';
    var endX = padL + innerW;
    var endMarker = '<circle cx="' + endX.toFixed(1) + '" cy="' + currentY.toFixed(1) + '" r="3.5" fill="' + stroke + '" stroke="#0d0d12" stroke-width="1.5"/>';

    return ''
      + '<svg class="hfx-c-spark-full" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">'
      +   '<defs><linearGradient id="hfx-spark-fill" x1="0" y1="0" x2="0" y2="1">'
      +     '<stop offset="0%" stop-color="' + stroke + '" stop-opacity="0.18"/>'
      +     '<stop offset="100%" stop-color="' + stroke + '" stop-opacity="0"/>'
      +   '</linearGradient></defs>'
      +   yTicks
      +   '<polygon fill="url(#hfx-spark-fill)" points="' + areaCoords + '"/>'
      +   '<polyline fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="' + coords + '"/>'
      +   baseline
      +   endMarker
      +   xLabels
      + '</svg>';
  }

  // Derive a sparkline window's start date (7 days ago) given the
  // sample count assumed by the backend (~6h interval over 7d).
  function sparkStartDate() {
    return new Date(Date.now() - 7 * 86400000).toISOString();
  }
  function sparkEndDate() {
    return new Date().toISOString();
  }

  function newsRow(n) {
    var src  = esc(n.source || '');
    var head = esc(n.headline || '');
    if (!src && !head) return '';
    var sentiment = String(n.sentiment || 'neutral').toLowerCase();
    var dotColor = sentiment === 'positive' || sentiment === 'bullish' ? '#00e68a'
                 : sentiment === 'negative' || sentiment === 'bearish' ? '#ff4d6a'
                 : '#8b8a9a';
    return '<div class="hfx-c-news-row">'
      +   '<span class="hfx-c-news-dot" style="background:' + dotColor + '"></span>'
      +   '<span class="hfx-c-news-src">' + src + '</span>'
      +   '<span class="hfx-c-news-head">' + head + '</span>'
      + '</div>';
  }

  function renderTile(t) {
    var chance = fmtChance(t.yes_price);
    var yesCents = fmtCents(t.yes_price);
    var noCents  = fmtCents(t.no_price != null ? t.no_price : (t.yes_price != null ? 1 - Number(t.yes_price) : null));
    var delta = fmtDelta(t.yes_price_change_7d);
    var deltaHtml = delta
      ? '<span class="hfx-c-delta ' + (delta.up ? 'up' : 'down') + '">' + (delta.up ? '▲' : '▼') + ' ' + esc(delta.text) + '</span>'
      : '';

    var sparkHtml = '';
    if (Array.isArray(t.sparkline_7d) && t.sparkline_7d.length >= 2) {
      sparkHtml = sparklineSvgFull(t.sparkline_7d, {
        upward:    delta && delta.up,
        startDate: sparkStartDate(),
        endDate:   sparkEndDate(),
      });
    }

    var iconHtml = t.event_image_url
      ? '<img class="hfx-c-icon" src="' + esc(t.event_image_url) + '" alt="" loading="lazy">'
      : '<div class="hfx-c-icon hfx-c-icon-fallback">' + esc((t.event_title || '?').slice(0, 1).toUpperCase()) + '</div>';

    var newsHtml = '';
    if (Array.isArray(t.news_citations) && t.news_citations.length) {
      var rows = t.news_citations.slice(0, 3).map(newsRow).filter(Boolean).join('');
      if (rows) {
        newsHtml = '<div class="hfx-c-news"><div class="hfx-c-news-label">Related</div>' + rows + '</div>';
      }
    }

    var endLabel = fmtEndDate(t.end_date);
    var volLabel = t.volume_24h_label || fmtVol(t.volume_24h_usd);
    var slug = String(t.event_slug || '');
    var href = slug ? '/market/' + encodeURIComponent(slug) : '#';

    var yesBtn = yesCents
      ? '<a class="hfx-c-side-btn hfx-c-yes" href="' + esc(href) + '" data-stop="1"><span class="hfx-c-side-label">Yes</span><span class="hfx-c-side-price">' + esc(yesCents) + '</span></a>'
      : '';
    var noBtn = noCents
      ? '<a class="hfx-c-side-btn hfx-c-no" href="' + esc(href) + '" data-stop="1"><span class="hfx-c-side-label">No</span><span class="hfx-c-side-price">' + esc(noCents) + '</span></a>'
      : '';

    return ''
      + '<div class="hfx-c-tile" data-href="' + esc(href) + '" role="link" tabindex="0">'
      +   '<div class="hfx-c-body">'
      +     '<div class="hfx-c-left">'
      +       '<div class="hfx-c-head">'
      +         iconHtml
      +         '<div class="hfx-c-title">' + esc(t.event_title || t.market_question || 'Untitled market') + '</div>'
      +       '</div>'
      +       '<div class="hfx-c-chance-block">'
      +         '<div class="hfx-c-chance">' + esc(chance) + ' <span class="hfx-c-chance-sub">chance</span></div>'
      +         (deltaHtml ? '<div class="hfx-c-delta-row">' + deltaHtml + ' <span class="hfx-c-delta-period">7d</span></div>' : '')
      +       '</div>'
      +       (yesBtn || noBtn ? '<div class="hfx-c-sides">' + yesBtn + noBtn + '</div>' : '')
      +       newsHtml
      +     '</div>'
      +     '<div class="hfx-c-right">'
      +       (sparkHtml || '<div class="hfx-c-spark-empty">Price history unavailable</div>')
      +     '</div>'
      +   '</div>'
      +   '<div class="hfx-c-foot">'
      +     '<span class="hfx-c-vol">' + esc(volLabel) + ' Vol (24h)</span>'
      +     (endLabel ? '<span class="hfx-c-end">Ends ' + esc(endLabel) + '</span>' : '')
      +   '</div>'
      + '</div>';
  }

  function renderDots(count, activeIdx) {
    var out = '';
    for (var i = 0; i < count; i++) {
      out += '<button class="hfx-c-dot' + (i === activeIdx ? ' active' : '') + '" type="button" data-idx="' + i + '" aria-label="Tile ' + (i + 1) + ' of ' + count + '"></button>';
    }
    return out;
  }

  var css = ''
    + '#hfx-carousel{position:relative;max-width:1600px;margin:14px auto 18px;padding:0 24px;font-family:Inter,system-ui,-apple-system,sans-serif;color:#f0f0f5}'
    + '#hfx-carousel .hfx-c-frame{position:relative;background:#13131a;border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden}'
    + '#hfx-carousel .hfx-c-track{display:flex;transition:transform .4s cubic-bezier(.4,.0,.2,1);will-change:transform}'
    + '#hfx-carousel .hfx-c-tile{flex:0 0 100%;display:flex;flex-direction:column;padding:18px 22px 14px;box-sizing:border-box;cursor:pointer;text-decoration:none;color:inherit;border-right:1px solid rgba(255,255,255,0.03)}'
    + '#hfx-carousel .hfx-c-tile:hover{background:rgba(255,255,255,0.02)}'
    + '#hfx-carousel .hfx-c-tile:focus{outline:2px solid rgba(201,146,13,0.5);outline-offset:-4px}'
    + '#hfx-carousel .hfx-c-body{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);gap:24px;align-items:stretch}'
    + '#hfx-carousel .hfx-c-left{display:flex;flex-direction:column;gap:14px;min-width:0}'
    + '#hfx-carousel .hfx-c-right{display:flex;align-items:stretch;justify-content:stretch;min-width:0;min-height:168px}'
    + '#hfx-carousel .hfx-c-spark-full{width:100%;height:100%;display:block}'
    + '#hfx-carousel .hfx-c-spark-empty{display:flex;align-items:center;justify-content:center;width:100%;color:#4a4a5a;font-size:11px;font-family:JetBrains Mono,monospace;letter-spacing:0.04em}'
    + '#hfx-carousel .hfx-c-head{display:flex;align-items:flex-start;gap:12px}'
    + '#hfx-carousel .hfx-c-icon{width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#1a1a24}'
    + '#hfx-carousel .hfx-c-icon-fallback{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#2a2a3a,#1a1a24);color:#c9920d;font-family:JetBrains Mono,monospace;font-weight:800;font-size:18px}'
    + '#hfx-carousel .hfx-c-title{font-size:16px;font-weight:700;line-height:1.3;color:#f0f0f5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;flex:1;min-width:0}'
    + '#hfx-carousel .hfx-c-chance-block{display:flex;flex-direction:column;gap:2px}'
    + '#hfx-carousel .hfx-c-chance{font-family:JetBrains Mono,monospace;font-size:36px;font-weight:800;color:#c9920d;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;line-height:1}'
    + '#hfx-carousel .hfx-c-chance-sub{font-size:13px;font-weight:500;color:#8b8a9a;letter-spacing:0.02em;margin-left:4px;font-family:Inter,sans-serif}'
    + '#hfx-carousel .hfx-c-delta-row{display:flex;align-items:center;gap:6px}'
    + '#hfx-carousel .hfx-c-delta{font-family:JetBrains Mono,monospace;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px}'
    + '#hfx-carousel .hfx-c-delta.up{background:rgba(0,230,138,0.14);color:#00e68a}'
    + '#hfx-carousel .hfx-c-delta.down{background:rgba(255,77,106,0.14);color:#ff4d6a}'
    + '#hfx-carousel .hfx-c-delta-period{font-family:JetBrains Mono,monospace;font-size:10px;color:#6a6a7a;letter-spacing:0.06em;text-transform:uppercase}'
    + '#hfx-carousel .hfx-c-sides{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '#hfx-carousel .hfx-c-side-btn{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:8px;text-decoration:none;font-family:JetBrains Mono,monospace;font-weight:700;font-size:13px;transition:transform .1s,filter .1s;border:1px solid transparent}'
    + '#hfx-carousel .hfx-c-side-btn:hover{transform:translateY(-1px);filter:brightness(1.1)}'
    + '#hfx-carousel .hfx-c-yes{background:rgba(0,230,138,0.12);border-color:rgba(0,230,138,0.3);color:#00e68a}'
    + '#hfx-carousel .hfx-c-no{background:rgba(255,77,106,0.12);border-color:rgba(255,77,106,0.3);color:#ff4d6a}'
    + '#hfx-carousel .hfx-c-side-label{font-size:12px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.85}'
    + '#hfx-carousel .hfx-c-side-price{font-size:14px;font-weight:800}'
    + '#hfx-carousel .hfx-c-news{display:flex;flex-direction:column;gap:5px;font-family:Inter,sans-serif;font-size:12px;color:#cfcfd7;line-height:1.4;margin-top:2px}'
    + '#hfx-carousel .hfx-c-news-label{font-family:JetBrains Mono,monospace;font-size:9px;font-weight:800;color:#6a6a7a;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px}'
    + '#hfx-carousel .hfx-c-news-row{display:flex;gap:8px;align-items:baseline;min-width:0}'
    + '#hfx-carousel .hfx-c-news-dot{display:inline-block;width:5px;height:5px;border-radius:50%;flex-shrink:0;align-self:center}'
    + '#hfx-carousel .hfx-c-news-src{font-family:JetBrains Mono,monospace;font-size:9px;font-weight:800;color:#4d9fff;text-transform:uppercase;letter-spacing:0.06em;flex-shrink:0;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '#hfx-carousel .hfx-c-news-head{color:#cfcfd7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}'
    + '#hfx-carousel .hfx-c-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;font-family:JetBrains Mono,monospace;font-size:11px;color:#6a6a7a;letter-spacing:0.04em;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05)}'
    + '#hfx-carousel .hfx-c-vol{color:#cfcfd7;font-weight:700}'
    + '#hfx-carousel .hfx-c-end{color:#8b8a9a}'
    + '#hfx-carousel .hfx-c-nav{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;background:rgba(13,13,16,0.78);border:1px solid rgba(255,255,255,0.12);color:#f0f0f5;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;transition:background .15s;padding:0;line-height:1}'
    + '#hfx-carousel .hfx-c-nav:hover{background:rgba(13,13,16,0.95)}'
    + '#hfx-carousel .hfx-c-nav-prev{left:8px}'
    + '#hfx-carousel .hfx-c-nav-next{right:8px}'
    + '#hfx-carousel .hfx-c-dots{display:flex;justify-content:center;gap:6px;margin-top:10px;padding:0 24px}'
    + '#hfx-carousel .hfx-c-dot{width:6px;height:6px;padding:0;border-radius:50%;background:rgba(255,255,255,0.14);border:0;cursor:pointer;transition:background .15s,width .15s}'
    + '#hfx-carousel .hfx-c-dot.active{background:#c9920d;width:22px;border-radius:3px}'
    + '#hfx-carousel .hfx-c-dot:hover:not(.active){background:rgba(255,255,255,0.28)}'
    + '#hfx-carousel .hfx-c-close{position:absolute;top:6px;right:8px;width:24px;height:24px;border-radius:50%;background:transparent;border:0;color:#8b8a9a;font-size:18px;cursor:pointer;z-index:3;line-height:1;padding:0}'
    + '#hfx-carousel .hfx-c-close:hover{color:#f0f0f5}'
    + '@media(max-width:760px){'
    +   '#hfx-carousel{margin:10px auto 14px;padding:0 12px}'
    +   '#hfx-carousel .hfx-c-tile{padding:14px 16px 12px}'
    +   '#hfx-carousel .hfx-c-body{grid-template-columns:1fr;gap:14px}'
    +   '#hfx-carousel .hfx-c-right{min-height:140px;order:2}'
    +   '#hfx-carousel .hfx-c-left{order:1}'
    +   '#hfx-carousel .hfx-c-title{font-size:15px;-webkit-line-clamp:2}'
    +   '#hfx-carousel .hfx-c-chance{font-size:28px}'
    +   '#hfx-carousel .hfx-c-nav{display:none}'
    + '}';

  function injectStyles() {
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function mountAfterNav(wrapper) {
    var nav = document.getElementById('nav-root');
    if (nav && nav.parentNode) {
      var anchor = nav.nextSibling;
      while (anchor && anchor.nodeType === 1 && (anchor.tagName === 'SCRIPT' || anchor.tagName === 'STYLE')) {
        anchor = anchor.nextSibling;
      }
      nav.parentNode.insertBefore(wrapper, anchor);
    } else {
      document.body.insertBefore(wrapper, document.body.firstChild);
    }
  }

  function setupCarousel(tiles) {
    injectStyles();

    var wrapper = document.createElement('div');
    wrapper.id = 'hfx-carousel';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Top Polymarket markets');

    wrapper.innerHTML = ''
      + '<button class="hfx-c-close" type="button" aria-label="Dismiss carousel">×</button>'
      + '<div class="hfx-c-frame">'
      +   '<button class="hfx-c-nav hfx-c-nav-prev" type="button" aria-label="Previous">‹</button>'
      +   '<button class="hfx-c-nav hfx-c-nav-next" type="button" aria-label="Next">›</button>'
      +   '<div class="hfx-c-track">' + tiles.map(renderTile).join('') + '</div>'
      + '</div>'
      + '<div class="hfx-c-dots">' + renderDots(tiles.length, 0) + '</div>';

    mountAfterNav(wrapper);

    var track = wrapper.querySelector('.hfx-c-track');
    var dots  = wrapper.querySelectorAll('.hfx-c-dot');
    var idx   = 0;
    var pauseUntil = 0;
    var rotateTimer = null;

    function paint() {
      track.style.transform = 'translateX(-' + (idx * 100) + '%)';
      for (var i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('active', i === idx);
      }
    }
    function go(next) {
      idx = ((next % tiles.length) + tiles.length) % tiles.length;
      paint();
    }
    function userInteract() {
      pauseUntil = Date.now() + RESUME_AFTER_MS;
    }
    function tick() {
      if (Date.now() >= pauseUntil) {
        go(idx + 1);
      }
    }
    function startRotation() {
      if (rotateTimer) clearInterval(rotateTimer);
      rotateTimer = setInterval(tick, AUTO_ROTATE_MS);
    }
    function stopRotation() {
      if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
    }

    // Tile click → navigate to /market/:slug. Children with data-stop="1"
    // (the Yes/No buttons) handle their own navigation as real anchors
    // and don't bubble.
    var tileEls = wrapper.querySelectorAll('.hfx-c-tile');
    for (var k = 0; k < tileEls.length; k++) {
      (function (el) {
        el.addEventListener('click', function (e) {
          var t = e.target;
          while (t && t !== el) {
            if (t.getAttribute && t.getAttribute('data-stop') === '1') return;
            t = t.parentNode;
          }
          var href = el.getAttribute('data-href');
          if (href && href !== '#') window.location.href = href;
        });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            var href = el.getAttribute('data-href');
            if (href && href !== '#') window.location.href = href;
          }
        });
      })(tileEls[k]);
    }

    // Dot clicks.
    for (var i = 0; i < dots.length; i++) {
      (function (j) {
        dots[j].addEventListener('click', function () {
          userInteract();
          go(j);
        });
      })(i);
    }

    // Prev / next arrows.
    wrapper.querySelector('.hfx-c-nav-prev').addEventListener('click', function (e) {
      e.preventDefault();
      userInteract();
      go(idx - 1);
    });
    wrapper.querySelector('.hfx-c-nav-next').addEventListener('click', function (e) {
      e.preventDefault();
      userInteract();
      go(idx + 1);
    });

    // Keyboard arrows when carousel is hovered.
    var carouselHovered = false;
    wrapper.addEventListener('mouseenter', function () { carouselHovered = true; });
    wrapper.addEventListener('mouseleave', function () { carouselHovered = false; });
    document.addEventListener('keydown', function (e) {
      if (!carouselHovered) return;
      if (e.key === 'ArrowLeft')  { userInteract(); go(idx - 1); }
      if (e.key === 'ArrowRight') { userInteract(); go(idx + 1); }
    });

    // Swipe — touch only, threshold 40px horizontal.
    var touchStartX = null;
    track.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length === 1) touchStartX = e.touches[0].clientX;
    }, { passive: true });
    track.addEventListener('touchend', function (e) {
      if (touchStartX == null) return;
      var endX = (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) || touchStartX;
      var dx = endX - touchStartX;
      touchStartX = null;
      if (Math.abs(dx) < 40) return;
      userInteract();
      go(dx < 0 ? idx + 1 : idx - 1);
    }, { passive: true });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopRotation(); else startRotation();
    });

    wrapper.querySelector('.hfx-c-close').addEventListener('click', function () {
      try { localStorage.setItem('hero_banner_dismissed', '1'); } catch (_) {}
      stopRotation();
      wrapper.remove();
    });

    paint();
    startRotation();
  }

  function load() {
    fetch('/api/hot-markets/carousel?limit=7', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var markets = (d && Array.isArray(d.markets)) ? d.markets : [];
        if (!markets.length) return;
        setupCarousel(markets);
      })
      .catch(function () { /* fail silently — slot collapses */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
