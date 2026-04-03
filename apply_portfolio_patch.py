#!/usr/bin/env python3
"""
Patch script: Portfolio UI overhaul + sidebar Account fix
Run from ~/Desktop/HYPERFLEX: python3 apply_portfolio_patch.py
"""
import re

path = 'public/creator-dashboard.html'
with open(path, 'r', encoding='utf-8') as f:
    html = f.read()

original_len = len(html)

# ── PATCH 1: Fix sidebar duplicate Account section ─────────────────────────
# Move Account nav item inside </nav> instead of after it
html = html.replace(
    '''        <a class="nav-item" onclick="showTab(\'settings\')">
          <span class="nav-icon">⚙️</span><span class="nav-label">Settings</span>
        </a>
      </div>
    </nav>

      <div class="nav-section-label" style="margin-top:8px">Account</div>
      <a class="nav-item" onclick="showTab(\'account\')">
        <span class="nav-icon">👤</span><span class="nav-label">My Account</span>
      </a>

    <div class="sidebar-footer">''',
    '''        <a class="nav-item" onclick="showTab(\'settings\')">
          <span class="nav-icon">⚙️</span><span class="nav-label">Settings</span>
        </a>
      </div>
      <div class="nav-section-label" style="margin-top:8px">Account</div>
      <a class="nav-item" onclick="showTab(\'account\')">
        <span class="nav-icon">👤</span><span class="nav-label">My Account</span>
      </a>
    </nav>

    <div class="sidebar-footer">'''
)

# ── PATCH 2: Fix Polymarket field name (wallet_address → polymarket_address) ─
html = html.replace(
    'body: JSON.stringify({ wallet_address: address })',
    'body: JSON.stringify({ polymarket_address: address })'
)

# ── PATCH 3: Fix Community button null JS error ────────────────────────────
html = html.replace(
    "const _urlEl = document.getElementById('topbarCommunityUrl'); _urlEl.textContent =",
    "const _urlEl = document.getElementById('topbarCommunityUrl'); if (_urlEl) _urlEl.textContent ="
)
# Also guard any direct reference
html = re.sub(
    r"document\.getElementById\('topbarCommunityUrl'\)\.textContent\s*=",
    "const __urlEl=document.getElementById('topbarCommunityUrl'); if(__urlEl) __urlEl.textContent =",
    html
)

# ── PATCH 4: Portfolio tab - premium tabbed UI ─────────────────────────────
OLD_PORTFOLIO_MAIN = '''            <!-- Main portfolio content (hidden when welcome is shown) -->
            <div id="portfolioMain">

            <!-- Early Access banner -->
            <div style="background:linear-gradient(135deg,#c9920d22,#c9920d11);border:1px solid #c9920d44;border-radius:10px;padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px">
              <span style="font-size:18px">🎁</span>
              <div>
                <div style="font-weight:700;color:#c9920d;font-size:13px">Early Access — All platform connections free during beta</div>
                <div style="font-size:12px;color:#888;margin-top:2px">Connect Polymarket, Kalshi &amp; Manifold at no cost while we\'re in beta. Lock in your portfolio history now.</div>
              </div>
            </div>

            <!-- Kalshi card -->
            <div style="background:var(--cream);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px">'''

