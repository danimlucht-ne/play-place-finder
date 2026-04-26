/**
 * Syncs web brand assets under `website/public/`:
 * - `playplace-app-icon.png` — **full** lockup (prefers `playSpotterLogo.png` / `.jpg`), 512×512 letterboxed on #05B4C6.
 * - `play-spotter-favicon.png` — **launcher / icon-only** (prefers `playSpotterLauncher.png`) for `<link rel="icon">`.
 *
 * Android launcher icons are **not** written here; use `generateAppIcon.js`.
 *
 * Run: npm run sync:web-brand-icon  (from `server/`)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const REPO_ROOT = path.join(__dirname, '..', '..');
const OUT_FULL = path.join(REPO_ROOT, 'website', 'public', 'playplace-app-icon.png');
const OUT_FAVICON = path.join(REPO_ROOT, 'website', 'public', 'play-spotter-favicon.png');
const RES = path.join(REPO_ROOT, 'compose-app', 'composeApp', 'src', 'androidMain', 'res', 'mipmap-xxxhdpi');
const BG = { r: 5, g: 180, b: 198 }; // #05B4C6

function pickFullLogoPath() {
  const candidates = [
    path.join(REPO_ROOT, 'playSpotterLogo.png'),
    path.join(REPO_ROOT, 'playSpotterLogo.jpg'),
    path.join(REPO_ROOT, 'playSpotterLauncher.png'),
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

function pickFaviconSourcePath() {
  const candidates = [
    path.join(REPO_ROOT, 'playSpotterLauncher.png'),
    path.join(REPO_ROOT, 'playPlaceIcon.svg'),
    path.join(REPO_ROOT, 'playPlaceIcon.jpg'),
    path.join(REPO_ROOT, 'playSpotterLogo.png'),
    path.join(RES, 'ic_launcher.png'),
    path.join(RES, 'ic_launcher_foreground.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function writeSquarePng(outPath, sourcePath, size) {
  const isVectorSource = path.extname(sourcePath).toLowerCase() === '.svg';
  if (isVectorSource) {
    await sharp(sourcePath).resize(size, size).png().toFile(outPath);
  } else {
    await sharp(sourcePath)
      .resize(size, size, { fit: 'contain', background: BG })
      .png()
      .toFile(outPath);
  }
}

async function main() {
  const size = 512;
  const fullPath = pickFullLogoPath();

  if (!fullPath) {
    console.warn(
      'syncWebsiteAppIcon: no logo source. Writing solid launcher background only; add playSpotterLogo.png or playPlaceIcon.svg and re-run.',
    );
    await sharp({
      create: { width: size, height: size, channels: 3, background: BG },
    })
      .png()
      .toFile(OUT_FULL);
    console.log('syncWebsiteAppIcon: wrote placeholder', OUT_FULL);
  } else {
    await writeSquarePng(OUT_FULL, fullPath, size);
    console.log('syncWebsiteAppIcon: wrote', OUT_FULL, 'from', path.relative(REPO_ROOT, fullPath));
  }

  const favPath = pickFaviconSourcePath();
  if (!favPath) {
    console.warn('syncWebsiteAppIcon: no favicon source; skipping', OUT_FAVICON);
  } else {
    await writeSquarePng(OUT_FAVICON, favPath, size);
    console.log('syncWebsiteAppIcon: wrote', OUT_FAVICON, 'from', path.relative(REPO_ROOT, favPath));
  }
}

module.exports = { main, pickFullLogoPath, pickFaviconSourcePath, REPO_ROOT, OUT_FULL };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
