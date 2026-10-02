# Translation review — offline working material

The Sinhala and Tamil strings need correcting. Everything you need is here; you do
not need the app running.

## The six source-of-truth files

| App | Directory | Keys |
|---|---|---|
| Public site (landing, finder, register, login) | `apps/public-web/src/lib/i18n/dictionaries/` | `en.json`, `si.json`, `ta.json` — 261 strings |
| Staff portal (`/staff`) | `apps/web/src/lib/i18n/` | `en.json`, `si.json`, `ta.json` — 422 strings |

**683 strings total.** `en.json` is the reference: `si.json` and `ta.json` must have
exactly the same key structure, no more and no less. There is a test that enforces
this (`apps/public-web/src/__tests__/dictionary-parity.test.ts`) — it fails the
build if a key is added, removed or renamed in only one language.

## `translations.csv`

Every string in both apps, one row each, with the English alongside both current
translations and two empty columns for you:

| app | key | english | sinhala_current | tamil_current | sinhala_corrected | tamil_corrected |
|---|---|---|---|---|---|---|

- Opened with a UTF-8 BOM so Sinhala/Tamil render correctly in Excel.
- The `app` column says which file each row belongs to. `public-web (public site)`
  rows go to `apps/public-web/src/lib/i18n/dictionaries/`, `web (staff portal)` rows
  to `apps/web/src/lib/i18n/`.
- Sort or filter by `app` to work one app at a time. Filter the `*_corrected` columns
  for blanks to see what is left to do.

Fill in **only** the two `*_corrected` columns. Leave a cell empty if that string is
already correct — empty means "don't touch it".

## Applying your corrections

```bash
python3 i18n-review/apply-corrections.py --dry-run   # see what would change
python3 i18n-review/apply-corrections.py             # write it in
```

It rewrites `si.json` and `ta.json` in place, in the original key order, with the
same 2-space indent. `en.json` is never modified. It re-reads the files each run, so
you can correct more rows and re-run — your edits are never lost. Before writing, it
checks that all three dictionaries still have identical key sets and refuses to write
if not.

Then:

```bash
cd apps/public-web && npx jest && npx tsc --noEmit
```

## Rules that will break things if ignored

- **`{placeholder}` tokens must survive exactly.** For example
  `Welcome back, {name}` — the `{name}` is substituted at render time. Translate
  around it, never rename or drop it. The same applies to any other `{...}` token in
  the English column.
- **Do not rename or add keys.** Only the values change. Keys are referenced from
  `.tsx` files by name; a renamed key renders as the raw key string at runtime.
- **Keep HTML-entity and character escapes as they are.** If a value contains `&amp;`
  or `​`, keep them — they are literal in the JSON source, not escapes to
  resolve.
- **Empty string is not the same as the English text.** A blank value renders as
  nothing, which looks broken.

## Where the suspect translations are

**Highest priority — machine-written, unreviewed.** The ~69 keys added by the recent
design work were translated from English without a native speaker reviewing them.
These are the ones most likely to read badly:

- Everything under `landing.*` in public-web (the whole marketing page — hero, app
  cards, how-it-works, gallery, CTA). This is the largest single block of new copy.
- `notFound.*` and `errorBoundary.*` — the 404 and error pages.
- `nav.backHome`, `nav.backToPublic`, `nav.openMenu` (public-web and staff).
- `profile.availability.*`, `results.approxAge`, `aiSearch.extractedLine`,
  `aiSearch.removeLine`.

**Also worth a look — never translated at all.** These 15 staff-portal strings are
byte-identical to the English in both `si.json` and `ta.json`. They predate the design
work, so they were missed rather than mistranslated:

```
caregivers.delete              caregivers.confirmDeleteReference
caregivers.confirmDelete       caregivers.deleteTitle
caregivers.confirmDeleteDocument caregivers.wizard.viewProfile
caregivers.edit.addExperience  common.delete
common.confirm                 common.edit
myProfile.skills               myProfile.languages
+ 3 more — filter the sheet on sinhala_current == english
```

To find them all, filter the sheet where `sinhala_current` equals `english` (same for
Tamil). In public-web that returns only 4 rows — `1,800+`, `3`, `100%` and
`REST API` — which are numbers and a technical term that are correctly identical in
all three languages. Those need no work.