NEW_PORTFOLIO_MAIN = '''            <!-- Main portfolio content (hidden when welcome is shown) -->
            <div id="portfolioMain">

            <!-- Platform tab bar - sleek underline style -->
            <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:28px;gap:0;overflow-x:auto">
              <button id="ptab-all" onclick="switchPortfolioTab(\'all\')"
                style="background:none;border:none;border-bottom:2px solid var(--gold);color:var(--text);padding:12px 20px;font-family:var(--sans);font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s;margin-bottom:-1px">
                All Positions
              </button>
              <button id="ptab-poly" onclick="switchPortfolioTab(\'poly\')"
                style="background:none;border:none;border-bottom:2px solid transparent;color:var(--dim);padding:12px 20px;font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s;margin-bottom:-1px;display:flex;align-items:center;gap:7px">
                <span id="ptab-poly-dot" style="width:7px;height:7px;border-radius:50%;background:#444;flex-shrink:0"></span>Polymarket
              </button>
              <button id="ptab-kalshi" onclick="switchPortfolioTab(\'kalshi\')"
                style="background:none;border:none;border-bottom:2px solid transparent;color:var(--dim);padding:12px 20px;font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s;margin-bottom:-1px;display:flex;align-items:center;gap:7px">
                <span id="ptab-kalshi-dot" style="width:7px;height:7px;border-radius:50%;background:#444;flex-shrink:0"></span>Kalshi
              </button>
              <button id="ptab-manifold" onclick="switchPortfolioTab(\'manifold\')"
                style="background:none;border:none;border-bottom:2px solid transparent;color:var(--dim);padding:12px 20px;font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s;margin-bottom:-1px;display:flex;align-items:center;gap:7px">
                <span id="ptab-manifold-dot" style="width:7px;height:7px;border-radius:50%;background:#444;flex-shrink:0"></span>Manifold
              </button>
            </div>

            <!-- ALL tab -->
            <div id="ptabContent-all">
              <div id="allPositionsContainer">
                <div style="text-align:center;padding:64px 20px;color:var(--dim)">
                  <div style="font-size:40px;margin-bottom:16px;opacity:0.4">📊</div>
                  <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px">No positions loaded yet</div>
                  <div style="font-size:13px;line-height:1.6">Connect Polymarket, Kalshi or Manifold using the tabs above,<br>then come back here to see all your trades in one place.</div>
                </div>
              </div>
            </div>

            <!-- POLYMARKET tab -->
            <div id="ptabContent-poly" style="display:none">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
                <div style="display:flex;align-items:center;gap:12px">
                  <div style="width:38px;height:38px;border-radius:10px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);display:flex;align-items:center;justify-content:center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="rgba(124,58,237,0.3)"/><path d="M8 12h8M12 8v8" stroke="#a78bfa" stroke-width="2" stroke-linecap="round"/></svg>
                  </div>
                  <div>
                    <div style="font-size:16px;font-weight:800;color:var(--text);letter-spacing:-0.3px">Polymarket</div>
                    <div style="font-size:11px;color:var(--dim);font-family:var(--mono)">Crypto prediction markets</div>
                  </div>
                </div>
                <div id="polyStatusBadge"></div>
              </div>
              <div id="polyConnectForm" style="background:var(--cream);border:1px solid var(--border);border-radius:14px;padding:28px">
                <div style="font-size:13px;color:var(--dim);margin-bottom:20px;line-height:1.6">Paste your Polygon wallet address to instantly import all open positions and see your real-time P&amp;L.</div>
                <input type="text" id="poly-wallet-input"
                  placeholder="0x... your wallet address"
                  style="width:100%;background:var(--ink);border:1px solid var(--border);border-radius:10px;padding:13px 16px;font-family:var(--mono);font-size:13px;color:var(--text);outline:none;margin-bottom:8px;box-sizing:border-box"
                  onfocus="this.style.borderColor=\'rgba(124,58,237,0.6)\';this.style.boxShadow=\'0 0 0 3px rgba(124,58,237,0.08)\'" onblur="this.style.borderColor=\'var(--border)\';this.style.boxShadow=\'none\'"/>
                <div style="font-size:11px;color:var(--muted);margin-bottom:20px">Find at <a href="https://polymarket.com" target="_blank" style="color:#a78bfa">polymarket.com</a> → your profile → copy address</div>
                <button id="polyConnectBtn" onclick="connectPolymarket()" style="background:rgba(124,58,237,0.9);color:#fff;border:none;border-radius:10px;padding:12px 24px;font-family:var(--sans);font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;min-height:44px" onmouseover="this.style.background=\'rgba(124,58,237,1)\'" onmouseout="this.style.background=\'rgba(124,58,237,0.9)\'">Connect Polymarket →</button>
              </div>
              <div id="polyConnectedRow" style="display:none;align-items:center;gap:10px;margin-bottom:16px;padding:12px 16px;background:rgba(124,58,237,0.06);border:1px solid rgba(124,58,237,0.2);border-radius:10px">
                <span style="width:8px;height:8px;border-radius:50%;background:#a78bfa;flex-shrink:0;box-shadow:0 0 6px rgba(167,139,250,0.6)"></span>
                <div style="font-size:13px;color:var(--text);font-weight:600;flex:1">Wallet: <span id="polyWalletDisplay" style="font-family:var(--mono);font-size:12px;color:#a78bfa"></span></div>
                <button onclick="loadPolymarketPositions(true)" style="background:none;border:1px solid rgba(124,58,237,0.3);border-radius:6px;padding:5px 12px;font-size:11px;color:#a78bfa;cursor:pointer;font-family:var(--mono);transition:all .15s">↺ Sync</button>
                <button onclick="disconnectPolymarket()" style="background:none;border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--muted);cursor:pointer;font-family:var(--mono)">Disconnect</button>
              </div>
              <div id="polyPositions"></div>
            </div>

            <!-- KALSHI tab -->
            <div id="ptabContent-kalshi" style="display:none">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
                <div style="display:flex;align-items:center;gap:12px">
                  <div style="width:38px;height:38px;border-radius:10px;background:rgba(217,119,6,0.15);border:1px solid rgba(217,119,6,0.3);display:flex;align-items:center;justify-content:center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="rgba(217,119,6,0.3)"/><path d="M9 12l2 2 4-4" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                  <div>
                    <div style="font-size:16px;font-weight:800;color:var(--text);letter-spacing:-0.3px">Kalshi</div>
                    <div style="font-size:11px;color:var(--dim);font-family:var(--mono)">Real-money prediction markets</div>
                  </div>
                </div>
                <div id="kalshiStatusBadge"></div>
              </div>
              <div id="kalshiConnectForm" style="background:var(--cream);border:1px solid var(--border);border-radius:14px;padding:28px">
                <div style="font-size:13px;color:var(--dim);margin-bottom:20px;line-height:1.6">Connect with your Kalshi API key to sync real-money contracts, track your P&amp;L, and see your open positions.</div>
                <input type="password" id="kalshiApiKeyInput"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  style="width:100%;background:var(--ink);border:1px solid var(--border);border-radius:10px;padding:13px 16px;font-family:var(--mono);font-size:13px;color:var(--text);outline:none;margin-bottom:8px;box-sizing:border-box"
                  onfocus="this.style.borderColor=\'rgba(217,119,6,0.6)\';this.style.boxShadow=\'0 0 0 3px rgba(217,119,6,0.08)\'" onblur="this.style.borderColor=\'var(--border)\';this.style.boxShadow=\'none\'"/>
                <div style="font-size:11px;color:var(--muted);margin-bottom:20px">Get at <a href="https://kalshi.com/profile/api" target="_blank" style="color:#fbbf24">kalshi.com/profile/api</a> → Settings → API Access</div>
                <button id="kalshiConnectBtn" onclick="connectKalshi()" style="background:rgba(217,119,6,0.9);color:#fff;border:none;border-radius:10px;padding:12px 24px;font-family:var(--sans);font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;min-height:44px" onmouseover="this.style.background=\'rgba(217,119,6,1)\'" onmouseout="this.style.background=\'rgba(217,119,6,0.9)\'">Connect Kalshi →</button>
              </div>
              <div id="kalshiConnectedRow" style="display:none;align-items:center;gap:10px;margin-bottom:16px;padding:12px 16px;background:rgba(217,119,6,0.06);border:1px solid rgba(217,119,6,0.2);border-radius:10px">
                <span style="width:8px;height:8px;border-radius:50%;background:#fbbf24;flex-shrink:0;box-shadow:0 0 6px rgba(251,191,36,0.6)"></span>
                <div style="font-size:13px;color:var(--text);font-weight:600;flex:1">API key connected</div>
                <button onclick="loadKalshiPositions(true)" style="background:none;border:1px solid rgba(217,119,6,0.3);border-radius:6px;padding:5px 12px;font-size:11px;color:#fbbf24;cursor:pointer;font-family:var(--mono);transition:all .15s">↺ Sync</button>
                <button onclick="disconnectKalshi()" style="background:none;border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--muted);cursor:pointer;font-family:var(--mono)">Disconnect</button>
              </div>
              <div id="kalshiPositions"></div>
            </div>

            <!-- MANIFOLD tab -->
            <div id="ptabContent-manifold" style="display:none">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
                <div style="display:flex;align-items:center;gap:12px">
                  <div style="width:38px;height:38px;border-radius:10px;background:rgba(5,150,105,0.15);border:1px solid rgba(5,150,105,0.3);display:flex;align-items:center;justify-content:center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="rgba(5,150,105,0.3)"/><path d="M8 16l4-8 4 8" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                  <div>
                    <div style="font-size:16px;font-weight:800;color:var(--text);letter-spacing:-0.3px">Manifold</div>
                    <div style="font-size:11px;color:var(--dim);font-family:var(--mono)">Play-money prediction markets</div>
                  </div>
                </div>
                <div id="manifoldStatusBadge"></div>
              </div>
              <div id="manifoldConnectForm" style="background:var(--cream);border:1px solid var(--border);border-radius:14px;padding:28px">
                <div style="font-size:13px;color:var(--dim);margin-bottom:20px;line-height:1.6">Enter your Manifold username to track play-money positions and build your calibration score.</div>
                <input type="text" id="manifold-username-input"
                  placeholder="your-username"
                  style="width:100%;background:var(--ink);border:1px solid var(--border);border-radius:10px;padding:13px 16px;font-family:var(--mono);font-size:13px;color:var(--text);outline:none;margin-bottom:8px;box-sizing:border-box"
                  onfocus="this.style.borderColor=\'rgba(5,150,105,0.6)\';this.style.boxShadow=\'0 0 0 3px rgba(5,150,105,0.08)\'" onblur="this.style.borderColor=\'var(--border)\';this.style.boxShadow=\'none\'"/>
                <div style="font-size:11px;color:var(--muted);margin-bottom:20px">Find at <a href="https://manifold.markets" target="_blank" style="color:#34d399">manifold.markets</a> → your profile → copy username</div>
                <button id="manifoldConnectBtn" onclick="saveManifoldUsername()" style="background:rgba(5,150,105,0.9);color:#fff;border:none;border-radius:10px;padding:12px 24px;font-family:var(--sans);font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;min-height:44px" onmouseover="this.style.background=\'rgba(5,150,105,1)\'" onmouseout="this.style.background=\'rgba(5,150,105,0.9)\'">Connect Manifold →</button>
              </div>
              <div id="manifoldConnectedRow" style="display:none;align-items:center;gap:10px;margin-bottom:16px;padding:12px 16px;background:rgba(5,150,105,0.06);border:1px solid rgba(5,150,105,0.2);border-radius:10px">
                <span style="width:8px;height:8px;border-radius:50%;background:#34d399;flex-shrink:0;box-shadow:0 0 6px rgba(52,211,153,0.6)"></span>
                <div style="font-size:13px;color:var(--text);font-weight:600;flex:1">@<span id="manifoldUsernameDisplay" style="color:#34d399"></span></div>
                <button onclick="loadManifoldPositions(true)" style="background:none;border:1px solid rgba(5,150,105,0.3);border-radius:6px;padding:5px 12px;font-size:11px;color:#34d399;cursor:pointer;font-family:var(--mono);transition:all .15s">↺ Sync</button>
                <button onclick="disconnectManifold()" style="background:none;border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--muted);cursor:pointer;font-family:var(--mono)">Disconnect</button>
              </div>
              <div id="manifoldPositions"></div>
            </div>

          </div><!-- /portfolioMain -->
            <!-- DEAD ZONE FOR OLD KALSHI CARD SEARCH ANCHOR -->
            <!-- old-kalshi-card-start-->'''

