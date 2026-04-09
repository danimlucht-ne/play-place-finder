# TODO / Future Enhancements

## Admin Tools
- [ ] Admin region switcher — allow admins to override their location and browse playgrounds in any seeded city/state (e.g., dropdown of seeded_regions or manual lat/lng entry). Useful for QA and reviewing seed results without physically being there.

## Advertising & Monetization
- [ ] Work through advertising schemes — sponsored listings, featured placements, regional ad slots
- [ ] Advertiser payment options — Stripe integration, invoicing, subscription tiers for local businesses

## Authentication
- [ ] Apple Sign-In
- [ ] Facebook Login
- [ ] Biometric auth (Touch ID / Face ID) for returning users

## Legal / Compliance
- [ ] Admin-managed privacy policy & terms of service — versioned documents with a clean way to swap them out and re-prompt user acceptance on updates

## Data Freshness & Verification
- [ ] Monthly re-verification job for stale playgrounds — flag playgrounds not verified within X days, trigger community re-verification or AI re-scrub
- [ ] Geofence-triggered verification — push notification or on-screen prompt when a user is physically at a playground, asking them to confirm/update equipment, amenities, photos

## Community & Contributions
- [ ] Contributor leaderboard & monitoring — track high contributors, surface top contributors in admin dashboard
- [ ] Opt-in push notifications & background location for power contributors — offer as a reward/option for users who hit contribution thresholds

## Research / Long-term
- [ ] Premium safety overlay — investigate feasibility of integrating public sex offender registry data to show proximity to play places. Requires legal review (data privacy, liability, state-by-state regulations) before any development. Potential premium subscription feature.

## Platform & Distribution
- [ ] iOS build — get Compose Multiplatform iOS target compiling and tested on simulator/device
- [ ] Google Play Store submission — app listing, screenshots, privacy policy, review process
- [ ] Apple App Store submission — Apple Developer account, App Store Connect, review guidelines compliance
- [ ] Server deployment — move Node.js backend off localhost to cloud hosting (Cloud Run, Railway, Fly.io, etc.)
- [ ] MongoDB hosting — migrate to MongoDB Atlas or equivalent managed instance
- [ ] CI/CD pipeline — automated builds, tests, and deployments for both server and mobile apps

## UI / UX Improvements (Need Specs)
- [ ] Detail screen layout — put playground type, distance, and cost all on one line; move rating to top next to location type
- [ ] Parent review/rating slider (1-5 scale: 1 = "Get me out of here", 3 = "It's ok", 5 = "Coming back tomorrow") — show on detail screen, editable on edit screen
- [ ] Quick verification button — "Is this information accurate? Click here for a quick verification!" — lightweight alternative to full edit, includes rating/review
- [ ] Duplicate venue consolidation — merge sub-venues (e.g., "Trago Park Sprayground" + "Trago Park") into one entry, consolidating photos and info. Reactivate/improve the existing venue merge logic.
