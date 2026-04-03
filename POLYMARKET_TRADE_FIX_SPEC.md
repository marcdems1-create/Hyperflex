# Polymarket Trade Execution — Fix Spec

**Status:** "Invalid order payload" error when placing trades
**File:** `public/market.html` — `executeTrade()` function (line ~1688)
**Root causes:** 4 bugs identified by auditing against official Polymarket SDK

---

## Bug #1: feeRateBps hardcoded to '0' (MOST LIKELY CAUSE)

**Current code (line 1894):**
```js
feeRateBps: '0'
```

**Problem:** The official Polymarket TypeScript SDK explicitly fetches the fee rate per-market before building the order:
```typescript
const feeRateBps = await this._resolveFeeRateBps(tokenID, userFeeRateBps);
// Calls GET https://clob.polymarket.com/fee-rate?token_id=X
// Returns { base_fee: "156" } (or similar)
```

If the CLOB expects a non-zero feeRateBps and you sign with '0', the order is invalid because:
- The signed EIP-712 hash includes feeRateBps
- Polymarket verifies the signature against the fee rate they expect
- Mismatch = "Invalid order payload"

**Fix:** Fetch the fee rate alongside tick size and neg_risk (line ~1768). Add to the parallel fetch:
```js
fetch('https://clob.polymarket.com/fee-rate?token_id=' + encodeURIComponent(tokenId))
  .then(function(r) { return r.ok ? r.json() : null; })
  .catch(function() { return null; })
```
Parse the response: `if (feeRes && feeRes.base_fee !== undefined) feeRateBps = String(feeRes.base_fee);`

Then use `feeRateBps` (the fetched value) in the orderStruct instead of '0'.

---

## Bug #2: Client-side proxy address fallback uses WRONG salt

**Current code (line 1810):**
```js
var proxySalt = ethers.zeroPadValue(eoaAddress, 32);
proxyAddress = ethers.getCreate2Address(factoryAddress, proxySalt, initCodeHash);
```

**Server code (line 24152-24154) does it CORRECTLY:**
```js
const abiEncoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [addrLower]);
const safeSalt = ethers.keccak256(abiEncoded);
const safeAddr = ethers.getCreate2Address(safeFactory, safeSalt, safeInitCodeHash);
```

**Problem:** `zeroPadValue(address, 32)` ≠ `keccak256(abiEncode(address))`. These produce completely different salts, meaning the client computes a WRONG proxy address when the server doesn't return one. The wrong address becomes the `maker` field in the signed order. Polymarket rejects it because the maker doesn't match any known proxy for this signer.

**Fix:** Match the server's derivation. Replace lines 1808-1811:
```js
if (!proxyAddress) {
  var factoryAddress = '0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b';
  var initCodeHash = '0x2bce2127ff07fb632d16c8347c4ebf501f4841168bed00d9e6ef715ddb6fcecf';
  var abiEncoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [eoaAddress.toLowerCase()]);
  var proxySalt = ethers.keccak256(abiEncoded);
  proxyAddress = ethers.getCreate2Address(factoryAddress, proxySalt, initCodeHash).toLowerCase();
  localStorage.setItem('hf_poly_wallet', proxyAddress);
}
```

**Also:** The server already tries to look up the real proxy address from the CLOB. Most of the time, `enableTrading()` should return the correct proxy. The CREATE2 fallback only fires when all server lookups fail. But when it does fire, it must match the server's logic.

---

## Bug #3: signatureType always 2 (POLY_GNOSIS_SAFE) — may not match user's wallet

**Current code (line 1896):**
```js
signatureType: 2  // POLY_GNOSIS_SAFE
```

**Problem:** Polymarket has two proxy types:
- Safe proxy (factory 0xaacFeEa...) → signatureType 2
- ProxyWallet (factory 0xaB45c5A4...) → signatureType 1

The server-side code (lines 24150-24160) tries BOTH factories to find the user's proxy. But the client always signs with type 2. If the user has a ProxyWallet (not Safe), the CLOB rejects the order because signature verification uses the wrong method.

**Fix:** `enableTrading()` should detect which proxy type the user has and store it. The simplest approach: have the server's `/api/polymarket/derive-api-key` response include a `signatureType` field based on which factory address matched. Then store it alongside the proxy address:
```js
localStorage.setItem('poly_signature_type', data.signatureType || '2');
```

In `executeTrade()`, read it:
```js
var sigType = parseInt(localStorage.getItem('poly_signature_type') || '2');
```

---

## Bug #4: owner field — LEAVE IT AS apiKey (Code's fix was wrong)

**Current code (line 1950):**
```js
owner: apiKey
```

**This is CORRECT.** The official Polymarket TypeScript SDK sets owner to the API key:
```typescript
orderToJson(order, this.creds?.key || "", orderType, ...)
```

The API reference example shows: `"owner": "f4f247b7-4ac7-ff29-a152-04fda0a8755a"` — a UUID (API key format), NOT an Ethereum address.

**Code's commit `c1052cd` that changed this was wrong AND was applied to the wrong file (creator-dashboard.html instead of market.html). Revert if applied.**

---

## Priority Order for Fixing

1. **feeRateBps** (Bug #1) — most likely primary cause of "Invalid order payload"
2. **Proxy address salt** (Bug #2) — causes wrong maker address if server lookup fails
3. **signatureType** (Bug #3) — only affects ProxyWallet users, not Safe users
4. **owner field** (Bug #4) — already correct, don't change

---

## What the complete parallel fetch block should look like (line ~1768):

```js
var [tickRes, negRes, feeRes] = await Promise.all([
  fetch('https://clob.polymarket.com/tick-size?token_id=' + encodeURIComponent(tokenId))
    .then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
  fetch('https://clob.polymarket.com/neg-risk?token_id=' + encodeURIComponent(tokenId))
    .then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
  fetch('https://clob.polymarket.com/fee-rate?token_id=' + encodeURIComponent(tokenId))
    .then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
]);
if (tickRes && tickRes.minimum_tick_size) tickSize = parseFloat(tickRes.minimum_tick_size);
if (negRes && negRes.neg_risk !== undefined) isNegRisk = !!negRes.neg_risk;
var feeRateBps = '0';
if (feeRes && feeRes.base_fee !== undefined) feeRateBps = String(feeRes.base_fee);
```

Then in orderStruct (line 1894):
```js
feeRateBps: feeRateBps,  // fetched from CLOB, not hardcoded
```

---

## References

- [Polymarket POST /order API reference](https://docs.polymarket.com/api-reference/trade/post-a-new-order)
- [Polymarket Order Creation docs](https://docs.polymarket.com/developers/CLOB/orders/create-order)
- [Official TypeScript SDK (clob-client)](https://github.com/Polymarket/clob-client)
- [Official Python SDK (py-clob-client)](https://github.com/Polymarket/py-clob-client)
- [Proxy signature issue #277](https://github.com/Polymarket/py-clob-client/issues/277)
