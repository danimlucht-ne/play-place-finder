# Advertiser Campaign Pipeline Requirements

## Goals

- Attract local advertisers with a short path from city interest to a campaign draft.
- Retain advertisers by making renewal low-friction and tied to prior campaign results.
- Report efficacy with metrics advertisers can trust: verified impressions, clicks, reach, frequency, geography, and CTA actions.
- Keep reporting cost-effective by storing raw ad events briefly and durable aggregate stats long term.

## Acquisition Requirements

- The public advertise experience must collect a self-serve lead instead of relying only on email.
- Lead capture must store business name, city/state, category, contact email, campaign goal, and optional budget.
- City availability must show phase, remaining slots, founding advertiser eligibility, and package pricing.
- Package selection must recommend a plan from advertiser goal, campaign timing, radius, and slot availability.
- Seeding-phase cities must capture demand without selling unavailable inventory.

## Submission Requirements

- Step progression must be server-authoritative and recoverable after abandoned sessions.
- Package, radius, duration, start date, and price must always be calculated server-side.
- Creative uploads must be first-party stored or copied before approval; mutable external creative URLs should not be trusted as final assets.
- Debug logs must not include advertiser creative text, contact information, or payment context.

## Tracking Requirements

- The server must validate every paid ad event against an active campaign, placement, city targeting record, and campaign date window.
- The server must ignore client-supplied user identity for ad tracking.
- Impression deduplication must use authenticated user identity when present or a privacy-safe visitor key otherwise.
- Metrics must include impressions, clicks, CTR, unique reach, and average frequency.
- Later event types should include CTA click, directions tap, phone/email tap, save/favorite after exposure, and coupon redemption.

## Reporting Requirements

- Raw ad events may expire for storage control, but daily campaign rollups must persist.
- Campaign detail analytics must prefer durable rollups when available and merge with raw events for days not yet rolled up.
- Advertiser-facing reports must include total performance, daily performance, placement, targeted city labels, radius, and creative preview.
- Weekly and end-of-campaign emails must include performance and a renewal CTA.

## Renewal Requirements

- Renewal must copy prior creative, package, targeting radius, duration, and discount context when still valid.
- Renewal response must include previous campaign performance summary for UI messaging.
- Renewal start date should default to the later of tomorrow or the previous campaign end date.
- Expiring campaign reminders must include prior performance and a direct renewal path.

## Admin Requirements

- Admin campaign tools must show campaign status, payment status, review flags, slot usage, and delivery health.
- Admin cancellation/refund policy must match advertiser-facing terms and emails.
- Discount redemptions must be finalized only after successful payment or a confirmed free submission.

## Testability Requirements

- Tracking validation must be unit-tested without live Mongo, Stripe, or external services.
- Rollup generation must be unit-tested for daily totals, unique reach, frequency, and idempotent upsert behavior.
- Renewal must be route-tested for ownership, copied fields, creative copy, and performance summary.
- Analytics route tests must cover rollup-derived reach and frequency.
