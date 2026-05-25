'use strict';
const { createCanvas, loadImage } = require('canvas');

const W = 1200;
const H = 630;

function pColor(pct) {
  if (pct >= 65) return '#00e68a';
  if (pct <= 35) return '#ff4d6a';
  return '#4d9fff';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line + (line ? ' ' : '') + word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function generateForecastCard({ question, pct, volume, closes, imageUrl, topic }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0e0e15';
  ctx.fillRect(0, 0, W, H);

  // Background market image (blurred/dimmed) — attempt img-proxy path
  if (imageUrl) {
    try {
      const img = await loadImage(imageUrl);
      ctx.globalAlpha = 0.15;
      ctx.drawImage(img, 0, 0, W, H);
      ctx.globalAlpha = 1;
    } catch (_) {}
  }

  // Dark gradient overlay — left heavy, fades right
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0,   'rgba(14,14,21,0.98)');
  grad.addColorStop(0.55,'rgba(14,14,21,0.85)');
  grad.addColorStop(1,   'rgba(14,14,21,0.4)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Left accent bar
  const accentColor = pColor(pct);
  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, 6, H);

  // HYPERFLEX wordmark
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('HYPERFLEX', 48, 68);

  // Topic chip
  if (topic) {
    const chipText = topic.toUpperCase();
    ctx.font = '11px monospace';
    const chipW = ctx.measureText(chipText).width + 24;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, 48, 82, chipW, 26, 13);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(chipText, 60, 99);
  }

  // Question — wrap at 640px, max 3 lines
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px sans-serif';
  const lines = wrapText(ctx, question, 640);
  const lineH = 60;
  const textY = topic ? 168 : 148;
  lines.slice(0, 3).forEach((line, i) => {
    ctx.fillText(line, 48, textY + i * lineH);
  });

  // Probability block
  const probY = textY + Math.min(lines.length, 3) * lineH + 44;
  ctx.fillStyle = accentColor;
  ctx.font = 'bold 88px monospace';
  ctx.fillText(pct + '%', 48, probY);

  // YES label
  ctx.font = 'bold 18px monospace';
  ctx.fillText('YES', 48, probY + 26);

  // NO side (smaller, muted)
  const noPct = 100 - pct;
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.font = 'bold 44px monospace';
  const yesW = ctx.measureText(pct + '%').width;
  ctx.fillText(noPct + '%', 48 + yesW + 32, probY - 24);
  ctx.font = 'bold 14px monospace';
  ctx.fillText('NO', 48 + yesW + 32, probY + 26 - 24 + 20);

  // Progress bar
  const barY = probY + 52;
  const barW = 680;
  const barH_px = 6;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, 48, barY, barW, barH_px, 3);
  ctx.fill();
  ctx.fillStyle = accentColor;
  roundRect(ctx, 48, barY, Math.max(8, Math.round(barW * pct / 100)), barH_px, 3);
  ctx.fill();

  // Meta row
  const metaY = barY + 36;
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '15px monospace';
  const metaParts = [];
  if (volume) metaParts.push(volume + ' traded');
  if (closes) metaParts.push('Closes ' + closes);
  if (metaParts.length) ctx.fillText(metaParts.join('  ·  '), 48, metaY);

  // Bottom branding
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.font = '13px monospace';
  ctx.fillText('hyperflex.network', 48, H - 28);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.font = '12px monospace';
  const attr = 'Data: Polymarket';
  ctx.fillText(attr, W - ctx.measureText(attr).width - 40, H - 28);

  return canvas.toBuffer('image/png');
}

module.exports = { generateForecastCard };
