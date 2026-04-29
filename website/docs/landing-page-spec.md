# Home / landing page — design spec and status

## Purpose

The route `/` (`website/app/page.js`) is the **marketing entry** for Play Spotter. It should feel **family-first and trustworthy**, not like enterprise SaaS or a generic “startup deck.”

This document records **where the redesign landed** in the repo, what’s still open, and how it connects to the broader [WEBSITE_SPEC.md](../../WEBSITE_SPEC.md) and [full-parity web spec](./full-parity/website-full-parity-implementation-spec.md).

---

## Source of truth (code)

| Piece | Location |
|--------|----------|
| Markup & section order | `website/app/page.js` |
| Hero, photo strip, features, CTA, footer styles | `website/app/globals.css` (search `hero--feature`, `photo-strip`, `features`, `home-cta-band`, `footer`) |
| Hero illustration | `website/public/feature-graphic-hero.png` |

---

## Version history (decision log)

### Spec v0 (original WEBSITE_SPEC — Phase 1)

- **Hero:** bright **teal gradient** (`globals.css` base class `.hero`)
- **Social proof:** **3–4 app screenshots** in a carousel (not built as carousel; see gaps below)
- **Body:** feature bullets, Play CTA, iOS “coming soon,” legal footer

### Redesign v1 (current default on `/`)

The home page was moved to a **feature-led hero** so it didn’t look like a flat marketing gradient alone:

- **Class:** `hero--feature` (overrides the default teal centered hero)
- **Look:** **dark “night” field** with a subtle **teal radial glow** and a **wide line-art + UI mock** image (`/feature-graphic-hero.png`), **left-aligned** copy on desktop, centered on small screens
- **Copy:** product-oriented (“Plan outings faster with trusted local data…”) — strong for clarity, can read **corporate** next to the rest of the site
- **Below the fold:** **photo strip** (Unsplash, credited), **six emoji feature cards**, **teal CTA band**, **footer** with app + legal links

**Warm reference elsewhere:** `/advertise` uses **`advertise-hero`** (cream / sky / soft gradients, dark serif-leaning headings) — that’s the **emotional direction** many stakeholders wanted for “less corporate,” but the **home** asset was authored for a **dark** backdrop, so we have not yet swapped the whole home hero to a light `advertise-hero`-style field without a **new illustration** or a **framed card** for the art.

### Proposed v2 (not mandatory; pick in design pass)

1. **Warm + light hero** (align with `advertise-hero`): new hero background + either **re-cut art** for light bg or art inside a **white rounded panel** with shadow
2. **Screenshot strip:** horizontal scroll of 3–4 real **phone frames** (match Phase 1 WEBSITE_SPEC) — can sit under hero or replace part of the photo strip
3. **Typography:** slightly rounder / larger body for hero lead; avoid all-caps eyebrow or shorten letter-spacing
4. **Feature grid:** optional illustration icons instead of emoji-only (accessibility + consistency)

---

## Brand and voice

- **Name:** Play Spotter (align with app store listing and in-app)
- **Voice:** direct, parent-to-parent, concrete (places, filters, photos), avoid empty “solutions” language where possible
- **Color:** same tokens as the app shell (`--teal`, `--mint-*`, `FormColors` parity) — see `:root` in `globals.css`

---

## Gaps vs `WEBSITE_SPEC.md` Phase 1 home

| Original Phase 1 item | Status |
|------------------------|--------|
| Teal gradient hero | **Superseded** on `/` by `hero--feature` (teal available as `.hero` for other pages) |
| 3–4 app screenshots | **Not implemented** (photo strip uses stock play scenes) |
| Feature highlights | **Done** (6 cards) |
| Google Play + iOS note | **Done** |
| Footer: company, privacy, terms, contact | **Done** (extended with discover/map/events links) |

---

## Acceptance (landing-only)

- [x] First paint identifies product name + value prop + primary CTA
- [x] Responsive: hero stacks; CTAs tappable; images lazy-loaded where appropriate
- [ ] (Optional) Screenshot or device-frame row for parity with original Phase 1 spec
- [ ] (Optional) Hero warmth aligned with `advertise-hero` or refreshed art for light background

---

## Related

- Product phases and history: [WEBSITE_SPEC.md](../../WEBSITE_SPEC.md)
- App feature parity and routes: [full-parity/website-full-parity-implementation-spec.md](./full-parity/website-full-parity-implementation-spec.md)
