// HYPERFLEX — Preventive proxy-funding flow.
//
// Runs site-wide via nav.js. Two layers, both reusing the same direct
// EOA→proxy USDC.transfer dispatch pattern that market.html /
// creator-dashboard.html already use for the reactive in-trade panel:
//
//   LAYER A (one-time onboarding modal): fires the FIRST time a user
//     has both an EOA + proxy address cached in localStorage AND the
//     EOA holds USDC while the proxy is short. Lets them sweep all /
//     custom amount / skip. Whether they fund or skip, the modal
//     never shows again — Layer B catches subsequent sessions.
//
//   LAYER B (per-session banner): fires every session where EOA > 0
//     and proxy < $5. Dismissible per session via sessionStorage;
//     returns next session.
//
// Layer C (deposit-detection on tab focus / poll) deferred — flag for
// follow-up.
//
// All transfers reuse the same window.ethereum.eth_sendTransaction
// path the existing trade flow uses; no new transfer logic, no Safe
// dispatch (this is an EOA-signed direct ERC-20 call), no new
// approvals required.
(function() {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────
  var USDC_E_ADDR        = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
  var POLYGON_RPC_FALLBACKS = [
    'https://polygon-bor-rpc.publicnode.com',
    'https://1rpc.io/matic',
  ];
  var PROXY_MIN_ATOMIC   = 5n * 1_000_000n;   // $5 USDC threshold for "needs funding"
  var EOA_MIN_ATOMIC     = 1n * 1_000_000n;   // $1 USDC dust floor on the EOA
  var ONBOARDING_KEY     = 'hf_proxy_onboarding_seen';
  var BANNER_DISMISS_KEY = 'hf_fund_banner_dismissed';
  var POLL_INTERVAL_MS   = 3000;
  var POLL_DURATION_MS   = 30000;

  // ── V2 contract addresses (must match market.html) ────────────────
  // Used to compute the same approval-cache keys market.html writes
  // after each Safe execTransaction. If any flag is missing for a
  // funded user, we fire the same `hfx:onboarding-fund-complete` event
  // market.html listens to so its setupTradingApprovalsBundle runs
  // and back-fills the missing approvals — closing the gap for users
  // who funded their proxy via polymarket.com or any other path that
  // bypassed our onboarding modal.
  var CTF_EXCHANGE_V2_ADDR    = '0xE111180000d2663C0091e4f400237545B87B996B';
  var CONDITIONAL_TOKENS_ADDR = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
  var COLLATERAL_ONRAMP_ADDR  = '0x93070a847efEf7F70739046A929D47a521F5B8ee';
  var SETUP_FIRED_KEY         = 'hf_proxy_setup_fired';
  function _ackKey(prefix, owner, spender) {
    return prefix + owner.slice(-8).toLowerCase() + '_' + spender.slice(-8).toLowerCase();
  }
  function isApprovalSetupComplete(proxy) {
    try {
      return localStorage.getItem(_ackKey('hfx_usdce_ok_', proxy, COLLATERAL_ONRAMP_ADDR)) === '1'
          && localStorage.getItem(_ackKey('hfx_pusd_ok_',  proxy, CTF_EXCHANGE_V2_ADDR))    === '1'
          && localStorage.getItem(_ackKey('hfx_pusd_ok_',  proxy, CONDITIONAL_TOKENS_ADDR)) === '1'
          && localStorage.getItem(_ackKey('hfx_ctf_ok_',   proxy, CTF_EXCHANGE_V2_ADDR))    === '1';
    } catch (e) { return false; }
  }
  function markSetupFired() {
    try { localStorage.setItem(SETUP_FIRED_KEY, '1'); } catch (e) {}
  }
  function hasFiredSetup() {
    try { return localStorage.getItem(SETUP_FIRED_KEY) === '1'; } catch (e) { return false; }
  }

  var _checkInFlight = false;
  var _lastCheckTs   = 0;
  var _pollStopAt    = 0;
  var _pollTimer     = null;

  // ── Utilities ──────────────────────────────────────────────────────
  function shortAddr(a) {
    if (!a || a.length < 12) return a || '';
    return a.slice(0, 8) + '…' + a.slice(-4);
  }
  function fmtUsd(atomicBigInt) {
    if (typeof window.ethers !== 'undefined') {
      try { return Number(window.ethers.formatUnits(atomicBigInt, 6)).toFixed(2); }
      catch (e) { /* fall through */ }
    }
    return (Number(atomicBigInt) / 1e6).toFixed(2);
  }
  function ready() {
    return typeof window.ethers !== 'undefined'
        && typeof window.ethereum !== 'undefined';
  }
  function getEoa()   { try { return localStorage.getItem('poly_eoa_address') || null; } catch (e) { return null; } }
  function getProxy() { try { return localStorage.getItem('hf_poly_wallet') || null; }   catch (e) { return null; } }

  // ── Public RPC balance read ────────────────────────────────────────
  // No retry layer — if the first RPC is down, fall through to the
  // second. Both balances fetched in parallel from the same provider
  // to avoid double the network round-trips.
  async function readBalances(eoa, proxy) {
    var lastErr = null;
    for (var i = 0; i < POLYGON_RPC_FALLBACKS.length; i++) {
      try {
        var provider = new window.ethers.JsonRpcProvider(POLYGON_RPC_FALLBACKS[i]);
        var usdc = new window.ethers.Contract(USDC_E_ADDR, [
          'function balanceOf(address) view returns (uint256)'
        ], provider);
        var pair = await Promise.all([usdc.balanceOf(eoa), usdc.balanceOf(proxy)]);
        return { eoaBal: pair[0], proxyBal: pair[1] };
      } catch (e) {
        lastErr = e;
        console.warn('[fund-proxy] RPC ' + POLYGON_RPC_FALLBACKS[i] + ' failed:', e.message);
      }
    }
    throw lastErr || new Error('All Polygon RPCs failed');
  }

  // ── EOA-signed USDC.transfer to proxy ──────────────────────────────
  // Mirrors transferUsdceEoaToProxy in market.html. Awaits 1
  // confirmation so any in-trade pre-flight that fires immediately
  // after sees the new balance.
  async function transferUsdceEoaToProxy(amountAtomic, eoa, proxy) {
    if (!eoa || !proxy) throw new Error('Wallet addresses missing');
    if (!window.ethereum) throw new Error('MetaMask not available');
    var iface = new window.ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
    var data = iface.encodeFunctionData('transfer', [proxy, String(amountAtomic)]);
    console.log('[fund-proxy] transfer ' + fmtUsd(amountAtomic) + ' USDC.e EOA→proxy');
    var txHash;
    try {
      txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: eoa, to: USDC_E_ADDR, data: data, value: '0x0' }]
      });
    } catch (e) {
      if (e && (e.code === 4001 || e.code === 'ACTION_REJECTED')) {
        throw new Error('Signature rejected in MetaMask — funding cancelled.');
      }
      throw new Error(e.message || 'Transfer failed to send');
    }
    console.log('[fund-proxy] tx ' + txHash + ' submitted, awaiting receipt');
    var provider = new window.ethers.JsonRpcProvider(POLYGON_RPC_FALLBACKS[0]);
    var receipt = await provider.waitForTransaction(txHash, 1, 90000);
    if (!receipt) throw new Error('Transfer not confirmed within 90s — see https://polygonscan.com/tx/' + txHash);
    if (receipt.status !== 1) throw new Error('Transfer reverted on-chain — see tx ' + txHash);
    console.log('[fund-proxy] confirmed in block ' + receipt.blockNumber);
    return txHash;
  }

  // ── Layer A: one-time onboarding modal ─────────────────────────────
  function renderOnboardingModal(eoa, proxy, eoaBal, proxyBal) {
    if (document.getElementById('hfxFundProxyModal')) return;
    var eoaUsd  = fmtUsd(eoaBal);
    var overlay = document.createElement('div');
    overlay.id = 'hfxFundProxyModal';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.78);backdrop-filter:blur(6px);' +
      'z-index:10005;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML =
      '<div style="max-width:480px;width:100%;background:#0f0f15;border:1px solid rgba(201,146,13,0.45);' +
                  'border-radius:8px;padding:28px;color:#f0f0f5;font-family:system-ui,-apple-system,sans-serif">' +
        '<div style="font-family:\'JetBrains Mono\',ui-monospace,monospace;font-size:11px;letter-spacing:0.18em;' +
                    'text-transform:uppercase;color:#c9920d;margin-bottom:14px">Welcome to HYPERFLEX</div>' +
        '<div style="font-size:22px;font-weight:700;line-height:1.3;margin-bottom:14px">' +
          'Let\'s set up your trading wallet.' +
        '</div>' +
        '<div style="font-size:14px;line-height:1.6;color:#c5c0d5;margin-bottom:18px">' +
          'We detected <strong>$' + eoaUsd + ' USDC</strong> on your wallet ' +
          '(<span style="font-family:\'JetBrains Mono\',ui-monospace,monospace">' + shortAddr(eoa) + '</span>). ' +
          'To trade, those funds need to live on your Polymarket-native trading wallet ' +
          '(<span style="font-family:\'JetBrains Mono\',ui-monospace,monospace">' + shortAddr(proxy) + '</span>). ' +
          'Move now so you can trade in one click later.' +
        '</div>' +
        '<div id="hfxFpModalStatus" style="display:none;font-family:\'JetBrains Mono\',ui-monospace,monospace;' +
                    'font-size:12px;padding:10px 12px;border-radius:4px;margin-bottom:14px"></div>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' +
          '<button id="hfxFpMoveAll" style="padding:13px 16px;font-family:\'JetBrains Mono\',ui-monospace,monospace;' +
                  'font-size:12px;font-weight:700;letter-spacing:0.06em;border:1px solid #c9920d;background:#c9920d;' +
                  'color:#000;cursor:pointer;border-radius:4px">' +
            'Move all $' + eoaUsd + ' → trading wallet' +
          '</button>' +
          '<button id="hfxFpMoveCustom" style="padding:11px 16px;font-family:\'JetBrains Mono\',ui-monospace,monospace;' +
                  'font-size:12px;font-weight:600;letter-spacing:0.06em;border:1px solid rgba(201,146,13,0.45);' +
                  'background:transparent;color:#c9920d;cursor:pointer;border-radius:4px">' +
            'Move custom amount' +
          '</button>' +
          '<div id="hfxFpCustomRow" style="display:none;gap:8px;margin-top:4px">' +
            '<input id="hfxFpCustomAmt" type="number" min="1" step="0.01" placeholder="USDC amount" ' +
                   'style="flex:1;padding:10px 12px;font-family:\'JetBrains Mono\',ui-monospace,monospace;' +
                          'font-size:13px;border:1px solid rgba(255,255,255,0.15);background:#1a1a22;' +
                          'color:#f0f0f5;border-radius:4px">' +
            '<button id="hfxFpCustomGo" style="padding:10px 14px;font-family:\'JetBrains Mono\',ui-monospace,monospace;' +
                    'font-size:11px;font-weight:700;letter-spacing:0.06em;border:1px solid #c9920d;background:#c9920d;' +
                    'color:#000;cursor:pointer;border-radius:4px">Send</button>' +
          '</div>' +
          '<button id="hfxFpSkip" style="padding:9px 16px;margin-top:6px;font-family:\'JetBrains Mono\',ui-monospace,monospace;' +
                  'font-size:11px;font-weight:500;letter-spacing:0.06em;border:none;background:transparent;' +
                  'color:#6e6790;cursor:pointer">' +
            'Skip — fund via polymarket.com later' +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    function setStatus(msg, kind) {
      var s = document.getElementById('hfxFpModalStatus');
      s.textContent = msg;
      s.style.display = 'block';
      s.style.color = kind === 'error' ? '#ff8b8b' : kind === 'success' ? '#9beb9b' : '#c9920d';
      s.style.background = kind === 'error' ? 'rgba(255,77,106,0.08)' : kind === 'success' ? 'rgba(0,230,138,0.08)' : 'rgba(201,146,13,0.08)';
    }
    function setButtonsDisabled(disabled) {
      ['hfxFpMoveAll', 'hfxFpMoveCustom', 'hfxFpCustomGo', 'hfxFpSkip'].forEach(function(id) {
        var b = document.getElementById(id);
        if (b) b.disabled = disabled;
      });
    }
    async function executeTransfer(amountAtomic) {
      setButtonsDisabled(true);
      setStatus('Confirm in MetaMask…', 'info');
      try {
        await transferUsdceEoaToProxy(amountAtomic, eoa, proxy);
        markOnboardingSeen();

        // Phase 2 — bundle setup approvals while we have the user's
        // attention. Dispatches an event that market.html listens for
        // and runs the existing approve-on-Safe helpers in sequence.
        // On pages without that listener (mentions/explore/events),
        // the event fires into the void and the modal closes with the
        // funded-only message — same as before this hook landed.
        // Either way, the EOA→proxy wall is gone for good.
        var setupRan = false;
        function onProgress(e) {
          var d = (e && e.detail) || {};
          if (d.message) setStatus(d.message, d.kind || 'info');
        }
        function onDone() {
          setupRan = true;
          setStatus('Trading wallet ready — sign once per trade from now on.', 'success');
          setTimeout(function() {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            showToast('Trading wallet ready — sign once per trade from now on.');
          }, 1500);
        }
        function onFail(e) {
          var msg = (e && e.detail && e.detail.message) || 'Setup paused — you can complete it on your first trade.';
          setStatus(msg, 'info');
          setTimeout(function() {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            showToast('Trading wallet funded. Approvals will finish on your first trade.');
          }, 2000);
        }
        window.addEventListener('hfx:setup-progress', onProgress);
        window.addEventListener('hfx:onboarding-setup-done', onDone, { once: true });
        window.addEventListener('hfx:onboarding-setup-failed', onFail, { once: true });

        setStatus('Funds received. Setting up trading approvals…', 'info');
        window.dispatchEvent(new CustomEvent('hfx:onboarding-fund-complete', {
          detail: { proxyAddr: proxy, eoaAddr: eoa }
        }));

        // Fallback: if no listener handled the event (page didn't
        // bundle setup), close the modal after 4s with the
        // funded-only message. Market pages typically respond within
        // ~500ms by setting setup-progress; 4s is comfortable for
        // listener attach + first popup prompt.
        setTimeout(function() {
          if (setupRan) return;
          if (overlay.parentNode) {
            setStatus('Trading wallet funded — you\'re ready to trade.', 'success');
            setTimeout(function() {
              if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
              showToast('Trading wallet funded — you\'re ready to trade.');
            }, 1500);
          }
        }, 4000);
      } catch (e) {
        setStatus(e.message || 'Transfer failed', 'error');
        setButtonsDisabled(false);
      }
    }
    document.getElementById('hfxFpMoveAll').onclick = function() {
      executeTransfer(eoaBal);
    };
    document.getElementById('hfxFpMoveCustom').onclick = function() {
      document.getElementById('hfxFpMoveCustom').style.display = 'none';
      document.getElementById('hfxFpCustomRow').style.display = 'flex';
      document.getElementById('hfxFpCustomAmt').focus();
    };
    document.getElementById('hfxFpCustomGo').onclick = function() {
      var raw = parseFloat(document.getElementById('hfxFpCustomAmt').value || '0');
      if (!isFinite(raw) || raw <= 0) { setStatus('Enter a valid USDC amount', 'error'); return; }
      var atomic = BigInt(Math.round(raw * 1e6));
      if (atomic > eoaBal) { setStatus('Amount exceeds your wallet balance ($' + fmtUsd(eoaBal) + ')', 'error'); return; }
      executeTransfer(atomic);
    };
    document.getElementById('hfxFpSkip').onclick = function() {
      // Mark seen so we don't show modal again, but Layer B banner
      // still fires next session if proxy stays short.
      markOnboardingSeen();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      // Surface the banner immediately so the user has a way back.
      renderBanner(eoa, proxy);
    };
  }

  // ── Layer B: persistent per-session banner ─────────────────────────
  function renderBanner(eoa, proxy) {
    if (document.getElementById('hfxFundProxyBanner')) return;
    if (sessionStorage.getItem(BANNER_DISMISS_KEY) === '1') return;
    var bar = document.createElement('div');
    bar.id = 'hfxFundProxyBanner';
    bar.style.cssText =
      'position:sticky;top:0;left:0;right:0;z-index:998;' +
      'display:flex;align-items:center;justify-content:center;gap:14px;' +
      'padding:10px 16px;background:rgba(0,212,255,0.08);' +
      'border-bottom:1px solid rgba(0,212,255,0.40);' +
      'font-family:\'JetBrains Mono\',ui-monospace,monospace;font-size:12px;color:#9bebff';
    bar.innerHTML =
      '<span>Your trading wallet needs funding to trade.</span>' +
      '<button id="hfxFpBannerCta" style="padding:5px 12px;font-family:inherit;font-size:11px;font-weight:700;' +
                                          'letter-spacing:0.06em;border:1px solid #00d4ff;background:#00d4ff;' +
                                          'color:#001a23;cursor:pointer;border-radius:3px">Move funds →</button>' +
      '<button id="hfxFpBannerClose" aria-label="Dismiss" style="position:absolute;right:10px;top:50%;' +
                                          'transform:translateY(-50%);padding:0 8px;font-family:inherit;' +
                                          'font-size:14px;border:none;background:transparent;color:#6e6790;' +
                                          'cursor:pointer;line-height:1">×</button>';
    bar.style.position = 'relative';
    document.body.insertBefore(bar, document.body.firstChild);

    document.getElementById('hfxFpBannerCta').onclick = async function() {
      // Re-read balances in case the user's wallet state changed since
      // the banner was rendered. Fresh data prevents the modal from
      // showing a stale figure.
      try {
        var b = await readBalances(eoa, proxy);
        if (b.proxyBal >= PROXY_MIN_ATOMIC) {
          // Already funded since banner showed — dismiss + congratulate.
          dismissBannerForSession();
          showToast('Trading wallet already funded.');
          return;
        }
        if (bar.parentNode) bar.parentNode.removeChild(bar);
        // Don't mark onboarding seen here — they're using the banner,
        // not the first-time modal. Re-use the modal UI for the
        // transfer flow since it has all the controls.
        renderOnboardingModal(eoa, proxy, b.eoaBal, b.proxyBal);
      } catch (e) {
        console.warn('[fund-proxy] banner refresh failed:', e.message);
        // Fall back to the cached values we rendered with.
        if (bar.parentNode) bar.parentNode.removeChild(bar);
        renderOnboardingModal(eoa, proxy, /* eoaBal */ 0n, /* proxyBal */ 0n);
      }
    };
    document.getElementById('hfxFpBannerClose').onclick = function() {
      dismissBannerForSession();
    };
  }

  function dismissBannerForSession() {
    try { sessionStorage.setItem(BANNER_DISMISS_KEY, '1'); } catch (e) {}
    var bar = document.getElementById('hfxFundProxyBanner');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }
  function markOnboardingSeen() {
    try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch (e) {}
  }
  function hasSeenOnboarding() {
    try { return localStorage.getItem(ONBOARDING_KEY) === '1'; } catch (e) { return false; }
  }

  // ── Setup-status toast (already-funded users — no modal context) ──
  // Lightweight cyan toast that follows the hfx:setup-progress events
  // emitted by market.html's setupTradingApprovalsBundle. Used when
  // we detect a funded-but-unapproved user and fire the bundle
  // without opening the onboarding modal. Closes itself on done /
  // failed. Lives at top-right; doesn't block page interaction.
  function showSetupToast() {
    if (document.getElementById('hfxSetupToast')) return;
    var el = document.createElement('div');
    el.id = 'hfxSetupToast';
    el.style.cssText =
      'position:fixed;top:20px;right:20px;z-index:10006;max-width:380px;' +
      'padding:14px 16px;background:rgba(0,212,255,0.08);' +
      'border:1px solid rgba(0,212,255,0.40);border-radius:6px;' +
      'font-family:\'JetBrains Mono\',ui-monospace,monospace;font-size:12px;color:#9bebff;' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.4)';
    el.innerHTML = '<div style="font-weight:700;margin-bottom:4px;letter-spacing:0.06em">Setting up trading wallet…</div>' +
                   '<div id="hfxSetupToastMsg" style="color:#c5bedd">Sign the next prompts to finish setup. After this, every trade is one click.</div>';
    document.body.appendChild(el);
    function onProgress(e) {
      var d = (e && e.detail) || {};
      var m = document.getElementById('hfxSetupToastMsg');
      if (m && d.message) m.textContent = d.message;
    }
    function onDone() {
      cleanup();
      if (el.parentNode) el.parentNode.removeChild(el);
      showToast('Trading wallet ready — sign once per trade from now on.');
    }
    function onFailed(e) {
      cleanup();
      var msg = (e && e.detail && e.detail.message) || 'Setup paused — finish on your next trade.';
      var m = document.getElementById('hfxSetupToastMsg');
      if (m) m.textContent = msg;
      el.style.borderColor = 'rgba(255,77,106,0.40)';
      el.style.background = 'rgba(255,77,106,0.06)';
      el.style.color = '#ffb3b3';
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 4000);
    }
    function cleanup() {
      window.removeEventListener('hfx:setup-progress', onProgress);
      window.removeEventListener('hfx:onboarding-setup-done', onDone);
      window.removeEventListener('hfx:onboarding-setup-failed', onFailed);
    }
    window.addEventListener('hfx:setup-progress', onProgress);
    window.addEventListener('hfx:onboarding-setup-done', onDone, { once: true });
    window.addEventListener('hfx:onboarding-setup-failed', onFailed, { once: true });
    // Hard timeout: if no listener exists on this page, the toast
    // would otherwise stick. Auto-clean after 60s.
    setTimeout(function() { cleanup(); if (el.parentNode) el.parentNode.removeChild(el); }, 60000);
  }

  // ── Toast (success only — errors stay in-modal) ────────────────────
  function showToast(msg) {
    var t = document.createElement('div');
    t.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:10006;' +
      'padding:12px 16px;background:rgba(0,230,138,0.12);border:1px solid rgba(0,230,138,0.4);' +
      'color:#9beb9b;font-family:\'JetBrains Mono\',ui-monospace,monospace;font-size:12px;' +
      'border-radius:4px;max-width:360px;box-shadow:0 4px 24px rgba(0,0,0,0.4)';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  }

  // ── Main check — runs after wallet appears + addresses are cached ──
  async function runCheck() {
    if (_checkInFlight) return;
    if (!ready()) return;
    var eoa = getEoa();
    var proxy = getProxy();
    if (!eoa || !proxy) return;
    if (eoa.toLowerCase() === proxy.toLowerCase()) return; // proxy not yet resolved
    // Throttle: at most one network call per 30s
    if (Date.now() - _lastCheckTs < 30000) return;
    _checkInFlight = true;
    _lastCheckTs = Date.now();
    try {
      var b = await readBalances(eoa, proxy);
      // Funded path: proxy already has USDC.e. Don't surface a fund
      // modal/banner — but still close the approval gap if the user
      // funded their proxy via polymarket.com or any other path that
      // bypassed our onboarding bundle. Without this, already-funded
      // users would still hit 4 cold approval popups on their first
      // trade.
      if (b.proxyBal >= PROXY_MIN_ATOMIC) {
        markOnboardingSeen();
        if (!hasFiredSetup() && !isApprovalSetupComplete(proxy)) {
          markSetupFired();
          // Same hook market.html's listener attaches to. On non-/market
          // pages the event fires into the void and the user picks up
          // the popups at trade time — same as today, no regression.
          window.dispatchEvent(new CustomEvent('hfx:onboarding-fund-complete', {
            detail: { proxyAddr: proxy, eoaAddr: eoa, source: 'already-funded' }
          }));
          // Surface a quick toast so the popups aren't a surprise.
          // market.html's bundle emits hfx:setup-progress which we
          // already listen for inside the modal flow; for the
          // already-funded path we don't open the modal, so do a
          // lightweight inline status.
          showSetupToast();
        }
        return;
      }
      // Skip if EOA also has nothing to move (dust < $1)
      if (b.eoaBal < EOA_MIN_ATOMIC) return;
      // Decide layer
      if (!hasSeenOnboarding()) {
        renderOnboardingModal(eoa, proxy, b.eoaBal, b.proxyBal);
      } else {
        renderBanner(eoa, proxy);
      }
    } catch (e) {
      // Soft-fail — never block page rendering on this check
      console.warn('[fund-proxy] balance check skipped:', e.message);
    } finally {
      _checkInFlight = false;
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────
  // 1. On DOM ready, attempt an immediate check (catches users with
  //    cached addresses arriving on page).
  // 2. For 30s after load, poll every 3s in case the user is mid-
  //    connect (connect flow writes to localStorage but doesn't
  //    dispatch a global event we can hook).
  // 3. After the polling window, also re-check on tab focus so a
  //    user who deposits new USDC into their EOA in another tab gets
  //    the banner on their next return.
  function startPolling() {
    _pollStopAt = Date.now() + POLL_DURATION_MS;
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(function() {
      if (Date.now() > _pollStopAt) { clearInterval(_pollTimer); _pollTimer = null; return; }
      runCheck();
    }, POLL_INTERVAL_MS);
  }
  function onReady() {
    if (!ready()) {
      // ethers might not have finished loading yet — wait briefly.
      var waited = 0;
      var iv = setInterval(function() {
        waited += 200;
        if (ready() || waited > 8000) {
          clearInterval(iv);
          if (ready()) { runCheck(); startPolling(); }
        }
      }, 200);
      return;
    }
    runCheck();
    startPolling();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
  // Re-check on tab focus (free Layer C-lite — covers users who deposit
  // new USDC in another tab and come back).
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') runCheck();
  });

  // Public hook for other scripts to dispatch after a wallet connect:
  //   window.dispatchEvent(new Event('hfx:wallet-connected'))
  // No callsites required for v1 (the polling window covers the
  // immediate-after-connect case), but we expose it so future connect
  // flows can be precise instead of relying on the poll.
  window.addEventListener('hfx:wallet-connected', function() {
    _lastCheckTs = 0; // bypass the 30s throttle
    runCheck();
  });
})();
