require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns').promises;
const nodemailer = require('nodemailer');

// sharp is optional — loaded lazily so server starts even before npm install runs on Railway
let _sharp = null;
function getSharp() {
  if (_sharp) return _sharp;
  try { _sharp = require('sharp'); } catch { _sharp = null; }
  return _sharp;
}

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || 'hyperflex-dev-secret-change-in-prod';

app.use(cors());

// ── Stripe webhook needs raw body — must be registered BEFORE express.json() ──
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(400).send('Stripe not configured');
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature error:', err.message);
    return res.status(400).send('Webhook error: ' + err.message);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const slug = session.metadata?.slug;
      if (slug && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = subscription.items.data[0]?.price?.id;
        const plan = priceId === process.env.STRIPE_PLATINUM_PRICE_ID ? 'platinum' : 'pro';
        await supabase.from('creator_settings').update({ plan }).eq('slug', slug);
        console.log(`[stripe] upgraded ${slug} to ${plan}`);
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      if (sub.status === 'active') {
        const customer = await stripe.customers.retrieve(sub.customer);
        if (customer.email) {
          const { data: user } = await supabase.from('users').select('id').eq('email', customer.email).maybeSingle();
          if (user) {
            const priceIdToPlan = id =>
              id === process.env.STRIPE_PLATINUM_PRICE_ID ? 'platinum'
              : id === process.env.STRIPE_PRO_PRICE_ID    ? 'pro'
              : null;

            // Pending end-of-period plan change (e.g. Premium → Pro downgrade)
            const pendingPriceId = sub.pending_updates?.subscription_items?.[0]?.price;
            if (pendingPriceId) {
              const pendingPlan = priceIdToPlan(pendingPriceId) || 'free';
              const changeDate  = new Date(sub.current_period_end * 1000).toISOString();
              await supabase.from('creator_settings').update({
                plan_scheduled_change: pendingPlan,
                plan_change_date: changeDate
              }).eq('creator_id', user.id);
              console.log(`[stripe] scheduled plan change → ${pendingPlan} for ${customer.email} on ${changeDate}`);

            } else if (sub.cancel_at_period_end) {
              // Scheduled cancellation → will drop to free at period end
              const changeDate = new Date(sub.current_period_end * 1000).toISOString();
              await supabase.from('creator_settings').update({
                plan_scheduled_change: 'free',
                plan_change_date: changeDate
              }).eq('creator_id', user.id);
              console.log(`[stripe] cancellation scheduled for ${customer.email} on ${changeDate}`);

            } else {
              // Immediate change (upgrade, or scheduled change now resolved) — sync and clear
              const currentPriceId = sub.items.data[0]?.price?.id;
              const plan = priceIdToPlan(currentPriceId);
              if (plan) {
                const planUpdate = {
                  plan,
                  plan_scheduled_change: null,
                  plan_change_date: null
                };
                // If downgrading away from Premium, unverify custom domain
                if (plan !== 'platinum') planUpdate.custom_domain_verified = false;
                await supabase.from('creator_settings').update(planUpdate).eq('creator_id', user.id);
                console.log(`[stripe] plan updated → ${plan} for ${customer.email}`);
              }
            }
          }
        }
      }
    }

    if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.paused') {
      const sub = event.data.object;
      const customer = await stripe.customers.retrieve(sub.customer);
      if (customer.email) {
        const { data: user } = await supabase.from('users').select('id').eq('email', customer.email).maybeSingle();
        if (user) {
          await supabase.from('creator_settings').update({
            plan: 'free',
            plan_scheduled_change: null,
            plan_change_date: null,
            // Unverify custom domain — feature requires Premium
            custom_domain_verified: false
          }).eq('creator_id', user.id);
          console.log(`[stripe] downgraded creator ${customer.email} to free`);
        }
      }
    }
  } catch (err) {
    console.error('[stripe] webhook handler error:', err.message);
  }

  res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));
app.use(require("express").static("public"));

// Tenant: subdomain from host (e.g. acme.hyperflex.io → req.tenant.subdomain = 'acme')
app.use((req, res, next) => {
  const host = req.headers.host || '';
  const parts = host.split('.');
  let subdomain = null;
  if (parts.length >= 3) {
    subdomain = parts[0].toLowerCase();
    if (subdomain === 'www' || subdomain === 'hyperflex') subdomain = null;
  }
  req.tenant = { subdomain };
  next();
});

// ── Custom Domain Routing ──────────────────────────────────────
// If the request host matches a verified custom domain, serve the
// community page for that creator's slug (same HTML, different URL).
app.use(async (req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  // Skip hyperflex.network itself and API/asset paths
  if (!host || host.includes('hyperflex') || host.includes('localhost') || req.path.startsWith('/api') || req.path.startsWith('/stripe')) {
    return next();
  }
  // Only intercept root / and /<anything> that looks like a community slug
  // (avoid interfering with static assets)
  if (req.path !== '/' && !/^\/[a-z0-9_-]+\/?$/.test(req.path)) {
    return next();
  }
  try {
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('custom_domain', host)
      .eq('custom_domain_verified', true)
      .maybeSingle();
    if (creator?.slug) {
      // Serve community.html — the page JS reads the slug from the URL or from a
      // meta tag we inject. We pass slug as query param so community.html can read it.
      return res.sendFile(path.join(__dirname, 'public', 'community.html'));
    }
  } catch (err) {
    console.error('[custom-domain middleware]', err.message);
  }
  next();
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ── RESONANCE SCORING ─────────────────────────────
// Scores a market question 1-10 for predicted community engagement.
// Uses Haiku for speed + cost. Non-blocking — failures are silent.
async function scoreMarketResonance(question, category) {
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{
        role: 'user',
        content: `Rate this prediction market question for community engagement potential. Consider: clarity, emotional investment, time-sensitivity, binary nature, specificity.\n\nQuestion: "${question}"\nCategory: ${category || 'general'}\n\nRespond with ONLY valid JSON: {"score": <1-10 integer>}`
      }]
    });
    const text = resp.content[0]?.text?.trim() || '';
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const score = parseInt(parsed.score);
    return (score >= 1 && score <= 10) ? score : null;
  } catch {
    return null;
  }
}

// ── AUTH ──────────────────────────────────────────

// Register
app.post('/register', async (req, res) => {
  const { email, password, display_name } = req.body;
  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert([{ email, password_hash, display_name }])
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Account created', user: data });
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  if (error || !user) return res.status(400).json({ error: 'User not found' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Invalid password' });
  const token = jwt.sign({ id: user.id }, JWT_SECRET);
  res.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name, balance: user.balance } });
});

// Auth middleware for protected routes
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Auth required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    req.user   = { id: payload.id };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.userId = payload.id;
      req.user   = { id: payload.id };
    } catch {}
  }
  next();
}

// ── EXTERNAL API CACHES ───────────────────────────
const _kalshiCache = new Map();
const _manifoldCache = new Map();
const _polyCache = new Map();
const _predictorFollowCache = new Map();

// ── MARKETS ───────────────────────────────────────

// Get all open markets
app.get('/markets', async (req, res) => {
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('resolved', false)
    .order('expiry_date', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Get single market
app.get('/markets/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ════════════════════════════════════════════════════════════
// TWEET → MARKET SHARE PAGE
// GET /share/:marketId  — public, no auth
// Renders a shareable page showing the source tweet + market card
// ════════════════════════════════════════════════════════════
app.get('/share/:marketId', async (req, res) => {
  try {
    const { data: market } = await supabase
      .from('markets')
      .select('*')
      .eq('id', req.params.marketId)
      .maybeSingle();

    if (!market) return res.status(404).send('<!DOCTYPE html><html><body style="font-family:monospace;padding:40px;color:#fff;background:#141412"><h2>Market not found</h2><a href="/" style="color:#c9920d">← HYPERFLEX</a></body></html>');

    const communitySlug = market.creator_slug || market.tenant_slug || '';
    // Fetch community display name for branding
    let communityName = communitySlug;
    if (communitySlug) {
      const { data: cs } = await supabase.from('creator_settings').select('display_name').eq('slug', communitySlug).single();
      communityName = cs?.display_name || communitySlug;
    }

    const yesOdds = Math.round((market.yes_price || 0.5) * 100);
    const noOdds  = 100 - yesOdds;
    const communityUrl = communitySlug ? `https://hyperflex.network/${communitySlug}?market=${market.id}` : 'https://hyperflex.network';
    const sharePageUrl = `https://hyperflex.network/share/${market.id}`;
    const tweetUrl     = market.source_tweet_url || null;
    const tweetText    = market.tweet_text || null;
    const tweetAuthor  = market.tweet_author || null;
    const expiryStr    = market.expiry_date ? new Date(market.expiry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const catLabel     = (market.category || 'other').charAt(0).toUpperCase() + (market.category || 'other').slice(1);
    const tweetHandle  = tweetAuthor ? tweetAuthor.replace(/^@/, '') : null;
    const tweetDisplayName = tweetHandle || 'Tweet';
    const tweetProfileUrl  = tweetHandle ? `https://x.com/${tweetHandle}` : null;

    // Pre-composed X tweet text
    const hasOdds = market.yes_price && market.yes_price !== 0.5;
    const oddsLine = hasOdds ? `\n🟢 YES ${yesOdds}%  🔴 NO ${noOdds}%` : '';
    const xTweetText = `"${market.question}"${oddsLine}\n\nWhat's your call? 👇\n`;
    const xShareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(xTweetText)}&url=${encodeURIComponent(sharePageUrl)}`;

    // OG meta — dynamic image card
    const ogTitle = market.question;
    const ogDesc = hasOdds
      ? `YES ${yesOdds}% · NO ${noOdds}% — Predict the outcome on ${communityName} via HYPERFLEX`
      : `New prediction market on ${communityName} — make your call on HYPERFLEX`;
    const ogImageUrl = `https://hyperflex.network/og/${market.id}.png`;

    const tweetSection = tweetText ? `
      <div style="max-width:520px;margin:0 auto 24px;background:#16181c;border:1px solid #2f3336;border-radius:16px;padding:16px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#c9920d,#e8a91a);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🐦</div>
          <div>
            <div style="font-weight:700;font-size:15px;color:#e7e9ea">${tweetDisplayName}</div>
            ${tweetHandle ? `<div style="font-size:14px;color:#71767b">@${tweetHandle}</div>` : ''}
          </div>
          <div style="margin-left:auto">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#e7e9ea"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.259 5.633 5.905-5.633zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </div>
        </div>
        <p style="font-size:15px;color:#e7e9ea;line-height:1.6;margin:0 0 14px">${tweetText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
        ${tweetUrl ? `<a href="${tweetUrl}" target="_blank" rel="noopener" style="font-size:13px;color:#1d9bf0;text-decoration:none">View original tweet →</a>` : ''}
      </div>
      <div style="max-width:520px;margin:0 auto 8px;display:flex;align-items:center;gap:0">
        <div style="flex:1;height:1px;background:linear-gradient(90deg,transparent,#c9920d)"></div>
        <div style="font-family:'Space Mono',monospace;font-size:10px;color:#c9920d;letter-spacing:0.12em;padding:0 12px">PREDICTION MARKET</div>
        <div style="flex:1;height:1px;background:linear-gradient(90deg,#c9920d,transparent)"></div>
      </div>` : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${market.question.replace(/</g,'&lt;')} — HYPERFLEX</title>
<meta property="og:title" content="${ogTitle.replace(/"/g,'&quot;')}">
<meta property="og:description" content="${ogDesc.replace(/"/g,'&quot;')}">
<meta property="og:image" content="${ogImageUrl}">
<meta property="og:url" content="${sharePageUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ogTitle.replace(/"/g,'&quot;')}">
<meta name="twitter:description" content="${ogDesc.replace(/"/g,'&quot;')}">
<meta name="twitter:image" content="${ogImageUrl}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0f0d;color:#e2ddd6;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .nav{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;border-bottom:1px solid rgba(201,146,13,0.15);max-width:760px;margin:0 auto}
  .logo{font-family:'Syne',sans-serif;font-weight:800;font-size:18px;color:#c9920d;text-decoration:none;letter-spacing:0.04em}
  .wrap{max-width:560px;margin:40px auto;padding:0 20px 80px}
  .market-card{background:#1c1c19;border:1px solid rgba(201,146,13,0.25);border-radius:16px;padding:24px;margin-top:16px}
  .market-cat{font-family:'Space Mono',monospace;font-size:10px;color:#c9920d;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:10px}
  .market-q{font-family:'Syne',sans-serif;font-size:22px;font-weight:700;line-height:1.3;color:#f0ebe3;margin-bottom:20px}
  .odds-row{display:flex;gap:10px;margin-bottom:18px}
  .odds-btn{flex:1;padding:14px 8px;border-radius:10px;border:none;font-family:'Space Mono',monospace;font-weight:700;font-size:18px;cursor:pointer;letter-spacing:0.04em;text-decoration:none;display:block;text-align:center}
  .odds-yes{background:rgba(46,160,67,0.15);border:1.5px solid rgba(46,160,67,0.4);color:#3fb950}
  .odds-no{background:rgba(218,54,51,0.12);border:1.5px solid rgba(218,54,51,0.3);color:#f85149}
  .odds-label{font-size:11px;opacity:0.65;display:block;font-weight:400;margin-top:2px}
  .meta-row{display:flex;gap:16px;font-family:'Space Mono',monospace;font-size:11px;color:#6b6860;margin-bottom:20px;flex-wrap:wrap}
  .cta-btn{display:block;width:100%;padding:14px;background:linear-gradient(135deg,#c9920d,#e8a91a);border:none;border-radius:10px;font-family:'Syne',sans-serif;font-weight:700;font-size:15px;color:#141412;text-align:center;text-decoration:none;letter-spacing:0.03em;cursor:pointer}
  .powered{text-align:center;margin-top:28px;font-family:'Space Mono',monospace;font-size:11px;color:#4a4844}
  .powered a{color:#c9920d;text-decoration:none}
  @media(max-width:480px){.market-q{font-size:18px}.odds-btn{font-size:15px}}
</style>
</head>
<body>
<nav style="max-width:760px;margin:0 auto;padding:14px 24px;border-bottom:1px solid rgba(201,146,13,0.15);display:flex;align-items:center;justify-content:space-between">
  <a href="https://hyperflex.network" style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;color:#c9920d;text-decoration:none;letter-spacing:0.04em">HYPERFLEX</a>
  <a href="${communityUrl}" style="font-family:'Space Mono',monospace;font-size:11px;color:#c9920d;text-decoration:none;border:1px solid rgba(201,146,13,0.3);padding:6px 14px;border-radius:6px">Make Your Prediction →</a>
</nav>
<div class="wrap">
  ${tweetSection}
  <div class="market-card">
    <div class="market-cat">${catLabel} Market</div>
    <div class="market-q">${market.question.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    <div class="odds-row">
      <a href="${communityUrl}" class="odds-btn odds-yes">
        ${yesOdds}%
        <span class="odds-label">YES</span>
      </a>
      <a href="${communityUrl}" class="odds-btn odds-no">
        ${noOdds}%
        <span class="odds-label">NO</span>
      </a>
    </div>
    ${expiryStr ? `<div class="meta-row"><span>Resolves ${expiryStr}</span>${market.resolved ? `<span style="color:#c9920d">● ${market.outcome || 'Resolved'}</span>` : '<span style="color:#3fb950">● Live</span>'}</div>` : ''}
    <a href="${communityUrl}" class="cta-btn">Make Your Prediction →</a>
  </div>

  <!-- Share buttons -->
  <div style="display:flex;gap:10px;margin-top:16px;max-width:520px;margin-left:auto;margin-right:auto">
    <a href="${xShareUrl}" target="_blank" rel="noopener"
       style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;background:#000;border:1px solid #2f3336;border-radius:10px;color:#e7e9ea;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;text-decoration:none;letter-spacing:.02em;transition:background .15s"
       onmouseover="this.style.background='#111'" onmouseout="this.style.background='#000'">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.259 5.633 5.905-5.633zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      Share on X
    </a>
    <button onclick="copyShareLink(this)"
       style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;background:rgba(201,146,13,0.1);border:1px solid rgba(201,146,13,0.35);border-radius:10px;color:#c9920d;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;cursor:pointer;letter-spacing:.02em">
      🔗 Copy Link
    </button>
  </div>

  <div class="powered" style="margin-top:20px">Powered by <a href="https://hyperflex.network">HYPERFLEX</a> — prediction markets for creators</div>
</div>
<script>
function copyShareLink(btn) {
  navigator.clipboard.writeText('${sharePageUrl}').then(() => {
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.innerHTML = '🔗 Copy Link'; }, 2000);
  });
}
</script>
</body>
</html>`;

    res.send(html);
  } catch (err) {
    console.error('share page error:', err);
    res.status(500).send('<!DOCTYPE html><html><body style="font-family:monospace;padding:40px;color:#fff;background:#141412"><h2>Error loading share page</h2></body></html>');
  }
});

// GET /og/home.png — redirect to static pre-rendered OG image
app.get('/og/home.png', (req, res) => res.redirect('/og-home.png'));

// ════════════════════════════════════════════════════════════════════════════
// GET /og/:marketId.png  — dynamic OG share card image (1200×630)
// Used as og:image on /share/:marketId and /win/:marketId/:userId pages
// ════════════════════════════════════════════════════════════════════════════
app.get('/og/:marketId.png', async (req, res) => {
  const sharp = getSharp();
  if (!sharp) return res.redirect('/og-image.png'); // fallback to static

  try {
    const { data: market } = await supabase
      .from('markets').select('question,yes_price,no_price,category,creator_slug,tenant_slug,expiry_date')
      .eq('id', req.params.marketId).maybeSingle();

    if (!market) return res.redirect('/og-image.png');

    const slug = market.creator_slug || market.tenant_slug || '';
    let communityName = slug;
    let accentColor = '#c9920d';
    if (slug) {
      const { data: cs } = await supabase.from('creator_settings')
        .select('display_name,accent_color').eq('slug', slug).maybeSingle();
      if (cs) {
        communityName = cs.display_name || slug;
        if (cs.accent_color) accentColor = cs.accent_color;
      }
    }

    const yesOdds = Math.round((market.yes_price || 0.5) * 100);
    const noOdds  = 100 - yesOdds;
    const hasOdds = market.yes_price && Math.abs(market.yes_price - 0.5) > 0.005;
    const cat     = (market.category || 'other').toUpperCase();

    // Word-wrap question text (~45 chars per line at font-size 52)
    const q = (market.question || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const words = q.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).length > 44) { lines.push(cur.trim()); cur = w; }
      else cur += ' ' + w;
    }
    if (cur.trim()) lines.push(cur.trim());
    const qLines = lines.slice(0, 3); // max 3 lines
    if (lines.length > 3) qLines[2] = qLines[2].replace(/.{3}$/, '…');

    const qY = 310 - (qLines.length - 1) * 34;
    const qSvg = qLines.map((l, i) =>
      `<text x="60" y="${qY + i * 68}" font-family="Arial Black,Impact,sans-serif" font-size="52" font-weight="900" fill="#f0ebe3">${l}</text>`
    ).join('\n');

    const yesBarW = Math.round(1080 * (yesOdds / 100));
    const noBarW  = 1080 - yesBarW;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a17"/>
      <stop offset="100%" stop-color="#0f0f0d"/>
    </linearGradient>
    <linearGradient id="yesBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#2ea043"/>
      <stop offset="100%" stop-color="#3fb950"/>
    </linearGradient>
    <linearGradient id="noBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#da3633"/>
      <stop offset="100%" stop-color="#f85149"/>
    </linearGradient>
    <clipPath id="card"><rect x="40" y="40" width="1120" height="550" rx="24"/></clipPath>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Card border -->
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="none"
        stroke="${accentColor}" stroke-width="2" stroke-opacity="0.35"/>

  <!-- Category pill -->
  <rect x="60" y="68" width="${cat.length * 11 + 24}" height="28" rx="6"
        fill="${accentColor}" fill-opacity="0.18"/>
  <text x="72" y="87" font-family="'Courier New',Courier,monospace" font-size="13"
        font-weight="700" fill="${accentColor}" letter-spacing="2">${cat}</text>

  <!-- HYPERFLEX logo -->
  <text x="1140" y="90" font-family="Arial Black,Impact,sans-serif" font-size="20"
        font-weight="900" fill="${accentColor}" text-anchor="end" letter-spacing="1">HYPERFLEX</text>

  <!-- Market question -->
  ${qSvg}

  ${hasOdds ? `
  <!-- Odds row -->
  <!-- YES button -->
  <rect x="60" y="${qY + qLines.length * 68 + 16}" width="520" height="84" rx="14"
        fill="#2ea043" fill-opacity="0.15"/>
  <rect x="60" y="${qY + qLines.length * 68 + 16}" width="520" height="84" rx="14"
        fill="none" stroke="#2ea043" stroke-opacity="0.4" stroke-width="1.5"/>
  <text x="320" y="${qY + qLines.length * 68 + 48}" font-family="'Courier New',Courier,monospace"
        font-size="36" font-weight="700" fill="#3fb950" text-anchor="middle">YES</text>
  <text x="320" y="${qY + qLines.length * 68 + 80}" font-family="'Courier New',Courier,monospace"
        font-size="22" font-weight="700" fill="#3fb950" text-anchor="middle">${yesOdds}%</text>

  <!-- NO button -->
  <rect x="620" y="${qY + qLines.length * 68 + 16}" width="520" height="84" rx="14"
        fill="#da3633" fill-opacity="0.12"/>
  <rect x="620" y="${qY + qLines.length * 68 + 16}" width="520" height="84" rx="14"
        fill="none" stroke="#da3633" stroke-opacity="0.3" stroke-width="1.5"/>
  <text x="880" y="${qY + qLines.length * 68 + 48}" font-family="'Courier New',Courier,monospace"
        font-size="36" font-weight="700" fill="#f85149" text-anchor="middle">NO</text>
  <text x="880" y="${qY + qLines.length * 68 + 80}" font-family="'Courier New',Courier,monospace"
        font-size="22" font-weight="700" fill="#f85149" text-anchor="middle">${noOdds}%</text>
  ` : `
  <!-- Open market nudge -->
  <text x="600" y="${qY + qLines.length * 68 + 64}" font-family="'Courier New',Courier,monospace"
        font-size="26" fill="#6b6860" text-anchor="middle">Make your prediction →</text>
  `}

  <!-- Community name + domain footer -->
  <text x="60" y="566" font-family="Arial,Helvetica,sans-serif" font-size="18"
        fill="#6b6860">${communityName.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>
  <text x="1140" y="566" font-family="'Courier New',Courier,monospace" font-size="16"
        fill="${accentColor}" text-anchor="end" fill-opacity="0.7">hyperflex.network/${slug}</text>

  <!-- Bottom accent line -->
  <rect x="60" y="578" width="${Math.min(480, communityName.length * 12)}" height="2"
        fill="${accentColor}" fill-opacity="0.4" rx="1"/>
</svg>`;

    const png = await sharp(Buffer.from(svg))
      .resize(1200, 630)
      .png({ compressionLevel: 6 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.send(png);
  } catch (err) {
    console.error('og image error:', err);
    res.redirect('/og-image.png');
  }
});

// Create market (admin)
app.post('/markets', async (req, res) => {
  const {
    question, expiry_date,
    commodity, target_price, direction,
    category, creator_id, tenant_slug, is_public, resolution_source,
    source_tweet_url, tweet_text, tweet_author, sponsor_name
  } = req.body;

  const row = {
    question,
    expiry_date,
    commodity:    commodity    || category || '',
    target_price: target_price ?? 0,
    direction:    direction    || 'above',
    yes_price:    0.5,
    no_price:     0.5,
    yes_pool:     MARKET_SEED,
    no_pool:      MARKET_SEED,
    resolved:     false,
  };
  if (category          !== undefined) row.category          = category;
  if (creator_id        !== undefined) row.creator_id        = creator_id;
  if (tenant_slug       !== undefined) row.tenant_slug       = tenant_slug;
  if (is_public         !== undefined) row.is_public         = is_public;
  if (resolution_source !== undefined) row.resolution_source = resolution_source;
  if (source_tweet_url  !== undefined) row.source_tweet_url  = source_tweet_url;
  if (tweet_text        !== undefined) row.tweet_text        = tweet_text;
  if (tweet_author      !== undefined) row.tweet_author      = tweet_author;
  if (sponsor_name      !== undefined) row.sponsor_name      = sponsor_name || null;

  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      // Try creator_id first (new schema), fall back to user_id (old schema)
      let { data: settings } = await supabase
        .from('creator_settings')
        .select('slug')
        .eq('creator_id', payload.id)
        .maybeSingle();
      if (!settings) {
        ({ data: settings } = await supabase
          .from('creator_settings')
          .select('slug')
          .eq('user_id', payload.id)
          .maybeSingle());
      }
      if (settings?.slug) {
        // Populate tenant_slug if the caller didn't provide it
        if (!row.tenant_slug) row.tenant_slug = settings.slug;
      }
    } catch (e) {
      // ignore invalid token
    }
  }

  // ── Plan-based market limit ───────────────────────────────────────────────
  if (row.tenant_slug) {
    const { data: cs } = await supabase
      .from('creator_settings')
      .select('plan, plan_trial_expires_at')
      .eq('slug', row.tenant_slug)
      .maybeSingle();
    if (cs) {
      const effectivePlan = (cs.plan_trial_expires_at && new Date(cs.plan_trial_expires_at) > new Date())
        ? 'pro' : cs.plan;
      const FREE_MARKET_LIMIT = 5;
      if (effectivePlan === 'free') {
        const { count } = await supabase
          .from('markets')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_slug', row.tenant_slug)
          .eq('resolved', false)
          .eq('archived', false);
        if ((count || 0) >= FREE_MARKET_LIMIT) {
          return res.status(403).json({
            error: 'Free plan limit reached',
            upgrade_required: true,
            limit: FREE_MARKET_LIMIT,
            message: `Free plan allows ${FREE_MARKET_LIMIT} active markets. Upgrade to Pro for unlimited markets.`
          });
        }
        // Sponsor labels are Pro/Premium only — strip silently on free
        if (row.sponsor_name) delete row.sponsor_name;
      }
    }
  }

  // Prohibited keyword check
  const prohibited = PROHIBITED_PATTERNS.find(p => p.re.test(row.question || ''));
  if (prohibited) return res.status(400).json({ error: prohibited.msg });

  // Store resolution_sources array if provided
  const { resolution_sources } = req.body;
  if (Array.isArray(resolution_sources) && resolution_sources.length >= 3) {
    row.resolution_sources = JSON.stringify(resolution_sources);
  }

  // Multi-option markets — options array with {label, pct?} items
  const { options: rawOptions } = req.body;
  if (Array.isArray(rawOptions) && rawOptions.length >= 2) {
    // Strip empty labels
    const cleaned = rawOptions.map(o => ({ label: (o.label || '').trim(), pct: Number(o.pct) || 0 }))
                               .filter(o => o.label.length > 0);
    if (cleaned.length >= 2) {
      // Normalise percentages so they sum to 100
      const totalPct = cleaned.reduce((s, o) => s + o.pct, 0) || 100;
      row.options = cleaned.map(o => ({
        label: o.label,
        votes: 0,
        pct:   Math.round((o.pct / totalPct) * 100),
      }));
      // Ensure sum === 100 (fix rounding)
      const pctSum = row.options.reduce((s, o) => s + o.pct, 0);
      if (pctSum !== 100) row.options[0].pct += (100 - pctSum);
    }
  }

  const { data, error } = await supabase
    .from('markets')
    .insert([row])
    .select()
    .single();
  if (error) {
    console.error('POST /markets insert error:', JSON.stringify({ message: error.message, code: error.code, details: error.details, hint: error.hint, row }));
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A market with this question already exists in your community. Try editing the wording slightly.' });
    }
    return res.status(400).json({ error: error.message, details: error.details, hint: error.hint });
  }
  // Score resonance async — don't block response
  if (data?.id) {
    scoreMarketResonance(data.question, data.category).then(score => {
      if (score) supabase.from('markets').update({ resonance_score: score }).eq('id', data.id).then(() => {});
    });
    // Notify followers if market is published immediately
    if (row.is_public === true && row.tenant_slug) {
      sendNewMarketNotifications(data, row.tenant_slug).catch(() => {});
      sendDiscordWebhook(data, row.tenant_slug).catch(() => {});
      maybeAcceptReferral(row.tenant_slug).catch(() => {});
    }
  }
  res.json(data);
});

// ── BULK MARKET CREATE ────────────────────────────────────────
// POST /api/creator/markets/bulk
// Auth: Bearer token (creator)
// Body: { markets: [{question, resolves_via?, category?}], expiry_date }
// Creates all markets in a single batch insert. Returns { created, errors }.
app.post('/api/creator/markets/bulk', requireCreator, async (req, res) => {
  try {
    const { markets, expiry_date } = req.body;
    if (!Array.isArray(markets) || !markets.length) {
      return res.status(400).json({ error: 'markets array required' });
    }
    if (!expiry_date) {
      return res.status(400).json({ error: 'expiry_date required' });
    }

    // Get creator slug + category
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('slug, community_category, plan')
      .eq('creator_id', req.creator.id)
      .single();

    if (!creator) return res.status(404).json({ error: 'Creator not found' });

    // Enforce free plan market limit on bulk create
    if (creator.plan === 'free') {
      const { count: activeCount } = await supabase
        .from('markets')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', req.creator.id)
        .eq('resolved', false)
        .eq('archived', false);
      const FREE_MARKET_LIMIT = 5;
      if ((activeCount || 0) >= FREE_MARKET_LIMIT) {
        return res.status(403).json({
          error: 'Free plan limit reached',
          upgrade_required: true,
          limit: FREE_MARKET_LIMIT,
          message: `Free plan allows ${FREE_MARKET_LIMIT} active markets. Upgrade to Pro for unlimited markets.`
        });
      }
    }

    const rows = [];
    const skipped = [];

    for (const m of markets.slice(0, 20)) { // hard cap 20
      const question = (m.question || '').trim();
      if (!question) { skipped.push({ question, reason: 'Empty question' }); continue; }
      // Prohibited check
      const prohibited = PROHIBITED_PATTERNS.find(p => p.re.test(question));
      if (prohibited) { skipped.push({ question, reason: prohibited.msg }); continue; }

      const resolvesVia = m.resolves_via || '';
      const sources = resolvesVia
        ? JSON.stringify([resolvesVia, 'Official announcement or press release', 'Public data / official statistics'])
        : null;

      rows.push({
        question,
        expiry_date,
        commodity:   m.category || creator.community_category || 'general',
        category:    m.category || creator.community_category || 'general',
        target_price: 0,
        direction:    'above',
        yes_price:    0.5,
        no_price:     0.5,
        yes_pool:     MARKET_SEED,
        no_pool:      MARKET_SEED,
        resolved:     false,
        creator_id:   req.creator.id,
        tenant_slug:  creator.slug,
        is_public:    true,
        ...(sources ? { resolution_sources: sources } : {})
      });
    }

    if (!rows.length) {
      return res.status(400).json({ error: 'No valid markets to create', skipped });
    }

    const { data: inserted, error } = await supabase
      .from('markets')
      .insert(rows)
      .select('id, question, category');

    if (error) {
      if (error.code === '23505') {
        // One or more questions already exist — retry one-by-one, skipping dupes
        const results = [];
        for (const r of rows) {
          const { data: d, error: e } = await supabase.from('markets').insert([r]).select('id, question, category').single();
          if (e && e.code === '23505') { skipped.push({ question: r.question, reason: 'Duplicate question already exists' }); }
          else if (e) { skipped.push({ question: r.question, reason: e.message }); }
          else if (d) results.push(d);
        }
        if (!results.length) return res.status(409).json({ error: 'All markets already exist in your community', skipped });
        return res.json({ created: results.length, markets: results, skipped });
      }
      throw error;
    }

    // Score resonance async for each; notify followers for first market only (avoid inbox spam on bulk)
    for (let i = 0; i < (inserted || []).length; i++) {
      const mkt = inserted[i];
      scoreMarketResonance(mkt.question, mkt.category).then(score => {
        if (score) supabase.from('markets').update({ resonance_score: score }).eq('id', mkt.id).then(() => {});
      });
      if (i === 0) sendNewMarketNotifications(mkt, creator.slug).catch(() => {});
    }

    console.log(`[bulk-create] ${inserted?.length} markets created by ${creator.slug}`);
    res.json({ created: inserted?.length || 0, skipped, markets: inserted });
  } catch (err) {
    console.error('[bulk-create]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── TRADING ───────────────────────────────────────

// Place a trade
app.post('/trade', requireAuth, async (req, res) => {
  const { market_id, side, amount } = req.body;
  const user_id = req.userId;

  // Validate user exists
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('id', user_id)
    .single();
  if (userError || !user) return res.status(400).json({ error: 'User not found' });

  // Get market
  const { data: market, error: marketError } = await supabase
    .from('markets')
    .select('*')
    .eq('id', market_id)
    .single();
  if (marketError || !market) return res.status(400).json({ error: 'Market not found' });
  if (market.resolved) return res.status(400).json({ error: 'Market already resolved' });

  // Resolve community slug for this market
  const creatorSlug = await getCreatorSlugForMarket(market);

  // Get creator economy settings (min/max bet)
  let minBet = 1000, maxBet = null;
  if (creatorSlug) {
    const { data: econSettings } = await supabase
      .from('creator_settings')
      .select('min_bet, max_bet')
      .eq('slug', creatorSlug)
      .maybeSingle();
    if (econSettings) {
      minBet = econSettings.min_bet ?? 1000;
      maxBet = econSettings.max_bet ?? null;
    }
  }

  // Enforce bet limits
  if (amount < minBet) return res.status(400).json({ error: `Minimum bet is ${minBet / 100} pts` });
  if (maxBet && amount > maxBet) return res.status(400).json({ error: `Maximum bet is ${maxBet / 100} pts` });

  // Get community balance (auto-creates row on first trade)
  const communityBalance = creatorSlug
    ? await getCommunityBalance(user_id, creatorSlug)
    : 0;

  if (communityBalance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  // ── Multi-option vs Binary pricing ────────────────────────────────────────
  const isMultiOption = Array.isArray(market.options) && market.options.length > 0;

  let potential_payout, marketUpdate, responseExtra;

  if (isMultiOption) {
    // ── Multi-option: vote-share percentages, parimutuel-style payout ──────
    const opts = market.options;
    const optIdx = opts.findIndex(o => o.label === side);
    if (optIdx === -1) return res.status(400).json({ error: `Invalid option "${side}"` });

    // Current pct for this option (used for payout calculation)
    const currentPct = (opts[optIdx].pct || (100 / opts.length)) / 100;
    potential_payout = Math.round(amount / currentPct);

    // Update vote counts and recalculate pcts
    const updatedOpts = opts.map((o, i) => ({ ...o, votes: (o.votes || 0) + (i === optIdx ? 1 : 0) }));
    const totalVotes  = updatedOpts.reduce((s, o) => s + (o.votes || 0), 0);
    const finalOpts   = updatedOpts.map(o => ({
      ...o,
      pct: totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : Math.round(100 / updatedOpts.length),
    }));

    // Check trader count
    const { count: priorPositionsM } = await supabase
      .from('positions')
      .select('id', { count: 'exact', head: true })
      .eq('market_id', market_id)
      .eq('user_id', user_id);
    const isNewTraderM = (priorPositionsM || 0) === 0;

    if (creatorSlug) await setCommunityBalance(user_id, creatorSlug, communityBalance - amount);

    const { data: position, error: posError } = await supabase
      .from('positions')
      .insert([{ user_id, market_id, side, amount, potential_payout }])
      .select().single();
    if (posError) return res.status(400).json({ error: posError.message });

    marketUpdate = { options: finalOpts, volume: (market.volume || 0) + amount };
    if (isNewTraderM) marketUpdate.trader_count = (market.trader_count || 0) + 1;
    const { error: mktErr } = await supabase.from('markets').update(marketUpdate).eq('id', market_id);
    if (mktErr) console.error('multi-option market update error:', mktErr.message);

    return res.json({
      message:  'Trade placed',
      position,
      balance:  communityBalance - amount,
      options:  finalOpts,
    });
  }

  // ── Binary CPMM Pricing ───────────────────────────────────────────────────
  // Use pool balances for current price. Fall back to stored price if pools are missing.
  const yesPool = market.yes_pool || MARKET_SEED;
  const noPool  = market.no_pool  || MARKET_SEED;
  const totalPool = yesPool + noPool;
  const price = side === 'YES'
    ? yesPool / totalPool
    : noPool  / totalPool;

  potential_payout = amount / price;

  // Compute updated pools after this trade
  const newYesPool = side === 'YES' ? yesPool + amount : yesPool;
  const newNoPool  = side === 'NO'  ? noPool  + amount : noPool;
  const newTotal   = newYesPool + newNoPool;
  const newYesPrice = newYesPool / newTotal;
  const newNoPrice  = newNoPool  / newTotal;

  // Check if this user has traded on this market before (determines trader_count increment)
  const { count: priorPositions } = await supabase
    .from('positions')
    .select('id', { count: 'exact', head: true })
    .eq('market_id', market_id)
    .eq('user_id', user_id);
  const isNewTrader = (priorPositions || 0) === 0;

  // Deduct from community balance
  if (creatorSlug) {
    await setCommunityBalance(user_id, creatorSlug, communityBalance - amount);
  }

  // Record position
  const { data: position, error: posError } = await supabase
    .from('positions')
    .insert([{ user_id, market_id, side, amount, potential_payout }])
    .select()
    .single();
  if (posError) return res.status(400).json({ error: posError.message });

  // Update pools, prices, volume, trader_count, and vote counts in one call
  const newYesVotes = (market.yes_votes || 0) + (side === 'YES' ? 1 : 0);
  const newNoVotes  = (market.no_votes  || 0) + (side === 'NO'  ? 1 : 0);
  const binaryUpdate = {
    yes_pool:   newYesPool,
    no_pool:    newNoPool,
    yes_price:  newYesPrice,
    no_price:   newNoPrice,
    volume:     (market.volume || 0) + amount,
    yes_votes:  newYesVotes,
    no_votes:   newNoVotes,
  };
  if (isNewTrader) binaryUpdate.trader_count = (market.trader_count || 0) + 1;
  const { error: mktErr } = await supabase.from('markets').update(binaryUpdate).eq('id', market_id);
  if (mktErr) console.error('market pool/price update error:', mktErr.message, mktErr.details);

  const totalVotes = newYesVotes + newNoVotes;
  const newBalance = communityBalance - amount;
  res.json({
    message:    'Trade placed',
    position,
    balance:    newBalance,
    yes_price:  newYesPrice,
    no_price:   newNoPrice,
    yes_votes:  newYesVotes,
    no_votes:   newNoVotes,
    yes_consensus: totalVotes > 0 ? Math.round(newYesVotes / totalVotes * 100) : null,
  });
});

// Helper: extract user ID from JWT Bearer token. Returns null on failure.
function getUserIdFromReq(req) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return null;
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.id || null;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// IN-APP NOTIFICATIONS
// GET  /api/notifications       — list unread (+ recent read, max 30)
// POST /api/notifications/read  — mark one or all as read
// ════════════════════════════════════════════════════════════
app.get('/api/notifications', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    res.json({ notifications: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/read', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const { id } = req.body; // if id provided, mark single; else mark all
    const query = supabase.from('notifications').update({ read: true }).eq('user_id', userId);
    if (id) query.eq('id', id);
    const { error } = await query;
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: push a notification to a user
async function pushNotification(userId, type, title, body, marketId = null, communitySlug = null) {
  try {
    await supabase.from('notifications').insert([{
      user_id: userId, type, title, body: body || null,
      market_id: marketId || null, community_slug: communitySlug || null,
    }]);
  } catch (err) {
    // non-blocking — swallow errors
  }
}

// GET /api/user/community-balance/:slug — returns user's balance in a specific community
// Auth: Bearer token (user JWT)
app.get('/api/user/community-balance/:slug', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ error: 'Invalid token' });

    const { slug } = req.params;
    const balance = await getCommunityBalance(userId, slug);

    // Also return economy settings for this community so the frontend can enforce min/max
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('min_bet, max_bet, starting_balance, custom_points_name')
      .eq('slug', slug)
      .maybeSingle();

    res.json({
      balance,
      min_bet: settings?.min_bet ?? 1000,
      max_bet: settings?.max_bet ?? null,
      starting_balance: settings?.starting_balance ?? 100000,
      custom_points_name: settings?.custom_points_name || 'Flex Points'
    });
  } catch (err) {
    console.error('community-balance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── REFERRAL SYSTEM ──────────────────────────────────────────
// Platform-level cap: referrer earns reward for max 5 referrals per week per community.
// Welcome bonus is always given regardless of cap.
const REFERRAL_WEEKLY_CAP = 5;

// POST /api/referral/claim — called after new user registers via a referral link
// Auth: Bearer token of the NEW user (the referred person)
// Body: { ref_user_id, creator_slug }
app.post('/api/referral/claim', async (req, res) => {
  try {
    const currentUserId = getUserIdFromReq(req);
    if (!currentUserId) return res.status(401).json({ error: 'Invalid token' });

    const { ref_user_id, creator_slug } = req.body;
    if (!ref_user_id || !creator_slug) return res.status(400).json({ error: 'ref_user_id and creator_slug required' });

    // Self-referral guard
    if (ref_user_id === currentUserId) return res.status(400).json({ error: 'Cannot refer yourself' });

    // Already claimed for this community?
    const { data: existingRef } = await supabase
      .from('referral_history')
      .select('id')
      .eq('referred_id', currentUserId)
      .eq('creator_slug', creator_slug)
      .maybeSingle();
    if (existingRef) return res.status(409).json({ error: 'Referral already claimed for this community' });

    // Verify referrer exists
    const { data: referrer } = await supabase
      .from('users')
      .select('id')
      .eq('id', ref_user_id)
      .maybeSingle();
    if (!referrer) return res.status(400).json({ error: 'Referrer not found' });

    // Get creator's referral settings
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('referral_reward, welcome_bonus')
      .eq('slug', creator_slug)
      .maybeSingle();
    if (!settings) return res.status(404).json({ error: 'Community not found' });

    const referralReward = settings.referral_reward ?? 10000; // 100 pts default
    const welcomeBonus   = settings.welcome_bonus   ?? 5000;  // 50 pts default

    // Check referrer's weekly cap
    const weekStart = getWeekStart().toISOString();
    const { count: weeklyCount } = await supabase
      .from('referral_history')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', ref_user_id)
      .eq('creator_slug', creator_slug)
      .gte('created_at', weekStart);

    const capExceeded = (weeklyCount || 0) >= REFERRAL_WEEKLY_CAP;

    // Credit welcome bonus to the new user
    const newUserBal = await getCommunityBalance(currentUserId, creator_slug);
    await setCommunityBalance(currentUserId, creator_slug, newUserBal + welcomeBonus);

    // Credit referral reward to referrer (only if under weekly cap)
    if (!capExceeded && referralReward > 0) {
      const referrerBal = await getCommunityBalance(ref_user_id, creator_slug);
      await setCommunityBalance(ref_user_id, creator_slug, referrerBal + referralReward);
    }

    // Record the referral
    await supabase
      .from('referral_history')
      .insert({
        referrer_id:     ref_user_id,
        referred_id:     currentUserId,
        creator_slug,
        referrer_reward: capExceeded ? 0 : referralReward,
        welcome_bonus:   welcomeBonus,
        cap_exceeded:    capExceeded
      });

    console.log(`[referral] ${creator_slug}: ${ref_user_id} → ${currentUserId} (welcome=${welcomeBonus/100}pts, reward=${capExceeded ? 0 : referralReward/100}pts, cap_exceeded=${capExceeded})`);

    res.json({
      ok:             true,
      welcome_bonus:  welcomeBonus,
      referral_reward_given: capExceeded ? 0 : referralReward,
      cap_exceeded:   capExceeded
    });
  } catch (err) {
    console.error('referral claim error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/referral-stats/:slug — returns referral stats for the current user in a community
app.get('/api/user/referral-stats/:slug', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ error: 'Invalid token' });

    const { slug } = req.params;

    // All referrals this user has made in this community
    const { data: referrals } = await supabase
      .from('referral_history')
      .select('referrer_reward, created_at')
      .eq('referrer_id', userId)
      .eq('creator_slug', slug)
      .order('created_at', { ascending: false });

    const total        = (referrals || []).length;
    const totalEarned  = (referrals || []).reduce((s, r) => s + (r.referrer_reward || 0), 0);
    const weekStart    = getWeekStart().toISOString();
    const thisWeek     = (referrals || []).filter(r => r.created_at >= weekStart).length;
    const remainingCap = Math.max(0, REFERRAL_WEEKLY_CAP - thisWeek);

    res.json({ total, total_earned: totalEarned, this_week: thisWeek, remaining_cap: remainingCap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/my-positions/:slug — auth'd: returns current user's open positions in a community
app.get('/api/user/my-positions/:slug', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ error: 'Invalid token' });
    const { slug } = req.params;
    // Get all market IDs for this community
    const { data: creator } = await supabase.from('creator_settings').select('creator_id').eq('slug', slug).maybeSingle();
    if (!creator) return res.json([]);
    const { data: mktRows } = await supabase.from('markets').select('id').eq('creator_id', creator.creator_id).eq('resolved', false);
    if (!mktRows || mktRows.length === 0) return res.json([]);
    const marketIds = mktRows.map(m => m.id);
    const { data: positions } = await supabase.from('positions')
      .select('market_id, side, amount, potential_payout, settled')
      .eq('user_id', userId)
      .in('market_id', marketIds);
    res.json(positions || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user positions
app.get('/positions/:user_id', requireAuth, async (req, res) => {
  if (req.userId !== req.params.user_id) return res.status(403).json({ error: 'Forbidden' });
  const { data, error } = await supabase
    .from('positions')
    .select('*, markets(*)')
    .eq('user_id', req.params.user_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Leaderboard: top 20 by PnL (settled) or by trades placed (fallback when no markets resolved yet).
// Accepts ?slug= (community page) or falls back to subdomain for custom domain routing.
app.get('/api/leaderboard', async (req, res) => {
  try {
    const period = req.query.period; // 'week' | undefined (all-time)
    // Accept slug param from community page; fall back to subdomain for custom domains
    const communitySlug = req.query.slug || req.tenant?.subdomain || null;

    // For weekly: only positions settled this week (Mon 00:00 UTC)
    const weekStart = period === 'week' ? getWeekStart() : null;

    let leaderboardMarketIds = null;

    if (communitySlug) {
      // tenant_slug is the correct column — creator_slug does not exist on markets table
      const { data: tenantMarkets } = await supabase
        .from('markets')
        .select('id')
        .eq('tenant_slug', communitySlug);
      leaderboardMarketIds = (tenantMarkets || []).map((m) => m.id);
      if (leaderboardMarketIds.length === 0) return res.json([]);
    }

    // ── Settled positions (primary ranking: PnL) ──
    let settledPositions = [];
    {
      let q = supabase
        .from('positions')
        .select('user_id, amount, potential_payout, settled, won, market_id')
        .eq('settled', true);
      if (leaderboardMarketIds) q = q.in('market_id', leaderboardMarketIds);
      if (weekStart) q = q.gte('created_at', weekStart);
      const { data: pos } = await q;
      settledPositions = pos || [];
    }

    // ── Fallback: all positions (for "most active" when nothing is settled yet) ──
    let allPositions = [];
    if (settledPositions.length === 0) {
      let q = supabase
        .from('positions')
        .select('user_id, amount, market_id')
      if (leaderboardMarketIds) q = q.in('market_id', leaderboardMarketIds);
      if (weekStart) q = q.gte('created_at', weekStart);
      const { data: pos } = await q;
      allPositions = pos || [];
    }

    const positions = settledPositions.length > 0 ? settledPositions : allPositions;
    const isFallback = settledPositions.length === 0;

    if (!positions || positions.length === 0) return res.json([]);

    const userIds = [...new Set(positions.map((p) => p.user_id))];
    const { data: users } = await supabase
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);

    const userMap = new Map((users || []).map((u) => [u.id, u]));
    const agg = new Map();

    for (const p of positions) {
      if (!agg.has(p.user_id)) {
        agg.set(p.user_id, { total_pnl: 0, wins: 0, total_trades: 0 });
      }
      const a = agg.get(p.user_id);
      a.total_trades += 1;
      if (!isFallback && p.won) {
        a.wins += 1;
        a.total_pnl += Number(p.potential_payout) || 0;
      }
      if (!isFallback) a.total_pnl -= Number(p.amount) || 0;
    }

    // Streaks only meaningful for all-time settled view
    const mktIds = leaderboardMarketIds || [...new Set(positions.map(p => p.market_id))];
    const streakMap = (period === 'week' || isFallback) ? {} : await getStreakMap(userIds, mktIds);

    const rows = [];
    for (const [userId, a] of agg) {
      const u = userMap.get(userId);
      rows.push({
        user_id:      userId,
        username:     (u?.display_name || u?.email || 'Unknown').trim() || 'Unknown',
        display_name: (u?.display_name || u?.email || 'Unknown').trim() || 'Unknown',
        total_pnl:    isFallback ? 0 : Math.round(a.total_pnl * 100) / 100,
        win_rate:     a.total_trades > 0 ? Math.round((a.wins / a.total_trades) * 100) : 0,
        total_trades: a.total_trades,
        wins:         a.wins,
        streak:       streakMap[userId] || 0,
        is_fallback:  isFallback, // frontend can show "trades placed" label instead of PnL
      });
    }

    // Sort: accuracy mode → win_rate (min 5 trades), settled → PnL, fallback → trades placed
    const sortMode = req.query.sort || 'pnl';
    if (sortMode === 'accuracy') {
      // Filter to users with enough trades to be meaningful, sort by win_rate then streak
      rows.sort((a, b) => {
        const aQual = a.total_trades >= 5, bQual = b.total_trades >= 5;
        if (aQual !== bQual) return bQual - aQual; // qualified first
        if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
        return b.streak - a.streak; // tiebreak by streak
      });
    } else {
      rows.sort((a, b) => isFallback ? b.total_trades - a.total_trades : b.total_pnl - a.total_pnl);
    }

    const top20 = rows.slice(0, 20).map((r, i) => ({ rank: i + 1, ...r }));
    res.json(top20);
  } catch (err) {
    console.error('leaderboard error:', err.message);
    res.status(500).json({ error: 'Leaderboard failed' });
  }
});

// ── PRICES (60s cache, backend-only; frontend uses GET /api/prices) ─────────
let pricesCache = { data: null, ts: 0 };
const PRICES_CACHE_MS = 60 * 1000;

app.get('/api/prices', async (req, res) => {
  const now = Date.now();
  if (pricesCache.data && now - pricesCache.ts < PRICES_CACHE_MS) {
    return res.json(pricesCache.data);
  }
  try {
    const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd').then((r) => (r.ok ? r.json() : null));
    const btc = cgRes?.bitcoin?.usd;
    const eth = cgRes?.ethereum?.usd;
    const [gold, silver, oil] = await Promise.all([
      fetchCurrentPrice('gold'),
      fetchCurrentPrice('silver'),
      fetchCurrentPrice('oil'),
    ]);
    const data = {
      BTC: typeof btc === 'number' && btc > 0 ? btc : null,
      ETH: typeof eth === 'number' && eth > 0 ? eth : null,
      XAU: gold,
      XAG: silver,
      WTI: oil,
    };
    pricesCache = { data, ts: now };
    res.json(data);
  } catch (err) {
    console.warn('GET /api/prices error:', err.message);
    res.json(pricesCache.data || { BTC: null, ETH: null, XAU: null, XAG: null, WTI: null });
  }
});

// ── SETTLEMENT ────────────────────────────────────

/**
 * Fetch current price for a commodity. Returns null if fetch fails.
 * - Crypto (bitcoin, ethereum): CoinGecko
 * - Commodities (gold, silver): metals.live spot
 * - Oil (WTI): Yahoo Finance CL=F
 */
async function fetchCurrentPrice(commodity) {
  if (!commodity || typeof commodity !== 'string') return null;
  const c = commodity.toLowerCase().trim();

  try {
    // Crypto via CoinGecko
    if (c === 'bitcoin' || c === 'btc' || c === 'crypto') {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      if (!res.ok) return null;
      const data = await res.json();
      const price = data?.bitcoin?.usd;
      return typeof price === 'number' && price > 0 ? price : null;
    }
    if (c === 'ethereum' || c === 'eth') {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      if (!res.ok) return null;
      const data = await res.json();
      const price = data?.ethereum?.usd;
      return typeof price === 'number' && price > 0 ? price : null;
    }

    // Precious metals via metals.live
    if (c === 'gold' || c === 'xau') {
      const res = await fetch('https://api.metals.live/v1/spot/gold');
      if (!res.ok) return null;
      const data = await res.json();
      const price = Array.isArray(data)?.[0]?.price ?? data?.price;
      return typeof price === 'number' && price > 0 ? price : null;
    }
    if (c === 'silver' || c === 'xag') {
      const res = await fetch('https://api.metals.live/v1/spot/silver');
      if (!res.ok) return null;
      const data = await res.json();
      const price = Array.isArray(data)?.[0]?.price ?? data?.price;
      return typeof price === 'number' && price > 0 ? price : null;
    }

    // WTI crude via Yahoo Finance chart
    if (c === 'oil' || c === 'wti' || c === 'crude') {
      const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/CL=F');
      if (!res.ok) return null;
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      return typeof price === 'number' && price > 0 ? price : null;
    }

    return null;
  } catch (err) {
    console.warn('fetchCurrentPrice failed for', commodity, err.message);
    return null;
  }
}

// ─── Community balance helpers ───────────────────────────────
// Gets a user's balance in a specific community. Auto-creates the row
// on first access using the creator's configured starting_balance.
async function getCommunityBalance(userId, creatorSlug) {
  // Try to get existing row
  const { data: existing } = await supabase
    .from('community_balances')
    .select('balance')
    .eq('user_id', userId)
    .eq('creator_slug', creatorSlug)
    .maybeSingle();

  if (existing) return existing.balance;

  // First time in this community — look up creator's starting balance
  const { data: settings } = await supabase
    .from('creator_settings')
    .select('starting_balance')
    .eq('slug', creatorSlug)
    .maybeSingle();

  const startingBalance = settings?.starting_balance ?? 100000; // default 1,000 pts

  // Create the row
  const { data: created } = await supabase
    .from('community_balances')
    .insert([{ user_id: userId, creator_slug: creatorSlug, balance: startingBalance }])
    .select('balance')
    .single();

  return created?.balance ?? startingBalance;
}

async function setCommunityBalance(userId, creatorSlug, newBalance) {
  await supabase
    .from('community_balances')
    .upsert(
      { user_id: userId, creator_slug: creatorSlug, balance: newBalance, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,creator_slug' }
    );
  // Fire-and-forget: log any newly crossed reward thresholds
  maybeLogRewardUnlocks(userId, creatorSlug, newBalance)
    .catch(e => console.error('[reward_unlock]', e.message));
}

// Check if a balance update crossed any new reward thresholds and record them.
// newBalance is in centpoints; creator_rewards.threshold is in points.
async function maybeLogRewardUnlocks(userId, creatorSlug, newBalance) {
  const pointBalance = Math.floor(newBalance / 100);

  // Fetch creator_id for this slug
  const { data: cs } = await supabase
    .from('creator_settings')
    .select('creator_id')
    .eq('slug', creatorSlug)
    .maybeSingle();
  if (!cs?.creator_id) return;

  // All rewards at or below current point balance
  const { data: rewards } = await supabase
    .from('creator_rewards')
    .select('id, title, threshold')
    .eq('creator_id', cs.creator_id)
    .lte('threshold', pointBalance);
  if (!rewards?.length) return;

  // Already-logged unlocks for this user in this community
  const { data: existing } = await supabase
    .from('reward_unlocks')
    .select('reward_id')
    .eq('user_id', userId)
    .eq('creator_slug', creatorSlug);
  const alreadyUnlocked = new Set((existing || []).map(r => r.reward_id));

  const toInsert = rewards
    .filter(r => !alreadyUnlocked.has(r.id))
    .map(r => ({
      user_id:          userId,
      creator_slug:     creatorSlug,
      reward_id:        r.id,
      reward_title:     r.title,
      reward_threshold: r.threshold,
    }));

  if (toInsert.length) {
    await supabase.from('reward_unlocks').insert(toInsert);
  }
}

// Resolve the creator slug for a market (prefer tenant_slug, fall back to creator_id lookup)
async function getCreatorSlugForMarket(market) {
  if (market.tenant_slug) return market.tenant_slug;
  if (market.creator_id) {
    const { data: s } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('creator_id', market.creator_id)
      .maybeSingle();
    return s?.slug || null;
  }
  return null;
}
// ────────────────────────────────────────────────────────────

// ─── Streak helpers ─────────────────────────────────────────
// Returns the number of consecutive wins in a user's most-recent settled positions,
// excluding the market currently being settled so the multiplier reflects prior streak.
async function getUserStreak(userId, excludeMarketId = null) {
  let query = supabase
    .from('positions')
    .select('won, market_id')
    .eq('user_id', userId)
    .eq('settled', true)
    .order('created_at', { ascending: false })
    .limit(15);
  if (excludeMarketId) query = query.neq('market_id', excludeMarketId);
  const { data: recentPositions } = await query;
  if (!recentPositions || recentPositions.length === 0) return 0;
  let streak = 0;
  for (const p of recentPositions) {
    if (p.won) streak++;
    else break;
  }
  return streak;
}

// Multiplier tiers: 3 consecutive wins → 1.5×, 5+ → 2×
function getStreakMultiplier(streak) {
  if (streak >= 5) return 2.0;
  if (streak >= 3) return 1.5;
  return 1.0;
}

// Batch-compute current streak for an array of userIds across a set of marketIds.
// Returns { userId: streakCount } map.
async function getStreakMap(userIds, marketIds) {
  if (!userIds || userIds.length === 0) return {};
  const { data: allPos } = await supabase
    .from('positions')
    .select('user_id, won, created_at')
    .in('user_id', userIds)
    .in('market_id', marketIds)
    .eq('settled', true)
    .order('created_at', { ascending: false })
    .limit(500);

  // Group by user (already sorted desc by created_at)
  const possByUser = {};
  for (const p of allPos || []) {
    if (!possByUser[p.user_id]) possByUser[p.user_id] = [];
    possByUser[p.user_id].push(p.won);
  }
  const streakMap = {};
  for (const [uid, wins] of Object.entries(possByUser)) {
    let s = 0;
    for (const won of wins) { if (won) s++; else break; }
    streakMap[uid] = s;
  }
  return streakMap;
}
// ────────────────────────────────────────────────────────────

async function settleMarkets() {
  // settlement check — silent in production
  const now = new Date().toISOString();

  const { data: markets } = await supabase
    .from('markets')
    .select('*')
    .eq('resolved', false)
    .lt('expiry_date', now);

  if (!markets || markets.length === 0) return;

  for (const market of markets) {
    const settlement_price = await fetchCurrentPrice(market.commodity);
    if (settlement_price == null) {
      // no price available — skip this market silently
      continue;
    }

    const outcome = market.direction === 'above'
      ? settlement_price >= market.target_price
      : settlement_price <= market.target_price;

    // Resolve market
    await supabase
      .from('markets')
      .update({ resolved: true, settlement_price, outcome })
      .eq('id', market.id);

    // Settle positions
    const { data: positions } = await supabase
      .from('positions')
      .select('*')
      .eq('market_id', market.id)
      .eq('settled', false);

    for (const position of positions) {
      const won = (position.side === 'YES') === outcome;
      await supabase
        .from('positions')
        .update({ settled: true, won })
        .eq('id', position.id);

      if (won) {
        // Apply streak multiplier (based on streak BEFORE this settlement)
        const streak = await getUserStreak(position.user_id, market.id);
        const multiplier = getStreakMultiplier(streak);
        const payout = Math.round(position.potential_payout * multiplier);
        // Credit community balance (per-community economy)
        const creatorSlug = await getCreatorSlugForMarket(market);
        if (creatorSlug) {
          const cb = await getCommunityBalance(position.user_id, creatorSlug);
          await setCommunityBalance(position.user_id, creatorSlug, cb + payout);
        } else {
          // Fallback: legacy global balance
          const { data: user } = await supabase.from('users').select('balance').eq('id', position.user_id).single();
          if (user) await supabase.from('users').update({ balance: user.balance + payout }).eq('id', position.user_id);
        }
        if (multiplier > 1) {
          console.log(`[settle] streak bonus x${multiplier} for user ${position.user_id} (streak=${streak})`);
        }
      }
    }
    console.log(`[settle] ${market.id} → ${outcome ? 'YES' : 'NO'} @ ${settlement_price}`);

    // Email bettors about the outcome (fire-and-forget)
    const creatorSlug = await getCreatorSlugForMarket(market);
    sendResolutionEmails(market, outcome ? 'YES' : 'NO', creatorSlug, null);
  }
}

// Run settlement every hour
cron.schedule('0 * * * *', settleMarkets);

// ── TRIAL EXPIRY ────────────────────────────────────────
// Every hour: downgrade any creators whose gifted trial has expired
async function expireTrials() {
  try {
    const { data: expired } = await supabase
      .from('creator_settings')
      .select('slug, creator_id, plan_trial_expires_at')
      .not('plan_trial_expires_at', 'is', null)
      .lt('plan_trial_expires_at', new Date().toISOString());
    if (!expired?.length) return;
    for (const cs of expired) {
      await supabase.from('creator_settings')
        .update({ plan: 'free', plan_trial_expires_at: null })
        .eq('slug', cs.slug);
      console.log(`[trial-expiry] /${cs.slug} trial expired → downgraded to free`);
    }
  } catch (err) {
    console.error('[trial-expiry] error:', err.message);
  }
}
cron.schedule('30 * * * *', expireTrials); // runs at :30 past each hour

// ── EMAIL QUEUE PROCESSOR ─────────────────────────────────────────────────
// Picks up any pending_emails where send_after <= now, sends them, marks sent
async function processPendingEmails() {
  const transport = createMailTransport();
  if (!transport) return; // SMTP not configured — skip silently

  try {
    const { data: due } = await supabase
      .from('pending_emails')
      .select('*')
      .eq('sent', false)
      .lte('send_after', new Date().toISOString())
      .limit(50);

    if (!due?.length) return;

    for (const email of due) {
      try {
        await transport.sendMail({
          from: process.env.SMTP_FROM || 'HYPERFLEX <noreply@hyperflex.network>',
          replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_FROM || 'noreply@hyperflex.network',
          to: email.to_email,
          subject: email.subject,
          html: email.html,
        });
        await supabase
          .from('pending_emails')
          .update({ sent: true, sent_at: new Date().toISOString() })
          .eq('id', email.id);
        console.log(`[email-queue] sent "${email.subject}" to ${email.to_email}`);
      } catch (err) {
        console.error(`[email-queue] failed to send to ${email.to_email}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[email-queue] processor error:', err.message);
  }
}
cron.schedule('15 * * * *', processPendingEmails); // runs at :15 past each hour

// ── WEEKLY REFILLS ────────────────────────────────

// Returns the most recent Monday at 00:00:00 UTC
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon…6=Sat
  const diff = day === 0 ? -6 : 1 - day; // roll back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Process refills for one creator's community (or all creators if creatorSlug is null).
// Called by the weekly cron and by the manual trigger endpoint.
async function processWeeklyRefills(targetSlug = null) {
  const weekStart     = getWeekStart();
  const weekStartISO  = weekStart.toISOString();
  const weekStartDate = weekStart.toISOString().split('T')[0]; // YYYY-MM-DD

  // Fetch eligible creators
  let query = supabase
    .from('creator_settings')
    .select('slug, refill_amount, refill_cadence, activity_gate, starting_balance')
    .eq('refill_enabled', true);
  if (targetSlug) query = query.eq('slug', targetSlug);
  const { data: creators } = await query;

  if (!creators || creators.length === 0) {
    console.log('[refill] No creators with refill enabled.');
    return { creators_processed: 0, total_refills: 0 };
  }

  let totalRefills = 0;

  for (const creator of creators) {
    const slug         = creator.slug;
    const refillAmount = creator.refill_amount  ?? 10000; // default 100 pts
    const configGate   = creator.activity_gate  ?? 5;

    try {
      // ── 1. All market IDs for this community ──────────────────────────────
      const { data: allMarkets } = await supabase
        .from('markets')
        .select('id')
        .or(`creator_slug.eq.${slug},tenant_slug.eq.${slug}`);
      const allMarketIds = (allMarkets || []).map(m => m.id);

      // ── 2. Markets published THIS week (for gate scaling) ────────────────
      const { count: marketsThisWeek } = await supabase
        .from('markets')
        .select('id', { count: 'exact', head: true })
        .or(`creator_slug.eq.${slug},tenant_slug.eq.${slug}`)
        .gte('created_at', weekStartISO);

      // Effective gate = min(configured, floor(0.5 × marketsPublishedThisWeek))
      // Protects users from being gated out when the creator publishes fewer markets
      const effectiveGate = Math.min(configGate, Math.floor(0.5 * (marketsThisWeek || 0)));

      // ── 3. All community members ──────────────────────────────────────────
      const { data: balanceRows } = await supabase
        .from('community_balances')
        .select('user_id, balance')
        .eq('creator_slug', slug);

      if (!balanceRows || balanceRows.length === 0) continue;
      const userIds = balanceRows.map(r => r.user_id);

      // ── 4. Bets this week per user ────────────────────────────────────────
      let betCountMap = {};
      if (allMarketIds.length > 0) {
        const { data: weekPositions } = await supabase
          .from('positions')
          .select('user_id')
          .in('market_id', allMarketIds)
          .gte('created_at', weekStartISO);
        (weekPositions || []).forEach(p => {
          betCountMap[p.user_id] = (betCountMap[p.user_id] || 0) + 1;
        });
      }

      // ── 5. Already-refilled this week ────────────────────────────────────
      const { data: alreadyRefilled } = await supabase
        .from('refill_history')
        .select('user_id')
        .eq('creator_slug', slug)
        .eq('week_start', weekStartDate)
        .in('user_id', userIds);
      const alreadyRefilledSet = new Set((alreadyRefilled || []).map(r => r.user_id));

      // ── 6. User registration dates (new-user grace period) ───────────────
      const { data: userRows } = await supabase
        .from('users')
        .select('id, created_at')
        .in('id', userIds);
      const userCreatedMap = {};
      (userRows || []).forEach(u => { userCreatedMap[u.id] = u.created_at; });
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

      // ── 7. Process each member ────────────────────────────────────────────
      let refillCount = 0;
      for (const row of balanceRows) {
        const userId = row.user_id;
        if (alreadyRefilledSet.has(userId)) continue; // already got it this week

        // New users (< 7 days) get a free pass — no activity required
        const isNewUser = userCreatedMap[userId] && userCreatedMap[userId] > sevenDaysAgo;
        const betsThisWeek = betCountMap[userId] || 0;
        const qualifies = isNewUser || betsThisWeek >= effectiveGate;

        if (qualifies) {
          await setCommunityBalance(userId, slug, row.balance + refillAmount);
          await supabase
            .from('refill_history')
            .insert({ user_id: userId, creator_slug: slug, amount: refillAmount, week_start: weekStartDate });
          refillCount++;
        }
      }

      totalRefills += refillCount;
      console.log(`[refill] ${slug}: ${refillCount}/${balanceRows.length} refilled (+${refillAmount / 100} pts, gate=${effectiveGate})`);

    } catch (err) {
      console.error(`[refill] Error for ${slug}:`, err.message);
    }
  }

  console.log(`[refill] Done — ${totalRefills} total refills across ${creators.length} communities.`);
  return { creators_processed: creators.length, total_refills: totalRefills };
}

// Run every Monday at midnight UTC
cron.schedule('0 0 * * 1', () => {
  console.log('[refill] Weekly cron triggered');
  processWeeklyRefills();
});

// POST /api/creator/trigger-refill — manually trigger a refill run for the creator's community
// Useful for testing; safe to call multiple times (idempotent per week)
app.post('/api/creator/trigger-refill', requireCreator, async (req, res) => {
  try {
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('slug, refill_enabled')
      .eq('creator_id', req.creator.id)
      .maybeSingle();
    if (!settings) return res.status(404).json({ error: 'Creator settings not found' });
    if (!settings.refill_enabled) return res.status(400).json({ error: 'Refill is not enabled for your community. Enable it in Economy Settings first.' });

    const result = await processWeeklyRefills(settings.slug);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('trigger-refill error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── CLAUDE AI MARKET SCANNER ─────────────────────

async function scanAndCreateMarkets() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('scanAndCreateMarkets skipped: ANTHROPIC_API_KEY not set');
    return;
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const systemPrompt =
      'You are a financial prediction market creator. Today is ' + today + '. Generate 5 prediction market questions with resolution_date between 30-90 days from today. All dates must be in 2026. Return ONLY a JSON array, no other text. Each object must have: question (string), category (crypto/commodities/earnings/macro), resolution_date (YYYY-MM-DD format), target_price (number), direction (above or below)';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content:
            'Generate the markets as requested in the system prompt and return ONLY the JSON array.',
        },
      ],
    });

    const content = response?.content?.[0]?.text || response?.content?.[0]?.input_text || '';
    if (!content) {
      console.warn('Claude scan returned empty content');
      return;
    }

    let markets;
    try {
      markets = JSON.parse(content);
    } catch (err) {
      console.error('Failed to parse Claude JSON for market scan:', err.message);
      return;
    }

    if (!Array.isArray(markets)) {
      console.warn('Claude scan did not return an array, skipping');
      return;
    }

    for (const m of markets) {
      if (!m || typeof m.question !== 'string') continue;

      // Skip duplicates by question
      const { data: existing } = await supabase
        .from('markets')
        .select('id')
        .eq('question', m.question)
        .maybeSingle();
      if (existing) continue;

      const category = (m.category || '').toString();
      const direction = (m.direction || '').toLowerCase() === 'above' ? 'above' : 'below';
      const target_price = Number(m.target_price) || 0;
      const resolution_date = m.resolution_date;
      const expiry_date = resolution_date;

      const insertRow = {
        question: m.question,
        category,
        resolution_date,
        commodity: category,
        target_price,
        direction,
        expiry_date,
        yes_price: 0.5,
        no_price: 0.5,
        yes_pool: MARKET_SEED,
        no_pool: MARKET_SEED,
        resolved: false,
      };
      // inserting auto-generated market

      const { data: inserted, error } = await supabase.from('markets').insert([insertRow]).select();
      if (error) {
        console.error('[scanAndCreateMarkets] Supabase insert error:', error.message, error);
      } else if (inserted?.[0]?.id) {
        // Score resonance async — don't block market creation
        scoreMarketResonance(insertRow.question, insertRow.category).then(score => {
          if (score) supabase.from('markets').update({ resonance_score: score }).eq('id', inserted[0].id).then(() => {});
        });
      }
    }
  } catch (err) {
    console.error('scanAndCreateMarkets error:', err.message);
  }
}

// Run Claude scanner every 6 hours
cron.schedule('0 */6 * * *', scanAndCreateMarkets);

// Manual trigger endpoint (legacy)
app.post('/api/scan-markets', requireAdmin, async (req, res) => {
  try {
    await scanAndCreateMarkets();
    res.json({ ok: true });
  } catch (err) {
    console.error('Manual scan-markets error:', err.message);
    res.status(500).json({ error: 'Scan failed' });
  }
});

// ════════════════════════════════════════════════════════════
// NEWS INTELLIGENCE SCANNER
// Ingests live headlines → extracts dominant narratives → creates markets
// Sources: Google News RSS, Reddit hot, X trending (if bearer token set)
// ════════════════════════════════════════════════════════════

// Lightweight RSS parser — extracts <item><title> + <link> pairs
function parseRSSItems(xml, limit = 30) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch  = block.match(/<link[^>]*>\s*(https?:\/\/[^\s<]+)/i)
      || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const title  = titleMatch  ? titleMatch[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim() : null;
    const link   = linkMatch   ? linkMatch[1].trim() : null;
    const source = sourceMatch ? sourceMatch[1].trim() : null;
    if (title && title.length > 10) items.push({ title, link, source });
  }
  return items;
}

async function fetchRSSFeed(url, limit = 30) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'HyperflexBot/1.0', 'Accept': 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRSSItems(xml, limit);
  } catch (e) {
    console.warn(`[news] RSS fetch failed (${url.slice(0,50)}):`, e.message);
    return [];
  }
}

async function fetchRedditHot(subreddit, limit = 20) {
  try {
    const res = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`, {
      headers: { 'User-Agent': 'HyperflexBot/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data?.children || [])
      .filter(c => !c.data.stickied && c.data.score > 500)
      .map(c => ({ title: c.data.title, link: 'https://reddit.com' + c.data.permalink, source: 'Reddit r/' + subreddit }));
  } catch (e) {
    console.warn(`[news] Reddit fetch failed (${subreddit}):`, e.message);
    return [];
  }
}

async function fetchXTrending() {
  const bearer = process.env.X_BEARER_TOKEN;
  if (!bearer) return [];
  try {
    // WOEID 1 = worldwide trending
    const res = await fetch('https://api.twitter.com/2/trends/by/woeid/1', {
      headers: { 'Authorization': `Bearer ${bearer}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data || []).slice(0, 20).map(t => ({
      title: t.name || t.trend_name || '',
      link: `https://x.com/search?q=${encodeURIComponent(t.name || '')}`,
      source: 'X Trending'
    })).filter(t => t.title.length > 2);
  } catch (e) {
    console.warn('[news] X trending fetch failed:', e.message);
    return [];
  }
}

async function extractDominantNarratives(headlines, categoryFilter) {
  if (!headlines.length) return [];
  const headlineText = headlines
    .map((h, i) => `${i+1}. [${h.source || 'News'}] ${h.title}${h.link ? ' | ' + h.link : ''}`)
    .join('\n');

  const catInstruction = categoryFilter && categoryFilter !== 'all'
    ? `Focus ONLY on these categories: ${categoryFilter}.`
    : 'Cover a mix of categories: politics, finance, crypto, sports, entertainment, tech, world events.';

  const prompt = `You are analyzing news headlines to find the biggest stories right now for prediction markets.

HEADLINES (${headlines.length} sources):
${headlineText.slice(0, 6000)}

${catInstruction}

Extract the 5-7 most significant, prediction-worthy narratives from these headlines.
For each, generate 2 binary YES/NO prediction market questions that:
- Have a clear, verifiable resolution condition
- Will resolve within 14-60 days
- Are genuinely uncertain (not 99% obvious)
- Reference specific names, numbers, or dates from the news

Return ONLY a JSON array. Each object:
{
  "narrative": "one-sentence description of the story",
  "category": "politics|finance|crypto|sports|entertainment|tech|world",
  "source_headline": "the main headline that inspired this",
  "source_url": "URL if available or null",
  "markets": [
    {
      "question": "Will X happen by [specific date]?",
      "expiry_days": 30
    }
  ]
}`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = message.content[0].text.trim().replace(/^```json?\s*/i,'').replace(/```\s*$/,'').trim();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[news] narrative parse error:', e.message, raw.slice(0, 200));
    return [];
  }
}

async function runNewsIntelligenceScanner(targetSlug = null) {
  if (!anthropic) {
    console.warn('[news-scanner] skipped: ANTHROPIC_API_KEY not set');
    return { ok: false, reason: 'no_ai' };
  }

  console.log('[news-scanner] Starting scan…');
  const startedAt = new Date();

  // ── 1. Fetch all news sources in parallel ──────────────────
  const [googleTop, googleWorld, googleBiz, googleTech, googleEnt,
         redditNews, redditWorldnews, redditCrypto, xTrends] = await Promise.all([
    fetchRSSFeed('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', 20),
    fetchRSSFeed('https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en', 15),
    fetchRSSFeed('https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en', 15),
    fetchRSSFeed('https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en', 10),
    fetchRSSFeed('https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en', 10),
    fetchRedditHot('news', 15),
    fetchRedditHot('worldnews', 15),
    fetchRedditHot('CryptoCurrency', 10),
    fetchXTrending()
  ]);

  const allHeadlines = [
    ...googleTop, ...googleWorld, ...googleBiz, ...googleTech, ...googleEnt,
    ...redditNews, ...redditWorldnews, ...redditCrypto,
    ...xTrends.map(t => ({ ...t, title: `TRENDING ON X: ${t.title}` }))
  ];

  // Deduplicate by title similarity (simple prefix match)
  const seen = new Set();
  const deduped = allHeadlines.filter(h => {
    const key = h.title.toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[news-scanner] Collected ${deduped.length} unique headlines from ${[googleTop,googleWorld,googleBiz,googleTech,googleEnt,redditNews,redditWorldnews,redditCrypto,xTrends].filter(a=>a.length).length} sources`);

  if (deduped.length < 5) {
    console.warn('[news-scanner] Too few headlines, aborting');
    return { ok: false, reason: 'insufficient_headlines', count: deduped.length };
  }

  // ── 2. Determine which creators to populate ────────────────
  let creators = [];
  if (targetSlug) {
    const { data } = await supabase.from('creator_settings')
      .select('creator_id, slug, plan, news_feed_categories')
      .eq('slug', targetSlug).eq('is_active', true).maybeSingle();
    if (data) creators = [data];
  } else {
    // All Pro/Premium creators with news feed enabled
    const { data } = await supabase.from('creator_settings')
      .select('creator_id, slug, plan, news_feed_categories')
      .eq('is_active', true)
      .eq('news_feed_enabled', true)
      .in('plan', ['pro', 'platinum']);
    creators = data || [];
  }

  if (!creators.length) {
    console.log('[news-scanner] No eligible creators, nothing to do');
    return { ok: true, reason: 'no_eligible_creators', markets_created: 0 };
  }

  // ── 3. Extract narratives once (shared across all creators) ─
  // Use the first creator's category filter; or 'all' if multiple
  const catFilter = creators.length === 1 ? (creators[0].news_feed_categories || 'all') : 'all';
  const narratives = await extractDominantNarratives(deduped, catFilter);
  console.log(`[news-scanner] Extracted ${narratives.length} dominant narratives`);

  if (!narratives.length) return { ok: false, reason: 'no_narratives' };

  // ── 4. Create markets for each creator ────────────────────
  let totalCreated = 0;
  const MARKET_SEED = 10000;

  for (const creator of creators) {
    // Fetch ALL existing questions for this creator (no time limit) to prevent any duplicates
    const { data: recentMkts } = await supabase.from('markets')
      .select('question')
      .eq('creator_id', creator.creator_id);
    const recentQuestions = new Set((recentMkts || []).map(m => m.question.toLowerCase().trim()));

    let creatorCreated = 0;
    for (const n of narratives) {
      for (const mkt of (n.markets || [])) {
        if (!mkt.question || typeof mkt.question !== 'string') continue;
        // Duplicate check — full question match
        const qKey = mkt.question.toLowerCase().trim();
        if (recentQuestions.has(qKey)) continue;
        recentQuestions.add(qKey);

        const expiryDays = Math.min(Math.max(mkt.expiry_days || 30, 7), 90);
        const expiry = new Date(Date.now() + expiryDays * 86400000).toISOString().split('T')[0];

        const { error } = await supabase.from('markets').insert([{
          question:       mkt.question,
          category:       n.category || 'news',
          expiry_date:    expiry,
          yes_price:      0.5,
          no_price:       0.5,
          yes_pool:       MARKET_SEED,
          no_pool:        MARKET_SEED,
          resolved:       false,
          is_public:      true,
          creator_id:     creator.creator_id,
          tenant_slug:    creator.slug,
          // Reuse tweet fields to carry news context (shows in tweet feed on community page)
          tweet_text:       n.source_headline || n.narrative,
          source_tweet_url: n.source_url || null,
          resolution_source: n.source_url || null,
          tweet_author:     n.narrative ? 'News Intelligence' : null
        }]);

        if (error) {
          console.error(`[news-scanner] insert error (${creator.slug}):`, error.message);
        } else {
          creatorCreated++;
          totalCreated++;
        }
      }
    }

    // Update last scan timestamp
    await supabase.from('creator_settings')
      .update({ news_feed_last_scan: startedAt.toISOString() })
      .eq('creator_id', creator.creator_id);

    console.log(`[news-scanner] ${creator.slug}: created ${creatorCreated} markets`);
  }

  console.log(`[news-scanner] Done — ${totalCreated} markets created across ${creators.length} communities in ${Date.now() - startedAt}ms`);
  return { ok: true, narratives: narratives.length, markets_created: totalCreated, sources: deduped.length };
}

// Run news scanner every 4 hours
cron.schedule('0 */4 * * *', () => {
  console.log('[cron] News intelligence scanner triggered');
  runNewsIntelligenceScanner().catch(e => console.error('[news-scanner] cron error:', e.message));
});

// POST /api/creator/news-scan — per-creator manual trigger
app.post('/api/creator/news-scan', requireCreator, async (req, res) => {
  try {
    const { data: settings } = await supabase.from('creator_settings')
      .select('slug, plan, news_feed_enabled')
      .eq('creator_id', req.creator.id)
      .maybeSingle();
    if (!settings) return res.status(404).json({ error: 'Creator not found' });
    if (!['pro','platinum'].includes(settings.plan)) {
      return res.status(403).json({ error: 'News Intelligence requires Pro or Premium plan' });
    }
    const result = await runNewsIntelligenceScanner(settings.slug);
    res.json(result);
  } catch (err) {
    console.error('[news-scan] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/creator/news-scan/status — last scan info
app.get('/api/creator/news-scan/status', requireCreator, async (req, res) => {
  try {
    const { data: settings } = await supabase.from('creator_settings')
      .select('slug, plan, news_feed_enabled, news_feed_last_scan, news_feed_categories')
      .eq('creator_id', req.creator.id)
      .maybeSingle();
    if (!settings) return res.status(404).json({ error: 'Not found' });
    res.json({
      enabled:    settings.news_feed_enabled || false,
      last_scan:  settings.news_feed_last_scan || null,
      categories: settings.news_feed_categories || 'all',
      plan:       settings.plan
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/creator/news-feed-settings — toggle auto-scan + category filter
app.put('/api/creator/news-feed-settings', requireCreator, async (req, res) => {
  try {
    const { enabled, categories } = req.body;
    const updates = {};
    if (typeof enabled === 'boolean') updates.news_feed_enabled = enabled;
    if (typeof categories === 'string') updates.news_feed_categories = categories;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const { error } = await supabase.from('creator_settings')
      .update(updates)
      .eq('creator_id', req.creator.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, ...updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/discover
// Public endpoint — returns all active communities + platform stats
// ════════════════════════════════════════════════════════════
app.get('/api/discover', async (req, res) => {
  try {
    // All active communities
    const { data: communities } = await supabase
      .from('creator_settings')
      .select('slug, display_name, logo_url, banner_url, primary_color, community_description, plan, starting_balance, custom_points_name')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (!communities || !communities.length) return res.json({ communities: [], trending: [], stats: {} });

    const slugs = communities.map(c => c.slug);

    // Member counts per community
    const { data: balanceRows } = await supabase
      .from('community_balances')
      .select('creator_slug, user_id');

    const memberCounts = {};
    (balanceRows || []).forEach(r => {
      memberCounts[r.creator_slug] = (memberCounts[r.creator_slug] || 0) + 1;
    });

    // Active market counts + top markets per community
    const { data: allMarkets } = await supabase
      .from('markets')
      .select('id, question, category, yes_price, no_price, yes_votes, no_votes, trader_count, resolved, tenant_slug, creator_id, created_at')
      .neq('is_public', false)
      .eq('resolved', false)
      .order('trader_count', { ascending: false });

    const marketsBySlug = {};
    (allMarkets || []).forEach(m => {
      const slug = m.tenant_slug || 'unknown';
      if (!marketsBySlug[slug]) marketsBySlug[slug] = [];
      marketsBySlug[slug].push(m);
    });

    // Build community cards
    const communityCards = communities.map(c => {
      const members = memberCounts[c.slug] || 0;
      const markets = marketsBySlug[c.slug] || [];
      const topMarket = markets[0] || null;
      const totalTraders = markets.reduce((s, m) => s + (m.trader_count || 0), 0);
      return {
        slug:           c.slug,
        display_name:   c.display_name,
        logo_url:       c.logo_url,
        banner_url:     c.banner_url,
        primary_color:  c.primary_color || '#c9920d',
        description:    c.community_description,
        plan:           c.plan || 'free',
        points_name:    c.custom_points_name || 'Flex Points',
        members,
        active_markets: markets.length,
        total_trades:   totalTraders,
        top_market:     topMarket ? {
          id:        topMarket.id,
          question:  topMarket.question,
          category:  topMarket.category,
          yes_price: topMarket.yes_price,
          traders:   topMarket.trader_count || 0
        } : null
      };
    }).sort((a, b) => (b.members + b.total_trades) - (a.members + a.total_trades));

    // Trending markets across all communities (most traders, active only)
    const trending = (allMarkets || [])
      .filter(m => (m.trader_count || 0) > 0)
      .slice(0, 20)
      .map(m => ({
        id:        m.id,
        question:  m.question,
        category:  m.category,
        yes_price: m.yes_price,
        no_price:  m.no_price,
        traders:   m.trader_count || 0,
        slug:      m.tenant_slug,
        community_name: communities.find(c => c.slug === m.tenant_slug)?.display_name || m.tenant_slug
      }));

    // Platform-wide stats
    const totalMembers  = Object.values(memberCounts).reduce((s, v) => s + v, 0);
    const totalMarkets  = (allMarkets || []).length;
    const totalTrades   = (allMarkets || []).reduce((s, m) => s + (m.trader_count || 0), 0);

    res.json({
      communities: communityCards,
      trending,
      stats: {
        communities: communities.length,
        members:     totalMembers,
        markets:     totalMarkets,
        trades:      totalTrades
      }
    });
  } catch (err) {
    console.error('[discover]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/creator/resolve/:marketId — creator manually resolves a market (YES/NO)
app.post('/api/creator/resolve/:marketId', requireAuth, async (req, res) => {
  const { marketId } = req.params;
  const { outcome } = req.body; // boolean: true = YES, false = NO
  if (typeof outcome !== 'boolean') return res.status(400).json({ error: 'outcome (boolean) required' });

  // Verify this market belongs to the authenticated creator
  const { data: settings } = await supabase
    .from('creator_settings')
    .select('slug')
    .eq('user_id', req.userId)
    .maybeSingle();
  if (!settings) return res.status(403).json({ error: 'Not a creator account' });

  const { data: market, error: marketErr } = await supabase
    .from('markets')
    .select('*')
    .eq('id', marketId)
    .eq('creator_slug', settings.slug)
    .maybeSingle();
  if (marketErr || !market) return res.status(404).json({ error: 'Market not found or not yours' });
  if (market.resolved) return res.status(400).json({ error: 'Market already resolved' });

  // Resolve the market
  await supabase
    .from('markets')
    .update({ resolved: true, outcome, settlement_price: null })
    .eq('id', marketId);

  // Settle all positions
  const { data: positions } = await supabase
    .from('positions')
    .select('*')
    .eq('market_id', marketId)
    .eq('settled', false);

  for (const position of (positions || [])) {
    const won = (position.side === 'YES') === outcome;
    await supabase
      .from('positions')
      .update({ settled: true, won })
      .eq('id', position.id);

    if (won) {
      // Apply streak multiplier based on streak BEFORE this settlement
      const streak = await getUserStreak(position.user_id, marketId);
      const multiplier = getStreakMultiplier(streak);
      const payout = Math.round(position.potential_payout * multiplier);
      // Credit community balance (per-community economy)
      const creatorSlug = await getCreatorSlugForMarket(market);
      if (creatorSlug) {
        const cb = await getCommunityBalance(position.user_id, creatorSlug);
        await setCommunityBalance(position.user_id, creatorSlug, cb + payout);
      } else {
        // Fallback: legacy global balance
        const { data: user } = await supabase.from('users').select('balance').eq('id', position.user_id).single();
        if (user) await supabase.from('users').update({ balance: user.balance + payout }).eq('id', position.user_id);
      }
      if (multiplier > 1) {
        console.log(`[resolve] streak bonus x${multiplier} for user ${position.user_id} (streak=${streak})`);
      }
    }
  }

  console.log(`Creator resolved market ${marketId} (${market.question}) → ${outcome ? 'YES' : 'NO'}`);
  res.json({ ok: true, market_id: marketId, outcome, positions_settled: (positions || []).length });
});

// GET /api/creator/:slug/theme — public, returns theme config for a creator subdomain
app.get('/api/creator/:slug/theme', async (req, res) => {
  const { slug } = req.params;
  const { data, error } = await supabase
    .from('creator_settings')
    .select('display_name, custom_points_name, theme_type')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Creator not found' });
  res.json({
    display_name: data.display_name,
    custom_points_name: data.custom_points_name || 'Flex Points',
    theme_type: data.theme_type || 'default',
  });
});

// ── ODDS COMPARISON ───────────────────────────────
app.get('/api/odds/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ clusters: [] });

  try {
    // Search cached_positions for matching market titles across all platforms
    const { data, error } = await supabase
      .from('cached_positions')
      .select('platform, external_id, market_title, side, probability, market_url')
      .ilike('market_title', `%${q}%`)
      .order('probability', { ascending: false })
      .limit(100);

    if (error) { console.error('[odds-search]', error); return res.json({ clusters: [] }); }
    if (!data || !data.length) return res.json({ clusters: [] });

    // Deduplicate: keep the most recent entry per platform+external_id
    const seen = new Map();
    data.forEach(row => {
      const key = `${row.platform}:${row.external_id}`;
      if (!seen.has(key)) seen.set(key, row);
    });
    const unique = [...seen.values()];

    // Cluster by keyword overlap: extract significant words, group markets sharing 2+ keywords
    function extractWords(title) {
      return title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3);
    }

    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < unique.length; i++) {
      if (assigned.has(i)) continue;
      const cluster = [unique[i]];
      assigned.add(i);
      const wordsA = extractWords(unique[i].market_title);

      for (let j = i + 1; j < unique.length; j++) {
        if (assigned.has(j)) continue;
        const wordsB = extractWords(unique[j].market_title);
        const overlap = wordsA.filter(w => wordsB.includes(w)).length;
        if (overlap >= 2) {
          cluster.push(unique[j]);
          assigned.add(j);
        }
      }

      // Pick the shortest title as the topic label
      const topic = cluster.reduce((a, b) => a.market_title.length <= b.market_title.length ? a : b).market_title;

      const mkts = cluster.map(m => ({
        platform: m.platform,
        title: m.market_title,
        probability: Math.round((m.probability || 0) * 100),
        url: m.market_url || '#',
        side: m.side || 'YES'
      }));

      // Arbitrage detection: multi-platform cluster with >5% probability spread
      const platforms = new Set(mkts.map(m => m.platform));
      const probs = mkts.map(m => m.probability);
      const spread = probs.length > 1 ? Math.max(...probs) - Math.min(...probs) : 0;
      const hasArbitrage = platforms.size >= 2 && spread > 5;

      clusters.push({
        topic,
        markets: mkts,
        arbitrage: hasArbitrage,
        spread: hasArbitrage ? spread : 0,
        platform_count: platforms.size
      });
    }

    // Sort: arbitrage opportunities first, then by platform diversity
    clusters.sort((a, b) => {
      if (a.arbitrage !== b.arbitrage) return b.arbitrage ? 1 : -1;
      if (a.arbitrage && b.arbitrage) return b.spread - a.spread;
      return b.platform_count - a.platform_count || b.markets.length - a.markets.length;
    });

    res.json({ clusters: clusters.slice(0, 20) });
  } catch (err) {
    console.error('[odds-search]', err);
    res.json({ clusters: [] });
  }
});

// ── SMART MONEY ───────────────────────────────────
app.get('/api/smart-money', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cached_positions')
      .select('market_title, side, platform')
      .order('updated_at', { ascending: false })
      .limit(500);

    if (error || !data || !data.length) return res.json({ markets: [] });

    // Group by market_title, count YES vs NO
    const grouped = {};
    data.forEach(row => {
      const key = row.market_title;
      if (!key) return;
      if (!grouped[key]) grouped[key] = { title: key, yes: 0, no: 0, total: 0, platforms: new Set() };
      if (row.side === 'YES') grouped[key].yes++;
      else grouped[key].no++;
      grouped[key].total++;
      grouped[key].platforms.add(row.platform);
    });

    // Top 10 most-traded, need at least 2 positions
    const markets = Object.values(grouped)
      .filter(m => m.total >= 2)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(m => ({
        title: m.title,
        yes_pct: Math.round((m.yes / m.total) * 100),
        no_pct: Math.round((m.no / m.total) * 100),
        total: m.total,
        platforms: [...m.platforms]
      }));

    res.json({ markets });
  } catch (err) {
    console.error('[smart-money]', err);
    res.json({ markets: [] });
  }
});

// ── TEMPLATES ─────────────────────────────────────

const TEMPLATES = {
  sports: {
    name: 'Sports',
    emoji: '🏆',
    description: 'Game outcomes, player props, fantasy, and betting-style predictions. NFL, NBA, Premier League, F1, UFC, March Madness.',
    category: 'sports',
    markets: [
      { question: 'Will the home team win tonight\'s game?', category: 'sports', days: 1 },
      { question: 'Will there be overtime in the next playoff game?', category: 'sports', days: 7 },
      { question: 'Will the leading scorer finish the season above 30 PPG?', category: 'sports', days: 60 },
      { question: 'Will the #1 seed make the finals?', category: 'sports', days: 45 },
      { question: 'Will any underdog (ranked 5+) win the championship?', category: 'sports', days: 60 },
      { question: 'Will a player get traded before the trade deadline?', category: 'sports', days: 30 },
      { question: 'Will the NFL MVP finish with 40+ passing TDs this season?', category: 'sports', days: 90 },
      { question: 'Will any NBA player score 50+ fantasy points in tonight\'s slate?', category: 'sports', days: 1 },
      { question: 'Will the Premier League top scorer have 25+ goals by season end?', category: 'sports', days: 120 },
      { question: 'Will Max Verstappen win the next F1 Grand Prix?', category: 'sports', days: 14 },
      { question: 'Will the UFC main event go the full distance (decision)?', category: 'sports', days: 7 },
      { question: 'Will a #16 seed beat a #1 seed in March Madness this year?', category: 'sports', days: 30 },
    ],
  },
  crypto: {
    name: 'Crypto',
    emoji: '₿',
    description: 'Price targets, protocol upgrades, and macro crypto events. Perfect for CT communities.',
    category: 'crypto',
    markets: [
      { question: 'Will Bitcoin exceed $100,000 this month?', category: 'crypto', days: 30 },
      { question: 'Will Ethereum stay above $3,000 this week?', category: 'crypto', days: 7 },
      { question: 'Will a new country announce Bitcoin as legal tender?', category: 'crypto', days: 90 },
      { question: 'Will BTC dominance exceed 60% this month?', category: 'crypto', days: 30 },
      { question: 'Will any altcoin in the top 10 flip ETH by market cap?', category: 'crypto', days: 60 },
      { question: 'Will the next Ethereum upgrade ship on schedule?', category: 'crypto', days: 45 },
    ],
  },
  podcast: {
    name: 'Podcast',
    emoji: '🎙️',
    description: 'Guest predictions, episode milestones, and show announcements for podcast communities.',
    category: 'entertainment',
    markets: [
      { question: 'Will next week\'s episode crack the top 10 on Spotify?', category: 'entertainment', days: 14 },
      { question: 'Will the host interview a sitting politician this month?', category: 'entertainment', days: 30 },
      { question: 'Will the next guest be someone who\'s never been on before?', category: 'entertainment', days: 7 },
      { question: 'Will the show cross 1M monthly downloads this quarter?', category: 'entertainment', days: 90 },
      { question: 'Will there be a live show or tour announcement this month?', category: 'entertainment', days: 30 },
      { question: 'Will the host bring on a co-host for more than 3 episodes?', category: 'entertainment', days: 60 },
    ],
  },
  finance: {
    name: 'Finance & Markets',
    emoji: '📈',
    description: 'Macro calls, Fed decisions, and market predictions for investing and finance communities.',
    category: 'macro',
    markets: [
      { question: 'Will the Fed cut rates at the next FOMC meeting?', category: 'macro', days: 45 },
      { question: 'Will the S&P 500 close above 5,500 this month?', category: 'macro', days: 30 },
      { question: 'Will US CPI come in below 3% this quarter?', category: 'macro', days: 60 },
      { question: 'Will gold exceed $3,000/oz before year-end?', category: 'commodities', days: 60 },
      { question: 'Will any Magnificent 7 stock drop 20%+ from its 52-week high?', category: 'earnings', days: 90 },
      { question: 'Will the US dollar index (DXY) break below 100 this quarter?', category: 'macro', days: 60 },
    ],
  },
  entertainment: {
    name: 'Entertainment',
    emoji: '🎬',
    description: 'Box office, awards, streaming cancellations, and pop culture moments.',
    category: 'entertainment',
    markets: [
      { question: 'Will this weekend\'s #1 movie gross over $50M domestically?', category: 'entertainment', days: 7 },
      { question: 'Will the Best Picture winner be a sequel or franchise film?', category: 'entertainment', days: 60 },
      { question: 'Will a major streaming show be renewed or cancelled this month?', category: 'entertainment', days: 30 },
      { question: 'Will a music artist announce a world tour this quarter?', category: 'entertainment', days: 90 },
      { question: 'Will a video game release this month score 90+ on Metacritic?', category: 'entertainment', days: 45 },
      { question: 'Will a celebrity couple announce a split before the end of the month?', category: 'entertainment', days: 30 },
    ],
  },
  youtube: {
    name: 'YouTube Creator',
    emoji: '▶️',
    description: 'Subscriber milestones, upload schedules, and channel events. Built for YouTubers.',
    category: 'entertainment',
    markets: [
      { question: 'Will I hit 100K subscribers by the end of this month?', category: 'entertainment', days: 30 },
      { question: 'Will my next video get more views than my last one?', category: 'entertainment', days: 14 },
      { question: 'Will I post a video this week?', category: 'entertainment', days: 7 },
      { question: 'Will I collab with another creator in the next 30 days?', category: 'entertainment', days: 30 },
      { question: 'Will my next video cross 1M views within 7 days of upload?', category: 'entertainment', days: 21 },
      { question: 'Will I start a new series or content format this month?', category: 'entertainment', days: 30 },
    ],
  },
  tech: {
    name: 'Tech & Startups',
    emoji: '🚀',
    description: 'Product launches, funding rounds, and industry calls for tech-focused communities.',
    category: 'tech',
    markets: [
      { question: 'Will Apple announce a new product at the next event?', category: 'tech', days: 45 },
      { question: 'Will OpenAI release a new frontier model before June?', category: 'tech', days: 90 },
      { question: 'Will a major tech company announce layoffs this quarter?', category: 'tech', days: 60 },
      { question: 'Will any unicorn IPO before the end of this year?', category: 'tech', days: 90 },
      { question: 'Will a new AI coding tool overtake Copilot on GitHub?', category: 'tech', days: 90 },
      { question: 'Will a major acquisition (>$1B) be announced in tech this month?', category: 'tech', days: 30 },
    ],
  },
  gaming: {
    name: 'Gaming',
    emoji: '🎮',
    description: 'Game releases, esports results, and gaming industry predictions for gaming communities.',
    category: 'entertainment',
    markets: [
      { question: 'Will the next major game release hit 1M players in its first week?', category: 'entertainment', days: 30 },
      { question: 'Will this game get a balance patch before the end of the month?', category: 'entertainment', days: 30 },
      { question: 'Will [Team] win the next major esports tournament?', category: 'entertainment', days: 21 },
      { question: 'Will GTA VI release this year?', category: 'entertainment', days: 90 },
      { question: 'Will a popular streamer switch their main game this month?', category: 'entertainment', days: 30 },
      { question: 'Will any game pass 100K concurrent Steam players this week?', category: 'entertainment', days: 7 },
    ],
  },
  fitness: {
    name: 'Fitness & Health',
    emoji: '💪',
    description: 'Personal challenges, athlete performance, and wellness goals for fitness communities.',
    category: 'entertainment',
    markets: [
      { question: 'Will I hit my PR on the squat / bench / deadlift this month?', category: 'entertainment', days: 30 },
      { question: 'Will the creator finish a marathon or race they\'ve entered?', category: 'entertainment', days: 60 },
      { question: 'Will a major supplement brand be exposed for false claims?', category: 'entertainment', days: 45 },
      { question: 'Will a popular fitness influencer announce a new program or course?', category: 'entertainment', days: 30 },
      { question: 'Will I train 5+ days this week?', category: 'entertainment', days: 7 },
      { question: 'Will this athlete compete again within 3 months after injury?', category: 'entertainment', days: 90 },
    ],
  },
  music: {
    name: 'Music',
    emoji: '🎵',
    description: 'Album drops, chart positions, and music industry moments for music-focused communities.',
    category: 'entertainment',
    markets: [
      { question: 'Will the new album debut at #1 on the Billboard 200?', category: 'entertainment', days: 14 },
      { question: 'Will this artist release new music before the end of the month?', category: 'entertainment', days: 30 },
      { question: 'Will the song cross 1B streams on Spotify before year-end?', category: 'entertainment', days: 90 },
      { question: 'Will the artist win Artist of the Year at the next awards show?', category: 'entertainment', days: 60 },
      { question: 'Will the artist add more tour dates after the initial announcement?', category: 'entertainment', days: 30 },
      { question: 'Will a beef between two artists result in diss tracks this month?', category: 'entertainment', days: 30 },
    ],
  },
  newsletter: {
    name: 'Newsletter / Substack',
    emoji: '✉️',
    description: 'Subscriber growth, content predictions, and niche topic calls for newsletter creators.',
    category: 'entertainment',
    markets: [
      { question: 'Will the newsletter hit its next subscriber milestone this month?', category: 'entertainment', days: 30 },
      { question: 'Will the next edition get a 50%+ open rate?', category: 'entertainment', days: 14 },
      { question: 'Will the creator launch a paid tier or cohort program?', category: 'entertainment', days: 45 },
      { question: 'Will the newsletter publish a piece that goes viral (50K+ views)?', category: 'entertainment', days: 30 },
      { question: 'Will the creator be featured in another major publication?', category: 'entertainment', days: 60 },
      { question: 'Will there be a guest writer edition this month?', category: 'entertainment', days: 30 },
    ],
  },
  politics: {
    name: 'Politics & Policy',
    emoji: '🏛️',
    description: 'Election outcomes, policy decisions, and geopolitical events. For civics communities.',
    category: 'macro',
    markets: [
      { question: 'Will the bill pass the Senate before the recess?', category: 'macro', days: 45 },
      { question: 'Will the approval rating for the current administration rise this month?', category: 'macro', days: 30 },
      { question: 'Will there be a snap election announced in the next 90 days?', category: 'macro', days: 90 },
      { question: 'Will a trade deal be announced between two major economies?', category: 'macro', days: 60 },
      { question: 'Will the primary polling leader win their state\'s primary?', category: 'macro', days: 30 },
      { question: 'Will a sitting official resign or step down this month?', category: 'macro', days: 30 },
    ],
  },
};

// GET /api/templates/:id — return pre-seeded market questions for a template
app.get('/api/templates/:id', (req, res) => {
  const tpl = TEMPLATES[req.params.id];
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  const today = new Date();
  const markets = tpl.markets.map(m => {
    const expiry = new Date(today);
    expiry.setDate(expiry.getDate() + m.days);
    return {
      question: m.question,
      category: m.category,
      commodity: m.category,
      target_price: m.target_price,
      direction: m.direction,
      expiry_date: expiry.toISOString().split('T')[0],
    };
  });
  res.json({ id: req.params.id, name: tpl.name, markets });
});

// ── START ─────────────────────────────────────────
// ============================================================
// HYPERFLEX — Creator Platform Routes
// Drop this entire block into server.js BEFORE your 404 handler
// Requires: bcrypt, jsonwebtoken (already in package.json likely)
// Run: npm install bcrypt jsonwebtoken
// ============================================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// ── CPMM: initial liquidity seed per side (centpoints) ─────────────────────
// 5000 centpoints = 50 pts per side → starting price = 0.5 (50/50)
// Dampens single-bet manipulation while still allowing prices to move meaningfully.
const MARKET_SEED = 5000;

const PROHIBITED_PATTERNS = [
  { re: /\b(assassinat\w*|kill\s+(?:the\s+)?(?:president|prime\s+minister|senator|official|leader)|murder\s+(?:the\s+)?(?:president|pm))\b/i,
    msg: 'Markets about assassination or targeted killing of individuals are not permitted.' },
  { re: /\b(drug\s+traffick\w*|money\s+laundering|human\s+traffick\w*|child\s+(?:abuse|exploit\w*)|terrorist\s+attack|bomb\s+(?:a|the)\s+\w+)\b/i,
    msg: 'Markets about illegal activities are not permitted.' },
  { re: /\b(insider\s+trad\w*|market\s+manipulat\w*)\b/i,
    msg: 'Markets about illegal financial activities are not permitted.' },
];

// ─── MIDDLEWARE: Auth guard ──────────────────────────────────
function requireCreator(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.creator = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── HELPER: Generate JWT ────────────────────────────────────
function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, slug: user.slug, is_creator: true },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ════════════════════════════════════════════════════════════
// 1. CHECK SLUG AVAILABILITY
// GET /api/creator/check-slug?slug=gridiron-picks
// ════════════════════════════════════════════════════════════
app.get('/api/creator/check-slug', async (req, res) => {
  try {
    const { slug } = req.query;
    if (!slug || !/^[a-z0-9-]{3,30}$/.test(slug)) {
      return res.json({ available: false, reason: 'Invalid slug format' });
    }

    // Reserved slugs
    const reserved = ['admin', 'api', 'app', 'www', 'creator', 'dashboard',
      'login', 'signup', 'markets', 'leaderboard', 'hyperflex', 'support', 'help'];
    if (reserved.includes(slug)) {
      return res.json({ available: false, reason: 'Reserved slug' });
    }

    const { data } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();

    res.json({ available: !data });
  } catch (err) {
    console.error('check-slug error:', err);
    res.status(500).json({ available: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 2. CREATOR SIGNUP
// POST /api/creator/signup
// Body: { display_name, email, password, slug, custom_points_name,
//         primary_color, community_description, selected_markets[] }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/signup', async (req, res) => {
  try {
    const {
      display_name, email, password, slug,
      custom_points_name = 'Flex Points',
      primary_color = '#c9920d',
      community_description = '',
      selected_markets = [],
      referred_by = null,   // creator slug of referrer (from ?ref= param)
    } = req.body;

    // Validate required fields
    if (!display_name || !email || !password || !slug) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password too short' });
    }
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    // Check slug not taken
    const { data: existing } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'Slug already taken' });
    }

    // Check email not taken
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Create user
    const { data: newUser, error: userErr } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase(),
        password_hash,
        display_name,
        is_creator: true,
        tenant_slug: slug,
        balance: 1000 * 100 // $1,000 starting balance in cents
      })
      .select()
      .single();

    if (userErr) throw userErr;

    // Create creator settings
    const { error: settingsErr } = await supabase
      .from('creator_settings')
      .insert({
        creator_id: newUser.id,
        slug,
        display_name,
        custom_points_name,
        primary_color,
        community_description,
        is_active: true,
        plan: 'free',
        created_at: new Date().toISOString()
      });

    if (settingsErr) {
      // Roll back the created user so we don't leave an orphaned record
      await supabase.from('users').delete().eq('id', newUser.id);
      throw settingsErr;
    }

    // Publish selected AI-suggested markets
    if (selected_markets.length > 0) {
      const marketsToInsert = selected_markets.map(m => ({
        question: m.question,
        category: m.category || 'other',
        commodity: m.category || 'other',
        target_price: 0,
        direction: 'above',
        expiry_date: m.resolution_date || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        creator_id: newUser.id,
        tenant_slug: slug,
        is_public: true,
        yes_price: 0.50,
        no_price: 0.50,
        yes_pool: MARKET_SEED,
        no_pool: MARKET_SEED,
        resolved: false,
        created_at: new Date().toISOString()
      }));

      const { data: insertedMkts, error: marketsErr } = await supabase
        .from('markets')
        .insert(marketsToInsert)
        .select('id, question, category');

      if (marketsErr) console.error('Markets insert error:', marketsErr);

      // Score resonance for each market async
      if (insertedMkts?.length) {
        insertedMkts.forEach(m => {
          scoreMarketResonance(m.question, m.category).then(score => {
            if (score) supabase.from('markets').update({ resonance_score: score }).eq('id', m.id).then(() => {});
          });
        });
      }
    }

    // Generate token
    const token = makeToken({ id: newUser.id, email: newUser.email, slug });

    // ── Onboarding email sequence — queued in DB, survives server restarts ──
    const communityUrl = `https://hyperflex.network/${slug}`;
    const dashUrl = 'https://hyperflex.network/creator/dashboard';
    const emailName = display_name || slug;
    const now = Date.now();

    supabase.from('pending_emails').insert([
      {
        to_email: newUser.email,
        subject: `Your HYPERFLEX community is live — ${communityUrl}`,
        send_after: new Date(now + 30 * 1000).toISOString(),
        html: `<div style="background:#141412;padding:40px;font-family:'Courier New',monospace;color:#ddd8cc;max-width:560px;margin:0 auto;border-radius:12px;"><div style="font-size:22px;font-weight:800;color:#c9920d;margin-bottom:24px;">HYPERFLEX</div><h2 style="font-size:20px;color:#f5f5f0;margin:0 0 16px;">You're live, ${emailName} 🎉</h2><p style="color:#aaa8a0;font-size:14px;line-height:1.6;margin:0 0 20px;">Your prediction market community is ready. Share this link with your audience and watch them start betting.</p><div style="background:#1c1c19;border:1px solid #2a2a27;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;"><a href="${communityUrl}" style="color:#c9920d;font-size:16px;font-weight:700;text-decoration:none;">${communityUrl}</a></div><p style="color:#aaa8a0;font-size:13px;line-height:1.6;margin:0 0 20px;"><strong style="color:#ddd8cc;">Quick start:</strong><br/>1. Create 3-5 markets around topics your audience debates<br/>2. Share the link in your next video, post, or story<br/>3. Watch your community compete on the leaderboard</p><a href="${dashUrl}" style="display:inline-block;background:#c9920d;color:#141412;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px;text-decoration:none;">Go to your dashboard →</a><p style="color:#555;font-size:11px;margin:24px 0 0;">HYPERFLEX · hyperflex.network</p></div>`
      },
      {
        to_email: newUser.email,
        subject: 'Quick tip: how to get your first 50 community bettors',
        send_after: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
        html: `<div style="background:#141412;padding:40px;font-family:'Courier New',monospace;color:#ddd8cc;max-width:560px;margin:0 auto;border-radius:12px;"><div style="font-size:22px;font-weight:800;color:#c9920d;margin-bottom:24px;">HYPERFLEX</div><h2 style="font-size:20px;color:#f5f5f0;margin:0 0 16px;">Getting your first bettors 🎯</h2><p style="color:#aaa8a0;font-size:14px;line-height:1.6;margin:0 0 20px;">The fastest way to activate your community is to mention your markets during your normal content — not as a separate promotion, just a natural callout.</p><div style="background:#1c1c19;border:1px solid #2a2a27;border-radius:8px;padding:16px;margin-bottom:24px;"><p style="font-size:13px;color:#ddd8cc;margin:0 0 12px;font-style:italic;">"I've got a prediction market open on this — go bet on what you think will happen at ${communityUrl}"</p><p style="font-size:12px;color:#888880;margin:0;">Drop this line once in your next post or video.</p></div><p style="color:#aaa8a0;font-size:13px;line-height:1.6;margin:0 0 20px;">Also — if you're on the free plan and want to try unlimited markets + the YouTube AI scanner, start a free 7-day Pro trial from your dashboard.</p><a href="${dashUrl}" style="display:inline-block;background:#c9920d;color:#141412;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px;text-decoration:none;">Go to your dashboard →</a><p style="color:#555;font-size:11px;margin:24px 0 0;">HYPERFLEX · hyperflex.network</p></div>`
      },
      {
        to_email: newUser.email,
        subject: 'Unlock unlimited markets + AI scanner — $29/mo',
        send_after: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
        html: `<div style="background:#141412;padding:40px;font-family:'Courier New',monospace;color:#ddd8cc;max-width:560px;margin:0 auto;border-radius:12px;"><div style="font-size:22px;font-weight:800;color:#c9920d;margin-bottom:24px;">HYPERFLEX</div><h2 style="font-size:20px;color:#f5f5f0;margin:0 0 16px;">Ready to go further?</h2><p style="color:#aaa8a0;font-size:14px;line-height:1.6;margin:0 0 20px;">You've been running your community for a week. Here's what Pro unlocks for $29/mo:</p><div style="background:#1c1c19;border:1px solid #2a2a27;border-radius:8px;padding:20px;margin-bottom:24px;"><div style="font-size:13px;color:#ddd8cc;margin-bottom:10px;">⚡ <strong>Unlimited active markets</strong></div><div style="font-size:13px;color:#ddd8cc;margin-bottom:10px;">🎥 <strong>YouTube AI scanner</strong> — paste any video URL, get markets instantly</div><div style="font-size:13px;color:#ddd8cc;margin-bottom:10px;">📊 <strong>Full analytics</strong> — trade volume, top markets, economy health</div><div style="font-size:13px;color:#ddd8cc;">🏆 <strong>Weekly Power Predictor</strong> — surface your top weekly winners</div></div><a href="${dashUrl}" style="display:inline-block;background:#c9920d;color:#141412;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px;text-decoration:none;margin-bottom:16px;">Upgrade to Pro — $29/mo →</a><p style="color:#888880;font-size:13px;margin:0;">Cancel anytime. No lock-in.</p><p style="color:#555;font-size:11px;margin:24px 0 0;">HYPERFLEX · hyperflex.network</p></div>`
      }
    ]).then(({ error }) => {
      if (error) console.error('[onboarding-email] queue error:', error.message);
    });

    // Mark any matching outreach invite as accepted (fire-and-forget)
    if (email) {
      supabase.from('creator_invites')
        .update({ accepted: true, accepted_at: new Date().toISOString() })
        .eq('email', email.toLowerCase())
        .eq('accepted', false)
        .then(() => {})
        .catch(() => {});
    }

    // Record creator referral if signup came via a /ref/:slug link
    if (referred_by && referred_by !== slug) {
      supabase.from('creator_referrals')
        .insert([{ referrer_slug: referred_by, new_creator_slug: slug, accepted: false }])
        .then(() => {})
        .catch(() => {});
    }

    // Schedule a drop-off nudge: if creator has no public markets 2h after signup, send them an email
    const signupEmail = newUser.email;
    const signupSlug  = slug;
    if (signupEmail) {
      setTimeout(() => maybeFireSignupDropoffEmail(signupSlug, signupEmail).catch(() => {}), 2 * 60 * 60 * 1000);
    }

    res.json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        display_name: newUser.display_name,
        slug,
        custom_points_name,
        primary_color
      }
    });

  } catch (err) {
    console.error('creator signup error:', err);
    res.status(500).json({
      error: err.message || 'Signup failed',
      details: err.details || undefined,
      hint: err.hint || undefined
    });
  }
});

// ════════════════════════════════════════════════════════════
// 3. CREATOR LOGIN
// POST /api/creator/login
// Body: { email, password }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('is_creator', true)
      .maybeSingle();

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const { data: settings } = await supabase
      .from('creator_settings')
      .select('*')
      .eq('creator_id', user.id)
      .maybeSingle();

    const token = makeToken({ id: user.id, email: user.email, slug: settings?.slug });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        slug: settings?.slug,
        custom_points_name: settings?.custom_points_name,
        primary_color: settings?.primary_color
      }
    });

  } catch (err) {
    console.error('creator login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// LEADERBOARD WITH PERIOD FILTER
// GET /api/creator/leaderboard?period=all_time|monthly|weekly
// Auth: Bearer token required
// ════════════════════════════════════════════════════════════
app.get('/api/creator/leaderboard', requireCreator, async (req, res) => {
  try {
    const creatorId = req.creator.id;
    const period = req.query.period || 'all_time'; // all_time | monthly | weekly

    // Get this creator's market IDs
    const { data: markets } = await supabase
      .from('markets')
      .select('id')
      .eq('creator_id', creatorId);

    if (!markets || markets.length === 0) return res.json({ leaderboard: [] });
    const marketIds = markets.map(m => m.id);

    // Build date filter
    let since = null;
    if (period === 'weekly') {
      since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (period === 'monthly') {
      since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    // Fetch positions (filtered by period if applicable)
    let query = supabase
      .from('positions')
      .select('user_id, amount, won, settled')
      .in('market_id', marketIds);
    if (since) query = query.gte('created_at', since);
    const { data: positions } = await query;

    if (!positions || positions.length === 0) return res.json({ leaderboard: [] });

    // Aggregate per user
    const userMap = {};
    positions.forEach(p => {
      if (!userMap[p.user_id]) userMap[p.user_id] = { trade_count: 0, pnl: 0 };
      userMap[p.user_id].trade_count++;
      // For weekly/monthly: PnL = sum of won payouts - sum of amounts spent
      if (p.settled) {
        userMap[p.user_id].pnl += p.won ? (p.amount * 2) : -p.amount;
      }
    });

    const userIds = Object.keys(userMap);
    const { data: users } = await supabase
      .from('users')
      .select('id, display_name, balance')
      .in('id', userIds);

    const leaderboard = (users || [])
      .map(u => ({
        user_id: u.id,
        display_name: u.display_name || 'Anonymous',
        balance: u.balance || 0,
        // For all_time use balance; for period windows use calculated pnl
        pnl: period === 'all_time' ? (u.balance || 0) : (userMap[u.id]?.pnl || 0),
        trade_count: userMap[u.id]?.trade_count || 0
      }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 20);

    res.json({ leaderboard, period });

  } catch (err) {
    console.error('creator leaderboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 4. CREATOR DASHBOARD DATA
// GET /api/creator/dashboard
// Auth: Bearer token required
// ════════════════════════════════════════════════════════════
app.get('/api/creator/dashboard', requireCreator, async (req, res) => {
  try {
    const creatorId = req.creator.id;

    // Get creator settings
    const { data: settings, error: settingsErr } = await supabase
      .from('creator_settings')
      .select('*')
      .eq('creator_id', creatorId)
      .single();

    if (settingsErr || !settings) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    // Get creator's markets — match by creator_id OR tenant_slug to catch all creation paths
    const { data: markets } = await supabase
      .from('markets')
      .select('*')
      .or(`creator_id.eq.${creatorId},tenant_slug.eq.${settings.slug}`)
      .order('created_at', { ascending: false });

    // Get creator's display name from users
    const { data: creatorUser } = await supabase
      .from('users')
      .select('display_name, email')
      .eq('id', creatorId)
      .maybeSingle();

    // Build stats
    const liveMarkets = (markets || []).filter(m => !m.resolved && new Date(m.expiry_date) >= new Date());
    const totalVolume = (markets || []).reduce((sum, m) => sum + (m.volume || 0), 0);

    // Get unique traders across all creator's markets
    const marketIds = (markets || []).map(m => m.id);
    let totalTraders = 0;
    let weeklyTrades = 0;

    if (marketIds.length > 0) {
      const { data: traderRows } = await supabase
        .from('positions')
        .select('user_id')
        .in('market_id', marketIds);

      totalTraders = new Set((traderRows || []).map(r => r.user_id)).size;

      const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { count: weekCount } = await supabase
        .from('positions')
        .select('id', { count: 'exact', head: true })
        .in('market_id', marketIds)
        .gte('created_at', oneWeekAgo);

      weeklyTrades = weekCount || 0;
    }

    const plan = settings.plan || 'free';
    const isPro = plan === 'pro' || plan === 'platinum';
    const isPremium = plan === 'platinum';

    // Get community leaderboard — distinct traders by current balance, with streak badges
    let leaderboard = [];
    let power_predictor = null;   // Pro/Premium: top 3 weekly winners
    let inner_circle = null;      // Premium: members with 2,000+ Flex Points (balance ≥ 200,000)

    if (marketIds.length > 0) {
      const { data: positions } = await supabase
        .from('positions')
        .select('user_id')
        .in('market_id', marketIds);

      if (positions && positions.length > 0) {
        const userIds = [...new Set(positions.map(p => p.user_id))];

        // Count trades per user
        const tradeCountMap = {};
        positions.forEach(p => { tradeCountMap[p.user_id] = (tradeCountMap[p.user_id] || 0) + 1; });

        // Batch-compute streaks for all traders in this community
        const streakMap = await getStreakMap(userIds, marketIds);

        const { data: traders } = await supabase
          .from('users')
          .select('id, display_name, balance')
          .in('id', userIds);

        // Fetch community balances for this creator's community
        const { data: communityBalRows } = await supabase
          .from('community_balances')
          .select('user_id, balance')
          .eq('creator_slug', settings.slug)
          .in('user_id', userIds);

        const communityBalMap = {};
        (communityBalRows || []).forEach(r => { communityBalMap[r.user_id] = r.balance; });

        leaderboard = (traders || [])
          .map(u => {
            // Prefer community balance; fall back to starting_balance if not yet set
            const commBal = communityBalMap[u.id] ?? (settings.starting_balance ?? 100000);
            return {
              user_id: u.id,
              display_name: u.display_name || 'Anonymous',
              balance: commBal,
              pnl: commBal,   // frontend uses pnl field for display
              trade_count: tradeCountMap[u.id] || 0,
              streak: streakMap[u.id] || 0
            };
          })
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 20);

        // ── Power Predictor (Pro/Premium): top 3 members by wins in the last 7 days ──
        if (isPro) {
          const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
          const { data: weeklyWins } = await supabase
            .from('positions')
            .select('user_id, won')
            .in('market_id', marketIds)
            .eq('settled', true)
            .eq('won', true)
            .gte('created_at', oneWeekAgo);

          if (weeklyWins && weeklyWins.length > 0) {
            const winCountMap = {};
            weeklyWins.forEach(p => { winCountMap[p.user_id] = (winCountMap[p.user_id] || 0) + 1; });

            // Get display names for top 3 by win count
            const topIds = Object.entries(winCountMap)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([uid]) => uid);

            const { data: topUsers } = await supabase
              .from('users')
              .select('id, display_name')
              .in('id', topIds);

            power_predictor = topIds.map((uid, rank) => {
              const u = (topUsers || []).find(u => u.id === uid);
              return {
                rank: rank + 1,
                user_id: uid,
                display_name: u?.display_name || 'Anonymous',
                wins_this_week: winCountMap[uid]
              };
            });
          } else {
            power_predictor = [];
          }
        }

        // ── Inner Circle (Premium): members with 2,000+ Flex Points (community balance ≥ 200,000 centpoints) ──
        if (isPremium) {
          const INNER_CIRCLE_THRESHOLD = 200000; // 2,000 pts in centpoints
          inner_circle = (traders || [])
            .map(u => {
              const commBal = communityBalMap[u.id] ?? (settings.starting_balance ?? 100000);
              return { user_id: u.id, display_name: u.display_name || 'Anonymous', balance: commBal, points: Math.floor(commBal / 100) };
            })
            .filter(u => u.balance >= INNER_CIRCLE_THRESHOLD)
            .sort((a, b) => b.balance - a.balance);
        }
      }
    }

    res.json({
      creator: {
        id: creatorId,
        display_name: creatorUser?.display_name || settings.display_name,
        email: creatorUser?.email,
        slug: settings.slug,
        custom_points_name: settings.custom_points_name,
        primary_color: settings.primary_color,
        plan: settings.plan || 'free',
        // Economy fields
        starting_balance: settings.starting_balance ?? 100000,
        min_bet: settings.min_bet ?? 1000,
        max_bet: settings.max_bet ?? null,
        // Refill fields
        refill_enabled: settings.refill_enabled ?? false,
        refill_amount: settings.refill_amount ?? 10000,
        refill_cadence: settings.refill_cadence ?? 'weekly',
        activity_gate: settings.activity_gate ?? 5,
        // Referral fields
        referral_reward: settings.referral_reward ?? 10000,
        welcome_bonus:   settings.welcome_bonus   ?? 5000,
        // Branding fields
        logo_url:            settings.logo_url   || null,
        banner_url:          settings.banner_url || null,
        font_choice:         settings.font_choice || 'Syne',
        social_twitter:      settings.social_twitter  || null,
        social_youtube:      settings.social_youtube  || null,
        social_discord:      settings.social_discord  || null,
        social_twitch:       settings.social_twitch   || null,
        community_description: settings.community_description || null,
        community_category:    settings.community_category   || 'other',
        banner_position:       settings.banner_position      || '50% 50%',
        // Community challenge fields
        challenge_title:      settings.challenge_title      || null,
        challenge_metric:     settings.challenge_metric     || null,
        challenge_target:     settings.challenge_target     || null,
        challenge_bonus_pts:  settings.challenge_bonus_pts  || 0,
        challenge_end_date:   settings.challenge_end_date   || null,
        // Feature flags
        suggestions_enabled:  settings.suggestions_enabled  || false,
        // Plan trial
        plan_trial_expires_at: settings.plan_trial_expires_at || null,
        plan_scheduled_change: settings.plan_scheduled_change || null,
        plan_change_date:      settings.plan_change_date      || null
      },
      stats: {
        total_traders: totalTraders,
        live_markets: liveMarkets.length,
        total_volume: totalVolume,
        weekly_trades: weeklyTrades,
        total_markets: (markets || []).length,
        resolved_markets: (markets || []).filter(m => m.resolved).length
      },
      markets: markets || [],
      leaderboard,
      power_predictor,
      inner_circle,
      rewards: await supabase
        .from('creator_rewards')
        .select('id, threshold, title, description')
        .eq('creator_id', creatorId)
        .order('threshold', { ascending: true })
        .then(r => r.data || []),
      challenge_progress: await getChallengeProgress(settings)
    });

  } catch (err) {
    console.error('dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 5b. ANALYTICS
// ════════════════════════════════════════════════════════════
// GET /api/creator/members
// Returns full member roster with per-member stats for the Members tab
// ════════════════════════════════════════════════════════════
app.get('/api/creator/members', requireCreator, async (req, res) => {
  try {
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('slug, plan, custom_points_name')
      .eq('creator_id', req.creator.id)
      .single();
    const slug    = settings?.slug;
    const plan    = settings?.plan || 'free';
    const ptsName = settings?.custom_points_name || 'Flex Points';
    if (!slug) return res.status(404).json({ error: 'Creator not found' });

    // All members + their balances
    const { data: balances } = await supabase
      .from('community_balances')
      .select('user_id, balance, created_at')
      .eq('creator_slug', slug)
      .order('created_at', { ascending: false });

    if (!balances?.length) return res.json({ members: [], summary: { total: 0, active: 0, total_predictions: 0, engagement_rate: 0 }, pts_name: ptsName, plan });

    const userIds = balances.map(b => b.user_id);

    // Fetch user display names + emails in parallel with position stats
    const [usersRes, positionsRes] = await Promise.all([
      supabase.from('users').select('id, display_name, email, created_at').in('id', userIds),
      supabase.from('positions')
        .select('user_id, market_id, won, settled, created_at')
        .in('user_id', userIds)
        .eq('markets.tenant_slug', slug)  // best-effort filter
        .order('created_at', { ascending: false }),
    ]);

    // Also get all market IDs for this community to filter positions correctly
    const { data: mktRows } = await supabase
      .from('markets')
      .select('id')
      .eq('tenant_slug', slug);
    const communityMarketIds = new Set((mktRows || []).map(m => m.id));

    const userMap   = Object.fromEntries((usersRes.data || []).map(u => [u.id, u]));
    const posMap    = {};  // userId → { total, wins, last_active }
    for (const p of (positionsRes.data || [])) {
      if (!communityMarketIds.has(p.market_id)) continue;
      if (!posMap[p.user_id]) posMap[p.user_id] = { total: 0, wins: 0, last_active: null };
      posMap[p.user_id].total++;
      if (p.won && p.settled) posMap[p.user_id].wins++;
      if (!posMap[p.user_id].last_active || p.created_at > posMap[p.user_id].last_active) {
        posMap[p.user_id].last_active = p.created_at;
      }
    }

    const members = balances.map(b => {
      const user  = userMap[b.user_id] || {};
      const stats = posMap[b.user_id]  || { total: 0, wins: 0, last_active: null };
      return {
        user_id:      b.user_id,
        display_name: user.display_name || 'Anonymous',
        email:        plan !== 'free' ? (user.email || null) : null, // emails gated to Pro+
        joined_at:    b.created_at,
        balance:      b.balance || 0,         // centpoints
        total_bets:   stats.total,
        wins:         stats.wins,
        win_rate:     stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : null,
        last_active:  stats.last_active,
      };
    });

    // Summary stats
    const totalPredictions = members.reduce((s, m) => s + m.total_bets, 0);
    const activeMembers    = members.filter(m => m.total_bets > 0).length;
    const engagementRate   = members.length > 0 ? Math.round((activeMembers / members.length) * 100) : 0;
    // ROI equivalent: each prediction = ~1 engaged action at industry avg $0.80 CPC
    const engagementValue  = Math.round(totalPredictions * 0.8);

    res.json({
      members,
      pts_name: ptsName,
      plan,
      summary: {
        total:             members.length,
        active:            activeMembers,
        total_predictions: totalPredictions,
        engagement_rate:   engagementRate,
        engagement_value:  engagementValue,   // estimated $ equivalent
        new_this_week:     members.filter(m => {
          const d = new Date(m.joined_at);
          return d >= new Date(Date.now() - 7 * 864e5);
        }).length,
      },
    });
  } catch (err) {
    console.error('[members]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/creator/analytics
// Auth: Bearer token required
// Returns rich analytics data for the analytics dashboard
// ════════════════════════════════════════════════════════════
app.get('/api/creator/analytics', requireCreator, async (req, res) => {
  try {
    const creatorId = req.creator.id;

    // Get creator slug
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('slug, plan, starting_balance')
      .eq('creator_id', creatorId)
      .single();
    const slug = settings?.slug;
    const plan = settings?.plan || 'free';

    // Get all markets for this creator
    const { data: markets, error: marketsErr } = await supabase
      .from('markets')
      .select('id, question, trader_count, volume, resolved, archived, created_at, yes_price')
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false });
    if (marketsErr) console.error('[analytics] markets query error:', marketsErr.message, marketsErr.details);

    const allMarkets = markets || [];
    const activeMarkets   = allMarkets.filter(m => !m.resolved && !m.archived);
    const resolvedMarkets = allMarkets.filter(m => m.resolved);
    const archivedMarkets = allMarkets.filter(m => m.archived && !m.resolved);

    // Top markets by trader count
    const topMarkets = [...allMarkets]
      .sort((a, b) => (b.trader_count || 0) - (a.trader_count || 0))
      .slice(0, 5)
      .map(m => ({
        title: m.question,
        trader_count: m.trader_count || 0,
        volume: m.volume || 0,
        resolved: m.resolved || false,
        yes_price: m.yes_price || 0.5
      }));

    // Daily trade counts — last 30 days from positions table
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo  = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const marketIds = allMarkets.map(m => m.id);
    let dailyTrades = [];
    let weeklyActiveTradersCount = 0;
    let avgBetSize = 0;
    let trades7d = 0;
    let tradesPrior7d = 0;

    if (marketIds.length > 0) {
      const { data: positions } = await supabase
        .from('positions')
        .select('created_at, user_id, amount')
        .in('market_id', marketIds)
        .gte('created_at', thirtyDaysAgo.toISOString());

      const allPos = positions || [];

      // Bucket by day
      const buckets = {};
      for (let i = 0; i < 30; i++) {
        const d = new Date();
        d.setDate(d.getDate() - (29 - i));
        const key = d.toISOString().slice(0, 10);
        buckets[key] = 0;
      }
      allPos.forEach(p => {
        const key = p.created_at.slice(0, 10);
        if (key in buckets) buckets[key]++;
      });
      dailyTrades = Object.entries(buckets).map(([date, count]) => ({ date, count }));

      // Weekly active traders (unique users with a trade in last 7 days)
      const recent7 = allPos.filter(p => new Date(p.created_at) >= sevenDaysAgo);
      weeklyActiveTradersCount = new Set(recent7.map(p => p.user_id)).size;

      // 7d vs prior 7d trend
      trades7d      = recent7.length;
      tradesPrior7d = allPos.filter(p => {
        const t = new Date(p.created_at);
        return t >= fourteenDaysAgo && t < sevenDaysAgo;
      }).length;

      // Avg bet size (in centpoints, across all 30d positions)
      const withAmount = allPos.filter(p => p.amount > 0);
      avgBetSize = withAmount.length
        ? Math.round(withAmount.reduce((s, p) => s + p.amount, 0) / withAmount.length)
        : 0;
    }

    // Top markets by comment count
    let topMarketsByComments = [];
    if (marketIds.length > 0) {
      const { data: comments } = await supabase
        .from('market_comments')
        .select('market_id')
        .in('market_id', marketIds);
      if (comments && comments.length) {
        const counts = {};
        comments.forEach(c => { counts[c.market_id] = (counts[c.market_id] || 0) + 1; });
        topMarketsByComments = allMarkets
          .filter(m => counts[m.id])
          .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))
          .slice(0, 5)
          .map(m => ({ title: m.question, comment_count: counts[m.id] || 0, trader_count: m.trader_count || 0 }));
      }
    }

    // Community balance stats
    let balanceStats = { total_in_circulation: 0, avg_balance: 0, member_count: 0 };
    if (slug) {
      const { data: balances } = await supabase
        .from('community_balances')
        .select('balance')
        .eq('creator_slug', slug);
      if (balances && balances.length > 0) {
        const total = balances.reduce((s, b) => s + (b.balance || 0), 0);
        balanceStats = {
          total_in_circulation: total,
          avg_balance: Math.round(total / balances.length),
          member_count: balances.length
        };
      }
    }

    // Refill stats
    let refillStats = { total_refills: 0, total_pts_distributed: 0 };
    if (slug) {
      const { data: refills } = await supabase
        .from('refill_history')
        .select('amount')
        .eq('creator_slug', slug);
      if (refills && refills.length > 0) {
        refillStats = {
          total_refills: refills.length,
          total_pts_distributed: refills.reduce((s, r) => s + (r.amount || 0), 0)
        };
      }
    }

    // Referral stats
    let referralStats = { total_referrals: 0, total_pts_distributed: 0, this_week: 0 };
    if (slug) {
      const weekStart = getWeekStart();
      const { data: referrals } = await supabase
        .from('referral_history')
        .select('referrer_reward, welcome_bonus, created_at')
        .eq('creator_slug', slug);
      if (referrals && referrals.length > 0) {
        const totalPts = referrals.reduce((s, r) => s + (r.referrer_reward || 0) + (r.welcome_bonus || 0), 0);
        const thisWeek = referrals.filter(r => r.created_at >= weekStart).length;
        referralStats = {
          total_referrals: referrals.length,
          total_pts_distributed: totalPts,
          this_week: thisWeek
        };
      }
    }

    // ── Engagement Rate ──────────────────────────────────────
    // % of community members who have placed at least one bet (real engagement, not vanity metric)
    let engagementRate = 0;
    let activeMembers  = 0;
    let newMembers7d   = 0;
    let memberGrowth   = []; // daily new members for last 14 days
    if (slug && balanceStats.member_count > 0 && marketIds.length > 0) {
      // Unique bettors ever
      const { data: allBettors } = await supabase
        .from('positions')
        .select('user_id')
        .in('market_id', marketIds);
      const uniqueBettors = new Set((allBettors || []).map(p => p.user_id)).size;
      activeMembers  = uniqueBettors;
      engagementRate = balanceStats.member_count > 0
        ? Math.round((uniqueBettors / balanceStats.member_count) * 100)
        : 0;
    }

    // New members last 7 days (community_balances created_at)
    if (slug) {
      const { count: newCount } = await supabase
        .from('community_balances')
        .select('user_id', { count: 'exact', head: true })
        .eq('creator_slug', slug)
        .gte('created_at', sevenDaysAgo.toISOString());
      newMembers7d = newCount || 0;

      // Embed attribution — total members who joined via embedded widget
      const { count: embedCount } = await supabase
        .from('community_balances')
        .select('user_id', { count: 'exact', head: true })
        .eq('creator_slug', slug)
        .eq('join_source', 'embed');
      balanceStats.embed_joins = embedCount || 0;

      // Daily new member growth — last 14 days
      const fourteenDaysAgoStr = fourteenDaysAgo.toISOString();
      const { data: growthRows } = await supabase
        .from('community_balances')
        .select('created_at')
        .eq('creator_slug', slug)
        .gte('created_at', fourteenDaysAgoStr);
      const growthBuckets = {};
      for (let i = 0; i < 14; i++) {
        const d = new Date(); d.setDate(d.getDate() - (13 - i));
        growthBuckets[d.toISOString().slice(0, 10)] = 0;
      }
      (growthRows || []).forEach(r => {
        const k = r.created_at.slice(0, 10);
        if (k in growthBuckets) growthBuckets[k]++;
      });
      memberGrowth = Object.entries(growthBuckets).map(([date, count]) => ({ date, count }));
    }

    // ── Category Breakdown ───────────────────────────────────
    // Real bet volume and count per category — tells creator what topics their audience actually cares about
    let categoryBreakdown = [];
    if (marketIds.length > 0) {
      const { data: catPositions } = await supabase
        .from('positions')
        .select('market_id, amount')
        .in('market_id', marketIds);

      const catMap = Object.fromEntries(allMarkets.map(m => [m.id, (m.category || 'other').toLowerCase()]));
      const catStats = {};
      (catPositions || []).forEach(p => {
        const cat = catMap[p.market_id] || 'other';
        if (!catStats[cat]) catStats[cat] = { bets: 0, volume: 0 };
        catStats[cat].bets++;
        catStats[cat].volume += p.amount || 0;
      });
      categoryBreakdown = Object.entries(catStats)
        .map(([category, stats]) => ({ category, bets: stats.bets, volume: stats.volume }))
        .sort((a, b) => b.bets - a.bets)
        .slice(0, 8);
    }

    // ── Sentiment Map ────────────────────────────────────────
    // Per-category: what does your audience actually believe?
    // Aggregate yes_price (weighted by trader_count) per category for active markets
    const sentimentMap = {};
    activeMarkets.forEach(m => {
      const cat = (m.category || 'other').toLowerCase();
      if (!sentimentMap[cat]) sentimentMap[cat] = { sumYes: 0, count: 0, volume: 0 };
      const w = m.trader_count || 1;
      sentimentMap[cat].sumYes += (m.yes_price || 0.5) * w;
      sentimentMap[cat].count  += w;
      sentimentMap[cat].volume += m.volume || 0;
    });
    const sentimentByCategory = Object.entries(sentimentMap)
      .map(([category, s]) => ({
        category,
        avg_yes_pct: Math.round((s.sumYes / s.count) * 100),
        market_count: activeMarkets.filter(m => (m.category || 'other').toLowerCase() === category).length
      }))
      .sort((a, b) => b.market_count - a.market_count);

    // Real average trader_count across all markets (for insight card accuracy)
    const avgTraderCount = allMarkets.length > 0
      ? Math.round(allMarkets.reduce((s, m) => s + (m.trader_count || 0), 0) / allMarkets.length)
      : 0;

    res.json({
      plan,
      market_breakdown: {
        total: allMarkets.length,
        active: activeMarkets.length,
        resolved: resolvedMarkets.length,
        archived: archivedMarkets.length,
        avg_trader_count: avgTraderCount,
      },
      top_markets: topMarkets,
      top_markets_by_comments: topMarketsByComments,
      daily_trades: dailyTrades,
      trades_7d: trades7d,
      trades_prior_7d: tradesPrior7d,
      weekly_active_traders: weeklyActiveTradersCount,
      avg_bet_size: avgBetSize,
      balance_stats: balanceStats,
      refill_stats: refillStats,
      referral_stats: referralStats,
      // New real-data fields
      engagement_rate: engagementRate,
      active_members: activeMembers,
      new_members_7d: newMembers7d,
      member_growth: memberGrowth,
      category_breakdown: categoryBreakdown,
      sentiment_by_category: sentimentByCategory
    });

  } catch (err) {
    console.error('analytics error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 4b. SPONSOR KIT PDF
// GET /api/creator/sponsor-kit
// Pro/Premium only — generates a branded 3-page PDF with community stats
// ════════════════════════════════════════════════════════════
app.get('/api/creator/sponsor-kit', requireCreator, async (req, res) => {
  try {
    const creatorId = req.creator.id;

    // Plan gate — Pro/Premium only
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('slug, plan, display_name, custom_points_name')
      .eq('creator_id', creatorId)
      .single();
    if (!settings) return res.status(404).json({ error: 'Creator not found' });

    const plan = settings.plan || 'free';
    if (plan === 'free') {
      return res.status(403).json({ error: 'Sponsor Kit requires Pro or Premium', upgrade_required: true });
    }

    const slug     = settings.slug;
    const ptsName  = settings.custom_points_name || 'Flex Points';
    const name     = settings.display_name || slug;

    // Fetch stats
    const [marketsRes, balancesRes, positionsRes] = await Promise.all([
      supabase.from('markets').select('id, category, resolved, archived, trader_count').eq('tenant_slug', slug),
      supabase.from('community_balances').select('user_id', { count: 'exact', head: true }).eq('creator_slug', slug),
      supabase.from('positions').select('market_id, amount, user_id, created_at')
        .in('market_id',
          (await supabase.from('markets').select('id').eq('tenant_slug', slug)).data?.map(m => m.id) || [])
    ]);

    const allMarkets    = marketsRes.data || [];
    const memberCount   = balancesRes.count || 0;
    const allPositions  = positionsRes.data || [];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weeklyTraders = new Set(
      allPositions.filter(p => new Date(p.created_at) >= sevenDaysAgo).map(p => p.user_id)
    ).size;

    const totalPreds  = allPositions.length;
    const marketsRun  = allMarkets.length;
    const engagement  = memberCount > 0 ? Math.round((new Set(allPositions.map(p => p.user_id)).size / memberCount) * 100) : 0;
    const avgBet      = allPositions.length > 0
      ? Math.round(allPositions.reduce((s, p) => s + (p.amount || 0), 0) / allPositions.length / 100)
      : 0;

    // Category breakdown
    const catMap = {};
    for (const m of allMarkets) {
      const cat = m.category || 'other';
      if (!catMap[cat]) catMap[cat] = { category: cat, bets: 0 };
    }
    for (const p of allPositions) {
      const m = allMarkets.find(x => x.id === p.market_id);
      if (m) {
        const cat = m.category || 'other';
        if (!catMap[cat]) catMap[cat] = { category: cat, bets: 0 };
        catMap[cat].bets++;
      }
    }
    const categories = Object.values(catMap).sort((a, b) => b.bets - a.bets).slice(0, 5);

    const payload = JSON.stringify({
      community: { name, slug, pts_name: ptsName },
      stats: {
        member_count:       memberCount,
        weekly_traders:     weeklyTraders,
        total_predictions:  totalPreds,
        markets_run:        marketsRun,
        engagement_rate:    engagement,
        avg_bet_size:       avgBet
      },
      categories
    });

    const scriptPath = path.join(__dirname, 'scripts', 'generate_sponsor_kit.py');

    const child = execFile('python3', [scriptPath], { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[sponsor-kit] python error:', err.message, stderr);
        return res.status(500).json({ error: 'PDF generation failed' });
      }
      const filename = `${slug}-sponsor-kit.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(Buffer.from(stdout, 'binary'));
    });

    child.stdin.write(payload);
    child.stdin.end();

  } catch (err) {
    console.error('[sponsor-kit]', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 4b. AI INSIGHTS
// POST /api/creator/insights
// Auth: Bearer token required
// Uses analytics data to generate 3-5 actionable growth recommendations via Claude
// ════════════════════════════════════════════════════════════
app.post('/api/creator/insights', requireCreator, async (req, res) => {
  try {
    const { analytics } = req.body;
    if (!analytics) return res.status(400).json({ error: 'analytics data required' });

    if (!anthropic) return res.status(503).json({ error: 'AI not configured' });

    const {
      market_breakdown = {},
      engagement_rate = 0,
      active_members = 0,
      new_members_7d = 0,
      trades_7d = 0,
      trades_prior_7d = 0,
      weekly_active_traders = 0,
      avg_bet_size = 0,
      balance_stats = {},
      category_breakdown = [],
      sentiment_by_category = [],
      top_markets = [],
      top_markets_by_comments = [],
      referral_stats = {},
      plan = 'free'
    } = analytics;

    const trend = trades_prior_7d > 0
      ? `${trades_7d > trades_prior_7d ? '+' : ''}${Math.round(((trades_7d - trades_prior_7d) / trades_prior_7d) * 100)}% vs prior week`
      : 'first week of data';

    const topCats = category_breakdown.slice(0, 3).map(c =>
      `${c.category} (${c.bets} bets, ${Math.round(c.volume / 100)} pts volume)`
    ).join(', ');

    const sentimentLines = sentiment_by_category.slice(0, 4).map(s =>
      `${s.category}: ${s.avg_yes_pct}% YES avg across ${s.market_count} markets`
    ).join('; ');

    const topMkt = top_markets[0];
    const topMktLine = topMkt
      ? `Most-traded market: "${topMkt.title}" with ${topMkt.trader_count} traders`
      : 'No markets yet';

    const prompt = `You are a growth advisor for a creator running a prediction market community on Hyperflex.
Analyze these real statistics and give exactly 4 specific, actionable recommendations. Each one must reference the actual numbers.

COMMUNITY STATS:
- Plan: ${plan}
- Total members: ${balance_stats.member_count || 0} (joined community)
- Active bettors: ${active_members} (${engagement_rate}% engagement rate)
- New members this week: ${new_members_7d}
- Weekly active traders: ${weekly_active_traders}
- Trades this week: ${trades_7d} (${trend})
- Avg bet size: ${Math.round(avg_bet_size / 100)} Flex Points
- Active markets: ${market_breakdown.active || 0}, Resolved: ${market_breakdown.resolved || 0}
- Top categories by bets: ${topCats || 'none yet'}
- Audience sentiment: ${sentimentLines || 'no active markets'}
- ${topMktLine}
- Referrals this week: ${referral_stats.this_week || 0}
- Most-discussed market: ${top_markets_by_comments[0]?.title || 'none'} (${top_markets_by_comments[0]?.comment_count || 0} comments)

Return JSON array of exactly 4 insight objects. Each object must have:
- "title": 5-8 words, punchy
- "body": 2 sentences. First sentence = specific observation from the data. Second sentence = concrete action they can take today.
- "metric": the key stat this insight is based on (short string, e.g. "42% engagement rate")
- "type": one of "growth", "engagement", "content", "retention"
- "priority": "high", "medium", or "low" based on impact

Rules: No generic advice. Every insight must cite a specific number from the data. Be direct. If engagement is low, say it's low. If a category dominates, say which one.

Return only valid JSON array, no markdown, no explanation.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text.trim();
    // Strip markdown code fences if present
    const clean = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    let insights;
    try {
      insights = JSON.parse(clean);
    } catch (e) {
      console.error('[insights] JSON parse error:', e.message, '\nRaw:', raw.slice(0, 300));
      return res.status(500).json({ error: 'AI returned invalid JSON' });
    }

    res.json({ insights });
  } catch (err) {
    console.error('[insights] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 4c. UPLOAD BRAND ASSET (logo or banner)
// POST /api/creator/upload-asset
// Auth: Bearer token required
// Body: { type: 'logo'|'banner', data: '<base64>', mime: 'image/png' }
// Uploads to Supabase Storage bucket 'community-assets', returns public URL
// ════════════════════════════════════════════════════════════
app.post('/api/creator/upload-asset', requireCreator, async (req, res) => {
  try {
    const creatorId = req.creator.id;
    const { type, data, mime } = req.body;

    if (!type || !data || !mime) return res.status(400).json({ error: 'type, data, and mime required' });
    if (!['logo', 'banner'].includes(type)) return res.status(400).json({ error: 'type must be logo or banner' });

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(mime)) return res.status(400).json({ error: 'Only JPEG, PNG, WebP, or GIF allowed' });

    // Decode base64
    const base64 = data.includes(',') ? data.split(',')[1] : data;
    const buffer = Buffer.from(base64, 'base64');

    // 5 MB limit
    if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 5 MB)' });

    const ext = mime.split('/')[1].replace('jpeg', 'jpg');
    const path = `${creatorId}/${type}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('community-assets')
      .upload(path, buffer, { contentType: mime, upsert: true });

    if (uploadError) {
      console.error('Supabase storage upload error:', uploadError);
      return res.status(500).json({ error: 'Upload failed: ' + uploadError.message });
    }

    const { data: { publicUrl } } = supabase.storage
      .from('community-assets')
      .getPublicUrl(path);

    res.json({ url: publicUrl });
  } catch (err) {
    console.error('upload-asset error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ════════════════════════════════════════════════════════════
// 4c. AI MARKET IDEAS
// POST /api/creator/market-ideas
// Auth: Bearer token required (Pro or Premium only)
// Body: { category, description, count } — count = 3 (Pro) or 5 (Premium)
// Returns: { happening_now: [], upcoming: [], most_viral: [] }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/market-ideas', requireCreator, async (req, res) => {
  try {
    const creatorId = req.creator.id;

    // Single query — fetch everything needed at once
    const { data: row } = await supabase
      .from('creator_settings')
      .select('plan, community_description, display_name, custom_points_name, community_category')
      .eq('creator_id', creatorId)
      .single();

    const plan = row?.plan || 'free';
    if (plan === 'free') return res.status(403).json({ error: 'Market Ideas requires Pro or Premium' });

    const count    = plan === 'platinum' ? 5 : 3;
    const category = row?.community_category || req.body.category || 'other';
    const desc     = row?.community_description || '';
    const name     = row?.display_name || 'Community';

    const categoryLabels = {
      sports: 'Sports', esports: 'Esports / Gaming', entertainment: 'Entertainment & Pop Culture',
      finance: 'Finance & Stock Market', crypto: 'Crypto & Web3', politics: 'Politics & Elections',
      news: 'News & Current Events', tech: 'Technology', music: 'Music', other: 'General'
    };
    const nicheLabel = categoryLabels[category] || category;
    const today = new Date().toISOString().split('T')[0];

    const prompt = `Prediction market expert. Generate ${count} questions per category for "${name}" (niche: ${nicheLabel}).${desc ? ` Context: ${desc}` : ''} Today: ${today}.

RULES — every question must have one objectively verifiable YES/NO answer.
BANNED: opinion ("Is X better than Y?"), vague comparisons, consensus-based, no clear resolution date, already happened.
GOOD: specific price/ranking/outcome targets with a known resolution event.

CATEGORIES:
1. happening_now — resolves THIS week/month (live series, earnings, breaking news)
2. upcoming — known events next 1–6 months (launches, elections, seasons)
3. most_viral — bold specific predictions on the most talked-about topics in this niche

SCORING (0–100): resolvability (0–50) + excitement (0–50). Only include if score ≥ 70.
Questions must be under 120 chars. No duplicate topics across categories.

Return ONLY valid JSON:
{"happening_now":[{"question":"...","why":"one sentence on timeliness","score":85,"resolves_via":"..."}],"upcoming":[...],"most_viral":[...]}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1400,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0].text.trim();
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const ideas = JSON.parse(jsonStr);

    // Trim to count in case Claude returns extra
    ['happening_now', 'upcoming', 'most_viral'].forEach(k => {
      if (ideas[k]) ideas[k] = ideas[k].slice(0, count);
    });

    res.json({ ...ideas, count, plan, category });
  } catch (err) {
    console.error('market-ideas error:', err);
    res.status(500).json({ error: 'Failed to generate ideas' });
  }
});

// ════════════════════════════════════════════════════════════
// 5. UPDATE CREATOR SETTINGS
// PUT /api/creator/settings
// Auth: Bearer token required
// Body: { display_name, custom_points_name, primary_color }
// ════════════════════════════════════════════════════════════
app.put('/api/creator/settings', requireCreator, async (req, res) => {
  try {
    const {
      display_name, custom_points_name, primary_color,
      // Economy fields
      starting_balance, min_bet, max_bet,
      refill_enabled, refill_amount, refill_cadence, activity_gate,
      // Referral fields
      referral_reward, welcome_bonus,
      // Branding fields
      logo_url, banner_url, banner_position, font_choice,
      social_twitter, social_youtube, social_discord, social_twitch,
      community_description,
      // Ideas niche
      community_category
    } = req.body;

    const updates = {
      display_name,
      custom_points_name,
      primary_color,
      updated_at: new Date().toISOString()
    };

    // Economy fields — only update if explicitly provided
    if (starting_balance !== undefined) updates.starting_balance = Math.max(1000, parseInt(starting_balance) || 100000);
    if (min_bet !== undefined) updates.min_bet = Math.max(100, parseInt(min_bet) || 1000);
    if (max_bet !== undefined) updates.max_bet = max_bet === null ? null : Math.max(updates.min_bet || 100, parseInt(max_bet));
    if (refill_enabled !== undefined) updates.refill_enabled = Boolean(refill_enabled);
    if (refill_amount !== undefined) updates.refill_amount = Math.max(100, parseInt(refill_amount) || 10000);
    if (refill_cadence !== undefined && ['daily','weekly','monthly'].includes(refill_cadence)) updates.refill_cadence = refill_cadence;
    if (activity_gate !== undefined) updates.activity_gate = Math.max(0, parseInt(activity_gate) || 5);
    // Referral fields
    if (referral_reward !== undefined) updates.referral_reward = Math.max(0, parseInt(referral_reward) || 0);
    if (welcome_bonus   !== undefined) updates.welcome_bonus   = Math.max(0, parseInt(welcome_bonus) || 0);
    // Branding fields
    if (logo_url   !== undefined) updates.logo_url   = logo_url   || null;
    if (banner_url !== undefined) updates.banner_url = banner_url || null;
    if (font_choice !== undefined && ['Syne','Space Grotesk','Inter','Playfair Display','Montserrat','Raleway'].includes(font_choice)) updates.font_choice = font_choice;
    if (social_twitter !== undefined) updates.social_twitter = social_twitter || null;
    if (social_youtube !== undefined) updates.social_youtube = social_youtube || null;
    if (social_discord !== undefined) updates.social_discord = social_discord || null;
    if (social_twitch  !== undefined) updates.social_twitch  = social_twitch  || null;
    if (community_description !== undefined) updates.community_description = community_description || null;
    if (community_category !== undefined) updates.community_category = community_category || 'other';
    if (banner_position   !== undefined) updates.banner_position    = banner_position    || '50% 50%';

    const { error } = await supabase
      .from('creator_settings')
      .update(updates)
      .eq('creator_id', req.creator.id);

    if (error) throw error;

    // Also update users table display name
    if (display_name) {
      await supabase
        .from('users')
        .update({ display_name })
        .eq('id', req.creator.id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('settings update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// PUT /api/creator/settings/slug — change community slug + cascade to all tables
// Body: { new_slug }
// Cascades: creator_settings, markets.tenant_slug, community_balances.creator_slug,
//           creator_referrals, creator_follows, seasons, notifications, market_disputes
// ════════════════════════════════════════════════════════════
app.put('/api/creator/settings/slug', requireCreator, async (req, res) => {
  try {
    const { new_slug } = req.body;
    if (!new_slug) return res.status(400).json({ error: 'new_slug required' });
    if (!/^[a-z0-9-]{3,30}$/.test(new_slug)) return res.status(400).json({ error: 'Slug must be 3-30 chars, lowercase letters, numbers, hyphens only' });

    // Reserved slugs
    const RESERVED = ['admin','api','embed','share','widget','win','u','m','nominate','templates','explore','profile','login','signup','creator'];
    if (RESERVED.includes(new_slug)) return res.status(400).json({ error: 'That slug is reserved' });

    // Get current slug
    const { data: current } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('creator_id', req.creator.id)
      .single();
    if (!current) return res.status(404).json({ error: 'Creator not found' });
    const old_slug = current.slug;

    if (old_slug === new_slug) return res.json({ ok: true, slug: new_slug });

    // Check availability
    const { data: taken } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('slug', new_slug)
      .maybeSingle();
    if (taken) return res.status(409).json({ error: 'Slug already taken — try a different one' });

    // Cascade updates
    await supabase.from('creator_settings').update({ slug: new_slug }).eq('creator_id', req.creator.id);

    // Markets: update one-by-one to skip any duplicate-question conflicts
    const { data: oldMarkets } = await supabase.from('markets').select('id, question').eq('tenant_slug', old_slug);
    const { data: newMarkets } = await supabase.from('markets').select('question').eq('tenant_slug', new_slug);
    const newQs = new Set((newMarkets || []).map(m => m.question));
    let mktMigrated = 0, mktSkipped = 0;
    for (const m of (oldMarkets || [])) {
      if (newQs.has(m.question)) { mktSkipped++; continue; } // dupe — leave it, or delete it
      await supabase.from('markets').update({ tenant_slug: new_slug }).eq('id', m.id);
      mktMigrated++;
    }
    if (mktSkipped > 0) console.log(`[slug-change] skipped ${mktSkipped} duplicate-question markets`);

    await supabase.from('community_balances').update({ creator_slug: new_slug }).eq('creator_slug', old_slug);

    // Best-effort cascade on tables that may or may not exist
    const softCascades = [
      supabase.from('creator_referrals').update({ referrer_slug: new_slug }).eq('referrer_slug', old_slug),
      supabase.from('creator_follows').update({ creator_slug: new_slug }).eq('creator_slug', old_slug),
      supabase.from('seasons').update({ creator_slug: new_slug }).eq('creator_slug', old_slug),
      supabase.from('creator_wall').update({ creator_slug: new_slug }).eq('creator_slug', old_slug),
      supabase.from('market_disputes').update({ creator_slug: new_slug }).eq('creator_slug', old_slug),
      supabase.from('users').update({ tenant_slug: new_slug }).eq('tenant_slug', old_slug),
    ];
    await Promise.allSettled(softCascades);

    console.log(`[slug-change] ${old_slug} → ${new_slug} for creator ${req.creator.id}`);
    res.json({ ok: true, old_slug, new_slug });
  } catch (err) {
    console.error('slug change error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 5a. QUESTION VALIDATOR
// POST /api/creator/validate-question
// Body: { question }
// Returns: { valid, reason, suggested_rewrite? }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/validate-question', requireCreator, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || question.trim().length < 5) {
      return res.json({ valid: false, reason: 'Question is too short.', suggested_rewrite: null });
    }

    if (!ANTHROPIC_API_KEY) {
      return res.json({ valid: true, reason: 'Validation unavailable (no API key).', suggested_rewrite: null });
    }

    const prompt = `You are a prediction market quality checker. Evaluate whether this market question is resolvable and well-formed.

A good prediction market question:
- Has a clear YES or NO answer determinable by a specific future date
- References concrete, observable events
- Is not ambiguous about what counts as YES vs NO
- Cannot be answered by pure opinion or interpretation

Question: "${question.trim()}"

Return ONLY valid JSON:
{
  "valid": true or false,
  "reason": "one sentence explanation",
  "suggested_rewrite": "improved version of the question if invalid, or null if already valid"
}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    const text = aiData.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.json({ valid: true, reason: 'Could not parse validation result.', suggested_rewrite: null });

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({
      valid: !!parsed.valid,
      reason: parsed.reason || '',
      suggested_rewrite: parsed.suggested_rewrite || null
    });
  } catch (err) {
    // Fail open — don't block creation on validation errors
    res.json({ valid: true, reason: 'Validation service unavailable.', suggested_rewrite: null });
  }
});

// ════════════════════════════════════════════════════════════
// 5b. REWARDS CRUD
// GET  /api/creator/:slug/rewards  — public
// POST /api/creator/rewards        — requireCreator
// PUT  /api/creator/rewards/:id    — requireCreator
// DELETE /api/creator/rewards/:id  — requireCreator
// ════════════════════════════════════════════════════════════

app.get('/api/creator/:slug/rewards', async (req, res) => {
  try {
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('creator_id')
      .eq('slug', req.params.slug)
      .maybeSingle();
    if (!settings) return res.status(404).json({ error: 'Community not found' });

    const { data: rewards, error } = await supabase
      .from('creator_rewards')
      .select('id, threshold, title, description')
      .eq('creator_id', settings.creator_id)
      .order('threshold', { ascending: true });
    if (error) throw error;
    res.json({ rewards: rewards || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/creator/rewards', requireCreator, async (req, res) => {
  try {
    const { threshold, title, description } = req.body;
    if (!threshold || !title) return res.status(400).json({ error: 'threshold and title are required' });

    const { data, error } = await supabase
      .from('creator_rewards')
      .insert([{ creator_id: req.creator.id, threshold: Number(threshold), title, description: description || '' }])
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, reward: data });
  } catch (err) {
    console.error('rewards insert error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/creator/rewards/:id', requireCreator, async (req, res) => {
  try {
    const { threshold, title, description } = req.body;
    const updates = {};
    if (threshold !== undefined) updates.threshold = Number(threshold);
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;

    const { error } = await supabase
      .from('creator_rewards')
      .update(updates)
      .eq('id', req.params.id)
      .eq('creator_id', req.creator.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/creator/rewards/:id', requireCreator, async (req, res) => {
  try {
    const { error } = await supabase
      .from('creator_rewards')
      .delete()
      .eq('id', req.params.id)
      .eq('creator_id', req.creator.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 5b2. CREATOR REWARD MEMBER — send bonus pts to a specific member
// POST /api/creator/member/reward
// Body: { user_id, amount_pts }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/member/reward', requireCreator, async (req, res) => {
  try {
    const { user_id, amount_pts } = req.body;
    if (!user_id || !amount_pts || amount_pts <= 0) {
      return res.status(400).json({ error: 'user_id and positive amount_pts required' });
    }
    const clampedPts = Math.min(Math.round(amount_pts), 100000); // max 1000 pts per reward
    const slug = req.creator.slug;
    const currentBal = await getCommunityBalance(user_id, slug);
    const newBal = currentBal + clampedPts * 100; // centpoints
    await setCommunityBalance(user_id, slug, newBal);

    // Fetch display name for response
    const { data: userRow } = await supabase.from('users').select('display_name').eq('id', user_id).single();
    res.json({ ok: true, new_balance_pts: Math.round(newBal / 100), display_name: userRow?.display_name || 'Member' });
  } catch (err) {
    console.error('reward member error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 5c. SMART RESOLUTION — AI-POWERED SUGGESTION
// POST /api/creator/markets/:id/suggest-resolution
// Auth: requireCreator
// Returns: { suggested_outcome, reasoning, sources_cited, confidence, crypto_data? }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/markets/:id/suggest-resolution', requireCreator, async (req, res) => {
  try {
    const { data: market } = await supabase
      .from('markets')
      .select('*')
      .eq('id', req.params.id)
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found or not yours' });
    if (market.resolved) return res.status(409).json({ error: 'Market already resolved' });

    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Anthropic API key not configured' });
    }

    // For crypto markets, try to fetch live price data from CoinGecko
    let cryptoContext = '';
    if (market.category === 'crypto' || market.category === 'finance') {
      try {
        // Ask Claude mini to extract coin symbol first, then fetch price
        const coinRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 100,
            messages: [{ role: 'user', content: `Extract the cryptocurrency coin ID for CoinGecko API from this question. Reply with ONLY the lowercase CoinGecko ID (e.g. "bitcoin", "ethereum", "solana") or "none" if not applicable.\n\nQuestion: "${market.question}"` }]
          })
        });
        const coinData = await coinRes.json();
        const coinId = (coinData.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

        if (coinId && coinId !== 'none' && coinId.length > 1) {
          const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`);
          if (priceRes.ok) {
            const priceData = await priceRes.json();
            if (priceData[coinId]) {
              const p = priceData[coinId];
              cryptoContext = `\n\nLIVE PRICE DATA (CoinGecko): ${coinId} = $${p.usd?.toLocaleString()} USD (24h change: ${p.usd_24h_change?.toFixed(2)}%)`;
            }
          }
        }
      } catch (e) {
        // price fetch is best-effort, continue without it
      }
    }

    const sources = (() => {
      try { return JSON.parse(market.resolution_sources || '[]'); } catch { return []; }
    })();

    const prompt = `You are an impartial resolution analyst for a prediction market platform.

Market Question: "${market.question}"
Category: ${market.category || 'general'}
Resolution Date: ${market.expiry_date}
Today's Date: ${new Date().toISOString().split('T')[0]}
Resolution Sources: ${sources.length ? sources.join(', ') : 'Not specified'}${cryptoContext}

Based on your knowledge up to your training cutoff and the context above, provide a resolution analysis.

IMPORTANT:
- If the resolution date is in the future, note that the market should not be resolved yet unless the outcome is already certain
- Be honest about uncertainty — use confidence levels
- For crypto/finance: use the live price data if provided
- Cite which sources would confirm your suggestion

Return ONLY valid JSON:
{
  "suggested_outcome": "YES" or "NO" or "UNRESOLVABLE",
  "confidence": "HIGH" or "MEDIUM" or "LOW",
  "reasoning": "2-3 sentence explanation of why you suggest this outcome",
  "sources_cited": ["source1", "source2"],
  "caveat": "Any important caveat or 'none'"
}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
    });

    const aiData = await aiRes.json();
    const text = aiData.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI returned invalid format');

    const parsed = JSON.parse(jsonMatch[0]);

    // Store the suggestion on the market
    await supabase.from('markets').update({
      suggested_outcome: parsed.suggested_outcome,
      auto_resolution_data: JSON.stringify({ ...parsed, crypto_context: cryptoContext, generated_at: new Date().toISOString() })
    }).eq('id', req.params.id);

    res.json({ ...parsed, market_id: req.params.id });

  } catch (err) {
    console.error('suggest-resolution error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 6. RESOLVE MARKET (Creator only)
// ── MARKET DISPUTES ──────────────────────────────────────────────────────────
// POST /api/markets/:id/dispute      — member files a dispute (auth required)
// GET  /api/creator/disputes         — creator views open disputes for their community
// POST /api/creator/disputes/:id/review — creator upholds or overturns

app.post('/api/markets/:id/dispute', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, requested_outcome } = req.body;

    const { data: market } = await supabase
      .from('markets')
      .select('id, question, resolved, resolved_at, tenant_slug, outcome, expiry_date, trader_count')
      .eq('id', id)
      .maybeSingle();
    if (!market) return res.status(404).json({ error: 'Market not found' });

    const now = Date.now();
    let disputeType, insertReason;

    if (market.resolved) {
      // ── Type 1: outcome contest — filed after resolution within 24h ──
      if (!reason?.trim()) return res.status(400).json({ error: 'Reason is required' });
      const resolvedAt = market.resolved_at ? new Date(market.resolved_at) : null;
      if (!resolvedAt || now - resolvedAt.getTime() > 24 * 60 * 60 * 1000) {
        return res.status(400).json({ error: 'Dispute window closed (24 hours after resolution)' });
      }
      disputeType  = 'outcome_contest';
      insertReason = reason.trim().slice(0, 500);
    } else {
      // ── Type 2: resolution vote — on expired unresolved market ──
      if (!market.expiry_date || new Date(market.expiry_date) > new Date()) {
        return res.status(400).json({ error: 'You can only vote on expired markets' });
      }
      if (!['YES', 'NO'].includes(requested_outcome)) {
        return res.status(400).json({ error: 'requested_outcome must be YES or NO' });
      }
      disputeType  = 'resolution_vote';
      insertReason = (reason?.trim() || '').slice(0, 500);
    }

    const { error } = await supabase.from('market_disputes').insert([{
      market_id:         id,
      user_id:           req.user.id,
      creator_slug:      market.tenant_slug,
      reason:            insertReason,
      dispute_type:      disputeType,
      requested_outcome: disputeType === 'resolution_vote' ? requested_outcome : null,
    }]);
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'You already voted on this market' });
      throw error;
    }

    // Notify creator (fire-and-forget)
    const transporter = createMailTransport();
    if (transporter) {
      const { data: cs } = await supabase.from('creator_settings').select('creator_id').eq('slug', market.tenant_slug).maybeSingle();
      if (cs) {
        const { data: creator } = await supabase.from('users').select('email').eq('id', cs.creator_id).maybeSingle();
        if (creator?.email) {
          if (disputeType === 'outcome_contest') {
            transporter.sendMail({
              from: process.env.SMTP_FROM || process.env.SMTP_USER,
              to: creator.email,
              subject: `⚠️ Resolution disputed: ${market.question}`,
              text: `A member disputed the resolution of your market:\n\n"${market.question}"\n\nResolved: ${market.outcome}\nReason: ${insertReason}\n\nReview in dashboard → Resolution Queue.`,
            }).catch(() => {});
          } else {
            // Check if this vote just unlocked resolution — notify creator
            const { count: voteCount } = await supabase
              .from('market_disputes').select('id', { count: 'exact', head: true })
              .eq('market_id', id).eq('dispute_type', 'resolution_vote');
            const threshold = Math.max(3, Math.ceil((market.trader_count || 0) * 0.30));
            if (voteCount >= threshold) {
              transporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: creator.email,
                subject: `🗳️ Resolution unlocked: ${market.question}`,
                text: `Your community has voted on this market and resolution is now unlocked:\n\n"${market.question}"\n\n${voteCount} traders have voted. Review and resolve in your dashboard → Resolution Queue.`,
              }).catch(() => {});
            }
          }
        }
      }
    }

    // Return updated vote counts for UI
    const { count: voteCount } = await supabase
      .from('market_disputes').select('id', { count: 'exact', head: true })
      .eq('market_id', id).eq('dispute_type', 'resolution_vote');
    const threshold = Math.max(3, Math.ceil((market.trader_count || 0) * 0.30));

    res.json({ ok: true, vote_count: voteCount || 1, threshold, unlocked: (voteCount || 1) >= threshold });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/market/:id/votes — public, returns resolution vote counts for a market
app.get('/api/market/:id/votes', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: market } = await supabase
      .from('markets').select('trader_count, resolved, expiry_date').eq('id', id).maybeSingle();
    if (!market) return res.status(404).json({ error: 'Market not found' });

    const { count: voteCount } = await supabase
      .from('market_disputes').select('id', { count: 'exact', head: true })
      .eq('market_id', id).eq('dispute_type', 'resolution_vote');

    // Yes/No breakdown
    const { data: votes } = await supabase
      .from('market_disputes').select('requested_outcome')
      .eq('market_id', id).eq('dispute_type', 'resolution_vote');
    const yesVotes = (votes || []).filter(v => v.requested_outcome === 'YES').length;
    const noVotes  = (votes || []).filter(v => v.requested_outcome === 'NO').length;

    const traderCount = market.trader_count || 0;
    const threshold   = Math.max(3, Math.ceil(traderCount * 0.30));
    const unlocked    = (voteCount || 0) >= threshold || traderCount < 3;

    res.json({ vote_count: voteCount || 0, threshold, unlocked, yes_votes: yesVotes, no_votes: noVotes, trader_count: traderCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/creator/disputes', requireCreator, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('market_disputes')
      .select('id, market_id, user_id, reason, status, created_at, markets(question, outcome, resolved_at)')
      .eq('creator_slug', req.creator.slug)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    // Enrich with user display names
    const userIds = [...new Set((data || []).map(d => d.user_id))];
    const { data: users } = userIds.length
      ? await supabase.from('users').select('id, display_name').in('id', userIds)
      : { data: [] };
    const userMap = {};
    for (const u of (users || [])) userMap[u.id] = u.display_name;

    res.json({ disputes: (data || []).map(d => ({ ...d, user_name: userMap[d.user_id] || 'Anonymous' })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/creator/disputes/:id/review', requireCreator, async (req, res) => {
  try {
    const { decision } = req.body; // 'upheld' or 'overturned'
    if (!['upheld', 'overturned'].includes(decision)) return res.status(400).json({ error: 'decision must be upheld or overturned' });

    const { data: dispute } = await supabase
      .from('market_disputes')
      .select('id, market_id, creator_slug')
      .eq('id', req.params.id)
      .eq('creator_slug', req.creator.slug)
      .maybeSingle();
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

    await supabase.from('market_disputes').update({ status: decision, reviewed_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /markets/:id/resolve
// Auth: Bearer token required
// Body: { outcome: 'YES' | 'NO' }
// ════════════════════════════════════════════════════════════
app.post('/markets/:id/resolve', requireCreator, async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome, attestation_text, resolution_note } = req.body;

    // Verify market belongs to this creator
    const { data: market } = await supabase
      .from('markets')
      .select('*')
      .eq('id', id)
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found or not yours' });
    if (market.resolved) return res.status(409).json({ error: 'Market already resolved' });

    // ── Gate: market must be expired ─────────────────────────────────
    const now = new Date();
    const isExpired = market.expiry_date && new Date(market.expiry_date) <= now;
    if (!isExpired) {
      return res.status(403).json({ error: 'Market has not expired yet. Markets can only be resolved after their expiry date.' });
    }

    // ── Gate: community vote threshold (skip for markets with < 3 traders) ──
    const traderCount = market.trader_count || 0;
    if (traderCount >= 3) {
      const { count: voteCount } = await supabase
        .from('market_disputes').select('id', { count: 'exact', head: true })
        .eq('market_id', id).eq('dispute_type', 'resolution_vote');
      const threshold = Math.max(3, Math.ceil(traderCount * 0.30));
      if ((voteCount || 0) < threshold) {
        return res.status(403).json({
          error: `Community vote required before resolving. ${voteCount || 0} of ${threshold} votes received.`,
          vote_count:  voteCount || 0,
          threshold,
          votes_needed: threshold - (voteCount || 0),
        });
      }
    }

    // Validate outcome against market type
    const isMultiOptionMarket = Array.isArray(market.options) && market.options.length > 0;
    if (isMultiOptionMarket) {
      const validLabels = market.options.map(o => o.label);
      if (!outcome || !validLabels.includes(outcome)) {
        return res.status(400).json({ error: `Outcome must be one of: ${validLabels.join(', ')}` });
      }
    } else {
      if (!['YES', 'NO'].includes(outcome)) {
        return res.status(400).json({ error: 'Outcome must be YES or NO' });
      }
    }

    // Mark market resolved
    const resolveUpdate = {
      resolved: true,
      outcome,
      resolved_at: new Date().toISOString()
    };
    if (attestation_text) resolveUpdate.attestation_text = attestation_text;
    if (resolution_note)  resolveUpdate.resolution_note  = resolution_note.trim().slice(0, 500);

    const { error: resolveErr } = await supabase
      .from('markets')
      .update(resolveUpdate)
      .eq('id', id);

    if (resolveErr) throw resolveErr;

    // Pay out winners — get all positions for this market
    const { data: positions } = await supabase
      .from('positions')
      .select('*')
      .eq('market_id', id);

    if (positions && positions.length > 0) {
      const payouts = [];
      for (const pos of positions) {
        const isWinner = pos.side === outcome;
        // Multi-option: use stored potential_payout (set at bet time based on odds).
        // Binary: fall back to amount*2 for backwards compat with old positions that may lack potential_payout.
        const winAmount = isMultiOptionMarket
          ? (pos.potential_payout || pos.amount * 2)
          : (pos.potential_payout || pos.amount * 2);
        const pnl = isWinner ? (winAmount - pos.amount) : -pos.amount;

        payouts.push(
          supabase.from('positions').update({
            resolved: true,
            won: isWinner,
            pnl
          }).eq('id', pos.id)
        );

        if (isWinner) {
          // Credit winner's community balance
          payouts.push(
            (async () => {
              const slug = market.tenant_slug;
              if (slug) {
                const bal = await getCommunityBalance(pos.user_id, slug);
                await setCommunityBalance(pos.user_id, slug, bal + winAmount);
              } else {
                const { data: u } = await supabase.from('users').select('balance').eq('id', pos.user_id).single();
                if (u) await supabase.from('users').update({ balance: (u.balance || 0) + winAmount }).eq('id', pos.user_id);
              }
            })()
          );
        }
      }
      await Promise.allSettled(payouts);
    }

    res.json({ ok: true, outcome, positions_settled: positions?.length || 0 });

    // Send resolution emails + push in-app notifications (fire-and-forget, non-blocking)
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('creator_id', req.creator.id)
      .maybeSingle();
    sendResolutionEmails(market, outcome, settings?.slug, resolveUpdate.resolution_note || null);

    // In-app notifications for each bettor
    if (positions && positions.length > 0) {
      const shortQ = market.question.length > 60 ? market.question.slice(0, 57) + '…' : market.question;
      for (const pos of positions) {
        const isWin = pos.side === outcome;
        const winAmt = Math.floor((pos.potential_payout || pos.amount * 2) / 100);
        pushNotification(
          pos.user_id,
          isWin ? 'you_won' : 'you_lost',
          isWin ? `🎉 You won! ${winAmt.toLocaleString()} pts` : `Market resolved: ${outcome}`,
          `${shortQ} resolved ${outcome}.${isWin ? ` You called it right and earned ${winAmt.toLocaleString()} pts.` : ' Better luck next time!'}`,
          market.id,
          settings?.slug || market.tenant_slug || null
        ).catch(() => {});
      }
    }

  } catch (err) {
    console.error('resolve error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 7a. CATEGORY-AWARE QUESTION SUGGESTER
// POST /api/creator/suggest-questions
// Body: { category, communityName }
// Returns: { questions: ["Will X?", "Will Y?", ...] }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/suggest-questions', requireCreator, async (req, res) => {
  try {
    const { category, communityName } = req.body;
    if (!category) return res.status(400).json({ error: 'Category required' });

    const today = new Date();
    const in30  = new Date(today.getTime() + 30  * 86400000).toISOString().split('T')[0];
    const in60  = new Date(today.getTime() + 60  * 86400000).toISOString().split('T')[0];
    const in90  = new Date(today.getTime() + 90  * 86400000).toISOString().split('T')[0];
    const in180 = new Date(today.getTime() + 180 * 86400000).toISOString().split('T')[0];

    const categoryContext = {
      sports:        'sports outcomes, player performance, team standings, championships, game results',
      esports:       'esports tournament results, team rankings, game patches, player transfers, championship outcomes',
      entertainment: 'movies, TV shows, music, box office, award shows, celebrity events, streaming releases',
      finance:       'stock prices, earnings reports, economic indicators, company milestones, market movements',
      crypto:        'crypto prices, protocol upgrades, exchange listings, market cap milestones, regulatory events',
      politics:      'elections, legislation, policy decisions, political appointments, polling outcomes',
      news:          'current events, geopolitical developments, major world events',
      other:         'general predictions relevant to the community',
    };

    const context = categoryContext[category] || categoryContext.other;
    const communityStr = communityName ? ` for a community called "${communityName}"` : '';

    const fallbackByCategory = {
      sports:        ['Will the home team win the next championship?', 'Will the top player score 30+ points this week?', 'Will the season record exceed last year?', 'Will there be an upset in the next playoff round?', 'Will the underdog team make the finals?'],
      esports:       ['Will the top-ranked team win the next tournament?', 'Will a major upset happen in the next bracket?', 'Will the new patch change the meta significantly?', 'Will the reigning champion defend their title?', 'Will a rookie player reach the top 10?'],
      entertainment: ['Will the movie exceed $100M at the box office opening weekend?', 'Will the show be renewed for another season?', 'Will the artist win at the next award show?', 'Will the sequel outperform the original?', 'Will the album debut at #1?'],
      finance:       ['Will the stock hit a new all-time high this quarter?', 'Will the company beat earnings estimates?', 'Will the Fed cut rates at the next meeting?', 'Will inflation drop below 3% by year end?', 'Will the IPO price above its target range?'],
      crypto:        ['Will Bitcoin exceed $100K before year end?', 'Will Ethereum complete the next major upgrade on schedule?', 'Will the altcoin outperform BTC this month?', 'Will the protocol reach $1B TVL?', 'Will the token list on a major exchange?'],
      politics:      ['Will the bill pass the vote?', 'Will the candidate win the primary?', 'Will the policy be reversed within 6 months?', 'Will the approval rating rise above 50%?', 'Will the election result be called on election night?'],
      news:          ['Will the negotiation reach a deal within 30 days?', 'Will the event lead to major policy change?', 'Will the situation escalate further?', 'Will the organization announce major changes?', 'Will the story remain in the news cycle for 2+ weeks?'],
      other:         ['Will this milestone be reached by the deadline?', 'Will the community hit 10,000 members?', 'Will the project launch on schedule?', 'Will the prediction come true this month?', 'Will the target be exceeded?'],
    };

    if (!ANTHROPIC_API_KEY) {
      return res.json({ questions: fallbackByCategory[category] || fallbackByCategory.other });
    }

    const prompt = `Generate exactly 5 prediction market questions${communityStr} in the category: ${category} (${context}).

Today is ${today.toISOString().split('T')[0]}. Use these resolution timeframes: near-term=${in30}, mid-term=${in60}, longer=${in90}, far=${in180}.

Rules:
- Each question must be a clear YES or NO binary question
- Must be specific, interesting, and relevant to ${category}
- Start with "Will "
- End with "?"
- Include a timeframe or date where natural
- Make them engaging and debatable — not obvious

Return ONLY a JSON array of 5 strings, no other text:
["Will X?", "Will Y?", "Will Z?", "Will A?", "Will B?"]`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await response.json();
    const text = aiData.content?.[0]?.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Invalid AI response');
    const questions = JSON.parse(jsonMatch[0]);
    res.json({ questions: questions.slice(0, 5) });

  } catch (err) {
    console.error('suggest-questions error:', err);
    const fallback = {
      sports: ['Will the top team win the championship?', 'Will the star player stay healthy all season?', 'Will the underdog make the playoffs?', 'Will this season break viewership records?', 'Will the coach be fired before season end?'],
      finance: ['Will the stock hit a new all-time high this quarter?', 'Will the company beat earnings estimates?', 'Will the merger close on schedule?', 'Will the CEO step down this year?', 'Will the IPO debut above its target price?'],
    };
    const cat = req.body?.category || 'other';
    res.json({ questions: fallback[cat] || ['Will this happen before the deadline?', 'Will the prediction come true this month?', 'Will the milestone be reached on time?', 'Will the outcome surprise everyone?', 'Will this be the biggest event of the year?'] });
  }
});

// 7. AI MARKET SUGGESTER
// POST /api/suggest-markets
// Body: { description: "Weekly fantasy football podcast..." }
// Returns: { markets: [{ question, category, resolution_date }] }
// ════════════════════════════════════════════════════════════
app.post('/api/suggest-markets', async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || description.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a community description' });
    }

    if (!ANTHROPIC_API_KEY) {
      // Fallback suggestions if no API key
      return res.json({ markets: getFallbackSuggestions(description) });
    }

    const today = new Date();
    const in30 = new Date(today.getTime() + 30 * 86400000).toISOString().split('T')[0];
    const in60 = new Date(today.getTime() + 60 * 86400000).toISOString().split('T')[0];
    const in90 = new Date(today.getTime() + 90 * 86400000).toISOString().split('T')[0];

    const prompt = `You are helping a community creator set up prediction markets for their audience.

Community description: "${description}"

Generate exactly 10 prediction market questions tailored to this community. Each must:
- Be a clear YES or NO question
- Be interesting and specific to this community's niche  
- Have a realistic resolution date (use dates: near=${in30}, mid=${in60}, far=${in90})
- Be fun and engaging for fans/members

Return ONLY valid JSON in this exact format, no other text:
{
  "markets": [
    {
      "question": "Will [specific question]?",
      "category": "sports|entertainment|finance|other",
      "resolution_date": "YYYY-MM-DD"
    }
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await response.json();
    const text = aiData.content?.[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid AI response format');

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ markets: parsed.markets || [] });

  } catch (err) {
    console.error('suggest-markets error:', err);
    // Return fallback on any error
    res.json({ markets: getFallbackSuggestions(req.body.description || '') });
  }
});

// Fallback suggestions if AI is unavailable
function getFallbackSuggestions(description) {
  const isFantasy = /fantasy|football|nfl|nba|dfs|roto/i.test(description);
  const isComedy = /comedy|podcast|stand.?up|roast|funny/i.test(description);
  const isFinance = /finance|stock|crypto|invest|trading/i.test(description);

  if (isFantasy) {
    return [
      { question: "Will the top fantasy scorer this week exceed 40 points?", category: "sports", resolution_date: getDate(7) },
      { question: "Will a running back be the #1 overall fantasy scorer this weekend?", category: "sports", resolution_date: getDate(7) },
      { question: "Will any QB throw for 400+ yards this week?", category: "sports", resolution_date: getDate(7) },
      { question: "Will there be a walk-off fantasy win decided by a Monday night kicker?", category: "sports", resolution_date: getDate(8) },
      { question: "Will the consensus #1 waiver pickup score 15+ points in their next game?", category: "sports", resolution_date: getDate(14) },
      { question: "Will any team score 50+ total fantasy points this week?", category: "sports", resolution_date: getDate(7) },
      { question: "Will a tight end crack the top 5 overall scorers this week?", category: "sports", resolution_date: getDate(7) },
      { question: "Will the most traded player on the waiver wire outperform their start?", category: "sports", resolution_date: getDate(14) },
      { question: "Will the highest-owned DFS player bust (under 15 pts) this week?", category: "sports", resolution_date: getDate(7) },
      { question: "Will any player score 3+ touchdowns in a single game this week?", category: "sports", resolution_date: getDate(7) }
    ];
  }

  if (isComedy) {
    return [
      { question: "Will this week's episode feature a surprise celebrity guest?", category: "entertainment", resolution_date: getDate(7) },
      { question: "Will the host go on a rant lasting more than 10 minutes in the next episode?", category: "entertainment", resolution_date: getDate(7) },
      { question: "Will the next episode hit #1 on the podcast charts?", category: "entertainment", resolution_date: getDate(14) },
      { question: "Will a guest make the host genuinely laugh uncontrollably this week?", category: "entertainment", resolution_date: getDate(7) },
      { question: "Will the next episode be longer than 2 hours?", category: "entertainment", resolution_date: getDate(7) },
      { question: "Will there be a controversial clip that goes viral from the next episode?", category: "entertainment", resolution_date: getDate(14) },
      { question: "Will the host mention their most talked-about bit in the next 3 episodes?", category: "entertainment", resolution_date: getDate(21) },
      { question: "Will a fan question get answered on the next episode?", category: "entertainment", resolution_date: getDate(7) },
      { question: "Will the podcast release a bonus episode this month?", category: "entertainment", resolution_date: getDate(30) },
      { question: "Will the next episode have fewer than 5 sponsor reads?", category: "entertainment", resolution_date: getDate(7) }
    ];
  }

  if (isFinance) {
    return [
      { question: "Will the S&P 500 close higher than today by end of month?", category: "finance", resolution_date: getDate(30) },
      { question: "Will Bitcoin exceed $100,000 by end of quarter?", category: "finance", resolution_date: getDate(90) },
      { question: "Will the Fed cut rates at the next FOMC meeting?", category: "finance", resolution_date: getDate(45) },
      { question: "Will Apple stock outperform the Nasdaq this month?", category: "finance", resolution_date: getDate(30) },
      { question: "Will any major bank announce layoffs in the next 60 days?", category: "finance", resolution_date: getDate(60) },
      { question: "Will gold hit $3,000/oz before Bitcoin hits $120,000?", category: "finance", resolution_date: getDate(90) },
      { question: "Will any tech IPO this month pop 50%+ on day one?", category: "finance", resolution_date: getDate(30) },
      { question: "Will inflation data come in below 3% at the next release?", category: "finance", resolution_date: getDate(45) },
      { question: "Will the 10-year Treasury yield fall below 4% this quarter?", category: "finance", resolution_date: getDate(90) },
      { question: "Will any meme stock gain more than 50% in a single day this month?", category: "finance", resolution_date: getDate(30) }
    ];
  }

  // Generic fallback
  return [
    { question: "Will our community reach 1,000 members by end of month?", category: "other", resolution_date: getDate(30) },
    { question: "Will this week's most-discussed topic get resolved in our favor?", category: "other", resolution_date: getDate(7) },
    { question: "Will the host/leader make their prediction from last week correct?", category: "other", resolution_date: getDate(14) },
    { question: "Will we hit a community engagement milestone this week?", category: "other", resolution_date: getDate(7) },
    { question: "Will the most-upvoted prediction in our community this week be right?", category: "other", resolution_date: getDate(14) },
    { question: "Will the underdog position win this week's debate?", category: "other", resolution_date: getDate(7) },
    { question: "Will our community's consensus prediction beat the experts?", category: "other", resolution_date: getDate(30) },
    { question: "Will there be a major surprise announcement in our niche this month?", category: "other", resolution_date: getDate(30) },
    { question: "Will the most controversial take this week age well?", category: "other", resolution_date: getDate(60) },
    { question: "Will our community's top predictor win again next week?", category: "other", resolution_date: getDate(7) }
  ];
}

function getDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

// ════════════════════════════════════════════════════════════
// 7b. YOUTUBE COMMENT + TRANSCRIPT SCANNER
// POST /api/creator/scan-youtube
// Body: { url: "https://youtube.com/watch?v=..." }
// Returns: { markets, comment_count, transcript_length, video_title }
// Each market has source: 'comments' | 'transcript'
// ════════════════════════════════════════════════════════════

// Helper: fetch auto-generated captions from watch page HTML
async function fetchYouTubeTranscript(videoId) {
  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await watchRes.text();

    // Extract all caption baseUrls embedded in the page
    const captionMatches = [...html.matchAll(/"baseUrl":"(https:\\\/\\\/www\.youtube\.com\\\/api\\\/timedtext[^"]+)"/g)];
    if (!captionMatches.length) return null;

    // Unescape JSON-encoded URL, prefer English track
    let captionUrl = null;
    for (const m of captionMatches) {
      const raw = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (!captionUrl) captionUrl = raw; // fallback: first track
      if (raw.includes('lang=en') || raw.includes('lang%3Den')) {
        captionUrl = raw;
        break;
      }
    }
    if (!captionUrl) return null;

    // Fetch as JSON3 format (structured segments)
    const sep = captionUrl.includes('?') ? '&' : '?';
    const transcriptRes = await fetch(captionUrl + sep + 'fmt=json3');
    if (!transcriptRes.ok) return null;

    const transcriptData = await transcriptRes.json();
    const events = transcriptData.events || [];

    const text = events
      .filter(e => e.segs)
      .map(e => e.segs.map(s => (s.utf8 || '').replace(/\n/g, ' ')).join(''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text || null;
  } catch (err) {
    console.warn('transcript fetch failed:', err.message);
    return null;
  }
}

async function fetchYouTubeLiveChat(videoId) {
  try {
    const vidRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`
    );
    const vidData = await vidRes.json();
    const liveChatId = vidData.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if (!liveChatId) return null;

    const chatRes = await fetch(
      `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet&maxResults=200&key=${YOUTUBE_API_KEY}`
    );
    const chatData = await chatRes.json();
    if (chatData.error) return null;

    return (chatData.items || [])
      .map(item => item.snippet?.displayMessage || '')
      .filter(Boolean);
  } catch (err) {
    console.warn('live chat fetch failed:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/public/youtube-meta/:videoId — real video stats for demo scanner
// Uses YOUTUBE_API_KEY (same one as scan-youtube). No auth required.
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/public/youtube-meta/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!YOUTUBE_API_KEY) return res.status(503).json({ error: 'YouTube API not configured' });

    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(videoId)}&key=${YOUTUBE_API_KEY}`;
    const r = await fetch(apiUrl);
    const data = await r.json();

    const item = data?.items?.[0];
    if (!item) return res.status(404).json({ error: 'Video not found' });

    const stats   = item.statistics || {};
    const snippet = item.snippet    || {};
    const duration = item.contentDetails?.duration || 'PT0S'; // ISO 8601 e.g. PT14M23S

    // Parse ISO 8601 duration to seconds
    const durMatch = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const durationSec = durMatch
      ? (parseInt(durMatch[1] || 0) * 3600 + parseInt(durMatch[2] || 0) * 60 + parseInt(durMatch[3] || 0))
      : 0;

    res.json({
      title:        snippet.title          || '',
      channelTitle: snippet.channelTitle   || '',
      commentCount: parseInt(stats.commentCount  || 0),
      viewCount:    parseInt(stats.viewCount     || 0),
      likeCount:    parseInt(stats.likeCount     || 0),
      durationSec,                              // seconds
      durationMin:  Math.round(durationSec / 60),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/creator/scan-youtube', requireCreator, async (req, res) => {
  try {
    const { url, scan_type = 'comments' } = req.body;
    if (!url) return res.status(400).json({ error: 'YouTube URL is required' });
    if (!YOUTUBE_API_KEY) return res.status(503).json({ error: 'YouTube API key not configured. Add YOUTUBE_API_KEY to your environment.' });
    if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Anthropic API key not configured.' });

    // ── Extract video ID ──────────────────────────────────────
    let videoId = null;
    let channelId = null;
    let videoTitle = '';

    const videoMatch = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([a-zA-Z0-9_-]{11})/);
    if (videoMatch) {
      videoId = videoMatch[1];
    } else {
      const channelMatch = url.match(/youtube\.com\/(?:channel\/(UC[a-zA-Z0-9_-]+)|c\/([^/?]+)|@([^/?]+))/);
      if (channelMatch) {
        const handle = channelMatch[1] || channelMatch[2] || channelMatch[3];
        if (channelMatch[1]) {
          channelId = channelMatch[1];
        } else {
          const searchRes = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&maxResults=1&key=${YOUTUBE_API_KEY}`
          );
          const searchData = await searchRes.json();
          if (searchData.error) throw new Error(searchData.error.message);
          channelId = searchData.items?.[0]?.id?.channelId;
        }
        if (!channelId) return res.status(400).json({ error: 'Could not resolve YouTube channel. Try a direct video URL instead.' });

        const vidRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&type=video&maxResults=1&key=${YOUTUBE_API_KEY}`
        );
        const vidData = await vidRes.json();
        if (vidData.error) throw new Error(vidData.error.message);
        videoId = vidData.items?.[0]?.id?.videoId;
        videoTitle = vidData.items?.[0]?.snippet?.title || '';
        if (!videoId) return res.status(404).json({ error: 'No videos found for this channel.' });
      }
    }

    if (!videoId) return res.status(400).json({ error: 'Could not extract a video ID. Paste a YouTube video URL (e.g. youtube.com/watch?v=...)' });

    // ── Fetch video title if not already set ─────────────────
    if (!videoTitle) {
      const infoRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`);
      const infoData = await infoRes.json();
      if (infoData.error) throw new Error(infoData.error.message);
      videoTitle = infoData.items?.[0]?.snippet?.title || 'YouTube video';
    }

    const in30 = getDate(30);
    const in60 = getDate(60);
    const in90 = getDate(90);

    // ══════════════════════════════════════════════════════════
    // SCAN TYPE: comments
    // ══════════════════════════════════════════════════════════
    if (scan_type === 'comments') {
      const commentRes = await fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&order=relevance&maxResults=100&key=${YOUTUBE_API_KEY}`
      );
      const commentData = await commentRes.json();
      if (commentData.error) {
        if (commentData.error.code === 403) return res.status(403).json({ error: 'Comments are disabled for this video.' });
        throw new Error(commentData.error.message || 'YouTube API error');
      }

      const comments = (commentData.items || [])
        .map(item => item.snippet?.topLevelComment?.snippet?.textDisplay || '')
        .filter(Boolean);

      if (comments.length === 0) return res.status(404).json({ error: 'No comments found for this video.' });

      const commentBlock = comments.slice(0, 100)
        .map((c, i) => `${i + 1}. ${c.replace(/<[^>]+>/g, '').trim()}`)
        .join('\n');

      const prompt = `You are analyzing YouTube comments to generate prediction markets for a fan community.

Video title: "${videoTitle}"

COMMENTS (what fans are debating):
${commentBlock}

Generate 5-8 prediction markets based on the predictions, debates, and speculation in these comments. Focus on FUTURE questions fans want answered.

Rules:
- Clear YES or NO question, objectively resolvable
- Resolution dates: near=${in30}, mid=${in60}, far=${in90}
- No politics or harmful content

Return ONLY valid JSON:
{
  "markets": [
    { "question": "Will ...?", "category": "sports|entertainment|finance|politics|other", "resolution_date": "YYYY-MM-DD" }
  ]
}`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
      });
      const aiData = await aiRes.json();
      const rawText = aiData.content?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI returned invalid format');
      const markets = (JSON.parse(jsonMatch[0]).markets || []).map(m => ({ ...m, source: 'comments' }));

      return res.json({ markets, comment_markets: markets, comment_count: comments.length, video_title: videoTitle });
    }

    // ══════════════════════════════════════════════════════════
    // SCAN TYPE: transcript
    // ══════════════════════════════════════════════════════════
    if (scan_type === 'transcript') {
      const transcript = await fetchYouTubeTranscript(videoId);
      if (!transcript) return res.status(404).json({ error: 'No transcript available for this video. Captions may be disabled or not yet generated.' });

      const transcriptBlock = transcript.slice(0, 5000) + (transcript.length > 5000 ? '… [truncated]' : '');

      const prompt = `You are analyzing a YouTube video transcript to generate prediction markets for a fan community.

Video title: "${videoTitle}"

VIDEO TRANSCRIPT:
${transcriptBlock}

Generate 4-6 prediction markets based on:
- Claims or predictions the creator made in the video
- Upcoming events or plans the creator announced
- Things the creator said they would do next
- Challenges, bets, or goals mentioned

Each market should be verifiable against future events or follow-up content.

Rules:
- Clear YES or NO question, objectively resolvable
- Resolution dates: near=${in30}, mid=${in60}, far=${in90}
- Include a brief resolution_note explaining how to verify it

Return ONLY valid JSON:
{
  "markets": [
    { "question": "Will ...?", "category": "sports|entertainment|finance|politics|other", "resolution_date": "YYYY-MM-DD", "resolution_note": "how to verify" }
  ]
}`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
      });
      const aiData = await aiRes.json();
      const rawText = aiData.content?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI returned invalid format');
      const markets = (JSON.parse(jsonMatch[0]).markets || []).map(m => ({ ...m, source: 'transcript' }));

      return res.json({ markets, transcript_markets: markets, transcript_length: transcript.length, has_transcript: true, video_title: videoTitle });
    }

    // ══════════════════════════════════════════════════════════
    // SCAN TYPE: live_chat
    // ══════════════════════════════════════════════════════════
    if (scan_type === 'live_chat') {
      const messages = await fetchYouTubeLiveChat(videoId);
      if (!messages || messages.length === 0) {
        return res.status(404).json({ error: 'No live chat replay found for this video. The video must be a completed live stream with chat replay enabled.' });
      }

      const chatBlock = messages.slice(0, 200)
        .map((msg, i) => `${i + 1}. ${msg.trim()}`)
        .join('\n');

      const prompt = `You are analyzing a YouTube live stream chat replay to generate prediction markets for a fan community.

Video title: "${videoTitle}"

LIVE CHAT MESSAGES (${messages.length} total, showing up to 200):
${chatBlock}

Generate 4-7 prediction markets based on:
- Recurring questions or debates many viewers were asking
- Predictions viewers were making during the stream
- Speculation about upcoming outcomes or events
- Topics that generated visible excitement or disagreement

Focus on questions where the chat was divided — not settled facts.

Rules:
- Clear YES or NO question, objectively resolvable
- Resolution dates: near=${in30}, mid=${in60}, far=${in90}

Return ONLY valid JSON:
{
  "markets": [
    { "question": "Will ...?", "category": "sports|entertainment|finance|politics|other", "resolution_date": "YYYY-MM-DD" }
  ]
}`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
      });
      const aiData = await aiRes.json();
      const rawText = aiData.content?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI returned invalid format');
      const markets = (JSON.parse(jsonMatch[0]).markets || []).map(m => ({ ...m, source: 'live_chat' }));

      return res.json({ markets, live_chat_markets: markets, live_chat_count: messages.length, video_title: videoTitle });
    }

    // ══════════════════════════════════════════════════════════
    // SCAN TYPE: all  — fetch everything available, one AI call
    // ══════════════════════════════════════════════════════════
    if (scan_type === 'all') {
      // Run all three fetches in parallel; silence individual failures
      const [commentData, transcript, liveChatMessages] = await Promise.all([
        fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&order=relevance&maxResults=100&key=${YOUTUBE_API_KEY}`)
          .then(r => r.json()).catch(() => null),
        fetchYouTubeTranscript(videoId).catch(() => null),
        fetchYouTubeLiveChat(videoId).catch(() => null)
      ]);

      const sections = [];
      let commentCount = 0, hasTranscript = false, liveChatCount = 0;

      // Comments section
      const comments = (commentData?.items || [])
        .map(item => item.snippet?.topLevelComment?.snippet?.textDisplay || '')
        .filter(Boolean);
      if (comments.length > 0) {
        commentCount = comments.length;
        const block = comments.slice(0, 80).map((c, i) => `${i + 1}. ${c.replace(/<[^>]+>/g, '').trim()}`).join('\n');
        sections.push(`=== YOUTUBE COMMENTS (${comments.length}) ===\n${block}`);
      }

      // Transcript section
      if (transcript) {
        hasTranscript = true;
        const truncated = transcript.slice(0, 3000) + (transcript.length > 3000 ? '… [truncated]' : '');
        sections.push(`=== VIDEO TRANSCRIPT ===\n${truncated}`);
      }

      // Live chat section
      const liveMessages = liveChatMessages || [];
      if (liveMessages.length > 0) {
        liveChatCount = liveMessages.length;
        const block = liveMessages.slice(0, 150).map((m, i) => `${i + 1}. ${m.trim()}`).join('\n');
        sections.push(`=== LIVE CHAT (${liveMessages.length} messages) ===\n${block}`);
      }

      if (sections.length === 0) {
        return res.status(404).json({ error: 'No scannable content found. This video may have comments disabled and no captions. Try a different video.' });
      }

      const combinedContent = sections.join('\n\n');
      const sourceSummary = [
        commentCount > 0 ? `${commentCount} comments` : null,
        hasTranscript ? 'transcript' : null,
        liveChatCount > 0 ? `${liveChatCount} live chat msgs` : null
      ].filter(Boolean).join(' · ');

      const prompt = `You are analyzing a YouTube video to generate prediction markets for a fan community.

Video title: "${videoTitle}"

AVAILABLE CONTENT (${sourceSummary}):
${combinedContent}

Generate 6-10 diverse prediction markets by looking at:
- Predictions and debates fans are having in comments
- Claims, announcements, or goals the creator mentioned in the transcript
- Questions and speculation from live chat viewers
- Recurring themes that appear across multiple sources

Return the BEST markets — prioritize questions that are debatable, future-facing, and objectively resolvable.

Rules:
- Clear YES or NO question
- Resolution dates: near=${in30}, mid=${in60}, far=${in90}
- No politics or harmful content
- Avoid duplicates — each market should be about a distinct topic

Return ONLY valid JSON:
{
  "markets": [
    { "question": "Will ...?", "category": "sports|entertainment|finance|politics|other", "resolution_date": "YYYY-MM-DD", "source": "comments|transcript|live_chat" }
  ]
}`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 1800, messages: [{ role: 'user', content: prompt }] })
      });
      const aiData = await aiRes.json();
      const rawText = aiData.content?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI returned invalid format');
      const markets = JSON.parse(jsonMatch[0]).markets || [];

      return res.json({
        markets,
        video_title: videoTitle,
        comment_count: commentCount,
        has_transcript: hasTranscript,
        live_chat_count: liveChatCount,
        source_summary: sourceSummary
      });
    }

    return res.status(400).json({ error: 'Invalid scan_type. Use: all, comments, transcript, or live_chat.' });

  } catch (err) {
    console.error('scan-youtube error:', err);
    res.status(500).json({ error: err.message || 'Failed to scan YouTube video' });
  }
});

// ════════════════════════════════════════════════════════════
// TWITCH VOD SCANNER
// POST /api/creator/scan-twitch
// Body: { url }
// Returns: { markets, video_title, game_name, clip_count, source_summary }
// Requires: TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET env vars
// ════════════════════════════════════════════════════════════

async function getTwitchAccessToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error('Failed to get Twitch access token — check TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET');
  const data = await res.json();
  return data.access_token;
}

function extractTwitchVideoId(url) {
  const match = url.match(/twitch\.tv\/videos\/(\d+)/i);
  return match ? match[1] : null;
}

async function fetchTwitchVideoData(videoId, accessToken) {
  const headers = {
    'Client-ID': process.env.TWITCH_CLIENT_ID,
    'Authorization': `Bearer ${accessToken}`
  };

  const [videoRes, clipsRes] = await Promise.all([
    fetch(`https://api.twitch.tv/helix/videos?id=${videoId}`, { headers }),
    fetch(`https://api.twitch.tv/helix/clips?video_id=${videoId}&first=20`, { headers })
  ]);

  const videoData = await videoRes.json();
  const video = videoData.data?.[0];
  if (!video) throw new Error('Video not found. Make sure this is a Twitch VOD URL (twitch.tv/videos/...)');

  const clipsData = await clipsRes.json();
  const clips = clipsData.data || [];

  let gameName = null;
  if (video.game_id) {
    const gameRes = await fetch(`https://api.twitch.tv/helix/games?id=${video.game_id}`, { headers });
    const gameData = await gameRes.json();
    gameName = gameData.data?.[0]?.name || null;
  }

  return { video, clips, gameName };
}

app.post('/api/creator/scan-twitch', requireCreator, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Twitch VOD URL is required.' });
    if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Anthropic API key not configured.' });
    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
      return res.status(503).json({ error: 'Twitch API not configured. Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to your Railway environment variables.' });
    }

    const videoId = extractTwitchVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Could not extract a Twitch video ID. Paste a VOD URL — e.g. twitch.tv/videos/12345678' });

    const accessToken = await getTwitchAccessToken();
    const { video, clips, gameName } = await fetchTwitchVideoData(videoId, accessToken);

    const now = new Date();
    const in30 = new Date(now); in30.setDate(now.getDate() + 30);
    const in60 = new Date(now); in60.setDate(now.getDate() + 60);
    const in90 = new Date(now); in90.setDate(now.getDate() + 90);
    const fmt = d => d.toISOString().split('T')[0];

    const clipsBlock = clips.length > 0
      ? clips.map((c, i) => `${i + 1}. "${c.title}" — ${c.view_count.toLocaleString()} views`).join('\n')
      : 'No clips available for this VOD.';

    const durationMins = video.duration
      ? Math.round(video.duration.replace(/[^\d]/g, '') / 60)
      : null;

    const prompt = `You are analyzing a Twitch VOD to generate prediction markets for a fan community.

STREAM INFO:
Title: "${video.title}"
${gameName ? `Game/Category: ${gameName}` : ''}
${durationMins ? `Duration: ~${durationMins} minutes` : ''}
${video.view_count ? `Views: ${parseInt(video.view_count).toLocaleString()}` : ''}
${video.description ? `Description: ${video.description}` : ''}

TOP CLIPS FROM THIS STREAM (viewer-created highlights — reveals what the community cared about most):
${clipsBlock}

Generate 5-8 prediction markets based on:
- What the stream title and category suggest about upcoming events
- What clip titles reveal about the storylines or moments viewers found noteworthy
- Recurring themes, ongoing storylines, or rivalries suggested by the content
- Upcoming events related to this game/streamer/category

Rules:
- Every question must be clearly YES or NO and objectively resolvable
- Resolution dates: near=${fmt(in30)}, mid=${fmt(in60)}, far=${fmt(in90)}
- Focus on what THIS specific community would want to predict on
- No politics or harmful content

Return ONLY valid JSON:
{
  "markets": [
    { "question": "Will ...?", "category": "sports|esports|entertainment|finance|crypto|politics|news|other", "resolution_date": "YYYY-MM-DD" }
  ]
}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
    });
    const aiData = await aiRes.json();
    const rawText = aiData.content?.[0]?.text || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI returned invalid format');
    const markets = (JSON.parse(jsonMatch[0]).markets || []).map(m => ({ ...m, source: 'twitch' }));

    return res.json({
      markets,
      video_title: video.title,
      game_name: gameName,
      clip_count: clips.length,
      source_summary: `${clips.length} clips · ${gameName || 'Twitch VOD'}`
    });

  } catch (err) {
    console.error('scan-twitch error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to scan Twitch VOD' });
  }
});

// ════════════════════════════════════════════════════════════
// SCAN CONTENT — paste text from any platform (Twitch, Reddit, Discord, etc.)
// POST /api/creator/scan-content
// Body: { text: "...", source_label: "Twitch chat" | "Reddit thread" | ... }
// Returns: { markets, word_count, source_label }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/scan-content', requireCreator, async (req, res) => {
  try {
    const { text, source_label = 'content' } = req.body;
    const isTweet = source_label === 'tweet';
    const minLen = isTweet ? 10 : 50;
    if (!text || text.trim().length < minLen) return res.status(400).json({ error: isTweet ? 'Paste the tweet text first.' : 'Please paste at least a few lines of content to scan.' });
    if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Anthropic API key not configured.' });

    const wordCount = text.trim().split(/\s+/).length;
    const truncated = text.trim().slice(0, 6000) + (text.length > 6000 ? '\n… [truncated]' : '');

    const now = new Date();
    const in30 = new Date(now); in30.setDate(now.getDate() + 30);
    const in60 = new Date(now); in60.setDate(now.getDate() + 60);
    const in90 = new Date(now); in90.setDate(now.getDate() + 90);
    const fmt = d => d.toISOString().split('T')[0];

    const prompt = isTweet
      ? `You are generating prediction markets for a creator's community based on a single tweet.

TWEET:
${truncated}

Generate 1-3 tightly focused prediction markets directly inspired by the specific claim, prediction, or topic in this tweet. Each market must:
- Be a clear YES/NO question that directly tests what the tweet is asserting or implying
- Be objectively resolvable from public sources
- Resolution dates: near=${fmt(in30)}, mid=${fmt(in60)}, far=${fmt(in90)}
- Pick the most appropriate resolution date per question

Return ONLY this JSON:
{
  "markets": [
    { "question": "Will ...?", "category": "sports|esports|entertainment|finance|crypto|politics|news|other", "resolution_date": "YYYY-MM-DD" }
  ]
}`
      : `You are analyzing community content to generate prediction markets for a creator's audience.

Source type: ${source_label}

CONTENT:
${truncated}

Generate 4-7 prediction markets based on:
- Recurring topics, debates, or questions the community is discussing
- Predictions or speculation people are making
- Upcoming events or outcomes being anticipated
- Controversies or divided opinions

Rules:
- Every question must be clearly YES or NO, objectively resolvable
- Resolution dates: near=${fmt(in30)}, mid=${fmt(in60)}, far=${fmt(in90)}
- Pick the most appropriate resolution date per question
- Return ONLY valid JSON

Return ONLY this JSON:
{
  "markets": [
    { "question": "Will ...?", "category": "sports|esports|entertainment|finance|crypto|politics|news|other", "resolution_date": "YYYY-MM-DD" }
  ]
}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
    });
    const aiData = await aiRes.json();
    const rawText = aiData.content?.[0]?.text || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI returned invalid format');
    const markets = (JSON.parse(jsonMatch[0]).markets || []).map(m => ({ ...m, source: isTweet ? 'tweet' : 'paste' }));

    return res.json({ markets, word_count: wordCount, source_label });

  } catch (err) {
    console.error('scan-content error:', err);
    res.status(500).json({ error: err.message || 'Failed to scan content' });
  }
});

// ════════════════════════════════════════════════════════════
// 8. PUBLIC COMMUNITY PAGE DATA
// GET /api/community/:slug
// Returns public data for a creator's community page
// ════════════════════════════════════════════════════════════
// ── Community challenge helpers ────────────────────────────────
async function getChallengeProgress(settings) {
  if (!settings.challenge_metric || !settings.challenge_target || !settings.challenge_end_date) return null;
  if (new Date(settings.challenge_end_date) < new Date()) return null; // expired

  const slug = settings.slug;
  const metric = settings.challenge_metric;
  let current = 0;

  try {
    if (metric === 'bets') {
      // Trades placed since challenge started (approximated by week start Mon)
      const weekStart = getWeekStart();
      const { count } = await supabase
        .from('positions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_slug', slug)
        .gte('created_at', weekStart);
      current = count || 0;
    } else if (metric === 'members') {
      const { count } = await supabase
        .from('community_balances')
        .select('id', { count: 'exact', head: true })
        .eq('creator_slug', slug);
      current = count || 0;
    } else if (metric === 'volume') {
      const { data: mkts } = await supabase
        .from('markets')
        .select('volume')
        .or(`tenant_slug.eq.${slug},creator_id.eq.${settings.creator_id}`)
        .eq('is_public', true);
      current = Math.round((mkts || []).reduce((s, m) => s + (m.volume || 0), 0) / 100);
    }
  } catch {}

  return {
    current,
    target:     settings.challenge_target,
    pct:        Math.min(100, Math.round((current / settings.challenge_target) * 100)),
    complete:   current >= settings.challenge_target,
    end_date:   settings.challenge_end_date,
    bonus_pts:  settings.challenge_bonus_pts || 0,
    title:      settings.challenge_title || 'Community Challenge',
    metric
  };
}

function getWeekStart() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() + diff);
  mon.setUTCHours(0, 0, 0, 0);
  return mon.toISOString();
}

// PUT /api/creator/challenge — set or clear active challenge
app.put('/api/creator/challenge', requireCreator, async (req, res) => {
  try {
    const { title, metric, target, bonus_pts, end_date, clear } = req.body;

    if (clear) {
      await supabase.from('creator_settings').update({
        challenge_title: null, challenge_metric: null,
        challenge_target: null, challenge_bonus_pts: 0, challenge_end_date: null
      }).eq('creator_id', req.creator.id);
      return res.json({ ok: true });
    }

    if (!metric || !['bets','members','volume'].includes(metric)) return res.status(400).json({ error: 'metric must be bets, members, or volume' });
    if (!target || target < 1) return res.status(400).json({ error: 'target required' });
    if (!end_date) return res.status(400).json({ error: 'end_date required' });

    await supabase.from('creator_settings').update({
      challenge_title:     title    || 'Community Challenge',
      challenge_metric:    metric,
      challenge_target:    parseInt(target),
      challenge_bonus_pts: Math.max(0, parseInt(bonus_pts) || 0),
      challenge_end_date:  new Date(end_date).toISOString()
    }).eq('creator_id', req.creator.id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/community/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const { data: settings } = await supabase
      .from('creator_settings')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (!settings) return res.status(404).json({ error: 'Community not found' });

    // Match on any of the three fields that market-creation routes populate.
    // Use select('*') so missing columns from pending migrations never break the query.
    const { data: rawMarkets, error: marketsErr } = await supabase
      .from('markets')
      .select('*')
      .or(`tenant_slug.eq.${slug},creator_id.eq.${settings.creator_id}`)
      .neq('is_public', false)   // include true AND null (legacy markets without is_public set)
      .order('created_at', { ascending: false });
    if (marketsErr) console.error('[community markets query]', marketsErr.message);

    // Real unique member count — distinct users who have a community_balances row for this slug
    const { count: memberCount } = await supabase
      .from('community_balances')
      .select('user_id', { count: 'exact', head: true })
      .eq('creator_slug', slug);

    // Recent activity feed — last 20 real bets across this community's markets
    const marketIds = (rawMarkets || []).map(m => m.id);
    let recentActivity = [];
    if (marketIds.length > 0) {
      const { data: recentPositions } = await supabase
        .from('positions')
        .select('user_id, market_id, side, amount, created_at')
        .in('market_id', marketIds)
        .order('created_at', { ascending: false })
        .limit(20);

      if (recentPositions && recentPositions.length > 0) {
        // Fetch display names for unique users (anonymise if null)
        const uniqueUserIds = [...new Set(recentPositions.map(p => p.user_id))];
        const { data: userRows } = await supabase
          .from('users')
          .select('id, display_name')
          .in('id', uniqueUserIds);
        const userMap = Object.fromEntries((userRows || []).map(u => [u.id, u.display_name || 'Someone']));

        // Build market question lookup
        const mktMap = Object.fromEntries((rawMarkets || []).map(m => [m.id, m.question]));

        recentActivity = recentPositions.map(p => ({
          name:       userMap[p.user_id] || 'Someone',
          side:       p.side,
          amount:     Math.round((p.amount || 0) / 100),
          question:   mktMap[p.market_id] || '',
          market_id:  p.market_id,
          created_at: p.created_at,
        }));
      }
    }
    // Normalize outcome → resolution_outcome so community.html doesn't need changes
    const markets = (rawMarkets || []).map(m => ({ ...m, resolution_outcome: m.outcome || null }));

    res.json({
      community: {
        display_name:         settings.display_name,
        slug:                 settings.slug,
        custom_points_name:   settings.custom_points_name,
        primary_color:        settings.primary_color,
        community_description: settings.community_description || null,
        plan:                 settings.plan || 'free',
        plan_scheduled_change: settings.plan_scheduled_change || null,
        plan_change_date:      settings.plan_change_date      || null,
        // Economy settings
        starting_balance:     settings.starting_balance ?? 100000,
        min_bet:              settings.min_bet ?? 1000,
        max_bet:              settings.max_bet ?? null,
        referral_reward:      settings.referral_reward ?? 10000,
        welcome_bonus:        settings.welcome_bonus ?? 5000,
        // Branding
        logo_url:             settings.logo_url       || null,
        banner_url:           settings.banner_url     || null,
        banner_position:      settings.banner_position || '50% 50%',
        font_choice:          settings.font_choice || 'Syne',
        social_twitter:       settings.social_twitter  || null,
        social_youtube:       settings.social_youtube  || null,
        social_discord:       settings.social_discord  || null,
        social_twitch:        settings.social_twitch   || null,
        // Community challenge
        challenge_title:      settings.challenge_title      || null,
        challenge_metric:     settings.challenge_metric     || null,
        challenge_target:     settings.challenge_target     || null,
        challenge_bonus_pts:  settings.challenge_bonus_pts  || 0,
        challenge_end_date:   settings.challenge_end_date   || null,
        suggestions_enabled:  settings.suggestions_enabled  || false,
        creator_id:           settings.creator_id
      },
      member_count: memberCount || 0,
      markets: markets || [],
      recent_activity: recentActivity,
      rewards: await supabase
        .from('creator_rewards')
        .select('id, threshold, title, description')
        .eq('creator_id', settings.creator_id)
        .order('threshold', { ascending: true })
        .then(r => r.data || []),
      challenge_progress: await getChallengeProgress(settings),
      announcements: await supabase.from('creator_announcements')
        .select('id, title, body, pinned, created_at')
        .eq('creator_slug', slug)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20)
        .then(r => {
          const rows = r.data || [];
          // Deduplicate by title — keep the first occurrence (most recent)
          const seen = new Set();
          return rows.filter(a => {
            const key = a.title.trim().toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).slice(0, 5);
        })
    });

  } catch (err) {
    console.error('community page error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 8b. MARKET SUGGESTIONS
// ── CREATOR FOLLOWS ──────────────────────────────────────────────────────────
// POST /api/community/:slug/follow-social — social follow/unfollow toggle (auth)
// GET  /api/user/following                — list slugs the current user follows

app.post('/api/community/:slug/follow-social', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.id;

    const { data: existing } = await supabase
      .from('creator_follows')
      .select('id')
      .eq('user_id', userId)
      .eq('creator_slug', slug)
      .maybeSingle();

    if (existing) {
      await supabase.from('creator_follows').delete().eq('id', existing.id);
      res.json({ following: false });
    } else {
      await supabase.from('creator_follows').insert([{ user_id: userId, creator_slug: slug }]);
      res.json({ following: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/following', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('creator_follows')
      .select('creator_slug, followed_at')
      .eq('user_id', req.user.id)
      .order('followed_at', { ascending: false });
    if (error) throw error;
    res.json({ following: (data || []).map(r => r.creator_slug) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST   /api/community/:slug/suggest   — member submits a market idea
// GET    /api/creator/suggestions       — creator sees pending queue
// POST   /api/creator/suggestions/:id/approve — approve (creates market draft)
// POST   /api/creator/suggestions/:id/reject  — reject
// PUT    /api/creator/settings/suggestions    — toggle suggestions_enabled
// ════════════════════════════════════════════════════════════

// Member submits a suggestion (auth required)
app.post('/api/community/:slug/suggest', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to suggest a market.' });

    const { slug } = req.params;
    const { question, context } = req.body;
    if (!question || question.trim().length < 10) return res.status(400).json({ error: 'Question must be at least 10 characters.' });
    if (question.length > 280) return res.status(400).json({ error: 'Question too long (max 280 chars).' });

    // Check suggestions enabled
    const { data: settings } = await supabase.from('creator_settings').select('suggestions_enabled, creator_id').eq('slug', slug).maybeSingle();
    if (!settings) return res.status(404).json({ error: 'Community not found.' });
    if (!settings.suggestions_enabled) return res.status(403).json({ error: 'Market suggestions are not enabled for this community.' });

    // Rate-limit: max 3 pending suggestions per user per community
    const { count } = await supabase.from('market_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('creator_slug', slug).eq('user_id', userId).eq('status', 'pending');
    if (count >= 3) return res.status(429).json({ error: 'You have 3 pending suggestions — wait for the creator to review them first.' });

    // Get user display name
    const { data: profile } = await supabase.from('users').select('display_name, username, email').eq('id', userId).maybeSingle();
    const user_name = profile?.display_name || profile?.username || (profile?.email ? profile.email.split('@')[0] : 'Anonymous');

    const { data: suggestion, error } = await supabase.from('market_suggestions').insert({
      creator_slug: slug, user_id: userId, user_name,
      question: question.trim(), context: context?.trim() || null, status: 'pending'
    }).select().single();
    if (error) throw error;

    res.json({ ok: true, id: suggestion.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Creator views pending suggestions
app.get('/api/creator/suggestions', requireCreator, async (req, res) => {
  try {
    const { data: settings } = await supabase.from('creator_settings').select('slug').eq('creator_id', req.creator.id).single();
    if (!settings) return res.status(404).json({ error: 'No community found.' });
    const { data: suggestions } = await supabase.from('market_suggestions')
      .select('id, question, context, user_name, status, created_at')
      .eq('creator_slug', settings.slug)
      .order('created_at', { ascending: false });
    res.json({ suggestions: suggestions || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Creator approves a suggestion — sends back the question pre-filled for market creation
app.post('/api/creator/suggestions/:id/approve', requireCreator, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: settings } = await supabase.from('creator_settings').select('slug').eq('creator_id', req.creator.id).single();
    const { data: sug } = await supabase.from('market_suggestions').select('*').eq('id', id).eq('creator_slug', settings.slug).single();
    if (!sug) return res.status(404).json({ error: 'Suggestion not found.' });

    await supabase.from('market_suggestions').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', id);
    res.json({ ok: true, question: sug.question });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Creator rejects a suggestion
app.post('/api/creator/suggestions/:id/reject', requireCreator, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: settings } = await supabase.from('creator_settings').select('slug').eq('creator_id', req.creator.id).single();
    await supabase.from('market_suggestions').update({ status: 'rejected', reviewed_at: new Date().toISOString() })
      .eq('id', id).eq('creator_slug', settings.slug);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle suggestions_enabled
app.put('/api/creator/settings/suggestions', requireCreator, async (req, res) => {
  try {
    const { enabled } = req.body;
    await supabase.from('creator_settings').update({ suggestions_enabled: !!enabled }).eq('creator_id', req.creator.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 8d. ANNOUNCEMENTS
// POST   /api/creator/announcements         — create
// GET    /api/community/:slug/announcements — public list
// DELETE /api/creator/announcements/:id     — delete
// ════════════════════════════════════════════════════════════

app.post('/api/creator/announcements', requireCreator, async (req, res) => {
  try {
    const { data: settings } = await supabase.from('creator_settings').select('slug').eq('creator_id', req.creator.id).single();
    const { title, body, pinned } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title required.' });
    const { data, error } = await supabase.from('creator_announcements')
      .insert({ creator_slug: settings.slug, title: title.trim().slice(0,200), body: (body||'').trim().slice(0,1000), pinned: !!pinned })
      .select().single();
    if (error) throw error;
    res.json({ ok: true, announcement: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/community/:slug/announcements', async (req, res) => {
  try {
    const { data } = await supabase.from('creator_announcements')
      .select('id, title, body, pinned, created_at')
      .eq('creator_slug', req.params.slug)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    res.json({ announcements: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/creator/announcements/:id', requireCreator, async (req, res) => {
  try {
    const { data: settings } = await supabase.from('creator_settings').select('slug').eq('creator_id', req.creator.id).single();
    await supabase.from('creator_announcements').delete().eq('id', req.params.id).eq('creator_slug', settings.slug);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// 8e. MARKET COMMENTS
// GET  /api/community/:slug/markets/:marketId/comments
// POST /api/community/:slug/markets/:marketId/comments  (auth)
// ════════════════════════════════════════════════════════════

app.get('/api/community/:slug/markets/:marketId/comments', async (req, res) => {
  try {
    const { data } = await supabase.from('market_comments')
      .select('id, user_name, body, created_at')
      .eq('market_id', req.params.marketId)
      .eq('creator_slug', req.params.slug)
      .order('created_at', { ascending: true })
      .limit(50);
    res.json({ comments: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/community/:slug/markets/:marketId/comments', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to comment.' });
    const { body } = req.body;
    if (!body || body.trim().length < 1) return res.status(400).json({ error: 'Comment cannot be empty.' });
    if (body.trim().length > 280) return res.status(400).json({ error: 'Comment too long (max 280 chars).' });
    const { data: profile } = await supabase.from('users').select('display_name, username, email').eq('id', userId).maybeSingle();
    const user_name = profile?.display_name || profile?.username || (profile?.email ? profile.email.split('@')[0] : 'Anonymous');
    const { data, error } = await supabase.from('market_comments')
      .insert({ market_id: req.params.marketId, creator_slug: req.params.slug, user_id: userId, user_name, body: body.trim() })
      .select().single();
    if (error) throw error;
    res.json({ ok: true, comment: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// 8c. EDIT / DELETE MARKET
// PUT  /markets/:id   — update question, expiry_date, resolution_source, category
// DELETE /markets/:id — archive market (set is_public=false)
// ════════════════════════════════════════════════════════════

app.put('/markets/:id', requireCreator, async (req, res) => {
  try {
    const { id } = req.params;
    const { question, expiry_date, resolution_source, category, is_public, sponsor_name } = req.body;

    // Verify ownership; also fetch current is_public so we can detect publish transition
    const { data: market } = await supabase
      .from('markets')
      .select('id, creator_id, is_public, tenant_slug, question')
      .eq('id', id)
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found or not yours' });

    const updates = {};
    if (question !== undefined) updates.question = question;
    if (expiry_date !== undefined) updates.expiry_date = expiry_date;
    if (resolution_source !== undefined) updates.resolution_source = resolution_source;
    if (category !== undefined) { updates.category = category; updates.commodity = category; }
    if (is_public !== undefined) updates.is_public = is_public;
    if (sponsor_name !== undefined) updates.sponsor_name = sponsor_name || null;

    const { data, error } = await supabase
      .from('markets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Fire new-market notifications when a draft gets published
    const beingPublished = is_public === true && market.is_public !== true;
    if (beingPublished && market.tenant_slug) {
      sendNewMarketNotifications(data, market.tenant_slug).catch(() => {});
      sendDiscordWebhook(data, market.tenant_slug).catch(() => {});
      maybeAcceptReferral(market.tenant_slug).catch(() => {});
    }

    res.json({ ok: true, market: data });
  } catch (err) {
    console.error('market update error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/markets/:id', requireCreator, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: market } = await supabase
      .from('markets')
      .select('id, creator_id')
      .eq('id', id)
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found or not yours' });

    const { error } = await supabase
      .from('markets')
      .update({ archived: true, is_public: false })
      .eq('id', id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('market delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 9. SERVE CREATOR PAGES
// These routes serve the HTML files
// ════════════════════════════════════════════════════════════

// Signup page
// Public discovery page
app.get('/discover', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'discover.html'));
});

app.get('/creator/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'creator-signup.html'));
});

// Creator Terms of Service
app.get('/creator/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'creator-terms.html'));
});

// Login page
app.get('/creator/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'creator-login.html'));
});

// Dashboard (protected - auth handled client-side via localStorage token)
app.get('/creator/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'creator-dashboard.html'));
});

// Smart dashboard router — checks auth tokens in localStorage, routes to the right dashboard
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>HYPERFLEX</title></head><body><script>
    if (localStorage.getItem('hf_creator_token') || localStorage.getItem('hf_token')) {
      location.replace('/creator/dashboard');
    } else if (localStorage.getItem('hf_member_token')) {
      location.replace('/my');
    } else {
      location.replace('/creator/login');
    }
  </script></body></html>`);
});

// ════════════════════════════════════════════════════════════
// 9b. PRO WAITLIST
// POST /api/creator/waitlist
// Auth: requireCreator — stores email in pro_waitlist table
// ════════════════════════════════════════════════════════════
app.post('/api/creator/waitlist', requireCreator, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const creator_id = req.creator.id;

    const { error } = await supabase
      .from('pro_waitlist')
      .upsert({ email: email.toLowerCase().trim(), creator_id }, { onConflict: 'email' });

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error('waitlist error:', err);
    res.status(500).json({ error: err.message || 'Failed to join waitlist' });
  }
});

// ════════════════════════════════════════════════════════════
// STRIPE — Checkout & billing portal
// ════════════════════════════════════════════════════════════

// POST /api/creator/create-checkout-session
// Body: { tier: 'pro' | 'platinum' }
// Returns: { url } — redirect the browser there
app.post('/api/creator/create-checkout-session', requireCreator, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured' });
  try {
    const { tier } = req.body;
    const priceId = tier === 'platinum'
      ? process.env.STRIPE_PLATINUM_PRICE_ID
      : process.env.STRIPE_PRO_PRICE_ID;

    if (!priceId) return res.status(400).json({ error: 'Stripe price not configured for this tier' });

    const APP_URL = process.env.APP_URL || 'https://hyperflex.network';
    const creatorSlug = req.creator.slug;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: req.creator.email,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { creator_id: String(req.creator.id), slug: creatorSlug },
      success_url: APP_URL + '/creator/dashboard?upgraded=1',
      cancel_url:  APP_URL + '/creator/dashboard',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/creator/billing-portal
// Returns: { url } — Stripe-hosted subscription management page
app.get('/api/creator/billing-portal', requireCreator, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured' });
  try {
    const APP_URL = process.env.APP_URL || 'https://hyperflex.network';
    // Find the Stripe customer by email
    const customers = await stripe.customers.list({ email: req.creator.email, limit: 1 });
    if (!customers.data.length) {
      return res.status(404).json({ error: 'No billing account found. Please subscribe first.' });
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: APP_URL + '/creator/dashboard',
    });
    res.json({ url: portal.url });
  } catch (err) {
    console.error('[stripe] billing portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// OAUTH — Google & X (Twitter) sign-in for creators
// ════════════════════════════════════════════════════════════

// ── OAuth helpers ────────────────────────────────────────────
// We sign the OAuth state as a short-lived JWT so we don't need
// server-side session storage. Twitter PKCE verifier is embedded in it.
function makeOAuthState(data) {
  return jwt.sign({ ...data, _ts: Date.now() }, JWT_SECRET, { expiresIn: '10m' });
}
function verifyOAuthState(state) {
  return jwt.verify(state, JWT_SECRET);
}

// Route 1: GET /auth/oauth?provider=google|x
// Redirects to the provider's auth page
app.get('/auth/oauth', (req, res) => {
  const provider = (req.query.provider || '').toLowerCase();
  const APP_URL = process.env.APP_URL || 'https://hyperflex.network';
  const redirectUri = APP_URL + '/auth/callback';

  if (provider === 'google') {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.redirect('/creator/login?error=Google+OAuth+not+configured');
    }
    const state = makeOAuthState({ provider: 'google' });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'online');
    return res.redirect(url.toString());
  }

  if (provider === 'x') {
    if (!process.env.TWITTER_CLIENT_ID) {
      return res.redirect('/creator/login?error=Twitter+OAuth+not+configured');
    }
    // Twitter OAuth 2.0 requires PKCE — embed verifier in signed state JWT
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = makeOAuthState({ provider: 'x', verifier });
    const url = new URL('https://twitter.com/i/oauth2/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', process.env.TWITTER_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'tweet.read users.read');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return res.redirect(url.toString());
  }

  return res.redirect('/creator/login?error=invalid_provider');
});

// Route 2: GET /auth/callback?code=...&state=...
// Handles both Google and Twitter callbacks
app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/creator/login?error=' + encodeURIComponent(error));
    if (!code || !state) return res.redirect('/creator/login?error=missing_params');

    let stateData;
    try { stateData = verifyOAuthState(state); }
    catch { return res.redirect('/creator/login?error=invalid_or_expired_state'); }

    const provider = stateData.provider;
    const APP_URL = process.env.APP_URL || 'https://hyperflex.network';
    const redirectUri = APP_URL + '/auth/callback';

    let email = '';
    let displayName = 'Creator';

    // ── Google ────────────────────────────────────────────────
    if (provider === 'google') {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri:  redirectUri,
          grant_type:    'authorization_code'
        })
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

      const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
      });
      const info = await infoRes.json();
      email       = (info.email || '').toLowerCase();
      displayName = info.name || email.split('@')[0] || 'Creator';
    }

    // ── Twitter / X ───────────────────────────────────────────
    if (provider === 'x') {
      const creds = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64');
      const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + creds
        },
        body: new URLSearchParams({
          code,
          grant_type:    'authorization_code',
          client_id:     process.env.TWITTER_CLIENT_ID,
          redirect_uri:  redirectUri,
          code_verifier: stateData.verifier
        })
      });
      const tokenData = await tokenRes.json();
      console.log('[twitter oauth] token response:', JSON.stringify({ ...tokenData, access_token: tokenData.access_token ? '[REDACTED]' : undefined }));
      if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

      const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=id,name,username', {
        headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
      });
      const userData = await userRes.json();
      console.log('[twitter oauth] user response:', JSON.stringify(userData));

      // Surface Twitter API errors — if data is missing there's usually an errors array
      if (!userData.data && userData.errors) {
        const errMsg = userData.errors.map(e => e.message || e.title || JSON.stringify(e)).join('; ');
        console.error('[twitter oauth] API errors:', errMsg);
        return res.redirect('/creator/login?error=' + encodeURIComponent('Twitter error: ' + errMsg));
      }
      if (!userData.data && userData.title) {
        // Top-level error response like {"title":"Unauthorized","type":"...","status":401}
        return res.redirect('/creator/login?error=' + encodeURIComponent('Twitter: ' + userData.title));
      }

      const tUser   = userData.data || {};
      displayName   = tUser.name || tUser.username || 'Creator';
      // Use real email if Twitter returns it (requires "Request email" enabled in app settings)
      email         = tUser.email ? tUser.email.toLowerCase() : `twitter_${tUser.id || Date.now()}@oauth.hyperflex.app`;
    }

    if (!email) return res.redirect('/creator/login?error=no_email_returned');

    // ── Find or create user in our DB ─────────────────────────
    let { data: dbUser } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    if (!dbUser) {
      const { data: inserted, error: insertErr } = await supabase
        .from('users')
        .insert({ email, display_name: displayName, password_hash: '', is_creator: true, balance: 100000 })
        .select()
        .single();
      if (insertErr) throw new Error(insertErr.message);
      dbUser = inserted;
    }

    // ── Existing creator → go to dashboard ───────────────────
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('creator_id', dbUser.id)
      .maybeSingle();

    if (settings?.slug) {
      const token = makeToken({ id: dbUser.id, email: dbUser.email, slug: settings.slug });
      return res.redirect('/creator/dashboard#token=' + encodeURIComponent(token));
    }

    // ── New creator → finish setup on signup page ─────────────
    const tempToken = jwt.sign(
      { id: dbUser.id, email: dbUser.email, display_name: displayName, oauth: true },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    return res.redirect(
      '/creator/signup?oauth_token=' + encodeURIComponent(tempToken) +
      '&email=' + encodeURIComponent(email) +
      '&display_name=' + encodeURIComponent(displayName)
    );

  } catch (err) {
    console.error('auth/callback error:', err.message);
    return res.redirect('/creator/login?error=' + encodeURIComponent(err.message));
  }
});

// Route 3: POST /api/creator/oauth-complete
// Called from creator-signup.html after OAuth user picks community name + slug
app.post('/api/creator/oauth-complete', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'No token' });

    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); }
    catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
    if (!payload?.oauth) return res.status(401).json({ error: 'OAuth completion token required' });

    const { display_name, slug } = req.body || {};
    if (!display_name || !slug) return res.status(400).json({ error: 'display_name and slug required' });
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) return res.status(400).json({ error: 'Invalid slug format' });

    const { data: existing } = await supabase.from('creator_settings').select('slug').eq('slug', slug).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Slug already taken' });

    const { error: insErr } = await supabase.from('creator_settings').insert({
      creator_id:          payload.id,
      slug,
      display_name,
      custom_points_name:  'Flex Points',
      primary_color:       '#c9920d',
      is_active:           true,
      plan:                'free',
      created_at:          new Date().toISOString()
    });
    if (insErr) return res.status(500).json({ error: insErr.message });

    await supabase.from('users').update({ display_name, tenant_slug: slug, is_creator: true }).eq('id', payload.id);

    const newToken = makeToken({ id: payload.id, email: payload.email, slug });
    return res.json({ token: newToken, user: { id: payload.id, email: payload.email, display_name, slug } });
  } catch (err) {
    console.error('oauth-complete error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// SEARCH — GET /api/search?q=query[&userId=...for communities in common]
// Returns: { communities: [...], users: [...] }
// No auth required; pass Authorization header to get communities_in_common
// ════════════════════════════════════════════════════════════
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim().toLowerCase();
    if (!q || q.length < 2) return res.json({ communities: [], users: [] });

    // Optional: resolve caller's community slugs for "in common" calc
    let mySlugSet = new Set();
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        const { data: myBals } = await supabase
          .from('community_balances')
          .select('creator_slug')
          .eq('user_id', payload.id);
        (myBals || []).forEach(b => mySlugSet.add(b.creator_slug));
      } catch {}
    }

    // Run community + user search in parallel
    const [settingsRes, usersRes] = await Promise.all([
      supabase
        .from('creator_settings')
        .select('slug, display_name, logo_url, primary_color, custom_points_name')
        .or(`slug.ilike.%${q}%,display_name.ilike.%${q}%`)
        .limit(12),
      supabase
        .from('users')
        .select('id, display_name')
        .ilike('display_name', `%${q}%`)
        .limit(12),
    ]);

    // Enrich communities with member count
    const slugs = (settingsRes.data || []).map(s => s.slug);
    let memberCounts = {};
    if (slugs.length) {
      const { data: balRows } = await supabase
        .from('community_balances')
        .select('creator_slug')
        .in('creator_slug', slugs);
      (balRows || []).forEach(b => { memberCounts[b.creator_slug] = (memberCounts[b.creator_slug] || 0) + 1; });
    }

    const communities = (settingsRes.data || []).map(s => ({
      slug:               s.slug,
      display_name:       s.display_name || s.slug,
      logo_url:           s.logo_url || null,
      primary_color:      s.primary_color || '#c9920d',
      custom_points_name: s.custom_points_name || 'Flex Points',
      member_count:       memberCounts[s.slug] || 0,
      i_follow:           mySlugSet.has(s.slug),
    }));

    // Enrich users with their community slugs for "in common" calc
    const userIds = (usersRes.data || []).map(u => u.id);
    let userCommunityMap = {};
    if (userIds.length) {
      const { data: ubals } = await supabase
        .from('community_balances')
        .select('user_id, creator_slug')
        .in('user_id', userIds);
      (ubals || []).forEach(b => {
        if (!userCommunityMap[b.user_id]) userCommunityMap[b.user_id] = [];
        userCommunityMap[b.user_id].push(b.creator_slug);
      });
    }

    const users = (usersRes.data || []).map(u => {
      const theirSlugs = userCommunityMap[u.id] || [];
      const common = theirSlugs.filter(s => mySlugSet.has(s));
      return {
        id:           u.id,
        display_name: u.display_name || 'Member',
        community_slugs: theirSlugs,
        communities_in_common: common,
      };
    });

    res.json({ communities, users });
  } catch (err) {
    console.error('[search] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 10. PUBLIC COMMUNITY PAGE (slug catch-all — must be last)
// GET /:slug  →  serves community.html with SSR'd OG meta tags
// Crawlers (Discord, Twitter, Slack, iMessage) need meta tags in the HTML
// response — they don't execute JS. We SSR the <head> for every community page.
// ════════════════════════════════════════════════════════════
const RESERVED_SLUGS = new Set([
  'creator', 'api', 'auth', 'markets', 'positions', 'leaderboard',
  'trade', 'register', 'login', 'favicon.ico', 'robots.txt', 'admin',
  'explore', 'signup', 'pricing', 'about', 'terms', 'privacy', 'discover', 'u', 'win',
  'm', 'nominate', 'my', 'embed', 'ref', 'templates', 'widget', 'share', 'predictors', 'odds'
]);

// GET /my — private member dashboard
app.get('/my', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user-dashboard.html')));

// GET /templates — market template gallery (SEO + activation)
app.get('/templates', (req, res) => res.sendFile(path.join(__dirname, 'public', 'templates.html')));

// GET /api/templates — return all template metadata (no markets, for gallery)
app.get('/api/templates', (req, res) => {
  const gallery = Object.entries(TEMPLATES).map(([id, tpl]) => ({
    id,
    name: tpl.name,
    emoji: tpl.emoji || '🎯',
    description: tpl.description || '',
    count: tpl.markets.length,
    preview: tpl.markets.slice(0, 2).map(m => m.question),
  }));
  res.json(gallery);
});

// ── CREATOR REFERRAL PROGRAM ─────────────────────────────────────────────────
// GET /ref/:slug — referral landing page: tracks the referring creator then
//   redirects to creator signup with ?ref=slug so the signup page can claim it.
app.get('/ref/:slug', async (req, res) => {
  const { slug } = req.params;
  if (RESERVED_SLUGS.has(slug)) return res.redirect('/creator/signup');
  // Verify the referring creator exists
  const { data: cs } = await supabase
    .from('creator_settings')
    .select('slug, display_name')
    .eq('slug', slug)
    .maybeSingle();
  if (!cs) return res.redirect('/creator/signup');
  // Redirect to signup with referral attribution
  res.redirect(`/creator/signup?ref=${encodeURIComponent(slug)}`);
});

// GET /api/creator/referral-stats — how many creators this creator has referred
app.get('/api/creator/referral-stats', requireCreator, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('creator_referrals')
      .select('id, accepted, accepted_at')
      .eq('referrer_slug', req.creator.slug);
    if (error) throw error;
    const rows = data || [];
    const accepted = rows.filter(r => r.accepted);
    res.json({
      referred_creators: rows.length,
      accepted_creators: accepted.length,
      months_earned:     accepted.length, // 1 month free per accepted referral
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /embed/:slug — iframeable widget. Sets frame-ancestors * so Twitter can embed it.
app.get('/embed/:slug', async (req, res) => {
  // Serve the static embed.html but with frame-allow headers
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.sendFile(path.join(__dirname, 'public', 'embed.html'));
});

// GET /widget/:slug — Twitter Player Card landing page.
// This is what creators share on X. Twitter sees the player card meta tags
// and renders the /embed/:slug widget inline in the tweet.
app.get('/widget/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { data: cs } = await supabase
      .from('creator_settings')
      .select('display_name, primary_color, custom_points_name')
      .eq('slug', slug)
      .maybeSingle();
    if (!cs) return res.status(404).send('Community not found');

    const communityName = cs.display_name || slug;
    const accentColor   = cs.primary_color || '#c9920d';
    const embedUrl      = `https://hyperflex.network/embed/${slug}`;
    const communityUrl  = `https://hyperflex.network/${slug}`;
    const widgetUrl     = `https://hyperflex.network/widget/${slug}`;
    const ogImage       = `https://hyperflex.network/og-image.png`;

    // Fetch top 3 markets for fallback description
    const { data: markets } = await supabase
      .from('markets')
      .select('id, question, yes_price, no_price')
      .eq('tenant_slug', slug)
      .eq('resolved', false)
      .neq('is_public', false)
      .order('trader_count', { ascending: false })
      .limit(3);

    const mktCount   = markets?.length || 0;
    const topQ       = markets?.[0]?.question;
    const description = topQ
      ? `${mktCount} live market${mktCount !== 1 ? 's' : ''} — "${topQ}" and more. Make your predictions on ${communityName}.`
      : `Live prediction markets on ${communityName}. Make your predictions on HYPERFLEX.`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${communityName} — Live Prediction Markets</title>

<!-- Standard OG (LinkedIn, Slack, etc.) -->
<meta property="og:title" content="${communityName} — Live Prediction Markets">
<meta property="og:description" content="${description.replace(/"/g,'&quot;')}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${widgetUrl}">
<meta property="og:type" content="website">

<!-- Twitter Player Card — lets the embed widget render inline in tweets -->
<!-- Note: Player Cards require Twitter's domain approval for interactive mode. -->
<!-- Until approved, Twitter falls back to summary_large_image card. -->
<meta name="twitter:card" content="player">
<meta name="twitter:site" content="@HyperFlexapp">
<meta name="twitter:title" content="${communityName} — Live Prediction Markets">
<meta name="twitter:description" content="${description.replace(/"/g,'&quot;')}">
<meta name="twitter:image" content="${ogImage}">
<meta name="twitter:player" content="${embedUrl}">
<meta name="twitter:player:width" content="480">
<meta name="twitter:player:height" content="480">
<meta name="twitter:player:stream" content="">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0f0d;color:#e2ddd6;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px}
  .logo{font-family:'Syne',sans-serif;font-weight:800;font-size:16px;color:#c9920d;letter-spacing:.06em;margin-bottom:12px}
  h1{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#f0ebe3;text-align:center;margin-bottom:8px}
  .sub{font-size:14px;color:#6b6860;text-align:center;margin-bottom:32px;line-height:1.6;max-width:440px}
  .widget-frame{width:100%;max-width:480px;height:480px;border:1px solid rgba(201,146,13,0.25);border-radius:16px;overflow:hidden}
  .cta{display:inline-block;margin-top:20px;padding:12px 28px;background:linear-gradient(135deg,#c9920d,#e8a91a);border-radius:8px;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;color:#141412;text-decoration:none;letter-spacing:.02em}
</style>
</head>
<body>
  <div class="logo">HYPERFLEX</div>
  <h1>${communityName}</h1>
  <p class="sub">${description}</p>
  <iframe class="widget-frame" src="${embedUrl}" frameborder="0" allowtransparency="true" scrolling="no"></iframe>
  <a href="${communityUrl}" class="cta">Make Your Predictions →</a>
</body>
</html>`);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// GET /api/embed/:slug — widget data (top 3 active markets + community branding)
app.get('/api/embed/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { data: cs } = await supabase
      .from('creator_settings')
      .select('creator_id, display_name, primary_color, custom_points_name, logo_url, min_bet, max_bet')
      .eq('slug', slug)
      .maybeSingle();
    if (!cs) return res.status(404).json({ error: 'Community not found' });

    const { data: markets } = await supabase
      .from('markets')
      .select('id, question, yes_price, no_price, yes_votes, no_votes, trader_count, expiry_date, category')
      .eq('tenant_slug', slug)
      .eq('resolved', false)
      .neq('is_public', false)
      .order('trader_count', { ascending: false })
      .limit(3);

    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.json({
      community: {
        slug,
        name:       cs.display_name || slug,
        color:      cs.primary_color || '#c9920d',
        pts_name:   cs.custom_points_name || 'Flex Points',
        logo_url:   cs.logo_url || null,
        url:        `https://hyperflex.network/${slug}`,
        min_bet:    cs.min_bet  ?? 10000,   // centpoints (default 100 pts)
        max_bet:    cs.max_bet  ?? 1000000, // centpoints (default 10,000 pts)
      },
      markets: (markets || []).map(m => ({
        id:           m.id,
        question:     m.question,
        yes_price:    m.yes_price || 0.5,
        no_price:     m.no_price  || 0.5,
        yes_votes:    m.yes_votes || 0,
        no_votes:     m.no_votes  || 0,
        trader_count: m.trader_count || 0,
        expiry_date:  m.expiry_date,
        category:     m.category,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/user/dashboard — authenticated member dashboard data
// Returns: communities joined, open predictions, history, stats, profile
// ════════════════════════════════════════════════════════════
app.get('/api/user/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Parallel: user profile, all community balances, all positions, creator check
    const [userRes, balancesRes, positionsRes, creatorRes] = await Promise.all([
      supabase.from('users')
        .select('id, display_name, email, created_at')
        .eq('id', userId)
        .maybeSingle(),
      supabase.from('community_balances')
        .select('creator_slug, balance')
        .eq('user_id', userId),
      supabase.from('positions')
        .select('id, side, amount, potential_payout, won, settled, created_at, market_id, markets(id, question, tenant_slug, resolved, resolved_at, expiry_date, yes_price, no_price, yes_votes, no_votes)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('creator_settings')
        .select('slug')
        .eq('creator_id', userId)
        .maybeSingle(),
    ]);

    const user = userRes.data;
    if (!user) return res.status(404).json({ error: 'User not found' });

    const balances = balancesRes.data || [];
    const positions = positionsRes.data || [];

    // Get all community slugs (from balances + positions)
    const balanceSlugs = balances.map(b => b.creator_slug);
    const positionSlugs = [...new Set(positions.map(p => p.markets?.tenant_slug).filter(Boolean))];
    const allSlugs = [...new Set([...balanceSlugs, ...positionSlugs])];

    // Fetch community info for all slugs
    const { data: communityRows } = allSlugs.length
      ? await supabase.from('creator_settings')
          .select('slug, display_name, primary_color, logo_url, custom_points_name, is_active')
          .in('slug', allSlugs.slice(0, 30))
      : { data: [] };

    const communityMap = {};
    for (const c of (communityRows || [])) communityMap[c.slug] = c;

    // For each community the user has a balance in, get their rank
    const communityStats = await Promise.all(
      balances.map(async b => {
        const c = communityMap[b.creator_slug] || { slug: b.creator_slug, display_name: b.creator_slug, primary_color: '#c9920d' };
        // Get rank: count users with higher balance in same community
        const { count } = await supabase.from('community_balances')
          .select('*', { count: 'exact', head: true })
          .eq('creator_slug', b.creator_slug)
          .gt('balance', b.balance);
        const rank = (count || 0) + 1;
        // Count open positions in this community
        const openCount = positions.filter(p =>
          p.markets?.tenant_slug === b.creator_slug && !p.settled
        ).length;
        return {
          slug:              b.creator_slug,
          display_name:      c.display_name || b.creator_slug,
          primary_color:     c.primary_color || '#c9920d',
          logo_url:          c.logo_url || null,
          custom_points_name: c.custom_points_name || 'Flex Points',
          balance:           Math.floor(b.balance / 100),
          rank,
          open_positions:    openCount,
        };
      })
    );

    // Separate open vs settled positions
    const open = positions
      .filter(p => !p.settled && p.markets && !p.markets.resolved)
      .slice(0, 50)
      .map(p => ({
        id:             p.id,
        market_id:      p.market_id,
        question:       p.markets?.question,
        side:           p.side,
        amount:         Math.floor((p.amount || 0) / 100),
        potential_payout: Math.floor((p.potential_payout || 0) / 100),
        expiry_date:    p.markets?.expiry_date,
        yes_price:      p.markets?.yes_price,
        no_price:       p.markets?.no_price,
        community_slug: p.markets?.tenant_slug,
        community_name: communityMap[p.markets?.tenant_slug]?.display_name || p.markets?.tenant_slug,
        community_color: communityMap[p.markets?.tenant_slug]?.primary_color || '#c9920d',
        created_at:     p.created_at,
      }));

    const settled = positions
      .filter(p => p.settled)
      .slice(0, 100)
      .map(p => ({
        id:             p.id,
        market_id:      p.market_id,
        question:       p.markets?.question,
        side:           p.side,
        amount:         Math.floor((p.amount || 0) / 100),
        payout:         p.won ? Math.floor((p.potential_payout || 0) / 100) : 0,
        won:            p.won,
        resolved_at:    p.markets?.resolved_at,
        community_slug: p.markets?.tenant_slug,
        community_name: communityMap[p.markets?.tenant_slug]?.display_name || p.markets?.tenant_slug,
        community_color: communityMap[p.markets?.tenant_slug]?.primary_color || '#c9920d',
        created_at:     p.created_at,
      }));

    // Aggregate stats
    const wins      = settled.filter(p => p.won);
    const losses    = settled.filter(p => !p.won);
    const winRate   = settled.length > 0 ? Math.round((wins.length / settled.length) * 100) : 0;
    const totalWon  = wins.reduce((s, p) => s + (p.payout || 0), 0);
    const totalBet  = positions.reduce((s, p) => s + Math.floor((p.amount || 0) / 100), 0);
    const biggestWin = wins.reduce((max, p) => Math.max(max, p.payout || 0), 0);

    // Current streak (consecutive wins from most recent settled)
    let streak = 0;
    for (const p of settled) { if (p.won) streak++; else break; }

    // Net PnL
    const totalPayout = wins.reduce((s, p) => s + (p.payout || 0), 0);
    const netPnl = totalPayout - totalBet;

    res.json({
      user: {
        id:           user.id,
        display_name: user.display_name || 'Anonymous',
        email:        user.email,
        member_since: user.created_at,
        is_creator:   !!creatorRes.data,
        creator_slug: creatorRes.data?.slug || null,
      },
      stats: {
        total_predictions: positions.length,
        open_predictions:  open.length,
        settled_predictions: settled.length,
        wins:       wins.length,
        losses:     losses.length,
        win_rate:   winRate,
        streak,
        biggest_win: biggestWin,
        total_bet:  totalBet,
        total_won:  totalWon,
        net_pnl:    netPnl,
        communities_joined: communityStats.length,
      },
      communities: communityStats.sort((a, b) => b.balance - a.balance),
      open,
      history: settled,
    });
  } catch (err) {
    console.error('[user/dashboard]', err.message);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// POST /api/community/:slug/follow — follow (join) a community; creates balance row with starting points
app.post('/api/community/:slug/follow', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.id;
    const join_source = req.body?.join_source || 'direct';

    const { data: settings } = await supabase
      .from('creator_settings')
      .select('starting_balance, custom_points_name, display_name')
      .eq('slug', slug)
      .maybeSingle();
    if (!settings) return res.status(404).json({ error: 'Community not found' });

    const startingBalance = settings.starting_balance ?? 100000;

    // Idempotent upsert — won't overwrite existing balance
    const { error: upsertErr, data: upserted } = await supabase
      .from('community_balances')
      .upsert({ user_id: userId, creator_slug: slug, balance: startingBalance, join_source },
               { onConflict: 'user_id,creator_slug', ignoreDuplicates: true })
      .select('balance');

    // Return current balance (may be higher than starting if they already had one)
    const { data: row } = await supabase
      .from('community_balances')
      .select('balance')
      .eq('user_id', userId)
      .eq('creator_slug', slug)
      .maybeSingle();

    res.json({ balance: row?.balance ?? startingBalance, starting_balance: startingBalance });

    // Fire milestone email async — non-blocking
    maybeFireMilestoneEmail(slug).catch(() => {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/user/community/:slug — leave a community (removes balance record)
app.delete('/api/user/community/:slug', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const { error } = await supabase.from('community_balances')
      .delete()
      .eq('user_id', req.user.id)
      .eq('creator_slug', slug);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CREATOR MILESTONE EMAILS ────────────────────────────────────────────────
// Fires when a community crosses 5, 10, 25, or 50 members.
// Uses creator_settings.last_milestone_notified (int) to avoid re-sending.
// No-op if SMTP not configured.

const MILESTONES = [5, 10, 25, 50, 100, 250, 500];

async function maybeFireMilestoneEmail(slug) {
  const transporter = createMailTransport();
  if (!transporter) return;

  try {
    // Count current members
    const { count } = await supabase
      .from('community_balances')
      .select('user_id', { count: 'exact', head: true })
      .eq('creator_slug', slug);
    if (!count) return;

    // Get creator info + last notified milestone
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('id, email, display_name, primary_color, last_milestone_notified, email_unsubscribed, email_unsubscribe_token')
      .eq('slug', slug)
      .maybeSingle();
    if (!creator?.email || creator.email_unsubscribed) return;

    const lastNotified = creator.last_milestone_notified || 0;

    // Find highest milestone crossed that hasn't been notified
    const milestone = [...MILESTONES].reverse().find(m => count >= m && m > lastNotified);
    if (!milestone) return;

    // Mark as notified immediately to prevent duplicate sends from concurrent requests
    await supabase
      .from('creator_settings')
      .update({ last_milestone_notified: milestone })
      .eq('slug', slug);

    const accent = creator.primary_color || '#c9920d';
    const communityName = creator.display_name || slug;
    const dashUrl = 'https://hyperflex.network/creator/dashboard';
    const communityUrl = `https://hyperflex.network/${slug}`;

    const milestoneEmoji = milestone >= 100 ? '🚀' : milestone >= 50 ? '🎉' : milestone >= 25 ? '🔥' : '⭐';
    const headline = milestone >= 100
      ? `${count} members and counting. You're building something real.`
      : milestone >= 50
      ? `${milestone} members in ${communityName}. Your community is alive.`
      : `${milestone} people joined ${communityName}. The momentum is real.`;

    const bodyLine = milestone >= 100
      ? `You've crossed ${milestone} members. That's not a small thing — that's a community. Keep publishing markets and your audience will keep coming back.`
      : milestone >= 25
      ? `${milestone} people chose to join your prediction community. They're watching your markets, placing predictions, and checking back daily. This is the engine of engagement that most creators never build.`
      : `Your first ${milestone} members are in. Now's the time to keep publishing — communities with consistent markets grow 3× faster.`;

    // Get unsubscribe token
    const unsubToken = creator.email_unsubscribe_token || await getCreatorUnsubToken(creator.id);
    const unsubUrl = `https://hyperflex.network/unsubscribe?token=${unsubToken}`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0">
<tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:12px;overflow:hidden">
    <tr><td style="background:${accent};padding:16px 28px">
      <span style="font-size:18px;font-weight:900;color:#141412">HYPERFLEX</span>
      <span style="float:right;font-size:22px;line-height:28px">${milestoneEmoji}</span>
    </td></tr>
    <tr><td style="padding:32px 28px 24px">
      <div style="display:inline-block;background:rgba(201,146,13,.1);border:1px solid rgba(201,146,13,.3);border-radius:6px;padding:6px 14px;margin-bottom:18px">
        <span style="font-family:monospace;font-size:11px;font-weight:700;color:${accent};letter-spacing:.1em">${milestone} MEMBERS REACHED</span>
      </div>
      <h2 style="margin:0 0 12px;font-size:22px;color:#f5f5f0;font-weight:800;line-height:1.3">${headline}</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.7">${bodyLine}</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <a href="${dashUrl}" style="display:inline-block;padding:12px 24px;background:${accent};color:#141412;font-weight:800;font-size:14px;border-radius:8px;text-decoration:none">Go to dashboard →</a>
        <a href="${communityUrl}" style="display:inline-block;padding:12px 20px;background:rgba(255,255,255,.07);color:#f0ede8;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none;border:1px solid rgba(255,255,255,.1)">View community</a>
      </div>
    </td></tr>
    ${creatorUnsubscribeFooterHtml(unsubUrl)}
  </table>
</td></tr>
</table></body></html>`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'HYPERFLEX <noreply@hyperflex.network>',
      to: creator.email,
      subject: `${milestoneEmoji} ${communityName} just hit ${milestone} members`,
      html,
    });
    console.log(`[milestone] Sent ${milestone}-member email to ${creator.email} for ${slug}`);
  } catch (err) {
    console.error('[milestone] Error:', err.message);
  }
}

// GET /u/:slug — public creator profile page
app.get('/u/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));

// GET /m/:userId — public member profile page
app.get('/m/:userId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'member.html')));

// GET /nominate — nominate your creator page
app.get('/nominate', (req, res) => res.sendFile(path.join(__dirname, 'public', 'nominate.html')));

// GET /predictors — discover sharp predictors page
app.get('/predictors', (req, res) => res.sendFile(path.join(__dirname, 'public', 'predictors.html')));
app.get('/odds', (req, res) => res.sendFile(path.join(__dirname, 'public', 'odds.html')));

// GET /api/predictors — top predictors leaderboard
app.get('/api/predictors', async (req, res) => {
  try {
    const { sort = 'win_rate', q = '', limit = 100 } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 200);

    // Aggregate settled positions per user (limit to 5000 for perf)
    const { data: rows, error } = await supabase
      .from('positions')
      .select('user_id, amount, potential_payout, settled, won, created_at')
      .eq('settled', true)
      .limit(5000);

    if (error) throw error;
    if (!rows || !rows.length) return res.json([]);

    // Group by user_id
    const byUser = {};
    for (const pos of rows || []) {
      if (!byUser[pos.user_id]) byUser[pos.user_id] = { wins: 0, total: 0, pnl: 0, lastWon: false, streak: 0, streakArr: [] };
      const u = byUser[pos.user_id];
      u.total++;
      if (pos.won) { u.wins++; u.pnl += (pos.potential_payout || 0) - (pos.amount || 0); }
      else { u.pnl -= (pos.amount || 0); }
      u.streakArr.push({ won: pos.won, ts: pos.created_at });
    }

    // Filter users with ≥3 settled predictions
    const userIds = Object.keys(byUser).filter(uid => byUser[uid].total >= 3);
    if (!userIds.length) return res.json([]);

    // Calculate streaks (consecutive wins from most recent)
    for (const uid of userIds) {
      const u = byUser[uid];
      u.streakArr.sort((a, b) => new Date(b.ts) - new Date(a.ts));
      let streak = 0;
      for (const p of u.streakArr) { if (p.won) streak++; else break; }
      u.streak = streak;
    }

    // Fetch display names
    const { data: userRows } = await supabase
      .from('users')
      .select('id, display_name')
      .in('id', userIds);

    const nameMap = {};
    for (const u of userRows || []) nameMap[u.id] = u.display_name;

    // Check polymarket connections (users table)
    const { data: csRows } = await supabase
      .from('users')
      .select('id, polymarket_address')
      .in('id', userIds)
      .not('polymarket_address', 'is', null);

    const polyMap = {};
    for (const cs of csRows || []) polyMap[cs.id] = cs.polymarket_address;

    // Build result
    let result = userIds.map(uid => {
      const u = byUser[uid];
      const win_rate = u.total > 0 ? Math.round((u.wins / u.total) * 100) : 0;
      const platforms = ['HFX'];
      if (polyMap[uid]) platforms.push('POLY');
      return {
        user_id: uid,
        display_name: nameMap[uid] || 'Anonymous',
        win_rate,
        total_predictions: u.total,
        streak: u.streak,
        pnl_pts: Math.round(u.pnl / 100), // centpoints → pts
        polymarket_address: polyMap[uid] || null,
        platforms
      };
    });

    // Search filter
    if (q) {
      const ql = q.toLowerCase();
      result = result.filter(r => r.display_name.toLowerCase().includes(ql));
    }

    // Sort
    const sortFns = {
      win_rate: (a, b) => b.win_rate - a.win_rate,
      predictions: (a, b) => b.total_predictions - a.total_predictions,
      streak: (a, b) => b.streak - a.streak,
      pnl: (a, b) => b.pnl_pts - a.pnl_pts
    };
    result.sort(sortFns[sort] || sortFns.win_rate);

    res.json(result.slice(0, lim));
  } catch (err) {
    console.error('[api/predictors]', err);
    res.status(500).json({ error: 'Failed to load predictors' });
  }
});

// Toggle follow a predictor
app.post('/api/predictors/:userId/follow', requireAuth, async (req, res) => {
  const followerId = req.user.id;
  const followingId = req.params.userId;
  if (followerId === followingId) return res.status(400).json({ error: 'Cannot follow yourself' });
  const { data: existing } = await supabase
    .from('predictor_follows')
    .select('id')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .maybeSingle();
  if (existing) {
    await supabase.from('predictor_follows').delete().eq('id', existing.id);
    return res.json({ following: false });
  } else {
    await supabase.from('predictor_follows').insert({ follower_id: followerId, following_id: followingId });
    return res.json({ following: true });
  }
});

// Get follow status + count for a user
app.get('/api/predictors/:userId/follow-status', optionalAuth, async (req, res) => {
  const targetId = req.params.userId;
  const { count } = await supabase.from('predictor_follows').select('id', { count: 'exact', head: true }).eq('following_id', targetId);
  let isFollowing = false;
  if (req.user) {
    const { data } = await supabase.from('predictor_follows').select('id').eq('follower_id', req.user.id).eq('following_id', targetId).maybeSingle();
    isFollowing = !!data;
  }
  res.json({ follower_count: count || 0, is_following: isFollowing });
});

// Toggle copy trade subscription
app.post('/api/predictors/:userId/copy-trade', requireAuth, async (req, res) => {
  const subscriberId = req.user.id;
  const targetId = req.params.userId;
  if (subscriberId === targetId) return res.status(400).json({ error: 'Cannot copy-trade yourself' });
  try {
    const { data: existing } = await supabase
      .from('copy_trade_subscriptions')
      .select('id')
      .eq('subscriber_id', subscriberId)
      .eq('target_user_id', targetId)
      .maybeSingle();
    if (existing) {
      await supabase.from('copy_trade_subscriptions').delete().eq('id', existing.id);
      return res.json({ subscribed: false });
    } else {
      await supabase.from('copy_trade_subscriptions').insert({ subscriber_id: subscriberId, target_user_id: targetId });
      return res.json({ subscribed: true });
    }
  } catch (err) {
    console.error('[copy-trade toggle]', err.message);
    res.status(500).json({ error: 'Failed to update copy trade subscription' });
  }
});

// Get copy trade status
app.get('/api/predictors/:userId/copy-status', optionalAuth, async (req, res) => {
  const targetId = req.params.userId;
  try {
    const { count } = await supabase.from('copy_trade_subscriptions').select('id', { count: 'exact', head: true }).eq('target_user_id', targetId);
    let isSubscribed = false;
    if (req.user) {
      const { data } = await supabase.from('copy_trade_subscriptions').select('id').eq('subscriber_id', req.user.id).eq('target_user_id', targetId).maybeSingle();
      isSubscribed = !!data;
    }
    res.json({ subscriber_count: count || 0, is_subscribed: isSubscribed });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// Following feed — activity from people you follow
app.get('/api/feed/following', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { data: follows } = await supabase.from('predictor_follows').select('following_id').eq('follower_id', userId);
  if (!follows || follows.length === 0) return res.json({ items: [] });
  const followingIds = follows.map(f => f.following_id);

  // Fetch shared + cached external positions and HFX bets from followed users
  const [sharedRes, cachedRes, betsRes] = await Promise.all([
    supabase
      .from('shared_positions')
      .select('*, users(display_name, username)')
      .in('user_id', followingIds)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('cached_positions')
      .select('*, users(display_name, username)')
      .in('user_id', followingIds)
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase
      .from('positions')
      .select('*, markets(question, tenant_slug, id), users(display_name, username)')
      .in('user_id', followingIds)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const items = [];
  (sharedRes.data || []).forEach(p => {
    items.push({
      type: 'external_bet',
      id: `sp_${p.id}`,
      user_id: p.user_id,
      username: p.users?.username || p.users?.display_name || 'Predictor',
      platform: p.platform,
      market_title: p.market_title,
      side: p.side,
      amount: p.amount,
      pnl: p.pnl,
      market_url: p.market_url,
      created_at: p.created_at
    });
  });
  (cachedRes.data || []).forEach(p => {
    items.push({
      type: 'external_bet',
      id: `cp_${p.id}`,
      user_id: p.user_id,
      username: p.users?.username || p.users?.display_name || 'Predictor',
      platform: p.platform,
      market_title: p.market_title,
      side: p.side,
      pnl: p.pnl,
      market_url: p.market_url,
      created_at: p.updated_at
    });
  });
  (betsRes.data || []).forEach(b => {
    if (!b.markets) return;
    items.push({
      type: 'hyperflex_bet',
      id: `hb_${b.id}`,
      user_id: b.user_id,
      username: b.users?.display_name || b.users?.username || 'Predictor',
      market_title: b.markets?.question,
      community_slug: b.markets?.tenant_slug,
      market_id: b.markets?.id,
      side: b.side,
      amount: b.amount,
      created_at: b.created_at
    });
  });
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ items: items.slice(0, 60) });
});

// Public portfolio for any user
app.get('/api/predictors/:userId/portfolio', async (req, res) => {
  const { userId } = req.params;
  const [cachedRes, hfBetsRes] = await Promise.all([
    supabase
      .from('cached_positions')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }),
    supabase
      .from('positions')
      .select('*, markets(question, tenant_slug, id, resolved, outcome)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);
  res.json({ cached_positions: cachedRes.data || [], hyperflex_bets: hfBetsRes.data || [] });
});

// P&L analytics for a user — win rate by platform, calibration, cumulative PnL
app.get('/api/predictors/:userId/analytics', async (req, res) => {
  const { userId } = req.params;

  const [hfRes, cachedRes] = await Promise.all([
    supabase
      .from('positions')
      .select('side, amount, potential_payout, won, settled, created_at, markets(question, resolved_at, outcome)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('cached_positions')
      .select('*')
      .eq('user_id', userId),
  ]);

  const hfBets = hfRes.data || [];
  const cachedPositions = cachedRes.data || [];

  // ── Platform breakdown ──────────────────────────────────────────────────────
  const platforms = { hyperflex: { wins: 0, losses: 0, total: 0, pnl: 0 } };
  for (const p of cachedPositions) {
    const pl = p.platform;
    if (!platforms[pl]) platforms[pl] = { wins: 0, losses: 0, total: 0, pnl: 0 };
    platforms[pl].total++;
    platforms[pl].pnl += Number(p.pnl) || 0;
    if ((p.pnl || 0) > 0) platforms[pl].wins++;
    else platforms[pl].losses++;
  }
  const hfSettled = hfBets.filter(p => p.settled);
  platforms.hyperflex.total = hfSettled.length;
  platforms.hyperflex.wins = hfSettled.filter(p => p.won).length;
  platforms.hyperflex.losses = hfSettled.filter(p => !p.won).length;
  platforms.hyperflex.pnl = hfSettled.reduce((s, p) => {
    return s + (p.won ? (p.potential_payout - p.amount) : -p.amount);
  }, 0) / 100; // centpoints → points

  // ── Calibration (HFX only — we have probability data) ──────────────────────
  const buckets = Array.from({ length: 9 }, (_, i) => ({
    label: `${(i + 1) * 10}%`,
    predicted: (i + 1) * 10,
    correct: 0,
    total: 0,
  }));
  for (const p of hfSettled) {
    if (!p.markets) continue;
    // Use side as proxy for predicted probability
    const prob = p.side === 'YES' ? 70 : 30; // simplified; refine if you store odds
    const idx = Math.min(Math.floor(prob / 10) - 1, 8);
    if (idx >= 0) {
      buckets[idx].total++;
      if (p.won) buckets[idx].correct++;
    }
  }
  const calibration = buckets.map(b => ({
    ...b,
    actual: b.total > 0 ? Math.round((b.correct / b.total) * 100) : null,
  }));

  // ── Cumulative PnL timeline (last 30 days, HFX only) ─────────────────────
  const now = Date.now();
  const days = 30;
  const dailyPnl = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    dailyPnl[d] = 0;
  }
  for (const p of hfSettled) {
    const d = (p.markets?.resolved_at || p.created_at || '').slice(0, 10);
    if (d in dailyPnl) {
      dailyPnl[d] += p.won ? (p.potential_payout - p.amount) : -p.amount;
    }
  }
  // Convert to cumulative
  const sortedDays = Object.keys(dailyPnl).sort();
  let cumulative = 0;
  const timeline = sortedDays.map(date => {
    cumulative += dailyPnl[date] / 100;
    return { date, pnl: Math.round(cumulative * 100) / 100 };
  });

  // ── Sharp score ────────────────────────────────────────────────────────────
  const totalSettled = hfSettled.length;
  const totalWins = hfSettled.filter(p => p.won).length;
  const winRate = totalSettled > 0 ? Math.round((totalWins / totalSettled) * 100) : 0;
  const calibrationError = calibration
    .filter(b => b.actual !== null)
    .reduce((s, b) => s + Math.abs(b.predicted - b.actual), 0) /
    Math.max(1, calibration.filter(b => b.actual !== null).length);
  const sharpScore = Math.round(winRate * 0.6 + Math.max(0, 100 - calibrationError) * 0.4);

  const totalPnl = Object.values(platforms).reduce((s, p) => s + p.pnl, 0);

  res.json({
    win_rate: winRate,
    total_pnl: Math.round(totalPnl * 100) / 100,
    sharp_score: sharpScore,
    platforms,
    calibration,
    timeline,
  });
});

// Best single HFX call for a user — highest-payout win
app.get('/api/predictors/:userId/best-call', async (req, res) => {
  const { userId } = req.params;
  const { data } = await supabase
    .from('positions')
    .select('side, amount, potential_payout, created_at, markets(question, tenant_slug, id, outcome, resolved)')
    .eq('user_id', userId)
    .order('potential_payout', { ascending: false })
    .limit(20);
  const wins = (data || []).filter(p => p.markets?.resolved && p.markets?.outcome === p.side);
  if (!wins.length) return res.json({ best: null });
  const best = wins[0];
  res.json({
    best: {
      question: best.markets.question,
      side: best.side,
      amount: best.amount,
      payout: best.potential_payout,
      multiplier: best.amount > 0 ? (best.potential_payout / best.amount).toFixed(1) : null,
      community_slug: best.markets.tenant_slug,
      market_id: best.markets.id,
      date: best.created_at,
    }
  });
});

// GET /api/member/:userId — public member profile data
app.get('/api/member/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const [userRes, positionsRes] = await Promise.all([
      supabase.from('users').select('id, display_name, created_at').eq('id', userId).maybeSingle(),
      supabase.from('positions')
        .select('id, side, amount, potential_payout, won, settled, created_at, market_id, markets(id, question, tenant_slug, resolved_at, outcome)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(300),
    ]);

    if (!userRes.data) return res.status(404).json({ error: 'User not found' });

    const positions = positionsRes.data || [];
    const settled   = positions.filter(p => p.settled);
    const wins      = settled.filter(p => p.won);
    const winRate   = settled.length > 0 ? Math.round((wins.length / settled.length) * 100) : 0;
    const totalBet  = positions.reduce((s, p) => s + (p.amount || 0), 0);
    const totalWon  = wins.reduce((s, p) => s + (p.potential_payout || 0), 0);

    // Current consecutive win streak (from most recent settled)
    let streak = 0;
    const settledSorted = [...settled].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    for (const p of settledSorted) {
      if (p.won) streak++;
      else break;
    }

    // Communities active in
    const slugs = [...new Set(positions.map(p => p.markets?.tenant_slug).filter(Boolean))];
    const { data: communitySettings } = slugs.length
      ? await supabase.from('creator_settings').select('slug, display_name, primary_color, custom_points_name').in('slug', slugs.slice(0, 15))
      : { data: [] };
    const communityMap = {};
    for (const c of (communitySettings || [])) communityMap[c.slug] = c;

    // Recent wins (resolved markets user predicted correctly)
    const recentWins = wins
      .filter(p => p.markets?.resolved_at)
      .slice(0, 6)
      .map(p => ({
        market_id:      p.market_id,
        question:       p.markets.question,
        outcome:        p.markets.outcome,
        side:           p.side,
        payout:         Math.round((p.potential_payout || 0) / 100),
        community_slug: p.markets.tenant_slug,
        community_name: communityMap[p.markets.tenant_slug]?.display_name || p.markets.tenant_slug,
        community_color: communityMap[p.markets.tenant_slug]?.primary_color || '#c9920d',
        resolved_at:    p.markets.resolved_at,
      }));

    res.json({
      user: {
        id:           userRes.data.id,
        display_name: userRes.data.display_name || 'Anonymous',
        member_since: userRes.data.created_at,
      },
      stats: {
        total_predictions:  positions.length,
        settled_predictions: settled.length,
        wins:     wins.length,
        win_rate: winRate,
        total_bet: Math.round(totalBet / 100),
        total_won: Math.round(totalWon / 100),
        streak,
      },
      communities: slugs.slice(0, 12).map(s => communityMap[s] || { slug: s, display_name: s, primary_color: '#c9920d' }),
      recent_wins: recentWins,
    });
  } catch (err) {
    console.error('[member profile]', err);
    res.status(500).json({ error: 'Failed to load member profile' });
  }
});

// POST /api/nominate — save a creator nomination
app.post('/api/nominate', async (req, res) => {
  try {
    const { creator_name, creator_url, fan_name, fan_email, message } = req.body;
    if (!creator_name) return res.status(400).json({ error: 'Creator name required' });

    // Store in a simple table (if it doesn't exist this is a no-op insert that will fail gracefully)
    // Also fire an email to admin if SMTP configured
    const transporter = createMailTransport();
    if (transporter && process.env.ADMIN_EMAIL) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'HYPERFLEX <noreply@hyperflex.network>',
        to: process.env.ADMIN_EMAIL,
        subject: `🎯 New creator nomination: ${creator_name}`,
        html: `<div style="font-family:monospace;background:#141412;color:#ddd;padding:24px;border-radius:8px;">
          <h2 style="color:#c9920d;">New Creator Nomination</h2>
          <p><strong>Creator:</strong> ${creator_name}</p>
          ${creator_url ? `<p><strong>Channel/URL:</strong> ${creator_url}</p>` : ''}
          ${fan_name ? `<p><strong>From fan:</strong> ${fan_name}</p>` : ''}
          ${fan_email ? `<p><strong>Fan email:</strong> ${fan_email}</p>` : ''}
          ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
        </div>`,
      }).catch(e => console.warn('[nominate] email error:', e.message));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[nominate]', err);
    res.status(500).json({ error: 'Failed to save nomination' });
  }
});

// GET /api/activity — global activity feed (mixed event types for Twitter-like feed)
app.get('/api/activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 40, 100);
    const since = req.query.since; // ISO cursor for polling

    const [betsRes, resolutionsRes, newMarketsRes, winsRes, creatorsRes, commentsRes, rewardUnlocksRes, sharedPositionsRes] = await Promise.all([
      supabase
        .from('positions')
        .select('id, user_id, side, amount, created_at, market_id, markets(id, question, tenant_slug, yes_price, no_price, yes_votes, no_votes, trader_count)')
        .order('created_at', { ascending: false })
        .limit(since ? 25 : limit),

      supabase
        .from('markets')
        .select('id, question, tenant_slug, resolved_at, outcome, resolution_note, trader_count')
        .eq('resolved', true)
        .not('resolved_at', 'is', null)
        .order('resolved_at', { ascending: false })
        .limit(15),

      supabase
        .from('markets')
        .select('id, question, tenant_slug, created_at, yes_price, no_price, yes_votes, no_votes, category')
        .eq('resolved', false)
        .neq('is_public', false)
        .order('created_at', { ascending: false })
        .limit(15),

      // Recent wins: settled positions where user predicted correctly
      supabase
        .from('positions')
        .select('id, user_id, side, amount, potential_payout, created_at, market_id, markets(id, question, tenant_slug, resolved_at, outcome, trader_count)')
        .eq('settled', true)
        .eq('won', true)
        .not('markets', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('creator_settings')
        .select('slug, display_name, primary_color, custom_points_name, logo_url'),

      // Recent comments
      supabase
        .from('market_comments')
        .select('id, user_id, user_name, body, created_at, market_id, creator_slug, markets(id, question, tenant_slug)')
        .order('created_at', { ascending: false })
        .limit(since ? 25 : 20),

      // Recent reward unlocks
      supabase
        .from('reward_unlocks')
        .select('id, user_id, creator_slug, reward_title, reward_threshold, unlocked_at')
        .order('unlocked_at', { ascending: false })
        .limit(since ? 20 : 15),

      // Shared external positions (Kalshi, Manifold, Polymarket)
      supabase
        .from('shared_positions')
        .select('id, user_id, question, side, platform, current_price, pnl_pct, cash_value, market_url, created_at')
        .order('created_at', { ascending: false })
        .limit(since ? 20 : 15),
    ]);

    const communities = {};
    for (const c of (creatorsRes.data || [])) communities[c.slug] = c;

    // Enrich bets + wins + reward unlocks with user display names
    const rawBets    = (betsRes.data    || []).filter(b => b.markets?.tenant_slug);
    const rawWins    = (winsRes.data    || []).filter(w => w.markets?.tenant_slug && w.markets?.resolved_at);
    const rawUnlocks = (rewardUnlocksRes.data || []).filter(u => u.creator_slug);
    const rawShared  = (sharedPositionsRes.data || []);
    const allUserIds = [...new Set([...rawBets.map(b => b.user_id), ...rawWins.map(w => w.user_id), ...rawUnlocks.map(u => u.user_id), ...rawShared.map(s => s.user_id)])];
    const { data: usersData } = allUserIds.length
      ? await supabase.from('users').select('id, display_name').in('id', allUserIds)
      : { data: [] };
    const userMap = {};
    for (const u of (usersData || [])) userMap[u.id] = u.display_name;

    const activities = [];

    for (const b of rawBets) {
      const m    = b.markets;
      const slug = m?.tenant_slug;
      if (!slug) continue;
      activities.push({
        type:                 'bet',
        id:                   `bet_${b.id}`,
        ts:                   b.created_at,
        user_id:              b.user_id,
        user:                 userMap[b.user_id] || 'Anonymous',
        side:                 (b.side || '').toUpperCase(),
        amount:               b.amount ? Math.round(b.amount / 100) : 0,
        pts_name:             communities[slug]?.custom_points_name || 'Flex Points',
        market_id:            b.market_id,
        market_question:      m?.question,
        market_yes_price:     m?.yes_price,
        market_yes_votes:     m?.yes_votes || 0,
        market_no_votes:      m?.no_votes  || 0,
        market_trader_count:  m?.trader_count || 0,
        creator_slug:         slug,
        community_name:       communities[slug]?.display_name || slug,
        community_color:      communities[slug]?.primary_color || '#c9920d',
      });
    }

    for (const m of (resolutionsRes.data || [])) {
      const slug = m.tenant_slug;
      if (!slug) continue;
      activities.push({
        type:            'resolution',
        id:              `res_${m.id}`,
        ts:              m.resolved_at,
        market_id:       m.id,
        market_question: m.question,
        outcome:         m.outcome,
        resolution_note: m.resolution_note,
        trader_count:    m.trader_count || 0,
        creator_slug:    slug,
        community_name:  communities[slug]?.display_name || slug,
        community_color: communities[slug]?.primary_color || '#c9920d',
      });
    }

    for (const m of (newMarketsRes.data || [])) {
      const slug = m.tenant_slug;
      if (!slug) continue;
      activities.push({
        type:            'market_created',
        id:              `mkt_${m.id}`,
        ts:              m.created_at,
        market_id:       m.id,
        market_question: m.question,
        market_yes_price: m.yes_price,
        market_yes_votes: m.yes_votes || 0,
        market_no_votes:  m.no_votes  || 0,
        category:        m.category,
        creator_slug:    slug,
        community_name:  communities[slug]?.display_name || slug,
        community_color: communities[slug]?.primary_color || '#c9920d',
      });
    }

    // Win events — trophy cards for correct predictions
    // Deduplicate per market: one win card per market (not per user), showing the biggest winner
    const winsByMarket = {};
    for (const w of rawWins) {
      const m    = w.markets;
      const slug = m?.tenant_slug;
      if (!slug || !m?.resolved_at) continue;
      const existing = winsByMarket[w.market_id];
      const payout = w.potential_payout || 0;
      if (!existing || payout > (existing.payout || 0)) {
        winsByMarket[w.market_id] = {
          type:            'win',
          id:              `win_${w.market_id}`,
          ts:              m.resolved_at,
          user_id:         w.user_id,
          user:            userMap[w.user_id] || 'Anonymous',
          side:            (w.side || '').toUpperCase(),
          amount:          w.amount ? Math.round(w.amount / 100) : 0,
          payout:          Math.round(payout / 100),
          pts_name:        communities[slug]?.custom_points_name || 'Flex Points',
          market_id:       w.market_id,
          market_question: m.question,
          outcome:         m.outcome,
          trader_count:    m.trader_count || 0,
          creator_slug:    slug,
          community_name:  communities[slug]?.display_name || slug,
          community_color: communities[slug]?.primary_color || '#c9920d',
        };
      }
    }
    activities.push(...Object.values(winsByMarket));

    // Comment events
    for (const c of (commentsRes.data || [])) {
      const mkt  = c.markets;
      const cSlug = c.creator_slug || mkt?.tenant_slug;
      if (!cSlug || !mkt?.question) continue;
      activities.push({
        type:            'comment',
        id:              `cmt_${c.id}`,
        ts:              c.created_at,
        user_id:         c.user_id,
        user:            c.user_name || 'Anonymous',
        body:            c.body,
        market_id:       c.market_id,
        market_question: mkt.question,
        creator_slug:    cSlug,
        community_name:  communities[cSlug]?.display_name || cSlug,
        community_color: communities[cSlug]?.primary_color || '#c9920d',
      });
    }

    // Reward unlock events
    for (const u of rawUnlocks) {
      const slug = u.creator_slug;
      activities.push({
        type:             'reward_unlock',
        id:               `rwu_${u.id}`,
        ts:               u.unlocked_at,
        user_id:          u.user_id,
        user:             userMap[u.user_id] || 'Anonymous',
        reward_title:     u.reward_title,
        reward_threshold: u.reward_threshold,
        creator_slug:     slug,
        community_name:   communities[slug]?.display_name || slug,
        community_color:  communities[slug]?.primary_color || '#c9920d',
        pts_name:         communities[slug]?.custom_points_name || 'Flex Points',
      });
    }

    // Shared external positions (external_bet feed cards)
    for (const s of rawShared) {
      activities.push({
        type:          'external_bet',
        id:            `ext_${s.id}`,
        ts:            s.created_at,
        user_id:       s.user_id,
        user:          userMap[s.user_id] || 'Anonymous',
        question:      s.question,
        side:          (s.side || 'YES').toUpperCase(),
        platform:      s.platform || 'kalshi',
        current_price: s.current_price,
        pnl_pct:       s.pnl_pct,
        cash_value:    s.cash_value,
        market_url:    s.market_url,
      });
    }

    // Collapse market_created bursts: same creator within 5 minutes → one card
    const BURST_WINDOW_MS = 5 * 60 * 1000;
    const mktEvents   = activities.filter(a => a.type === 'market_created');
    const otherEvents = activities.filter(a => a.type !== 'market_created');
    // Sort by creator then time asc so we can walk windows
    mktEvents.sort((a, b) => {
      if (a.creator_slug < b.creator_slug) return -1;
      if (a.creator_slug > b.creator_slug) return  1;
      return new Date(a.ts) - new Date(b.ts);
    });
    const processedMarkets = [];
    let mi = 0;
    while (mi < mktEvents.length) {
      const cur   = mktEvents[mi];
      const group = [cur];
      let   mj    = mi + 1;
      while (
        mj < mktEvents.length &&
        mktEvents[mj].creator_slug === cur.creator_slug &&
        Math.abs(new Date(mktEvents[mj].ts) - new Date(cur.ts)) <= BURST_WINDOW_MS
      ) {
        group.push(mktEvents[mj]);
        mj++;
      }
      if (group.length >= 2) {
        // Use the latest timestamp in the group as the event time
        const latestTs = group.reduce((max, e) => new Date(e.ts) > new Date(max) ? e.ts : max, group[0].ts);
        processedMarkets.push({
          type:           'markets_burst',
          id:             `burst_${cur.creator_slug}_${new Date(latestTs).getTime()}`,
          ts:             latestTs,
          count:          group.length,
          markets:        group.map(e => ({ id: e.market_id, question: e.market_question, category: e.category })),
          creator_slug:   cur.creator_slug,
          community_name: cur.community_name,
          community_color: cur.community_color,
        });
      } else {
        processedMarkets.push(cur);
      }
      mi = mj;
    }
    // Rebuild activities with burst-collapsed markets
    activities.length = 0;
    activities.push(...otherEvents, ...processedMarkets);

    // Sort by ts desc and deduplicate
    activities.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const seen = new Set();
    const deduped = activities.filter(a => seen.has(a.id) ? false : (seen.add(a.id), true));

    const result = since
      ? deduped.filter(a => new Date(a.ts) > new Date(since))
      : deduped.slice(0, limit);

    res.json({ activities: result, communities });
  } catch (err) {
    console.error('[activity feed]', err);
    res.status(500).json({ error: 'Failed to load activity feed' });
  }
});

// POST /api/activity/share-position — log an external position to the shared feed
app.post('/api/activity/share-position', requireAuth, async (req, res) => {
  try {
    const { question, side, platform, current_price, pnl_pct, cash_value, market_url } = req.body;
    if (!question || !side || !platform) return res.status(400).json({ error: 'question, side, and platform are required' });
    const validPlatforms = ['kalshi', 'manifold', 'polymarket'];
    if (!validPlatforms.includes(platform.toLowerCase())) return res.status(400).json({ error: 'Invalid platform' });

    const { error } = await supabase.from('shared_positions').insert({
      user_id:       req.userId,
      question:      String(question).slice(0, 500),
      side:          (side || '').toUpperCase(),
      platform:      platform.toLowerCase(),
      current_price: current_price != null ? parseFloat(current_price) : null,
      pnl_pct:       pnl_pct      != null ? parseInt(pnl_pct)         : null,
      cash_value:    cash_value   != null ? parseFloat(cash_value)    : null,
      market_url:    market_url   ? String(market_url).slice(0, 1000) : null,
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[share-position]', err.message);
    res.status(500).json({ error: 'Failed to share position' });
  }
});

// ── CROSS-PLATFORM POSITION AUTO-SYNC ────────────────────────────────────────
async function syncAllUserPositions() {
  console.log('[auto-sync] Starting position sync for all connected users');
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, polymarket_address, kalshi_api_key, kalshi_username, manifold_username')
      .or('polymarket_address.not.is.null,kalshi_api_key.not.is.null,kalshi_username.not.is.null,manifold_username.not.is.null');
    if (!users || users.length === 0) return;
    console.log(`[auto-sync] Syncing ${users.length} users`);
    for (const user of users) {
      await syncUserPositions(user).catch(e => console.warn(`[auto-sync] Failed for ${user.id}:`, e.message));
    }
    console.log('[auto-sync] Done');
  } catch(e) {
    console.error('[auto-sync] Error:', e.message);
  }
}

async function syncUserPositions(user) {
  const upserts = [];

  // Polymarket
  if (user.polymarket_address) {
    try {
      const cacheKey = `poly_${user.polymarket_address}`;
      let positions = _polyCache.get(cacheKey);
      if (!positions) {
        const res = await fetch(`https://data-api.polymarket.com/positions?user=${user.polymarket_address}&limit=50&sortBy=CURRENT&winning=false`);
        positions = await res.json();
        if (_polyCache) {
          _polyCache.set(cacheKey, positions);
          setTimeout(() => _polyCache.delete(cacheKey), 5 * 60 * 1000);
        }
      }
      (Array.isArray(positions) ? positions : []).forEach(p => {
        if (!p.conditionId) return;
        upserts.push({
          user_id: user.id,
          platform: 'polymarket',
          external_id: p.conditionId,
          market_title: p.title || p.question || 'Unknown market',
          side: p.outcome || 'YES',
          shares: parseFloat(p.size) || 0,
          pnl: parseFloat(p.cashPnl) || 0,
          probability: parseFloat(p.curPrice) || 0,
          market_url: p.slug ? `https://polymarket.com/event/${p.eventSlug || p.slug}` : `https://polymarket.com`,
          updated_at: new Date().toISOString()
        });
      });
    } catch(e) { console.warn('[sync-poly]', e.message); }
  }

  // Kalshi
  if (user.kalshi_api_key) {
    try {
      const resp = await fetch('https://trading-api.kalshi.com/trade-api/v2/portfolio/positions?limit=50', {
        headers: { Authorization: `Bearer ${user.kalshi_api_key}` }
      });
      const data = await resp.json();
      ((data.market_positions || [])).forEach(p => {
        upserts.push({
          user_id: user.id,
          platform: 'kalshi',
          external_id: p.market_id,
          market_title: p.market_title || p.market_id,
          side: (p.position > 0) ? 'YES' : 'NO',
          shares: Math.abs(p.position) || 0,
          pnl: parseFloat(p.realized_pnl || 0) / 100,
          probability: parseFloat(p.market_exposure || 0) / 100,
          market_url: `https://kalshi.com/markets/${p.market_id}`,
          updated_at: new Date().toISOString()
        });
      });
    } catch(e) { console.warn('[sync-kalshi]', e.message); }
  }

  // Manifold (stored under kalshi_username field)
  if (user.kalshi_username) {
    try {
      const res = await fetch(`https://api.manifold.markets/v0/bets?username=${encodeURIComponent(user.kalshi_username)}&limit=50`);
      const bets = await res.json();
      const grouped = {};
      (Array.isArray(bets) ? bets : []).filter(b => !b.isRedemption && b.amount > 0).forEach(b => {
        if (!grouped[b.contractId]) grouped[b.contractId] = { bets: [], contractId: b.contractId };
        grouped[b.contractId].bets.push(b);
      });
      for (const contractId of Object.keys(grouped).slice(0, 20)) {
        try {
          const mRes = await fetch(`https://api.manifold.markets/v0/market/${contractId}`);
          const market = await mRes.json();
          if (market.isResolved) continue;
          const group = grouped[contractId];
          const totalAmount = group.bets.reduce((s, b) => s + b.amount, 0);
          const lastSide = group.bets[group.bets.length - 1]?.outcome || 'YES';
          upserts.push({
            user_id: user.id,
            platform: 'manifold',
            external_id: contractId,
            market_title: market.question,
            side: lastSide,
            shares: totalAmount,
            pnl: 0,
            probability: parseFloat(market.probability) || 0,
            market_url: market.url,
            updated_at: new Date().toISOString()
          });
        } catch(e2) { /* skip */ }
      }
    } catch(e) { console.warn('[sync-manifold]', e.message); }
  }

  if (upserts.length > 0) {
    // Snapshot old positions for copy-trade diff
    const { data: oldPositions } = await supabase
      .from('cached_positions')
      .select('external_id, platform')
      .eq('user_id', user.id);
    const oldIds = new Set((oldPositions || []).map(p => `${p.platform}:${p.external_id}`));

    await supabase.from('cached_positions').delete().eq('user_id', user.id);
    await supabase.from('cached_positions').insert(upserts);
    console.log(`[auto-sync] Synced ${upserts.length} positions for user ${user.id}`);

    // Copy trade notifications for new positions
    const newPositions = upserts.filter(u => !oldIds.has(`${u.platform}:${u.external_id}`));
    if (newPositions.length > 0) {
      try {
        const { data: subs } = await supabase
          .from('copy_trade_subscriptions')
          .select('subscriber_id')
          .eq('target_user_id', user.id);
        if (subs?.length) {
          const { data: userData } = await supabase.from('users').select('display_name').eq('id', user.id).maybeSingle();
          const name = userData?.display_name || 'A trader you follow';
          for (const pos of newPositions.slice(0, 5)) {
            for (const sub of subs) {
              pushNotification(sub.subscriber_id, 'copy_trade', `${name} entered a new position`, `${pos.side} on "${pos.market_title}" (${pos.platform})`);
            }
          }
        }
      } catch (e) { console.warn('[copy-trade notify]', e.message); }
    }
  }
}

// ── WEEKLY MEMBER DIGEST EMAIL ───────────────────────────────────────────────
async function sendWeeklyDigests() {
  const transporter = createMailTransport();
  if (!transporter) { console.log('[digest] SMTP not configured — skipping'); return; }

  console.log('[digest] Starting weekly member digests');
  const { data: creators } = await supabase
    .from('creator_settings')
    .select('slug, display_name, primary_color, custom_points_name');

  if (!creators?.length) return;

  for (const creator of creators) {
    try {
      const slug         = creator.slug;
      const communityName = creator.display_name || slug;
      const accentColor  = creator.primary_color || '#c9920d';
      const ptsName      = creator.custom_points_name || 'Flex Points';
      const communityUrl = `https://hyperflex.network/${slug}`;

      // Fetch top 3 hot markets
      const { data: markets } = await supabase
        .from('markets')
        .select('id, question, yes_price, no_price, yes_votes, no_votes, trader_count')
        .eq('tenant_slug', slug)
        .eq('resolved', false)
        .eq('archived', false)
        .order('trader_count', { ascending: false })
        .limit(3);

      if (!markets?.length) continue;

      // Fetch community members
      const { data: members } = await supabase
        .from('community_members')
        .select('user_id')
        .eq('creator_slug', slug);

      if (!members?.length) continue;

      const userIds = members.map(m => m.user_id);
      const { data: users } = await supabase
        .from('users').select('id, email, display_name').in('id', userIds);
      if (!users?.length) continue;

      // Leaderboard top 3 for this community
      const { data: allMktIds } = await supabase.from('markets').select('id').eq('tenant_slug', slug);
      const mktIds = (allMktIds || []).map(m => m.id);
      let leaderRows = [];
      if (mktIds.length) {
        const { data: posData } = await supabase
          .from('positions').select('user_id, potential_payout, won')
          .in('market_id', mktIds).eq('settled', true);
        const lmap = {};
        for (const p of (posData || [])) {
          if (!lmap[p.user_id]) lmap[p.user_id] = { wins: 0, total_payout: 0 };
          if (p.won) { lmap[p.user_id].wins++; lmap[p.user_id].total_payout += (p.potential_payout || 0); }
        }
        const leaderIds = Object.entries(lmap).sort((a, b) => b[1].total_payout - a[1].total_payout).slice(0, 3).map(([id]) => id);
        const { data: lNames } = leaderIds.length ? await supabase.from('users').select('id, display_name').in('id', leaderIds) : { data: [] };
        const nameMap = {};
        for (const u of (lNames || [])) nameMap[u.id] = u.display_name;
        leaderRows = leaderIds.map((id, i) => ({ rank: i + 1, name: nameMap[id] || 'Anonymous', pts: Math.round((lmap[id]?.total_payout || 0) / 100) }));
      }

      const marketsHtml = markets.map(m => {
        const yesPct = Math.round((m.yes_price || 0.5) * 100);
        return `<tr><td style="padding:10px 0;border-bottom:1px solid #2a2a27">
          <div style="font-size:14px;color:#f5f5f0;margin-bottom:4px">${m.question}</div>
          <div style="font-size:12px;color:#888">${m.trader_count || 0} traders · YES ${yesPct}%</div>
        </td></tr>`;
      }).join('');

      const medals = ['🥇', '🥈', '🥉'];
      const leaderHtml = leaderRows.map((r, i) => `<tr><td style="padding:8px 0">
        <span style="font-size:16px">${medals[i]}</span>
        <span style="font-size:14px;color:#f5f5f0;margin-left:8px">${r.name}</span>
        <span style="float:right;font-size:13px;color:${accentColor};font-weight:700">${r.pts.toLocaleString()} ${ptsName}</span>
      </td></tr>`).join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0">
<tr><td align="center">
  <table width="540" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:10px;overflow:hidden">
    <tr><td style="background:${accentColor};padding:18px 28px">
      <span style="font-size:20px;font-weight:900;color:#141412">HYPERFLEX</span>
      <span style="float:right;font-size:13px;color:#141412;opacity:.7;line-height:28px">${communityName} Weekly</span>
    </td></tr>
    <tr><td style="padding:28px">
      <h2 style="margin:0 0 6px;font-size:22px;color:#f5f5f0;font-weight:800">This week in ${communityName} 🎯</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#888">Here's what's happening in your prediction community.</p>
      <h3 style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:${accentColor}">🔥 Hot Markets</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${marketsHtml}</table>
      ${leaderHtml ? `<h3 style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:${accentColor}">🏆 Top Predictors</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${leaderHtml}</table>` : ''}
      <a href="${communityUrl}" style="display:inline-block;padding:12px 24px;background:${accentColor};color:#141412;font-weight:700;font-size:15px;border-radius:6px;text-decoration:none">Place your predictions →</a>
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #2a2a27">
      <p style="margin:0;font-size:11px;color:#555">Weekly digest from <a href="${communityUrl}" style="color:#888">${communityName}</a>. Powered by <a href="https://hyperflex.network" style="color:#888">HYPERFLEX</a>.</p>
    </td></tr>
  </table>
</td></tr>
</table></body></html>`;

      const fromAddress = process.env.SMTP_FROM || `"${communityName}" <noreply@hyperflex.network>`;
      const eligibleUsers = users.filter(u => u.email && !u.email_unsubscribed);
      const sends = await Promise.allSettled(eligibleUsers.map(async u => {
        const unsubToken = await getMemberUnsubToken(u.id);
        const unsubUrl = `https://hyperflex.network/unsubscribe?token=${unsubToken}`;
        const personalizedHtml = html.replace('</table></body></html>',
          `${unsubscribeFooterHtml(unsubUrl)}</table></body></html>`);
        return transporter.sendMail({
          from: fromAddress,
          replyTo: process.env.SMTP_REPLY_TO || fromAddress,
          to: u.email,
          subject: `This week in ${communityName} — hot markets & leaderboard 🎯`,
          html: personalizedHtml,
        });
      }));
      console.log(`[digest] ${slug}: ${sends.filter(r => r.status === 'fulfilled').length}/${eligibleUsers.length} sent`);
    } catch (err) {
      console.error(`[digest] Error for ${creator.slug}:`, err.message);
    }
  }
}
// Every Monday at 9am UTC
cron.schedule('0 9 * * 1', () => { console.log('[digest] Weekly digest cron triggered'); sendWeeklyDigests(); });

// ── PREDICTOR SPOTLIGHT EMAIL ─────────────────────────────────────────────────
// Every Monday 8am UTC — top predictors this week + hottest markets → all bettors
async function sendPredictorSpotlightEmail() {
  const transporter = createMailTransport();
  if (!transporter) { console.log('[spotlight] SMTP not configured — skipping'); return; }
  console.log('[spotlight] Starting predictor spotlight email');

  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    // 1. Top 3 predictors by win rate this week (among settled positions)
    const { data: weeklyPositions } = await supabase
      .from('positions')
      .select('user_id, won, markets(resolved_at)')
      .eq('settled', true)
      .gte('created_at', weekAgo);

    const statsMap = {};
    for (const p of (weeklyPositions || [])) {
      if (!statsMap[p.user_id]) statsMap[p.user_id] = { wins: 0, total: 0 };
      statsMap[p.user_id].total++;
      if (p.won) statsMap[p.user_id].wins++;
    }
    const topIds = Object.entries(statsMap)
      .filter(([, s]) => s.total >= 2)
      .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))
      .slice(0, 3)
      .map(([id]) => id);

    const { data: topUsers } = topIds.length
      ? await supabase.from('users').select('id, display_name').in('id', topIds)
      : { data: [] };
    const userMap = {};
    for (const u of (topUsers || [])) userMap[u.id] = u.display_name || 'Anonymous';

    const topPredictorsHtml = topIds.map((id, i) => {
      const s = statsMap[id];
      const wr = Math.round((s.wins / s.total) * 100);
      const medals = ['🥇', '🥈', '🥉'];
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #252523">
        <span style="font-size:16px">${medals[i]}</span>
        <a href="https://hyperflex.network/m/${id}" style="font-size:14px;color:#f5f5f0;margin-left:10px;text-decoration:none;font-weight:600">${userMap[id]}</a>
        <span style="float:right;font-size:13px;color:#c9920d;font-weight:700">${wr}% win rate · ${s.total} calls</span>
      </td></tr>`;
    }).join('');

    // 2. 3 hottest markets right now across all communities
    const { data: hotMarkets } = await supabase
      .from('markets')
      .select('id, question, yes_price, trader_count, tenant_slug')
      .eq('resolved', false)
      .eq('archived', false)
      .eq('is_public', true)
      .order('trader_count', { ascending: false })
      .limit(3);

    const hotMarketsHtml = (hotMarkets || []).map(m => {
      const yesPct = Math.round((m.yes_price || 0.5) * 100);
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #252523">
        <div style="font-size:14px;color:#f5f5f0;margin-bottom:4px">${m.question}</div>
        <div style="font-size:12px;color:#888">${m.tenant_slug} · ${m.trader_count || 0} traders · YES ${yesPct}%
          <a href="https://hyperflex.network/${m.tenant_slug}" style="color:#c9920d;margin-left:8px;text-decoration:none">Predict →</a>
        </div>
      </td></tr>`;
    }).join('');

    if (!topPredictorsHtml && !hotMarketsHtml) {
      console.log('[spotlight] No data to send — skipping');
      return;
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0">
<tr><td align="center">
  <table width="540" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:10px;overflow:hidden">
    <tr><td style="background:#c9920d;padding:18px 28px">
      <span style="font-size:20px;font-weight:900;color:#141412">HYPERFLEX</span>
      <span style="float:right;font-size:13px;color:#141412;opacity:.7;line-height:28px">Weekly Spotlight</span>
    </td></tr>
    <tr><td style="padding:28px">
      <h2 style="margin:0 0 6px;font-size:22px;color:#f5f5f0;font-weight:800">🏆 This week on HYPERFLEX</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#888">Top predictors and the hottest markets right now.</p>
      ${topPredictorsHtml ? `
      <h3 style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#c9920d">🏆 Top Predictors This Week</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${topPredictorsHtml}</table>` : ''}
      ${hotMarketsHtml ? `
      <h3 style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#c9920d">🔥 Hot Markets Right Now</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${hotMarketsHtml}</table>` : ''}
      <a href="https://hyperflex.network/predictors" style="display:inline-block;padding:12px 24px;background:#c9920d;color:#141412;font-weight:700;font-size:15px;border-radius:6px;text-decoration:none">See full leaderboard →</a>
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #2a2a27">
      <p style="margin:0;font-size:11px;color:#555">Weekly spotlight from <a href="https://hyperflex.network" style="color:#888">HYPERFLEX</a>.</p>
    </td></tr>
  </table>
</td></tr>
</table></body></html>`;

    // 3. Send to every user who has ever placed a bet
    const { data: bettors } = await supabase
      .from('positions')
      .select('user_id')
      .limit(5000);
    const bettor_ids = [...new Set((bettors || []).map(p => p.user_id))];
    if (!bettor_ids.length) return;

    const { data: allUsers } = await supabase
      .from('users')
      .select('id, email, email_unsubscribed')
      .in('id', bettor_ids);

    const eligible = (allUsers || []).filter(u => u.email && !u.email_unsubscribed);
    const fromAddress = process.env.SMTP_FROM || 'HYPERFLEX <noreply@hyperflex.network>';

    const sends = await Promise.allSettled(eligible.map(async u => {
      const unsubToken = await getMemberUnsubToken(u.id);
      const unsubUrl = `https://hyperflex.network/unsubscribe?token=${unsubToken}`;
      const personalizedHtml = html.replace('</table></body></html>',
        `${unsubscribeFooterHtml(unsubUrl)}</table></body></html>`);
      return transporter.sendMail({
        from: fromAddress,
        to: u.email,
        subject: '🏆 This week on HYPERFLEX',
        html: personalizedHtml,
      });
    }));

    console.log(`[spotlight] ${sends.filter(r => r.status === 'fulfilled').length}/${eligible.length} sent`);
  } catch (err) {
    console.error('[spotlight] Error:', err.message);
  }
}
cron.schedule('0 8 * * 1', () => { console.log('[spotlight] Predictor spotlight cron triggered'); sendPredictorSpotlightEmail(); });

// ─── STREAK WARNING EMAILS ─────────────────────────────────────────────────────
// Daily at 6pm UTC — sends "Your X-win streak ends tonight" to users who:
//   • have a current consecutive win streak ≥ 3
//   • have NOT placed any bet in the last 24 hours (i.e. they're inactive today)
//   • belong to at least one community with open markets they haven't bet on
// No-op if SMTP_HOST is not configured.
async function sendStreakWarningEmails() {
  const transporter = createMailTransport();
  if (!transporter) { console.log('[streak-warn] SMTP not configured — skipping'); return; }

  console.log('[streak-warn] Starting streak warning emails');

  try {
    // 1. Find users who placed at least one settled position (ever)
    //    We'll compute their streak from settled positions, sorted desc
    const { data: allSettled } = await supabase
      .from('positions')
      .select('user_id, won, created_at')
      .eq('settled', true)
      .order('created_at', { ascending: false })
      .limit(10000);

    if (!allSettled?.length) return;

    // Group settled positions per user (already sorted desc)
    const possByUser = {};
    for (const p of allSettled) {
      if (!possByUser[p.user_id]) possByUser[p.user_id] = [];
      possByUser[p.user_id].push(p);
    }

    // Compute streak per user — only keep those with streak ≥ 3
    const streakUsers = []; // [{ userId, streak }]
    for (const [uid, positions] of Object.entries(possByUser)) {
      let s = 0;
      for (const p of positions) { if (p.won) s++; else break; }
      if (s >= 3) streakUsers.push({ userId: uid, streak: s });
    }

    if (!streakUsers.length) { console.log('[streak-warn] No users with streak ≥ 3'); return; }

    // 2. Find users who placed a bet in the last 24 hours (active today — skip them)
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentBets } = await supabase
      .from('positions')
      .select('user_id')
      .gte('created_at', since24h);
    const activeToday = new Set((recentBets || []).map(p => p.user_id));

    // Only email users who are NOT active today
    const inactiveStreakers = streakUsers.filter(u => !activeToday.has(u.userId));
    if (!inactiveStreakers.length) { console.log('[streak-warn] All streaking users already active today'); return; }

    // 3. Fetch user emails + display names
    const userIds = inactiveStreakers.map(u => u.userId);
    const { data: users } = await supabase
      .from('users')
      .select('id, email, display_name, email_unsubscribed')
      .in('id', userIds);
    if (!users?.length) return;

    const userMap = {};
    for (const u of users) userMap[u.id] = u;

    // 4. For each inactive streaking user, find their communities + open markets
    //    community_balances gives us which communities they belong to
    const { data: memberships } = await supabase
      .from('community_balances')
      .select('user_id, creator_slug')
      .in('user_id', userIds);

    // Group creator slugs per user
    const userSlugs = {};
    for (const m of (memberships || [])) {
      if (!userSlugs[m.user_id]) userSlugs[m.user_id] = [];
      userSlugs[m.user_id].push(m.creator_slug);
    }

    // Fetch open markets per creator slug (batch by unique slugs)
    const allSlugs = [...new Set(Object.values(userSlugs).flat())];
    const { data: openMarkets } = await supabase
      .from('markets')
      .select('id, question, tenant_slug, yes_price, trader_count')
      .in('tenant_slug', allSlugs)
      .eq('resolved', false)
      .eq('archived', false)
      .neq('is_public', false)
      .order('trader_count', { ascending: false })
      .limit(200);

    // Map: slug → markets[]
    const marketsBySlug = {};
    for (const m of (openMarkets || [])) {
      if (!marketsBySlug[m.tenant_slug]) marketsBySlug[m.tenant_slug] = [];
      marketsBySlug[m.tenant_slug].push(m);
    }

    // Fetch creator settings for community name + color
    const { data: creatorSettings } = await supabase
      .from('creator_settings')
      .select('slug, display_name, primary_color, custom_points_name')
      .in('slug', allSlugs);
    const settingsBySlug = {};
    for (const c of (creatorSettings || [])) settingsBySlug[c.slug] = c;

    // 5. Send emails
    let sent = 0;
    for (const { userId, streak } of inactiveStreakers) {
      const user = userMap[userId];
      if (!user?.email) continue;

      const slugs = userSlugs[userId] || [];
      // Gather up to 3 open markets across their communities (prefer most active)
      const candidateMarkets = [];
      for (const slug of slugs) {
        const ms = (marketsBySlug[slug] || []).slice(0, 2);
        for (const m of ms) {
          const cs = settingsBySlug[slug] || {};
          candidateMarkets.push({ ...m, community_name: cs.display_name || slug, slug, accent: cs.primary_color || '#c9920d', ptsName: cs.custom_points_name || 'Flex Points' });
        }
      }
      // Sort by trader_count desc, take top 3
      candidateMarkets.sort((a, b) => (b.trader_count || 0) - (a.trader_count || 0));
      const topMarkets = candidateMarkets.slice(0, 3);

      if (!topMarkets.length) continue; // no open markets in their communities

      const firstName = (user.display_name || 'there').split(' ')[0];
      const accent = topMarkets[0]?.accent || '#c9920d';
      const communityUrl = `https://hyperflex.network/${topMarkets[0]?.slug}`;

      const streakLabel = streak >= 10 ? `${streak}-WIN STREAK 🔥🔥` : streak >= 5 ? `${streak}-WIN STREAK 🔥` : `${streak}-WIN STREAK`;
      const urgencyLine = streak >= 7
        ? `You're on an absolute tear — ${streak} correct calls in a row. Legendary status is within reach.`
        : streak >= 5
        ? `${streak} wins in a row. You're in the zone. Don't let momentum slip away.`
        : `${streak} correct calls in a row. You're on a roll — keep it going.`;

      const marketsHtml = topMarkets.map(m => {
        const yesPct = Math.round((m.yes_price || 0.5) * 100);
        const url = `https://hyperflex.network/${m.slug}?market=${m.id}`;
        return `<tr>
          <td style="padding:12px 0;border-bottom:1px solid #2a2a27">
            <a href="${url}" style="text-decoration:none">
              <div style="font-size:14px;color:#f5f5f0;margin-bottom:4px;line-height:1.4">${m.question}</div>
              <div style="font-size:12px;color:#888">${m.community_name} · ${m.trader_count || 0} traders · YES ${yesPct}%</div>
            </a>
          </td>
        </tr>`;
      }).join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0">
<tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:12px;overflow:hidden;border:1px solid rgba(201,146,13,.25)">
    <tr><td style="background:${accent};padding:16px 28px">
      <span style="font-size:18px;font-weight:900;color:#141412">HYPERFLEX</span>
    </td></tr>
    <tr><td style="padding:32px 28px 24px">
      <div style="display:inline-block;background:rgba(201,146,13,.12);border:1px solid rgba(201,146,13,.35);border-radius:8px;padding:8px 16px;margin-bottom:20px">
        <span style="font-family:monospace;font-size:13px;font-weight:700;color:${accent};letter-spacing:.08em">${streakLabel}</span>
      </div>
      <h2 style="margin:0 0 10px;font-size:22px;color:#f5f5f0;font-weight:800;line-height:1.3">Don't lose your streak, ${firstName}.</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6">${urgencyLine} Place a prediction today to keep the fire alive.</p>
      <h3 style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:${accent}">🔥 Open markets — predict now</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${marketsHtml}</table>
      <a href="${communityUrl}" style="display:inline-block;padding:13px 28px;background:${accent};color:#141412;font-weight:800;font-size:15px;border-radius:8px;text-decoration:none">Keep my streak →</a>
    </td></tr>
  </table>
</td></tr>
</table></body></html>`;

      // Skip unsubscribed users
      if (user.email_unsubscribed) continue;

      try {
        const unsubToken = await getMemberUnsubToken(userId);
        const unsubUrl = `https://hyperflex.network/unsubscribe?token=${unsubToken}`;
        const finalHtml = html.replace('</table></body></html>',
          `<table width="100%" cellpadding="0" cellspacing="0"><tbody>${unsubscribeFooterHtml(unsubUrl)}</tbody></table></body></html>`);
        await transporter.sendMail({
          from: process.env.SMTP_FROM || 'HYPERFLEX <noreply@hyperflex.network>',
          to: user.email,
          subject: `🔥 You're on a ${streak}-win streak — don't lose it tonight`,
          html: finalHtml,
        });
        sent++;
      } catch (e) {
        console.error(`[streak-warn] Failed to send to ${user.email}:`, e.message);
      }
    }
    console.log(`[streak-warn] Sent ${sent} streak warning emails`);
  } catch (err) {
    console.error('[streak-warn] Error:', err.message);
  }
}
// Every day at 6pm UTC
cron.schedule('0 18 * * *', () => { console.log('[streak-warn] Streak warning cron triggered'); sendStreakWarningEmails(); });

// ─── DEAD MARKET NUDGE EMAILS ─────────────────────────────────────────────────
// Weekly on Wednesday at 10am UTC.
// Finds creators who have markets that have been open for 7+ days with < 3 traders.
// Sends a friendly nudge: "These markets need love — share them or close them."
// Skips creators who are unsubscribed or have no email configured.
async function sendDeadMarketNudges() {
  const transporter = createMailTransport();
  if (!transporter) { console.log('[dead-market] SMTP not configured — skipping'); return; }

  console.log('[dead-market] Starting dead market nudge emails');
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Find open markets older than 7 days with fewer than 3 traders
    const { data: deadMarkets } = await supabase
      .from('markets')
      .select('id, question, tenant_slug, trader_count, created_at')
      .eq('resolved', false)
      .eq('archived', false)
      .neq('is_public', false)
      .lt('created_at', cutoff)
      .lt('trader_count', 3)
      .order('trader_count', { ascending: true })
      .limit(500);

    if (!deadMarkets?.length) { console.log('[dead-market] No dead markets found'); return; }

    // Group by creator slug
    const bySlug = {};
    for (const m of deadMarkets) {
      if (!bySlug[m.tenant_slug]) bySlug[m.tenant_slug] = [];
      bySlug[m.tenant_slug].push(m);
    }

    const slugs = Object.keys(bySlug);
    const { data: creators } = await supabase
      .from('creator_settings')
      .select('id, slug, email, display_name, primary_color, email_unsubscribed, email_unsubscribe_token')
      .in('slug', slugs);

    let sent = 0;
    for (const creator of (creators || [])) {
      if (!creator.email || creator.email_unsubscribed) continue;
      const markets = bySlug[creator.slug] || [];
      if (!markets.length) continue;

      const accent = creator.primary_color || '#c9920d';
      const communityName = creator.display_name || creator.slug;
      const dashUrl = 'https://hyperflex.network/creator/dashboard';

      const marketRows = markets.slice(0, 5).map(m => {
        const daysOld = Math.floor((Date.now() - new Date(m.created_at)) / (1000 * 60 * 60 * 24));
        return `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a27">
            <div style="font-size:13px;color:#f5f5f0;margin-bottom:3px;line-height:1.4">${m.question}</div>
            <div style="font-size:11px;color:#666">${daysOld} days old · ${m.trader_count || 0} traders</div>
          </td>
        </tr>`;
      }).join('');

      const unsubToken = creator.email_unsubscribe_token || await getCreatorUnsubToken(creator.id);
      const unsubUrl = `https://hyperflex.network/unsubscribe?token=${unsubToken}`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0">
<tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:12px;overflow:hidden">
    <tr><td style="background:#1c1c1a;padding:16px 28px;border-bottom:1px solid #2a2a27">
      <span style="font-size:17px;font-weight:900;color:${accent}">HYPERFLEX</span>
    </td></tr>
    <tr><td style="padding:28px 28px 20px">
      <h2 style="margin:0 0 10px;font-size:20px;color:#f5f5f0;font-weight:800">These markets need some love 💬</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#888;line-height:1.6">
        ${markets.length} market${markets.length > 1 ? 's' : ''} in <strong style="color:#f5f5f0">${communityName}</strong>
        ${markets.length > 1 ? 'have' : 'has'} been open for over a week with very few predictions.
        Share ${markets.length > 1 ? 'them' : 'it'} with your audience — or archive ${markets.length > 1 ? 'them' : 'it'} to keep your community focused.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${marketRows}</table>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <a href="${dashUrl}" style="display:inline-block;padding:12px 24px;background:${accent};color:#141412;font-weight:800;font-size:14px;border-radius:8px;text-decoration:none">Manage markets →</a>
      </div>
      <p style="margin:20px 0 0;font-size:12px;color:#666;line-height:1.6">
        <strong style="color:#888">Tip:</strong> Share your community link on your next post with a call to action — "Predict what happens next →". Markets with even 5 traders feel much more alive.
      </p>
    </td></tr>
    ${creatorUnsubscribeFooterHtml(unsubUrl)}
  </table>
</td></tr>
</table></body></html>`;

      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || 'HYPERFLEX <noreply@hyperflex.network>',
          to: creator.email,
          subject: `${markets.length} market${markets.length > 1 ? 's' : ''} in ${communityName} need${markets.length === 1 ? 's' : ''} attention`,
          html,
        });
        sent++;
      } catch (e) {
        console.error(`[dead-market] Failed for ${creator.email}:`, e.message);
      }
    }
    console.log(`[dead-market] Sent ${sent} nudge emails`);
  } catch (err) {
    console.error('[dead-market] Error:', err.message);
  }
}
// Every Wednesday at 10am UTC
cron.schedule('0 10 * * 3', () => { console.log('[dead-market] Dead market nudge cron triggered'); sendDeadMarketNudges(); });

// ─── MEMBER WIN-BACK EMAILS ────────────────────────────────────────────────────
// Fridays at 11am UTC — re-engage members who placed at least one bet ever but
// haven't been active in 14+ days. Shows them what they're missing.
async function sendMemberWinBackEmails() {
  const transporter = createMailTransport();
  if (!transporter) { console.log('[winback] SMTP not configured — skipping'); return; }

  console.log('[winback] Starting member win-back emails');
  try {
    const cutoff14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const cutoff60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // don't email if dormant 60+ days (avoid spam)

    // Find users who have placed at least one bet but none in last 14 days
    // Strategy: get all users with positions, find those whose most recent is 14-60 days ago
    const { data: recentPos } = await supabase
      .from('positions')
      .select('user_id, created_at')
      .gte('created_at', cutoff60d)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (!recentPos?.length) return;

    // For each user, find their most recent bet
    const latestByUser = {};
    for (const p of recentPos) {
      if (!latestByUser[p.user_id]) latestByUser[p.user_id] = p.created_at;
    }

    // Keep users whose latest bet is older than 14 days
    const inactiveUserIds = Object.entries(latestByUser)
      .filter(([, ts]) => ts < cutoff14d)
      .map(([id]) => id);

    if (!inactiveUserIds.length) { console.log('[winback] No inactive users found'); return; }

    // Fetch user info + unsubscribe status
    const { data: users } = await supabase
      .from('users')
      .select('id, email, display_name, email_unsubscribed')
      .in('id', inactiveUserIds);

    if (!users?.length) return;

    // For each user, find their communities + hottest open market
    const { data: memberships } = await supabase
      .from('community_balances')
      .select('user_id, creator_slug')
      .in('user_id', inactiveUserIds);

    const userSlugs = {};
    for (const m of (memberships || [])) {
      if (!userSlugs[m.user_id]) userSlugs[m.user_id] = [];
      userSlugs[m.user_id].push(m.creator_slug);
    }

    const allSlugs = [...new Set(Object.values(userSlugs).flat())];
    const { data: openMarkets } = await supabase
      .from('markets')
      .select('id, question, tenant_slug, yes_price, trader_count')
      .in('tenant_slug', allSlugs)
      .eq('resolved', false)
      .eq('archived', false)
      .neq('is_public', false)
      .order('trader_count', { ascending: false })
      .limit(300);

    const marketsBySlug = {};
    for (const m of (openMarkets || [])) {
      if (!marketsBySlug[m.tenant_slug]) marketsBySlug[m.tenant_slug] = [];
      marketsBySlug[m.tenant_slug].push(m);
    }

    const { data: creators } = await supabase
      .from('creator_settings')
      .select('slug, display_name, primary_color, custom_points_name')
      .in('slug', allSlugs);
    const creatorMap = {};
    for (const c of (creators || [])) creatorMap[c.slug] = c;

    let sent = 0;
    for (const user of users) {
      if (!user.email || user.email_unsubscribed) continue;

      const slugs = userSlugs[user.id] || [];
      const candidateMarkets = [];
      for (const slug of slugs) {
        const ms = (marketsBySlug[slug] || []).slice(0, 2);
        const cs = creatorMap[slug] || {};
        for (const m of ms) {
          candidateMarkets.push({ ...m, community_name: cs.display_name || slug, slug, accent: cs.primary_color || '#c9920d', ptsName: cs.custom_points_name || 'Flex Points' });
        }
      }
      candidateMarkets.sort((a, b) => (b.trader_count || 0) - (a.trader_count || 0));
      const topMarkets = candidateMarkets.slice(0, 3);
      if (!topMarkets.length) continue;

      const firstName = (user.display_name || 'there').split(' ')[0];
      const accent = topMarkets[0]?.accent || '#c9920d';
      const communityUrl = `https://hyperflex.network/${topMarkets[0]?.slug}`;
      const daysSince = Math.floor((Date.now() - new Date(latestByUser[user.id])) / (1000 * 60 * 60 * 24));

      const marketsHtml = topMarkets.map(m => {
        const yesPct = Math.round((m.yes_price || 0.5) * 100);
        const url = `https://hyperflex.network/${m.slug}?market=${m.id}`;
        return `<tr><td style="padding:11px 0;border-bottom:1px solid #2a2a27">
          <a href="${url}" style="text-decoration:none">
            <div style="font-size:14px;color:#f5f5f0;margin-bottom:3px;line-height:1.4">${m.question}</div>
            <div style="font-size:12px;color:#888">${m.community_name} · ${m.trader_count || 0} traders · YES ${yesPct}%</div>
          </a>
        </td></tr>`;
      }).join('');

      const unsubToken = await getMemberUnsubToken(user.id);
      const unsubUrl = `https://hyperflex.network/unsubscribe?token=${unsubToken}`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0">
<tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:12px;overflow:hidden">
    <tr><td style="background:${accent};padding:16px 28px">
      <span style="font-size:18px;font-weight:900;color:#141412">HYPERFLEX</span>
    </td></tr>
    <tr><td style="padding:30px 28px 24px">
      <h2 style="margin:0 0 10px;font-size:20px;color:#f5f5f0;font-weight:800;line-height:1.3">You've been away ${daysSince} days, ${firstName}.</h2>
      <p style="margin:0 0 22px;font-size:14px;color:#888;line-height:1.7">Your communities kept going without you. Here's what's hot right now — jump back in and make your predictions.</p>
      <h3 style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:${accent}">🔥 Active markets in your communities</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${marketsHtml}</table>
      <a href="${communityUrl}" style="display:inline-block;padding:13px 28px;background:${accent};color:#141412;font-weight:800;font-size:15px;border-radius:8px;text-decoration:none">Make a prediction →</a>
    </td></tr>
    <table width="100%" cellpadding="0" cellspacing="0"><tbody>${unsubscribeFooterHtml(unsubUrl)}</tbody></table>
  </table>
</td></tr>
</table></body></html>`;

      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || 'HYPERFLEX <noreply@hyperflex.network>',
          to: user.email,
          subject: `You've been away — here's what's happening in your communities`,
          html,
        });
        sent++;
      } catch (e) {
        console.error(`[winback] Failed to send to ${user.email}:`, e.message);
      }
    }
    console.log(`[winback] Sent ${sent} win-back emails`);
  } catch (err) {
    console.error('[winback] Error:', err.message);
  }
}
// Every Friday at 11am UTC
cron.schedule('0 11 * * 5', () => { console.log('[winback] Win-back cron triggered'); sendMemberWinBackEmails(); });

// GET /api/win-card/:marketId/:userId — public win card data
app.get('/api/win-card/:marketId/:userId', async (req, res) => {
  try {
    const { marketId, userId } = req.params;

    const [mktRes, posRes] = await Promise.all([
      supabase.from('markets').select('id, question, category, outcome, yes_price, no_price, yes_votes, no_votes, trader_count, tenant_slug, creator_id, resolved_at').eq('id', marketId).maybeSingle(),
      supabase.from('positions').select('side, amount, potential_payout, won, settled').eq('market_id', marketId).eq('user_id', userId).order('created_at', { ascending: false })
    ]);

    const market = mktRes.data;
    if (!market || !market.resolved_at) return res.status(404).json({ error: 'Market not found or not resolved' });

    // Aggregate positions (user may have bet multiple times)
    const positions = posRes.data || [];
    if (!positions.length) return res.status(404).json({ error: 'No position found' });

    const totalAmount = positions.reduce((s, p) => s + (p.amount || 0), 0);
    const totalPayout = positions.filter(p => p.won).reduce((s, p) => s + (p.potential_payout || 0), 0);
    const won = positions.some(p => p.won);
    const side = positions[0].side;

    // Community settings
    const slug = market.tenant_slug;
    const { data: settings } = await supabase.from('creator_settings')
      .select('display_name, custom_points_name, primary_color, logo_url')
      .or(slug ? `slug.eq.${slug}` : `creator_id.eq.${market.creator_id}`)
      .maybeSingle();

    // Winner display name
    const { data: userRow } = await supabase.from('users').select('display_name').eq('id', userId).maybeSingle();

    res.json({
      market: {
        id: market.id,
        question: market.question,
        category: market.category,
        outcome: market.outcome,
        trader_count: market.trader_count,
        resolved_at: market.resolved_at,
        slug: market.tenant_slug
      },
      position: {
        side,
        amount: Math.round(totalAmount / 100),
        payout: Math.round(totalPayout / 100),
        won
      },
      community: {
        display_name: settings?.display_name || slug || 'HYPERFLEX',
        custom_points_name: settings?.custom_points_name || 'Flex Points',
        primary_color: settings?.primary_color || '#c9920d',
        logo_url: settings?.logo_url || null,
        slug: slug || ''
      },
      user: { display_name: userRow?.display_name || 'A predictor' }
    });
  } catch (err) {
    console.error('[win-card]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /win/:marketId/:userId — OG-tagged win card share page
app.get('/win/:marketId/:userId', async (req, res) => {
  try {
    const { marketId, userId } = req.params;
    const apiRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/win-card/${marketId}/${userId}`);
    if (!apiRes.ok) return res.sendFile(path.join(__dirname, 'public', 'win-card.html'));
    const data = await apiRes.json();
    const won = data.position?.won;
    if (!won) return res.sendFile(path.join(__dirname, 'public', 'win-card.html'));

    const title = `${data.user.display_name} called it on ${data.community.display_name} 🎯`;
    const desc  = `"${data.market.question}" — predicted ${data.position.side} correctly. ${data.position.payout > 0 ? `Won ${data.position.payout.toLocaleString()} ${data.community.custom_points_name}.` : ''} Compete at hyperflex.network`;
    const url   = `https://hyperflex.network/win/${marketId}/${userId}`;
    const commUrl = `https://hyperflex.network/${data.community.slug}`;

    const winOgImage = `https://hyperflex.network/og/${marketId}.png`;
    const html = `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<title>${title}</title>
<meta name="description" content="${desc}"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${desc}"/>
<meta property="og:url" content="${url}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="HYPERFLEX"/>
<meta property="og:image" content="${winOgImage}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${title}"/>
<meta name="twitter:description" content="${desc}"/>
<meta name="twitter:image" content="${winOgImage}"/>
<meta http-equiv="refresh" content="0;url=/win-card.html#${encodeURIComponent(JSON.stringify({ marketId, userId }))}"/>
<script>location.href='/win-card.html?m=${marketId}&u=${userId}';</script>
</head><body></body></html>`;
    res.send(html);
  } catch {
    res.sendFile(path.join(__dirname, 'public', 'win-card.html'));
  }
});

// Read community.html once at startup and cache it
const COMMUNITY_HTML = fs.readFileSync(path.join(__dirname, 'public', 'community.html'), 'utf8');

app.get('/:slug', async (req, res, next) => {
  const { slug } = req.params;
  if (RESERVED_SLUGS.has(slug) || slug.includes('.')) return next();

  try {
    // Fetch community data for meta tags
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('display_name, community_description, custom_points_name, slug')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    const APP_URL = process.env.APP_URL || 'https://hyperflex.network';

    let title, description, ogUrl, ogImage;

    if (settings) {
      const name = settings.display_name || slug;
      const pts  = settings.custom_points_name || 'Flex Points';
      const desc = settings.community_description
        ? settings.community_description.slice(0, 160)
        : `Make predictions, earn ${pts}, and climb the leaderboard in ${name}'s community on HYPERFLEX.`;

      title       = `${name} — Prediction Market`;
      description = desc;
      ogUrl       = `${APP_URL}/${slug}`;
      ogImage     = `${APP_URL}/og-default.png`;
    } else {
      // Community not found — still serve the page (it will show 404 state via JS)
      title       = 'HYPERFLEX — Community Prediction Markets';
      description = 'Make predictions, earn points, and compete on the leaderboard.';
      ogUrl       = `${APP_URL}/${slug}`;
      ogImage     = `${APP_URL}/og-default.png`;
    }

    const esc = s => s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const metaTags = `
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}"/>
  <!-- Open Graph -->
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${esc(ogUrl)}"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(description)}"/>
  <meta property="og:image" content="${esc(ogImage)}"/>
  <meta property="og:site_name" content="HYPERFLEX"/>
  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(description)}"/>
  <meta name="twitter:image" content="${esc(ogImage)}"/>`;

    // Inject after <head> — replace the generic <title> line
    const html = COMMUNITY_HTML
      .replace('<title>HYPERFLEX Community</title>', metaTags);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (err) {
    console.error('/:slug meta SSR error:', err.message);
    res.sendFile(path.join(__dirname, 'public', 'community.html'));
  }
});

// ════════════════════════════════════════════════════════════
// ADMIN — internal ops dashboard
// Protected by ADMIN_SECRET env var (sent as ?secret=... or Authorization header)
// ════════════════════════════════════════════════════════════

function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(503).json({ error: 'Admin not configured (set ADMIN_SECRET)' });
  const provided = req.query.secret || (req.headers.authorization || '').replace('Bearer ', '').trim() || (req.body && req.body.secret) || '';
  if (provided !== secret) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Serve admin HTML
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// GET /api/admin/creators — all creators with stats
app.get('/api/admin/creators', requireAdmin, async (req, res) => {
  try {
    // All creator settings
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('creator_id, slug, display_name, plan, created_at, custom_points_name, primary_color, plan_trial_expires_at')
      .order('created_at', { ascending: false });

    if (!settings?.length) return res.json([]);

    const slugs      = settings.map(s => s.slug);
    const creatorIds = settings.map(s => s.creator_id).filter(Boolean);

    // Run all enrichment queries in parallel
    const [usersRes, marketRes, memberRes] = await Promise.all([
      // Emails
      creatorIds.length
        ? supabase.from('users').select('id, email').in('id', creatorIds)
        : Promise.resolve({ data: [] }),
      // Market counts (by tenant_slug — more accurate than creator_id join)
      supabase.from('markets').select('tenant_slug').in('tenant_slug', slugs),
      // Member counts (community_balances rows per slug)
      supabase.from('community_balances').select('creator_slug').in('creator_slug', slugs),
    ]);

    const emailMap = Object.fromEntries((usersRes.data || []).map(u => [u.id, u.email]));

    const mktMap = {};
    (marketRes.data || []).forEach(m => { mktMap[m.tenant_slug] = (mktMap[m.tenant_slug] || 0) + 1; });

    const memMap = {};
    (memberRes.data || []).forEach(b => { memMap[b.creator_slug] = (memMap[b.creator_slug] || 0) + 1; });

    const rows = settings.map(s => ({
      creator_id:       s.creator_id,
      slug:             s.slug,
      name:             s.display_name,
      email:            emailMap[s.creator_id] || '—',
      plan:             s.plan || 'free',
      markets:          mktMap[s.slug] || 0,
      members:          memMap[s.slug] || 0,
      joined:           s.created_at,
      trial_expires_at: s.plan_trial_expires_at || null,
    }));

    res.json(rows);
  } catch (err) {
    console.error('[admin] creators error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/set-plan — manually set creator plan
// Body: { slug, plan: 'free'|'pro'|'platinum' }
app.post('/api/admin/set-plan', requireAdmin, async (req, res) => {
  try {
    const { slug, plan } = req.body;
    if (!slug || !['free','pro','platinum'].includes(plan)) {
      return res.status(400).json({ error: 'slug and valid plan required' });
    }
    const { error } = await supabase
      .from('creator_settings')
      .update({ plan, plan_trial_expires_at: null }) // clear any trial when plan is set manually
      .eq('slug', slug);
    if (error) throw error;
    console.log(`[admin] set ${slug} → ${plan}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin] set-plan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users — all non-creator members with activity stats
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { data: allUsers } = await supabase
      .from('users')
      .select('id, email, display_name, created_at')
      .order('created_at', { ascending: false });

    if (!allUsers?.length) return res.json([]);

    // Which users are creators?
    const { data: creatorSettings } = await supabase
      .from('creator_settings')
      .select('creator_id');
    const creatorIdSet = new Set((creatorSettings || []).map(s => s.creator_id));

    // Trade counts per user
    const allUserIds = allUsers.map(u => u.id);
    const { data: positions } = await supabase
      .from('positions')
      .select('user_id')
      .in('user_id', allUserIds);
    const tradeMap = {};
    (positions || []).forEach(p => { tradeMap[p.user_id] = (tradeMap[p.user_id] || 0) + 1; });

    // Community balance totals per user
    const { data: balances } = await supabase
      .from('community_balances')
      .select('user_id, balance')
      .in('user_id', allUserIds);
    const balMap = {};
    (balances || []).forEach(b => { balMap[b.user_id] = (balMap[b.user_id] || 0) + (b.balance || 0); });

    const rows = allUsers.map(u => ({
      id:           u.id,
      email:        u.email || '—',
      display_name: u.display_name || '—',
      is_creator:   creatorIdSet.has(u.id),
      trades:       tradeMap[u.id] || 0,
      total_balance: balMap[u.id] || 0,
      joined:       u.created_at
    }));

    res.json(rows);
  } catch (err) {
    console.error('[admin] users error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/platform-stats — platform-wide metrics
app.get('/api/admin/platform-stats', requireAdmin, async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: totalUsers },
      { count: totalCreators },
      { count: totalMarkets },
      { count: totalTrades },
      { count: newUsers7d },
      { count: newTrades7d }
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('creator_settings').select('*', { count: 'exact', head: true }),
      supabase.from('markets').select('*', { count: 'exact', head: true }),
      supabase.from('positions').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
      supabase.from('positions').select('*', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo)
    ]);

    res.json({
      total_users:    totalUsers   || 0,
      total_creators: totalCreators || 0,
      total_markets:  totalMarkets  || 0,
      total_trades:   totalTrades   || 0,
      new_users_7d:   newUsers7d    || 0,
      new_trades_7d:  newTrades7d   || 0
    });
  } catch (err) {
    console.error('[admin] platform-stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CREATOR OUTREACH / INVITES ────────────────────────────
// GET  /api/admin/invites  — list all sent invites
// POST /api/admin/invite   — send a personalized invite email

app.get('/api/admin/invites', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('creator_invites')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ invites: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/invite', requireAdmin, async (req, res) => {
  try {
    const { name, email, channel_url, note } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });

    // Save to DB
    const { data: invite, error } = await supabase
      .from('creator_invites')
      .insert([{ name, email, channel_url: channel_url || null, note: note || null }])
      .select()
      .single();
    if (error) throw error;

    // Send email if SMTP configured
    const transporter = createMailTransport();
    if (transporter) {
      const personalNote = note ? `<p style="font-size:15px;line-height:1.7;color:#ddd8cc;font-style:italic;border-left:3px solid #c9920d;padding-left:16px;margin:20px 0">"${note}"</p>` : '';
      const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#141412;font-family:'Helvetica Neue',sans-serif">
<div style="max-width:560px;margin:40px auto;background:#1c1c19;border:1px solid #2a2a27;border-radius:14px;overflow:hidden">
  <div style="background:#c9920d;padding:20px 32px">
    <div style="font-size:18px;font-weight:800;color:#141412;letter-spacing:0.05em">HYPERFLEX</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#ddd8cc;margin:0 0 16px">Hey ${name}, your community deserves a prediction market.</h1>
    ${personalNote}
    <p style="font-size:15px;line-height:1.7;color:#9a9590">I built HYPERFLEX to give creators like you a way to make your content interactive. Your audience predicts on what you cover — who wins, what happens next, what you'll say — and competes on a live leaderboard.</p>
    <p style="font-size:15px;line-height:1.7;color:#9a9590">The AI scans your YouTube videos and writes the markets for you. Takes about 5 minutes to set up.</p>
    <div style="background:#141412;border-radius:10px;padding:20px 24px;margin:24px 0">
      <div style="font-size:13px;color:#c9920d;font-weight:700;margin-bottom:12px;letter-spacing:0.06em;text-transform:uppercase">What you get</div>
      <div style="font-size:13px;color:#ddd8cc;line-height:2">✓ Branded community page at hyperflex.network/yourname<br/>✓ AI generates markets from your YouTube videos<br/>✓ Live leaderboard + streak bonuses keep members coming back<br/>✓ Custom rewards you design for top predictors<br/>✓ Free forever to start</div>
    </div>
    <a href="https://hyperflex.network/creator/signup" style="display:inline-block;background:#c9920d;color:#141412;font-weight:800;font-size:15px;padding:14px 28px;border-radius:8px;text-decoration:none;margin-bottom:24px">Claim your community →</a>
    <p style="font-size:13px;color:#5a5550;line-height:1.6">— Marc<br/>Founder, HYPERFLEX<br/><a href="https://hyperflex.network" style="color:#c9920d;text-decoration:none">hyperflex.network</a></p>
  </div>
</div></body></html>`;

      await transporter.sendMail({
        from:    process.env.SMTP_FROM || process.env.SMTP_USER,
        to:      email,
        subject: `Your community deserves a prediction market, ${name}`,
        html,
        text: `Hey ${name},\n\nI built HYPERFLEX to give creators like you a way to make your content interactive.\n\nYour audience predicts on what you cover — who wins, what happens next — and competes on a live leaderboard. The AI scans your YouTube videos and writes the markets for you. Takes 5 minutes to set up.\n\nClaim your community free: https://hyperflex.network/creator/signup\n\n— Marc, HYPERFLEX`,
      });
    }

    res.json({ ok: true, invite });
  } catch (err) {
    console.error('[admin invite]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CREATOR SELF-DELETE ───────────────────────────────────
// DELETE /api/creator/account
// Permanently deletes the authenticated creator's account and all associated data.
app.delete('/api/creator/account', requireCreator, async (req, res) => {
  try {
    const creatorId = req.creator.id;
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('creator_id', creatorId)
      .single();
    const slug = settings?.slug;

    // Delete in dependency order
    if (slug) {
      await supabase.from('referral_history').delete().eq('creator_slug', slug);
      await supabase.from('refill_history').delete().eq('creator_slug', slug);
      await supabase.from('community_balances').delete().eq('creator_slug', slug);
    }
    // Get market IDs to delete positions
    const { data: markets } = await supabase.from('markets').select('id').eq('creator_id', creatorId);
    const marketIds = (markets || []).map(m => m.id);
    if (marketIds.length) {
      await supabase.from('positions').delete().in('market_id', marketIds);
      await supabase.from('markets').delete().in('id', marketIds);
    }
    await supabase.from('creator_settings').delete().eq('creator_id', creatorId);
    await supabase.from('creator_rewards').delete().eq('creator_id', creatorId);
    await supabase.from('users').delete().eq('id', creatorId);

    console.log(`[account-delete] Creator ${creatorId} (${slug}) deleted their account`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[account-delete] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN DELETE USER ────────────────────────────────────
// DELETE /api/admin/user/:id
app.delete('/api/admin/user/:id', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Check if creator
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('creator_id', userId)
      .maybeSingle();
    const slug = settings?.slug;

    if (slug) {
      await supabase.from('referral_history').delete().eq('creator_slug', slug);
      await supabase.from('refill_history').delete().eq('creator_slug', slug);
      await supabase.from('community_balances').delete().eq('creator_slug', slug);
      const { data: markets } = await supabase.from('markets').select('id').eq('creator_id', userId);
      const marketIds = (markets || []).map(m => m.id);
      if (marketIds.length) {
        await supabase.from('positions').delete().in('market_id', marketIds);
        await supabase.from('markets').delete().in('id', marketIds);
      }
      await supabase.from('creator_settings').delete().eq('creator_id', userId);
      await supabase.from('creator_rewards').delete().eq('creator_id', userId);
    }

    // Member-only cleanup
    await supabase.from('community_balances').delete().eq('user_id', userId);
    await supabase.from('referral_history').delete().or(`referrer_id.eq.${userId},referred_id.eq.${userId}`);
    await supabase.from('positions').delete().eq('user_id', userId);
    await supabase.from('users').delete().eq('id', userId);

    console.log(`[admin-delete] User ${userId} deleted by admin`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin-delete] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/lookup-slug/:slug — find creator by slug (even orphaned rows)
app.get('/api/admin/lookup-slug/:slug', requireAdmin, async (req, res) => {
  try {
    const slug = req.params.slug;
    const { data: cs } = await supabase
      .from('creator_settings')
      .select('creator_id, slug, display_name, plan, created_at')
      .eq('slug', slug)
      .maybeSingle();
    if (!cs) return res.json({ found: false });

    // Try to get user email
    const { data: user } = await supabase
      .from('users')
      .select('id, email, display_name as user_name')
      .eq('id', cs.creator_id)
      .maybeSingle();

    res.json({ found: true, creator: { ...cs, email: user?.email || null, user_name: user?.user_name || null } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/creator-by-slug/:slug — nuke a creator + all data by slug
app.delete('/api/admin/creator-by-slug/:slug', requireAdmin, async (req, res) => {
  try {
    const slug = req.params.slug;

    const { data: cs } = await supabase
      .from('creator_settings')
      .select('creator_id')
      .eq('slug', slug)
      .maybeSingle();

    if (!cs) return res.status(404).json({ error: 'No creator found with that slug' });
    const userId = cs.creator_id;

    // Cascade delete
    await supabase.from('referral_history').delete().eq('creator_slug', slug);
    await supabase.from('refill_history').delete().eq('creator_slug', slug);
    await supabase.from('community_balances').delete().eq('creator_slug', slug);
    const { data: markets } = await supabase.from('markets').select('id').eq('creator_id', userId);
    const marketIds = (markets || []).map(m => m.id);
    if (marketIds.length) {
      await supabase.from('positions').delete().in('market_id', marketIds);
      await supabase.from('markets').delete().in('id', marketIds);
    }
    await supabase.from('creator_settings').delete().eq('creator_id', userId);
    await supabase.from('creator_rewards').delete().eq('creator_id', userId);
    await supabase.from('community_balances').delete().eq('user_id', userId);
    await supabase.from('referral_history').delete().or(`referrer_id.eq.${userId},referred_id.eq.${userId}`);
    await supabase.from('positions').delete().eq('user_id', userId);
    await supabase.from('users').delete().eq('id', userId);

    console.log(`[admin-free-slug] Slug "${slug}" (user ${userId}) deleted by admin`);
    res.json({ ok: true, freed: slug });
  } catch (err) {
    console.error('[admin-free-slug] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/creator/start-trial — self-serve 7-day Pro trial (one-time, free plan only)
app.post('/api/creator/start-trial', requireCreator, async (req, res) => {
  try {
    const { data: cs } = await supabase
      .from('creator_settings')
      .select('slug, plan, plan_trial_expires_at')
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!cs) return res.status(404).json({ error: 'Creator not found' });
    if (cs.plan !== 'free') return res.status(400).json({ error: 'Trial only available on free plan' });
    if (cs.plan_trial_expires_at) return res.status(400).json({ error: 'Trial already used' });

    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const { error } = await supabase
      .from('creator_settings')
      .update({ plan: 'pro', plan_trial_expires_at: expiresAt })
      .eq('creator_id', req.creator.id);

    if (error) throw error;

    console.log(`[trial] ${cs.slug} started 7-day Pro trial, expires ${expiresAt}`);

    // Send trial start email
    const { data: user } = await supabase
      .from('users')
      .select('email, display_name')
      .eq('id', req.creator.id)
      .maybeSingle();

    if (user?.email) {
      const transport = createMailTransport();
      if (transport) {
        const expireDate = new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        transport.sendMail({
          from: process.env.SMTP_FROM || 'HYPERFLEX <noreply@hyperflex.network>',
          replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_FROM || 'noreply@hyperflex.network',
          to: user.email,
          subject: 'Your 7-day Pro trial is live — here\'s what you unlocked',
          html: `
            <div style="background:#141412;padding:40px;font-family:'Courier New',monospace;color:#ddd8cc;max-width:560px;margin:0 auto;border-radius:12px;">
              <div style="font-size:22px;font-weight:800;color:#c9920d;margin-bottom:24px;letter-spacing:-0.5px;">HYPERFLEX</div>
              <h2 style="font-size:20px;color:#f5f5f0;margin:0 0 16px;">Your Pro trial is live ⚡</h2>
              <p style="color:#aaa8a0;font-size:14px;line-height:1.6;margin:0 0 24px;">
                You have 7 days of Pro — free. Here's what just unlocked for your community:
              </p>
              <div style="background:#1c1c19;border:1px solid #2a2a27;border-radius:8px;padding:20px;margin-bottom:24px;">
                <div style="font-size:13px;color:#ddd8cc;margin-bottom:10px;">✅ <strong>Unlimited active markets</strong> (was 5)</div>
                <div style="font-size:13px;color:#ddd8cc;margin-bottom:10px;">✅ <strong>YouTube AI scanner</strong> — generate markets from any video</div>
                <div style="font-size:13px;color:#ddd8cc;margin-bottom:10px;">✅ <strong>Full analytics dashboard</strong> — trade activity, top markets, economy health</div>
                <div style="font-size:13px;color:#ddd8cc;margin-bottom:10px;">✅ <strong>Market idea generator</strong> — AI-powered market suggestions</div>
                <div style="font-size:13px;color:#ddd8cc;">✅ <strong>Weekly Power Predictor</strong> — top 3 weekly winners panel</div>
              </div>
              <p style="color:#888880;font-size:13px;margin:0 0 24px;">Trial ends <strong style="color:#c9920d;">${expireDate}</strong>. After that you'll move back to the free plan unless you upgrade.</p>
              <a href="https://hyperflex.network/creator/dashboard" style="display:inline-block;background:#c9920d;color:#141412;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px;text-decoration:none;margin-bottom:24px;">Go to your dashboard →</a>
              <p style="color:#555;font-size:11px;margin:0;">HYPERFLEX · hyperflex.network</p>
            </div>`
        }).catch(() => {});
      }
    }

    res.json({ ok: true, expires_at: expiresAt, plan: 'pro' });
  } catch (err) {
    console.error('[trial] start-trial error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/gift-trial — gift N days of Premium to a creator
// Body: { slug, days }
app.post('/api/admin/gift-trial', requireAdmin, async (req, res) => {
  try {
    const { slug, days = 30 } = req.body;
    if (!slug) return res.status(400).json({ error: 'slug required' });
    const n = Math.min(Math.max(parseInt(days) || 30, 1), 365);
    const expiresAt = new Date(Date.now() + n * 86400000).toISOString();
    const { error } = await supabase
      .from('creator_settings')
      .update({ plan: 'platinum', plan_trial_expires_at: expiresAt })
      .eq('slug', slug);
    if (error) throw error;
    console.log(`[admin] gifted ${n}d Premium trial to ${slug}, expires ${expiresAt}`);
    res.json({ ok: true, expires_at: expiresAt });
  } catch (err) {
    console.error('[admin] gift-trial error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/transfer-creator — transfer creator account to a new owner
// Body: { slug, new_email }
app.post('/api/admin/transfer-creator', requireAdmin, async (req, res) => {
  try {
    const { slug, new_email } = req.body;
    if (!slug || !new_email) return res.status(400).json({ error: 'slug and new_email required' });

    // Find the new owner by email
    const { data: newUser } = await supabase
      .from('users')
      .select('id, email, display_name')
      .eq('email', new_email.toLowerCase().trim())
      .maybeSingle();
    if (!newUser) return res.status(404).json({ error: `No user found with email: ${new_email}` });

    // Get current creator settings
    const { data: cs } = await supabase
      .from('creator_settings')
      .select('creator_id, slug, display_name')
      .eq('slug', slug)
      .maybeSingle();
    if (!cs) return res.status(404).json({ error: `No creator found with slug: ${slug}` });
    if (cs.creator_id === newUser.id) return res.status(400).json({ error: 'That user already owns this account' });

    // Update creator_settings and markets to new owner
    const { error: csErr } = await supabase
      .from('creator_settings')
      .update({ creator_id: newUser.id })
      .eq('slug', slug);
    if (csErr) throw csErr;

    // Reassign markets to new owner
    await supabase.from('markets').update({ creator_id: newUser.id }).eq('creator_id', cs.creator_id).eq('tenant_slug', slug);

    console.log(`[admin] transferred /${slug} from ${cs.creator_id} to ${newUser.id} (${newUser.email})`);
    res.json({ ok: true, new_owner: { id: newUser.id, email: newUser.email, display_name: newUser.display_name } });
  } catch (err) {
    console.error('[admin] transfer-creator error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── FLEX BOT ─────────────────────────────────────────────
// POST /api/creator/flexbot
// Premium-only. Takes messages array, returns Claude response.
app.post('/api/creator/flexbot', requireCreator, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'messages array required' });
    }

    // Plan check
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('plan, slug, display_name, starting_balance, min_bet, max_bet, refill_enabled, refill_amount')
      .eq('creator_id', req.creator.id)
      .single();

    if (!settings || settings.plan !== 'platinum') {
      return res.status(403).json({ error: 'FLEX BOT is available on Premium plans only.' });
    }

    const systemPrompt = `You are FLEX BOT, an AI assistant built into HYPERFLEX — a B2B SaaS platform where creators build branded prediction markets for their communities using play-money Flex Points.

The creator you're helping runs the community: "${settings.display_name || 'Unknown'}" (slug: ${settings.slug || 'unknown'}).
Their current economy settings: starting balance ${Math.round((settings.starting_balance || 100000) / 100)} pts, min bet ${Math.round((settings.min_bet || 1000) / 100)} pts${settings.max_bet ? `, max bet ${Math.round(settings.max_bet / 100)} pts` : ''}, weekly refill ${settings.refill_enabled ? `enabled (${Math.round((settings.refill_amount || 10000) / 100)} pts)` : 'disabled'}.

You help creators with:
- Understanding and using HYPERFLEX features
- Setting up and tuning their points economy (starting balance, min/max bets, weekly refills, referral rewards)
- Interpreting their analytics dashboard
- Writing engaging prediction market questions for their community
- Growing their member base and engagement
- Best practices for prediction markets

Key platform features:
- Markets: Binary yes/no prediction markets with CPMM dynamic odds
- AI Scanner: Generate markets from YouTube videos, transcripts, or pasted content
- Economy: Per-community Flex Points — configurable starting balance, bet limits, weekly refills
- Referrals: Members share invite links, both referrer and new member get rewarded
- Leaderboard: Rankings with streak multipliers (3+ wins = 1.5×, 5+ wins = 2×)
- Analytics: Trade activity charts, top markets, economy health, referral stats

Keep responses concise, practical, and specific to prediction markets. Use bullet points when listing steps. Never make up features that don't exist.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.slice(-20) // cap at 20 messages to manage context
    });

    res.json({ reply: response.content[0]?.text || '' });
  } catch (err) {
    console.error('[flexbot] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// CUSTOM DOMAIN ENDPOINTS (Premium only)
// ════════════════════════════════════════════════════════════

// POST /api/creator/custom-domain/set
// Body: { domain: "markets.yourdomain.com" }
// Saves the domain and issues a TXT-record verification token.
app.post('/api/creator/custom-domain/set', requireCreator, async (req, res) => {
  try {
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('plan, slug')
      .eq('creator_id', req.creator.id)
      .single();

    if (creator.plan !== 'platinum') {
      return res.status(403).json({ error: 'Custom domains require the Premium plan.' });
    }

    const domain = (req.body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain || !/^[a-z0-9.-]+$/.test(domain)) {
      return res.status(400).json({ error: 'Invalid domain format. Example: markets.yourdomain.com' });
    }

    // Ensure no other creator already claimed this domain
    const { data: existing } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('custom_domain', domain)
      .neq('creator_id', req.creator.id)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'This domain is already connected to another community.' });
    }

    const token = 'hyperflex-verify=' + crypto.randomBytes(20).toString('hex');
    const { error } = await supabase.from('creator_settings').update({
      custom_domain: domain,
      custom_domain_verified: false,
      custom_domain_token: token,
      custom_domain_verified_at: null
    }).eq('creator_id', req.creator.id);

    if (error) throw error;
    res.json({ ok: true, domain, token, slug: creator.slug });
  } catch (err) {
    console.error('[custom-domain/set]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/creator/custom-domain/verify
// Checks DNS CNAME and TXT records then marks domain as verified.
app.post('/api/creator/custom-domain/verify', requireCreator, async (req, res) => {
  try {
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('plan, custom_domain, custom_domain_token, slug')
      .eq('creator_id', req.creator.id)
      .single();

    if (creator.plan !== 'platinum') {
      return res.status(403).json({ error: 'Custom domains require the Premium plan.' });
    }
    if (!creator.custom_domain) {
      return res.status(400).json({ error: 'No domain saved. Call /set first.' });
    }

    const domain = creator.custom_domain;
    const expectedToken = creator.custom_domain_token;
    const expectedCname = 'hyperflex.network';

    let cnameOk = false;
    let txtOk = false;
    const errors = [];

    // Check CNAME
    try {
      const cnames = await dns.resolveCname(domain);
      cnameOk = cnames.some(c => c.toLowerCase().replace(/\.$/, '') === expectedCname);
      if (!cnameOk) errors.push(`CNAME: found [${cnames.join(', ')}], expected ${expectedCname}`);
    } catch (e) {
      errors.push(`CNAME lookup failed: ${e.message}`);
    }

    // Check TXT record (on _hyperflex-verify.<domain>)
    const txtHost = `_hyperflex-verify.${domain}`;
    try {
      const records = await dns.resolveTxt(txtHost);
      const flat = records.map(r => r.join('')).join(' ');
      txtOk = flat.includes(expectedToken);
      if (!txtOk) errors.push(`TXT record on ${txtHost} not found or mismatch`);
    } catch (e) {
      errors.push(`TXT lookup on ${txtHost} failed: ${e.message}`);
    }

    if (!cnameOk || !txtOk) {
      return res.status(400).json({ ok: false, errors });
    }

    const { error } = await supabase.from('creator_settings').update({
      custom_domain_verified: true,
      custom_domain_verified_at: new Date().toISOString()
    }).eq('creator_id', req.creator.id);

    if (error) throw error;
    console.log(`[custom-domain] verified ${domain} → ${creator.slug}`);
    res.json({ ok: true, domain });
  } catch (err) {
    console.error('[custom-domain/verify]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/creator/custom-domain/remove
// Clears the custom domain for this creator.
app.delete('/api/creator/custom-domain/remove', requireCreator, async (req, res) => {
  try {
    const { error } = await supabase.from('creator_settings').update({
      custom_domain: null,
      custom_domain_verified: false,
      custom_domain_token: null,
      custom_domain_verified_at: null
    }).eq('creator_id', req.creator.id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[custom-domain/remove]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/custom-domain/resolve
// Public — called by community.html on custom domains to get the creator's slug.
app.get('/api/custom-domain/resolve', async (req, res) => {
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  try {
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('custom_domain', host)
      .eq('custom_domain_verified', true)
      .maybeSingle();
    if (!creator) return res.status(404).json({ error: 'No verified domain' });
    res.json({ slug: creator.slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/creator/custom-domain/status
// Returns current custom domain state for the logged-in creator.
app.get('/api/creator/custom-domain/status', requireCreator, async (req, res) => {
  try {
    const { data: creator, error } = await supabase
      .from('creator_settings')
      .select('custom_domain, custom_domain_verified, custom_domain_token, custom_domain_verified_at')
      .eq('creator_id', req.creator.id)
      .single();
    if (error) throw error;
    res.json(creator);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// END CREATOR PLATFORM ROUTES
// ════════════════════════════════════════════════════════════

// ── EMAIL: Resolution Notifications ─────────────────────────────────────────
// Opt-in via Railway env vars:
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_FROM
// If SMTP_HOST is not set the function is a no-op — no crash, just skipped.
// ─────────────────────────────────────────────────────────────────────────────
// ─── REFERRAL ACCEPTANCE ─────────────────────────────────────────────────────
// Called when a creator publishes their first public market.
// Flips creator_referrals.accepted = true for their pending referral row (if any).
// Idempotent — does nothing if already accepted or no referral exists.
async function maybeAcceptReferral(creatorSlug) {
  try {
    // Only flip if they have exactly 1 public market (i.e. this is their first)
    const { count } = await supabase
      .from('markets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_slug', creatorSlug)
      .eq('is_public', true)
      .eq('archived', false);

    if (count !== 1) return; // not their first market, skip

    const { data: ref } = await supabase
      .from('creator_referrals')
      .select('id, accepted')
      .eq('new_creator_slug', creatorSlug)
      .maybeSingle();

    if (!ref || ref.accepted) return; // no referral or already accepted

    await supabase
      .from('creator_referrals')
      .update({ accepted: true, accepted_at: new Date().toISOString() })
      .eq('id', ref.id);

    console.log(`[referral] Accepted referral for ${creatorSlug} (ref id ${ref.id})`);
  } catch (err) {
    console.error('[referral] maybeAcceptReferral error:', err.message);
  }
}

// ─── SIGNUP DROP-OFF EMAIL ────────────────────────────────────────────────────
// Fires 2h after signup (via setTimeout in signup handler).
// If the creator still has zero public markets, sends a gentle nudge.
async function maybeFireSignupDropoffEmail(slug, email) {
  const transporter = createMailTransport();
  if (!transporter) return;

  try {
    // Check if they've published anything yet
    const { count } = await supabase
      .from('markets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_slug', slug)
      .eq('is_public', true);

    if (count > 0) return; // already active — no nudge needed

    // Check they haven't unsubscribed
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('id, display_name, primary_color, email_unsubscribed, email_unsubscribe_token')
      .eq('slug', slug)
      .maybeSingle();

    if (!creator || creator.email_unsubscribed) return;

    const accent = creator.primary_color || '#c9920d';
    const communityName = creator.display_name || slug;
    const dashUrl = 'https://hyperflex.network/creator/dashboard';

    const unsubToken = creator.email_unsubscribe_token || await getCreatorUnsubToken(creator.id);
    const unsubUrl = `https://hyperflex.network/unsubscribe?token=${unsubToken}`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0">
<tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:12px;overflow:hidden">
    <tr><td style="background:${accent};padding:16px 28px">
      <span style="font-size:18px;font-weight:900;color:#141412">HYPERFLEX</span>
    </td></tr>
    <tr><td style="padding:32px 28px 24px">
      <h2 style="margin:0 0 12px;font-size:21px;color:#f5f5f0;font-weight:800;line-height:1.3">Your community is set up — just needs its first market.</h2>
      <p style="margin:0 0 18px;font-size:14px;color:#888;line-height:1.7">
        <strong style="color:#f5f5f0">${communityName}</strong> is live and ready. The fastest way to get your first predictions is to paste a YouTube URL — the AI will write the markets for you in under 30 seconds.
      </p>
      <div style="background:rgba(201,146,13,.08);border:1px solid rgba(201,146,13,.2);border-radius:10px;padding:16px 20px;margin-bottom:24px">
        <div style="font-size:13px;color:#f5f5f0;margin-bottom:8px;font-weight:700">Three ways to get your first market live:</div>
        <div style="font-size:13px;color:#aaa;line-height:1.8">
          1. Paste a YouTube URL → AI writes markets from the video<br/>
          2. Pick from the <a href="https://hyperflex.network/templates" style="color:${accent}">template gallery</a> — 72 pre-written questions<br/>
          3. Type a question manually — takes 30 seconds
        </div>
      </div>
      <a href="${dashUrl}" style="display:inline-block;padding:13px 28px;background:${accent};color:#141412;font-weight:800;font-size:15px;border-radius:8px;text-decoration:none">Publish your first market →</a>
    </td></tr>
    ${creatorUnsubscribeFooterHtml(unsubUrl)}
  </table>
</td></tr>
</table></body></html>`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'HYPERFLEX <noreply@hyperflex.network>',
      to: email,
      subject: `${communityName} is set up — publish your first market`,
      html,
    });
    console.log(`[dropoff] Sent signup drop-off nudge to ${email} (${slug})`);
  } catch (err) {
    console.error('[dropoff] Error:', err.message);
  }
}

// ─── EMAIL UNSUBSCRIBE SYSTEM ─────────────────────────────────────────────────
// One-click unsubscribe for all outgoing member/creator emails.
// Tokens are stored in users.email_unsubscribe_token (UUID, generated on first send).
// Route: GET /unsubscribe?token=XXX  → marks users.email_unsubscribed = true
//
// Migration: supabase_migration_email_unsubscribe.sql
// ALTER TABLE users ADD COLUMN IF NOT EXISTS email_unsubscribe_token TEXT;
// ALTER TABLE users ADD COLUMN IF NOT EXISTS email_unsubscribed BOOLEAN NOT NULL DEFAULT false;
// CREATE INDEX IF NOT EXISTS users_unsubscribe_token_idx ON users (email_unsubscribe_token);
//
// Also applies to creator_settings for creator emails:
// ALTER TABLE creator_settings ADD COLUMN IF NOT EXISTS email_unsubscribed BOOLEAN NOT NULL DEFAULT false;
// ALTER TABLE creator_settings ADD COLUMN IF NOT EXISTS email_unsubscribe_token TEXT;
// CREATE INDEX IF NOT EXISTS creator_settings_unsubscribe_token_idx ON creator_settings (email_unsubscribe_token);

// Get or create an unsubscribe token for a member (user row).
async function getMemberUnsubToken(userId) {
  const { data: u } = await supabase.from('users').select('email_unsubscribe_token').eq('id', userId).maybeSingle();
  if (u?.email_unsubscribe_token) return u.email_unsubscribe_token;
  const token = crypto.randomUUID();
  await supabase.from('users').update({ email_unsubscribe_token: token }).eq('id', userId);
  return token;
}

// Get or create an unsubscribe token for a creator.
async function getCreatorUnsubToken(creatorId) {
  const { data: c } = await supabase.from('creator_settings').select('email_unsubscribe_token').eq('id', creatorId).maybeSingle();
  if (c?.email_unsubscribe_token) return c.email_unsubscribe_token;
  const token = crypto.randomUUID();
  await supabase.from('creator_settings').update({ email_unsubscribe_token: token }).eq('id', creatorId);
  return token;
}

// Build unsubscribe footer HTML. unsub_url is the one-click link.
function unsubscribeFooterHtml(unsubUrl) {
  return `<tr><td style="padding:14px 28px 20px;border-top:1px solid #252523">
    <p style="margin:0;font-size:11px;color:#444;text-align:center;line-height:1.7">
      You're receiving this because you're a member of a HYPERFLEX community.<br/>
      <a href="${unsubUrl}" style="color:#666;text-decoration:underline">Unsubscribe from all HYPERFLEX emails</a>
    </p>
  </td></tr>`;
}

function creatorUnsubscribeFooterHtml(unsubUrl) {
  return `<tr><td style="padding:14px 28px 20px;border-top:1px solid #252523">
    <p style="margin:0;font-size:11px;color:#444;text-align:center;line-height:1.7">
      You're receiving this as a HYPERFLEX creator.<br/>
      <a href="${unsubUrl}" style="color:#666;text-decoration:underline">Unsubscribe from creator emails</a>
    </p>
  </td></tr>`;
}

// GET /unsubscribe?token=XXX — one-click, no login required
app.get('/unsubscribe', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('<p style="font-family:sans-serif;text-align:center;padding:60px">Invalid unsubscribe link.</p>');

  // Try users table first, then creator_settings
  let unsubbed = false;
  const { data: u } = await supabase.from('users').select('id, email').eq('email_unsubscribe_token', token).maybeSingle();
  if (u) {
    await supabase.from('users').update({ email_unsubscribed: true }).eq('id', u.id);
    unsubbed = true;
  } else {
    const { data: c } = await supabase.from('creator_settings').select('id, email').eq('email_unsubscribe_token', token).maybeSingle();
    if (c) {
      await supabase.from('creator_settings').update({ email_unsubscribed: true }).eq('id', c.id);
      unsubbed = true;
    }
  }

  const html = unsubbed
    ? `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Unsubscribed — HYPERFLEX</title></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;color:#f0ede8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center;max-width:440px;padding:40px">
  <div style="font-size:36px;margin-bottom:16px">✓</div>
  <h1 style="font-size:22px;font-weight:800;margin:0 0 10px">You're unsubscribed.</h1>
  <p style="font-size:14px;color:#888;line-height:1.6;margin:0 0 28px">You won't receive any more HYPERFLEX emails. If you change your mind, you can re-enable notifications from your account settings.</p>
  <a href="https://hyperflex.network" style="display:inline-block;padding:11px 24px;background:#c9920d;color:#141412;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none">Back to HYPERFLEX</a>
</div>
</body></html>`
    : `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:sans-serif;text-align:center;padding:60px;background:#141412;color:#888">
<p>Unsubscribe link not found or already processed.</p>
</body></html>`;

  res.status(unsubbed ? 200 : 404).send(html);
});

// ─────────────────────────────────────────────────────────────────────────────

function createMailTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// Send new-market notification emails to all community followers (community_balances rows).
// Fires when a market is published (is_public = true).
// No-op if SMTP_HOST is not set.
async function sendNewMarketNotifications(market, creatorSlug) {
  if (!creatorSlug || !market?.question) return;
  try {
    const transporter = createMailTransport();
    if (!transporter) return;

    // Get creator display info
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('display_name, primary_color')
      .eq('slug', creatorSlug)
      .maybeSingle();

    // Get all followers via community_balances
    const { data: followers } = await supabase
      .from('community_balances')
      .select('user_id')
      .eq('creator_slug', creatorSlug);
    if (!followers?.length) return;

    const userIds = [...new Set(followers.map(f => f.user_id))];
    const { data: users } = await supabase
      .from('users')
      .select('email, display_name')
      .in('id', userIds)
      .not('email', 'is', null);
    if (!users?.length) return;

    const communityName = settings?.display_name || creatorSlug;
    const communityUrl  = `https://hyperflex.network/${creatorSlug}`;
    const fromAddress   = process.env.SMTP_FROM || `"${communityName}" <noreply@hyperflex.network>`;
    const expiryLine    = market.expiry_date
      ? `<p style="margin:8px 0 0;font-size:13px;color:#888;">Closes ${new Date(market.expiry_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</p>`
      : '';
    const yesPct = Math.round((market.yes_price || 0.5) * 100);
    const noPct  = 100 - yesPct;

    const subject = `🎯 New prediction live: ${market.question.slice(0, 60)}${market.question.length > 60 ? '...' : ''}`;
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:10px;overflow:hidden;">
        <tr><td style="background:#c9920d;padding:18px 28px;">
          <span style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:900;color:#141412;letter-spacing:-0.5px;">HYPERFLEX</span>
          <span style="float:right;font-size:13px;color:#141412;opacity:0.7;line-height:32px;">${communityName}</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 6px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;">New Market Posted</p>
          <h2 style="margin:0 0 16px;font-size:20px;color:#f5f5f0;font-weight:700;line-height:1.4;">${market.question}</h2>
          <div style="background:#141412;border-radius:8px;padding:16px;margin-bottom:20px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
              <span style="font-size:13px;color:#888;">Current odds</span>
            </div>
            <div style="height:8px;background:#2a2a27;border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${yesPct}%;background:#22c55e;border-radius:4px;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:6px;">
              <span style="font-size:13px;font-weight:700;color:#22c55e;">YES ${yesPct}%</span>
              <span style="font-size:13px;font-weight:700;color:#ef4444;">NO ${noPct}%</span>
            </div>
            ${expiryLine}
          </div>
          <a href="${communityUrl}" style="display:inline-block;padding:12px 24px;background:#c9920d;color:#141412;font-weight:700;font-size:15px;border-radius:6px;text-decoration:none;">Make your prediction →</a>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #2a2a27;">
          <p style="margin:0;font-size:11px;color:#555;">You're following <a href="${communityUrl}" style="color:#888;">${communityName}</a>. Powered by <a href="https://hyperflex.network" style="color:#888;">Hyperflex</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Send individually (respect rate limits — cap at 500)
    let sent = 0, failed = 0;
    for (const user of users.slice(0, 500)) {
      if (!user.email) continue;
      try {
        await transporter.sendMail({ from: fromAddress, to: user.email, subject, html });
        sent++;
      } catch { failed++; }
    }
    console.log(`[email] New market notifications: ${sent} sent, ${failed} failed — market ${market.id}`);

    // Also push in-app notification to all followers
    const shortQ = market.question.length > 60 ? market.question.slice(0, 57) + '…' : market.question;
    const communityDisplayName = settings?.display_name || creatorSlug;
    for (const uid of userIds) {
      pushNotification(
        uid, 'new_market',
        `🎯 New market on ${communityDisplayName}`,
        shortQ,
        market.id, creatorSlug
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[email] sendNewMarketNotifications error:', err.message);
  }
}

// ── Discord webhook — posts a card when a new market goes public ──────────────
async function sendDiscordWebhook(market, creatorSlug) {
  if (!creatorSlug || !market?.question) return;
  try {
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('discord_webhook_url, display_name, primary_color')
      .eq('slug', creatorSlug)
      .maybeSingle();
    if (!settings?.discord_webhook_url) return;

    const communityUrl = `${process.env.SITE_URL || 'https://hyperflex.network'}/${creatorSlug}`;
    const color = parseInt((settings.primary_color || '#c9920d').replace('#', ''), 16);
    const expiryStr = market.expiry_date
      ? new Date(market.expiry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    const categoryStr = market.category
      ? market.category.charAt(0).toUpperCase() + market.category.slice(1)
      : null;

    const fields = [];
    if (categoryStr) fields.push({ name: 'Category', value: categoryStr, inline: true });
    if (expiryStr)   fields.push({ name: 'Closes',   value: expiryStr,   inline: true });
    if (Array.isArray(market.options) && market.options.length > 0) {
      fields.push({
        name: 'Options',
        value: market.options.map(o => `**${o.label}** — ${o.pct}%`).join('\n'),
        inline: false
      });
    }

    const body = {
      embeds: [{
        title: market.question,
        description: `A new prediction market is live on **${settings.display_name || creatorSlug}**!`,
        url: communityUrl,
        color,
        fields,
        footer: { text: `Predict at ${communityUrl}` },
        timestamp: new Date().toISOString(),
      }]
    };

    const resp = await fetch(settings.discord_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) console.error('[discord] webhook failed:', resp.status, await resp.text());
  } catch (err) {
    console.error('[discord] webhook error:', err.message);
  }
}

// ── Expose discord webhook settings ──────────────────────────────────────────
app.put('/api/creator/discord-webhook', requireCreator, async (req, res) => {
  try {
    const { discord_webhook_url } = req.body;
    // Basic validation — must be empty string (to clear) or a Discord webhook URL
    if (discord_webhook_url && !discord_webhook_url.startsWith('https://discord.com/api/webhooks/') && !discord_webhook_url.startsWith('https://discordapp.com/api/webhooks/')) {
      return res.status(400).json({ error: 'Must be a valid Discord webhook URL (https://discord.com/api/webhooks/…)' });
    }
    const { error } = await supabase
      .from('creator_settings')
      .update({ discord_webhook_url: discord_webhook_url || null })
      .eq('creator_id', req.creator.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/creator/digest/send — manually trigger digest for this creator right now
app.post('/api/creator/digest/send', requireCreator, async (req, res) => {
  try {
    const transporter = createMailTransport();
    if (!transporter) return res.status(503).json({ error: 'Email not configured on this server. Add SMTP_HOST to Railway env vars.' });

    const slug = req.creator.slug;
    const { data: creator } = await supabase.from('creator_settings').select('slug, display_name, primary_color, custom_points_name').eq('slug', slug).single();
    if (!creator) return res.status(404).json({ error: 'Creator not found' });

    const communityName = creator.display_name || slug;
    const accentColor   = creator.primary_color || '#c9920d';
    const ptsName       = creator.custom_points_name || 'Flex Points';
    const communityUrl  = `https://hyperflex.network/${slug}`;

    const { data: markets } = await supabase.from('markets').select('id, question, yes_price, no_price, trader_count').eq('tenant_slug', slug).eq('resolved', false).eq('archived', false).order('trader_count', { ascending: false }).limit(3);
    if (!markets?.length) return res.status(400).json({ error: 'No active markets to include in digest.' });

    const { data: members } = await supabase.from('community_members').select('user_id').eq('creator_slug', slug);
    if (!members?.length) return res.status(400).json({ error: 'No community members yet.' });

    const userIds = members.map(m => m.user_id);
    const { data: users } = await supabase.from('users').select('id, email, display_name, email_unsubscribed').in('id', userIds);
    const eligible = (users || []).filter(u => u.email && !u.email_unsubscribed);
    if (!eligible.length) return res.status(400).json({ error: 'No eligible subscribers.' });

    // Top 3 leaderboard
    const { data: allMktIds } = await supabase.from('markets').select('id').eq('tenant_slug', slug);
    const mktIds = (allMktIds || []).map(m => m.id);
    let leaderRows = [];
    if (mktIds.length) {
      const { data: posData } = await supabase.from('positions').select('user_id, potential_payout, won').in('market_id', mktIds).eq('settled', true);
      const lmap = {};
      for (const p of (posData || [])) {
        if (!lmap[p.user_id]) lmap[p.user_id] = { wins: 0, total_payout: 0 };
        if (p.won) { lmap[p.user_id].wins++; lmap[p.user_id].total_payout += (p.potential_payout || 0); }
      }
      const leaderIds = Object.entries(lmap).sort((a, b) => b[1].total_payout - a[1].total_payout).slice(0, 3).map(([id]) => id);
      const { data: lNames } = leaderIds.length ? await supabase.from('users').select('id, display_name').in('id', leaderIds) : { data: [] };
      const nameMap = {}; for (const u of (lNames || [])) nameMap[u.id] = u.display_name;
      leaderRows = leaderIds.map((id, i) => ({ rank: i + 1, name: nameMap[id] || 'Anonymous', pts: Math.round((lmap[id]?.total_payout || 0) / 100) }));
    }

    const marketsHtml = markets.map(m => {
      const yesPct = Math.round((m.yes_price || 0.5) * 100);
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #2a2a27"><div style="font-size:14px;color:#f5f5f0;margin-bottom:4px">${m.question}</div><div style="font-size:12px;color:#888">YES ${yesPct}%</div></td></tr>`;
    }).join('');
    const medals = ['🥇','🥈','🥉'];
    const leaderHtml = leaderRows.map((r, i) => `<tr><td style="padding:8px 0"><span style="font-size:16px">${medals[i]}</span><span style="font-size:14px;color:#f5f5f0;margin-left:8px">${r.name}</span><span style="float:right;font-size:13px;color:${accentColor};font-weight:700">${r.pts.toLocaleString()} ${ptsName}</span></td></tr>`).join('');

    const baseHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0"><table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0"><tr><td align="center"><table width="540" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:10px;overflow:hidden"><tr><td style="background:${accentColor};padding:18px 28px"><span style="font-size:20px;font-weight:900;color:#141412">HYPERFLEX</span><span style="float:right;font-size:13px;color:#141412;opacity:.7;line-height:28px">${communityName} Digest</span></td></tr><tr><td style="padding:28px"><h2 style="margin:0 0 6px;font-size:22px;color:#f5f5f0;font-weight:800">What's happening in ${communityName} 🎯</h2><p style="margin:0 0 24px;font-size:14px;color:#888">Here's what your community is predicting right now.</p><h3 style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:${accentColor}">🔥 Hot Markets</h3><table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${marketsHtml}</table>${leaderHtml ? `<h3 style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:${accentColor}">🏆 Top Predictors</h3><table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${leaderHtml}</table>` : ''}<a href="${communityUrl}" style="display:inline-block;padding:12px 24px;background:${accentColor};color:#141412;font-weight:700;font-size:15px;border-radius:6px;text-decoration:none">Place your predictions →</a></td></tr><tr><td style="padding:16px 28px;border-top:1px solid #2a2a27"><p style="margin:0;font-size:11px;color:#555">Digest from <a href="${communityUrl}" style="color:#888">${communityName}</a>. Powered by <a href="https://hyperflex.network" style="color:#888">HYPERFLEX</a>.</p></td></tr></table></td></tr></table></body></html>`;

    const fromAddress = process.env.SMTP_FROM || `"${communityName}" <noreply@hyperflex.network>`;
    const sends = await Promise.allSettled(eligible.map(async u => {
      const unsubToken = await getMemberUnsubToken(u.id);
      const unsubUrl = `https://hyperflex.network/unsubscribe?token=${unsubToken}`;
      const html = baseHtml.replace('</table></body></html>', `${unsubscribeFooterHtml(unsubUrl)}</table></body></html>`);
      return transporter.sendMail({ from: fromAddress, to: u.email, subject: `What's happening in ${communityName} 🎯`, html });
    }));
    const sent = sends.filter(r => r.status === 'fulfilled').length;
    res.json({ ok: true, message: `Digest sent to ${sent} of ${eligible.length} subscribers.` });
  } catch (err) {
    console.error('[digest/send]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/creator/markets/:marketId/blast
// Send a focused "new market" email to all community members right now.
// Rate-limited: one blast per market ever (stored in markets.blasted_at).
// ════════════════════════════════════════════════════════════
app.post('/api/creator/markets/:marketId/blast', requireCreator, async (req, res) => {
  try {
    const transporter = createMailTransport();
    if (!transporter) return res.status(503).json({ error: 'Email not configured. Add SMTP_HOST to Railway env vars.' });

    const { marketId } = req.params;
    const slug = req.creator.slug;

    // Verify market belongs to this creator and is public
    const { data: market } = await supabase
      .from('markets')
      .select('id, question, category, expiry_date, yes_price, yes_votes, no_votes, trader_count, resolved, archived, blasted_at')
      .eq('id', marketId)
      .eq('tenant_slug', slug)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found' });
    if (market.resolved)  return res.status(400).json({ error: 'Market is already resolved' });
    if (market.archived)  return res.status(400).json({ error: 'Market is archived' });
    if (market.blasted_at) {
      const hrs = Math.round((Date.now() - new Date(market.blasted_at)) / 36e5);
      return res.status(429).json({ error: `Already blasted ${hrs}h ago — each market can only be blasted once` });
    }

    // Get creator branding
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('display_name, primary_color, custom_points_name, email_unsubscribed')
      .eq('slug', slug).single();
    if (!creator) return res.status(404).json({ error: 'Creator not found' });

    const communityName = creator.display_name || slug;
    const accent        = creator.primary_color || '#c9920d';
    const ptsName       = creator.custom_points_name || 'Flex Points';
    const communityUrl  = `https://hyperflex.network/${slug}`;
    const marketUrl     = `${communityUrl}?market=${marketId}&ref=blast`;

    const yesPct = Math.round((market.yes_price || 0.5) * 100);
    const closes = market.expiry_date
      ? new Date(market.expiry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null;

    // Get community members with emails
    const { data: members } = await supabase
      .from('community_balances')
      .select('user_id')
      .eq('creator_slug', slug);

    if (!members?.length) return res.json({ ok: true, sent: 0, message: 'No members to email yet' });

    const userIds = members.map(m => m.user_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, email, display_name, email_unsubscribed')
      .in('id', userIds);

    const eligible = (users || []).filter(u => u.email && !u.email_unsubscribed);
    if (!eligible.length) return res.json({ ok: true, sent: 0, message: 'No eligible subscribers' });

    // Mark blasted immediately to prevent double-sends
    await supabase.from('markets').update({ blasted_at: new Date().toISOString() }).eq('id', marketId);

    const fromAddr = process.env.SMTP_FROM || `"${communityName}" <noreply@hyperflex.network>`;

    const sends = await Promise.allSettled(eligible.map(async u => {
      const unsubToken = await getMemberUnsubToken(u.id);
      const unsubUrl   = `https://hyperflex.network/unsubscribe?token=${unsubToken}`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0">
<tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:12px;overflow:hidden">
    <tr><td style="background:${accent};padding:16px 28px">
      <span style="font-size:18px;font-weight:900;color:#141412">${communityName}</span>
      <span style="float:right;font-size:13px;color:#141412;opacity:.7;line-height:28px;font-weight:700">NEW MARKET</span>
    </td></tr>
    <tr><td style="padding:32px 28px 8px">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${accent}">🎯 Make your call</p>
      <h2 style="margin:0 0 20px;font-size:22px;color:#f5f5f0;font-weight:800;line-height:1.35">${market.question}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
        <tr>
          <td width="50%" style="padding-right:6px">
            <div style="background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);border-radius:8px;padding:14px;text-align:center">
              <div style="font-size:11px;color:#888;font-weight:700;letter-spacing:.08em;margin-bottom:4px">YES</div>
              <div style="font-size:26px;font-weight:900;color:#22c55e">${yesPct}%</div>
            </div>
          </td>
          <td width="50%" style="padding-left:6px">
            <div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:14px;text-align:center">
              <div style="font-size:11px;color:#888;font-weight:700;letter-spacing:.08em;margin-bottom:4px">NO</div>
              <div style="font-size:26px;font-weight:900;color:#ef4444">${100-yesPct}%</div>
            </div>
          </td>
        </tr>
      </table>
      ${closes ? `<p style="margin:0 0 20px;font-size:12px;color:#666">⏰ Closes ${closes}</p>` : ''}
      <a href="${marketUrl}" style="display:inline-block;padding:14px 28px;background:${accent};color:#141412;font-weight:800;font-size:15px;border-radius:8px;text-decoration:none">Place your prediction →</a>
    </td></tr>
    <tr><td style="padding:20px 28px 0;border-top:1px solid #2a2a27;margin-top:24px">
      <p style="margin:0;font-size:12px;color:#555">You're receiving this because you joined <a href="${communityUrl}" style="color:#888">${communityName}</a> on HYPERFLEX.</p>
    </td></tr>
    ${unsubscribeFooterHtml(unsubUrl)}
  </table>
</td></tr>
</table></body></html>`;

      return transporter.sendMail({
        from:    fromAddr,
        replyTo: process.env.SMTP_REPLY_TO || fromAddr,
        to:      u.email,
        subject: `📣 New market in ${communityName}: "${market.question.length > 60 ? market.question.slice(0,57)+'…' : market.question}"`,
        html,
      });
    }));

    const sent    = sends.filter(r => r.status === 'fulfilled').length;
    const skipped = eligible.length - sent;
    console.log(`[blast] ${slug} market ${marketId}: ${sent}/${eligible.length} sent`);
    res.json({ ok: true, sent, skipped, message: `Blasted to ${sent} member${sent !== 1 ? 's' : ''}${skipped ? ` (${skipped} failed)` : ''}` });
  } catch (err) {
    console.error('[blast]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send resolution emails to all bettors on a market.
// market      — markets row (must include .question)
// outcome     — 'YES' | 'NO'
// creatorSlug — slug string, used to build community URL + sender name
// resolutionNote — optional creator note (string | null)
async function sendResolutionEmails(market, outcome, creatorSlug, resolutionNote) {
  try {
    const transporter = createMailTransport();
    if (!transporter) return; // SMTP not configured — skip silently

    // Fetch all distinct users who had positions on this market
    const { data: positions } = await supabase
      .from('positions')
      .select('user_id')
      .eq('market_id', market.id);

    if (!positions || positions.length === 0) return;

    const uniqueUserIds = [...new Set(positions.map(p => p.user_id))];

    // Fetch their emails + names from users table
    const { data: users } = await supabase
      .from('users')
      .select('id, email, name')
      .in('id', uniqueUserIds);

    if (!users || users.length === 0) return;

    // Fetch creator display name for the email header
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('community_name')
      .eq('slug', creatorSlug)
      .maybeSingle();

    const communityName = creator?.community_name || creatorSlug;
    const communityUrl  = `https://hyperflex.network/${creatorSlug}`;
    const fromAddress   = process.env.SMTP_FROM || `"${communityName}" <noreply@hyperflex.network>`;

    const outcomeEmoji = outcome === 'YES' ? '✅' : '❌';
    const noteSection  = resolutionNote
      ? `<p style="margin:12px 0;padding:12px;background:#f5f5f0;border-left:3px solid #c9920d;font-size:14px;color:#444;">${resolutionNote}</p>`
      : '';

    const sendAll = users
      .filter(u => u.email)
      .map(u => {
        const subject = `${outcomeEmoji} Market resolved: ${market.question}`;
        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#141412;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#141412;padding:40px 0;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#1e1e1b;border-radius:10px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:#c9920d;padding:18px 28px;">
          <span style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:900;color:#141412;letter-spacing:-0.5px;">HYPERFLEX</span>
          <span style="float:right;font-size:13px;color:#141412;opacity:0.7;line-height:32px;">${communityName}</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px;">
          <p style="margin:0 0 6px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;">Market Resolved</p>
          <h2 style="margin:0 0 20px;font-size:20px;color:#f5f5f0;font-weight:700;line-height:1.3;">${market.question}</h2>

          <div style="background:#141412;border-radius:8px;padding:20px;text-align:center;margin-bottom:20px;">
            <div style="font-size:40px;margin-bottom:6px;">${outcomeEmoji}</div>
            <div style="font-size:28px;font-weight:900;color:${outcome === 'YES' ? '#22c55e' : '#ef4444'};letter-spacing:-1px;">${outcome}</div>
            <div style="font-size:13px;color:#888;margin-top:4px;">Final outcome</div>
          </div>

          ${noteSection}

          <p style="margin:20px 0 8px;font-size:14px;color:#aaa;">Your Flex Points have been updated. Head to the community to see your balance and join the next round.</p>

          <a href="${communityUrl}" style="display:inline-block;margin-top:12px;padding:12px 24px;background:#c9920d;color:#141412;font-weight:700;font-size:15px;border-radius:6px;text-decoration:none;">Back to ${communityName} →</a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 28px;border-top:1px solid #2a2a27;">
          <p style="margin:0;font-size:11px;color:#555;">You're receiving this because you participated in a market on <a href="${communityUrl}" style="color:#888;">${communityName}</a>. Powered by <a href="https://hyperflex.network" style="color:#888;">Hyperflex</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

        return transporter.sendMail({
          from: fromAddress,
          replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_FROM || 'noreply@hyperflex.network',
          to: u.email,
          subject,
          html,
        });
      });

    const results = await Promise.allSettled(sendAll);
    const sent    = results.filter(r => r.status === 'fulfilled').length;
    const failed  = results.filter(r => r.status === 'rejected').length;
    if (sent > 0 || failed > 0) {
      console.log(`[email] Resolution emails: ${sent} sent, ${failed} failed — market ${market.id}`);
    }
  } catch (err) {
    // Never crash the server over email failures
    console.error('[email] sendResolutionEmails error:', err.message);
  }
}

// ─── PUBLIC PLATFORM STATS ───────────────────────────────────────────────────
// Cached for 5 minutes so the landing page doesn't hammer the DB on every load
let _statsCache = null;
let _statsCacheAt = 0;
app.get('/api/stats', async (req, res) => {
  try {
    const now = Date.now();
    if (_statsCache && now - _statsCacheAt < 5 * 60 * 1000) {
      return res.json(_statsCache);
    }
    const [marketsRes, positionsRes, creatorsRes, predictorRowsRes] = await Promise.all([
      supabase.from('markets').select('id', { count: 'exact', head: true }).eq('resolved', false).neq('is_public', false),
      supabase.from('positions').select('id', { count: 'exact', head: true }),
      supabase.from('creator_settings').select('creator_id', { count: 'exact', head: true }),
      supabase.from('positions').select('user_id').not('user_id', 'is', null),
    ]);
    const predictorCount = new Set((predictorRowsRes.data || []).map(r => r.user_id)).size;
    _statsCache = {
      live_markets:      marketsRes.count   || 0,
      total_predictions: positionsRes.count || 0,
      communities:       creatorsRes.count  || 0,
      predictors:        predictorCount,
    };
    _statsCacheAt = now;
    res.json(_statsCache);
  } catch (err) {
    res.json({ live_markets: 0, total_predictions: 0, communities: 0, predictors: 0 });
  }
});

// ─── EXPLORE FEED ────────────────────────────────────────────────────────────
app.get('/api/explore', async (req, res) => {
  try {
    // Run all queries in parallel; each returns {data, error} — never throws
    const [tradesRes, hotRes, newMarketsRes, announcementsRes, allMarketsRes, allCreatorsRes, totalPositionsRes, totalMarketsRes, settledPositionsRes] = await Promise.all([

      // Recent trades
      supabase
        .from('positions')
        .select('id, user_id, side, amount, created_at, market_id, markets(question, tenant_slug, yes_price, no_price, yes_votes, no_votes)')
        .order('created_at', { ascending: false })
        .limit(20),

      // Hottest markets by trader_count
      supabase
        .from('markets')
        .select('id, question, tenant_slug, yes_price, no_price, yes_votes, no_votes, trader_count, yes_pool, no_pool, created_at')
        .eq('resolved', false)
        .eq('archived', false)
        .order('trader_count', { ascending: false })
        .limit(10),

      // Newest markets
      supabase
        .from('markets')
        .select('id, question, tenant_slug, yes_price, no_price, yes_votes, no_votes, trader_count, created_at')
        .eq('resolved', false)
        .eq('archived', false)
        .order('created_at', { ascending: false })
        .limit(10),

      // Recent announcements
      supabase
        .from('creator_announcements')
        .select('id, creator_slug, title, body, pinned, created_at')
        .order('created_at', { ascending: false })
        .limit(10),

      // All active markets for community stats (trader_count, newest market per slug)
      supabase
        .from('markets')
        .select('tenant_slug, trader_count, created_at')
        .eq('resolved', false)
        .eq('archived', false),

      // All creator_settings for enrichment + community list
      supabase
        .from('creator_settings')
        .select('slug, display_name, custom_points_name, primary_color, created_at'),

      // Platform stats: total positions count
      supabase.from('positions').select('id', { count: 'exact', head: true }),

      // Platform stats: total live markets count
      supabase.from('markets').select('id', { count: 'exact', head: true }).eq('resolved', false).eq('archived', false),

      // Global top predictors: settled positions for accuracy leaderboard
      supabase.from('positions').select('user_id, amount, potential_payout, won').eq('settled', true).limit(5000),
    ]);

    if (hotRes.error)         console.warn('[explore] hot markets error:', hotRes.error.message);
    if (newMarketsRes.error)  console.warn('[explore] new markets error:', newMarketsRes.error.message);
    if (tradesRes.error)      console.warn('[explore] trades error:', tradesRes.error.message);
    if (announcementsRes.error) console.warn('[explore] announcements error:', announcementsRes.error.message);

    // ── Build community stats from all active markets ──
    const statsMap = {}; // slug → { trader_count, market_count, newest_market_at }
    for (const m of (allMarketsRes.data || [])) {
      const slug = m.tenant_slug;
      if (!slug) continue;
      if (!statsMap[slug]) statsMap[slug] = { total_traders: 0, market_count: 0, newest_market_at: null };
      statsMap[slug].total_traders += (m.trader_count || 0);
      statsMap[slug].market_count  += 1;
      const mDate = new Date(m.created_at);
      if (!statsMap[slug].newest_market_at || mDate > new Date(statsMap[slug].newest_market_at)) {
        statsMap[slug].newest_market_at = m.created_at;
      }
    }

    // Build community map with stats merged in
    const communityMap = {};
    for (const c of (allCreatorsRes.data || [])) {
      communityMap[c.slug] = {
        ...c,
        ...(statsMap[c.slug] || { total_traders: 0, market_count: 0, newest_market_at: c.created_at }),
      };
    }

    // ── Community sections ──
    const allCommStats = Object.values(communityMap).filter(c => c.market_count > 0);

    // Most Active: highest total trader_count across all markets
    const mostActive = [...allCommStats]
      .sort((a, b) => b.total_traders - a.total_traders)
      .slice(0, 5);

    // Up & Coming: has markets, sorted by newest_market_at desc (freshest activity)
    const upAndComing = [...allCommStats]
      .sort((a, b) => new Date(b.newest_market_at) - new Date(a.newest_market_at))
      .slice(0, 5);

    // Ghost Town: has markets but fewest traders
    const ghostTown = [...allCommStats]
      .filter(c => c.market_count >= 1)
      .sort((a, b) => a.total_traders - b.total_traders)
      .slice(0, 5);

    // ── Normalize positions ──
    const rawTrades = (tradesRes.data || []).map(p => ({
      id:           p.id,
      side:         p.side,
      amount:       p.amount,
      created_at:   p.created_at,
      user_id:      p.user_id,
      user:         'Anonymous',
      question:     p.markets?.question || '',
      creator_slug: p.markets?.tenant_slug || '',
      yes_votes:    p.markets?.yes_votes || 0,
      no_votes:     p.markets?.no_votes  || 0,
      sentiment:    (() => { const yv = p.markets?.yes_votes || 0; const nv = p.markets?.no_votes || 0; const t = yv + nv; return t > 0 ? Math.round(yv / t * 100) : null; })(),
    }));

    const tradeUserIds = [...new Set(rawTrades.map(t => t.user_id).filter(Boolean))];
    let userMap = {};
    if (tradeUserIds.length) {
      const { data: tradeUsers } = await supabase.from('users').select('id, display_name').in('id', tradeUserIds);
      (tradeUsers || []).forEach(u => { userMap[u.id] = u.display_name || 'Anonymous'; });
    }
    const trades = rawTrades.map(t => ({ ...t, user: userMap[t.user_id] || 'Anonymous' }));

    const normalizeMarket = m => ({ ...m, creator_slug: m.tenant_slug || '' });
    const hotMarkets    = (hotRes.data || []).map(normalizeMarket);
    const newestMarkets = (newMarketsRes.data || []).map(normalizeMarket);

    // ── Platform stats ──
    const totalTrades      = totalPositionsRes.count || 0;
    const totalLiveMarkets = totalMarketsRes.count   || 0;
    const totalCommunities = Object.keys(communityMap).length;
    const platform_stats   = { total_trades: totalTrades, total_live_markets: totalLiveMarkets, total_communities: totalCommunities };

    // ── Global top predictors (accuracy-ranked) ──
    const settledPos = settledPositionsRes.data || [];
    const predMap = {};
    for (const p of settledPos) {
      if (!predMap[p.user_id]) predMap[p.user_id] = { wins: 0, total: 0, pnl: 0 };
      predMap[p.user_id].total += 1;
      if (p.won) {
        predMap[p.user_id].wins += 1;
        predMap[p.user_id].pnl  += Number(p.potential_payout) || 0;
      }
      predMap[p.user_id].pnl -= Number(p.amount) || 0;
    }
    const qualifiedPredictors = Object.entries(predMap)
      .filter(([, a]) => a.total >= 5)
      .map(([uid, a]) => ({ user_id: uid, win_rate: Math.round((a.wins / a.total) * 100), total_trades: a.total, wins: a.wins, total_pnl: Math.round(a.pnl) }))
      .sort((a, b) => b.win_rate - a.win_rate || b.total_trades - a.total_trades)
      .slice(0, 10);

    // Enrich predictor display names
    const predUserIds = qualifiedPredictors.map(p => p.user_id);
    if (predUserIds.length) {
      const { data: predUsers } = await supabase.from('users').select('id, display_name').in('id', predUserIds);
      const predUserMap = {};
      (predUsers || []).forEach(u => { predUserMap[u.id] = u.display_name || 'Anonymous'; });
      qualifiedPredictors.forEach(p => { p.display_name = predUserMap[p.user_id] || 'Anonymous'; });
    }

    res.json({
      trades,
      hot:           hotMarkets,
      newest:        newestMarkets,
      announcements: announcementsRes.data || [],
      communities:   communityMap,
      community_sections: { mostActive, upAndComing, ghostTown },
      platform_stats,
      top_predictors: qualifiedPredictors,
    });
  } catch (err) {
    console.error('[explore]', err.message);
    res.status(500).json({ error: 'Failed to load explore feed' });
  }
});

app.get('/explore', (req, res) => res.sendFile(path.join(__dirname, 'public', 'explore.html')));

// ════════════════════════════════════════════════════════════
// FEATURE 2 — PUT /api/user/display-name
// Members set or update their display name from community.html
// ════════════════════════════════════════════════════════════
app.put('/api/user/display-name', requireAuth, async (req, res) => {
  try {
    const { display_name } = req.body;
    if (!display_name || !display_name.trim()) return res.status(400).json({ error: 'display_name required' });
    const name = display_name.trim().slice(0, 40);
    const { error } = await supabase.from('users').update({ display_name: name }).eq('id', req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, display_name: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// PUT /api/user/change-password
// Works for both members and creators (all in users table).
// Requires current password + new password (min 8 chars).
// ════════════════════════════════════════════════════════════
app.put('/api/user/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (current_password === new_password) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    // Fetch current hash
    const { data: user, error: fetchErr } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', req.user.id)
      .single();
    if (fetchErr || !user) return res.status(404).json({ error: 'User not found' });

    // Verify current password
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    // Hash and save new password
    const new_hash = await bcrypt.hash(new_password, 12);
    const { error: updateErr } = await supabase
      .from('users')
      .update({ password_hash: new_hash })
      .eq('id', req.user.id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 3 — GET/PUT /api/creator/youtube-scan-settings
// Per-creator YouTube auto-scan schedule
// ════════════════════════════════════════════════════════════
app.get('/api/creator/youtube-scan-settings', requireCreator, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('creator_settings')
      .select('youtube_channel_id, auto_scan_enabled, auto_scan_cadence, auto_scan_last_run')
      .eq('creator_id', req.creator.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({
      youtube_channel_id: data?.youtube_channel_id || '',
      auto_scan_enabled:  data?.auto_scan_enabled  || false,
      auto_scan_cadence:  data?.auto_scan_cadence  || 'daily',
      auto_scan_last_run: data?.auto_scan_last_run || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/creator/youtube-scan-settings', requireCreator, async (req, res) => {
  try {
    const { youtube_channel_id, auto_scan_enabled, auto_scan_cadence } = req.body;
    const updates = {};
    if (youtube_channel_id !== undefined) updates.youtube_channel_id = youtube_channel_id || null;
    if (typeof auto_scan_enabled === 'boolean') updates.auto_scan_enabled = auto_scan_enabled;
    if (auto_scan_cadence)   updates.auto_scan_cadence  = auto_scan_cadence;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
    const { error } = await supabase.from('creator_settings').update(updates).eq('creator_id', req.creator.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, ...updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 3 — scanCreatorYouTubeChannels()
// Daily cron: scan each creator's YouTube channel → draft markets for their community
// ════════════════════════════════════════════════════════════
async function scanCreatorYouTubeChannels() {
  if (!process.env.ANTHROPIC_API_KEY) return;
  try {
    // Find all creators with auto-scan enabled and a channel ID set
    const { data: creators } = await supabase
      .from('creator_settings')
      .select('creator_id, slug, display_name, youtube_channel_id, auto_scan_cadence, auto_scan_last_run, plan')
      .eq('auto_scan_enabled', true)
      .not('youtube_channel_id', 'is', null);

    if (!creators || !creators.length) return;

    const now = new Date();
    for (const creator of creators) {
      try {
        // Respect cadence: skip if ran recently
        if (creator.auto_scan_last_run) {
          const last = new Date(creator.auto_scan_last_run);
          const hoursAgo = (now - last) / 3600000;
          const threshold = creator.auto_scan_cadence === 'weekly' ? 168 : 23;
          if (hoursAgo < threshold) continue;
        }

        // Only Pro+ creators get auto-scan
        if (!['pro', 'platinum'].includes(creator.plan)) continue;

        const channelId = creator.youtube_channel_id.trim();
        const today = now.toISOString().split('T')[0];

        console.log(`[auto-scan] Scanning YouTube channel for creator: ${creator.slug}`);

        const systemPrompt = `You are a prediction market creator for a content creator community. Today is ${today}. Based on a YouTube creator's channel niche and content style, generate 3 engaging prediction market questions their community would love to bet on. The creator's channel: "${channelId}". Return ONLY a valid JSON array with objects: { question, category, resolution_date (YYYY-MM-DD, 14-60 days from today) }. No other text.`;

        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: 'user', content: 'Generate 3 prediction markets for this creator\'s community.' }],
        });

        const content = response?.content?.[0]?.text || '';
        if (!content) continue;

        let markets;
        try { markets = JSON.parse(content); } catch { continue; }
        if (!Array.isArray(markets)) continue;

        for (const m of markets) {
          if (!m?.question || typeof m.question !== 'string') continue;
          // Check for duplicate question for this creator
          const { data: existing } = await supabase
            .from('markets')
            .select('id')
            .eq('question', m.question)
            .eq('tenant_slug', creator.slug)
            .maybeSingle();
          if (existing) continue;

          await supabase.from('markets').insert([{
            question:        m.question,
            category:        m.category || 'other',
            expiry_date:     m.resolution_date || today,
            resolution_date: m.resolution_date || today,
            yes_price: 0.5, no_price: 0.5,
            yes_pool: 1000,  no_pool: 1000,
            resolved: false,
            tenant_slug: creator.slug,
            is_public: false, // drafts — creator reviews before publishing
          }]);
        }

        // Update last run timestamp
        await supabase.from('creator_settings')
          .update({ auto_scan_last_run: now.toISOString() })
          .eq('creator_id', creator.creator_id);

        console.log(`[auto-scan] Generated ${markets.length} draft markets for ${creator.slug}`);
      } catch (e) {
        console.error(`[auto-scan] Error for creator ${creator.slug}:`, e.message);
      }
    }
  } catch (err) {
    console.error('[auto-scan] Fatal:', err.message);
  }
}

// Run creator YouTube auto-scan daily at 8am UTC
cron.schedule('0 8 * * *', scanCreatorYouTubeChannels);

// ════════════════════════════════════════════════════════════
// FEATURE 4 — autoResolveExpiredMarkets()
// Cron: find expired markets with a resolution_source → ask Claude → auto-resolve or notify creator
// ════════════════════════════════════════════════════════════
async function autoResolveExpiredMarkets() {
  if (!process.env.ANTHROPIC_API_KEY) return;
  try {
    const now = new Date().toISOString();
    // Find expired unresolved markets with a resolution source
    const { data: markets } = await supabase
      .from('markets')
      .select('id, question, tenant_slug, resolution_source, resolution_sources, expiry_date, yes_price, yes_votes, no_votes')
      .eq('resolved', false)
      .lt('expiry_date', now)
      .not('resolution_source', 'is', null);

    if (!markets || !markets.length) return;

    for (const market of markets) {
      try {
        // Get the source URL
        let sourceUrl = market.resolution_source;
        if (!sourceUrl || !sourceUrl.startsWith('http')) {
          try {
            const arr = typeof market.resolution_sources === 'string'
              ? JSON.parse(market.resolution_sources) : (market.resolution_sources || []);
            const first = arr.find(s => s && (typeof s === 'string' ? s.startsWith('http') : s.url?.startsWith('http')));
            if (first) sourceUrl = typeof first === 'string' ? first : first.url;
          } catch {}
        }
        if (!sourceUrl || !sourceUrl.startsWith('http')) continue;

        console.log(`[auto-resolve] Checking market ${market.id}: "${market.question}"`);

        // Fetch source content (with timeout)
        let sourceText = '';
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const resp = await fetch(sourceUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HyperflexBot/1.0)' }
          });
          clearTimeout(timeout);
          if (resp.ok) {
            const raw = await resp.text();
            // Strip HTML tags, take first 3000 chars
            sourceText = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
          }
        } catch {}

        if (!sourceText) {
          console.log(`[auto-resolve] Could not fetch source for market ${market.id}, skipping`);
          continue;
        }

        // Ask Claude Haiku to determine outcome
        const aiResponse = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          system: 'You are a prediction market resolver. Given a market question and source content, determine if the outcome is YES, NO, or UNCERTAIN. Return ONLY valid JSON: { "outcome": "YES"|"NO"|"UNCERTAIN", "confidence": 0.0-1.0, "reasoning": "brief explanation" }',
          messages: [{
            role: 'user',
            content: `Market question: "${market.question}"\n\nSource content:\n${sourceText}\n\nDetermine: did this prediction come true?`
          }],
        });

        const aiText = aiResponse?.content?.[0]?.text || '';
        let resolution;
        try { resolution = JSON.parse(aiText); } catch { continue; }
        if (!resolution?.outcome || !['YES', 'NO', 'UNCERTAIN'].includes(resolution.outcome)) continue;

        // Get creator info for notification
        const { data: creatorSettings } = await supabase
          .from('creator_settings')
          .select('creator_id, display_name')
          .eq('slug', market.tenant_slug)
          .maybeSingle();

        let creatorEmail = null;
        if (creatorSettings?.creator_id) {
          const { data: creatorUser } = await supabase
            .from('users')
            .select('email')
            .eq('id', creatorSettings.creator_id)
            .maybeSingle();
          creatorEmail = creatorUser?.email;
        }

        if (resolution.outcome !== 'UNCERTAIN' && resolution.confidence >= 0.82) {
          // High confidence — auto-resolve
          const outcome = resolution.outcome; // 'YES' or 'NO'
          const winningSide = outcome;
          const losingSide  = outcome === 'YES' ? 'NO' : 'YES';

          // Settle positions (same logic as manual settle)
          const { data: positions } = await supabase
            .from('positions')
            .select('*')
            .eq('market_id', market.id)
            .eq('settled', false);

          if (positions && positions.length) {
            for (const pos of positions) {
              const won = pos.side === winningSide;
              const payout = won ? (Number(pos.potential_payout) || 0) : 0;
              await supabase.from('positions').update({ settled: true, won }).eq('id', pos.id);
              if (won && payout > 0) {
                // Credit community balance
                const { data: bal } = await supabase
                  .from('community_balances')
                  .select('balance')
                  .eq('user_id', pos.user_id)
                  .eq('creator_slug', market.tenant_slug)
                  .maybeSingle();
                const cur = Number(bal?.balance) || 0;
                await supabase.from('community_balances')
                  .upsert({ user_id: pos.user_id, creator_slug: market.tenant_slug, balance: cur + payout },
                           { onConflict: 'user_id,creator_slug' });
              }
            }
          }

          await supabase.from('markets').update({
            resolved: true,
            resolved_at: new Date().toISOString(),
            resolution_outcome: outcome,
            resolution_note: `Auto-resolved by AI (${Math.round(resolution.confidence * 100)}% confidence): ${resolution.reasoning}`,
          }).eq('id', market.id);

          console.log(`[auto-resolve] Auto-resolved market ${market.id} as ${outcome} (${Math.round(resolution.confidence * 100)}%)`);

          // Notify creator
          if (creatorEmail && process.env.SMTP_HOST) {
            const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
            await transporter.sendMail({
              from: process.env.SMTP_FROM || 'noreply@hyperflex.network',
              to: creatorEmail,
              subject: `✅ Market auto-resolved: ${market.question.slice(0, 60)}`,
              html: `<div style="background:#141412;padding:32px;font-family:'Courier New',monospace;color:#ddd8cc;max-width:540px;border-radius:12px;"><div style="font-size:20px;font-weight:800;color:#c9920d;margin-bottom:20px;">HYPERFLEX</div><p style="color:#f5f5f0;font-size:16px;font-weight:700;margin:0 0 12px;">A market was auto-resolved ✅</p><div style="background:#1c1c19;border:1px solid #2a2a27;border-radius:8px;padding:16px;margin-bottom:20px;"><div style="font-size:13px;color:#ddd8cc;margin-bottom:8px;">"${market.question}"</div><div style="font-size:14px;font-weight:700;color:#c9920d;margin-bottom:4px;">Outcome: ${outcome}</div><div style="font-size:12px;color:#888880;">${resolution.reasoning}</div></div><p style="font-size:12px;color:#888880;">If this seems incorrect, you can override it from your <a href="https://hyperflex.network/creator-dashboard.html" style="color:#c9920d;">dashboard</a>.</p></div>`
            }).catch(() => {});
          }

        } else {
          // Uncertain or low-confidence — flag for creator review
          await supabase.from('markets').update({
            resolution_note: `⚠️ AI suggested ${resolution.outcome} (${Math.round((resolution.confidence || 0) * 100)}% confidence) — needs manual review. ${resolution.reasoning}`,
          }).eq('id', market.id);

          console.log(`[auto-resolve] Flagged market ${market.id} for creator review (${resolution.outcome}, ${resolution.confidence})`);

          // Email creator to manually resolve
          if (creatorEmail && process.env.SMTP_HOST) {
            const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
            await transporter.sendMail({
              from: process.env.SMTP_FROM || 'noreply@hyperflex.network',
              to: creatorEmail,
              subject: `⚠️ Market needs your resolution: ${market.question.slice(0, 60)}`,
              html: `<div style="background:#141412;padding:32px;font-family:'Courier New',monospace;color:#ddd8cc;max-width:540px;border-radius:12px;"><div style="font-size:20px;font-weight:800;color:#c9920d;margin-bottom:20px;">HYPERFLEX</div><p style="color:#f5f5f0;font-size:16px;font-weight:700;margin:0 0 12px;">A market needs your resolution ⚠️</p><div style="background:#1c1c19;border:1px solid #2a2a27;border-radius:8px;padding:16px;margin-bottom:20px;"><div style="font-size:13px;color:#ddd8cc;margin-bottom:8px;">"${market.question}"</div><div style="font-size:12px;color:#888880;margin-bottom:8px;">AI suggested <strong style="color:#c9920d;">${resolution.outcome}</strong> but wasn't confident enough to auto-resolve (${Math.round((resolution.confidence || 0) * 100)}%).</div><div style="font-size:12px;color:#888880;">${resolution.reasoning}</div></div><a href="https://hyperflex.network/creator-dashboard.html" style="display:inline-block;background:#c9920d;color:#141412;padding:10px 20px;border-radius:6px;font-weight:700;font-size:13px;text-decoration:none;">Resolve from dashboard →</a></div>`
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.error(`[auto-resolve] Error on market ${market.id}:`, e.message);
      }
    }
  } catch (err) {
    console.error('[auto-resolve] Fatal:', err.message);
  }
}

// Run auto-resolve check every 30 minutes
cron.schedule('*/30 * * * *', autoResolveExpiredMarkets);

// Auto-sync platform positions — every hour
cron.schedule('0 * * * *', syncAllUserPositions);

// ── PROFILE PAGE: WALL + AGGREGATED COMMENTS ─────────────────────────────────

// GET /api/profile/:slug/wall — public, returns last 40 wall posts
app.get('/api/profile/:slug/wall', async (req, res) => {
  try {
    const { slug } = req.params;
    const { data, error } = await supabase
      .from('creator_wall')
      .select('id, content, created_at, user_id, users(display_name)')
      .eq('creator_slug', slug)
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) throw error;
    const posts = (data || []).map(p => ({
      id: p.id,
      content: p.content,
      created_at: p.created_at,
      user_id: p.user_id,
      display_name: p.users?.display_name || 'Anonymous',
    }));
    res.json({ posts });
  } catch (err) {
    console.error('[profile wall GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:slug/wall — auth required, post to creator wall
app.post('/api/profile/:slug/wall', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.id;
    const content = (req.body.content || '').trim().slice(0, 280);
    if (!content) return res.status(400).json({ error: 'Content required' });

    // Verify creator exists
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('slug', slug)
      .single();
    if (!creator) return res.status(404).json({ error: 'Community not found' });

    const { data: post, error } = await supabase
      .from('creator_wall')
      .insert({ creator_slug: slug, user_id: userId, content })
      .select('id, content, created_at, user_id')
      .single();
    if (error) throw error;

    // Get display name for response
    const { data: u } = await supabase.from('users').select('display_name').eq('id', userId).single();
    res.json({ post: { ...post, display_name: u?.display_name || 'Anonymous' } });
  } catch (err) {
    console.error('[profile wall POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/profile/:slug/comments — aggregated market comments for this creator's community
app.get('/api/profile/:slug/comments', async (req, res) => {
  try {
    const { slug } = req.params;

    // Get all market IDs for this creator
    const { data: markets } = await supabase
      .from('markets')
      .select('id, question')
      .eq('creator_slug', slug)
      .eq('is_public', true);
    if (!markets || !markets.length) return res.json({ comments: [] });

    const marketIds = markets.map(m => m.id);
    const marketMap = Object.fromEntries(markets.map(m => [m.id, m.question]));

    // Fetch recent comments across all those markets
    const { data: comments, error } = await supabase
      .from('market_comments')
      .select('id, market_id, content, created_at, user_id, users(display_name)')
      .in('market_id', marketIds)
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) throw error;

    const result = (comments || []).map(c => ({
      id: c.id,
      market_id: c.market_id,
      market_question: marketMap[c.market_id] || '',
      content: c.content,
      created_at: c.created_at,
      user_id: c.user_id,
      display_name: c.users?.display_name || 'Anonymous',
    }));
    res.json({ comments: result });
  } catch (err) {
    console.error('[profile comments GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SEASONS / TOURNAMENTS ─────────────────────────────────────────────────────

// POST /api/creator/seasons — create a season (Pro/Premium required)
app.post('/api/creator/seasons', requireCreator, async (req, res) => {
  try {
    const creatorSlug = req.creator.slug;
    const { data: settings } = await supabase
      .from('creator_settings').select('plan').eq('slug', creatorSlug).single();
    const plan = settings?.plan || 'free';
    if (plan === 'free') {
      return res.status(403).json({ error: 'Seasons require Pro or Premium. Upgrade to run tournaments.' });
    }

    const { name, description, ends_at, prize_description, market_ids } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Season name is required' });

    // Create the season
    const { data: season, error: sErr } = await supabase
      .from('seasons')
      .insert({
        creator_slug: creatorSlug,
        name: name.trim().slice(0, 80),
        description: (description || '').trim().slice(0, 300) || null,
        ends_at: ends_at || null,
        prize_description: (prize_description || '').trim().slice(0, 200) || null,
        status: 'active',
      })
      .select()
      .single();
    if (sErr) throw sErr;

    // Optionally assign existing markets to this season
    if (Array.isArray(market_ids) && market_ids.length) {
      await supabase
        .from('markets')
        .update({ season_id: season.id })
        .in('id', market_ids)
        .eq('creator_slug', creatorSlug);
    }

    res.json({ season });
  } catch (err) {
    console.error('[seasons POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/creator/seasons — list creator's seasons with stats
app.get('/api/creator/seasons', requireCreator, async (req, res) => {
  try {
    const creatorSlug = req.creator.slug;
    const { data: seasons, error } = await supabase
      .from('seasons')
      .select('*')
      .eq('creator_slug', creatorSlug)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Attach market count to each season
    const ids = (seasons || []).map(s => s.id);
    let marketCounts = {};
    if (ids.length) {
      const { data: mkts } = await supabase
        .from('markets')
        .select('season_id')
        .in('season_id', ids);
      (mkts || []).forEach(m => { marketCounts[m.season_id] = (marketCounts[m.season_id] || 0) + 1; });
    }

    const enriched = (seasons || []).map(s => ({
      ...s,
      market_count: marketCounts[s.id] || 0,
    }));
    res.json({ seasons: enriched });
  } catch (err) {
    console.error('[seasons GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/creator/seasons/:id — update name, description, prize, status, ends_at
app.put('/api/creator/seasons/:id', requireCreator, async (req, res) => {
  try {
    const creatorSlug = req.creator.slug;
    const { id } = req.params;
    const { name, description, ends_at, prize_description, status } = req.body;

    // Ownership check
    const { data: existing } = await supabase
      .from('seasons').select('id, creator_slug').eq('id', id).single();
    if (!existing || existing.creator_slug !== creatorSlug)
      return res.status(404).json({ error: 'Season not found' });

    const update = {};
    if (name !== undefined)              update.name = name.trim().slice(0, 80);
    if (description !== undefined)       update.description = description.trim().slice(0, 300) || null;
    if (ends_at !== undefined)           update.ends_at = ends_at || null;
    if (prize_description !== undefined) update.prize_description = prize_description.trim().slice(0, 200) || null;
    if (status !== undefined && ['active','ended','draft'].includes(status)) update.status = status;

    const { data: season, error } = await supabase
      .from('seasons').update(update).eq('id', id).select().single();
    if (error) throw error;

    // If ending a season, unlink all its markets so they go back to being independent
    // (keep season_id for leaderboard history — do NOT unlink)
    res.json({ season });
  } catch (err) {
    console.error('[seasons PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/creator/seasons/:id/markets — add/remove markets from a season
// body: { add: [marketId, ...], remove: [marketId, ...] }
app.post('/api/creator/seasons/:id/markets', requireCreator, async (req, res) => {
  try {
    const creatorSlug = req.creator.slug;
    const { id } = req.params;
    const { add = [], remove = [] } = req.body;

    const { data: season } = await supabase
      .from('seasons').select('id, creator_slug').eq('id', id).single();
    if (!season || season.creator_slug !== creatorSlug)
      return res.status(404).json({ error: 'Season not found' });

    if (add.length) {
      await supabase.from('markets').update({ season_id: id })
        .in('id', add).eq('creator_slug', creatorSlug);
    }
    if (remove.length) {
      await supabase.from('markets').update({ season_id: null })
        .in('id', remove).eq('creator_slug', creatorSlug).eq('season_id', id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[seasons markets POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/community/:slug/seasons — public list of active/recent seasons
app.get('/api/community/:slug/seasons', async (req, res) => {
  try {
    const { slug } = req.params;
    const { data: seasons, error } = await supabase
      .from('seasons')
      .select('id, name, description, status, starts_at, ends_at, prize_description, created_at')
      .eq('creator_slug', slug)
      .neq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;

    // Market counts
    const ids = (seasons || []).map(s => s.id);
    let marketCounts = {};
    if (ids.length) {
      const { data: mkts } = await supabase.from('markets').select('season_id').in('season_id', ids);
      (mkts || []).forEach(m => { marketCounts[m.season_id] = (marketCounts[m.season_id] || 0) + 1; });
    }

    res.json({ seasons: (seasons || []).map(s => ({ ...s, market_count: marketCounts[s.id] || 0 })) });
  } catch (err) {
    console.error('[community seasons GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/community/:slug/seasons/:seasonId — season detail + leaderboard
app.get('/api/community/:slug/seasons/:seasonId', async (req, res) => {
  try {
    const { slug, seasonId } = req.params;

    // Season meta
    const { data: season, error: sErr } = await supabase
      .from('seasons')
      .select('*')
      .eq('id', seasonId)
      .eq('creator_slug', slug)
      .single();
    if (sErr || !season) return res.status(404).json({ error: 'Season not found' });

    // Season markets
    const { data: markets } = await supabase
      .from('markets')
      .select('id, question, category, resolved, outcome, yes_price, no_price, trader_count, expiry_date')
      .eq('season_id', seasonId)
      .order('created_at', { ascending: true });

    const marketIds = (markets || []).map(m => m.id);

    // Leaderboard — sum settled positions across all season markets
    let leaderboard = [];
    if (marketIds.length) {
      const { data: positions } = await supabase
        .from('positions')
        .select('user_id, amount, potential_payout, settled, won, users(display_name)')
        .in('market_id', marketIds)
        .eq('settled', true);

      const totals = {};
      (positions || []).forEach(p => {
        if (!totals[p.user_id]) totals[p.user_id] = {
          user_id: p.user_id,
          display_name: p.users?.display_name || 'Anonymous',
          pnl: 0, wins: 0, trades: 0,
        };
        const pnl = p.won ? Math.round((p.potential_payout - p.amount) / 100) : -Math.round(p.amount / 100);
        totals[p.user_id].pnl += pnl;
        totals[p.user_id].trades += 1;
        if (p.won) totals[p.user_id].wins += 1;
      });

      leaderboard = Object.values(totals)
        .sort((a, b) => b.pnl - a.pnl)
        .slice(0, 20);
    }

    res.json({ season, markets: markets || [], leaderboard });
  } catch (err) {
    console.error('[season detail GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/profile-share-stats — follower count for the authed user's profile
app.get('/api/user/profile-share-stats', requireAuth, async (req, res) => {
  try {
    const { count } = await supabase
      .from('predictor_follows')
      .select('id', { count: 'exact', head: true })
      .eq('following_id', req.userId);
    res.json({ followers: count || 0, profile_views: 0 });
  } catch (e) {
    res.json({ followers: 0, profile_views: 0 });
  }
});

// ── WALLETS / CONNECTED ACCOUNTS ─────────────────────────────────────────────

// GET /api/user/wallets — return connected wallet/platform info for authed user
app.get('/api/user/wallets', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('polymarket_address, kalshi_api_key, kalshi_username, manifold_username')
      .eq('id', req.userId)
      .maybeSingle();
    if (error) throw error;
    res.json({
      polymarket_address: data?.polymarket_address || null,
      kalshi_api_key_set: !!(data?.kalshi_api_key),
      kalshi_username:    data?.kalshi_username    || null,
      manifold_username:  data?.manifold_username  || null,
    });
  } catch (err) {
    console.error('[wallets GET]', err.message);
    res.status(500).json({ error: 'Failed to load wallet info' });
  }
});

// PUT /api/user/wallets — update connected wallet/platform info
app.put('/api/user/wallets', requireAuth, async (req, res) => {
  try {
    const { polymarket_address, kalshi_api_key, kalshi_username, manifold_username } = req.body;
    const updates = {};

    if (polymarket_address !== undefined) {
      const addr = (polymarket_address || '').trim();
      if (addr && !/^0x[0-9a-fA-F]{40}$/.test(addr))
        return res.status(400).json({ error: 'Invalid Ethereum address format' });
      updates.polymarket_address = addr || null;
    }

    if (manifold_username !== undefined) {
      updates.manifold_username = (manifold_username || '').trim() || null;
    }

    if (kalshi_username !== undefined) {
      updates.kalshi_username = (kalshi_username || '').trim() || null;
    }

    if (kalshi_api_key !== undefined) {
      const key = (kalshi_api_key || '').trim();
      if (key && !/^[0-9a-f-]{36}$/.test(key))
        return res.status(400).json({ error: 'Invalid Kalshi API key format (expected UUID)' });
      updates.kalshi_api_key = key || null;
      if (key) _kalshiCache.delete(key);
    }

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const { error } = await supabase.from('users').update(updates).eq('id', req.userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[wallets PUT]', err.message);
    res.status(500).json({ error: 'Failed to update wallet info' });
  }
});

// GET /api/kalshi/positions — proxy Kalshi API using stored user API key
app.get('/api/kalshi/positions', requireAuth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('kalshi_api_key')
      .eq('id', req.userId)
      .maybeSingle();
    if (!user?.kalshi_api_key) return res.status(400).json({ error: 'No Kalshi API key connected' });

    const apiKey = user.kalshi_api_key;
    const cached = _kalshiCache.get(apiKey);
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return res.json(cached.data);

    const r = await fetch('https://trading-api.kalshi.com/trade-api/v2/portfolio/positions', {
      headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' }
    });
    if (r.status === 401) return res.status(401).json({ error: 'Invalid Kalshi API key' });
    if (!r.ok) throw new Error('Kalshi API returned ' + r.status);
    const raw = await r.json();

    // Enrich with market details (batch up to 20 unique tickers)
    const positions = raw.positions || [];
    const tickers = [...new Set(positions.map(p => p.ticker))].slice(0, 20);
    const marketMap = {};
    await Promise.all(tickers.map(async ticker => {
      try {
        const mr = await fetch('https://trading-api.kalshi.com/trade-api/v2/markets/' + ticker, {
          headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' }
        });
        if (mr.ok) { const md = await mr.json(); marketMap[ticker] = md.market; }
      } catch {}
    }));

    const normalized = positions
      .filter(p => p.position !== 0)
      .map(p => {
        const m = marketMap[p.ticker] || {};
        const isYes = p.position > 0;
        const currentPrice = isYes ? (m.yes_bid || 0.5) : (1 - (m.yes_ask || 0.5));
        const contracts = Math.abs(p.position);
        return {
          id:              p.ticker,
          question:        m.title || p.ticker,
          side:            isYes ? 'YES' : 'NO',
          contracts,
          current_price:   currentPrice,
          cash_value:      Math.round(contracts * currentPrice * 100) / 100,
          realized_pnl:    p.realized_pnl   || 0,
          unrealized_pnl:  p.unrealized_pnl || 0,
          market_url:      'https://kalshi.com/markets/' + p.ticker,
          end_date:        m.close_time || null,
          closed:          m.status === 'finalized',
          pnl_pct:         p.unrealized_pnl && contracts > 0
            ? Math.round((p.unrealized_pnl / (contracts * 0.5)) * 100) : 0,
          platform:        'kalshi',
        };
      });

    const data = { positions: normalized, fetched_at: new Date().toISOString() };
    _kalshiCache.set(apiKey, { ts: Date.now(), data });
    res.json(data);
  } catch (err) {
    console.error('[kalshi proxy]', err.message);
    // Fallback: return cached_positions from DB if fresh (within 30 min)
    try {
      const { data: fallback } = await supabase
        .from('cached_positions')
        .select('*')
        .eq('user_id', req.userId)
        .eq('platform', 'kalshi')
        .gte('updated_at', new Date(Date.now() - 30 * 60 * 1000).toISOString());
      if (fallback?.length) return res.json({ positions: fallback, fetched_at: fallback[0].updated_at, from_cache: true });
    } catch {}
    res.status(502).json({ error: 'Failed to fetch Kalshi positions', detail: err.message });
  }
});

app.get('/api/polymarket/positions/:address', async (req, res) => {
  const address = req.params.address.trim();
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return res.status(400).json({ error: 'Invalid Polymarket wallet address' });
  const cacheKey = `poly_pub_${address}`;
  const cached = _polyCache?.get(cacheKey);
  if (cached) return res.json(cached);
  try {
    const upstream = await fetch(`https://data-api.polymarket.com/positions?user=${address}&limit=50&sortBy=CURRENT&winning=false`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Hyperflex/1.0' }
    });
    if (upstream.status === 400) return res.status(400).json({ error: 'Polymarket rejected this address. Double-check your wallet address on polymarket.com' });
    if (!upstream.ok) throw new Error('Polymarket API ' + upstream.status);
    const raw = await upstream.json();
    const positions = (Array.isArray(raw) ? raw : []).map(p => ({
      id: p.conditionId,
      question: p.title || p.question || 'Unknown market',
      side: p.outcome || 'YES',
      shares: parseFloat(p.size) || 0,
      current_price: parseFloat(p.curPrice) || 0,
      cash_value: parseFloat(p.currentValue) || 0,
      cost_basis: parseFloat(p.initialValue) || 0,
      pnl: parseFloat(p.cashPnl) || 0,
      pnl_pct: parseFloat(p.percentPnl) || 0,
      market_url: p.slug ? `https://polymarket.com/event/${p.eventSlug || p.slug}` : `https://polymarket.com`,
      icon: p.icon || null,
      end_date: p.endDateIso || p.endDate || null,
      platform: 'polymarket'
    }));
    const data = { positions, address, fetched_at: new Date().toISOString() };
    if (_polyCache) { _polyCache.set(cacheKey, data); setTimeout(() => _polyCache.delete(cacheKey), 5 * 60 * 1000); }
    res.json(data);
  } catch (err) {
    console.error('[polymarket proxy]', err.message);
    res.status(502).json({ error: 'Failed to fetch Polymarket positions', detail: err.message });
  }
});

app.get('/api/manifold/positions/:username', async (req, res) => {
  let username = req.params.username.trim();
  if (!username || !/^[a-zA-Z0-9_-]{1,50}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  const cached = _manifoldCache.get(username.toLowerCase());
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return res.json(cached.data);
  try {
    // Resolve canonical username — Manifold user API is case-sensitive, try variants
    let resolvedUsername = null;
    const variants = [username];
    const lower = username.toLowerCase();
    const pascal = username.replace(/(?:^|[-_])(\w)/g, (_, c) => c.toUpperCase());
    if (pascal !== username) variants.push(pascal);
    if (lower !== username && lower !== pascal) variants.push(lower);
    for (const v of variants) {
      const ur = await fetch(`https://api.manifold.markets/v0/user/${encodeURIComponent(v)}`, { headers: { Accept: 'application/json', 'User-Agent': 'Hyperflex/1.0' } });
      if (ur.ok) { const ud = await ur.json(); resolvedUsername = ud.username || v; break; }
    }
    if (!resolvedUsername) return res.status(404).json({ error: 'Manifold user not found. Check your exact username (case-sensitive) at manifold.markets/profile' });
    username = resolvedUsername;
    const betsRes = await fetch(`https://api.manifold.markets/v0/bets?username=${encodeURIComponent(username)}&limit=200`, { headers: { Accept: 'application/json', 'User-Agent': 'Hyperflex/1.0' } });
    if (!betsRes.ok) throw new Error('Manifold bets API ' + betsRes.status);
    const bets = await betsRes.json();
    const contractMap = {};
    for (const b of bets) {
      if (b.isRedemption) continue;
      if (!contractMap[b.contractId]) contractMap[b.contractId] = { shares: 0, amount: 0, outcome: b.outcome, contractId: b.contractId };
      contractMap[b.contractId].shares += (b.shares || 0);
      contractMap[b.contractId].amount += (b.amount || 0);
    }
    const openContracts = Object.values(contractMap).filter(c => c.shares > 0.01);
    if (!openContracts.length) { const data = { positions: [], fetched_at: new Date().toISOString() }; _manifoldCache.set(username.toLowerCase(), { ts: Date.now(), data }); return res.json(data); }
    const enriched = await Promise.all(openContracts.slice(0, 20).map(async c => {
      try {
        const mr = await fetch(`https://api.manifold.markets/v0/market/${c.contractId}`, { headers: { Accept: 'application/json' } });
        const m = mr.ok ? await mr.json() : {};
        if (m.isResolved) return null;
        const currentProb = m.probability || 0.5;
        const currentPrice = c.outcome === 'YES' ? currentProb : (1 - currentProb);
        const cashValue = Math.round(c.shares * currentPrice * 100) / 100;
        return { id: c.contractId, question: m.question || c.contractId, side: c.outcome, shares: Math.round(c.shares * 100) / 100, current_price: Math.round(currentPrice * 1000) / 1000, cash_value: cashValue, cost_basis: Math.round(c.amount * 100) / 100, pnl_pct: c.amount > 0 ? Math.round(((cashValue - c.amount) / c.amount) * 100) : 0, market_url: m.url || `https://manifold.markets/market/${c.contractId}`, end_date: m.closeTime ? new Date(m.closeTime).toISOString() : null, closed: !!m.isResolved, platform: 'manifold' };
      } catch { return null; }
    }));
    const positions = enriched.filter(Boolean);
    const data = { positions, username, fetched_at: new Date().toISOString() };
    _manifoldCache.set(username.toLowerCase(), { ts: Date.now(), data });
    res.json(data);
  } catch (err) {
    console.error('[manifold proxy]', err.message);
    // Fallback: return cached_positions from DB if fresh (within 30 min)
    try {
      const { data: fallback } = await supabase
        .from('cached_positions')
        .select('*')
        .eq('platform', 'manifold')
        .gte('updated_at', new Date(Date.now() - 30 * 60 * 1000).toISOString());
      if (fallback?.length) return res.json({ positions: fallback, fetched_at: fallback[0].updated_at, from_cache: true });
    } catch {}
    res.status(502).json({ error: 'Failed to fetch Manifold positions', detail: err.message });
  }
});

// ── CROSS-PLATFORM MARKET SEARCH ────────────────────────────────────────────
const _mktSearchCache = new Map();
app.get('/api/markets/search', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 2) return res.status(400).json({ error: 'Query too short (min 2 chars)' });
  const cacheKey = `mkt_${q}`;
  const cached = _mktSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 3 * 60 * 1000) return res.json(cached.data);
  try {
    const fetchWithTimeout = (url, opts, ms = 8000) => {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), ms);
      return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(tid));
    };
    const [polyRes, kalshiRes] = await Promise.allSettled([
      fetchWithTimeout(`https://gamma-api.polymarket.com/markets?closed=false&limit=20&search=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json', 'User-Agent': 'Hyperflex/1.0' } }),
      fetchWithTimeout(`https://api.elections.kalshi.com/trade-api/v2/markets?limit=20&status=open&series_ticker=${encodeURIComponent(q.toUpperCase())}`, { headers: { Accept: 'application/json', 'User-Agent': 'Hyperflex/1.0' } })
    ]);
    let polyMarkets = [];
    if (polyRes.status === 'fulfilled' && polyRes.value.ok) {
      const raw = await polyRes.value.json();
      polyMarkets = (Array.isArray(raw) ? raw : []).filter(m => !m.closed).map(m => ({
        question: m.question || m.title || '',
        yes_pct: m.outcomePrices ? Math.round(JSON.parse(m.outcomePrices)[0] * 100) : null,
        close_date: m.endDate || m.endDateIso || null,
        url: m.slug ? `https://polymarket.com/event/${m.eventSlug || m.slug}` : 'https://polymarket.com',
        volume: m.volume || 0
      })).slice(0, 15);
    }
    let kalshiMarkets = [];
    if (kalshiRes.status === 'fulfilled' && kalshiRes.value.ok) {
      const raw = await kalshiRes.value.json();
      const mkts = raw.markets || [];
      kalshiMarkets = mkts.filter(m => m.status === 'open' && (m.title || '').toLowerCase().includes(q)).map(m => ({
        question: m.title || '',
        yes_pct: m.yes_ask != null ? Math.round(m.yes_ask * 100) : (m.last_price != null ? Math.round(m.last_price * 100) : null),
        close_date: m.close_time || m.expiration_time || null,
        url: m.ticker ? `https://kalshi.com/markets/${m.event_ticker}/${m.ticker}` : 'https://kalshi.com',
        volume: m.volume || 0
      })).slice(0, 15);
    }
    // Smart money: find cached_positions from sharp users (non-blocking, 3s timeout)
    let smart_money = null;
    try {
      const smTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
      const smQuery = (async () => {
        const { data: matchPos } = await supabase
          .from('cached_positions')
          .select('user_id, side')
          .ilike('market_title', `%${q}%`)
          .limit(200);
        if (!matchPos?.length) return null;
        const userIds = [...new Set(matchPos.map(p => p.user_id))];
        const { data: settled } = await supabase
          .from('positions')
          .select('user_id, won')
          .in('user_id', userIds)
          .not('won', 'is', null)
          .limit(1000);
        const stats = {};
        (settled || []).forEach(p => {
          if (!stats[p.user_id]) stats[p.user_id] = { w: 0, t: 0 };
          stats[p.user_id].t++;
          if (p.won) stats[p.user_id].w++;
        });
        const sharpIds = new Set(Object.entries(stats)
          .filter(([, s]) => s.t >= 10 && (s.w / s.t) >= 0.65)
          .map(([id]) => id));
        const sharpPos = matchPos.filter(p => sharpIds.has(p.user_id));
        if (sharpPos.length) {
          const yesCount = sharpPos.filter(p => p.side === 'YES').length;
          return { yes_pct: Math.round((yesCount / sharpPos.length) * 100), count: sharpPos.length };
        }
        return null;
      })();
      smart_money = await Promise.race([smQuery, smTimeout]).catch(() => null);
    } catch (e) { console.warn('[smart-money]', e.message); }

    const data = { polymarket: polyMarkets, kalshi: kalshiMarkets, smart_money };
    _mktSearchCache.set(cacheKey, { ts: Date.now(), data });
    setTimeout(() => _mktSearchCache.delete(cacheKey), 3 * 60 * 1000);
    res.json(data);
  } catch (err) {
    console.error('[market search]', err.message);
    res.status(502).json({ error: 'Search failed', detail: err.message });
  }
});

// 404 catch-all — must be last route
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HYPERFLEX server running on port ${PORT}`));
