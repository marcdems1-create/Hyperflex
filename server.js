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

const app = express();
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

    if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.paused') {
      const sub = event.data.object;
      // Find creator by customer email
      const customer = await stripe.customers.retrieve(sub.customer);
      if (customer.email) {
        const { data: user } = await supabase.from('users').select('id').eq('email', customer.email).maybeSingle();
        if (user) {
          await supabase.from('creator_settings').update({ plan: 'free' }).eq('creator_id', user.id);
          console.log(`[stripe] downgraded creator ${customer.email} to free`);
        }
      }
    }
  } catch (err) {
    console.error('[stripe] webhook handler error:', err.message);
  }

  res.json({ received: true });
});

app.use(express.json());
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
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'hyperflex_secret');
  res.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name, balance: user.balance } });
});

// Auth middleware for protected routes
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Auth required' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'hyperflex_secret');
    req.userId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

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

// Create market (admin)
app.post('/markets', async (req, res) => {
  const {
    question, expiry_date,
    commodity, target_price, direction,
    category, creator_id, tenant_slug, is_public, resolution_source
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

  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'hyperflex_secret');
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

  // Prohibited keyword check
  const prohibited = PROHIBITED_PATTERNS.find(p => p.re.test(row.question || ''));
  if (prohibited) return res.status(400).json({ error: prohibited.msg });

  // Store resolution_sources array if provided
  const { resolution_sources } = req.body;
  if (Array.isArray(resolution_sources) && resolution_sources.length >= 3) {
    row.resolution_sources = JSON.stringify(resolution_sources);
  }

  const { data, error } = await supabase
    .from('markets')
    .insert([row])
    .select()
    .single();
  if (error) {
    console.error('POST /markets insert error:', JSON.stringify({ message: error.message, code: error.code, details: error.details, hint: error.hint, row }));
    return res.status(400).json({ error: error.message, details: error.details, hint: error.hint });
  }
  // Score resonance async — don't block response
  if (data?.id) {
    scoreMarketResonance(data.question, data.category).then(score => {
      if (score) supabase.from('markets').update({ resonance_score: score }).eq('id', data.id).then(() => {});
    });
  }
  res.json(data);
});

// ── TRADING ───────────────────────────────────────

// Place a trade
app.post('/trade', async (req, res) => {
  const { user_id, market_id, side, amount } = req.body;

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

  // ── CPMM Pricing ──────────────────────────────────────────────────────────
  // Use pool balances for current price. Fall back to stored price if pools are missing.
  const yesPool = market.yes_pool || MARKET_SEED;
  const noPool  = market.no_pool  || MARKET_SEED;
  const totalPool = yesPool + noPool;
  const price = side === 'YES'
    ? yesPool / totalPool
    : noPool  / totalPool;

  const potential_payout = amount / price;

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

  // Update pools, prices, volume, and trader_count in one call
  const marketUpdate = {
    yes_pool:    newYesPool,
    no_pool:     newNoPool,
    yes_price:   newYesPrice,
    no_price:    newNoPrice,
    volume:      (market.volume || 0) + amount
  };
  if (isNewTrader) marketUpdate.trader_count = (market.trader_count || 0) + 1;
  const { error: mktErr } = await supabase.from('markets').update(marketUpdate).eq('id', market_id);
  if (mktErr) console.error('market pool/price update error:', mktErr.message, mktErr.details);

  const newBalance = communityBalance - amount;
  res.json({
    message:   'Trade placed',
    position,
    balance:   newBalance,
    yes_price: newYesPrice,   // updated prices so frontend can refresh immediately
    no_price:  newNoPrice
  });
});

