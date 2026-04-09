# Testing Baseline (Server + Frontend)

This project now has a shared baseline intended to support Android today and web/iOS migration next.

## Current test layers

- `server` (Node/Jest)
  - Unit tests in `server/src/__tests__` (excluding `integration/`)
  - **Integration tests** in `server/src/__tests__/integration/` — real Express `app` + MongoDB (`MONGODB_URI`); CI runs Mongo as a service container
  - Coverage enabled via `server/jest.config.js`
  - CI command: `npm run test:ci`
- `compose-app` (Kotlin Multiplatform)
  - Shared logic tests in `composeApp/src/commonTest`
  - Android JVM unit tests via Gradle `:composeApp:testDebugUnitTest`
  - Shared source compile gate via `:composeApp:compileKotlinMetadata`

## Run locally

- Server:
  - `cd server`
  - `npm test` — **unit tests only** (no Mongo required; integration folder skipped)
  - `npm run test:all` — unit + integration (needs MongoDB on `MONGODB_URI`, e.g. `mongodb://127.0.0.1:27017/playground_test`)
  - `npm run test:unit` — same as `npm test`
  - `npm run test:integration` — integration tests only
  - `npm run test:coverage`
- Frontend shared tests:
  - `cd compose-app`
  - `./gradlew :composeApp:testDebugUnitTest` (Windows: `.\gradlew.bat ...`)
  - `./gradlew :composeApp:compileKotlinMetadata`

## CI expectations

Pull requests should pass:

- Server tests (with coverage output)
- Compose shared compile (`compileKotlinMetadata`)
- Compose unit tests (`testDebugUnitTest`)

## Migration readiness checklist (web + iOS)

As web and iOS targets are introduced, keep this sequence:

1. Move business rules into `commonMain` where possible.
2. Add/expand tests in `commonTest` first (portable assertions).
3. Add target-specific tests only for platform wrappers/adapters.
4. Keep contracts stable:
   - API envelope parsing tests in `commonTest`
   - server route/service tests in Jest
5. Gate merges on CI for all active targets.

## Next high-value additions

- Expand `integration/` coverage: playgrounds search, ad payment webhooks (mock Stripe), authenticated user routes.
- Snapshot/golden tests for key UI states once web UI stabilizes.
- Contract tests generated from OpenAPI (if spec is introduced).
