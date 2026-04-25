# Consumer Parity Spec

## Objective
Match app consumer functionality on web for discovery, search, map, place detail, engagement, and support.

## App Sources
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/home/HomeScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/map/MapScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/details/PlaygroundDetailScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/favorites/FavoritesScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/lists/PlayListsScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/events/NearbyEventsCalendarScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/add/AddEditPlaygroundScreen.kt`

## Web Routes to Deliver
- `/discover`
- `/sites`
- `/map`
- `/playground/[id]`
- `/favorites`
- `/lists`
- `/lists/[id]`
- `/events`
- `/contribute`
- `/my-submissions`
- `/support`

## Module Requirements
1. **Discover feed**
   - Mixed content sections, ad insertion cadence, parity wording for ad cards.
   - API: `/api/search/hybrid`, `/api/ads`, `/api/ads/events`.
2. **All Sites and filtered lists**
   - Filter chips, sort controls, pagination/infinite loading.
   - API: `/api/playgrounds`, `/api/regions/*`.
3. **Map**
   - Viewport-driven search, marker selection, list/map sync.
   - API: `/api/search/hybrid`, `/api/playgrounds/:id`.
4. **Place detail**
   - Photos, category metadata, report CTA, support CTA, directions handoff.
   - API: `/api/playgrounds/:id`, `/api/reports`, `/api/support/tickets`.
5. **Favorites and lists**
   - Full CRUD with optimistic updates and conflict fallback.
   - API via `userRoutes`.
6. **Events**
   - Event calendar/list parity and event spotlight labels/copy.
7. **Contribute and submissions**
   - Add/edit place form parity, photo upload handling, submission status history.
8. **User support**
   - Ticket creation UI for general and place-specific issues.

## Component Architecture
- Create domain folders under `website/app/components/consumer/`:
  - `discover/`, `sites/`, `map/`, `playground-detail/`, `favorites/`, `lists/`, `events/`, `contribute/`, `support/`
- Centralize API access under a typed client wrapper around `hubFetch`.
- Standardize loading/empty/error states for all consumer pages.

## Acceptance Criteria
- Every listed route is accessible and auth-guarded where required.
- Functional equivalence for each major mobile flow.
- No consumer-critical action requires mobile app fallback.