// Helper: extract user ID from JWT Bearer token. Returns null on failure.
function getUserIdFromReq(req) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return null;
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'hyperflex_secret');
    return payload.id || null;
  } catch {
    return null;
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

// Get user positions
app.get('/positions/:user_id', async (req, res) => {
  const { data, error } = await supabase
    .from('positions')
    .select('*, markets(*)')
    .eq('user_id', req.params.user_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Leaderboard: top 20 by PnL (join users + positions, settled only). If tenant subdomain, filter to that creator's markets.
app.get('/api/leaderboard', async (req, res) => {
  try {
    let positions;
    let leaderboardMarketIds = null;
    const subdomain = req.tenant?.subdomain;

    if (subdomain) {
      const { data: tenantMarkets } = await supabase
        .from('markets')
        .select('id')
        .eq('creator_slug', subdomain);
      leaderboardMarketIds = (tenantMarkets || []).map((m) => m.id);
      if (leaderboardMarketIds.length === 0) return res.json([]);
      const { data: pos } = await supabase
        .from('positions')
        .select('user_id, amount, potential_payout, settled, won')
        .eq('settled', true)
        .in('market_id', leaderboardMarketIds);
      positions = pos;
    } else {
      const { data: pos } = await supabase
        .from('positions')
        .select('user_id, amount, potential_payout, settled, won, market_id')
        .eq('settled', true);
      positions = pos;
      leaderboardMarketIds = [...new Set((pos || []).map(p => p.market_id))];
    }

    if (!positions || positions.length === 0) {
      return res.json([]);
    }

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
      if (p.won) {
        a.wins += 1;
        a.total_pnl += Number(p.potential_payout) || 0;
      }
      a.total_pnl -= Number(p.amount) || 0;
    }

    // Batch-compute streaks for all leaderboard users
    const streakMap = await getStreakMap(userIds, leaderboardMarketIds);

    const rows = [];
    for (const [userId, a] of agg) {
      const u = userMap.get(userId);
      rows.push({
        user_id: userId,
        username: (u?.display_name || u?.email || 'Unknown').trim() || 'Unknown',
        display_name: (u?.display_name || u?.email || 'Unknown').trim() || 'Unknown',
        total_pnl: Math.round(a.total_pnl * 100) / 100,
        win_rate: a.total_trades > 0 ? Math.round((a.wins / a.total_trades) * 100) : 0,
        total_trades: a.total_trades,
        wins: a.wins,
        streak: streakMap[userId] || 0,
      });
    }

    rows.sort((a, b) => b.total_pnl - a.total_pnl);
    const top20 = rows.slice(0, 20).map((r, i) => ({
      rank: i + 1,
      user_id: r.user_id,
      username: r.username,
      display_name: r.display_name,
      total_pnl: r.total_pnl,
      win_rate: r.win_rate,
      total_trades: r.total_trades,
      wins: r.wins,
      streak: r.streak,
    }));

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
  }
}

// Run settlement every hour
cron.schedule('0 * * * *', settleMarkets);

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

// Manual trigger endpoint
app.post('/api/scan-markets', async (req, res) => {
  try {
    await scanAndCreateMarkets();
    res.json({ ok: true });
  } catch (err) {
    console.error('Manual scan-markets error:', err.message);
    res.status(500).json({ error: 'Scan failed' });
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

// ── TEMPLATES ─────────────────────────────────────

const TEMPLATES = {
  sports: {
    name: 'Sports',
    category: 'entertainment',
    markets: [
      { question: 'Will the home team win tonight\'s game?', category: 'entertainment', target_price: 0, direction: 'above', days: 1 },
      { question: 'Will there be overtime in the next playoff game?', category: 'entertainment', target_price: 0, direction: 'above', days: 7 },
      { question: 'Will the leading scorer finish the season above 30 PPG?', category: 'entertainment', target_price: 30, direction: 'above', days: 60 },
      { question: 'Will the #1 seed make the finals?', category: 'entertainment', target_price: 0, direction: 'above', days: 45 },
      { question: 'Will any underdog ranked 5+ win the championship?', category: 'entertainment', target_price: 0, direction: 'above', days: 60 },
    ],
  },
  crypto: {
    name: 'Crypto',
    category: 'crypto',
    markets: [
      { question: 'Will Bitcoin exceed $100,000 by end of month?', category: 'crypto', target_price: 100000, direction: 'above', days: 30 },
      { question: 'Will Ethereum stay above $3,000 this week?', category: 'crypto', target_price: 3000, direction: 'above', days: 7 },
      { question: 'Will a new country adopt Bitcoin as legal tender?', category: 'crypto', target_price: 0, direction: 'above', days: 90 },
      { question: 'Will BTC dominance exceed 60% this month?', category: 'crypto', target_price: 0, direction: 'above', days: 30 },
      { question: 'Will a spot ETH ETF see $1B+ in weekly inflows?', category: 'crypto', target_price: 0, direction: 'above', days: 45 },
    ],
  },
  podcast: {
    name: 'Podcast',
    category: 'entertainment',
    markets: [
      { question: 'Will the next episode hit #1 on Spotify charts?', category: 'entertainment', target_price: 0, direction: 'above', days: 14 },
      { question: 'Will the host interview a political figure this month?', category: 'entertainment', target_price: 0, direction: 'above', days: 30 },
      { question: 'Will the next guest be a repeat appearance?', category: 'entertainment', target_price: 0, direction: 'above', days: 7 },
      { question: 'Will the show cross 1M downloads this quarter?', category: 'entertainment', target_price: 0, direction: 'above', days: 90 },
      { question: 'Will there be a live show announcement this month?', category: 'entertainment', target_price: 0, direction: 'above', days: 30 },
    ],
  },
  finance: {
    name: 'Finance',
    category: 'macro',
    markets: [
      { question: 'Will the Fed cut rates at the next FOMC meeting?', category: 'macro', target_price: 0, direction: 'above', days: 45 },
      { question: 'Will the S&P 500 close above 5,500 this month?', category: 'macro', target_price: 5500, direction: 'above', days: 30 },
      { question: 'Will US CPI come in below 3% this quarter?', category: 'macro', target_price: 0, direction: 'above', days: 60 },
      { question: 'Will gold exceed $3,000/oz before July?', category: 'commodities', target_price: 3000, direction: 'above', days: 60 },
      { question: 'Will any Magnificent 7 stock drop 20%+ from its high?', category: 'earnings', target_price: 0, direction: 'above', days: 90 },
    ],
  },
  entertainment: {
    name: 'Entertainment',
    category: 'entertainment',
    markets: [
      { question: 'Will this weekend\'s #1 movie gross over $50M?', category: 'entertainment', target_price: 0, direction: 'above', days: 7 },
      { question: 'Will the Best Picture winner be a sequel or franchise film?', category: 'entertainment', target_price: 0, direction: 'above', days: 60 },
      { question: 'Will a major streaming show be cancelled this month?', category: 'entertainment', target_price: 0, direction: 'above', days: 30 },
      { question: 'Will a music artist announce a world tour this quarter?', category: 'entertainment', target_price: 0, direction: 'above', days: 90 },
      { question: 'Will a video game release score 90+ on Metacritic?', category: 'entertainment', target_price: 0, direction: 'above', days: 45 },
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

const JWT_SECRET = process.env.JWT_SECRET || 'hyperflex-dev-secret-change-in-prod';
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
      selected_markets = []
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
        community_description: settings.community_description,
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
        welcome_bonus:   settings.welcome_bonus   ?? 5000
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
        .then(r => r.data || [])
    });

  } catch (err) {
    console.error('dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 5b. ANALYTICS
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
    const { data: markets } = await supabase
      .from('markets')
      .select('id, title, trader_count, volume, resolved, archived, created_at, yes_price, no_price')
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false });

    const allMarkets = markets || [];
    const activeMarkets   = allMarkets.filter(m => !m.resolved && !m.archived);
    const resolvedMarkets = allMarkets.filter(m => m.resolved);
    const archivedMarkets = allMarkets.filter(m => m.archived && !m.resolved);

    // Top markets by trader count
    const topMarkets = [...allMarkets]
      .sort((a, b) => (b.trader_count || 0) - (a.trader_count || 0))
      .slice(0, 5)
      .map(m => ({
        title: m.title,
        trader_count: m.trader_count || 0,
        volume: m.volume || 0,
        resolved: m.resolved || false,
        yes_price: m.yes_price || 0.5
      }));

    // Daily trade counts — last 30 days from positions table
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const marketIds = allMarkets.map(m => m.id);
    let dailyTrades = [];
    if (marketIds.length > 0) {
      const { data: positions } = await supabase
        .from('positions')
        .select('created_at')
        .in('market_id', marketIds)
        .gte('created_at', thirtyDaysAgo.toISOString());

      // Bucket by day
      const buckets = {};
      for (let i = 0; i < 30; i++) {
        const d = new Date();
        d.setDate(d.getDate() - (29 - i));
        const key = d.toISOString().slice(0, 10);
        buckets[key] = 0;
      }
      (positions || []).forEach(p => {
        const key = p.created_at.slice(0, 10);
        if (key in buckets) buckets[key]++;
      });
      dailyTrades = Object.entries(buckets).map(([date, count]) => ({ date, count }));
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
      const weekStart = getWeekStart().toISOString();
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

    res.json({
      plan,
      market_breakdown: {
        total: allMarkets.length,
        active: activeMarkets.length,
        resolved: resolvedMarkets.length,
        archived: archivedMarkets.length
      },
      top_markets: topMarkets,
      daily_trades: dailyTrades,
      balance_stats: balanceStats,
      refill_stats: refillStats,
      referral_stats: referralStats
    });

  } catch (err) {
    console.error('analytics error:', err);
    res.status(500).json({ error: err.message });
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
      referral_reward, welcome_bonus
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
// POST /markets/:id/resolve
// Auth: Bearer token required
// Body: { outcome: 'YES' | 'NO' }
// ════════════════════════════════════════════════════════════
app.post('/markets/:id/resolve', requireCreator, async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome } = req.body;
    const { attestation_text } = req.body;

    if (!['YES', 'NO'].includes(outcome)) {
      return res.status(400).json({ error: 'Outcome must be YES or NO' });
    }

    // Verify market belongs to this creator
    const { data: market } = await supabase
      .from('markets')
      .select('*')
      .eq('id', id)
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found or not yours' });
    if (market.resolved) return res.status(409).json({ error: 'Market already resolved' });

    // Mark market resolved
    const { error: resolveErr } = await supabase
      .from('markets')
      .update({
        resolved: true,
        outcome,
        resolved_at: new Date().toISOString()
      })
      .eq('id', id);

    if (resolveErr) throw resolveErr;

    // Store attestation
    if (attestation_text) {
      await supabase.from('markets').update({ attestation_text }).eq('id', id);
    }

    // Pay out winners — get all positions for this market
    const { data: positions } = await supabase
      .from('positions')
      .select('*')
      .eq('market_id', id);

    if (positions && positions.length > 0) {
      const payouts = [];
      for (const pos of positions) {
        const isWinner = pos.side === outcome;
        const pnl = isWinner ? pos.amount : -pos.amount; // simplified pnl

        payouts.push(
          supabase.from('positions').update({
            resolved: true,
            won: isWinner,
            pnl
          }).eq('id', pos.id)
        );

        if (isWinner) {
          // Credit winner's balance — fetch current then increment
          payouts.push(
            (async () => {
              const { data: u } = await supabase.from('users').select('balance').eq('id', pos.user_id).single();
              if (u) await supabase.from('users').update({ balance: (u.balance || 0) + pos.amount * 2 }).eq('id', pos.user_id);
            })()
          );
        }
      }
      await Promise.allSettled(payouts);
    }

    res.json({ ok: true, outcome, positions_settled: positions?.length || 0 });

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
// SCAN CONTENT — paste text from any platform (Twitch, Reddit, Discord, etc.)
// POST /api/creator/scan-content
// Body: { text: "...", source_label: "Twitch chat" | "Reddit thread" | ... }
// Returns: { markets, word_count, source_label }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/scan-content', requireCreator, async (req, res) => {
  try {
    const { text, source_label = 'content' } = req.body;
    if (!text || text.trim().length < 50) return res.status(400).json({ error: 'Please paste at least a few lines of content to scan.' });
    if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Anthropic API key not configured.' });

    const wordCount = text.trim().split(/\s+/).length;
    const truncated = text.trim().slice(0, 6000) + (text.length > 6000 ? '\n… [truncated]' : '');

    const now = new Date();
    const in30 = new Date(now); in30.setDate(now.getDate() + 30);
    const in60 = new Date(now); in60.setDate(now.getDate() + 60);
    const in90 = new Date(now); in90.setDate(now.getDate() + 90);
    const fmt = d => d.toISOString().split('T')[0];

    const prompt = `You are analyzing community content to generate prediction markets for a creator's audience.

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
    const markets = (JSON.parse(jsonMatch[0]).markets || []).map(m => ({ ...m, source: 'paste' }));

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

    // Match on any of the three fields that market-creation routes populate
    const { data: markets } = await supabase
      .from('markets')
      .select('id, question, category, expiry_date, yes_price, no_price, volume, trader_count, resolved, outcome')
      .or(`tenant_slug.eq.${slug},creator_id.eq.${settings.creator_id}`)
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    res.json({
      community: {
        display_name: settings.display_name,
        slug: settings.slug,
        custom_points_name: settings.custom_points_name,
        primary_color: settings.primary_color,
        plan: settings.plan || 'free',
        // Economy settings (safe to expose — used by frontend for UI enforcement)
        starting_balance: settings.starting_balance ?? 100000,
        min_bet: settings.min_bet ?? 1000,
        max_bet: settings.max_bet ?? null,
        referral_reward: settings.referral_reward ?? 10000,
        welcome_bonus: settings.welcome_bonus ?? 5000
      },
      markets: markets || [],
      rewards: await supabase
        .from('creator_rewards')
        .select('id, threshold, title, description')
        .eq('creator_id', settings.creator_id)
        .order('threshold', { ascending: true })
        .then(r => r.data || [])
    });

  } catch (err) {
    console.error('community page error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 8b. EDIT / DELETE MARKET
// PUT  /markets/:id   — update question, expiry_date, resolution_source, category
// DELETE /markets/:id — archive market (set is_public=false)
// ════════════════════════════════════════════════════════════

app.put('/markets/:id', requireCreator, async (req, res) => {
  try {
    const { id } = req.params;
    const { question, expiry_date, resolution_source, category } = req.body;

    // Verify ownership
    const { data: market } = await supabase
      .from('markets')
      .select('id, creator_id')
      .eq('id', id)
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found or not yours' });

    const updates = {};
    if (question !== undefined) updates.question = question;
    if (expiry_date !== undefined) updates.expiry_date = expiry_date;
    if (resolution_source !== undefined) updates.resolution_source = resolution_source;
    if (category !== undefined) { updates.category = category; updates.commodity = category; }

    const { data, error } = await supabase
      .from('markets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
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
      .update({ is_public: false })
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
// 10. PUBLIC COMMUNITY PAGE (slug catch-all — must be last)
// GET /:slug  →  serves community.html with SSR'd OG meta tags
// Crawlers (Discord, Twitter, Slack, iMessage) need meta tags in the HTML
// response — they don't execute JS. We SSR the <head> for every community page.
// ════════════════════════════════════════════════════════════
const RESERVED_SLUGS = new Set([
  'creator', 'api', 'auth', 'markets', 'positions', 'leaderboard',
  'trade', 'register', 'login', 'favicon.ico', 'robots.txt', 'admin'
]);

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
  const provided = req.query.secret
    || (req.headers.authorization || '').replace('Bearer ', '').trim();
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
      .select('creator_id, slug, display_name, plan, created_at, custom_points_name, primary_color')
      .order('created_at', { ascending: false });

    if (!settings?.length) return res.json([]);

    // Get user emails in one query
    const creatorIds = settings.map(s => s.creator_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, email')
      .in('id', creatorIds);
    const emailMap = Object.fromEntries((users || []).map(u => [u.id, u.email]));

    // Market counts per creator
    const { data: marketCounts } = await supabase
      .from('markets')
      .select('creator_id')
      .in('creator_id', creatorIds);
    const mktMap = {};
    (marketCounts || []).forEach(m => { mktMap[m.creator_id] = (mktMap[m.creator_id] || 0) + 1; });

    const rows = settings.map(s => ({
      creator_id: s.creator_id,
      slug:        s.slug,
      name:        s.display_name,
      email:       emailMap[s.creator_id] || '—',
      plan:        s.plan || 'free',
      markets:     mktMap[s.creator_id] || 0,
      joined:      s.created_at,
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
      .update({ plan })
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

// ════════════════════════════════════════════════════════════
// END CREATOR PLATFORM ROUTES
// ════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HYPERFLEX server running on port ${PORT}`));
