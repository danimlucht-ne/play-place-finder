# Legal documents (Markdown)

Source files for `/privacy`, `/terms`, and `/advertiser-agreement`:

| File | URL |
|------|-----|
| `privacy.md` | `/privacy` |
| `terms.md` | `/terms` |
| `advertiser-agreement.md` | `/advertiser-agreement` |

## Frontmatter

Each file starts with YAML between `---` lines:

- `title` — page `<h1>` and metadata title (suffix ` — PlayPlace Finder` is added in code).
- `description` — meta description for search and sharing.
- `lastUpdated` — shown under the title (free-form string).
- `version` — optional; shown next to the last-updated line when set.

## Updating copy

1. Edit the matching `.md` file in this folder, **or** open `/legal-admin.html` on your dev server or deployed site, compose there, and download the file into this folder (replacing the existing one).
2. Run `npm run build` and deploy (static export embeds content at build time).

Filenames and slugs must stay `privacy`, `terms`, and `advertiser-agreement` unless you also change `app/*/page.js` and `lib/readLegalDoc.js`.
