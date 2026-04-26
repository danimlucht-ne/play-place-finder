/**
 * Google Play feature graphic: 1024×500 PNG (required aspect for store listing).
 * Gradient background + centered full lockup (`playSpotterLogo` via sync pick order).
 *
 * Run: npm run generate:play-feature-graphic  (from `server/`)
 * Output: `website/public/store/google-play-feature-graphic-1024x500.png`
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const { pickFullLogoPath, REPO_ROOT } = require('./syncWebsiteAppIcon');

const W = 1024;
const H = 500;
const OUT_DIR = path.join(REPO_ROOT, 'website', 'public', 'store');
const OUT = path.join(OUT_DIR, 'google-play-feature-graphic-1024x500.png');

function gradientBasePng() {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#025a63"/>
      <stop offset="45%" style="stop-color:#05b4c6"/>
      <stop offset="100%" style="stop-color:#067d8a"/>
    </linearGradient>
    <radialGradient id="glow" cx="28%" cy="12%" r="65%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.22"/>
      <stop offset="55%" style="stop-color:#ffffff;stop-opacity:0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
</svg>`;
  return sharp(Buffer.from(svg)).png();
}

async function main() {
  const logoPath = pickFullLogoPath();
  if (!logoPath) {
    console.error('generatePlayStoreFeatureGraphic: no logo source found (add playSpotterLogo.png or similar).');
    process.exit(1);
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const baseBuf = await gradientBasePng().toBuffer();

  const logoBuf = await sharp(logoPath)
    .resize({
      width: 820,
      height: 340,
      fit: 'inside',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const meta = await sharp(logoBuf).metadata();
  const lw = meta.width || 400;
  const lh = meta.height || 120;
  const left = Math.round((W - lw) / 2);
  const top = Math.round((H - lh) / 2);

  await sharp(baseBuf)
    .composite([{ input: logoBuf, left, top }])
    .png()
    .toFile(OUT);

  console.log('generatePlayStoreFeatureGraphic: wrote', OUT, 'from', path.relative(REPO_ROOT, logoPath));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