if OLD_PORTFOLIO_MAIN in html:
    # Find end of portfolioMain (the old stacked cards ending)
    # We need to replace from OLD_PORTFOLIO_MAIN through to </div><!-- /portfolioMain -->
    start_idx = html.index(OLD_PORTFOLIO_MAIN)
    # Find the closing of portfolioMain after the old Manifold card
    end_marker = '</div><!-- /portfolioMain -->'
    end_idx = html.index(end_marker, start_idx) + len(end_marker)
    html = html[:start_idx] + NEW_PORTFOLIO_MAIN + html[end_idx:]
    print('✓ Patch 4: Portfolio main replaced')
else:
    print('⚠ Patch 4: OLD_PORTFOLIO_MAIN not found — portfolio may already be patched or structure differs')

# ── PATCH 5: Fix Polymarket connect body field name ───────────────────────
# (redundant safety check)
html = html.replace(
    "JSON.stringify({ wallet_address: address })",
    "JSON.stringify({ polymarket_address: address })"
)

# ── PATCH 6: Add renderPositionCard + switchPortfolioTab JS ───────────────
NEW_JS = '''
// ── POSITION CARD RENDERER ──────────────────────────────────────────────────
function renderPositionCard({ question, side, pct, meta, pnl, pnlLabel, pnlIsPercent, url, accentColor, posData }) {
  const isYes = side === 'YES';
  const sideColor = isYes ? '#22c55e' : '#f87171';
  const sideBg = isYes ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)';
  const sideBorder = isYes ? 'rgba(34,197,94,0.3)' : 'rgba(248,113,113,0.3)';
  const pnlColor = pnl == null ? '' : pnl >= 0 ? '#22c55e' : '#f87171';
  const pnlStr = pnl == null ? '' : (pnl >= 0 ? '+' : '') + (pnlIsPercent ? pnl.toFixed(1) + '%' : '$' + Math.abs(pnl).toFixed(2));
  const probBar = Math.max(0, Math.min(100, pct || 0));
  const posJson = JSON.stringify(posData || {}).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  return `
    <div style="background:#0f0e0c;border:1px solid #2a2825;border-radius:12px;padding:0;margin-bottom:8px;overflow:hidden;transition:border-color .15s,box-shadow .15s"
      onmouseover="this.style.borderColor='${accentColor}55';this.style.boxShadow='0 0 0 1px ${accentColor}22'"
      onmouseout="this.style.borderColor='#2a2825';this.style.boxShadow='none'">
      <div style="height:2px;background:${accentColor};opacity:0.5"></div>
      <div style="padding:16px 18px">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <span style="flex-shrink:0;margin-top:1px;font-family:var(--mono);font-size:10px;font-weight:700;padding:4px 9px;border-radius:5px;background:${sideBg};color:${sideColor};border:1px solid ${sideBorder};letter-spacing:.04em">${side || '—'}</span>
          <div style="flex:1;min-width:0">
            <a href="${url}" target="_blank" rel="noopener" style="text-decoration:none">
              <div style="font-size:13px;font-weight:600;color:#e8e4de;line-height:1.5;margin-bottom:10px">${escHtmlDash(question)}</div>
            </a>
            <div style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-family:var(--mono);font-size:10px;color:#6b6560">Current odds</span>
                <span style="font-family:var(--mono);font-size:11px;font-weight:700;color:${accentColor}">${pct != null ? pct + '%' : '—'}</span>
              </div>
              <div style="height:4px;background:#1e1c19;border-radius:2px;overflow:hidden">
                <div style="height:100%;width:${probBar}%;background:${accentColor};border-radius:2px;transition:width .4s ease"></div>
              </div>
            </div>
            <div style="font-family:var(--mono);font-size:11px;color:#6b6560">${meta || ''}</div>
          </div>
          ${pnl != null ? `<div style="flex-shrink:0;text-align:right">
            <div style="font-family:var(--mono);font-size:15px;font-weight:800;color:${pnlColor};letter-spacing:-0.5px">${pnlStr}</div>
            <div style="font-family:var(--mono);font-size:9px;color:#4a4744;margin-top:2px;text-transform:uppercase;letter-spacing:.06em">${pnlLabel}</div>
          </div>` : ''}
        </div>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #1e1c19;display:flex;justify-content:flex-end">
          <button data-pos="${posJson}" onclick="sharePositionToFeed(JSON.parse(this.getAttribute('data-pos').replace(/&quot;/g,'\\\"')))"
            style="background:none;border:1px solid #2a2825;border-radius:6px;padding:5px 14px;font-size:10px;color:#6b6560;cursor:pointer;font-family:var(--mono);transition:all .15s;letter-spacing:.04em"
            onmouseover="this.style.borderColor='${accentColor}';this.style.color='${accentColor}'" onmouseout="this.style.borderColor='#2a2825';this.style.color='#6b6560'">
            📢 SHARE TO FEED
          </button>
        </div>
      </div>
    </div>`;
}

// ── PORTFOLIO TAB SWITCHER ──────────────────────────────────────────────────
let _activePortfolioTab = 'all';
function switchPortfolioTab(tab) {
  _activePortfolioTab = tab;
  const tabs = ['all', 'poly', 'kalshi', 'manifold'];
  const activeColors = { all: 'var(--gold)', poly: '#a78bfa', kalshi: '#fbbf24', manifold: '#34d399' };
  tabs.forEach(t => {
    const btn = document.getElementById('ptab-' + t);
    const content = document.getElementById('ptabContent-' + t);
    if (btn) {
      const isActive = t === tab;
      btn.style.borderBottom = isActive ? `2px solid ${activeColors[t]}` : '2px solid transparent';
      btn.style.color = isActive ? 'var(--text)' : 'var(--dim)';
      btn.style.fontWeight = isActive ? '700' : '600';
    }
    if (content) content.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'all') updateAllPositionsTab();
}

function updatePortfolioTabDots() {
  const pd = document.getElementById('ptab-poly-dot');
  const kd = document.getElementById('ptab-kalshi-dot');
  const md = document.getElementById('ptab-manifold-dot');
  if (pd) pd.style.background = _polyWalletAddress ? '#a78bfa' : '#333';
  if (kd) kd.style.background = _kalshiConnected ? '#fbbf24' : '#333';
  if (md) md.style.background = _manifoldUsername ? '#34d399' : '#333';
}

function updateAllPositionsTab() {
  const container = document.getElementById('allPositionsContainer');
  if (!container) return;
  const polyEl = _polyWalletAddress ? document.getElementById('polyPositions') : null;
  const kalshiEl = _kalshiConnected ? document.getElementById('kalshiPositions') : null;
  const manifoldEl = _manifoldUsername ? document.getElementById('manifoldPositions') : null;
  const sections = [];
  if (polyEl && polyEl.innerHTML.trim() && !polyEl.innerHTML.includes('LOADING')) sections.push({ label: '🟣 Polymarket', el: polyEl });
  if (kalshiEl && kalshiEl.innerHTML.trim() && !kalshiEl.innerHTML.includes('LOADING')) sections.push({ label: '🟡 Kalshi', el: kalshiEl });
  if (manifoldEl && manifoldEl.innerHTML.trim() && !manifoldEl.innerHTML.includes('LOADING')) sections.push({ label: '🟢 Manifold', el: manifoldEl });
  if (!sections.length) {
    const connected = [_polyWalletAddress && 'Polymarket', _kalshiConnected && 'Kalshi', _manifoldUsername && 'Manifold'].filter(Boolean);
    container.innerHTML = connected.length
      ? `<div style="text-align:center;padding:48px 20px;color:var(--dim)"><div style="font-size:32px;margin-bottom:12px">⏳</div><div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">${connected.join(', ')} connected</div><div style="font-size:13px">Switch to the platform tabs to load positions, then return here.</div></div>`
      : `<div style="text-align:center;padding:64px 20px;color:var(--dim)"><div style="font-size:40px;margin-bottom:16px;opacity:0.4">📊</div><div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px">No positions loaded yet</div><div style="font-size:13px;line-height:1.6">Connect platforms using the tabs above.</div></div>`;
    return;
  }
  container.innerHTML = sections.map(s => `<div style="margin-bottom:20px"><div style="font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-bottom:10px">${s.label}</div>${s.el.innerHTML}</div>`).join('');
}
'''

