# Play Spotter — website specification

> **Status:** Living document. **Phase 1** marketing + core flows are largely implemented in Next.js; details of the **home page** redesign are captured in [website/docs/landing-page-spec.md](website/docs/landing-page-spec.md). **App parity** work is tracked in [website/docs/full-parity/website-full-parity-implementation-spec.md](website/docs/full-parity/website-full-parity-implementation-spec.md).

## Overview

A phased site that started as a marketing and legal surface and grew into a **signed-in web app** (discover, map, lists, account, advertiser hub, admin) while keeping **public** landing and policy pages.

**Live branding:** *Play Spotter* (align with the Android app and public listings).  
Older references to *PlayPlace Finder* / *play-place-finder.com* in this file refer to the same product line; use the current domain and store URLs in production configs.

---

## Where things live in the repo

| Area | Path |
|------|------|
| Next.js `app` router pages | `website/app/` |
| Shared layout / nav / CSS | `website/app/components/`, `website/app/globals.css` |
| Static assets (images, favicon) | `website/public/` |
| Landing design decisions | [website/docs/landing-page-spec.md](website/docs/landing-page-spec.md) |
| Full app ↔ web parity matrix | [website/docs/full-parity/website-full-parity-implementation-spec.md](website/docs/full-parity/website-full-parity-implementation-spec.md) |

---

## Phase 1: Public marketing + trust (launch baseline)

**Implementation:** Next.js app (not a separate static-only repo). Revisit individual pages for “static vs SSR”; marketing routes may still export static where appropriate.

### 1. Home / landing page (`/`)

**Original 1.x spec:** Teal gradient hero, app **screenshot carousel** (3–4), feature bullets, Play download, iOS “coming soon,” footer.

**As implemented:** See [landing-page-spec.md](website/docs/landing-page-spec.md). The home page uses a **feature hero** (`hero--feature`: dark field + line-art graphic + left-aligned value prop) and a **photo strip** (stock scenes), not yet a device screenshot carousel. The **/advertise** page uses a **warmer, family-first** treatment (`advertise-hero`); the landing doc records aligning `/` with that *when* art and copy are ready.

**Checklist**

- [x] Clear hero: name, tagline, primary CTA
- [x] Secondary CTA to web app (`/discover`)
- [x] iOS “coming soon”
- [x] Feature section + bottom CTA + footer (privacy, terms, contact, advertise)
- [ ] Optional: **screenshot / device frame strip** (original Phase 1)
- [ ] Optional: **warm hero** variant matching `advertise-hero` (needs art or card-framed mock)

### 2. Advertise (`/advertise`)

- Packages overview (Prime, Inline, Event), FAQ, CTA to app / advertiser flow  
- [x] Implemented (see `website/app/advertise/page.js`)

### 3. Legal and policies

- [x] Privacy — `/privacy`  
- [x] Terms — `/terms`  
- [x] Advertiser agreement — `/advertiser-agreement`  
- [x] Delete account — `/delete-account` (per store / account policy needs)

### 4. Support contact surface

- [x] Support — `/support` (or equivalent; confirm copy matches app)

### 5. Tech and hosting

- **Framework:** Next.js in `website/` (not plain static HTML)  
- **API:** When pages need auth or data, they use the same backend as the mobile app (see server routes) — not “no backend” for Phase 1 in the strict 2023 sense, but **marketing pages** can still be prerendered.  
- **Env:** `NEXT_PUBLIC_*` for public API/Stripe keys where applicable  
- **Deploy:** Vercel / Netlify / GCP or equivalent; DNS + SSL per provider

---

## Phase 2: Admin and operator web tools

**Direction:** Browser access to admin workflows (moderation, campaigns, regions, etc.) with Firebase/JWT auth.

See parity matrix: [website-full-parity-implementation-spec.md](website/docs/full-parity/website-full-parity-implementation-spec.md) (Admin section).

- [ ] Complete coverage per matrix (ongoing)

---

## Phase 3: Consumer web app (mirror of mobile)

**Direction:** Search, place detail, favorites, lists, events, contribute — SEO-friendly where it matters.

See the same full-parity doc for route list and API mapping.

- [ ] Complete coverage per matrix (ongoing)

---

## DNS and domains

1. Point the active domain (e.g. `play-spotter.com` or your chosen host) at the deployment target (CNAME / A per provider).  
2. Enforce HTTPS (hosting default or managed certificate).  
3. Keep **privacy** and **terms** URLs stable for store listings and in-app WebViews.

---

## Timeline (rough)

Historical estimates from the first draft of this file; treat as order-of-magnitude only:

| Phase | Note |
|-------|------|
| 1 | Marketing + legal + advertise surface |
| 2 | Admin / ops web |
| 3 | Full consumer mirror + SEO for places |

---

## Changelog (this file)

- **2026-04:** Rewrote to match current product name, linked landing-page and full-parity docs, updated Phase 1 to reflect Next.js and the **feature hero** home. Original Phase 1 “static only / play-place-finder.com only” text retired.
