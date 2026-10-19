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


## 17. Changelog — contact and save caregivers (staff-mediated requests)

**What a client can do now.** A signed-in client (patient/guardian) can press
**Contact this caregiver** on a public profile, add an optional note, and send a
request; and **Save** caregivers to a shortlist (heart on result cards, button on
profiles). Their account area at `/account/requests` and `/account/saved` shows
each request's status in plain words and lets them cancel one that staff have not
yet introduced. A signed-out visitor who presses either button goes through the
existing sign-up/sign-in gate and is brought back to the same profile afterwards.

**Contact is staff-mediated.** Neither side ever sees the other's name, phone or
email through the app. The client addresses caregivers by public id only and sees
only the anonymous public profile; requests land in a new staff **Requests** queue
(ADMIN + STAFF, like Clients) where staff see both parties in full, call them, and
move the request on: `NEW → IN_PROGRESS → INTRODUCED`, or `CLOSED` with a reason
(reopenable). The client can cancel from `NEW`/`IN_PROGRESS`. Staff can assign a
request, add internal notes, and see the full history. A client's and a
caregiver's records each list their requests.

**Rules enforced by the API** (`apps/api/src/care-requests/`):
- one *open* request per client–caregiver pair, enforced by a unique index on a
  generated `open_pair_key` column (race-safe, same technique as `live_nic`);
- at most 10 open requests per client, 100 saved caregivers;
- only publicly visible caregivers (ACTIVE, not deleted) can be contacted or saved,
  with the same 404 for "doesn't exist" and "not public";
- PENDING_REVIEW clients may send requests (staff see the review status);
  SUSPENDED/INACTIVE clients may not;
- deleting a client removes their requests and shortlist.

**Notifications** (`CareRequestNotifier`, fire-and-forget, never block a request):
- new request → email to staff: the new **Settings › Email › Care request alerts**
  list, or every active admin/staff account when it is empty;
- client → confirmation, then every staff move, in the language they were using,
  by WhatsApp if they prefer it (or have no email) and WhatsApp updates are on,
  otherwise email;
- caregiver → when staff pick a request up and when they introduce, in English,
  Sinhala and Tamil together, by email, else WhatsApp.
Notices carry only the reference number and generic wording — no names, numbers
or care details. WhatsApp updates have their own switch under **Settings ›
WhatsApp › Care request updates** and need an approved *utility* template with one
body parameter (`{{1}}`), approved in `en`, `si` and `ta`.

**Migration** `0005_care_requests`: new `care_requests`, `care_request_events`,
`saved_caregivers` tables; `email_settings.request_alerts_to`;
`whatsapp_auth_settings.notifications_enabled` and `notification_template_name`.
Additive only.

**Tests**: `test/care-requests.e2e-spec.ts` (20 cases: privacy of the client view,
duplicate and concurrent sends, visibility, client status, ownership, the staff
status ladder, notes/assignment, deletion cascade, saved list); unit tests for the
notifier's channel choice and wording; `apps/public-web/src/__tests__/client-care.test.tsx`
(10 cases). The staff app's `t()` now fills `{name}` placeholders.

**Honest gaps**: Sinhala/Tamil strings are machine-drafted like the rest of the
platform; the platform does not store a caregiver's language, so their notices go
out in all three. Hiring/bookings build on `INTRODUCED` in the next phase.

## 18. Changelog — phone requests taken by staff

