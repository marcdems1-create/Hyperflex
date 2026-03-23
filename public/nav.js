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
      '@media(max-width:768px){.topbar{padding:12px 16px}.nav-links{gap:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}.nav-links::-webkit-scrollbar{display:none}.nav-link{font-size:11px;white-space:nowrap}}';
    document.head.appendChild(style);
  }

  var links = [
    { href: '/crystal-ball', label: '\uD83D\uDD2E Crystal Ball', gold: true },
    { href: '/signals', label: 'Signals' },
    { href: '/whales', label: 'Whales' },
    { href: '/screener', label: 'Screener' },
    { href: '/predictors', label: 'Predictors' },
    { href: '/odds', label: 'Odds' },
    { href: '/data', label: 'Data' },
    { href: '/api-docs', label: 'API' }
  ];

  var path = window.location.pathname.replace(/\/$/, '') || '/';

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
      '<a id="navDashLink" href="/creator/dashboard" class="nav-link" style="display:none;color:#c9920d">Dashboard</a>' +
    '</div>';

  var root = document.getElementById('nav-root');
  if (root) {
    root.appendChild(nav);
  } else {
    document.body.insertBefore(nav, document.body.firstChild);
  }

  // Show Dashboard link if logged in
  if (localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token')) {
    var dl = document.getElementById('navDashLink');
    if (dl) dl.style.display = '';
  }
})();
