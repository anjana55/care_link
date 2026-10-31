# Building and releasing the app

The app is built in the cloud with **EAS** (Expo Application Services):
`eas.json` has the three build profiles, `app.config.ts` everything the
stores bake in. This guide is for setting it up once, under **Vivanti
Health's** accounts, and then building, testing and updating.

| Profile | Who it's for | What you get |
|---|---|---|
| `development` | Developers | A "development build": your own Expo Go with the app's native code (push, etc.). Loads the JavaScript from `npx expo start`. |
| `preview` | Testers inside Vivanti Health | An installable test app: an APK on Android, an internal build on iPhone. |
| `production` | Everyone | The store build. The build number goes up automatically. |

Each profile has its own **update channel** of the same name, so an
over-the-air update sent to `preview` only reaches preview builds.

---

## One-time setup

Do these on your own computer, in this repo, from `apps/mobile`. You need
Node.js and this repo installed (`npm install` at the repo root).

### 1. An Expo account for Vivanti Health

1. Sign up at **expo.dev**.
2. Create an **organization** named after Vivanti Health (for example
   `vivanti-health`) and make it the owner of the app. Add developers as
   members, so the app never belongs to one person's login.
3. Install the command-line tool and sign in:

   ```bash
   npm install -g eas-cli
   eas login
   ```

### 2. Create the project and record its id

```bash
cd apps/mobile
EXPO_OWNER=vivanti-health eas init
```

`eas init` creates the **CareLink** project and prints its **project id**
(a long code like `1a2b3c4d-…`). It can't write it into `app.config.ts`
itself, so open `app.config.ts` and fill in the `carelink` brand:

```ts
owner: 'vivanti-health',
easProjectId: '1a2b3c4d-…',
```

Commit that change. Nothing in it is secret. From then on the app registers
for push and accepts over-the-air updates.

### 3. Android: Firebase, for push

Android push goes through Google's Firebase. Expo sends the messages, but the
app needs a Firebase project to receive them.

1. Go to **console.firebase.google.com** and create a project, for example
   "CareLink", under a Vivanti Health Google account.
2. **Add an Android app** with the package name
   `com.vivantihealth.carelink`, the bundle id in `app.config.ts`.
3. Download **google-services.json**. Don't commit it.
4. Give it to EAS as a secret file variable:
   1. On **expo.dev**, open the CareLink project and go to **Environment
      variables**. Click **Add variable**.
   2. Set the name to `GOOGLE_SERVICES_JSON`.
   3. Choose the **File** type, and upload `google-services.json`.
   4. Set the visibility to **Secret**.
   5. Tick all three environments: development, preview and production.

   Each build profile in `eas.json` names its environment, so every build
   gets the file. `app.config.ts` points the app at it.

5. Let Expo send through Firebase:
   1. In Firebase, go to **Project settings › Service accounts** and click
      **Generate new private key**. A JSON file downloads.
   2. Run `eas credentials`, choose **Android** and the production profile,
      and follow the menu to the **Google Service Account** key for **push
      notifications (FCM V1)**. Upload that file there.
   3. Delete the downloaded key from your computer afterwards.

### 4. iPhone: Apple Developer account

iPhone builds need Vivanti Health's **Apple Developer Program** membership.
That needs a D-U-N-S number, so start early. Once you have it:

- The first `eas build --platform ios` asks you to sign in to Apple. Follow
  the prompts and let EAS create the certificates and the **push key**. When
  it asks about push notifications, answer **yes**.
- To put a development or preview build on an iPhone, register the phone
  first with `eas device:create` and follow the link on the phone.

Android needs nothing from Google Play until a store release, so you can
start testing on Android first.

---

## Everyday use

### A development build (developers)

```bash
eas build --profile development --platform android   # or ios
```

Install the result on your phone using the link EAS prints. Then run:

```bash
npm run start:dev-client          # or: npx expo start --dev-client
```

(`npm run start`, and `npx expo start --go`, still open Expo Go as before.)

Then open the CareLink development app instead of Expo Go and scan the QR
code. Push notifications work in this build; they don't in Expo Go.

### A test build (preview)

```bash
eas build --profile preview --platform all
```

Share the install link with testers. Android testers get an APK. iPhone
testers' devices must be registered first (step 4).

### A store release (production)

1. Raise `version` in `app.config.ts` (for example `1.0.0` to `1.1.0`).
   People see this number in the store, and Settings › Mobile app compares
   against it.
2. Build and send it to the stores:

   ```bash
   eas build --profile production --platform all
   eas submit --platform all
   ```

3. Once it's live in both stores, open **Settings › Mobile app** in the staff
   app:
   - Set **Latest version** to the new number. Older versions are offered the
     update.
   - Raise **Minimum version** only when older versions must stop, for
     example when the API changes in a way they can't handle. People on an
     older version can't use the app until they update.

### A quick fix without a store release (over-the-air)

A fix that only changes JavaScript (screens, text, logic), with no new native
package, can be sent straight to the app:

```bash
eas update --channel production --message "Fix the booking date format"
```

It reaches builds with the **same `version`** the next time they're opened
twice. Anything that adds or upgrades a native package needs a new build and
a store release.

## Checklist before the first store release

- [ ] Bundle id `com.vivantihealth.carelink` confirmed. It can't change once published.
- [ ] Project id and owner filled in `app.config.ts`.
- [ ] Firebase set up (steps 3.1 to 3.5) and a push received on an Android development build.
- [ ] Apple push key created and a push received on an iPhone development build.
- [ ] Caregiver documents tried on a real Android phone and iPhone: take a photo, choose a photo, choose a PDF, and open an uploaded one.
- [ ] Store links filled in under Settings › Mobile app.
- [ ] Store listings, privacy forms and screenshots: see the mobile app plan, section 7.
