# Implementation Report — Care Platform (Caregiver Registration, Management & Verification)

## 1. What was requested vs. what was built

The brief asked for a local-first foundation for a future Uber-like patient-care
platform, starting with caregiver registration, management and verification, with
PostgreSQL swapped for MySQL. That is what's in this repository, working end-to-end,
with two disclosed deviations (see §2).

## 2. Deviations, and why

| Spec said | Built instead | Why |
|---|---|---|
| PostgreSQL | **MySQL** | Explicit request from you. |
| Prisma ORM | **Drizzle ORM** + `mysql2` | Prisma's `generate`/`migrate` steps download a native query-engine binary from `binaries.prisma.sh`. That host was unreachable from the network this was built in — Prisma could not run at all here, not even in a degraded way. Drizzle is a pure TypeScript ORM with no native binary, targets MySQL the same way, and preserves the same "swap the DB layer without touching business logic" story the spec asked for. On a machine with normal internet access, Prisma would work fine against this same schema shape if you'd prefer to switch back. |

Two smaller, lower-stakes substitutions, both noted in the README:
- **shadcn/ui components are hand-built**, not CLI-scaffolded, because the shadcn CLI's
  registry host wasn't reachable either. They follow the same conventions (Radix-free,
  Tailwind + `class-variance-authority`) and are drop-in compatible with the real CLI.
- **Sinhala/Tamil fonts use system font stacks**, not a Google Fonts CDN, for the same
  network-reachability reason. One line in `tailwind.config.js` to switch to hosted fonts.

Everything else — local file storage abstraction, NestJS/REST/Swagger, JWT auth, RBAC,
audit logging, the separated health-information table, the caregiver domain model,
multilingual UI, mobile-readiness — follows the brief as given.

## 3. Verification performed (not just "written", actually run)

This was built and tested against a real, running stack in the sandbox, not just
written and assumed correct:

- MySQL 8 installed, database created, **17 tables migrated** from the Drizzle schema
- Seed script run successfully: skills, languages, Sri Lankan locations, 3 users
  (admin/staff/verifier), 5 fictional caregivers with related records
- Backend built with `nest build` (zero TypeScript errors) and run as a live server
- **10 unit tests + 14 e2e tests, all passing**, run against the live server and a real
  MySQL connection — covering: unauthenticated-request rejection, invalid login,
  caregiver creation, duplicate NIC rejection (409), NIC/phone masking in list
  responses, illegal status transitions (400) vs. legal ones (200), STAFF forbidden
  from admin-only actions (403) vs. allowed actions (201), skill assignment, rejected
  vs. accepted document uploads by file type, and RBAC on restricted health information
  (STAFF blocked with 403, ADMIN allowed with 200)
- Beyond the automated suite, manually verified with `curl`: login → dashboard stats →
  masked caregiver list → duplicate-NIC conflict → status state-machine enforcement →
  document upload with checksum → uploaded file confirmed on disk outside any served
  directory → disallowed file type rejected → health-information RBAC → confirmation
  that health data is never present in the normal caregiver-profile response → audit
  log entries generated for every one of the above actions
- Frontend type-checked clean (`tsc --noEmit`), built cleanly for production
  (`next build`, all 11 routes compiled), and served live in dev mode with every route
  returning 200 and no runtime errors in the server log; CORS confirmed working between
  the two dev servers

## 4. Project layout

```
care-platform/
  apps/api/     NestJS + Drizzle ORM + MySQL — see apps/api/src/*/  (one folder per module)
  apps/web/     Next.js 14 App Router — see apps/web/src/app/(app)/*  (one folder per screen)
  packages/shared/   reserved for the future mobile app's shared types
  storage/caregiver-documents/   local file storage root
  docker-compose.yml             MySQL (+ optional Adminer) for local dev
  README.md                      full setup + architecture documentation
```

## 5. Database entities

Users, RefreshTokens, Caregivers, Qualifications, Experience, Skills (+ CaregiverSkills
join), Languages (+ CaregiverLanguages join), Locations (+ PreferredLocations join),
Availability, CaregiverDocuments (metadata only), References, Verifications,
CaregiverHealthInformation (separated, access-restricted), AuditLogs — 17 tables total,
with appropriate indexes and uniqueness constraints (NIC, passport, phone, registration
number). Full schema: `apps/api/src/database/schema/*.ts`.

## 6. API endpoints

See README §7 for the grouped list, or run the API and open `/api/docs` for the full
interactive Swagger/OpenAPI spec generated directly from the controllers.

## 7. Frontend screens

Login · Dashboard (status counts) · Caregiver List (search/filter/paginate, masked
NIC/phone) · 8-step Registration Wizard (personal info, qualifications, experience,
skills, languages, availability, documents, review & submit) · Caregiver Profile
(tabbed: overview, qualifications, documents, references, verification, restricted
health info, audit history) · Skills/Languages/Locations admin · Audit Log.

