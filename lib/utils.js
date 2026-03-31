'use strict';

// ── Rate Limiting ─────────────────────────────────────────
const _rateLimits = {};

function rateLimit(key, identifier, maxAttempts, windowMs) {
  const bucket = key + ':' + identifier;
  if (!_rateLimits[bucket] || Date.now() > _rateLimits[bucket].resetAt) {
    _rateLimits[bucket] = { count: 0, resetAt: Date.now() + windowMs };
  }
  _rateLimits[bucket].count++;
  return _rateLimits[bucket].count <= maxAttempts;
}

// Exposed for testing — reset all rate limit state
function _resetRateLimits() {
  for (const k of Object.keys(_rateLimits)) delete _rateLimits[k];
}

// ── Streak Multiplier ─────────────────────────────────────
function getStreakMultiplier(streak) {
  if (streak >= 5) return 2.0;
  if (streak >= 3) return 1.5;
  return 1.0;
}

// ── Week Start (Monday 00:00 UTC) ─────────────────────────
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon…6=Sat
  const diff = day === 0 ? -6 : 1 - day; // roll back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── Time Ago String ───────────────────────────────────────
function timeAgoStr(iso) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return '<1m ago';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return Math.floor(d / 86400000) + 'd ago';
}

// ── HTML Escape ───────────────────────────────────────────
function escHtmlStr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Keyword Extraction ────────────────────────────────────
function extractKeywords(question) {
  const stop = new Set(['will','the','a','an','in','on','at','by','for','of','to','is','be','and','or','not','this','that','it','its','has','have','had','do','does','did','win','vs','vs.','above','below','before','after','end','next','last','first','over','under','hit','reach','get','would','should','could','from','with','than','more','most','less','new','old','2024','2025','2026','2027','2028','march','april','may','june','july','august','september','october','november','december','january','february']);
  const words = (question || '').replace(/[?!.,;:'"()\[\]{}]/g, '').split(/\s+/).filter(w => w.length > 2 && !stop.has(w.toLowerCase()));
  return words.slice(0, 4).join(' ');
}

// ── Narrative Classification ──────────────────────────────
const NARRATIVE_KEYWORDS = {
  'Trump & US Politics':   ['trump','president','democrat','republican','congress','senate','maga','white house','tariff','executive order','vance','gop','biden','kamala','rnc','dnc','impeach','scotus','supreme court'],
  'Crypto & DeFi':         ['bitcoin','btc','ethereum','eth','crypto','solana','sol','defi','nft','coinbase','stablecoin','altcoin','xrp','dogecoin','doge','memecoin','binance','token','blockchain','web3','polygon','avalanche','cardano','chainlink','uniswap','aave','backpack'],
  'Middle East & War':     ['israel','iran','gaza','hamas','hezbollah','ceasefire','hormuz','middle east','lebanon','netanyahu','strike','invasion','military','pentagon','troops','bomb','missile','airstrike','war ','warfare','conflict','idf','tehran','syria','yemen','houthi'],
  'AI & Big Tech':         ['ai ','openai','gpt','artificial intelligence','nvidia','apple','microsoft','google','meta ','anthropic','chatgpt','claude','gemini','llm','machine learning','deepseek','tesla','spacex','elon musk','robot','autonomous'],
  'Macro & Economy':       ['fed ','federal reserve','interest rate','inflation','recession','gdp','cpi','unemployment','rate cut','yield','crude oil','gold price','tariff','s&p','nasdaq','dow','stock market','treasury','bond','commodity','forex','oil price','copper','silver'],
  'Ukraine & Russia':      ['ukraine','russia','zelensky','putin','nato','kyiv','donbas','crimea','moscow','sanctions'],
  'NBA & Basketball':      ['nba','basketball','finals','playoff','lakers','celtics','warriors','nuggets','cavaliers','thunder','knicks','bucks','76ers','rockets','heat','suns','nets','kings','clippers','bulls','pacers','timberwolves','grizzlies','hawks','pistons','hornets','magic','wizards','pelicans','raptors','jazz','mavericks','spurs','blazers'],
  'NFL & American Sports': ['nfl','super bowl','mlb','world series','nhl','stanley cup','ncaa','march madness','yankees','dodgers','mets','cubs','red sox','chiefs','eagles','cowboys','49ers','ravens','bills','bengals','dolphins','lions','steelers','packers','bears','rams','seahawks','saints','ufc','boxing','fight night'],
  'Soccer & Football':     ['premier league','champions league','la liga','serie a','bundesliga','ligue 1','uefa','fifa','world cup','epl','manchester','liverpool','arsenal','chelsea','barcelona','real madrid','psg','bayern','juventus','napoli','inter milan','tottenham','man city','man united','mls','soccer'],
  'Health & Science':      ['measles','vaccine','fda','covid','pandemic','virus','disease','outbreak','drug','pharma','clinical trial','cdc','who ','health','cancer','obesity','bird flu','monkeypox','treatment','epidemic'],
  'Pop Culture':           ['oscar','grammy','emmy','movie','film','album','celebrity','kardashian','taylor swift','drake','beyonce','kanye','netflix','disney','tiktok','youtube','spotify','concert','box office','award','super bowl halftime'],
  'Weather & Climate':     ['temperature','hurricane','wildfire','flood','earthquake','tornado','climate','weather','heat wave','cold snap','storm','drought','el nino','la nina','celsius','fahrenheit'],
  'Global Elections':      ['election','vote','ballot','candidate','prime minister','chancellor','parliament','referendum','runoff','polling','constituency'],
  'Other':                 []
};

function classifyNarrative(question) {
  const q = (question || '').toLowerCase();
  for (const [narrative, keywords] of Object.entries(NARRATIVE_KEYWORDS)) {
    if (narrative === 'Other') continue;
    if (keywords.some(kw => q.includes(kw))) return narrative;
  }
  return 'Other';
}

// ── Sentiment Detection ───────────────────────────────────
const BULLISH_WORDS = ['surge', 'rally', 'win', 'approve', 'pass', 'gain', 'soar', 'rise', 'boost', 'record', 'breakthrough', 'success', 'launch', 'bullish', 'up', 'jumps', 'climbs'];
const BEARISH_WORDS = ['crash', 'fall', 'lose', 'reject', 'fail', 'drop', 'plunge', 'decline', 'crisis', 'risk', 'down', 'slump', 'bearish', 'cut', 'layoff', 'ban', 'collapse'];

function detectSentiment(text) {
  const lower = (text || '').toLowerCase();
  let bull = 0, bear = 0;
  for (const w of BULLISH_WORDS) { if (lower.includes(w)) bull++; }
  for (const w of BEARISH_WORDS) { if (lower.includes(w)) bear++; }
  if (bull > bear) return 'bullish';
  if (bear > bull) return 'bearish';
  return 'neutral';
}

module.exports = {
  rateLimit,
  _resetRateLimits,
  _rateLimits,
  getStreakMultiplier,
  getWeekStart,
  timeAgoStr,
  escHtmlStr,
  extractKeywords,
  classifyNarrative,
  NARRATIVE_KEYWORDS,
  detectSentiment,
  BULLISH_WORDS,
  BEARISH_WORDS,
};
