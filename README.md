# Care Platform — Caregiver Registration, Management & Verification

A local-first foundation for an Uber-like patient-care platform, starting with caregiver
registration, management and verification. Runs entirely on a local machine or local
network — no cloud services required — while staying portable to a managed/cloud
deployment later.

```
Next.js (apps/web)  →  REST API  →  NestJS (apps/api)  →  Drizzle ORM  →  MySQL
                                                        →  Local file storage
```

## A note on two deliberate deviations from the original spec

1. **ORM: Drizzle instead of Prisma.** Prisma downloads a native query-engine binary
   from `binaries.prisma.sh` on `generate`/`migrate`. That domain was unreachable from
   the sandboxed environment this was built in, so Prisma could not be made to work
   there at all. Drizzle ORM + the `mysql2` driver is a pure TypeScript/JS alternative —
   no native binary, same MySQL target, same "swap the database layer later without
   touching business logic" portability story. If you have normal internet access,
   Prisma would work fine per the original spec; this repo just wasn't built against it.
2. **Database: MySQL instead of PostgreSQL**, per your explicit request.

Everything else follows the original brief: local file storage behind a
`StorageService` abstraction, NestJS + REST + Swagger, JWT auth, RBAC, audit logging,
a separated/restricted health-information table, English/Sinhala/Tamil UI, and a
caregiver domain modelled for a future marketplace (patients, matching, bookings)
without redesigning it today.

---

## 1. Project structure

```
care-platform/
  apps/
    web/     Next.js 14 (App Router) + TypeScript + Tailwind + TanStack Query
    api/     NestJS + TypeScript + Drizzle ORM + MySQL + Swagger
  packages/
    shared/  (reserved for cross-app types if/when the mobile app is built)
  storage/
    caregiver-documents/   Local file storage root (never served directly)
  docker-compose.yml        MySQL (+ optional Adminer) for local development
```

## 2. Prerequisites

- Node.js 20+ and npm
- Docker Desktop / Docker Engine (for MySQL via Compose) **or** a local MySQL 8 install
- Windows, macOS or Linux

Both apps currently sit at **0 `npm audit` findings** on a fresh install
(`apps/api`: NestJS v11.2.5-line, `bcrypt` v6, `multer` v2.4; `apps/web`: Next.js
16.3.5). See IMPLEMENTATION_REPORT.md §15 if you're wondering why it's v11 rather than
the latest NestJS major — the short version is that v12 is ESM-only and breaks this
project's CommonJS-based test tooling, while the latest v11 patch releases are already
clean of every vulnerability that was originally flagged.

## 3. First-time setup

