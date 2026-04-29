/**
 * HYPERFLEX Trade Proxy — Cloudflare Worker
 *
 * Proxies signed Polymarket CLOB orders from the user's browser.
 * Runs at the edge (300+ cities) so the request originates from a
 * non-geo-restricted IP near the user. The order is already signed
 * client-side — this worker just forwards it.
 *
 * Deploy: cd cloudflare-trade-proxy && npx wrangler deploy
 * (auto-deploys via .github/workflows/deploy-cf-worker.yml on push to main)
 */

// Post-Apr-28 cutover (~11:00 UTC 2026-04-28), `clob.polymarket.com` IS the
// V2 backend. The dedicated `clob-v2.polymarket.com` host now redirects to
// the canonical URL, which (a) breaks browser preflight (302 on OPTIONS is
// not allowed for CORS preflights — that's the symptom that brought us
// here), and (b) when the Worker followed the redirect with default
// fetch settings, some Polymarket pops fired without the auth headers
// the redirect dropped.
//
// New strategy: target `clob.polymarket.com` directly (canonical, V2-aware
// post-cutover). Keep `clob-v2.polymarket.com` only as a fallback if the
// canonical host returns a network-style failure. The V1/V2 host split
// in the old `pickClobHost` logic is no longer meaningful — both hosts
// run V2, the dedicated host is a holdover that's actively breaking.
const CLOB_PRIMARY  = 'https://clob.polymarket.com';
const CLOB_FALLBACK = 'https://clob-v2.polymarket.com';

// Headers we forward from the client to Polymarket CLOB
const POLY_HEADERS = [
  'POLY_ADDRESS',
  'POLY_API_KEY',
  'POLY_PASSPHRASE',
  'POLY_TIMESTAMP',
  'POLY_SIGNATURE',
];

// Builder attribution headers — must match what /api/polymarket/builder-sign
// returns and what market.html sends. Mismatched names cause CORS preflight
// to reject the POST (browser throws "Failed to fetch") before it ever leaves.
const BUILDER_HEADERS = [
  'POLY_BUILDER_API_KEY',
  'POLY_BUILDER_PASSPHRASE',
  'POLY_BUILDER_TIMESTAMP',
  'POLY_BUILDER_SIGNATURE',
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': [
      'Content-Type',
      'Accept',
      ...POLY_HEADERS,
      ...BUILDER_HEADERS,
    ].join(', '),
    'Access-Control-Max-Age': '86400',
  };
}

// Forward a single attempt to a CLOB host. Returns the response object
// regardless of status — caller decides whether to fall through. We set
// redirect:'follow' explicitly: Polymarket's redirects across the cutover
// strip auth headers we'd need to re-add, and silent header loss reads as
// "invalid signature" downstream. Worker's `fetch` follows by default
// AND replays headers (unlike the browser preflight), but pinning it makes
// the contract explicit.
//
// User-Agent matters: the default `Cloudflare-Workers/...` UA hits a
// per-host rate limit on data-api.polymarket.com that the canonical UA
// doesn't. Sending our own UA also makes the upstream logs identify our
// traffic when we ping the partnerships team about routing.
async function forwardToClob(host, body, headers) {
  return fetch(`${host}/order`, {
    method: 'POST',
    headers: { ...headers, 'User-Agent': 'Hyperflex/1.0' },
    body,
    redirect: 'follow',
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || 'https://hyperflex.network';

    // Allow localhost for dev + production domain
    const isAllowed = origin === allowed
      || origin.startsWith('http://localhost')
      || origin.startsWith('http://127.0.0.1');

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(isAllowed ? origin : allowed),
      });
    }

    // Only POST /order
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(isAllowed ? origin : allowed) },
      });
    }

    // Origin check
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(allowed) },
      });
    }

    // Build headers for Polymarket CLOB
    const clobHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    for (const h of POLY_HEADERS) {
      const val = request.headers.get(h);
      if (val) clobHeaders[h] = val;
    }
    for (const h of BUILDER_HEADERS) {
      const val = request.headers.get(h);
      if (val) clobHeaders[h] = val;
    }

    // Forward the signed order body.
    const body = await request.text();

    // Two-host attempt chain. If the canonical post-cutover host throws or
    // returns 5xx we try the legacy V2-only host as a last resort. Don't
    // chain on 4xx — those are real CLOB errors (signature, balance,
    // allowance) that we want to surface to the user verbatim.
    let lastErr = null;
    for (const host of [CLOB_PRIMARY, CLOB_FALLBACK]) {
      try {
        const clobRes = await forwardToClob(host, body, clobHeaders);
        const clobText = await clobRes.text();

        // 5xx → fall through to fallback host. 4xx → return as-is so the
        // client sees the real error (CLOB 401, 400 invalid signature, etc).
        if (clobRes.status >= 500 && host === CLOB_PRIMARY) {
          lastErr = `upstream ${clobRes.status} from ${host}`;
          continue;
        }

        return new Response(clobText, {
          status: clobRes.status,
          headers: {
            'Content-Type': 'application/json',
            'X-Clob-Host': host,  // expose which host actually answered (debug only)
            ...corsHeaders(origin),
          },
        });
      } catch (err) {
        lastErr = `${host} threw: ${err && err.message ? err.message : 'unknown'}`;
        // Network error on primary → try fallback. Network error on
        // fallback → fall through to the 502 response below.
      }
    }

    return new Response(JSON.stringify({
      error: 'Proxy error: both CLOB hosts unreachable',
      detail: lastErr,
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