# Inject before closing </script> tag of the portfolio script block
# Find the sharePositionToFeed function and inject before it
INJECT_BEFORE = 'async function sharePositionToFeed(p) {'
if INJECT_BEFORE in html and 'renderPositionCard' not in html:
    html = html.replace(INJECT_BEFORE, NEW_JS + '\n' + INJECT_BEFORE)
    print('✓ Patch 6: New JS functions injected')
elif 'renderPositionCard' in html:
    print('⚠ Patch 6: renderPositionCard already present — skipping JS injection')
else:
    print('✗ Patch 6: Could not find injection point')

# ── PATCH 7: Update renderKalshiConnectState ──────────────────────────────
OLD_KALSHI_STATE = '''function renderKalshiConnectState() {
  const form = document.getElementById('kalshiConnectForm');
  const row  = document.getElementById('kalshiConnectedRow');
  const badge = document.getElementById('kalshiStatusBadge');
  if (_kalshiConnected) {
    if (form)  form.style.display  = 'none';
    if (row)   row.style.display   = 'flex';
    if (badge) badge.innerHTML = '<span style="font-family:var(--mono);font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;border:1px solid rgba(45,155,95,0.4);color:#2d9b5f;background:rgba(45,155,95,0.1)">CONNECTED</span>';
  } else {
    if (form)  form.style.display  = 'block';
    if (row)   row.style.display   = 'none';
    if (badge) badge.innerHTML = '<span style="font-family:var(--mono);font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;border:1px solid var(--border);color:var(--muted)">NOT CONNECTED</span>';
    document.getElementById('kalshiPositions').innerHTML = '';
  }
}'''
NEW_KALSHI_STATE = '''function renderKalshiConnectState() {
  const form = document.getElementById('kalshiConnectForm');
  const row  = document.getElementById('kalshiConnectedRow');
  if (_kalshiConnected) {
    if (form) form.style.display = 'none';
    if (row)  row.style.display  = 'flex';
  } else {
    if (form) form.style.display = 'block';
    if (row)  row.style.display  = 'none';
    const el = document.getElementById('kalshiPositions');
    if (el) el.innerHTML = '';
  }
  if (typeof updatePortfolioTabDots === 'function') updatePortfolioTabDots();
}'''
if OLD_KALSHI_STATE in html:
    html = html.replace(OLD_KALSHI_STATE, NEW_KALSHI_STATE)
    print('✓ Patch 7: renderKalshiConnectState updated')
