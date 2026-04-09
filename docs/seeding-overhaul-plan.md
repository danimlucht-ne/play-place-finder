# Seeding Overhaul Plan

## Goal

Ship one integrated seeding overhaul that makes PlayPlace Finder:

- thorough on initial metro coverage
- cheaper to maintain over time
- less dependent on manual reseeding
- better at recovering from bad merge decisions
- easier to diagnose when places are missing

This plan is intentionally designed as one coordinated execution effort with one integrated QA cycle, rather than a series of user-visible partial rollouts.

## North star: seeding *is* the app

**Seeding and place quality** (discovery, coverage, merge correctness, and recovery) are the **highest product priority**. Search, map UX, and every downstream feature are only as good as the data.

**Sustaining new coverage:** Expanding to new cities and maintaining API quality is only affordable if **advertising** is a **reliable revenue line** next (simple campaign execution, accurate previews and analytics, competitive visible regional pricing). The **ads / regional pricing** workstream is the paired priority; seeding and ads are **sequenced** (solid ads to fund ongoing seeding), not competing product goals.

**Growth beyond the data + money loop:** **Word of mouth** and **external advertising for the app** need **community participation** to be real, not astroturfed. A **third** product track (after seeding + ads) is **contributor recognition and incentives** — proper credit, rewards, and feedback so people keep improving the map. That track is **not** the seeding doc’s scope; it is sequenced **after** the app is trustworthy (data) and sustainable (ads). See the project’s **ads / three-step strategy** in planning (Cursor: *Region user ad pricing* plan).

This work must be:

- **Intentional** — every Google call, merge decision, and admin action has a clear reason and a logged outcome; no “hope it works” heuristics without tests.
- **Cost effective** — bounded budgets, no repeated broad reseeds, pay once for good coverage and maintain with **local** refresh only (aligned with *Product principles* and *Data continuity*).
- **Nationally usable** — behavior must not be tuned only for one metro or one dataset. Rules, fixtures, and **merge** logic need to work across the US: dense cities, sprawling suburbs, and **large multi-building attractions** (museums, zoos, campuses) where the wrong merge breaks real users’ trust.

**Post-launch bar:** The system should **not** depend on **frequent** manual fixes, emergency reseeds, or ad hoc scripts after go-live. Gaps that remain should be **diagnosable** and **correctable in place** (viewport / tile / merge recovery) rather than “run the team at it weekly.”

### P0: campus / sub-venue / “zoo merge” class problems

A known pain point is **multi-attraction venues** (e.g. a zoo: parent + gates, sub-POIs) where **merge and suppression** are still wrong. This class is a **P0** for the overhaul, not a stretch goal:

- merge rules and **recovery** must handle parent/child and sub-POI **without** sticky wrong archives for nationally typical cases
- **regression tests** with real-world-shaped fixtures (including zoo/campus style scenarios) are required, not only happy-path small metros
- if one region “works” while another fails, the design is not yet national

## Why this is needed

The current code has a few structural problems:

- once a region is in `seeded_regions`, normal search becomes DB-only and stops discovering new Google places
- large metros are under-covered because discovery is too center-biased
- viewport reseed is additive, but not truly corrective
- archived merge losers are suppressed from future upserts, which makes bad merges sticky
- venue/sub-venue correctness depends heavily on heuristics and weak recovery paths
- the most critical seeding code has very low automated coverage

The result is an expensive pattern:

- incomplete first seeds
- repeated manual reseeding
- wasted Google Places spend
- wasted admin time

## Product principles

The implementation should follow these rules:

