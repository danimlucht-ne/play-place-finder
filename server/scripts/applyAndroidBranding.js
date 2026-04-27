/**
 * Source of truth: `playground-app/branding/android-launcher-res/`
 * (export `app/src/main/res` from the Android full icon pack into that folder).
 *
 * - Copies into `compose-app/.../src/androidMain/res`.
 * - Rebuilds website + Play feature graphic PNGs.
 *
 * Run: npm run apply:android-branding  (from `server/`)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const BRAND = path.join(REPO_ROOT, 'branding', 'android-launcher-res');
const COMPOSE_RES = path.join(
  REPO_ROOT,
  'compose-app',
  'composeApp',
  'src',
  'androidMain',
  'res',
);

async function main() {
  if (!fs.existsSync(BRAND)) {
    console.error('Missing', BRAND, '— add branding/android-launcher-res from the icon pack.');
    process.exit(1);
  }
  fs.cpSync(BRAND, COMPOSE_RES, { recursive: true, force: true });
  console.log('applyAndroidBranding: copied to', COMPOSE_RES);

  const { main: syncWebsite } = require('./syncWebsiteAppIcon');
  await syncWebsite();
  const { main: playGraphic } = require('./generatePlayStoreFeatureGraphic');
  await playGraphic();
  console.log('applyAndroidBranding: done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
