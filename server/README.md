# Play Spotter Server

Node.js + Express backend for Play Spotter.

## Requirements

- Node.js (you have `node -v` working)
- MongoDB (Atlas or local)

## Setup

1. Install dependencies:

```bash
cd p:\AllDocuments\Programming\PlaygroundApp\playground-app\server
npm install
```

2. Create your environment file:

- Copy `.env.example` → `.env`
- Set at least:
  - `MONGODB_URI`
  - `MONGODB_DB` (optional, defaults to `PlaygroundApp`)

3. Create/update required indexes (safe to run multiple times):

```bash
npm run migrate
```

## Run

From the `server/` folder:

```bash
npm start
```

Or from `server/src/`:

```bash
node index.js
```

### PM2, log rotation, and admin log tail

- **Process file:** `ecosystem.config.cjs` — start with `pm2 start ecosystem.config.cjs` from this directory. Adjust `PM2_APP_NAME` in the shell if you run multiple APIs.
- **Rotation:** `pm2 install pm2-logrotate` on the host (size / retain / compress). PM2’s default logs live under `~/.pm2/logs/`.
- **Admin log tail:** With a Firebase **admin** token (`admin` custom claim), `GET /api/admin/server-logs?which=out|err&lines=400` returns the last lines of the configured log file as `text/plain`. The same handler is also mounted at **`GET /admin/server-logs`** for direct Node access. Prefer **`/api/admin/...`** if your reverse proxy only routes **`/api/*`** to the API (otherwise `/admin/*` can return 404 from the proxy). Set **`SERVER_LOG_OUT`** (and optionally **`SERVER_LOG_ERR`**) to the **absolute** paths of those PM2 log files. Paths must sit under **`SERVER_LOG_DIR`** if you set it, otherwise under `~/.pm2/logs`.
- **Access log:** In production, each request is logged with **morgan** (method, URL, status, time) and **`X-Request-Id`** (or reuse client `X-Request-Id`). Many JSON error bodies include **`requestId`** for support correlation.
- **Lifecycle cron chatter:** Set `LOG_LIFECYCLE_CRON=1` if you want `[lifecycle-cron] ...` lines when work runs (off by default).

## Scripts

- `npm start`: start the API server
- `npm test`: run unit tests
- `npm run test:watch`: run tests in watch mode
- `npm run migrate`: create MongoDB indexes/TTLs used by the app
- `npm run seed`: seed the database (if configured)
- `npm run cleanup:region -- <regionKey>`: delete obvious non-play places from a seeded region and re-scrub Google photos  
  - add `--dry-run` to preview changes
  - add `--no-scrub-photos` to skip photo cleanup
- `npm run reset:seed:geo -- --lat <lat> --lng <lng> --radius-miles <miles> [--regionKey <key>] [--dry-run]`: delete Google-seeded places in an area and optionally clear seed tracking so you can re-seed cleanly

For operational script details, see `server/scripts/README.md`.

## Gemini cost knobs

Runtime behavior for Google Gemini is controlled via environment variables (see `.env.example`). Highlights:

- **`GEMINI_MODEL_PRIMARY` / `GEMINI_MODEL_TEXT` / `GEMINI_MODEL_MULTIMODAL`** — route text-only vs image+text calls (defaults: `gemini-2.5-flash`).
- **`GEMINI_IMAGE_MAX_EDGE`** — downscale images before multimodal calls (default `768`).
- **`SKIP_GEMINI_DESCRIPTION`** — skip AI descriptions during seed enrichment (`1` / `true`).
- **`GEMINI_DISABLE_MULTIMODAL`** — emergency skip for `getGeminiSummary` (`1` / `true`).
- **`GEMINI_MAX_ATTEMPTS`** — retries for photo classification (production often uses `2`).

Structured logs: lines prefixed with `[gemini-cost]` and JSON payload (`callSite`, `model`, `ms`, etc.).

Design notes and full task list: `playground-app/.kiro/specs/ai-cost-reduction/`.

