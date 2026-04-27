/**
 * Syncs web brand assets under `website/public/` from:
 * 1) **`branding/android-launcher-res/drawable/*_1024.png`** (preferred) — composites foreground
 *    over background, then exports 512×512 — matches the shipped Android icon pack.
 * 2) Fallback: legacy `playSpotterLogo.png` / `playPlaceIcon.svg` / mipmap, etc.
 *
 * After changing `branding/android-launcher-res/`, run `npm run apply:android-branding` (from `server/`).
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
const BRANDING_RES = path.join(REPO_ROOT, 'branding', 'android-launcher-res');
const FG1024 = path.join(BRANDING_RES, 'drawable', 'ic_launcher_foreground_1024.png');
const BG1024 = path.join(BRANDING_RES, 'drawable', 'ic_launcher_background_1024.png');
/** Lucht company site `products.html` — must match composited `playplace-app-icon.png` (not a separate export). */
const LUCHT_PLAY_PLACE_FINDER = path.join(REPO_ROOT, '..', '..', 'lucht-applications', 'icons', 'play-place-finder.png');
/** Single brand plate for fallbacks; aligned with `values/colors.xml` ic_launcher_background (#00CED1). */
const BG = { r: 0, g: 206, b: 209 }; // #00CED1
const TRIM_THRESHOLD = 14;
const BRANDING_FOREGROUND_ZOOM = 3.2;

function hasBranding1024() {
  return fs.existsSync(FG1024) && fs.existsSync(BG1024);
}

/**
 * Pixels of the in-app / store icon (adaptive layers combined), at `size`×`size`.
 */
async function buildBrandingAppIconPngBuffer(size) {
  const cropSide = Math.max(64, Math.round(1024 / BRANDING_FOREGROUND_ZOOM));
  const left = Math.max(0, Math.round((1024 - cropSide) / 2));
  const top = Math.max(0, Math.round((1024 - cropSide) / 2));
  const fgBuf = await sharp(FG1024)
    .ensureAlpha()
    .extract({ left, top, width: cropSide, height: cropSide })
    .resize(1024, 1024, { fit: 'fill' })
    .png()
    .toBuffer();
  const body = await sharp(BG1024)
    .ensureAlpha()
    .composite([
      { input: fgBuf, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  return sharp(body).resize(size, size, { fit: 'fill' }).png().toBuffer();
}

function pickFullLogoPath() {
  const candidates = [
    path.join(REPO_ROOT, 'playSpotterLogo.png'),
    path.join(REPO_ROOT, 'playSpotterLogo.jpg'),
    path.join(REPO_ROOT, 'playSpotterLauncher.png'),
    path.join(REPO_ROOT, 'playPlaceIcon.svg'),
    path.join(REPO_ROOT, 'playPlaceIcon.jpg'),
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
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Exported for `generateAppIcon.js` — strips uniform border so art can scale up on brand plate. */
async function rasterAfterTrim(sourcePath) {
  try {
    const buf = await sharp(sourcePath).trim({ threshold: TRIM_THRESHOLD }).png().toBuffer();
    const m = await sharp(buf).metadata();
    if ((m.width || 0) < 12 || (m.height || 0) < 12) return sharp(sourcePath);
    return sharp(buf);
  } catch {
    return sharp(sourcePath);
  }
}

/** Full lockup: letterbox on brand teal (no crop of wordmark). */
async function writeFullLockupSquare(outPath, sourcePath, size) {
  const isVectorSource = path.extname(sourcePath).toLowerCase() === '.svg';
  if (isVectorSource) {
    const plate = await sharp({
      create: { width: size, height: size, channels: 3, background: BG },
    }).png().toBuffer();
    const inner = await sharp(sourcePath).resize(size, size, { fit: 'contain', background: BG }).png().toBuffer();
    await sharp(plate).composite([{ input: inner, gravity: 'centre' }]).png().toFile(outPath);
    return;
  }
  await sharp(sourcePath)
    .resize(size, size, { fit: 'contain', background: BG })
    .png()
    .toFile(outPath);
}

/**
 * Icon-only / favicon: trim flat border color, then scale art up on brand plate.
 */
async function writeLauncherStyleSquare(outPath, sourcePath, size) {
  const isVectorSource = path.extname(sourcePath).toLowerCase() === '.svg';
  const zoomSide = Math.ceil(size * 1.14);
  if (isVectorSource) {
    await sharp(sourcePath)
      .resize(zoomSide, zoomSide, { fit: 'inside', background: BG })
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .png()
      .toFile(outPath);
    return;
  }
  const body = await rasterAfterTrim(sourcePath);
  await body
    .resize(zoomSide, zoomSide, { fit: 'inside', background: BG })
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(outPath);
}

function copyPlayIconToLuchtMarketing() {
  try {
    if (!fs.existsSync(OUT_FULL)) return;
    const dir = path.dirname(LUCHT_PLAY_PLACE_FINDER);
    if (!fs.existsSync(dir)) return;
    fs.copyFileSync(OUT_FULL, LUCHT_PLAY_PLACE_FINDER);
    console.log(
      'syncWebsiteAppIcon: copied composited icon →',
      path.relative(REPO_ROOT, LUCHT_PLAY_PLACE_FINDER),
    );
  } catch (err) {
    console.warn('syncWebsiteAppIcon: Lucht copy skipped:', err.message);
  }
}

async function main() {
  const size = 512;

  if (hasBranding1024()) {
    const iconBuf = await buildBrandingAppIconPngBuffer(size);
    await fs.promises.writeFile(OUT_FULL, iconBuf);
    await fs.promises.writeFile(OUT_FAVICON, iconBuf);
    console.log(
      'syncWebsiteAppIcon: wrote',
      path.relative(REPO_ROOT, OUT_FULL),
      'and',
      path.relative(REPO_ROOT, OUT_FAVICON),
      'from',
      'branding/android-launcher-res (1024×1024 layers)',
    );
    copyPlayIconToLuchtMarketing();
    return;
  }

  const fullPath = pickFullLogoPath();
  if (!fullPath) {
    console.warn(
      'syncWebsiteAppIcon: no logo source. Writing solid launcher background only; add branding pack or playSpotterLogo.png.',
    );
    await sharp({
      create: { width: size, height: size, channels: 3, background: BG },
    })
      .png()
      .toFile(OUT_FULL);
    console.log('syncWebsiteAppIcon: wrote placeholder', OUT_FULL);
  } else {
    await writeFullLockupSquare(OUT_FULL, fullPath, size);
    console.log('syncWebsiteAppIcon: wrote', OUT_FULL, 'from', path.relative(REPO_ROOT, fullPath));
  }

  const favPath = pickFaviconSourcePath();
  if (!favPath) {
    console.warn('syncWebsiteAppIcon: no favicon source; skipping', OUT_FAVICON);
  } else {
    await writeLauncherStyleSquare(OUT_FAVICON, favPath, size);
    console.log('syncWebsiteAppIcon: wrote', OUT_FAVICON, 'from', path.relative(REPO_ROOT, favPath));
  }

  copyPlayIconToLuchtMarketing();
}

module.exports = {
  main,
  pickFullLogoPath,
  pickFaviconSourcePath,
  REPO_ROOT,
  OUT_FULL,
  rasterAfterTrim,
  hasBranding1024,
  buildBrandingAppIconPngBuffer,
  BRANDING_RES,
  FG1024,
  BG1024,
  BG,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
