/**
 * HYPERFLEX Trade Proxy — Cloudflare Worker
 *
 * Proxies signed Polymarket CLOB orders from the user's browser.
 * Runs at the edge (300+ cities) so the request originates from a
 * non-geo-restricted IP near the user. The order is already signed
 * client-side — this worker just forwards it.
 *
 * Deploy: cd cloudflare-trade-proxy && npx wrangler deploy
 */

const CLOB_BASE_V1 = 'https://clob.polymarket.com';
const CLOB_BASE_V2 = 'https://clob-v2.polymarket.com';

// Pre-Apr-28-cutover, V2-signed orders MUST hit the dedicated V2 host.
// clob.polymarket.com still routes through V1's parser until Polymarket
// flips the backend; sending a V2 order there returns "invalid signature"
// because V1 reconstructs the EIP-712 hash over V1 fields. Mirror of the
// Railway-proxy fix in server.js:40087 (commit f7c30d3). Detect V2 by
// presence of order.builder in the body.
function pickClobHost(body) {
  try {
    const parsed = JSON.parse(body);
    const isV2 = !!(parsed && parsed.order && typeof parsed.order.builder === 'string' && parsed.order.builder.startsWith('0x'));
    return isV2 ? CLOB_BASE_V2 : CLOB_BASE_V1;
  } catch (e) {
    return CLOB_BASE_V1;
  }
}

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

    // Forward the signed order body to CLOB
    const body = await request.text();
    const clobBase = pickClobHost(body);

    try {
      const clobRes = await fetch(`${clobBase}/order`, {
        method: 'POST',
        headers: clobHeaders,
        body: body,
      });

      const clobText = await clobRes.text();

      return new Response(clobText, {
        status: clobRes.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin),
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Proxy error: ' + err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
  },
};
