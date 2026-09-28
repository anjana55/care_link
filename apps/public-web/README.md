# CareLink Finder (`apps/public-web`)

Public, anonymous-first caregiver search — the frontend for the `public-search`
API module in `apps/api`.

## Running locally

```bash
# from the repo root, once
npm install

# apply pending migrations (see "Database migration" below), then:
npm run dev:api          # apps/api on :3001
npm run dev:public-web   # this app on :3002
```

Copy `.env.example` to `.env.local` and point `NEXT_PUBLIC_API_URL` at your API.

## Database migration

This phase adds `caregivers.public_id`, a `patients` table, and a
`PATIENT_GUARDIAN` user role. Because `public_id` must end up `NOT NULL` on a
table that may already have rows, the migration is split in two, with a
backfill in between:

```bash
npm run db:migrate --workspace=@care-platform/api       # applies up to 0003 (public_id nullable)
npx tsx apps/api/src/database/scripts/backfill-public-ids.ts
# then apply 0004 (adds the NOT NULL constraint) the same way
```

On a fresh database with no existing caregivers this is a no-op — skip
straight to running all migrations.

## What's implemented in this phase

- `POST /public/search` — deterministic, ranked normal search (hard filters:
  `status=ACTIVE`, mandatory skills, location; ranking-only: optional skills,
  languages, budget, gender preference, experience, medical-condition text
  match)
- `GET /public/caregivers/:publicId` — public profile preview
- `GET /public/meta/{skills,languages,locations,search-config}`
- The one-page finder UI: hero, Normal Search (structured form) and AI Search
  (natural-language box) tabs, ranked result cards with factual "why this
  matches" reasons, profile preview, a registration-gate modal for
  contact/save actions, loading/empty/error states, and English/Sinhala/Tamil
  i18n switchable without a reload.

## Known limitations / what's intentionally not real yet

- **AI Search is a client-side mock.** `src/lib/ai/mock-extract.ts` does
  simple keyword matching so the natural-language → extracted-requirements →
  editable-panel → search flow is fully wired and testable, but there is no
  model behind it. The tab stays **disabled** by default because
  `GET /public/meta/search-config` reports `aiSearchEnabled: false` until the
  real server-side extraction/ranking pipeline (Ollama-backed, per the agreed
  architecture) is built. To try the AI tab locally, temporarily hardcode
  `aiSearchEnabled: true` in `PublicSearchController.searchConfig()`.
- **Registration/login isn't real.** The registration-gate modal is the UI
  contract for where sign-up/sign-in happens; the buttons don't yet call an
  auth endpoint (`patients` table + `PATIENT_GUARDIAN` role exist in the
  schema, ready for that phase).
- **Sinhala/Tamil strings are a good-faith translation**, not reviewed by a
  native speaker — worth a pass before this goes live.
- **`minimumExperienceYears` filtering is approximate** (checks whether any
  `experiences` row started early enough), not a true summed-years
  calculation — noted in `PublicSearchService` as a phase-1 simplification.
