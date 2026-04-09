# Future Enhancements

This document tracks planned features and improvements for the Playground Finder app.

## Platform Expansion
- [ ] **iOS Release (Apple):** Finalize testing, packaging, and deployment of the application for iOS devices to be published on the Apple App Store.

## Data & Seeding
- [ ] **City / Region Requests:** Add a "Request My City" feature where users can ask for their local area to be auto-loaded. Build an alert system to notify them (via push or email) the moment their city's data goes live.
- [ ] **Live Operating Hours:** Integrate Google Places Details API into `seed_database.js` to automatically fetch and store opening hours for indoor and private playgrounds.
- [ ] **Dynamic Global Option Lists:** Implement a backend "dictionary" collection to allow admins to approve new user-suggested amenities, equipment types, and atmosphere tags, making them globally available as chips and filters for all users.
- [ ] **School Schedule Awareness:** Refine the school playground warning with specific time-based logic if schedules can be sourced.

## User Experience
- [ ] **Dynamic Weather Alerts:** Move from mock weather warnings to real-time alerts using a live weather API (OpenWeatherMap/Apple WeatherKit) based on user coordinates.
- [ ] **Authentication:** Replace mock "user123" login with a production-ready authentication provider (e.g., Firebase Auth).
- [ ] **Photo Moderation UI:** Improve the "mark for removal" flow with specific reason prompts for users to provide more context to admins.

## Admin Tools
- [ ] **Advanced Moderation Dashboard:** Enhanced tools for reviewing suggested updates and reported issues.
- [ ] **Photo Removal Moderation:** Build the backend admin workflow to review, approve, and execute the deletion of incorrect or outdated photos flagged by the community.

## Monetization & Partnerships
- [ ] **Sponsorship & Advertisements:** Develop a system for local family-owned businesses to "sponsor" playgrounds, appearing in the "Nearby Partners" section.
- [ ] **Ad Management:** Create an admin interface to manage sponsor listings, track clicks, and set geographic radius for ad visibility.

## Gamification & User Rewards
- [ ] **Top Contributor Perks:** Offer an "Ad-Free" experience to users who reach a certain threshold of contribution points or verified Scout status to incentivize high-quality submissions.

## Business & Legal
- [ ] **Formalize Business Entity:** Form an LLC to protect personal assets from liability (e.g., if a user gets injured at a playground and blames the app).
- [ ] **Dedicated Finances:** Open a separate business checking account to track ad revenue and deduct expenses (servers, developer accounts) easily for Schedule C tax filing.
- [ ] **Professional Tax Advice:** Consult with a CPA once the app generates over $1,000 to manage deductions and ensure compliance.

## Technical Architecture
- **Database:** Stay on **MongoDB** (Atlas + sensible indexes) for the foreseeable future. Relational patterns (leaderboards, ads, contributions) are already modeled well enough in documents; revisit only if you hit a concrete scaling or query bottleneck, not preemptively.