```bash
# 1. Start MySQL
docker compose up -d

# 2. Backend
cd apps/api
cp .env.example .env          # defaults already match docker-compose.yml
npm install
npm run db:generate           # generate SQL migrations from the Drizzle schema
npm run db:migrate            # apply them to MySQL
npm run db:seed               # seed skills, languages, locations, users, sample caregivers
npm run build
npm run start:dev             # http://localhost:3001  (Swagger: /api/docs)

# 3. Frontend (in a second terminal)
cd apps/web
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

Seeded logins (password for all: `ChangeMe123!`):

| Role       | Email                              | Can access                                    |
|------------|--------------------------------------|------------------------------------------------|
| ADMIN      | admin@care-platform.local          | Everything, incl. audit log, user management  |
| STAFF      | staff@care-platform.local          | Register/edit caregivers, upload documents    |
| VERIFIER   | verifier@care-platform.local       | Verification workflow, restricted health data |
| CAREGIVER  | selfregistered@care-platform.local | Their own profile only, via the `/me` self-service area |

The CAREGIVER account lands in a completely different, lightweight part of the app
(`/me`) rather than the staff dashboard - see §7a.

## 4. Running the tests

```bash
cd apps/api
npm test                              # unit tests
npm run test:e2e -- --forceExit       # e2e tests against a live MySQL connection
```

`--forceExit` is needed because the mysql2 connection pool keeps the process alive
after the test suite finishes; it does not indicate a failing test.

## 5. Database

- **Engine:** MySQL 8, run via `docker-compose.yml` (a named volume persists data).
- **ORM:** Drizzle ORM. Schema lives in `apps/api/src/database/schema/*.ts`, one file
  per domain area. `npm run db:generate` diffs the schema against the last migration
  and writes SQL into `apps/api/src/database/migrations/`; `npm run db:migrate` applies
  pending migrations. `npm run db:studio` opens Drizzle Studio against the local DB.
- **Entities:** Users, Caregivers, Qualifications, Experience, Skills (+ join table),
  Languages (+ join table), Locations (+ join table), Availability, CaregiverDocuments
  (metadata only — files live on disk), References, Verifications, the **separated**
  CaregiverHealthInformation table, and AuditLogs. See §7 for the full list of endpoints
  and §8 for the security model.
- **Caregiver status** is a small state machine (`DRAFT → REGISTERED →
  DOCUMENTS_PENDING → UNDER_VERIFICATION → VERIFIED → ACTIVE ⇄ INACTIVE/SUSPENDED`,
  with `REJECTED` reachable from several states). The allowed-transitions map lives
  next to the schema in `apps/api/src/database/schema/caregivers.schema.ts` and is
  enforced server-side — the frontend's copy in `apps/web/src/lib/caregiver-status.ts`
  only decides which options a dropdown offers.

## 6. Document storage

Documents are stored on disk at `storage/caregiver-documents/{caregiverId}/{documentId}/original-file.ext`,
behind a `StorageService` interface (`apps/api/src/storage/storage.interface.ts`) with a
`LocalFileStorageService` implementation. To move to S3/MinIO/Azure Blob later, implement
the same three-method interface (`upload`, `download`, `delete`, `getSignedUrl`) and swap
the provider in `storage.module.ts` — no caregiver/document business logic changes.

The storage key is always server-generated (never the uploaded filename), the directory
is never served as static files, uploads are validated by MIME type + extension + a 10MB
size cap, and every file read is written to the audit log.

## 7. API overview

Full interactive documentation: `http://localhost:3001/api/docs` (Swagger/OpenAPI) once
the API is running. Route groups:

- `POST /auth/login`, `/auth/refresh`, `/auth/logout`
- `POST /auth/register-caregiver`, `/auth/verify-email`, `/auth/resend-verification` — public, see §7a
- `/users` (ADMIN only)
- `/caregivers`, `/caregivers/:id`, `/caregivers/:id/status`, `/caregivers/dashboard`
- `/caregivers/:id/qualifications`, `/experiences`, `/skills`, `/languages`,
  `/availability`, `/preferred-locations`, `/references`, `/documents`,
  `/verifications`
- `/caregivers/:id/health-information` — **restricted** (ADMIN/VERIFIER, or the
  caregiver themself; every access audit-logged)
- `/skills`, `/languages`, `/locations` — master data
- `/audit-logs` (ADMIN only)

The OpenAPI spec is generated directly from the NestJS controllers/DTOs, so it stays in
sync with the code. The same REST API is what a future React Native app would consume —
nothing here is shaped around the Next.js UI specifically.

### 7a. Caregiver self-registration

A caregiver can create their own login and profile without staff involvement:

1. `POST /auth/register-caregiver` (public, rate-limited to 5/min) — takes the same
   personal-info fields as the staff-mediated `POST /caregivers`, plus `email`,
   `password`, and `consentAccepted`. Creates the login (`users`, role `CAREGIVER`,
   unverified) and the profile (`caregivers`, status `DRAFT`) atomically. **Visible to
   staff immediately** — it's an ordinary `caregivers` row from the moment of
   registration, showing up in the list/search and dashboard `DRAFT` count right away.
2. **Email verification is stubbed** — no provider is wired up. The link is logged to
   the server console and, outside `NODE_ENV=production`, also returned in the API
   response as `devVerificationUrl`, so the whole loop is testable without a real inbox.
   Swap `AuthService.sendVerificationEmailStub` for a real provider before going live;
   nothing else in the flow changes.
3. `POST /auth/verify-email` marks the account verified and immediately logs the
   caregiver in (no separate login step). Login is blocked before this with a specific
   error message. `POST /auth/resend-verification` responds identically whether or not
   the email exists, to avoid leaking account existence.
4. Once logged in, a `CAREGIVER`-role token can use the *same* nested endpoints
   (`/caregivers/:id/qualifications`, `/skills`, `/documents`, etc.) staff already use —
   scoped to their own record by a new `@CaregiverScope()` guard (staff roles pass by
   role as before; a caregiver additionally passes when the route's id matches the
   `caregiverId` embedded in their own JWT). They can self-submit `DRAFT → REGISTERED`;
   every later transition (verification, activation, suspension) is still staff/
   verifier-only, enforced in `CaregiversService.updateStatus` since it depends on the
   *current* status, not just the caller's role.

On the frontend: a public `/register` page and `/verify-email` page (outside the staff
`(app)` shell), and a separate `(caregiver)` route group providing a lightweight
self-service shell at `/me` — the wizard step components staff already use
(`QualificationsStep`, `SkillsStep`, `DocumentsStep`, etc.) are reused there directly,
just pointed at the logged-in caregiver's own id. Each shell redirects the other role
away, so neither ends up on a page that's entirely 403s.

### Caregiver search & advanced filters

`GET /caregivers` accepts, all optional and combinable:

| Param | Type | Semantics |
|---|---|---|
| `search` | string | Matches name, registration number or phone (`LIKE %term%`) |
| `status` | enum | Exact match on caregiver status |
| `gender` | enum | Exact match |
| `skillIds` | comma-separated IDs | Caregiver must have **ALL** listed skills |
| `languageIds` | comma-separated IDs | Caregiver must speak **ALL** listed languages |
| `locationIds` | comma-separated IDs | Caregiver must prefer **ANY** of the listed locations |
| `dayDuty`, `nightDuty`, `liveIn24h` | boolean | Caregiver's availability matches **ANY** checked flag |
| `page`, `pageSize`, `sortBy`, `sortDir` | — | Pagination/sorting, unchanged |

All provided facets are combined with AND (e.g. `gender=FEMALE&skillIds=a,b&locationIds=c,d`
means: female AND has skills a+b AND prefers location c or d). An impossible combination
returns an empty page, not an error. Skill/language AND-matching is done via a
`GROUP BY ... HAVING COUNT(DISTINCT ...) = N` query against the join table rather than a
chain of joins on the main query, which avoids row fan-out from joining several
one-to-many tables at once. See `CaregiversService.findAll` and the `caregiverIdsWith*`
helpers in `apps/api/src/caregivers/caregivers.service.ts`.

On the frontend, the caregiver list page (`apps/web/src/app/(app)/caregivers/page.tsx`)
exposes this through a "Filters" toggle (`apps/web/src/components/caregivers/advanced-filters.tsx`)
with checkbox pills for skills/languages/locations, a gender select, and availability
checkboxes — plus removable filter chips summarizing what's active.

## 8. Security

- JWT access tokens (15 min) + rotating refresh tokens (7 days, hashed before storage,
  revoked on use/logout)
- bcrypt password hashing (cost 12)
- Role-based authorization (`ADMIN` / `STAFF` / `VERIFIER`) via a `@Roles()` decorator + guard
- Helmet security headers, configurable CORS, request rate limiting
- class-validator DTO validation on every endpoint
- NIC/passport/phone are masked on caregiver **list/search** endpoints (full values are
  only returned from a caregiver's own detail endpoint)
- File upload validation: MIME type + extension allow-list, 10MB size cap, no arbitrary
  executables, non-guessable storage keys
- `CaregiverHealthInformation` lives in its own table, is never joined into normal
  caregiver list/profile responses, and is restricted to ADMIN/VERIFIER roles
- Every sensitive action (login/logout, caregiver create/update/status change, document
  upload/verify/access, health-information access) is written to `audit_logs`

## 9. Multilingual UI

English, Sinhala and Tamil translation resources live in `apps/web/src/lib/i18n/{en,si,ta}.json`,
loaded through a small custom provider (`apps/web/src/lib/i18n/provider.tsx`) rather than
a heavyweight i18n library, with the selected locale persisted to `localStorage`. UI
strings are not hard-coded in components — everything routes through `useTranslation()`.

Sinhala and Tamil rendering uses system font stacks (`Iskoola Pota` / `Nirmala UI` with
`Noto Sans Sinhala` / `Noto Sans Tamil` fallbacks) rather than a webfont CDN, since this
build environment had no outbound access to font hosts — this is a one-line change in
`apps/web/tailwind.config.js` if you'd rather self-host or CDN-load the Noto families.

## 10. Frontend

- Next.js 16 (App Router), TypeScript, Tailwind CSS
- Hand-built UI primitives following shadcn/ui conventions (Button, Input, Card, Tabs,
  Badge, etc. in `apps/web/src/components/ui/`) rather than the shadcn CLI, since the
  CLI's registry host wasn't reachable from this build environment either — the
  components are drop-in compatible if you want to run the CLI yourself later
- TanStack Query for all server state; React Hook Form + Zod for the registration wizard
  and the public self-registration form (which share field definitions via
  `lib/schemas/personal-info.ts` and `components/caregivers/personal-info-fields.tsx`,
  rather than duplicating the same 15-field form twice)
- **Staff screens** (`(app)` shell, sidebar + topbar): Dashboard (status counts),
  Caregiver List (search/filter/paginate, masked NIC/phone, plus an advanced filter
  panel for skills/languages/locations/gender/availability — see §7), 8-step
  Registration Wizard (personal info → qualifications → experience → skills →
  languages → availability → documents → review & submit), tabbed Caregiver Profile
  (overview, qualifications, documents, references, verification, restricted health
  info for authorized roles, audit history for admins), and simple admin screens for
  Skills/Languages/Locations master data
- **Public pages**: `/register` (self-registration), `/verify-email` (reads the token
  from the query string, verifies, auto-logs in)
- **Caregiver self-service** (`(caregiver)` shell, no admin sidebar): `/me` — the same
  wizard step components staff use, picking up from qualifications (personal info is
  already collected at registration) and ending in self-submit; switches to a
  status/overview view once submitted, still allowing further document uploads

## 11. Mobile readiness

The API was designed independent of the web UI: `GET /caregivers` returns a
domain-level representation, not a UI-shaped one, and the OpenAPI contract at
`/api/docs-json` can be used to generate a typed client for a future
React Native/Expo app. No second backend would be needed — same NestJS API, same
MySQL database.

## 12. What's intentionally not built yet

Per the brief: patients, patient medical requirements, caregiver matching, bookings,
payments, ratings, GPS tracking, push notifications, and AI matching are all
out of scope for this version. The caregiver domain (skills, qualifications, languages,
location, availability, verification status) is modelled so a future matching engine can
query all of that without a caregiver-table redesign.

**Patient/guardian self-registration** was named as a near-term follow-up but isn't
built yet either. The `users.role` enum and the `caregivers.userId`-linking pattern
introduced for caregiver self-registration (§7a) were deliberately chosen so it can slot
in the same way later — a `PATIENT_GUARDIAN` role and a `patients.userId` FK, reusing
the same `@CaregiverScope()`-style ownership guard concept — without revisiting this
design. That table, those endpoints, and that flow don't exist yet, though.

A real email provider is the other explicit gap — see §7a. `AuthService.sendVerificationEmailStub`
is the one place that needs to change; everything around it (the token table, the
verify/resend endpoints, the login gate) is already provider-agnostic.