1. Spend more deliberately on a strong first seed instead of paying repeatedly for weak reseeds.
2. Track geographic coverage explicitly so the system knows what was seeded and what was not.
3. Refresh only locally where data is stale, sparse, or suspect.
4. Make merge outcomes reversible when new evidence appears.
5. Keep user search fast by returning DB results immediately, then doing bounded corrective discovery in the background.
6. **Ship with confidence for national use** — heuristics are backed by **repeatable** tests, merge edge cases (including **campus / sub-venue / “zoo”** patterns) are explicitly covered, and the team can **explain and fix** bad outcomes without a full re-seed.
7. **Sustainable after launch** — new behavior reduces ongoing operational load; avoid designs that need constant hand-tuning in production to stay accurate.

## Data continuity (non-negotiable)

- **Build on what exists:** Implementation must work **with** the current `seeded_regions` rows and `playgrounds` (and related merge/archive data) — not assume a **full database re-seed**. Paying to re-seed from scratch is **out of scope** as a requirement to ship.
- **New structures overlay:** Collections such as `seed_tiles` and `seed_run_logs` must be **backfillable** from existing state (e.g. derive initial tile coverage from current places + region bounds, mark stale/never-seeded incrementally) or **filled lazily** on first use. Avoid designs that *only* work on empty collections.
- **Tests vs production path:** It is fine to **fix and speed up tests** with small fixtures, isolated DBs, or destructive resets in CI. The **production-ready path** is **incremental** expansion, bounded Google calls, and stronger first seeds **for new** metros or **weak** areas only — not “delete and redo everything.”
- **Reconcile over replace:** Viewport and metro correction should **repair and extend** data where evidence says it is wrong or sparse, not require wiping a region to repopulate it.

## Scope for the integrated release

This release includes all of the following together:

- stronger initial metro seeding
- tile-based coverage tracking
- bounded discovery for already-seeded metros
- viewport reconcile and rebuild behavior
- merge recovery for archived losers
- diagnostics for missing places and merge outcomes
- integrated tests for the full seed and reconcile pipeline

## Execution order

The work should be built in this order, even though it is released together.

### 1. Foundation data model

Add the structures needed for the rest of the system.

New collections:

- `seed_tiles`
- `seed_run_logs`

Extend existing merge metadata in:

- `playgrounds`
- `archived_playgrounds`

Recommended optional collection:

- `merge_candidates`

### 2. Search profile and budgeting refactor

Refactor seed searches and budgets before changing orchestration behavior.

Changes:

- split search bundles by category
- add segmented budgets for center, grid, anchor, and campus discovery
- fix the undefined `maxAnchorPoints` bug in light refresh
- log request counts per run

### 3. Stronger first-time metro seed

Replace the coarse first-pass footprint with a broader and more durable one.

Changes:

- adaptive grid instead of fixed coarse center bias
- broader category-driven search bundles
- tile freshness recorded as part of seed completion
- run logs written for every seed

### 4. Coverage-aware search for already-seeded metros

Stop treating `seeded_regions` as a hard discovery cutoff.

New behavior:

- return DB results immediately
- inspect local tile freshness and density
- enqueue bounded Google discovery when local evidence says coverage is weak

### 5. Real viewport correction

Replace additive-only viewport reseed with explicit modes:

- `additive`
- `reconcile`
- `rebuild`

The visible area should be translated into tiles, and impacted places should be reconciled instead of merely reinserted.

### 6. Merge recovery

Stop treating archived rows as permanent truth.

Add:

- merge confidence
- merge evidence
- reopen eligibility
- re-canonicalization when a stronger parent appears

### 7. Diagnostics

Add admin-facing explanations for missing data and merge decisions.

New endpoints should answer:

- why is this place missing
- is it live, archived, filtered, or never discovered
- was the area never seeded or just stale
- why did a venue merge happen

### 8. Test hardening and release verification

Finish with integrated verification instead of scattered partial validation.

## Data model details

### `seed_tiles`

Purpose:

- track what geographic areas have been crawled
- distinguish fresh vs stale vs never-seeded areas
- drive local refresh decisions

Suggested shape:

