/**
 * Generates Android mipmap icon PNGs from a source image.
 * 
 * Usage: node scripts/generateAppIcon.js
 * 
 * Reads playPlaceIcon.svg or playPlaceIcon.jpg from the project root and generates:
 * (Also runs syncWebsiteAppIcon.js when the source exists — PNG for web launcher parity.)
 *   - mipmap-mdpi (48x48)
 *   - mipmap-hdpi (72x72)
 *   - mipmap-xhdpi (96x96)
 *   - mipmap-xxhdpi (144x144)
 *   - mipmap-xxxhdpi (192x192)
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE_CANDIDATES = [
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

    console.log('\nDone. Rebuild the app to see the new icon.');

    const { main: syncWebsiteAppIcon } = require('./syncWebsiteAppIcon');
    await syncWebsiteAppIcon();
}

main().catch(err => { console.error(err); process.exit(1); });
