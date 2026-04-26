# Postman: Potentially Deletable (or Consolidatable) Requests

This is a **non-destructive** review list. Nothing was removed from `PlaygroundFinder.postman_collection.json`.

How to read this:
- **Delete** means: likely safe to remove *if* you confirm nothing relies on the exact Postman request name/notes.
- **Consolidate** means: keep the endpoint, but you may want **one** request with variables instead of two near-identical ones.

## High confidence: exact duplicate `METHOD + URL` groups (keep one, or merge)

These are separate Postman requests that hit the **same** `METHOD` + path (excluding querystring). They are usually “dry run vs apply” or “variant A vs variant B”.

| Request (folder path) | Method + URL | Recommendation | Notes |
|---|---|---|---|
| `Admin/Playgrounds/Bulk Region Tag (dry run)` | `POST /admin/playgrounds/bulk-region-tag` | **Consolidate** | Keep one request; vary `dryRun` in JSON body. |
| `Admin/Playgrounds/Bulk Region Tag (apply)` | `POST /admin/playgrounds/bulk-region-tag` |  |  |
| `Admin/Playgrounds/Recategorize Types (dry run, seeded)` | `POST /admin/playgrounds/recategorize-types` | **Consolidate** | Keep one request; vary `dryRun` + `scope` in body/query. |
| `Admin/Playgrounds/Recategorize Types (apply, seeded)` | `POST /admin/playgrounds/recategorize-types` |  |  |
| `Admin/Regions/Backfill - Seed Cost Range` | `POST /admin/backfill-seed-cost` | **Consolidate** | Keep one request; use `?overwrite=true` for overwrite mode. |
| `Admin/Regions/Backfill Seed Cost (Overwrite All)` | `POST /admin/backfill-seed-cost?overwrite=true` |  |  |
| `Admin/Regions/Expand Region(s)` | `POST /admin/expand-region` | **Consolidate** | Keep one request; vary body (with vs without `regionKeys`). |
| `Admin/Regions/Expand All Regions` | `POST /admin/expand-region` |  |  |
| `Ads/Admin/POST review - approve` | `POST /admin/ads/submissions/{{submissionId}}/review` | **Consolidate** | One request; switch `decision` in body (`approve` vs `reject`). |
| `Ads/Admin/POST review - reject` | `POST /admin/ads/submissions/{{submissionId}}/review` |  |  |

## Medium confidence: alias / duplicate *server* paths not represented as separate Postman calls

These are not duplicates *inside* the collection today, but they are common sources of “two ways to do the same thing” confusion on the server.

| Server alias | Why it is “delete-prone” in docs | Suggested Postman policy |
|---|---|---|
| `GET /api/admin/server-logs` vs `GET /admin/server-logs` | Admin log tailing exists on **both** prefixes (proxy compatibility) | Keep **one** Postman request (whichever matches your production routing) and add a short note for the other path. |
| `GET /api/leaderboard` vs `GET /api/contributors/leaderboard` | `userRoutes` includes legacy/compat patterns | If your clients only use one, mark the other request (if you add it) as **legacy**. |
| `POST /api/ads/payments/webhook` mounted twice in `index.js` | Can create an accidental extra path segment (`/webhook/webhook`) | Do **not** add Postman calls for the accidental path; keep a single canonical webhook call. |

## Low confidence: “nice to have” cleanups (optional)

- **Collection variables**: you currently use placeholders like `PLAYGROUND_ID_HERE` in URLs; that’s fine, but adding `{{playgroundId}}` consistently can reduce “almost duplicate” requests.
- **Brand mojibake cleanups**: if you ever see `â€”` in older exports, re-save the collection as UTF-8 (no BOM). The current checked-in file should be cleaned.

## Endpoints *not* in this Postman collection (not “deletes”; potential adds)

The API surface in `server/src/index.js` is larger than this collection (by design). Common missing public/protected areas include (examples):
- `/api/reports/*`
- many `/api/ads/*` serving + submissions + campaign/payment routes beyond what’s already represented
- `/api/upload-image`

If you want the collection to be a complete map of the API, consider a follow-up pass to add **missing** routes, separate from deletions.
