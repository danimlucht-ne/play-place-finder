/**
 * Writes `website/public/playplace-app-icon.png` (512px, same visual as Android / root `playPlaceIcon.svg`).
 * Source (first match):
 *   1. `playPlaceIcon.svg` at repo root
 *   2. `playPlaceIcon.jpg` at repo root
 *   3. `mipmap-xxxhdpi/ic_launcher_foreground.png` (after `node scripts/generateAppIcon.js`)
 *   4. `mipmap-xxxhdpi/ic_launcher.png`
 * For raster sources, composites on #05B4C6 when using transparent foreground; full SVG is flattened as-is.
 *
 * Run: npm run sync:web-brand-icon  (from `server/`)
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
      'syncWebsiteAppIcon: no icon source. Writing solid launcher background only; add playPlaceIcon.svg and re-run.',
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
