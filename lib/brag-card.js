'use strict';

// lib/brag-card.js — server-side brag card HTML generator.
// Each function returns a self-contained HTML page with OG meta tags
// so Twitter/X scrapes a beautiful preview card.

const DOMAIN = 'https://hyperflex.network';

// CSS shared across all brag cards
const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0e0e15;--surface:#111118;--border:rgba(255,255,255,.07);--ink:#f0f0f5;--ink2:rgba(240,240,245,.6);--muted:rgba(240,240,245,.32);--green:#00e68a;--red:#ff4d6a;--gold:#c9920d;--blue:#4d9fff;--mono:'JetBrains Mono',monospace;--sans:'Inter',sans-serif;}
html,body{background:var(--bg);color:var(--ink);min-height:100vh;font-family:var(--sans);-webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:center;padding:24px;}
.card{width:100%;max-width:520px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px 32px;position:relative;overflow:hidden;}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:16px 16px 0 0;}
.logo{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.18em;color:var(--muted);text-transform:uppercase;margin-bottom:20px;}
.kicker{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px;}
.q{font-family:var(--sans);font-size:18px;font-weight:700;line-height:1.4;color:var(--ink);margin-bottom:18px;}
.stat-row{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:18px;}
.stat{display:flex;flex-direction:column;gap:3px;}
.stat-label{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--muted);text-transform:uppercase;}
.stat-val{font-family:var(--mono);font-size:18px;font-weight:700;}
.footer{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--border);padding-top:16px;margin-top:4px;}
.footer-url{font-family:var(--mono);font-size:10px;color:var(--muted);}
.footer-cta{font-family:var(--mono);font-size:11px;font-weight:700;color:#000;background:var(--green);border-radius:5px;padding:8px 16px;text-decoration:none;transition:opacity .12s;}
.footer-cta:hover{opacity:.85;}
.nav{position:fixed;top:0;left:0;right:0;height:48px;display:flex;align-items:center;padding:0 20px;background:rgba(14,14,21,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--border);z-index:10;}
.nav-logo{font-family:var(--mono);font-size:15px;font-weight:900;color:#fff;text-decoration:none;letter-spacing:-.02em;}
.share-bar{margin-top:20px;display:flex;gap:10px;justify-content:center;}
.share-x{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:11px;font-weight:700;color:#000;background:var(--ink);border-radius:6px;padding:10px 20px;text-decoration:none;transition:opacity .12s;}
.share-x:hover{opacity:.85;}
.share-copy{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:11px;font-weight:700;color:var(--ink2);background:transparent;border:1px solid var(--border);border-radius:6px;padding:10px 20px;cursor:pointer;transition:border-color .12s;}
.share-copy:hover{border-color:rgba(255,255,255,.2);color:var(--ink);}
`;

const FONT_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function trunc(s, n) {
  return (s || '').length > n ? s.slice(0, n) + '…' : (s || '');
}

function fmtPnl(pnl) {
  const sign = pnl >= 0 ? '+' : '';
  return sign + '$' + Math.abs(Math.round(pnl)).toLocaleString();
}

// ── CALL CARD — "You called it early" ─────────────────────────────────────
function generateCallCard({ username, question, side, entryPrice, currentPrice, pnl, whaleCount, slug, shareUrl }) {
  const winning = pnl >= 0;
  const label = winning ? 'CALLED IT' : 'HOLDING CONVICTION';
  const accentColor = winning ? '#00e68a' : '#ff4d6a';
  const pnlStr = fmtPnl(pnl);
  const gain = currentPrice - entryPrice;
  const gainStr = (gain >= 0 ? '+' : '') + gain + 'pt';
  const marketUrl = slug ? `${DOMAIN}/market/${slug}` : DOMAIN;
  const pageUrl = shareUrl || `${DOMAIN}/brag/${encodeURIComponent(username)}/call/${slug}`;
  const tweetText = encodeURIComponent(`I said ${side} at ${entryPrice}¢ — market is now ${currentPrice}¢ (${gainStr}). ${pnlStr} unrealized.\n\n"${trunc(question, 80)}"\n\n${pageUrl}`);

  const ogTitle = `${label}: ${trunc(question, 60)}`;
  const ogDesc = `Called ${side} at ${entryPrice}¢ → now ${currentPrice}¢ (${pnlStr})`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ogTitle)} — HYPERFLEX</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${DOMAIN}/api/brag-image/call?q=${encodeURIComponent(trunc(question, 70))}&side=${side}&entry=${entryPrice}&cur=${currentPrice}&pnl=${Math.round(pnl)}&user=${encodeURIComponent(username)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDesc)}">
<meta name="twitter:image" content="${DOMAIN}/api/brag-image/call?q=${encodeURIComponent(trunc(question, 70))}&side=${side}&entry=${entryPrice}&cur=${currentPrice}&pnl=${Math.round(pnl)}&user=${encodeURIComponent(username)}">
<link rel="icon" href="/favicon.ico">
${FONT_LINK}
<style>
${BASE_CSS}
.card::before{background:${accentColor};}
.kicker{color:${accentColor};}
.stat-val.pnl{color:${accentColor};}
</style>
</head>
<body>
<nav><a href="/" class="nav-logo">HYPERFLEX</a></nav>
<div style="padding-top:64px;width:100%;max-width:560px;">
  <div class="card">
    <div class="logo">HYPERFLEX · @${esc(username)}</div>
    <div class="kicker">${esc(label)}</div>
    <div class="q">"${esc(trunc(question, 100))}"</div>
    <div class="stat-row">
      <div class="stat">
        <div class="stat-label">My call</div>
        <div class="stat-val">${esc(side)} at ${entryPrice}¢</div>
      </div>
      <div class="stat">
        <div class="stat-label">Market now</div>
        <div class="stat-val">${currentPrice}¢ <span style="font-size:.65em;opacity:.6">(${gainStr})</span></div>
      </div>
      <div class="stat">
        <div class="stat-label">Unrealized</div>
        <div class="stat-val pnl">${esc(pnlStr)}</div>
      </div>
      ${whaleCount > 0 ? `<div class="stat"><div class="stat-label">Whale agrees</div><div class="stat-val" style="color:#a855f7;">${whaleCount} whale${whaleCount > 1 ? 's' : ''}</div></div>` : ''}
    </div>
    <div class="footer">
      <div class="footer-url">hyperflex.network/@${esc(username)}</div>
      <a href="${esc(marketUrl)}" class="footer-cta">Trade this →</a>
    </div>
  </div>
  <div class="share-bar">
    <a class="share-x" href="https://x.com/intent/tweet?text=${tweetText}" target="_blank">
      <svg width="14" height="14" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.163 519.284Z"/></svg>
      Post on X
    </a>
    <button class="share-copy" onclick="navigator.clipboard.writeText(location.href).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy link'},1500)})">Copy link</button>
  </div>
</div>
</body>
</html>`;
}

// ── STREAK CARD — milestone celebration ───────────────────────────────────
function generateStreakCard({ username, streak, calibration }) {
  const pageUrl = `${DOMAIN}/brag/${encodeURIComponent(username)}/streak`;
  const tweetText = encodeURIComponent(`${streak} correct predictions in a row on Hyperflex.\nCalibration: ${calibration}/100.\nI see things others miss.\n\nhyperflex.network/quiz → find your type`);
  const ogTitle = `${streak} correct in a row — @${username}`;
  const ogDesc = `Calibration: ${calibration}/100. Streak: ${streak} predictions.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ogTitle)} — HYPERFLEX</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${DOMAIN}/api/brag-image/streak?user=${encodeURIComponent(username)}&streak=${streak}&cal=${calibration}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDesc)}">
<meta name="twitter:image" content="${DOMAIN}/api/brag-image/streak?user=${encodeURIComponent(username)}&streak=${streak}&cal=${calibration}">
<link rel="icon" href="/favicon.ico">
${FONT_LINK}
<style>
${BASE_CSS}
.card::before{background:var(--gold);}
.kicker{color:var(--gold);}
.streak-num{font-family:var(--mono);font-size:72px;font-weight:900;color:var(--gold);letter-spacing:-.04em;line-height:1;margin-bottom:4px;}
</style>
</head>
<body>
<nav><a href="/" class="nav-logo">HYPERFLEX</a></nav>
<div style="padding-top:64px;width:100%;max-width:520px;">
  <div class="card">
    <div class="logo">HYPERFLEX · @${esc(username)}</div>
    <div class="streak-num">${streak}</div>
    <div class="kicker">CORRECT IN A ROW</div>
    <div class="stat-row" style="margin-top:16px;">
      <div class="stat">
        <div class="stat-label">Calibration</div>
        <div class="stat-val" style="color:var(--gold);">${calibration}/100</div>
      </div>
      <div class="stat">
        <div class="stat-label">Streak</div>
        <div class="stat-val">${streak} picks</div>
      </div>
    </div>
    <div style="font-family:var(--mono);font-size:13px;color:var(--ink2);margin:8px 0 18px;font-style:italic;">I see things others miss.</div>
    <div class="footer">
      <div class="footer-url">hyperflex.network/@${esc(username)}</div>
      <a href="${DOMAIN}/quiz" class="footer-cta">Find your type →</a>
    </div>
  </div>
  <div class="share-bar">
    <a class="share-x" href="https://x.com/intent/tweet?text=${tweetText}" target="_blank">
      <svg width="14" height="14" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.163 519.284Z"/></svg>
      Post on X
    </a>
    <button class="share-copy" onclick="navigator.clipboard.writeText(location.href).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy link'},1500)})">Copy link</button>
  </div>
</div>
</body>
</html>`;
}

// ── ARCHETYPE CARD — quiz result ──────────────────────────────────────────
function generateArchetypeCard({ username, archetype, color, tagline }) {
  const accentColor = color || '#c9920d';
  const pageUrl = `${DOMAIN}/brag/${encodeURIComponent(username)}/archetype`;
  const tweetText = encodeURIComponent(`I'm ${archetype.toUpperCase()} on Hyperflex.\n"${tagline}"\n\nhyperflex.network/quiz → find your type`);
  const ogTitle = `I'm ${archetype.toUpperCase()} — @${username}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ogTitle)} — HYPERFLEX</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(tagline)}">
<meta property="og:image" content="${DOMAIN}/api/archetype-card/${encodeURIComponent(archetype.toLowerCase())}.svg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(tagline)}">
<meta name="twitter:image" content="${DOMAIN}/api/archetype-card/${encodeURIComponent(archetype.toLowerCase())}.svg">
<link rel="icon" href="/favicon.ico">
${FONT_LINK}
<style>
${BASE_CSS}
.card::before{background:${accentColor};}
.arch-name{font-family:var(--mono);font-size:52px;font-weight:900;color:${accentColor};letter-spacing:-.02em;line-height:1;margin-bottom:8px;}
.arch-tagline{font-family:var(--mono);font-size:13px;color:var(--ink2);font-style:italic;margin-bottom:20px;line-height:1.5;}
</style>
</head>
<body>
<nav><a href="/" class="nav-logo">HYPERFLEX</a></nav>
<div style="padding-top:64px;width:100%;max-width:520px;">
  <div class="card">
    <div class="logo">HYPERFLEX · PREDICTION ARCHETYPE</div>
    <div style="font-family:var(--mono);font-size:9px;color:${accentColor};letter-spacing:.14em;margin-bottom:8px;">@${esc(username)} IS</div>
    <div class="arch-name">THE ${esc(archetype.toUpperCase())}</div>
    <div class="arch-tagline">"${esc(tagline)}"</div>
    <div class="footer">
      <div class="footer-url">hyperflex.network/quiz</div>
      <a href="${DOMAIN}/quiz" class="footer-cta" style="background:${accentColor};">Find your type →</a>
    </div>
  </div>
  <div class="share-bar">
    <a class="share-x" href="https://x.com/intent/tweet?text=${tweetText}" target="_blank">
      <svg width="14" height="14" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.163 519.284Z"/></svg>
      Post on X
    </a>
    <button class="share-copy" onclick="navigator.clipboard.writeText(location.href).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy link'},1500)})">Copy link</button>
  </div>
</div>
</body>
</html>`;
}

// ── CHALLENGE WINNER CARD ─────────────────────────────────────────────────
function generateChallengeCard({ username, rank, score, correct, total, weekLabel }) {
  const isTop = rank <= 3;
  const medals = ['🥇', '🥈', '🥉'];
  const accentColor = rank === 1 ? '#c9920d' : rank === 2 ? '#a0a0b4' : '#cd7f32';
  const pageUrl = `${DOMAIN}/challenge`;
  const tweetText = encodeURIComponent(`Ranked #${rank} on the HYPERFLEX Weekly Challenge.\n${correct}/${total} markets called correctly. +${Math.round(score)} points.\n\nhyperflex.network/challenge`);
  const ogTitle = rank === 1 ? `#1 this week on HYPERFLEX Challenge` : `Top ${rank} — HYPERFLEX Weekly Challenge`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ogTitle)} — HYPERFLEX</title>
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${correct}/${total} markets · +${Math.round(score)} points · @${esc(username)}">
<meta property="og:image" content="${DOMAIN}/api/brag-image/challenge?rank=${rank}&user=${encodeURIComponent(username)}&score=${Math.round(score)}&correct=${correct}&total=${total}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico">
${FONT_LINK}
<style>
${BASE_CSS}
.card::before{background:${accentColor};}
.rank-num{font-family:var(--mono);font-size:64px;font-weight:900;color:${accentColor};letter-spacing:-.04em;line-height:1;}
.kicker{color:${accentColor};}
</style>
</head>
<body>
<nav><a href="/" class="nav-logo">HYPERFLEX</a></nav>
<div style="padding-top:64px;width:100%;max-width:520px;">
  <div class="card">
    <div class="logo">HYPERFLEX · WEEKLY CHALLENGE ${weekLabel ? '· ' + esc(weekLabel) : ''}</div>
    <div class="rank-num">#${rank}</div>
    <div class="kicker" style="margin-top:4px;">THIS WEEK${rank === 1 ? ' · WINNER' : ''}</div>
    <div class="stat-row" style="margin-top:18px;">
      <div class="stat">
        <div class="stat-label">Markets called</div>
        <div class="stat-val">${correct}/${total}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Points</div>
        <div class="stat-val" style="color:${accentColor};">+${Math.round(score)}</div>
      </div>
    </div>
    <div class="footer">
      <div class="footer-url">hyperflex.network/@${esc(username)}</div>
      <a href="${esc(pageUrl)}" class="footer-cta" style="background:${accentColor};">Join next week →</a>
    </div>
  </div>
  <div class="share-bar">
    <a class="share-x" href="https://x.com/intent/tweet?text=${tweetText}" target="_blank">
      <svg width="14" height="14" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.163 519.284Z"/></svg>
      Post on X
    </a>
    <button class="share-copy" onclick="navigator.clipboard.writeText(location.href).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy link'},1500)})">Copy link</button>
  </div>
</div>
</body>
</html>`;
}

// ── OG IMAGE SVGs ─────────────────────────────────────────────────────────
function generateCallSvg({ question, side, entryPrice, currentPrice, pnl, username }) {
  const winning = pnl >= 0;
  const accentColor = winning ? '#00e68a' : '#ff4d6a';
  const label = winning ? 'CALLED IT' : 'HOLDING CONVICTION';
  const pnlStr = fmtPnl(pnl);
  const q = trunc(question, 72);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111118"/>
      <stop offset="100%" stop-color="#07070e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="4" fill="${accentColor}"/>
  <circle cx="1050" cy="300" r="350" fill="${accentColor}" fill-opacity="0.04"/>
  <text x="72" y="130" font-family="monospace" font-size="13" fill="${accentColor}" fill-opacity="0.9" letter-spacing="4">${esc(label)} · HYPERFLEX</text>
  <text x="72" y="200" font-family="monospace" font-size="42" font-weight="900" fill="#f0f0f5">"${esc(trunc(q, 38))}</text>
  ${q.length > 38 ? `<text x="72" y="252" font-family="monospace" font-size="42" font-weight="900" fill="#f0f0f5">${esc(q.slice(38, 72))}"</text>` : `<text x="72" y="252" font-family="monospace" font-size="42" font-weight="900" fill="#f0f0f5">"</text>`}
  <rect x="72" y="300" width="1" height="1" fill="transparent"/>
  <text x="72" y="360" font-family="monospace" font-size="22" fill="rgba(240,240,245,.5)">Called ${esc(side)} at ${entryPrice}¢ → now ${currentPrice}¢</text>
  <text x="72" y="420" font-family="monospace" font-size="52" font-weight="900" fill="${accentColor}">${esc(pnlStr)}</text>
  <rect x="72" y="490" width="1056" height="1" fill="rgba(255,255,255,.08)"/>
  <text x="72" y="535" font-family="monospace" font-size="18" font-weight="900" fill="#fff" fill-opacity="0.9">HYPER<tspan fill="${accentColor}">FLEX</tspan></text>
  <text x="200" y="535" font-family="monospace" font-size="13" fill="#6b6880" letter-spacing="2"> · @${esc(username)}</text>
</svg>`;
}

function generateStreakSvg({ username, streak, calibration }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111118"/>
      <stop offset="100%" stop-color="#07070e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="4" fill="#c9920d"/>
  <circle cx="1050" cy="300" r="350" fill="#c9920d" fill-opacity="0.05"/>
  <text x="72" y="130" font-family="monospace" font-size="13" fill="#c9920d" fill-opacity="0.9" letter-spacing="4">STREAK · HYPERFLEX · @${esc(username)}</text>
  <text x="72" y="300" font-family="monospace" font-size="160" font-weight="900" fill="#c9920d">${streak}</text>
  <text x="72" y="380" font-family="monospace" font-size="36" font-weight="700" fill="rgba(240,240,245,.7)">CORRECT IN A ROW</text>
  <text x="72" y="440" font-family="monospace" font-size="22" fill="rgba(240,240,245,.4)">Calibration: ${calibration}/100</text>
  <rect x="72" y="490" width="1056" height="1" fill="rgba(255,255,255,.08)"/>
  <text x="72" y="535" font-family="monospace" font-size="18" font-weight="900" fill="#fff" fill-opacity="0.9">HYPER<tspan fill="#c9920d">FLEX</tspan></text>
  <text x="200" y="535" font-family="monospace" font-size="13" fill="#6b6880" letter-spacing="2"> · I see things others miss.</text>
</svg>`;
}