## 8. Authentication & security

JWT access (15 min) + rotating, hashed refresh tokens (7 days); bcrypt password hashing;
role-based guards (ADMIN/STAFF/VERIFIER); Helmet headers; configurable CORS; request rate
limiting; class-validator on every DTO; masked NIC/passport/phone on list endpoints;
MIME + extension + size-capped file upload validation with server-generated (never
user-supplied) storage keys; the health-information table is never joined into normal
responses and is role-restricted; every sensitive action is audit-logged. Full detail in
README §8.

## 9. Document storage & future cloud migration

Files live on disk behind a `StorageService` interface with a `LocalFileStorageService`
implementation. Moving to S3/MinIO/Azure Blob later means implementing the same
three-method interface and swapping one provider registration in `storage.module.ts` —
no changes anywhere in the caregiver/document business logic. Details in README §6.

## 10. Multilingual implementation

English/Sinhala/Tamil via a small custom provider and per-locale JSON dictionaries
(`apps/web/src/lib/i18n/`), not hard-coded strings, with the selection persisted per
browser. Details and the font-hosting caveat in README §9.

## 11. Mobile-readiness

`GET /caregivers` (and the rest of the API) returns a domain-level shape, not a
UI-specific one; a future React Native/Expo app would consume the exact same NestJS API
and MySQL database — no second backend.

## 12. How to run it locally

See README.md §3 — three commands to start MySQL, then `npm install && npm run
db:generate && npm run db:migrate && npm run db:seed && npm run start:dev` for the API,
then `npm install && npm run dev` for the web app.

## 13. Honest gaps / what I'd do next with more time

- The e2e test suite runs against the same database as the seed data rather than an
  isolated test database — fine for this demonstration, but a real CI setup should point
  `DATABASE_URL` at a disposable test schema.
- The frontend was verified by build/type-check/route-rendering/log-inspection, not by
  driving an actual browser (no headless browser available in this sandbox) — worth a
  manual click-through or a Playwright suite before treating it as fully proven.
- Qualification/experience/reference verification actions exist as API endpoints but
  don't yet have dedicated frontend controls on the profile page (verification records
  are viewable, not yet actionable, from the UI — the wizard and document verification
  flows are the ones that are fully wired end-to-end).
- No automated linting was run on the frontend (ESLint wasn't installed to keep the
  dependency list lean); `tsc --noEmit` and `next build` are the checks that were run.

## 14. Changelog — advanced caregiver search (this update)

Added multi-facet filtering to `GET /caregivers`, on top of the existing free-text
`search` and `status` filter:

- **Skills** (`skillIds`) — AND semantics: caregiver must have every selected skill.
  Implemented as a `GROUP BY caregiverId HAVING COUNT(DISTINCT skillId) = N` query
  against `caregiver_skills`, not a join on the main query, to avoid row fan-out.
- **Languages** (`languageIds`) — same AND approach against `caregiver_languages`.
- **Locations** (`locationIds`) — OR semantics: caregiver must prefer at least one of
  the selected locations, against `preferred_locations`.
- **Gender** (`gender`) — exact match.
- **Availability** (`dayDuty` / `nightDuty` / `liveIn24h`) — OR-within-facet: matches a
  caregiver whose `availability` row has any of the checked flags set.

All facets combine with AND across each other. Every path was tested for the "no
results" case to make sure an impossible combination returns an empty page rather than
an empty/invalid SQL `IN ()` clause (guarded with a `1 = 0` short-circuit condition).

The caregiver list response (`GET /caregivers`) now also includes each caregiver's
preferred `locations` (city names), matching the existing `skills`/`languages` arrays,
so the list table and filter chips can show why a result matched.

**Verification for this change specifically:**
- 8 new e2e tests added (`describe('advanced search filters', ...)` in
  `apps/api/test/app.e2e-spec.ts`), covering: single-skill match, AND-across-two-skills,
  single-language match, OR-across-two-locations, both availability flags, gender,
  a 3-facet combination, and the empty-result case. All 22 e2e tests (14 existing + 8
  new) and all 10 unit tests pass.
- Manually verified via `curl` against the live server and seed data for every facet and
  several combinations, including the exact URL-encoded query string the frontend
  actually constructs (confirmed against a running `next dev` + CORS from
  `localhost:3000`).
- Frontend type-checks clean and builds cleanly (`next build`) with the new
  `AdvancedFiltersPanel` component, filter-chip summary, and `locations` column wired in.

**Frontend UX:** a "Filters" button next to the search bar (badge shows the active
filter count) expands a panel with checkbox pills for skills/languages/locations, a
gender dropdown, and availability checkboxes. Selecting anything shows a row of
removable chips below the search bar and re-queries immediately; "Clear all" resets in
one click. No changes were needed to the registration wizard or profile page.

