/**
 * Writes website/public/playplace-app-icon.png (same treatment as the Android adaptive icon).
 * Source (first match wins):
 *   1. playPlaceIcon.svg at repo root
 *   2. playPlaceIcon.jpg at repo root (same as generateAppIcon.js)
 *   3. mipmap-xxxhdpi/ic_launcher_foreground.png (after npm run generate flow from server)
 *   4. mipmap-xxxhdpi/ic_launcher.png
 * Composites on #05B4C6 (ic_launcher_background) with safe-zone sizing (~64/108) when using a raw photo or launcher foreground.
 *
 * Run: npm run sync:web-brand-icon  (from server/)
 *
 * If the exported PNG shows thin white “corner bracket” marks, those come from the source
 * raster (e.g. Android Studio / design-tool safe-zone overlays), not from this script — use a clean export.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const REPO_ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(REPO_ROOT, 'website', 'public', 'playplace-app-icon.png');
const RES = path.join(REPO_ROOT, 'compose-app', 'composeApp', 'src', 'androidMain', 'res', 'mipmap-xxxhdpi');
const BG = { r: 5, g: 180, b: 198 }; // #05B4C6

function pickForegroundPath() {
  const candidates = [
    path.join(REPO_ROOT, 'playPlaceIcon.svg'),
    path.join(REPO_ROOT, 'playPlaceIcon.jpg'),
    path.join(RES, 'ic_launcher_foreground.png'),
    path.join(RES, 'ic_launcher.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const size = 512;
  const inner = Math.round((size * 64) / 108);
  const sourcePath = pickForegroundPath();

  if (!sourcePath) {
    console.warn(
      'syncWebsiteAppIcon: no icon source (playPlaceIcon.svg, playPlaceIcon.jpg, or mipmap-xxxhdpi PNGs). Writing solid launcher background only; add a source and re-run.',
    );
    await sharp({
      create: { width: size, height: size, channels: 3, background: BG },
    })
      .png()
      .toFile(OUT);
    console.log('syncWebsiteAppIcon: wrote placeholder', OUT);
    return;
  }

  const isVectorSource = path.extname(sourcePath).toLowerCase() === '.svg';

  if (isVectorSource) {
    await sharp(sourcePath).resize(size, size).png().toFile(OUT);
  } else {
    const fg = await sharp(sourcePath)
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background: BG,
      },
    })
      .composite([{ input: fg, gravity: 'center' }])
      .png()
      .toFile(OUT);
  }

  console.log('syncWebsiteAppIcon: wrote', OUT, 'from', path.relative(REPO_ROOT, sourcePath));
}

module.exports = { main };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
