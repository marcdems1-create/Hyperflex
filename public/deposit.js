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

    // READY
    var eoaBal = state.eoaBalance != null ? state.eoaBalance : 0;
    var proxyBal = state.proxyBalance != null ? state.proxyBalance : 0;
    var hasEoaUsdc = eoaBal >= 0.01;
    var hasGas = state.polBalance == null || state.polBalance >= 0.001;

    var bodyHtml;
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

        (!hasGas ? '<div style="padding:10px 12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:6px;margin-bottom:14px;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#f59e0b;line-height:1.5">⚠ Your MetaMask has no MATIC/POL for gas. You need ~$0.01 in POL to submit the transfer. <a href="https://wallet.polygon.technology/" target="_blank" rel="noopener" style="color:#00e68a">Get POL →</a></div>' : '') +

        '<button onclick="HFXDeposit._submit()" id="hfxDepositSubmitBtn" style="width:100%;background:#00e68a;color:#0a0a0f;border:none;padding:14px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:800;cursor:pointer;min-height:48px">Sign & Deposit →</button>' +

        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;margin-top:14px;text-align:center">Standard USDC ERC-20 transfer · Gas: ~$0.01 in POL</div>';
    } else {
      // No USDC on Polygon — show onramps
      bodyHtml =
        '<div style="padding:14px 16px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.25);border-radius:10px;margin-bottom:14px">' +
          '<div style="font-size:13px;font-weight:700;color:#f59e0b;margin-bottom:6px">You need USDC on Polygon first</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;line-height:1.7">Your MetaMask wallet has no USDC on the Polygon network. You have a few options:</div>' +
        '</div>' +

        '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">' +
          '<a href="https://buy.ramp.network/?userAddress=' + _esc(state.eoa || '') + '&swapAsset=MATIC_USDC&defaultAsset=MATIC_USDC" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:8px;text-decoration:none;color:#f0f0f5">' +
            '<span style="font-size:20px">💳</span>' +
            '<div style="flex:1"><div style="font-size:13px;font-weight:700">Buy with card / bank (Ramp)</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0">Fastest path · sends USDC directly to your MetaMask</div></div>' +
            '<span style="color:#00e68a">→</span>' +
          '</a>' +
          '<a href="https://app.uniswap.org/#/swap?outputCurrency=' + USDC_ADDRESS + '&chain=polygon" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:8px;text-decoration:none;color:#f0f0f5">' +
            '<span style="font-size:20px">🔄</span>' +
            '<div style="flex:1"><div style="font-size:13px;font-weight:700">Swap POL → USDC (Uniswap)</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0">If you already have POL on Polygon</div></div>' +
            '<span style="color:#00e68a">→</span>' +
          '</a>' +
          '<a href="https://www.coinbase.com/price/usd-coin" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:8px;text-decoration:none;color:#f0f0f5">' +
            '<span style="font-size:20px">🏦</span>' +
            '<div style="flex:1"><div style="font-size:13px;font-weight:700">Withdraw from Coinbase</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0">Send USDC on Polygon network (not Ethereum!)</div></div>' +
            '<span style="color:#00e68a">→</span>' +
          '</a>' +
        '</div>' +

        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;padding:10px 12px;background:rgba(77,159,255,0.04);border:1px solid rgba(77,159,255,0.15);border-radius:6px">' +
          '<strong style="color:#4d9fff">Important:</strong> Make sure you get USDC on the <strong style="color:#f0f0f5">Polygon</strong> network (not Ethereum mainnet). Polygon is much cheaper. After you have USDC, come back here to deposit.' +
        '</div>' +

        '<button onclick="HFXDeposit.close()" style="width:100%;background:rgba(255,255,255,0.06);color:#8888a0;border:1px solid #1e1e2a;padding:12px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;cursor:pointer;margin-top:14px">Close</button>';
    }

    return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:22px;max-width:460px;width:100%;color:#f0f0f5;max-height:92vh;overflow-y:auto">' +
      // Header
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
        '<span style="font-size:20px">💰</span>' +
        '<div style="flex:1">' +
          '<div style="font-size:16px;font-weight:800">Deposit to Polymarket</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;margin-top:2px">Transfer USDC from your MetaMask wallet to your Polymarket wallet</div>' +
        '</div>' +
        '<button onclick="HFXDeposit.close()" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;padding:0 6px">✕</button>' +
      '</div>' +

      // Balance display
      '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:180px;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:8px">' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">🦊 MetaMask (source)</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:18px;font-weight:800;color:' + (hasEoaUsdc ? '#f0f0f5' : '#ff4d6a') + '">$' + eoaBal.toFixed(2) + '</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">' + (state.eoa ? state.eoa.slice(0,6) + '…' + state.eoa.slice(-4) : '') + '</div>' +
        '</div>' +
        '<div style="flex:1;min-width:180px;padding:12px 14px;background:rgba(0,230,138,0.04);border:1px solid rgba(0,230,138,0.2);border-radius:8px">' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#00e68a;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">📊 Polymarket (destination)</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:18px;font-weight:800;color:#f0f0f5">$' + proxyBal.toFixed(2) + '</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">' + (state.proxy ? state.proxy.slice(0,6) + '…' + state.proxy.slice(-4) : '') + '</div>' +
        '</div>' +
      '</div>' +

      bodyHtml +
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

  // Public API
  window.HFXDeposit = {
    open: open,
    close: close,
    _submit: _submit
  };
})();
