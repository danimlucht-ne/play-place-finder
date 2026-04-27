# Server scripts

Operational scripts in this folder are intended for admin or maintenance workflows.

## Region and seed maintenance

- `cleanupRegion.js`: Removes obvious non-play places in a region and optionally scrubs seeded photos.
- `resetSeedGeo.js`: Deletes Google-seeded places in a geo radius and can clear seed tracking for clean re-seed.
- `reseedRegion.js`: Re-runs seeding for an existing region.
- `runMerge.js`: Runs merge orchestration for duplicate/sub-venue cleanup.
- `mergeNearbyDuplicatePlaygrounds.js`: Detects and merges nearby duplicate entries.
- `mergeVenueGroupPlaygrounds.js`: Merges entries that belong to the same venue/group.
- `migrate.js`: Creates and updates MongoDB indexes used by the server.

## Data backfill and inspection

- `backfillPlaygroundTypes.js`: Backfills playground type values.
- `inspectPlaygroundTypes.js`: Reports playground type distribution/anomalies.
- `dailyTrendsReport.js`: Generates daily trend outputs for admin insight.
- `debugUsers.js`: Quick user inspection helper for debugging.

## Admin utilities

- `makeAdmin.js`: Grants admin role for a user (legacy helper).
- `setAdmin.js`: Sets admin state for a user account.

## Local test/dev helpers

- `testStickerService.js`: Manual script to test sticker service behavior.
- `applyAndroidBranding.js` / `branding/android-launcher-res/`: copies the Android res pack into Compose and rebuilds website + Play feature graphic PNGs. `generateAppIcon.js` only refreshes web/Play PNGs from the branding pack.

## Notes

- Scripts are not part of normal server startup.
- Run scripts from `server/` unless a script says otherwise.
- Review each script before production use; many are intentionally operational and powerful.
