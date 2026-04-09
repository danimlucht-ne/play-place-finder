# Updating privacy, terms, and advertiser agreement

This project keeps the **canonical public legal text** for the marketing site in Markdown files. The Android app also embeds **plain-text copies** for in-app screens and store-style review. When you change policy language, plan to touch **both** places unless you intentionally keep them different.

## 1. Marketing website (source of truth for URLs)

**Directory (from this repo root):** `website/content/legal/`

| File | Public URL (after deploy) |
|------|---------------------------|
| `privacy.md` | `{MARKETING_SITE}/privacy` |
| `terms.md` | `{MARKETING_SITE}/terms` |
| `advertiser-agreement.md` | `{MARKETING_SITE}/advertiser-agreement` |

**Frontmatter** at the top of each file (between `---` lines):

- `title` — page heading and browser title (the site appends ` — PlayPlace Finder` in code).
- `description` — meta description for search and link previews.
- `lastUpdated` — shown on the page (use a clear date string).
- `version` — optional; shown next to the last-updated line when set.

**Body** is Markdown below the closing `---`. Use `##` for section headings to match the current layout.

**Ways to edit**

- Edit the `.md` files directly in `website/content/legal/`, or  
- Open `website/public/legal-admin.html` in a browser (local dev: e.g. `http://localhost:3000/legal-admin.html` while `npm run dev` is running; production: `https://<your-domain>/legal-admin.html`). Use it to draft, preview, and **download** a replacement `.md` file, then copy it into `website/content/legal/` (replacing the existing file).

**Ship the change**

```bash
cd website
npm test
npm run build
```

Deploy the static export as you do today. Legal pages are baked in at **build time**; there is no server-side save from the helper HTML page.

**Regression tests:** `website/tests/website-content.test.js` checks that key disclosure phrases still appear in the three Markdown files. If you remove or rephrase those ideas, update the tests in the same PR.

**Do not rename** the three filenames or slugs unless you also update `website/app/privacy/page.js`, `terms/page.js`, `advertiser-agreement/page.js`, and `website/lib/readLegalDoc.js`.

More detail: `website/content/legal/README.md`.

## 2. Android app (in-app copies)

The site and the app are **not** wired together automatically. After you finalize the Markdown (or the policy text you want users to see in-app), align the embedded strings if policy should match.

**Kotlin sources (paths from this repo root, under the `composeApp` module):**

- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/privacy/PrivacyScreen.kt` — privacy copy and in-app title (e.g. `Privacy Policy (v1.0)`); bump the version label if you change material terms.
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/auth/AdultTermsScreen.kt` — combined privacy + terms style copy for the adult gate flow; keep **Last Updated** (and any version label) consistent with your intent.
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/TermsScreen.kt` — advertiser agreement shown in the ad flow.

Each of these screens includes buttons that open the **website** via `MarketingLinks` (`compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/util/MarketingLinks.kt`). Confirm those URLs still point at the same host you deploy in step 1.

## 3. Checklist for a future update

1. Edit `privacy.md`, `terms.md`, and/or `advertiser-agreement.md` under `website/content/legal/` (and adjust `lastUpdated` / `version` in frontmatter).
2. Run `npm test` and `npm run build` in `website/`, then deploy.
3. Update `PrivacyScreen.kt`, `AdultTermsScreen.kt`, and/or `TermsScreen.kt` if in-app text must match.
4. If URLs or product name changed, review `MarketingLinks.kt` and Play Console / store listing fields that reference policy URLs.