else:
    print('⚠ Patch 7: renderKalshiConnectState — pattern not found (may already be patched)')

# ── PATCH 8: Update renderManifoldConnectState ────────────────────────────
OLD_MANIFOLD_STATE = '''    if (badge)  badge.innerHTML = '<span style="font-family:var(--mono);font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;border:1px solid rgba(45,155,95,0.4);color:#2d9b5f;background:rgba(45,155,95,0.1)">CONNECTED</span>';
  } else {
    if (form)   form.style.display  = 'block';
    if (row)    row.style.display   = 'none';
    if (badge)  badge.innerHTML = '<span style="font-family:var(--mono);font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;border:1px solid var(--border);color:var(--muted)">NOT CONNECTED</span>';
    const el = document.getElementById('manifoldPositions');
    if (el) el.innerHTML = '';
  }
}

async function saveManifoldUsername()'''
NEW_MANIFOLD_STATE = '''    if (nameEl) nameEl.textContent = _manifoldUsername;
  } else {
    if (form)   form.style.display  = 'block';
    if (row)    row.style.display   = 'none';
    const el = document.getElementById('manifoldPositions');
    if (el) el.innerHTML = '';
  }
  if (typeof updatePortfolioTabDots === 'function') updatePortfolioTabDots();
}

async function saveManifoldUsername()'''
if OLD_MANIFOLD_STATE in html:
    html = html.replace(OLD_MANIFOLD_STATE, NEW_MANIFOLD_STATE)
    print('✓ Patch 8: renderManifoldConnectState updated')
