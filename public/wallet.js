/**
 * HFXWallet — shared ethers v6 wallet helpers
 *
 * Single cached BrowserProvider + signer per page lifetime. Both market.html
 * and creator-dashboard.html use this so we never construct two BrowserProviders
 * in the same flow — each construction fires `eth_requestAccounts` via ethers'
 * internal _start(), and on mobile MetaMask overlapping requests return
 * EIP-1193 -32002 "request already pending".
 *
 * Concurrent dedup: a single in-flight Promise is shared across all callers
 * during the cold-path construction, so if auto-reconnect and a manual Connect
 * tap fire within the same tick they both await the same construction.
 *
 * Cache invariants:
 *   - Cleared on `accountsChanged`, on `chainChanged`, on -32002, and on
 *     explicit invalidate().
 *   - `getSigner()` is the only function that constructs a BrowserProvider.
 *   - `adoptSigner(p, s, a)` lets a flow that ALREADY has a provider/signer
 *     (e.g. enableTrading after wallet_switchEthereumChain) populate the
 *     cache without going through getSigner() again.
 *   - `getSignerFresh()` forces MetaMask's account picker via
 *     wallet_requestPermissions — use this when the user wants to switch
 *     accounts. Mobile MetaMask ignores eth_requestAccounts after
 *     disconnect/reconnect, so wallet_requestPermissions is the only way
 *     to force a fresh prompt.
 *   - `revokePermissions()` tells MetaMask to fully drop its connection
 *     to our site (EIP-2255 wallet_revokePermissions) so the next connect
 *     goes through the full permission flow.
 */
