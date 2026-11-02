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

### 5. Android: links that open the app

Links to the website in emails and WhatsApp messages (a booking, an
invoice, a caregiver's shifts or payments, a caregiver's profile) can open
the app instead of the browser. Android allows this only when the website
vouches for the app, with the app's package name and the **SHA-256
fingerprint of the certificate it is signed with**. The app already asks
for these links (`APP_LINK_PATHS` in `app.config.ts`); the website
publishes its side at `https://find.caregivers.lk/.well-known/assetlinks.json`
from what you enter in the staff app.

1. Get the fingerprints:
   - **For development and test builds:** run `eas credentials`, choose
     **Android** and the profile, and copy the **SHA256 Fingerprint** of the
     keystore.
   - **For the Play Store:** once the app is on Google Play, open
     **Play Console › your app › Test and release › App integrity › Play
     app signing › Settings** and copy the **SHA-256 certificate
     fingerprint** of both the **App signing key certificate** (Google
     signs store installs with this one) and the **Upload key
     certificate**.
2. In the staff app, go to **Settings › Mobile app › App links (Android)**.
   Enter the package name `com.vivantihealth.carelink` and paste the
   fingerprints, one per line (with or without colons). Save.
3. Check it: open `https://find.caregivers.lk/.well-known/assetlinks.json`
   in a browser. It should show the package and the fingerprints.
4. Install a build made after this was set up (the links are part of the
   app, so an older build doesn't have them). Android checks the website
   when the app is installed. To check a phone, connect it and run
   `adb shell pm get-app-links com.vivantihealth.carelink`: the website
   should show as `verified`. If it isn't, re-check the fingerprint and run
   `adb shell pm verify-app-links --re-verify com.vivantihealth.carelink`.

Until this is done, nothing breaks: links simply open in the browser.
Links to sign in, confirm an email, reset a password, register or delete
an account always stay on the website.

### 6. The brand's icon and splash screen

The app is white-labelled: its name in the stores is set per brand in
`app.config.ts` (CareLink), and everything inside it - logos, colours, the
company name - comes live from **Settings › Branding** in the staff app.

Three things can't come live, because the phone shows them before the app
runs: the **home-screen icon**, Android's **adaptive icon** and the **splash
screen**. They are made from the same Settings › Branding artwork:

1. In the staff app, open **Settings › Branding › Logo and artwork** and
   upload at least the **Symbol** and the **App icon** (each card says what to
   upload).
2. EAS Build fetches them from the brand's API automatically on every build
   (the `eas-build-post-install` script). Nothing to do.
3. For a local build, or to look at them first:

   ```bash
   npm run brand:assets
   ```

   This writes `assets/brand/carelink/` (`icon.png`, `adaptive-icon.png`,
   `splash-icon.png`). Those files aren't committed: each build takes the
   artwork from the deployment, so it always matches what the admin uploaded.

A new icon or splash only reaches people in a new store release. Logos and
colours change at once, without one.

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

## Publishing to the stores for the first time

Do the one-time setup above first (steps 1 to 6). Then, per store:

### Google Play (Android)

1. **Developer account.** Sign up at **play.google.com/console** as an
   **organization** (Vivanti Health), which needs a D-U-N-S number. New
   *personal* accounts must first run a closed test with at least 12 testers
   for 14 days before they can publish; check Play Console Help for the rule
   that applies to your account when you sign up.
2. **Create the app** in Play Console (**Create app**): name **CareLink**,
   app, free. The package name is set by the first upload:
   `com.vivantihealth.carelink`.
3. **Let EAS upload for you.** In Google Cloud, create a **service account**
   with access to the Play Console account, download its **JSON key**, and add
   it on **expo.dev** › the project › **Credentials › Android ›
   com.vivantihealth.carelink › Service credentials › Add a Google service
   account key**.
4. **Build and upload:**

   ```bash
   eas build --profile production --platform android
   eas submit --platform android --latest
   ```

   The build goes to the **Internal testing** track. Add yourself and staff
   as testers and try it on real phones.
5. **Fill in the store listing** in Play Console: short and full description,
   screenshots (phone), the 512 × 512 icon (`assets/brand/carelink/icon.png`
   scaled down), a 1024 × 500 feature graphic, the privacy policy link,
   **Data safety**, the content rating questionnaire, target audience, and
   the **account deletion** link: `https://find.caregivers.lk/delete-account`.
6. **App signing.** Once uploaded, copy the **app signing key** SHA-256 from
   **Test and release › App integrity › Play app signing** into
   **Settings › Mobile app › App links** (step 5), so links open the app.
7. **Release.** Promote the internal build to **Production** (or a closed
   test first) and send it for review. The first review can take several
   days.
8. When it's live, put its Play Store link in **Settings › Mobile app**.

### App Store (iPhone)

Waiting on Vivanti Health's **Apple Developer Program** membership (step 4).
Two things must also be in place before Apple will accept the app:
**Sign in with Apple** - Apple's review guidelines (4.8) ask apps that offer
Google, Microsoft or Facebook sign-in to also offer it or an equivalent
private option; that is plan phase 4c - and the app's privacy answers. Then:

1. In **App Store Connect**, create the app: name **CareLink**, bundle id
   `com.vivantihealth.carelink`.
2. Build and upload:

   ```bash
   eas build --profile production --platform ios
   eas submit --platform ios --latest
   ```

   EAS asks you to sign in to Apple and creates the certificates.
3. Test it in **TestFlight**, fill in the listing (screenshots in the iPhone
   sizes App Store Connect asks for, description, keywords, support and
   privacy URLs, App Privacy answers, a demo account for the reviewer), and
   submit for review.
4. When it's live, put its App Store link in **Settings › Mobile app**.

## Checklist before the first store release

- [ ] Bundle id `com.vivantihealth.carelink` confirmed. It can't change once published.
- [ ] Project id and owner filled in `app.config.ts`.
- [ ] Firebase set up (steps 3.1 to 3.5) and a push received on an Android development build.
- [ ] Apple push key created and a push received on an iPhone development build.
- [ ] Caregiver documents tried on a real Android phone and iPhone: take a photo, choose a photo, choose a PDF, and open an uploaded one.
- [ ] Store links filled in under Settings › Mobile app.
- [ ] App links set up (step 5) with the Play **app signing** fingerprint, and a link in an email opening the store build.
- [ ] Symbol and app icon uploaded in Settings › Branding (step 6), and `npm run brand:assets` shows the icon you expect.
- [ ] Store listings, privacy forms and screenshots: see the mobile app plan, section 7.