Staff can now log a care request during a phone call: **Requests › New phone
request** (or **New request** on a client's record).

- **Caller**: pick an existing client, or add a first-time caller with the same
  intake the public sign-up asks for, plus a required "the caller agreed to us
  keeping their details" confirmation (stored as `consentAcceptedAt`). A new
  caller becomes an ACTIVE client whose number is their WhatsApp sign-in, already
  confirmed, so a WhatsApp code to that number signs them in later; no password is
  set. A number or email that already belongs to anyone is refused (409) so staff
  pick the existing record instead of creating a duplicate, and a later
  self-registration with the same number is refused rather than overwriting it.
- **Caregiver is optional** ("match later"). Staff may attach any caregiver whose
  record has not been removed, including ones not yet live on the site (the form
  warns). While a request is NEW/IN_PROGRESS staff can attach, swap or detach the
  caregiver from the request page — this works for web requests too. A request
  cannot be marked INTRODUCED without a caregiver.
- **Notifications** as for web requests, in the language staff choose for the
  caller — except no staff alert email (staff logged it). A caregiver attached to a
  request already IN_PROGRESS is notified then.
- **Queue**: a *Needs a caregiver* tab, a "By phone" marker, and "Not matched yet"
  in the caregiver column. The client's account page shows "Our team is finding a
  caregiver for you", or a neutral line when the caregiver is not shown online.

API: `POST /care-requests` (`patientId` or `newClient`, optional `caregiverId`,
`message`, `language`), `PATCH /care-requests/:id/caregiver`, `unmatched` and
`source` filters, `summary.unmatched`. Migration `0006_phone_requests`:
`care_requests.caregiver_id` nullable, new `source` and `created_by_user_id`,
`CAREGIVER_CHANGED` history event. Additive; existing rows become `source = WEB`.

Tests: 5 new e2e cases (existing and new callers, sign-in with WhatsApp afterwards,
validation and no half-made clients, roles, caregiver swap/duplicate), client page
test for the new states.

## 19. Changelog — bookings, assignments and shifts

Staff turn an agreed match into a **booking**, and the system drafts the actual
shifts: **Bookings › New booking**, or **Create booking** on a request that is
INTRODUCED/IN_PROGRESS with a caregiver.

- **Pattern → draft shifts.** Presets for Day (08:00–20:00), Night (20:00–08:00,
  ending the next day), 24-hour live-in and Custom; pick weekdays, first and last
  day. The form previews the shifts before saving. Every time is Sri Lanka time
  (fixed UTC+05:30) and stored as UTC. Limits: 366 days, 400 shifts per pattern, and
  24 hours per shift.
- **Hour-level editing.** While the booking is a draft, each shift's start and end
  can be edited to the minute. Shifts can be added or removed, and one shift can go
  to a **cover caregiver**. Changing the pattern of a draft regenerates the shifts.
  Nothing is sent to anyone while the booking is DRAFT.
- **Confirm.** Drafts become SCHEDULED, the linked request is closed as PLACED, and
  the client (in the booking's language) and every caregiver on the booking
  (trilingual) are told by email or WhatsApp. Notices carry the reference only.
  Confirm is refused, and the button is disabled, while any shift overlaps a
  caregiver's other scheduled shifts. The check locks the caregivers' rows so two
  concurrent confirms cannot double-book.
- **After confirming.** Extend (adds scheduled shifts from the old end, also
  overlap-checked), mark shifts completed, missed or cancelled (completed and missed
  only once a shift has started), swap the cover, complete the booking (future shifts
  are cancelled), or cancel it (future shifts are cancelled, and both sides are told).
  Notes and a full history are kept on the booking.
- **Money.** The agreed rate only — per hour, per day/shift, or per month (pro-rated
  over days/30) — with an estimated total. (Invoicing came later: see section 21.)
- **Clients** see their confirmed bookings and upcoming shifts at
  `/account/bookings`, with the caregiver's name but not their contact details.
- **Caregivers** see their scheduled shifts (from the last 7 days to the next
  62 days) on the Shifts page of their portal, with the area but not the client's
  name. A shift given to a cover appears for the cover, not for the original
  caregiver.
- **Search.** `desiredStartDate` now also leaves out caregivers who already have a
  scheduled shift that day.

API: `GET/POST /bookings`, `GET /bookings/summary`, `GET/PATCH /bookings/:id`,
`POST /bookings/:id/{confirm,cancel,complete,extend,notes,shifts}`,
`PATCH/DELETE /bookings/:id/shifts/:shiftId` (staff and admin);
`GET /me/bookings` (client) and `GET /me/shifts` (caregiver). Migration
`0007_bookings`: new tables `bookings`, `booking_shifts` and `booking_events`.
It is additive. Removing a client also removes their bookings.

Staff portal: Bookings list and detail with the roster grouped by week; dashboard
tiles for shifts today and drafts; related bookings on request, client and
caregiver pages. All new text is in English, Sinhala and Tamil.

Tests: shift-generator and estimate unit tests (weekdays, overnight and live-in,
month/year ends, hourly/daily/monthly totals); 7 e2e cases (request → draft →
confirm → placed with notifications, overlap refusal including concurrent
confirms, shift outcomes plus extend/complete/cancel, draft regeneration and
validation, roles and portal scoping, search exclusion, removal with the client);
client bookings and caregiver booked-shifts page tests.

## 20. Changelog — test suite fixes and UTC database sessions

The full API e2e suite (`npm run test:e2e`) now passes and exits on its own.
Before this change, 13 cases failed and Jest never exited.

- **Database times are always UTC.** mysql2 now sends and reads JS Dates as
  UTC (`timezone: 'Z'`), and every pooled connection sets
  `time_zone = '+00:00'`. Values MySQL fills in itself (`CURRENT_TIMESTAMP`,
  `NOW()`) used to follow the database server's zone. On a MySQL running in
  Asia/Colombo they landed 5h30 away from the values the API wrote. That broke
  OTP expiry, the hourly send limit and the resend cooldown. The seed scripts
  connect the same way. Production (MySQL 8 and Node in Docker) already ran in
  UTC, so existing data is unchanged. A new e2e case checks the session zone.
- **The pool is closed on shutdown.** It was never closed, so every e2e suite
  finished but Jest hung. The login suite builds a second app, and Passport's
  strategy registry is global, so that suite now closes its extra app last.
- **Stale tests updated.** Deleting a caregiver is allowed for ADMIN and STAFF,
  as the staff portal intends. The test now checks that a VERIFIER is refused
  and that STAFF can delete. The search-filter setup uses city IDs from
  `/admin/locations/cities` (`cityId`) instead of the old `/locations`
  endpoint.

## 21. Changelog — invoicing, payments and caregiver payouts

Staff bill clients for the care they received and pay caregivers for the shifts
they worked: **Invoices** and **Payouts** in the staff portal (ADMIN and STAFF),
**Settings › Billing** for admins.

- **Making an invoice.** For one booking or for all of a client's bookings, over a
  period, from: the shifts *done* (usual), the shifts *scheduled* (billing in
  advance), or *empty* (one-off charges). Each shift becomes a line priced at the
  booking's rate: hourly by its hours, daily one day per shift, monthly one line per
  booking (a whole calendar month counts as 1, a part-month as days/30). A shift
  belongs to the Colombo day it starts. Bookings with no rate give zero-priced lines
  that the editor flags.
- **Shaping a draft.** Every line's words, quantity and price can be changed; lines
  can be removed; staff add **charges** and **credits** (negative adjustments, e.g.
  a missed shift billed in advance). Discounts per line (% or amount) and for the
  whole invoice (% or amount, with a reason). **Tax** (admin-set name and rate,
  off by default) applies per invoice, and any line can be left out of it; the
  invoice discount is shared over taxed and untaxed lines in proportion. Bill-to
  details are editable. Totals are worked in cents by one shared function
  (`computeTotals`, packages/shared) that the API stores and the editor previews
  with, so they agree to the cent. Rounding: half away from zero, per line, on the
  invoice discount and on tax.
- **Never billed twice.** A shift on any invoice that is not VOID — drafts
  included — is left out of every new one; a monthly line blocks its dates. "Add
  unbilled shifts" tops a draft up after more shifts are marked done.
- **Issuing** gives the next number (`INV-000001`, prefix and next number set in
  Settings; gap-free, taken under a row lock in the issuing transaction), sets the
  issue and due dates (payment terms), freezes the lines and copies the business
  details onto the invoice. The client is told by email or WhatsApp in the
  invoice's language. An issued invoice is never edited: **Correct it** voids it
  and opens a draft copy (same lines and shifts) to issue under a new number;
  **Void** needs nothing paid (record a refund first). Void numbers are not reused.
- **Payments.** Staff record cash, transfers, cheques and card payments, and
  refunds; part-payments are fine; an entry made by mistake can be removed. The
  invoice is PAID when payments cover the total and drops back if money is
  refunded. "Send again" / "Send receipt" re-send the notice.
- **PayHere.** Admins enter the merchant ID and secret (encrypted at rest,
  write-only) and choose sandbox or live. A client can pay an issued invoice's
  balance from `/account/invoices/:id`: the API records a checkout and signs the
  amount (MD5 hash, made server-side), the browser posts the form to PayHere. The
  payment is recorded only from PayHere's notification to
  `POST /payments/payhere/notify`, after its `md5sig` checks out against our secret
  and its amount and currency match the checkout; repeats are applied once (unique
  payment id), a late "failed" never undoes a success, a chargeback reverses the
  payment. Coming back from PayHere the page waits for that confirmation.
  WhatsApp-only clients are asked for a receipt email.
- **Clients** see issued invoices (never drafts) at `/account/invoices`, with what
  they owe, and can print any invoice or save it as a PDF (A4 print styles; the
  browser renders Sinhala and Tamil, so no PDF font setup).
- **Payouts.** Each booking now has a caregiver **pay rate** next to the client
  rate (staff only), and the booking shows estimated charge, pay and margin. A
  **pay run** makes a draft statement for every caregiver with completed shifts in
  a period not yet on a statement (covers included, at the booking's pay rate; a
  cover on a monthly booking is paid a thirtieth per shift); running it again adds
  nothing twice. Staff add allowances and deductions, approve, then mark paid
  (date, method, transfer reference), and the caregiver is told. Caregivers see
  approved and paid statements under **Payments** in their portal.
- **Client removal** now refuses a client with issued invoices (accounting
  records); their drafts are deleted with them.

API: `GET/POST /invoices`, `GET /invoices/summary`, `GET/PATCH/DELETE /invoices/:id`,
`PUT /invoices/:id/lines`, `POST /invoices/:id/{lines/from-shifts,issue,send,void,revise,notes,payments}`,
`DELETE /invoices/:id/payments/:paymentId`; `GET/POST /payouts`, `POST /payouts/generate`,
`GET /payouts/summary`, `GET/PATCH/DELETE /payouts/:id`, `PUT /payouts/:id/lines`,
`POST /payouts/:id/{lines/from-shifts,approve,reopen,pay,void}`; `GET/PATCH /settings/billing`
(admin); `GET /me/invoices`, `GET /me/invoices/:id`, `POST /me/invoices/:id/payhere`
(client); `GET /me/payouts` (caregiver); `POST /payments/payhere/notify` (public, signed).
Bookings take `payRateType` / `payRateAmount`. Migration `0008_invoicing`: new tables
`billing_settings`, `invoices`, `invoice_lines`, `invoice_payments`, `invoice_events`,
`payhere_checkouts`, `payout_statements`, `payout_lines`, and two nullable columns on
`bookings`. Additive. Setup: DEPLOYMENT.md 8.7.

Tests: 24 unit tests (cents and rounding, totals with discounts, credits and
partial tax, months, the shift-to-line rules, PayHere hashing and signature
checks); 5 e2e cases (bill completed shifts and shape the draft, never twice, tax,
issue and frozen details, payments and refunds; billing in advance and revise;
PayHere checkout, forged/mismatched/pending/repeated/failed/chargeback
notifications; pay run with covers, allowances, approve and pay, caregiver view;
roles, client scoping, pay rate never shown to clients, client deletion); client
invoice and caregiver payments page tests. All new text in English, Sinhala and
Tamil (Sinhala and Tamil machine-drafted, for native review).

## 22. Changelog — white-label branding

The product can now be shipped under another company's name. **Settings → Branding**
(admin, the first Settings tab) sets:

- **Company** - name, an optional 1-4 letter short name (badge shown when there is no
  logo; blank = initials) and tagline. `{brand}` in every dictionary and in every
  email/WhatsApp text is filled with it, so the staff app, the public site, browser tabs,
  emails and WhatsApp notices all say the configured name. Renaming also renames the email
  sender name and invoice business name where they still matched the old name.
- **Logo** - PNG, JPEG, WebP or SVG up to 1 MB, checked by its bytes. SVGs with scripts,
  event handlers, embedded HTML or external links are refused, and the logo is served with
  a sandboxing CSP and `nosniff`. Versioned URLs are cached for a year. Also the favicon;
  without a logo the favicon is the shipped heart in the brand colour.
- **Colour theme** - primary and accent; dark/light tints, page background and hairlines
  are derived (`derivePalette`, packages/shared). Both colours must reach WCAG AA (4.5:1)
  with white text - enforced by the API and previewed live in the form, with a
  "use a darker shade" fix. The default colours reproduce the hand-tuned palette exactly.
- **Languages** - which of en/si/ta are offered and the default. Switchers show only the
  enabled languages (hidden when there is one); a stored choice of a disabled language
  falls back to the default.

How it is applied: the tailwind `brand`, `accent`, `paper` and `border` colours are CSS
variables (`rgb(var(--color-brand) / <alpha-value>)`). Each root layout fetches
`GET /branding` server-side (`API_INTERNAL_URL`, revalidated every 30s) for the first
paint, title and favicon; `BrandingProvider` then keeps it current in the browser, so a
save repaints the admin's page at once.

Unchanged: dates and times stay in Asia/Colombo and amounts in LKR (shift scheduling and
PayHere depend on them).

API: `GET/PATCH /settings/branding`, `POST/DELETE /settings/branding/logo` (admin);
`GET /branding`, `GET /branding/logo` (public). Migration `0010_branding_settings`: new
table `branding_settings`. Additive. Setup: DEPLOYMENT.md 8.6. Deploy: `web` and
`public-web` get `API_INTERNAL_URL: http://api:3001` in `docker-compose.prod.yml`.

Tests: branding service (defaults, rename, contrast refusal, languages, logo versioning and
cleanup), logo inspection (formats, size, unsafe SVGs), colour rules (shipped palette,
derived shades, accessible fix, normalising bad input), branded emails (name and colour,
HTML-escaped, no "CareLink" left) and `{brand}` surviving message builders; public-site
tests for `{brand}`, default and disabled languages, the switcher, the logo and the
live palette. New staff-app text in English, Sinhala and Tamil (Sinhala and Tamil
machine-drafted, for native review).