(function(global) {
  var _cachedSigner = null;
  var _cachedAddress = null;
  var _signerPromise = null;

  async function getSigner() {
    if (_cachedSigner && _cachedAddress) {
      return { provider: _cachedSigner.provider, signer: _cachedSigner, address: _cachedAddress };
    }
    if (!_signerPromise) {
      _signerPromise = (async function() {
        if (!global.ethereum) throw new Error('MetaMask required');
        if (!global.ethers) throw new Error('ethers.js not loaded');
        var provider = new global.ethers.BrowserProvider(global.ethereum);
        var signer = await provider.getSigner();
        var address = await signer.getAddress();
        _cachedSigner = signer;
        _cachedAddress = address;
        return { provider: provider, signer: signer, address: address };
      })();
    }
    try {
      return await _signerPromise;
    } finally {
      _signerPromise = null;
    }
  }

  // Force MetaMask to show the account picker, even on mobile where
  // eth_requestAccounts silently returns the last-connected account.
  //
  // Uses EIP-2255 wallet_requestPermissions which MetaMask always
  // responds to with a permission prompt (account selection UI).
  async function getSignerFresh() {
    if (!global.ethereum) throw new Error('MetaMask required');
    if (!global.ethers) throw new Error('ethers.js not loaded');

    // Drop any cached state first — we want a completely fresh pick
    invalidate();

    try {
      // EIP-2255: always prompts for account selection on both mobile
      // and desktop MetaMask. Returns the list of permitted accounts.
      await global.ethereum.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }]
      });
    } catch (permErr) {
      // Some wallets (older MetaMask, some mobile wallets) don't support
      // wallet_requestPermissions. Fall back to eth_requestAccounts and
      // hope the user switched their active account in MetaMask first.
      if (permErr && permErr.code === 4001) {
        throw permErr; // user rejected — bubble up so caller knows
      }
      console.warn('[HFXWallet] wallet_requestPermissions unsupported, falling back:', permErr && permErr.message);
      try {
        await global.ethereum.request({ method: 'eth_requestAccounts' });
      } catch (reqErr) {
        throw reqErr;
      }
    }

    // Now build the provider/signer on the freshly-picked account
    var provider = new global.ethers.BrowserProvider(global.ethereum);
    var signer = await provider.getSigner();
    var address = await signer.getAddress();
    _cachedSigner = signer;
    _cachedAddress = address;
    return { provider: provider, signer: signer, address: address };
  }

  // Tell MetaMask to fully drop its connection to our site (EIP-2255).
  // After this, the next getSigner() / getSignerFresh() call will trigger
  // a full permission flow. Silently no-ops on wallets that don't support
  // wallet_revokePermissions (older MetaMask, Coinbase Wallet, etc.).
  async function revokePermissions() {
    invalidate();
    if (!global.ethereum) return;
    try {
      await global.ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }]
      });
    } catch (e) {
      // Older MetaMask versions return "method not supported". Silent fallback.
      if (e && e.code !== 4200 && e.code !== -32601) {
        console.warn('[HFXWallet] revokePermissions:', e && e.message);
      }
    }
  }

  function adoptSigner(provider, signer, address) {
    _cachedSigner = signer;
    _cachedAddress = address;
    _signerPromise = null;
  }

  function invalidate() {
    _cachedSigner = null;
    _cachedAddress = null;
    _signerPromise = null;
  }

  // EIP-1193 -32002 "Request already pending" — ethers v6 wraps raw errors
  // inconsistently via `info.error` / `error`, so check every level.
  function is32002Error(err) {
    if (!err) return false;
    if (err.code === -32002) return true;
    if (err.error && err.error.code === -32002) return true;
    if (err.info && err.info.error && err.info.error.code === -32002) return true;
    if (err.message && String(err.message).indexOf('-32002') !== -1) return true;
    return false;
  }

  // ── Wallet state sync — catches silent account switches ──
  //
  // MetaMask's accountsChanged event is unreliable: it fires on some version
  // combinations and not others, especially when the user has granted
  // permission to multiple accounts. The fix is to poll the current account
  // whenever the user returns to the HYPERFLEX tab (visibilitychange/focus)
  // and compare it to our cached EOA. If they differ, we fire a custom
  // `hfx_wallet_switched` event that any page can listen for to trigger
  // its own reset logic.

  // Listeners registered via onWalletSwitched(fn). Fires with { oldEoa, newEoa }
  var _switchListeners = new Set();

  function onWalletSwitched(fn) {
    if (typeof fn === 'function') _switchListeners.add(fn);
  }
  function offWalletSwitched(fn) { _switchListeners.delete(fn); }

  function _fireSwitched(oldEoa, newEoa) {
    // Invalidate cached signer first — whatever listeners do, they need a fresh one
    invalidate();
    for (var fn of _switchListeners) {
      try { fn({ oldEoa: oldEoa, newEoa: newEoa }); } catch (e) { console.warn('[HFXWallet] listener error:', e && e.message); }
    }
    // Also dispatch a regular DOM event so non-module code can listen
    try { global.dispatchEvent(new CustomEvent('hfx_wallet_switched', { detail: { oldEoa: oldEoa, newEoa: newEoa } })); } catch (e) {}
  }

  // Returns { changed: bool, oldEoa, newEoa }. Swallows errors.
  async function syncCurrentAccount() {
    if (!global.ethereum) return { changed: false };
    var accounts;
    try {
      accounts = await global.ethereum.request({ method: 'eth_accounts' });
    } catch (e) { return { changed: false }; }
    var currentEoa = (accounts && accounts[0]) ? accounts[0].toLowerCase() : null;
    var cachedEoa = (localStorage.getItem('poly_eoa_address') || '').toLowerCase();

    if (!currentEoa) {
      // User disconnected from MetaMask entirely
      if (cachedEoa) { _fireSwitched(cachedEoa, null); return { changed: true, oldEoa: cachedEoa, newEoa: null }; }
      return { changed: false };
    }
    if (!cachedEoa) {
      // First connection this session — don't fire switch, let normal connect flow handle
      return { changed: false, newEoa: currentEoa };
    }
    if (cachedEoa !== currentEoa) {
      _fireSwitched(cachedEoa, currentEoa);
      return { changed: true, oldEoa: cachedEoa, newEoa: currentEoa };
    }
    return { changed: false };
  }

  // Wire up the events that should drop the cache + trigger a resync.
  if (global.ethereum && typeof global.ethereum.on === 'function') {
    global.ethereum.on('accountsChanged', function(accounts) {
      invalidate();
      // Also re-run the sync logic to fire our custom switch event
      syncCurrentAccount();
    });
    global.ethereum.on('chainChanged', function() { invalidate(); });
  }

  // Poll on visibility change — catches the case where user switches their
  // active account in MetaMask while HYPERFLEX is in a background tab, then
  // returns to HYPERFLEX. Also triggers on window focus as a backup.
  //
  // CRITICAL: do NOT poll while a trade is in flight. On mobile, the user
  // backgrounds HYPERFLEX to approve the tx in the MetaMask app, then returns.
  // The focus event would fire eth_accounts → fire a spurious switch event →
  // clear API keys mid-trade. Pages can set window._tradeInFlight = true to
  // suppress the polling during critical operations.
  var _lastSyncTs = 0;
  function _maybeSyncOnFocus() {
    // Throttle to once per 500ms to avoid firing on minor focus blips
    if (Date.now() - _lastSyncTs < 500) return;
    // Skip polling during active trades — the page handler manages state
    if (global._tradeInFlight) return;
    _lastSyncTs = Date.now();
    syncCurrentAccount();
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') _maybeSyncOnFocus();
    });
  }
  global.addEventListener('focus', _maybeSyncOnFocus);

  global.HFXWallet = {
    getSigner: getSigner,
    getSignerFresh: getSignerFresh,
    revokePermissions: revokePermissions,
    adoptSigner: adoptSigner,
    invalidate: invalidate,
    is32002Error: is32002Error,
    syncCurrentAccount: syncCurrentAccount,
    onWalletSwitched: onWalletSwitched,
    offWalletSwitched: offWalletSwitched,
  };
})(window);
