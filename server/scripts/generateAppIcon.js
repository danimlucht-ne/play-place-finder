/**
 * The Android mipmap and drawable launcher assets now ship from
 * `branding/android-launcher-res/` (see `applyAndroidBranding.js`).
 *
 * This entrypoint only refreshes the website/Play store PNGs from that branding folder.
 */
const { main: syncWebsiteAppIcon } = require('./syncWebsiteAppIcon');
const { main: playGraphic } = require('./generatePlayStoreFeatureGraphic');

async function main() {
  await syncWebsiteAppIcon();
  await playGraphic();
  console.log('generateAppIcon: website + store art refreshed (Android res: run npm run apply:android-branding).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