else:
    print('⚠ Patch 8: renderManifoldConnectState — pattern not found')

# ── PATCH 9: Update renderPolymarketConnectState ──────────────────────────
OLD_POLY_STATE = '''    if (badge)  badge.innerHTML = '<span style="font-family:var(--mono);font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;border:1px solid rgba(45,155,95,0.4);color:#2d9b5f;background:rgba(45,155,95,0.1)">CONNECTED</span>';
  } else {
    if (form)   form.style.display  = 'block';
    if (row)    row.style.display   = 'none';
    if (badge)  badge.innerHTML = '<span style="font-family:var(--mono);font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;border:1px solid var(--border);color:var(--muted)">NOT CONNECTED</span>';
    const el = document.getElementById('polyPositions');
    if (el) el.innerHTML = '';
  }
}

async function connectPolymarket()'''
NEW_POLY_STATE = '''    if (nameEl) nameEl.textContent = _polyWalletAddress.slice(0,6) + '…' + _polyWalletAddress.slice(-4);
  } else {
    if (form)   form.style.display  = 'block';
    if (row)    row.style.display   = 'none';
    const el = document.getElementById('polyPositions');
    if (el) el.innerHTML = '';
  }
  if (typeof updatePortfolioTabDots === 'function') updatePortfolioTabDots();
}

async function connectPolymarket()'''
if OLD_POLY_STATE in html:
    html = html.replace(OLD_POLY_STATE, NEW_POLY_STATE)
    print('✓ Patch 9: renderPolymarketConnectState updated')