## 15. Changelog — dependency security fixes (this update)

`npm install` in `apps/api` was surfacing 32 audit findings (1 critical, 10 high, 17
moderate, 4 low), and `apps/web` had 2 more (1 critical, 1 high) once checked. Both are
now at **0 vulnerabilities**, verified with a fresh `rm -rf node_modules package-lock.json
&& npm install && npm audit` in each app, not just a patch on top of the old lockfile.

**Backend (`apps/api`):**

- The naive fix — jumping `@nestjs/*` straight to the latest major (v12) — did reach 0
  vulnerabilities, but broke the test suite: NestJS v12 ships as pure ESM
  (`"type": "module"`) across almost the entire package family, which Jest's
  CommonJS-based `require()` can't load (`SyntaxError: Unexpected token 'export'`).
  Neither `tsc --noEmit` nor `nest build` catch this, because it's a Node module-resolution
  failure, not a type error — only actually running the e2e suite exposed it. Worth
  remembering: a clean build is not proof a dependency bump is safe to ship.
- The real fix: NestJS v11's latest patch releases (`@nestjs/core@11.2.5`,
  `@nestjs/common@11.2.5`, `@nestjs/platform-express@11.2.5`, `@nestjs/swagger@11.4.7`,
  `@nestjs/jwt@11.0.2`, `@nestjs/passport@11.0.5`, `@nestjs/config@4.0.4`,
  `@nestjs/cli@11.0.24`, `@nestjs/testing@11.2.5`) are **still CommonJS**, and each one
  individually already sits above the vulnerable ranges the audit flagged (e.g. the
  advisory for `@nestjs/core` was `<=11.1.17`; `11.2.5` is clean). No ESM migration
  needed.
- `bcrypt` 5→6: removes the `@mapbox/node-pre-gyp`→`tar` dependency chain entirely (the
  one *critical* finding) in favor of `node-gyp-build`. Verified the native binary still
  hashes and compares passwords correctly at runtime, not just that it installs.
- `multer` 1→2, matching the version `@nestjs/platform-express` itself now bundles;
  pinned via `overrides` since platform-express's own nested copy otherwise resolves to
  the still-vulnerable `2.2.0`.
- `esbuild` pinned to `^0.25.4` via `overrides` — `drizzle-kit` already depends on a
  patched `esbuild` directly, but a legacy `@esbuild-kit/esm-loader` sub-dependency was
  pulling in a second, vulnerable, nested copy.
- `uuid` 10→14 turned out to be pure ESM too (same class of problem as NestJS v12).
  Rather than pin yet another major version and hope, it was removed entirely: every
  `import { v4 as uuid } from 'uuid'` (14 files) became
  `import { randomUUID as uuid } from 'crypto'` — Node's built-in UUID generator, same
  call signature, zero dependency, zero vulnerability surface, one less thing to ever
  need bumping again.
- Dropped `@nestjs/schematics` (and `@types/uuid`, now redundant) — schematics is only
  used by `nest generate`, which this project never runs, and its latest release
  requires TypeScript 7, an unrelated and unnecessary jump.

