/**
 * Generates Android mipmap icon PNGs from the **launcher / icon-only** asset (not the wide wordmark).
 *
 * Usage: node scripts/generateAppIcon.js
 *
 * Source (first file that exists under `playground-app/playground-app/`):
 *   1. `playSpotterLauncher.png` — square or safe-crop raster for adaptive icon.
 *   2. `playPlaceIcon.svg` / `.jpg` — fallback.
 * Full lockup `playSpotterLogo` is intentionally excluded (use on web + Play feature graphic only).
 * Also runs `syncWebsiteAppIcon.js` → web PNGs + copies `ic_launcher_foreground.png` into `drawable/`.
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE_CANDIDATES = [
    path.join(__dirname, '..', '..', 'playSpotterLauncher.png'),
    path.join(__dirname, '..', '..', 'playPlaceIcon.svg'),
    path.join(__dirname, '..', '..', 'playPlaceIcon.jpg'),
];
const RES_DIR = path.join(__dirname, '..', '..', 'compose-app', 'composeApp', 'src', 'androidMain', 'res');

const sizes = [
    { folder: 'mipmap-mdpi', size: 48 },
    { folder: 'mipmap-hdpi', size: 72 },
    { folder: 'mipmap-xhdpi', size: 96 },
    { folder: 'mipmap-xxhdpi', size: 144 },
    { folder: 'mipmap-xxxhdpi', size: 192 },
];

async function main() {
    const sourcePath = SOURCE_CANDIDATES.find(fs.existsSync);
    if (!sourcePath) {
        console.error('Source image not found:', SOURCE_CANDIDATES.join(' or '));
        process.exit(1);
    }

    for (const { folder, size } of sizes) {
        const dir = path.join(RES_DIR, folder);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Standard icon
        await sharp(sourcePath)
            .resize(size, size, { fit: 'cover' })
            .png()
            .toFile(path.join(dir, 'ic_launcher.png'));

        // Round icon (same image, Android clips it to circle)
        await sharp(sourcePath)
            .resize(size, size, { fit: 'cover' })
            .png()
            .toFile(path.join(dir, 'ic_launcher_round.png'));

        console.log(`  ${folder}: ${size}x${size} ✓`);
    }

    // Also generate the adaptive icon foreground (108dp = 432px at xxxhdpi)
    const foregroundSizes = [
        { folder: 'mipmap-mdpi', size: 108 },
        { folder: 'mipmap-hdpi', size: 162 },
        { folder: 'mipmap-xhdpi', size: 216 },
        { folder: 'mipmap-xxhdpi', size: 324 },
        { folder: 'mipmap-xxxhdpi', size: 432 },
    ];

    for (const { folder, size } of foregroundSizes) {
        const dir = path.join(RES_DIR, folder);
        await sharp(sourcePath)
            .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .png()
            .toFile(path.join(dir, 'ic_launcher_foreground.png'));
    }

    const drawableDir = path.join(RES_DIR, 'drawable');
    const fgSrc = path.join(RES_DIR, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png');
    const fgDest = path.join(drawableDir, 'ic_launcher_foreground.png');
    if (fs.existsSync(fgSrc)) {
        fs.copyFileSync(fgSrc, fgDest);
        console.log('  drawable/ic_launcher_foreground.png ← mipmap-xxxhdpi ✓');
    }

    console.log('\nDone. Rebuild the app to see the new icon.');

    const { main: syncWebsiteAppIcon } = require('./syncWebsiteAppIcon');
    await syncWebsiteAppIcon();
}

main().catch(err => { console.error(err); process.exit(1); });
