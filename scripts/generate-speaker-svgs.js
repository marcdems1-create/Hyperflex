const fs = require('fs');
const path = require('path');

const speakers = [
  { file: 'powell.jpg',   initials: 'JP', color: '#1e3a5f', accent: '#4d9fff' },
  { file: 'warsh.jpg',    initials: 'KW', color: '#1a3040', accent: '#7b9aff' },
  { file: 'jefferson.jpg',initials: 'PJ', color: '#1a2e40', accent: '#4d9fff' },
  { file: 'waller.jpg',   initials: 'CW', color: '#1e3550', accent: '#5dbbff' },
  { file: 'trump.jpg',    initials: 'DT', color: '#3a1e1e', accent: '#c9920d' },
  { file: 'brainard.jpg', initials: 'LB', color: '#1e2a3a', accent: '#a855f7' },
  { file: 'cook.jpg',     initials: 'LC', color: '#1e3530', accent: '#00e68a' },
];

const dir = path.join(__dirname, '../public/images/speakers');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

for (const s of speakers) {
  const outPath = path.join(dir, s.file.replace('.jpg', '.svg'));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${s.color};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:#0d0f1a;stop-opacity:1"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" style="stop-color:${s.accent};stop-opacity:0.15"/>
      <stop offset="100%" style="stop-color:${s.accent};stop-opacity:0"/>
    </radialGradient>
  </defs>
  <rect width="400" height="500" fill="url(#bg)"/>
  <rect width="400" height="500" fill="url(#glow)"/>
  <text x="200" y="290" font-family="system-ui,-apple-system,sans-serif" font-size="140" font-weight="700"
    fill="${s.accent}" opacity="0.9" text-anchor="middle" dominant-baseline="middle">${s.initials}</text>
</svg>`;
  fs.writeFileSync(outPath, svg);
  console.log('Created', s.file.replace('.jpg', '.svg'));
}