```json
{
  "_id": "omaha-ne:tile-id",
  "regionKey": "omaha-ne",
  "tileKey": "tile-id",
  "bounds": {
    "southWestLat": 0,
    "southWestLng": 0,
    "northEastLat": 0,
    "northEastLng": 0
  },
  "center": {
    "lat": 0,
    "lng": 0
  },
  "status": "never_seeded | seeded | stale | failed",
  "seededAt": "date",
  "lastRefreshedAt": "date",
  "lastRunType": "initial_seed | light_refresh | viewport_additive | viewport_reconcile | viewport_rebuild",
  "placeCount": 0,
  "lastErrorMessage": null
}
```

### `seed_run_logs`

Purpose:

- explain what each seed or refresh run did
- estimate cost pressure
- improve debugging and ops confidence

Suggested shape:

```json
{
  "_id": "...",
  "runType": "initial_seed | light_refresh | viewport_additive | viewport_reconcile | viewport_rebuild",
  "regionKey": "omaha-ne",
  "requestedBy": "user_search | admin | system",
  "startedAt": "date",
  "completedAt": "date",
  "status": "running | complete | failed",
  "budget": {},
  "metrics": {
    "googleNearbyCalls": 0,
    "googleDetailsCalls": 0,
    "gridPoints": 0,
    "tileCount": 0,
    "candidatesScanned": 0,
    "candidatesInserted": 0,
    "archivedSuppressed": 0,
    "mergeCandidatesReopened": 0
  },
  "notes": [],
  "errorMessage": null
}
```

### Merge metadata extensions

Archived and merged rows should carry evidence and recovery state.

Suggested fields:

```json
{
  "archiveInfo": {
    "reason": "subvenue_absorbed | cross_region_address | proximity_dedup",
    "mergedIntoId": "abc",
    "archivedAt": "date",
    "archivedBy": "system",
    "mergeConfidence": 0.82,
    "reopenEligible": true,
    "reopenRules": {
      "reopenIfParentMissing": true,
      "reopenIfSeenAgainInViewportReconcile": true,
      "reopenIfStrongerThanParent": true
    }
  }
}
```

Live parent rows should also carry merge evidence:

```json
{
  "mergeInfo": {
    "mergedFrom": ["id1", "id2"],
    "mergeType": "subvenue_campus",
    "mergedAt": "date",
    "mergedBy": "system",
    "mergeConfidence": 0.76,
    "mergeEvidence": {
      "sameAddress": false,
      "distanceMeters": 83,
      "sharedBrandTokens": ["doorly", "zoo"],
      "sharedGoogleTypes": ["zoo"],
      "winnerReason": "primary_campus_anchor"
    }
  }
}
```

## Backend changes

### Existing files to update

- `server/src/services/seedOrchestratorService.js`
- `server/src/services/seedLightRefreshService.js`
- `server/src/services/seedJobQueueService.js`
- `server/src/services/seedSearchProfiles.js`
- `server/src/services/venueMergeService.js`
- `server/src/routes/seedRoutes.js`
- `server/src/routes/adminRoutes.js`
- `server/src/routes/adAdminRoutes.js`

### New services to create

- `server/src/services/seedTileService.js`
- `server/src/services/seedCoverageService.js`
- `server/src/services/mergeRecoveryService.js`
- `server/src/services/placeDiagnosticService.js`

## Runtime behavior

### Initial metro seed

Must:

- cover enough geographic area to avoid obvious metro holes
- store tile freshness and run metadata
- canonicalize after discovery
- leave the region in a measurable coverage state, not just a boolean seeded state

### User search in an existing metro

Must:

- return DB results immediately
- remain fast
- inspect local tile quality and freshness
- enqueue bounded corrective discovery only when local evidence says coverage is weak

### Admin viewport action

Must support:

- additive
- reconcile
- rebuild

And must:

- operate on visible-area tiles
- log what was done
- reopen archived merge losers when correction rules are met
- rerun canonicalization only on impacted venue sets

### Merge behavior

Must:

