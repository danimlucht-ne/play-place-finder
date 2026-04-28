# Go-live security checklist

Complete before production release. Check off items and note owner/date in PR or release notes.

This repo includes a **Node server**, **website**, and **Compose/Android** app — apply each section to the components you ship.

## Secrets and configuration

- [ ] No secrets, API keys, or tokens committed in the repo (scan history if needed); use env vars or a secret manager.
- [ ] Production secrets differ from dev/staging; rotation plan exists for any leaked credential.
- [ ] `.env` and similar files are gitignored; production values injected via CI/hosting, not copied from examples verbatim.
- [ ] Firebase / Google Cloud keys and rules reviewed for least privilege; Firestore/Storage security rules match product intent.

## Injection and unsafe dynamic execution

- [ ] **SQL / NoSQL** — All queries use parameterized APIs or ORM bindings; no string concatenation of user input into queries.
- [ ] **Shell / OS** — No user-controlled strings passed to shell/exec; use structured APIs; if unavoidable, strict allowlists and safe escaping.
- [ ] **HTML / XSS** — Untrusted data is encoded for its output context; avoid raw HTML with user content; review `dangerouslySetInnerHTML` / similar.
- [ ] **Server-side template injection** — Template engines are not fed attacker-controlled template source.
- [ ] **Name/description character policy** — Enforce server-side allowlist validation for text fields (e.g., names/descriptions) to block unexpected symbols/control characters; trim/normalize input and return clear validation errors.

## Authentication and authorization

- [ ] Session tokens / JWTs: secure flags (HttpOnly, Secure, SameSite where applicable), short-lived access tokens, proper logout and rotation.
- [ ] **Authorization on every sensitive action** — Verify the authenticated principal may act on **that** resource (prevent IDOR).
- [ ] Default-deny for admin and privileged routes; rate-limit auth endpoints.
- [ ] Server endpoints that mutate data verify the caller is allowed to touch that playground/user record.

## Network and SSRF

- [ ] Outbound HTTP from the server (webhooks, imports) uses allowlists or blocks private/link-local/metadata URLs; no fetching arbitrary user-supplied URLs without gates.
- [ ] CORS restricted to known origins in production; not `*` with credentials.

## File uploads and paths

- [ ] Validate file type/size; store outside web root or serve via controlled routes; randomize filenames; scan if policy requires.
- [ ] No path traversal from user input (`../`); normalize and reject escapes.

## Dependencies and supply chain

- [ ] Run dependency audit (`npm audit`, Android/Gradle dependency check, etc.) and address **critical/high** issues or document accepted risk.
- [ ] Lockfiles committed; CI fails or warns on known-vulnerable direct dependencies where possible.

## Transport and cookies

- [ ] HTTPS everywhere in production; HSTS where appropriate.
- [ ] Sensitive cookies scoped correctly; Secure + SameSite reviewed.

## Logging and errors

- [ ] Production error responses do not leak stack traces, SQL, or internal paths to clients.
- [ ] Logs do not contain passwords, full payment details, or raw session tokens.

## Mobile / client-specific (if applicable)

- [ ] Deep links and intent filters do not expose unsafe exported components without permission checks.
- [ ] ProGuard/R8 mapping and release signing process documented; no debuggable release builds.

## Operational

- [ ] Backups and restore tested for data stores holding user data.
- [ ] Incident response: who to contact and how to rotate keys if a breach is suspected.

---

*Add project-specific items below.*

- [ ] 
- [ ] 