function generateChallengeSvg({ rank, username, score, correct, total }) {
  const accentColor = rank === 1 ? '#c9920d' : rank === 2 ? '#a0a0b4' : '#cd7f32';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111118"/>
      <stop offset="100%" stop-color="#07070e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="4" fill="${accentColor}"/>
  <text x="72" y="130" font-family="monospace" font-size="13" fill="${accentColor}" fill-opacity="0.9" letter-spacing="4">WEEKLY CHALLENGE · HYPERFLEX</text>
  <text x="72" y="290" font-family="monospace" font-size="140" font-weight="900" fill="${accentColor}">#${rank}</text>
  <text x="72" y="370" font-family="monospace" font-size="36" font-weight="700" fill="rgba(240,240,245,.7)">THIS WEEK${rank === 1 ? ' · WINNER' : ''}</text>
  <text x="72" y="430" font-family="monospace" font-size="24" fill="rgba(240,240,245,.5)">${correct}/${total} markets correct · +${Math.round(score)} points</text>
  <rect x="72" y="490" width="1056" height="1" fill="rgba(255,255,255,.08)"/>
  <text x="72" y="535" font-family="monospace" font-size="18" font-weight="900" fill="#fff" fill-opacity="0.9">HYPER<tspan fill="${accentColor}">FLEX</tspan></text>
  <text x="200" y="535" font-family="monospace" font-size="13" fill="#6b6880" letter-spacing="2"> · @${esc(username)}</text>
</svg>`;
}

module.exports = {
  generateCallCard,
  generateStreakCard,
  generateArchetypeCard,
  generateChallengeCard,
  generateCallSvg,
  generateStreakSvg,
  generateChallengeSvg,
  esc,
  trunc,
};
