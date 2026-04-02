// HYPERFLEX shared navbar — include via <script src="/nav.js"></script>
// Injects navbar + scoped CSS into #nav-root, highlights active page, shows Dashboard if logged in
(function() {
  // Inject CSS if .topbar not already styled
  if (!document.querySelector('style[data-hfx-nav]')) {
    var style = document.createElement('style');
    style.setAttribute('data-hfx-nav', '1');
    style.textContent =
      '.topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;border-bottom:1px solid #2a2a25;background:rgba(10,10,9,0.95);backdrop-filter:blur(12px);position:sticky;top:0;z-index:100}' +
      '.topbar-logo{font-family:"Syne",sans-serif;font-weight:800;font-size:18px;letter-spacing:2px;color:#e8e4d9;text-decoration:none}' +
      '.topbar-logo span{color:#c9920d}' +
      '.nav-links{display:flex;align-items:center;gap:16px;margin-left:auto}' +
      '.nav-link{font-family:"Space Mono",monospace;font-size:12px;font-weight:700;color:#7a7870;text-decoration:none;transition:color .15s}' +
      '.nav-link:hover{color:#e8e4d9}' +
      '.nav-link.active{color:#e8e4d9;border-bottom:2px solid #c9920d;padding-bottom:2px}' +
      '.nav-auth{display:flex;align-items:center;gap:8px;margin-left:12px;flex-shrink:0}' +
      '.nav-signin{font-family:"Space Mono",monospace;font-size:11px;color:#7a7870;text-decoration:none;padding:6px 12px;border:1px solid #2a2a25;border-radius:6px;transition:all .15s;white-space:nowrap}' +
      '.nav-signin:hover{color:#e8e4d9;border-color:#555}' +
      '.nav-cta{font-family:"Space Mono",monospace;font-size:11px;font-weight:700;color:#141412;background:#c9920d;text-decoration:none;padding:6px 14px;border-radius:6px;transition:all .15s;white-space:nowrap}' +
      '.nav-cta:hover{background:#e0b340}' +
      '@media(max-width:768px){.topbar{padding:12px 16px}.nav-links{gap:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}.nav-links::-webkit-scrollbar{display:none}.nav-link{font-size:11px;white-space:nowrap;min-height:44px;display:inline-flex;align-items:center}.nav-auth{gap:6px;margin-left:8px}.nav-signin{font-size:10px;padding:5px 8px;min-height:44px;display:inline-flex;align-items:center}.nav-cta{font-size:10px;padding:5px 10px;min-height:44px;display:inline-flex;align-items:center}}';
    document.head.appendChild(style);
  }

  var links = [
    { href: '/brief', label: '\uD83E\uDDE0 AI Brief', gold: true },
    { href: '/explore', label: 'Explore' },
    { href: '/rewards', label: '\uD83D\uDCB0 Rewards', gold: true },
    { href: '/nominate', label: '+ Nominate a Creator', gold: true },
    { href: '/crystal-ball', label: 'Crystal Ball' },
    { href: '/signals', label: 'Signals' },
    { href: '/whales', label: 'Market Intel' },
    { href: '/screener', label: 'Screener' },
    { href: '/predictors', label: 'Predictors' },
    { href: '/odds', label: 'Odds' },
    { href: '/high-prob', label: '99% Bets', gold: true },
    { href: '/data', label: 'Data' },
    { href: '/api-docs', label: 'API' }
  ];

  var path = window.location.pathname.replace(/\/$/, '') || '/';

  var isLoggedIn = !!(localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token'));

  var nav = document.createElement('nav');
  nav.className = 'topbar';
  nav.innerHTML =
    '<a href="/explore" class="topbar-logo">HYPER<span>FLEX</span></a>' +
    '<div class="nav-links">' +
      links.map(function(l) {
        var isActive = path === l.href;
        var cls = 'nav-link' + (isActive ? ' active' : '');
        var style = l.gold && !isActive ? ' style="color:#c9920d"' : '';
        return '<a href="' + l.href + '" class="' + cls + '"' + style + '>' + l.label + '</a>';
      }).join('') +
      '<a id="navDashLink" href="/creator/dashboard" class="nav-link" style="' + (isLoggedIn ? '' : 'display:none;') + 'color:#c9920d">Dashboard</a>' +
    '</div>' +
    '<div class="nav-auth">' +
      (isLoggedIn
        ? ''
        : '<a href="/creator/login" class="nav-signin">Sign in</a>') +
    '</div>';

  var root = document.getElementById('nav-root');
  if (root) {
    root.appendChild(nav);
  } else {
    document.body.insertBefore(nav, document.body.firstChild);
  }

  // Dashboard link visibility already handled by isLoggedIn above
})();

// ── Polymarket referral tag — appends ?via=CODE to all outbound polymarket.com links ──
// Revenue engine: 30% of trading fees from referred users
(function() {
  var REF_CODE = window.__POLY_REF || '';
  // Fetch ref code from server config endpoint (fire-and-forget, cached in sessionStorage)
  if (!REF_CODE) {
    var cached = sessionStorage.getItem('hfx_poly_ref');
    if (cached) {
      REF_CODE = cached;
      window.__POLY_REF = cached;
    } else {
      fetch('/api/config/ref').then(function(r) { return r.json(); }).then(function(d) {
        if (d && d.ref) { REF_CODE = d.ref; window.__POLY_REF = d.ref; sessionStorage.setItem('hfx_poly_ref', d.ref); }
      }).catch(function() {});
    }
  }
  window.polyRef = function(url) {
    if (!REF_CODE || typeof url !== 'string') return url;
    if (!/^https?:\/\/polymarket\.com(\/|$|\?)/.test(url)) return url;
    if (url.indexOf('r=') !== -1 && url.indexOf(REF_CODE) !== -1) return url;
    return url + (url.indexOf('?') !== -1 ? '&' : '?') + 'r=' + REF_CODE;
  };
  // Click interceptor — tag any <a href="polymarket.com/..."> on the page
  document.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^https?:\/\/polymarket\.com(\/|$|\?)/.test(href) && REF_CODE && !(href.indexOf('r=') !== -1 && href.indexOf(REF_CODE) !== -1)) {
      a.setAttribute('href', href + (href.indexOf('?') !== -1 ? '&' : '?') + 'r=' + REF_CODE);
    }
    // Track click for USDC rewards
    if (/^https?:\/\/polymarket\.com(\/|$|\?)/.test(href)) {
      fetch('/api/rewards/track-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('hf_token') || '') },
        body: JSON.stringify({ market_slug: href.split('/event/')[1] ? href.split('/event/')[1].split('?')[0] : '', source_page: location.pathname })
      }).catch(function(){});
    }
  }, true);
})();

// Global helper: convert Polymarket URL to our market page URL
// Usage: hfxMarketUrl('https://polymarket.com/event/us-x-iran-ceasefire-by-march-31')
// Returns: '/market/us-x-iran-ceasefire-by-march-31'
window.hfxMarketUrl = function(polyUrl) {
  if (!polyUrl || typeof polyUrl !== 'string') return '#';
  // Already our URL
  if (polyUrl.startsWith('/market/')) return polyUrl;
  // Extract slug from polymarket.com/event/SLUG or polymarket.com/event/SLUG/SUBMARKET
  var match = polyUrl.match(/polymarket\.com\/event\/([a-z0-9\-]+)/i);
  if (match) return '/market/' + match[1].toLowerCase();
  // Try extracting from any URL-like slug
  var parts = polyUrl.split('/').filter(function(p) { return p && p !== 'https:' && p !== 'http:' && !p.includes('.'); });
  if (parts.length) return '/market/' + parts[parts.length - 1].toLowerCase();
  return '#';
};
