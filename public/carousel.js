// public/carousel.js
//
// Phase 1 of the Polymarket Hot Markets Carousel. Replaces the
// single-event rolling banner (public/hero-banner.js) on /feed (and
// /explore where loaded). Renders the top 7 events by 24h volume as a
// horizontal carousel with auto-rotate + swipe/arrow override.
//
// Self-injecting like hero-banner.js — drops itself in after #nav-root.
// Fetches /api/hot-markets/carousel on mount. If the endpoint returns
// zero tiles, the slot collapses silently (no empty placeholder).
//
// Tile click routes to /market/:slug. Phase 2 will land the market
// detail page enrichment; for V1 this routes to the existing trade
// surface unchanged.

(function () {
  'use strict';
  if (window.__HFX_CAROUSEL_LOADED__) return;
  window.__HFX_CAROUSEL_LOADED__ = true;

  // Don't render if user dismissed the previous banner — same key as
  // hero-banner.js so opt-out carries over during the rollout.
  try { if (localStorage.getItem('hero_banner_dismissed') === '1') return; } catch (_) {}

  var AUTO_ROTATE_MS  = 5000;   // advance every 5s
  var RESUME_AFTER_MS = 10000;  // resume auto-rotate this long after the last user interaction

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

  // 7d delta as a signed % string. Input is the delta as a probability
  // (-1..1), e.g. -0.26 = "−26%".
  function fmtDelta(d) {
    if (d == null || !isFinite(d)) return null;
    var pct = Math.round(Math.abs(d) * 100);
    if (pct === 0) return null;
    var sign = d > 0 ? '+' : '−';
    return { text: sign + pct + '%', up: d > 0 };
  }

  // Build a 56-wide × 24-tall SVG polyline from a [0..1] price series.
  // Returns null when the input has fewer than 2 points.
  function sparklineSvg(points, upward) {
    if (!Array.isArray(points) || points.length < 2) return '';
    var W = 56, H = 24, pad = 2;
    var min = Math.min.apply(null, points);
    var max = Math.max.apply(null, points);
    var range = Math.max(0.0001, max - min);
    var step = (W - pad * 2) / (points.length - 1);
    var coords = points.map(function (p, i) {
      var x = pad + i * step;
      var y = pad + (1 - (p - min) / range) * (H - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var stroke = upward ? '#00e68a' : '#ff4d6a';
    return ''
      + '<svg class="hfx-c-spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">'
      +   '<polyline fill="none" stroke="' + stroke + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="' + coords + '"/>'
      + '</svg>';
  }

  function pctChance(yes) {
    var p = Number(yes);
    if (!isFinite(p) || p <= 0) return '—';
    if (p > 1) p = p / 100;
    return Math.round(p * 100) + '%';
  }

  function renderTile(t) {
    var pct = pctChance(t.yes_price);
    var delta = fmtDelta(t.yes_price_change_7d);
    var deltaHtml = delta
      ? '<span class="hfx-c-delta ' + (delta.up ? 'up' : 'down') + '">' + (delta.up ? '▲' : '▼') + ' ' + esc(delta.text) + '</span>'
      : '';
    var sparkHtml = t.sparkline_7d ? sparklineSvg(t.sparkline_7d, delta && delta.up) : '';
    var iconHtml = t.event_image_url
      ? '<img class="hfx-c-icon" src="' + esc(t.event_image_url) + '" alt="" loading="lazy">'
      : '<div class="hfx-c-icon hfx-c-icon-fallback">' + esc((t.event_title || '?').slice(0, 1).toUpperCase()) + '</div>';

    // News citations — up to 3 lines. Hide section if empty (voice
    // charter: no empty placeholders).
    var newsHtml = '';
    if (Array.isArray(t.news_citations) && t.news_citations.length) {
      newsHtml = '<div class="hfx-c-news">'
        + t.news_citations.map(function (n) {
            var src = esc(n.source || '');
            var head = esc(n.headline || '');
            return '<div class="hfx-c-news-row"><span class="hfx-c-news-src">' + src + '</span><span class="hfx-c-news-head">' + head + '</span></div>';
          }).join('')
        + '</div>';
    }

    var endLabel = fmtEndDate(t.end_date);
    var volLabel = t.volume_24h_label || fmtVol(t.volume_24h_usd);
    var slug = String(t.event_slug || '');
    var href = slug ? '/market/' + encodeURIComponent(slug) : '#';

    return ''
      + '<a class="hfx-c-tile" href="' + esc(href) + '">'
      +   '<div class="hfx-c-head">'
      +     iconHtml
      +     '<div class="hfx-c-title">' + esc(t.event_title || t.market_question || 'Untitled market') + '</div>'
      +   '</div>'
      +   '<div class="hfx-c-prices">'
      +     '<div class="hfx-c-price-block">'
      +       '<div class="hfx-c-chance">' + pct + ' <span class="hfx-c-chance-sub">chance</span></div>'
      +       (deltaHtml ? '<div class="hfx-c-delta-row">' + deltaHtml + '</div>' : '')
      +     '</div>'
      +     (sparkHtml ? '<div class="hfx-c-spark-wrap">' + sparkHtml + '</div>' : '')
      +   '</div>'
      +   newsHtml
      +   '<div class="hfx-c-foot">'
      +     '<span class="hfx-c-vol">' + esc(volLabel) + ' Vol</span>'
      +     (endLabel ? '<span class="hfx-c-end">Ends ' + esc(endLabel) + '</span>' : '')
      +   '</div>'
      + '</a>';
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
    + '#hfx-carousel .hfx-c-tile{flex:0 0 100%;display:flex;flex-direction:column;gap:10px;padding:18px 22px;text-decoration:none;color:inherit;min-height:240px;box-sizing:border-box;border-right:1px solid rgba(255,255,255,0.03)}'
    + '#hfx-carousel .hfx-c-tile:hover{background:rgba(255,255,255,0.02)}'
    + '#hfx-carousel .hfx-c-head{display:flex;align-items:flex-start;gap:12px}'
    + '#hfx-carousel .hfx-c-icon{width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#1a1a24}'
    + '#hfx-carousel .hfx-c-icon-fallback{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#2a2a3a,#1a1a24);color:#c9920d;font-family:JetBrains Mono,monospace;font-weight:800;font-size:16px}'
    + '#hfx-carousel .hfx-c-title{font-size:16px;font-weight:700;line-height:1.3;color:#f0f0f5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;flex:1;min-width:0}'
    + '#hfx-carousel .hfx-c-prices{display:flex;align-items:center;justify-content:space-between;gap:12px}'
    + '#hfx-carousel .hfx-c-chance{font-family:JetBrains Mono,monospace;font-size:26px;font-weight:800;color:#f0f0f5;letter-spacing:-0.01em;font-variant-numeric:tabular-nums}'
    + '#hfx-carousel .hfx-c-chance-sub{font-size:12px;font-weight:500;color:#8b8a9a;letter-spacing:0.02em;margin-left:2px}'
    + '#hfx-carousel .hfx-c-delta-row{margin-top:2px}'
    + '#hfx-carousel .hfx-c-delta{font-family:JetBrains Mono,monospace;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px}'
    + '#hfx-carousel .hfx-c-delta.up{background:rgba(0,230,138,0.14);color:#00e68a}'
    + '#hfx-carousel .hfx-c-delta.down{background:rgba(255,77,106,0.14);color:#ff4d6a}'
    + '#hfx-carousel .hfx-c-spark-wrap{flex-shrink:0}'
    + '#hfx-carousel .hfx-c-news{display:flex;flex-direction:column;gap:5px;font-family:Inter,sans-serif;font-size:11px;color:#8b8a9a;line-height:1.4;margin-top:2px}'
    + '#hfx-carousel .hfx-c-news-row{display:flex;gap:8px;align-items:baseline}'
    + '#hfx-carousel .hfx-c-news-src{font-family:JetBrains Mono,monospace;font-size:9px;font-weight:800;color:#4d9fff;text-transform:uppercase;letter-spacing:0.06em;flex-shrink:0;min-width:60px}'
    + '#hfx-carousel .hfx-c-news-head{color:#cfcfd7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '#hfx-carousel .hfx-c-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;font-family:JetBrains Mono,monospace;font-size:10px;color:#4a4a5a;letter-spacing:0.04em;padding-top:4px;border-top:1px solid rgba(255,255,255,0.04)}'
    + '#hfx-carousel .hfx-c-vol{color:#cfcfd7;font-weight:700}'
    + '#hfx-carousel .hfx-c-end{}'
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
    + '@media(max-width:600px){'
    +   '#hfx-carousel{margin:10px auto 14px;padding:0 12px}'
    +   '#hfx-carousel .hfx-c-tile{padding:14px 16px;min-height:220px}'
    +   '#hfx-carousel .hfx-c-title{font-size:14px}'
    +   '#hfx-carousel .hfx-c-chance{font-size:22px}'
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

    // Keyboard arrows when carousel is focused / hovered.
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

    // Pause rotation when tab is hidden, resume on visible.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopRotation(); else startRotation();
    });

    // Close button — same opt-out key as hero-banner so dismissal carries.
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
