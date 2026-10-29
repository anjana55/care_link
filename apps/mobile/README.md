# CareLink mobile app

iOS and Android app for caregivers and clients, built with Expo (SDK 58,
React Native 0.88) inside this repo's npm workspace. It shares types, value
lists and the i18n engine with the web apps through `@care-platform/shared`.

The plan, decisions and phases are in the CareLink project:
`claude/mobile-app-plan.md`.

## Run it

```bash
npm install            # from the repo root - one install for every app
npm run dev:mobile     # builds packages/shared, then starts Expo
```

Scan the QR code with **Expo Go** on a phone (same Wi-Fi), or press `a` / `i`
for an Android emulator / iOS simulator. Expo Go works while the app only uses
modules Expo Go ships with. From Phase 1 (push notifications, sign-in
redirects), use a development build instead: `npx eas build --profile development`.

By default the app talks to the live API. For a local one:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:3001 npm run dev:mobile   # your machine's LAN address, not localhost
```

## Check it

```bash
cd apps/mobile
npm run typecheck      # TypeScript
npm test               # Jest + React Native Testing Library
npm run bundle:check   # Metro bundles for iOS and Android, as a release build would
npx expo-doctor        # Expo's own health checks (needs internet)
```

## Rules that keep it working

- **Versions come from the Expo SDK.** Add or update native packages with
  `npx expo install <package>`, never a bare `npm install`, so they match what
  this SDK was built and tested with. A mismatched native module compiles into
  the app and fails on the phone, not here.
- **One React for the whole repo.** Expo pins an exact React; the web apps and
  the root `overrides` in `package.json` must name the same version. When the
  SDK moves, move all three together (PRs #45 and #49 show how).
- **One app, many brands.** `app.config.ts` picks the name, store identifiers
  and API from `BRAND`. Colours and the logo come from the API at runtime
  (Settings > Branding). The bundle identifier `com.vivantihealth.carelink` is
  provisional until the store accounts exist - it can't change after release.
- **Native folders aren't committed.** `ios/` and `android/` are generated from
  `app.config.ts` (`npx expo prebuild`, or EAS Build in the cloud).
- **Translations are reused, not invented.** Strings come from the public
  site's reviewed Sinhala and Tamil dictionaries wherever possible.