- stop treating `archived_playgrounds` as permanent suppression without recovery
- support reopen rules
- support stronger late-arriving parents
- record human-readable evidence for why a parent won

## Cost strategy

The system should be thorough without wasting Google Places spend.

That means:

- spend more deliberately on first-time metro coverage
- avoid repeated broad reseeds
- refresh only stale or sparse tiles
- keep hard per-run budgets for Nearby Search and Details
- avoid making every normal user search trigger a broad paid crawl

Recommended controls:

- hard caps on Nearby Search requests per run
- separate caps for center, grid, anchor, and campus passes
- tile freshness caching
- admin-gated reconcile and rebuild behavior
- request counters recorded in `seed_run_logs`

## Testing strategy

This release should be tested as one integrated pipeline.

### Required scenario groups

1. New metro seed
2. Existing metro with sparse area
3. Viewport additive vs reconcile vs rebuild
4. Campus and venue/sub-venue merge correctness (including **multi-attraction / “zoo class”** regression — must pass before the merge track is “done”)
5. Archived loser recovery
6. Diagnostics explanations

### Required test types

- integration tests for seed orchestration
- light refresh tests
- viewport reconcile tests
- merge recovery tests
- diagnostics tests
- regression fixtures for tricky metros and **national** campus / zoo / sub-venue cases (not a single city’s quirk)

## Acceptance criteria

The release is done when all of the following are true:

- **Merge / sub-venue:** campus and **multi-attraction** (e.g. zoo) scenarios are **demonstrably correct** with automated tests and do not require known hacks per region; **zoo-style merge failures** that exist today are **fixed or** have a documented, tested recovery path with diagnostics.
- large metros no longer depend on blunt manual reseeds to fill obvious gaps
- already-seeded metros can discover missing local places without full destructive reseeding
- viewport correction can actually repair visible problem areas
- bad venue/sub-venue merges are recoverable
- geographic coverage is measurable tile-by-tile
- admins can explain why a place is missing
- automated tests cover the new seed, reconcile, and merge-recovery behavior
- the design is **credible for national** rollout (more than a single test metro), and **ops** is not on the hook for constant post-launch firefighting for the same class of issues

## Recommended rollout safeguards

Even though this is one integrated release, use internal safeguards:

- feature flags for:
  - bounded discovery on existing metros
  - viewport reconcile mode
  - merge recovery reopening
- conservative default budgets on first deploy
- dry-run diagnostics before enabling more aggressive correction modes

## Estimated implementation effort

For one integrated execution effort:

- planning, schema, and orchestration refactor: 4-6 days
- coverage tracking, reconcile logic, and merge recovery: 6-10 days
- diagnostics, tests, fixtures, and cleanup: 4-6 days

Estimated total:

- about 3-4 focused weeks of work

## Recommended next step

Turn this document into a ticket-by-ticket build sheet with:

- task name
- file targets
- acceptance criteria
- dependencies
- verification notes

That should be the working execution checklist for implementation.

## Agent execution handoff (Cursor)

**Mode:** Code, tests, and non-markdown files require **Agent mode** in Cursor. **Plan mode** only edits documentation; it cannot apply server or app changes.

**First implementation slice (recommended “PR 1”):**

