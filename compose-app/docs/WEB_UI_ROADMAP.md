# Web UI roadmap (Play Spotter)

The **Compose** module (`composeApp`) currently targets **Android only** (`androidTarget` in `build.gradle.kts`). There is **no** `wasmJs` / `js` target yet, so the “live on the web” product today is best thought of as **two pieces**:

1. **Marketing / legal site** (e.g. Vercel at `www.play-spotter.com`) — static or lightweight Next.js pages.
2. **API** (`api.play-spotter.com`) — Node server the Android app already uses.

In-app browser links use **`MARKETING_SITE_BASE_URL`** (BuildConfig) and paths below.

---

## 1. Marketing site (near-term, required for links to work)

Add real routes on the **www** host (same origin as `MarketingLinks`):

| Path | Purpose |
|------|---------|
| `/advertise` | Pricing, placements, CTA to install app or mailto sales. |
| `/privacy` | Canonical privacy policy (Play Console / cross-link from app). |
| `/terms` | Canonical terms (optional mirror of in-app `AdultTermsScreen` copy). |

Until these exist, users get **404** from the new in-app buttons — create minimal placeholder pages first, then iterate on design.

**Optional:** `/support` with FAQ + contact form that posts to your API or a form backend.

---

## 2. “Full app on the web” (Compose Multiplatform Web) — larger effort

To run the **same** UI in the browser (maps, ads, Stripe, etc.), you’d roughly need:

### A. Gradle & targets

- Add **`wasmJs()`** (or **`js`**) target to `composeApp` with a **browser** entrypoint.
- Split **expect/actual** for anything Android-only:
  - **Maps:** `maps-compose` / Play Services are Android-only → web needs **Leaflet**, **MapLibre GL JS**, or Google Maps **JavaScript** API behind a `expect` map composable.
  - **Google Sign-In:** web uses **Firebase Auth** + **Google Identity Services** or redirect OAuth — new `actual` for auth.
  - **Stripe:** use **Stripe.js** / Payment Element on web, not `stripe-android` — new payment flow or shared “checkout session” pattern.
  - **Image crop (uCrop):** replace with a **KMP**-friendly picker/crop or web-only implementation.
  - **`OpenExternalUrl`:** wasm can use `window.open`.
  - **`AppConfig`:** wasm `actual` reading from build-time constants or `window.__ENV__` injected at deploy.

### B. Networking & CORS

- Ktor **CIO** client may differ on wasm; validate **`wasmJs` + Ktor** combo (or use **`Js`** engine for `js` target).
- Browser calls to **`https://api.…`** require **CORS** on the API (`Access-Control-Allow-Origin` for your www origin, credentials if using cookies — usually you use **Bearer tokens** from Firebase instead).

### C. Storage & auth session

- Replace or mirror **Android `AppSettings`** with **localStorage** / **IndexedDB** on web.
- Firebase **Auth** session persistence for web.

### D. Deploy

- **Wasm** output is static assets — host on **Vercel**, **Cloudflare Pages**, or S3+CloudFront.
- CI: **`./gradlew :composeApp:wasmJsBrowserProductionWebpack`** (exact task names depend on plugin version) → upload `dist`.

### E. Realistic phasing

| Phase | Outcome |
|-------|---------|
| **0** | Marketing routes `/advertise`, `/privacy`, `/terms` (current app links). |
| **1** | Read-only **web map** (browse playgrounds) + shared API. |
| **2** | Account login + favorites (no ads checkout). |
| **3** | Full advertiser funnel on web (maps + Stripe.js + file upload). |

Phases 1–3 are each **multi-week** depending on map and payment choices.

---

## 3. Configuration reference (Android, already wired)

| Key | Where | Purpose |
|-----|--------|---------|
| `SERVER_BASE_URL` | `local.properties` → `BuildConfig` | API host (`https://api.…`). |
| `MARKETING_SITE_BASE_URL` | `local.properties` → `BuildConfig` | **Www** host for `/advertise`, `/privacy`, `/terms`. Default `https://www.play-spotter.com`. |

Code: `org.community.playgroundfinder.util.MarketingLinks` builds full URLs from `AppConfig.marketingSiteBaseUrl`.

---

## 4. Suggested decision

- **Ship beta:** keep **Android** as the product app; **Vercel** hosts **marketing + legal** only.
- **Revisit wasm** when you need parity in-browser; treat it as a **separate project phase**, not a toggle.
