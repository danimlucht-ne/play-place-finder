# PlayPlace Finder Website — play-place-finder.com

## Overview

A phased website for play-place-finder.com that starts as a marketing/admin landing page and evolves into a full web mirror of the mobile app.

## Phase 1: Landing Page + Advertiser Portal (Launch Priority)

### Pages

1. **Home / Landing Page**
   - Hero section: app name, tagline ("Find kid-friendly play places near you"), teal gradient background
   - App screenshots carousel (3-4 mobile screenshots)
   - Feature highlights: search by location, filter by amenities, community-verified, free to use
   - "Download on Google Play" button (link to Play Store listing)
   - "Coming soon to iOS" badge
   - Footer: Lucht Applications LLC, privacy policy link, terms link, contact email

2. **Advertise With Us**
   - Overview of ad packages (Prime Placement, Inline Listing, Event Spotlight)
   - Pricing tiers with beta founding partner callout
   - "Get Started" button → links to the app's advertiser flow (deep link or Play Store)
   - FAQ: how ads work, targeting radius, billing, cancellation
   - Contact form for businesses that want to learn more before downloading

3. **Privacy Policy**
   - Required for Play Store and App Store
   - Covers: data collected (location, email, name), how it's used, third parties (Firebase, Google Maps, Stripe, Gemini), data retention, deletion rights
   - Must be hosted at a public URL (play-place-finder.com/privacy)

4. **Terms of Service**
   - App usage terms, advertiser agreement terms
   - Hosted at play-place-finder.com/terms

5. **Advertiser Agreement**
   - The contract advertisers accept in-app
   - Hosted at play-place-finder.com/advertiser-agreement

### Tech Stack (Phase 1)

- Static site: Next.js (React) or plain HTML/CSS/JS — deployed to GCP Cloud Storage + Cloud CDN, or Vercel/Netlify (free tier)
- No backend needed for Phase 1 — it's just static pages
- DNS: point play-place-finder.com to the hosting provider
- SSL: automatic via hosting provider (Vercel/Netlify) or Let's Encrypt

### Deployment

- Option A (simplest): Vercel — connect GitHub repo, auto-deploys on push, free SSL, free tier handles plenty of traffic
- Option B: GCP Cloud Storage static hosting — you're already on GCP, keeps everything in one place
- DNS: add A record or CNAME in your domain registrar pointing to the hosting provider

---

## Phase 2: Admin Hub Web Portal

### Purpose
Allow admin functions from a browser without needing the Android app. Useful for managing the platform from a desktop.

### Pages
- Login (Firebase Auth web SDK)
- Admin Dashboard (mirrors AdminHubScreen)
- Campaign Management (mirrors AdminCampaignManagementScreen)
- Region Switcher (mirrors AdminRegionSwitcherScreen)
- Ad Review Queue
- Analytics Dashboard
- Discount Code Management

### Tech Stack (Phase 2)
- Next.js or React SPA
- Firebase Auth (web SDK) for login
- Calls the same server API as the mobile app
- Deployed alongside Phase 1 site

---

## Phase 3: Full Web App (Mirror of Mobile)

### Purpose
Let users search for play places, view details, add places, and manage favorites from a browser.

### Pages
- Home with search + location
- Search results with map view
- Place detail pages (SEO-friendly — each place gets a URL like /places/omaha-ne/fun-zone)
- User profile, favorites, lists
- Advertiser dashboard (create/manage ads from web)

### Tech Stack (Phase 3)
- Next.js with SSR for SEO (place pages need to be indexable by Google)
- Google Maps JavaScript API (replaces Android Maps SDK)
- Stripe.js for web payments (replaces Android PaymentSheet)
- Firebase Auth web SDK
- Same server API — no backend changes needed

### SEO Benefits
- Each seeded place becomes a crawlable page
- "playground near [city]" search traffic
- Structured data (schema.org/Place) for rich Google results

---

## DNS Setup

1. Log into your domain registrar (wherever you bought play-place-finder.com)
2. For Vercel: add CNAME record `www` → `cname.vercel-dns.com`, and configure the apex domain in Vercel
3. For Netlify: similar CNAME setup
4. For GCP: create a Cloud DNS zone, add A records pointing to your load balancer or storage bucket
5. SSL is automatic with Vercel/Netlify; for GCP you'd use a managed certificate

---

## Timeline Recommendation

- Phase 1: Build alongside Android beta launch (1-2 days of work for a static site)
- Phase 2: After Android is stable and you want desktop admin access (1-2 weeks)
- Phase 3: After iOS launch, when you want web traffic and SEO (2-4 weeks)