1. **Bug:** [`seedLightRefreshService.js`](playground-app/playground-app/server/src/services/seedLightRefreshService.js) — add `maxAnchorPoints` to `lightRefreshBudget()` (e.g. `SEED_LIGHT_REFRESH_MAX_ANCHOR_POINTS` default 200); `discoverNewPlaces` currently uses `budget.maxAnchorPoints` **undefined** on `.limit()`.
2. **Merge / P0 zoo:** [`venueMergeService.js`](playground-app/playground-app/server/src/services/venueMergeService.js) — treat **one canonical umbrella** as parent (e.g. name matches **Henry Doorly** + `zoo` + (`&` or `and`) + `aquarium`), boost in `scoreCampusClusterParent`, sort absorbed **campus** children **by distance from parent** (merge “outward”) in `absorbSubvenueGroup` for `subvenue_campus`. Export `scoreCampusClusterParent` for unit tests if needed.
3. **Tests:** extend [`venueMergeService.test.js`](playground-app/playground-app/server/src/__tests__/venueMergeService.test.js) — assert canonical parent wins over Lied-style exhibit; [`seedLightRefreshService.test.js`](playground-app/playground-app/server/src/__tests__/seedLightRefreshService.test.js) — assert `limit` receives a number.
4. **Foundation:** add `seed_tiles` + `seed_run_logs` collections (indexes in [`index.js`](playground-app/playground-app/server/src/index.js) `runStartupTasks`), minimal `seedTileService.js` / `seedRunLogService.js` under `server/src/services/` with `upsert` + backfill stub per *Data continuity*.

**Subsequent slices:** search profile / orchestration (§2–3), `seeded_regions` discovery (§4), viewport modes (§5), merge recovery (§6), diagnostics (§7), integration tests (§8).

**Product rule (Omaha zoo):** True parent is the **single** umbrella row (e.g. **Henry Doorly Zoo & Aquarium**); merge **outward** (distance order on sub-venues) until no more on-grounds exhibits remain attachable under [`shouldAttachAsCampusChild`](playground-app/playground-app/server/src/services/venueMergeService.js) / `zooExhibitLikeChild` rules.

**Decided — duplicate umbrella rows from Google:** If two (or more) rows are **umbrella-quality** for the same campus (e.g. two “main gate” style listings), **dedupe to a single parent** by taking the row with the **highest** `scoreCampusClusterParent` (same scoring path as merge parent selection). The other umbrella(s) are merged **into** that winner (or absorbed as sub-venues / archived per existing `absorbSubvenueGroup` rules). No manual pick per city.

### Batched product decisions (locked in)

1. **Tile grid (id scheme)**  
   - **Decided:** **lat/long string** keys (simple grid: bucket bounds from lat/lng, `tileKey` as a **string** derived from region + cell, documented in `seedTileService`).

2. **“Stale” — time + admin signal**  
   - **Decided — automatic:** a tile/region (per chosen granularity) is **stale** if last refresh/seed is older than **90 days** (`STALE_DAYS=90` or env equivalent).  
   - **Decided — manual:** **Admin Hub** must expose a **“Mark region stale”** (or “Request re-seed for this location”) for a **regionKey** (or `seeded_regions` row) so you can **force** refresh when **user activity** (new playgrounds, frequent adds) shows the place is “hotter” than the calendar says.  
   - **Impl note:** e.g. `seeded_regions.forceStale: true` / `staleReason` / `staleRequestedAt` cleared after a successful seed run, or a parallel `region_seed_flags` doc — pick one shape in implementation; behavior is “treat as stale for bounded discovery + queue.”

3. **Viewport `reconcile` vs `rebuild`**  
   - **Decided:** **You (sole admin) only**, behind **feature flags** (e.g. `SEED_VIEWPORT_RECONCILE_ENABLED`, `SEED_VIEWPORT_REBUILD_ENABLED` or a single `mode` flag). **No** public/self-serve trigger. Guarded in **admin** routes or Admin Hub.

4. **Merge recovery / unmerge — limits**  
   - **Decided:** **No extra** artificial limits (no per-month reopen caps). **Only admin** can unmerge or fix bad merges; with a **single** admin, operational limits are **unnecessary** — use **audit logs** and confirm dialogs only.

5. **Backfill vs delete**  
   - **Decided:** **Always** support **backfilling** `seed_tiles` (and run logs) from **existing** `playground` / `playgrounds` data. **Do not** delete a region’s playgrounds **en masse** to “re-run for duplicates” — Google may be **incomplete**, not reliably **wrong**; the model is **merge, enrich, and de-dupe in place**, not “wipe and replace.” (Exception: **dev/test** environments only, explicit destructive tools.)
