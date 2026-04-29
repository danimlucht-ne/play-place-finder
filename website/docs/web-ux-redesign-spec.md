# Web UX redesign — recommended specification

**Status:** Recommended target state (not yet fully implemented).  
**Drivers:** Reduce “corporate” grid/table feel, align **navigation** and **ad previews** with the mobile app, and tighten **whitespace** on key surfaces.

**Related docs:** [WEBSITE_SPEC.md](../../WEBSITE_SPEC.md), [landing-page-spec.md](./landing-page-spec.md), [full-parity/website-full-parity-implementation-spec.md](./full-parity/website-full-parity-implementation-spec.md).

---

## 1. Problems to solve (evidence from product review)

| Area | Issue | Target outcome |
|------|--------|----------------|
| **Global nav** | “Lists” and “Favorites” appear as **separate** top-level items when signed in, duplicating the same mental model (“saved places”). | **One** primary entry for saved content. |
| **Consumer page shell** | Teal **hero band** under the nav is **text-only** and relatively short; no strong branded “feature” beyond color. | **Larger** hero / feature region (height + optional graphic or pattern) so the page doesn’t feel like a bare SaaS header. |
| **Inline ad preview** | “What your ad looks like” / in-app preview copy implied **image on top, copy below**; real **list / inline** inventory uses a **split (side-by-side)** layout in the app. | **Web and in-app** previews must show **image left, copy + CTA right** for non-prime placements (with responsive stack on narrow viewports). |
| **Density & structure** | Large white cards, heavy empty space, stock “admin” grids (tables on Map, sparse cards on Events/Admin). | Clear **hierarchy**, **tighter** vertical rhythm, and **section** boundaries without bare voids (incremental; not all in one PR). |

---

## 2. Information architecture — navigation

### 2.1 Combine Lists and Favorites

**Requirement**

- The main nav MUST NOT show both **Lists** and **Favorites** as separate links.
- **Recommended label:** `Lists & favorites` or `Saved` (choose one and use consistently).
- **Recommended URL model (pick one and document in code comments):**
  - **Option A (single page):** `/lists` contains two subsections or tabs: **Play lists** (named lists) and **Favorite places** (starred IDs). Optional query: `/lists?tab=favorites`.
  - **Option B:** Keep `/favorites` but **301/redirect** to `/lists?tab=favorites` and remove Favorites from the nav.

**Account / profile**

- Any “Open favorites” and “Open saved lists” style actions SHOULD collapse to **one** destination (same as above) with optional deep link to the correct tab.

**Acceptance**

- [ ] Signed-in header: at most **one** nav item covering lists + favorites.
- [ ] Bookmarks / shared links to `/favorites` still resolve (redirect OK).

---

## 3. Visual system — hero / “feature graphic”

### 3.1 Consumer shell (`ConsumerPageFrame` and equivalents)

**Requirement**

- Pages that use the shared teal band (Discover, Map, Events, Lists, Favorites, etc.) SHOULD use a **taller** hero than the current minimal strip.
- **Minimum recommended:** increase vertical padding and/or `min-height` so the band reads as a **page title region**, not a single-line strip.
- **Optional:** add a **subtle** background pattern, brand illustration, or device frame **inside** the band (not only flat teal). If a full illustration is not ready, use a **larger typographic block** (title + subtitle + optional eyebrow) and increased line-height.

**Tokens (suggested, adjust in `globals.css`)**

- Target **hero block height** on desktop: on the order of **160–220px** content area (excluding nav), subject to design pass.
- Keep **contrast** for white text on `--launcher-teal` (or documented variant).

**Acceptance**

- [ ] Hero height measurably larger than current `hero--compact` on at least Discover / Map / Events.
- [ ] No clipping of multi-line subtitles on common mobile widths.

---

## 4. Ad creative preview — layout parity (critical)

### 4.1 Product truth

- **Prime / home (`featured_home`):** **Portrait hero** — image prominent, then business name / copy / footer row (event vs ad + CTA). Stays **stacked** vertically in the product card.
- **Inline listing (`inline_listing`) and event-in-list paths:** In the app, the default **list ad** pattern is **split:** **image left**, **text + actions right** (side-by-side), not a single column “image on top then text.”

### 4.2 Website — Advertiser Hub

**Files:** `website/app/components/AdvertiserHubClient.js` (`AdPreviewCard`, `DraftPreviewCard`), `website/app/globals.css` (`.hub-ad-preview--inline`, image + content rules).

**Requirement**

- For **non-prime** previews, the DOM order and CSS MUST implement a **two-column** layout on desktop:
  - **Column 1:** image (fixed max width, `object-fit: cover`, aspect ratio ~4:5 in frame).
  - **Column 2:** headline, optional badge, body, CTA (outlined), full-width CTA only if the column is narrow.
- **Copy** under the card title must say **split / side-by-side** (not “image on top, then message”).
- **Mobile:** stack **image above copy** (one column) below a `max-width` breakpoint.

**Acceptance**

- [ ] Non-prime `AdPreviewCard` matches split layout in CSS (grid or flex, documented).
- [ ] Preview label text matches real behavior.

### 4.3 App — “How your ad looks” (My Campaigns)

**Files:** `compose-app/.../AdvertiserDashboardScreen.kt` (`HowYourAdLooksBlock`).

**Requirement**

- For `placement == "inline_listing"` (and non-prime event surfaces that use the same list card in production), the preview MUST use a **Row**: image + **Column** (text + CTA), with appropriate weights and `ContentScale.Crop` — **not** a full-width image **above** text.
- **Prime** remains a vertical/hero style consistent with the featured card.

**Acceptance**

- [ ] Expanded campaign detail preview for inline matches side-by-side layout on phone/tablet breakpoints used in the design.

---

## 5. Other pages (scaffold, incremental)

These are **follow-ups**; do not block the three pillars above.

| Page | Note |
|------|------|
| **Discover / sites** | Prefer **responsive grid** of cards over a single over-long column where possible; keep parity with list density rules from the app. |
| **Map** | “Coordinate feed” table is a dev scaffold; replace with map + list or clearer empty state per parity spec. |
| **Events** | Reduce empty **vertical** gap between hero and card; tighten empty state when no campaigns. |
| **Admin hubs** | Same spacing principles: less dead air above forms; don’t use giant cards for single lines of text. |

---

## 6. Non-goals (this spec)

- Full visual rebrand (new logo system, new color palette) — can be a separate “brand refresh” spec.
- Replacing Google Maps with another provider on web.
- All Phase 3 SEO routes — track in the full-parity spec.

---

## 7. Implementation checklist (for PRs)

Use small PRs in suggested order:

1. **Nav + routes:** Single “Lists & favorites” entry; merge or redirect favorites route; update Account copy.
2. **Hero shell:** `ConsumerPageFrame` + `globals.css` for larger consumer hero.
3. **Web ad preview:** `AdPreviewCard` + CSS for split inline layout + copy.
4. **App preview:** `HowYourAdLooksBlock` inline branch → side-by-side.
5. **Polish:** Discover grid / Events spacing as separate changes.

---

## 8. Sign-off

| Stakeholder | Role |
|-------------|------|
| Product / design | Confirms nav label, hero height band, and breakpoint for stacked vs split ad preview. |
| Engineering | Confirms app list ad reference implementation (e.g. `SponsoredListingCard` / `useSplitLayout`) is the source of visual truth for “inline.” |

When the checklist in §4 and §3 is complete for web + app preview, this document can be marked **Implemented** and linked from [WEBSITE_SPEC.md](../../WEBSITE_SPEC.md).
