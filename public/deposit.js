/**
 * HFXDeposit — USDC deposit flow (EOA → Polymarket proxy)
 *
 * Standalone module loaded on every HYPERFLEX page via nav.js. Exposes
 * window.HFXDeposit.open() as the single entry point.
 *
 * Why a shared module:
 * - The deposit flow needs to be accessible from /market/:slug, /creator/
 *   dashboard, /whales, and anywhere else a user might realize they have
 *   no USDC on their proxy. Duplicating ~300 lines of modal code + signing
 *   logic in each page is a maintenance nightmare.
 *
 * Dependencies (all loaded by nav.js):
 * - window.ethers (ethers v6)
 * - window.HFXWallet (shared wallet helper — getSigner, invalidate)
 *
 * State machine:
 *   loading → ready (has USDC) → signing → confirming → success
 *           → ready (no USDC — shows onramps)
 *           → error (any failure state)
 *
 * The module is idempotent — calling open() while a modal is already
 * visible is a no-op. All DOM nodes are created/torn down per call.
 */
(function() {
  'use strict';

  try { console.log('[HFXDeposit] loaded at', new Date().toISOString()); } catch (e) {}

  var USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
  var SAFE_FACTORY = '0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b';
  var POLYGON_RPCS = [
    'https://polygon-bor-rpc.publicnode.com',
    'https://1rpc.io/matic',
    'https://polygon-rpc.com'
  ];

  function _esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  async function _getPublicProvider() {
    if (!window.ethers) throw new Error('ethers.js not loaded');
    for (var i = 0; i < POLYGON_RPCS.length; i++) {
      try {
        var p = new window.ethers.JsonRpcProvider(POLYGON_RPCS[i]);
        await p.getBlockNumber();
        return p;
      } catch (e) { /* try next */ }
    }
    throw new Error('All public RPCs failed');
  }

  async function _computeProxy(eoa) {
    var provider = await _getPublicProvider();
    var factory = new window.ethers.Contract(SAFE_FACTORY, [
      'function computeProxyAddress(address user) view returns (address)'
    ], provider);
    var proxy = await factory.computeProxyAddress(eoa);
    return proxy;
  }

  async function _usdcBalance(address) {
    if (!address) return null;
    try {
      var provider = await _getPublicProvider();
      var contract = new window.ethers.Contract(USDC_ADDRESS, ['function balanceOf(address) view returns (uint256)'], provider);
      var raw = await contract.balanceOf(address);
      return parseFloat(window.ethers.formatUnits(raw, 6));
    } catch (e) { return null; }
  }

  async function _polBalance(address) {
    if (!address) return null;
    try {
      var provider = await _getPublicProvider();
      var raw = await provider.getBalance(address);
      return parseFloat(window.ethers.formatEther(raw));
    } catch (e) { return null; }
  }

  function _ensureOverlay() {
    var existing = document.getElementById('hfxDepositOverlay');
    if (existing) return existing;
    var o = document.createElement('div');
    o.id = 'hfxDepositOverlay';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(4px);z-index:10020;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,-apple-system,sans-serif';
    o.onclick = function(e) { if (e.target === o) close(); };
    document.body.appendChild(o);

    // Inject keyframes once
    if (!document.getElementById('hfxDepositStyle')) {
      var style = document.createElement('style');
      style.id = 'hfxDepositStyle';
      style.textContent = '@keyframes hfxDepositSpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
    return o;
  }

  function close() {
    var o = document.getElementById('hfxDepositOverlay');
    if (o) o.remove();
  }

  // Renders the modal body for the given state
  function _frame(state) {
    var bg = '#0e0e0c';
    var border = 'rgba(0,230,138,0.4)';
    if (state.error) border = '#ff4d6a';

    // LOADING
    if (state.loading) {
      return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:28px;max-width:440px;width:100%;color:#f0f0f5;text-align:center">' +
        '<div style="display:inline-block;width:32px;height:32px;border:3px solid #1e1e2a;border-top-color:#00e68a;border-radius:50%;animation:hfxDepositSpin 0.8s linear infinite"></div>' +
        '<div style="margin-top:12px;font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#8888a0">Loading your wallet balances…</div>' +
      '</div>';
    }

    // ERROR
    if (state.error) {
      return '<div style="background:' + bg + ';border:1px solid #ff4d6a;border-radius:14px;padding:28px;max-width:440px;width:100%;color:#f0f0f5">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
          '<span style="font-size:18px">⚠</span>' +
          '<div style="font-size:15px;font-weight:800;flex:1">Deposit unavailable</div>' +
          '<button onclick="HFXDeposit.close()" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;padding:0 6px">✕</button>' +
        '</div>' +
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#aaa;line-height:1.6;margin-bottom:16px">' + _esc(state.error) + '</div>' +
        '<button onclick="HFXDeposit.close()" style="width:100%;background:rgba(255,255,255,0.06);color:#f0f0f5;border:1px solid #1e1e2a;padding:12px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;cursor:pointer">Close</button>' +
      '</div>';
    }

    // SIGNING
    if (state.signing) {
      return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:28px;max-width:440px;width:100%;color:#f0f0f5;text-align:center">' +
        '<div style="display:inline-block;width:32px;height:32px;border:3px solid #1e1e2a;border-top-color:#00e68a;border-radius:50%;animation:hfxDepositSpin 0.8s linear infinite"></div>' +
        '<div style="margin-top:14px;font-size:14px;font-weight:700;color:#00e68a">Check MetaMask → sign the transfer</div>' +
        '<div style="margin-top:6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0">Sending $' + (state.amount || 0).toFixed(2) + ' USDC to your Polymarket wallet</div>' +
      '</div>';
    }

    // CONFIRMING
    if (state.confirming) {
      return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:28px;max-width:440px;width:100%;color:#f0f0f5;text-align:center">' +
        '<div style="display:inline-block;width:32px;height:32px;border:3px solid #1e1e2a;border-top-color:#00e68a;border-radius:50%;animation:hfxDepositSpin 0.8s linear infinite"></div>' +
        '<div style="margin-top:14px;font-size:14px;font-weight:700;color:#00e68a">Waiting for confirmation…</div>' +
        '<div style="margin-top:6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0">Usually 2–5 seconds on Polygon</div>' +
        (state.txHash ? '<div style="margin-top:12px"><a href="https://polygonscan.com/tx/' + _esc(state.txHash) + '" target="_blank" rel="noopener" style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#4d9fff;text-decoration:none">View on Polygonscan ↗</a></div>' : '') +
      '</div>';
    }

    // SUCCESS
    if (state.success) {
      return '<div style="background:' + bg + ';border:1px solid #00e68a;border-radius:14px;padding:28px;max-width:440px;width:100%;color:#f0f0f5;text-align:center">' +
        '<div style="font-size:48px;margin-bottom:8px">✅</div>' +
        '<div style="font-size:18px;font-weight:800;color:#00e68a;margin-bottom:4px">Deposited $' + (state.amount || 0).toFixed(2) + ' USDC</div>' +
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;margin-bottom:18px">New Polymarket balance: <strong style="color:#f0f0f5">$' + (state.newProxyBalance || 0).toFixed(2) + '</strong></div>' +
        (state.txHash ? '<div style="margin-bottom:18px"><a href="https://polygonscan.com/tx/' + _esc(state.txHash) + '" target="_blank" rel="noopener" style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#4d9fff;text-decoration:none">View tx on Polygonscan ↗</a></div>' : '') +
        '<button onclick="HFXDeposit.close()" style="background:#00e68a;color:#0a0a0f;border:none;padding:12px 32px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:800;cursor:pointer;min-height:44px">Close</button>' +
      '</div>';
    }

    // READY — tabbed interface
    var eoaBal = state.eoaBalance != null ? state.eoaBalance : 0;
    var proxyBal = state.proxyBalance != null ? state.proxyBalance : 0;
    var hasEoaUsdc = eoaBal >= 0.01;
    var hasGas = state.polBalance == null || state.polBalance >= 0.001;

    // Default tab: if user has USDC in MetaMask, start on transfer.
    // Otherwise start on Exchange (most common path for new users).
    var currentTab = state.currentTab || (hasEoaUsdc ? 'metamask' : 'exchange');

    function tabBtn(tab, label, icon) {
      var active = currentTab === tab;
      return '<button onclick="HFXDeposit._setTab(\'' + tab + '\')" style="flex:1;min-width:auto;padding:10px 8px;border:1px solid ' + (active ? '#00e68a' : '#1e1e2a') + ';background:' + (active ? 'rgba(0,230,138,0.08)' : 'transparent') + ';color:' + (active ? '#00e68a' : '#8888a0') + ';font-family:\'JetBrains Mono\',monospace;font-size:10px;font-weight:700;border-radius:8px;cursor:pointer;transition:all 0.15s;min-height:40px;white-space:nowrap">' + icon + ' ' + label + '</button>';
    }

    var tabsHtml =
      '<div style="display:flex;gap:6px;margin-bottom:16px;overflow-x:auto;padding-bottom:2px">' +
        tabBtn('metamask', 'MetaMask', '🦊') +
        tabBtn('exchange', 'Exchange', '🏦') +
        tabBtn('card', 'Card/Bank', '💳') +
        tabBtn('bridge', 'Bridge', '🌉') +
      '</div>';

    var bodyHtml;
    if (currentTab === 'metamask') {
      if (hasEoaUsdc) {
        bodyHtml =
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Amount to deposit</div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">' +
            '<div style="flex:1;position:relative">' +
              '<span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-family:\'JetBrains Mono\',monospace;font-size:15px;color:#8888a0">$</span>' +
              '<input type="number" id="hfxDepositAmount" placeholder="0.00" step="0.01" min="0.01" max="' + eoaBal + '" style="width:100%;background:#1a1917;border:1px solid #1e1e2a;border-radius:6px;padding:12px 12px 12px 26px;font-family:\'JetBrains Mono\',monospace;font-size:16px;font-weight:700;color:#f0f0f5;outline:none;box-sizing:border-box"/>' +
            '</div>' +
            '<button onclick="document.getElementById(\'hfxDepositAmount\').value=' + eoaBal.toFixed(2) + '" style="background:rgba(0,230,138,0.1);border:1px solid rgba(0,230,138,0.3);color:#00e68a;padding:10px 14px;border-radius:6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;min-height:44px">MAX</button>' +
          '</div>' +
          (!hasGas ? '<div style="padding:10px 12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:6px;margin-bottom:14px;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#f59e0b;line-height:1.5">⚠ Your MetaMask has no POL for gas. You need ~$0.01 in POL to submit the transfer. <a href="https://wallet.polygon.technology/" target="_blank" rel="noopener" style="color:#00e68a">Get POL →</a></div>' : '') +
          '<button onclick="HFXDeposit._submit()" id="hfxDepositSubmitBtn" style="width:100%;background:#00e68a;color:#0a0a0f;border:none;padding:14px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:800;cursor:pointer;min-height:48px">Sign & Deposit →</button>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;margin-top:14px;text-align:center">Standard USDC ERC-20 transfer on Polygon · Gas: ~$0.01 in POL</div>';
      } else {
        // MetaMask tab but no USDC in EOA
        bodyHtml =
          '<div style="padding:18px 20px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.25);border-radius:10px;text-align:center">' +
            '<div style="font-size:28px;margin-bottom:8px">🦊</div>' +
            '<div style="font-size:14px;font-weight:700;color:#f59e0b;margin-bottom:4px">No USDC in your MetaMask</div>' +
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;line-height:1.7">Your MetaMask wallet has no USDC on Polygon. Switch to one of the other tabs above to fund your Polymarket wallet another way.</div>' +
          '</div>';
      }
    } else if (currentTab === 'exchange') {
      var addr = state.proxy || '';
      var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=' + encodeURIComponent(addr);
      bodyHtml =
        '<div style="padding:12px 14px;background:rgba(255,77,106,0.08);border:1px solid rgba(255,77,106,0.3);border-radius:8px;margin-bottom:14px">' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:800;color:#ff4d6a;margin-bottom:6px">⚠ READ THIS BEFORE SENDING</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#f0f0f5;line-height:1.6">' +
            '<strong>Network MUST be Polygon</strong> (not Ethereum, not Optimism, not Base). ' +
            'Sending on the wrong network will lose your funds permanently. If your exchange calls it "MATIC", that\'s the same as Polygon.' +
          '</div>' +
        '</div>' +

        // Address + QR
        '<div style="display:flex;gap:14px;align-items:center;padding:14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:10px;margin-bottom:14px;flex-wrap:wrap">' +
          '<div style="width:150px;height:150px;background:#fff;border-radius:8px;flex-shrink:0;padding:8px;box-sizing:border-box">' +
            '<img src="' + qrUrl + '" alt="Deposit address QR" style="width:100%;height:100%;display:block" onerror="this.style.display=\'none\'"/>' +
          '</div>' +
          '<div style="flex:1;min-width:200px">' +
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Your Polymarket address</div>' +
            '<div id="hfxDepositAddrEl" style="font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;color:#f0f0f5;word-break:break-all;line-height:1.5;margin-bottom:10px;user-select:all">' + _esc(addr) + '</div>' +
            '<button onclick="HFXDeposit._copyAddr()" id="hfxDepositCopyBtn" style="width:100%;background:rgba(0,230,138,0.1);border:1px solid rgba(0,230,138,0.3);color:#00e68a;padding:10px 14px;border-radius:6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;min-height:40px">📋 Copy address</button>' +
          '</div>' +
        '</div>' +

        // Exchange-specific instructions (collapsible-ish)
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">How to send from your exchange</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">' +
          _exchangeRow('Coinbase', 'Pay → Send → USDC → enter this address → Network: <strong style="color:#f0f0f5">Polygon</strong>', 'https://www.coinbase.com/') +
          _exchangeRow('Binance', 'Wallet → Withdraw → USDC → paste this address → Network: <strong style="color:#f0f0f5">Polygon (MATIC)</strong>', 'https://www.binance.com/en/my/wallet/account/main/withdrawal/crypto/USDC') +
          _exchangeRow('Kraken', 'Funding → Withdraw → USDC → New address → Network: <strong style="color:#f0f0f5">Polygon</strong>', 'https://www.kraken.com/u/funding/withdraw?asset=USDC') +
          _exchangeRow('OKX', 'Assets → Withdraw → USDC → On-chain → Network: <strong style="color:#f0f0f5">Polygon</strong>', 'https://www.okx.com/balance/withdrawal/usdc') +
          _exchangeRow('Robinhood', 'Crypto → USDC → Send → Polygon network', 'https://robinhood.com/') +
        '</div>' +

        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;padding:10px 12px;background:rgba(77,159,255,0.04);border:1px solid rgba(77,159,255,0.15);border-radius:6px">' +
          '<strong style="color:#4d9fff">Timing:</strong> Most exchanges confirm within 2-5 minutes on Polygon. You\'ll see your balance update on HYPERFLEX automatically.' +
        '</div>';
    } else if (currentTab === 'card') {
      bodyHtml =
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;line-height:1.7;margin-bottom:14px">Buy USDC directly with a card, bank transfer, or existing crypto. These providers send USDC straight to your MetaMask, then use the MetaMask tab above to forward it to Polymarket.</div>' +

        '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">' +
          '<a href="https://buy.ramp.network/?userAddress=' + _esc(state.eoa || '') + '&swapAsset=MATIC_USDC&defaultAsset=MATIC_USDC" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(0,230,138,0.04);border:1px solid rgba(0,230,138,0.25);border-radius:10px;text-decoration:none;color:#f0f0f5;transition:background 0.15s">' +
            '<span style="font-size:24px">💳</span>' +
            '<div style="flex:1"><div style="font-size:14px;font-weight:800">Ramp Network</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">Card · Apple Pay · Bank transfer · 🇺🇸 🇪🇺 🇬🇧</div></div>' +
            '<span style="color:#00e68a;font-size:18px">→</span>' +
          '</a>' +

          '<a href="https://pay.coinbase.com/buy/select-asset?appId=hyperflex&destinationWallets=' + encodeURIComponent(JSON.stringify([{ address: state.eoa || '', blockchains: ['polygon'], assets: ['USDC'] }])) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(77,159,255,0.04);border:1px solid rgba(77,159,255,0.25);border-radius:10px;text-decoration:none;color:#f0f0f5">' +
            '<span style="font-size:24px">🟦</span>' +
            '<div style="flex:1"><div style="font-size:14px;font-weight:800">Coinbase Pay</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">Use your Coinbase account · instant · fee-free</div></div>' +
            '<span style="color:#4d9fff;font-size:18px">→</span>' +
          '</a>' +

          '<a href="https://global.transak.com/?apiKey=e8e5c1a9-3d2a-4f15-9a25-5f4c9e2dc97f&cryptoCurrencyCode=USDC&network=polygon&walletAddress=' + encodeURIComponent(state.eoa || '') + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(168,85,247,0.04);border:1px solid rgba(168,85,247,0.25);border-radius:10px;text-decoration:none;color:#f0f0f5">' +
            '<span style="font-size:24px">🌐</span>' +
            '<div style="flex:1"><div style="font-size:14px;font-weight:800">Transak</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">130+ countries · SEPA · UPI · Local methods</div></div>' +
            '<span style="color:#a855f7;font-size:18px">→</span>' +
          '</a>' +
        '</div>' +

        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;padding:10px 12px;background:rgba(245,158,11,0.04);border:1px solid rgba(245,158,11,0.15);border-radius:6px">' +
          '<strong style="color:#f59e0b">Note:</strong> On-ramps require KYC (ID verification). Typical time: 5-15 min for first purchase, then instant. Fees: 1.5-3.5% depending on payment method.' +
        '</div>';
    } else if (currentTab === 'bridge') {
      // Sub-state: external links view vs embedded widget view
      var bridgeMode = state.bridgeMode || 'links';
      var proxyAddr = state.proxy || '';

      if (bridgeMode === 'widget') {
        // Embedded Jumper.exchange widget with all pre-fills
        // toAddress=proxy makes USDC land directly in the Polymarket wallet
        var jumperUrl = 'https://jumper.exchange/?fromChain=1&toChain=137&toToken=' + USDC_ADDRESS + '&toAddress=' + encodeURIComponent(proxyAddr);
        bodyHtml =
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
            '<button onclick="HFXDeposit._setBridgeMode(\'links\')" style="background:rgba(255,255,255,0.06);border:1px solid #1e1e2a;color:#f0f0f5;padding:6px 12px;border-radius:6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer">← Back</button>' +
            '<span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0">Embedded Jumper widget · USDC lands directly in your Polymarket wallet</span>' +
          '</div>' +

          '<div style="position:relative;width:100%;height:540px;background:#000;border:1px solid #1e1e2a;border-radius:10px;overflow:hidden">' +
            // Fallback message shown first, iframe loads on top if successful
            '<div id="hfxBridgeIframeFallback" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;color:#8888a0;font-family:\'JetBrains Mono\',monospace;font-size:11px;line-height:1.7">' +
              '<div>' +
                '<div style="font-size:28px;margin-bottom:10px">🔒</div>' +
                '<div style="font-weight:700;color:#f0f0f5;margin-bottom:6px">Loading Jumper widget…</div>' +
                '<div>If this doesn\'t appear within a few seconds, Jumper blocks iframe embedding. Use the button below instead.</div>' +
                '<a href="' + jumperUrl + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:14px;background:#00e68a;color:#0a0a0f;padding:10px 18px;border-radius:6px;font-weight:800;text-decoration:none;font-family:\'JetBrains Mono\',monospace;font-size:11px">Open Jumper in new tab →</a>' +
              '</div>' +
            '</div>' +
            '<iframe src="' + jumperUrl + '" style="position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent" onload="var f=document.getElementById(\'hfxBridgeIframeFallback\');if(f)f.style.display=\'none\'" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"></iframe>' +
          '</div>' +

          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;margin-top:10px;padding:10px 12px;background:rgba(77,159,255,0.04);border:1px solid rgba(77,159,255,0.15);border-radius:6px">' +
            '<strong style="color:#4d9fff">Destination pre-filled.</strong> USDC will land in your Polymarket wallet <span style="color:#f0f0f5">' + _esc(proxyAddr.slice(0,8)) + '…' + _esc(proxyAddr.slice(-4)) + '</span> on Polygon. Your source wallet connects inside the widget below.' +
          '</div>';
      } else {
        // Default: links view
        bodyHtml =
          '<div style="padding:16px 18px;background:rgba(77,159,255,0.04);border:1px solid rgba(77,159,255,0.25);border-radius:10px;text-align:center;margin-bottom:14px">' +
            '<div style="font-size:28px;margin-bottom:8px">🌉</div>' +
            '<div style="font-size:14px;font-weight:700;color:#4d9fff;margin-bottom:4px">Cross-chain bridging</div>' +
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;line-height:1.6">Have USDC on Ethereum, Arbitrum, Base, Optimism, or BSC? Bridge it to Polygon in one transaction.</div>' +
          '</div>' +

          // NEW: prominent "Bridge inside HYPERFLEX" button (loads iframe)
          '<button onclick="HFXDeposit._setBridgeMode(\'widget\')" style="width:100%;display:flex;align-items:center;gap:12px;padding:14px;background:linear-gradient(135deg,rgba(0,230,138,0.12),rgba(77,159,255,0.12));border:1px solid rgba(0,230,138,0.35);border-radius:10px;color:#f0f0f5;cursor:pointer;margin-bottom:12px;text-align:left;font-family:inherit">' +
            '<span style="font-size:24px">✨</span>' +
            '<div style="flex:1"><div style="font-size:14px;font-weight:800">Bridge inside HYPERFLEX <span style="background:#00e68a;color:#0a0a0f;font-size:9px;padding:2px 6px;border-radius:4px;margin-left:6px;font-weight:900">NEW</span></div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">Jumper widget embedded right here · destination pre-filled to your Polymarket wallet</div></div>' +
            '<span style="color:#00e68a;font-size:18px">→</span>' +
          '</button>' +

          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Or open in a new tab</div>' +

          '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">' +
            '<a href="https://jumper.exchange/?fromChain=1&toChain=137&toToken=' + USDC_ADDRESS + '&toAddress=' + encodeURIComponent(proxyAddr) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:10px;text-decoration:none;color:#f0f0f5">' +
              '<span style="font-size:20px">⚡</span>' +
              '<div style="flex:1"><div style="font-size:13px;font-weight:700">Jumper.exchange</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">LI.FI router · auto-picks fastest/cheapest path · 1-5 min</div></div>' +
              '<span style="color:#00e68a;font-size:16px">→</span>' +
            '</a>' +

            '<a href="https://app.across.to/bridge?from=1&to=137&inputToken=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&outputToken=' + USDC_ADDRESS + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:10px;text-decoration:none;color:#f0f0f5">' +
              '<span style="font-size:20px">🔀</span>' +
              '<div style="flex:1"><div style="font-size:13px;font-weight:700">Across Protocol</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">Optimistic bridge · ~1-3 min · lowest fees</div></div>' +
              '<span style="color:#8888a0;font-size:16px">→</span>' +
            '</a>' +

            '<a href="https://wallet.polygon.technology/polygon/bridge/deposit" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:10px;text-decoration:none;color:#f0f0f5">' +
              '<span style="font-size:20px">🏛</span>' +
              '<div style="flex:1"><div style="font-size:13px;font-weight:700">Polygon PoS Bridge (official)</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#f59e0b;margin-top:2px">⚠ 22-45 min finality · only if fast bridges fail</div></div>' +
              '<span style="color:#8888a0;font-size:16px">→</span>' +
            '</a>' +
          '</div>' +

          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;padding:10px 12px;background:rgba(0,230,138,0.04);border:1px solid rgba(0,230,138,0.15);border-radius:6px">' +
            '<strong style="color:#00e68a">Tip:</strong> The embedded Jumper widget pre-fills your Polymarket wallet as the destination — USDC lands directly without an extra forwarding step.' +
          '</div>';
      }
    }

    return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:22px;max-width:500px;width:100%;color:#f0f0f5;max-height:92vh;overflow-y:auto">' +
      // Header
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
        '<span style="font-size:20px">💰</span>' +
        '<div style="flex:1">' +
          '<div style="font-size:16px;font-weight:800">Deposit to Polymarket</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;margin-top:2px">Fund your Polymarket wallet from any source</div>' +
        '</div>' +
        '<button onclick="HFXDeposit.close()" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;padding:0 6px">✕</button>' +
      '</div>' +

      // Balance display
      '<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:180px;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:8px">' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">🦊 MetaMask</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:18px;font-weight:800;color:' + (hasEoaUsdc ? '#f0f0f5' : '#8888a0') + '">$' + eoaBal.toFixed(2) + '</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">' + (state.eoa ? state.eoa.slice(0,6) + '…' + state.eoa.slice(-4) : '') + '</div>' +
        '</div>' +
        '<div style="flex:1;min-width:180px;padding:12px 14px;background:rgba(0,230,138,0.04);border:1px solid rgba(0,230,138,0.2);border-radius:8px">' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#00e68a;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">📊 Polymarket</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:18px;font-weight:800;color:#f0f0f5">$' + proxyBal.toFixed(2) + '</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">' + (state.proxy ? state.proxy.slice(0,6) + '…' + state.proxy.slice(-4) : '') + '</div>' +
        '</div>' +
      '</div>' +

      tabsHtml +
      bodyHtml +
    '</div>';
  }

  // Helper to render an exchange instruction row
  function _exchangeRow(name, instructions, url) {
    return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:8px">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12px;font-weight:800;color:#f0f0f5;margin-bottom:2px">' + _esc(name) + '</div>' +
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.5">' + instructions + '</div>' +
      '</div>' +
      '<a href="' + url + '" target="_blank" rel="noopener" style="color:#00e68a;text-decoration:none;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;padding:6px 10px;border:1px solid rgba(0,230,138,0.3);border-radius:5px;flex-shrink:0;white-space:nowrap">Open →</a>' +
    '</div>';
  }

  // Cached state for the current modal instance
  var _state = null;

  async function open() {
    if (typeof window.ethereum === 'undefined') {
      alert('MetaMask required. Install or connect a wallet first.');
      return;
    }
    if (!window.ethers) {
      alert('ethers.js not yet loaded. Refresh the page and try again.');
      return;
    }

    var overlay = _ensureOverlay();
    overlay.innerHTML = _frame({ loading: true });

    try {
      // Get EOA (prompt MetaMask if not already connected)
      var eoa = (localStorage.getItem('poly_eoa_address') || '').toLowerCase();
      if (!eoa) {
        var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts.length) {
          eoa = accounts[0].toLowerCase();
          localStorage.setItem('poly_eoa_address', eoa);
        }
      }
      if (!eoa) throw new Error('Could not resolve your wallet address');

      // Get / compute proxy
      var proxy = (localStorage.getItem('hf_poly_wallet') || '').toLowerCase();
      if (!proxy || proxy === eoa) {
        var resolved = await _computeProxy(eoa);
        if (resolved && resolved !== window.ethers.ZeroAddress && resolved.toLowerCase() !== eoa) {
          proxy = resolved.toLowerCase();
          localStorage.setItem('hf_poly_wallet', proxy);
        }
      }
      if (!proxy) throw new Error('Could not resolve your Polymarket wallet. Complete setup first by visiting any market page.');

      // Fetch balances
      var [eoaBal, proxyBal, polBal] = await Promise.all([
        _usdcBalance(eoa),
        _usdcBalance(proxy),
        _polBalance(eoa)
      ]);

      _state = {
        eoa: eoa, proxy: proxy,
        eoaBalance: eoaBal, proxyBalance: proxyBal, polBalance: polBal
      };
      overlay.innerHTML = _frame(_state);
    } catch (e) {
      overlay.innerHTML = _frame({ error: e.message || 'Unable to load deposit info' });
    }
  }

  async function _submit() {
    var amountInput = document.getElementById('hfxDepositAmount');
    if (!amountInput) return;
    var amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) {
      amountInput.style.borderColor = '#ff4d6a';
      return;
    }
    if (!_state) return;

    var overlay = document.getElementById('hfxDepositOverlay');
    if (!overlay) return;
    overlay.innerHTML = _frame(Object.assign({}, _state, { signing: true, amount: amount }));

    try {
      // Ensure on Polygon
      var chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== '0x89') {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] });
        } catch (switchErr) {
          if (switchErr.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{ chainId: '0x89', chainName: 'Polygon', nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 }, rpcUrls: ['https://polygon-rpc.com'], blockExplorerUrls: ['https://polygonscan.com'] }]
            });
          } else throw switchErr;
        }
      }

      // Signer via HFXWallet if available, else direct
      var signer;
      if (window.HFXWallet && window.HFXWallet.getSigner) {
        var ctx = await window.HFXWallet.getSigner();
        signer = ctx.signer || ctx;
      } else {
        var provider = new window.ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
      }

      // USDC.transfer(proxy, amount * 1e6)
      var usdc = new window.ethers.Contract(USDC_ADDRESS, ['function transfer(address to, uint256 amount) returns (bool)'], signer);
      var amountWei = window.ethers.parseUnits(amount.toFixed(6), 6);
      var tx = await usdc.transfer(_state.proxy, amountWei);

      overlay.innerHTML = _frame(Object.assign({}, _state, { confirming: true, amount: amount, txHash: tx.hash }));

      await tx.wait();

      var newProxyBal = await _usdcBalance(_state.proxy);
      overlay.innerHTML = _frame({
        success: true,
        amount: amount,
        newProxyBalance: newProxyBal != null ? newProxyBal : (_state.proxyBalance || 0) + amount,
        txHash: tx.hash
      });

      // Refresh any external balance displays
      try {
        if (typeof window.fetchTradeBalance === 'function') window.fetchTradeBalance();
      } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('hfx_deposit_success', { detail: { amount: amount, txHash: tx.hash } })); } catch (e) {}
    } catch (err) {
      var msg = (err && err.message) || 'Unknown error';
      if (err && (err.code === 'ACTION_REJECTED' || err.code === 4001)) {
        msg = 'You rejected the transaction in MetaMask.';
      } else if (err && err.message && /insufficient funds/i.test(err.message)) {
        msg = 'Not enough POL in your wallet for gas. You need a tiny amount (~$0.01 in POL).';
      }
      overlay.innerHTML = _frame({ error: msg });
    }
  }

  // Switch tabs without re-fetching balances
  function _setTab(tab) {
    if (!_state) return;
    _state.currentTab = tab;
    // Reset bridge sub-mode when switching tabs
    if (tab !== 'bridge') _state.bridgeMode = null;
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);
  }

  // Switch bridge sub-mode: 'links' (default) vs 'widget' (embedded iframe)
  function _setBridgeMode(mode) {
    if (!_state) return;
    _state.bridgeMode = mode;
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);
  }

  // Copy the proxy address to clipboard with visual feedback
  function _copyAddr() {
    if (!_state || !_state.proxy) return;
    var addr = _state.proxy;
    var btn = document.getElementById('hfxDepositCopyBtn');
    var done = function() {
      if (btn) {
        var original = btn.innerHTML;
        btn.innerHTML = '✓ Copied!';
        btn.style.background = 'rgba(0,230,138,0.25)';
        setTimeout(function() { btn.innerHTML = original; btn.style.background = 'rgba(0,230,138,0.1)'; }, 1500);
      }
    };
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(addr).then(done).catch(function() {
        // Fallback to execCommand
        try {
          var tmp = document.createElement('textarea');
          tmp.value = addr;
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand('copy');
          document.body.removeChild(tmp);
          done();
        } catch (e) {
          alert('Copy failed. Address: ' + addr);
        }
      });
    } else {
      try {
        var tmp2 = document.createElement('textarea');
        tmp2.value = addr;
        document.body.appendChild(tmp2);
        tmp2.select();
        document.execCommand('copy');
        document.body.removeChild(tmp2);
        done();
      } catch (e) {
        alert('Copy failed. Address: ' + addr);
      }
    }
  }

  // Public API
  window.HFXDeposit = {
    open: open,
    close: close,
    _submit: _submit,
    _setTab: _setTab,
    _setBridgeMode: _setBridgeMode,
    _copyAddr: _copyAddr
  };
})();
