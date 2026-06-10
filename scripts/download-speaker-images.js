const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const images = {
  'powell.jpg':   'https://www.federalreserve.gov/aboutthefed/bios/board/images/powell.jpg',
  'jefferson.jpg':'https://www.federalreserve.gov/aboutthefed/bios/board/images/jefferson.jpg',
  'waller.jpg':   'https://www.federalreserve.gov/aboutthefed/bios/board/images/waller.jpg',
  'cook.jpg':     'https://www.federalreserve.gov/aboutthefed/bios/board/images/cook.jpg',
  'brainard.jpg': 'https://www.federalreserve.gov/aboutthefed/bios/board/images/brainard.jpg',
  'warsh.jpg':    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Kevin_Warsh_official_portrait.jpg/800px-Kevin_Warsh_official_portrait.jpg',
  'trump.jpg':    'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Donald_Trump_official_portrait_%282025%29.jpg/800px-Donald_Trump_official_portrait_%282025%29.jpg',
};

const dir = path.join(__dirname, '../public/images/speakers');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function download(filename, url, redirects = 0) {
  if (redirects > 5) { console.error('Too many redirects:', filename); return; }
  const lib = url.startsWith('https') ? https : http;
  const dest = path.join(dir, filename);
  const file = fs.createWriteStream(dest);
  lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Hyperflex/1.0)' } }, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      file.close();
      fs.unlinkSync(dest);
      return download(filename, res.headers.location, redirects + 1);
    }
    if (res.statusCode !== 200) {
      file.close();
      fs.unlinkSync(dest);
      console.error('HTTP', res.statusCode, filename, url);
      return;
    }
    res.pipe(file);
    file.on('finish', () => { file.close(); console.log('OK', filename); });
  }).on('error', err => {
    file.close();
    try { fs.unlinkSync(dest); } catch (_) {}
    console.error('ERR', filename, err.message);
  });
}

for (const [filename, url] of Object.entries(images)) {
  download(filename, url);
}