else:
    print('⚠ Patch 9: renderPolymarketConnectState — pattern not found')

# ── PATCH 10: loadPortfolio — update to call switchPortfolioTab + dots ──────
OLD_LOAD_PORTFOLIO = '''    renderKalshiConnectState();
    renderManifoldConnectState();
    renderPolymarketConnectState();
    if (_kalshiConnected) loadKalshiPositions(false);
    if (_manifoldUsername) loadManifoldPositions(false);
    if (_polyWalletAddress) loadPolymarketPositions(false);
  } catch (e) {
    console.warn('[portfolio]', e);
  }
}'''
NEW_LOAD_PORTFOLIO = '''    renderKalshiConnectState();
    renderManifoldConnectState();
    renderPolymarketConnectState();
    const fetches = [];
    if (_kalshiConnected) fetches.push(loadKalshiPositions(false));
    if (_manifoldUsername) fetches.push(loadManifoldPositions(false));
    if (_polyWalletAddress) fetches.push(loadPolymarketPositions(false));
    if (fetches.length) Promise.allSettled(fetches).then(() => { if (_activePortfolioTab === 'all') updateAllPositionsTab(); });
  } catch (e) {
    console.warn('[portfolio]', e);
  }
}'''
if OLD_LOAD_PORTFOLIO in html:
    html = html.replace(OLD_LOAD_PORTFOLIO, NEW_LOAD_PORTFOLIO)
    print('✓ Patch 10: loadPortfolio updated')
else:
    print('⚠ Patch 10: loadPortfolio — pattern not found')

# Write result
with open(path, 'w', encoding='utf-8') as f:
    f.write(html)

new_len = len(html)
print(f'\nDone. File size: {original_len:,} → {new_len:,} bytes ({new_len - original_len:+,})')
print('Now run: git add public/creator-dashboard.html && git commit -m "Portfolio UI overhaul: premium tabs, platform colors, sleek position cards + sidebar fix" && git push origin main')
