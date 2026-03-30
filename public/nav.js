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
    { href: '/crystal-ball', label: 'Crystal Ball' },
    { href: '/signals', label: 'Signals' },
    { href: '/whales', label: 'Market Intel' },
    { href: '/screener', label: 'Screener' },
    { href: '/spread-scanner', label: 'Spreads', gold: true },
    { href: '/high-prob', label: '99%+ Bets' },
    { href: '/predictors', label: 'Predictors' },
    { href: '/odds', label: 'Odds' },
    { href: '/data', label: 'Data' },
    { href: '/api-docs', label: 'API' }
  ];

  var path = window.location.pathname.replace(/\/$/, '') || '/';

  var isLoggedIn = !!(localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token'));

  var nav = document.createElement('nav');
  nav.className = 'topbar';
  nav.innerHTML =
    '<a href="/" class="topbar-logo">HYPER<span>FLEX</span></a>' +
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
        : '<a href="/creator/login" class="nav-signin">Sign in</a>' +
          '<a href="/creator/login#signup" class="nav-cta">Get started free</a>') +
    '</div>';

  var root = document.getElementById('nav-root');
  if (root) {
    root.appendChild(nav);
  } else {
    document.body.insertBefore(nav, document.body.firstChild);
  }

  // Dashboard link visibility already handled by isLoggedIn above
})();
