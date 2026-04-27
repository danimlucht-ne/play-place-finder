/**
 * Google Play feature graphic: 1024×500 PNG.
 * Flat brand teal (matches adaptive background) + centered composite icon.
 *
 * Run: npm run generate:play-feature-graphic  (from `server/`)
 * Output: `website/public/store/google-play-feature-graphic-1024x500.png`
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const { pickFullLogoPath, REPO_ROOT, rasterAfterTrim, hasBranding1024, FG1024, BG1024 } = require(
  './syncWebsiteAppIcon',
);

const W = 1024;
const H = 500;
const BRAND = '#00ced1';
const OUT_DIR = path.join(REPO_ROOT, 'website', 'public', 'store');
const OUT = path.join(OUT_DIR, 'google-play-feature-graphic-1024x500.png');

function flatBrandBasePng() {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${BRAND}"/>
</svg>`;
  return sharp(Buffer.from(svg)).png();
}

async function openLogo(logoPath) {
  if (path.extname(logoPath).toLowerCase() === '.svg') return sharp(logoPath);
  return rasterAfterTrim(logoPath);
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const baseBuf = await flatBrandBasePng().toBuffer();
  let zoomed;
  let label;

  if (hasBranding1024()) {
    const body = await sharp(BG1024)
      .ensureAlpha()
      .composite([{ input: await sharp(FG1024).ensureAlpha().png().toBuffer(), left: 0, top: 0 }])
      .png()
      .toBuffer();
    zoomed = await sharp(body)
      .resize(940, 410, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    label = 'branding/android-launcher-res (1024×1024 layers)';
  } else {
    const logoPath = pickFullLogoPath();
    if (!logoPath) {
      console.error('generatePlayStoreFeatureGraphic: add branding pack or playSpotterLogo.png.');
      process.exit(1);
    }
    const logoSharp = await openLogo(logoPath);
    zoomed = await logoSharp
      .resize({
        width: 940,
        height: 410,
        fit: 'inside',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    label = path.relative(REPO_ROOT, logoPath);
  }

  const meta = await sharp(zoomed).metadata();
  const lw = meta.width || 400;
  const lh = meta.height || 120;
  const left = Math.round((W - lw) / 2);
  const top = Math.round((H - lh) / 2);

  await sharp(baseBuf)
    .composite([{ input: zoomed, left, top }])
    .png()
    .toFile(OUT);

  console.log('generatePlayStoreFeatureGraphic: wrote', OUT, 'from', label);
}

module.exports = { main };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