**Frontend (`apps/web`):** `next` 14.2.15 → 16.3.5 (the audit's critical finding was a
long list of Next.js advisories, plus a nested vulnerable `postcss` bundled inside
Next's own build pipeline that gets fixed as a side effect). Kept React on 18.3.1, which
Next 16 still explicitly supports as a peer, rather than combining two major upgrades
at once. `next build` now uses Turbopack by default; all 11 routes still compile and
prerender correctly.

**Full verification performed for both apps**, each on a completely fresh install (not
an incremental patch):
- `npm audit` → 0 vulnerabilities, both apps
- Backend: `tsc --noEmit` clean, `nest build` clean, all 10 unit tests + all 22 e2e
  tests pass, the compiled server was actually started (`node dist/src/main.js`) and
  exercised with real HTTP requests (login → JWT issuance → dashboard stats → caregiver
  list), not just built
- Frontend: `tsc --noEmit` clean, `next build` clean (production build, Turbopack), dev
  server started and all 9 routes returned 200 with the correct rendered content, CORS
  to the upgraded backend confirmed still working

## 16. Changelog — caregiver self-registration (this update)

Caregivers can now create their own account and profile, without staff involvement, on
top of the existing staff-mediated registration flow (which is unchanged).

**Data model**: `CAREGIVER` added to the user role enum; `caregivers.userId` (nullable,
unique) links a profile to its owning login - null for staff-entered records, set at
self-registration time; `email_verification_tokens` table backs the stubbed
verification flow; `caregivers.consentAcceptedAt` records data-processing consent.

**A new authorization primitive**: `@CaregiverScope()` / `CaregiverScopeGuard`, layered
alongside the existing role system rather than replacing it. Staff roles pass by role
exactly as before; a `CAREGIVER`-role token additionally passes when the route's
`:id`/`:caregiverId` matches the caregiver id embedded in their own JWT. Applied across
every caregiver sub-resource (qualifications, experience, skills, languages,
availability, documents, references) so a caregiver manages their own record through
the *same* endpoints staff already use - no parallel API surface to maintain.
Verification and status transitions beyond self-submission stay staff/verifier-only.

**Two latent gaps this surfaced and fixed**: `GET /caregivers` (the list/search) and
`/caregivers/dashboard` had no role restriction at all before this - harmless while
every login was trusted staff, but a real privacy leak once a `CAREGIVER` role could
exist (it would have let a caregiver browse every other caregiver's masked record).
Document file downloads (`GET /caregivers/:id/documents/:id/file`) had the identical
gap - any authenticated user could fetch any document by guessing its id. Both are now
explicitly scoped.

**Registration flow**: `POST /auth/register-caregiver` (public, throttled tighter than
the API default - 5/min) creates the login and the profile atomically in one DB
transaction, so a mid-flight failure (e.g. a duplicate NIC caught after the user row
would otherwise have been written) never leaves an orphaned, unusable account behind.
A caregiver may self-submit their own record `DRAFT -> REGISTERED`
(`PATCH /caregivers/:id/status`); every other transition is rejected in the service
layer with a specific message, not just the generic state-machine error, regardless of
whether the target state would otherwise be a valid next step.

**Email verification - stubbed, as agreed**: no real email provider is wired up.
`AuthService.sendVerificationEmailStub` logs the verification link to the server
console, and outside `NODE_ENV=production` the link is also returned directly in the
registration API response (`devVerificationUrl`), so the whole loop - register, verify,
auto-login - stays testable end-to-end without an inbox, in curl, in the e2e suite, and
in the browser. Swapping in a real provider (SES/SendGrid/etc.) is a one-method change;
nothing else in the flow needs to move. `POST /auth/resend-verification` responds
identically whether or not the account exists, to avoid leaking account existence to an
anonymous caller.

**Visible to staff immediately**, per the agreed requirement: a self-registered
caregiver is a normal `caregivers` row from the moment of registration - it shows up in
the staff list/search and the dashboard's `DRAFT` count instantly, before the caregiver
has even opened their verification email. Confirmed with a dedicated e2e test.

**Frontend**: a public `/register` page (personal-info fields shared with the staff
wizard via a new `PersonalInfoFields` component + `personalInfoSchema`, extracted from
`wizard-step-personal.tsx` to avoid duplicating the same 15-field form twice) and a
`/verify-email` page that reads the token from the query string, calls the verify
endpoint, and auto-logs in on success. A separate `(caregiver)` route group provides a
lightweight self-service shell (no admin sidebar) distinct from the staff `(app)` shell;
each layout now redirects the other role away (`CAREGIVER` landing in the staff area is
bounced to `/me`, and vice versa), so neither role can land on a page that's entirely
403s. The self-service `/me` page reuses the *exact same* wizard step components staff
use (`QualificationsStep`, `ExperienceStep`, `SkillsStep`, `LanguagesStep`,
`AvailabilityStep`, `DocumentsStep`) - just pointed at the logged-in caregiver's own id
instead of one created via the staff flow - picking up from qualifications since
personal info is already collected at registration. Once submitted, `/me` switches from
the step wizard to a status/overview view (still allowing further document uploads,
since staff may request more during verification).

**Verified for real**: the complete flow was exercised live end-to-end via curl
(register → blocked pre-verification login → console-logged/dev-response link → verify
→ auto-login with `caregiverId` embedded in the JWT → self-service qualification/skill
additions → self-submit → blocked self-verify-to-VERIFIED → confirmed visible to staff
immediately) with the exact CORS origin the frontend uses, plus the same flow through
the actual `/register` and `/verify-email` pages (form renders all fields server-side;
verify-email page loads and the same API call chain completes). **16 new e2e tests**
added (38 total, up from 22), covering duplicate email/phone rejection, immediate staff
visibility, pre-verification login blocking, invalid/reused token rejection, the
ownership boundary in both directions (self access allowed, cross-caregiver access
blocked - profile, qualifications, and restricted health information all separately
tested), the staff-only list/dashboard block, and the self-submit-only status
restriction. All 10 unit tests and 0 `npm audit` findings on both apps hold unchanged.

**Honest gap**: patient/guardian self-registration was explicitly named as a future
need but is out of scope for this update. The role enum and `userId`-linking pattern
were chosen so it slots in the same way (`PATIENT_GUARDIAN` role, a `patients.userId`
FK) without revisiting this design - but that table, those endpoints, and that flow
don't exist yet.

