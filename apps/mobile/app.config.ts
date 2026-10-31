import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * One app, many brands. `BRAND` picks the store name, identifiers and the
 * API it talks to, so a white-labelled deployment is a build profile, not a
 * fork. Colours and the logo are NOT here: the app reads them at runtime from
 * the API's /branding (Settings > Branding), so an admin's change shows up
 * without a new build. Only what the stores bake in lives here.
 *
 *   BRAND=carelink npx expo start
 *   EXPO_PUBLIC_API_URL=http://192.168.1.10:3001 npx expo start   (a dev API on your network)
 */
interface Brand {
  /** Name under the icon and in the stores. */
  name: string;
  slug: string;
  /** Deep links: carelink://... */
  scheme: string;
  /**
   * PROVISIONAL. The real identifiers are chosen when Vivanti Health's Apple
   * and Google developer accounts exist (see the mobile app plan, section 9),
   * and can't be changed once an app is published under them.
   */
  bundleId: string;
  apiUrl: string;
  /**
   * The brand's Expo (EAS) project: the account that owns it and the project
   * id `eas init` prints. Needed for builds, push and over-the-air updates;
   * see BUILDING.md. Empty until Vivanti Health's Expo account is set up -
   * the app runs without them, just without push. EAS_PROJECT_ID / EXPO_OWNER
   * override them.
   */
  owner: string;
  easProjectId: string;
}

const BRANDS: Record<string, Brand> = {
  carelink: {
    name: 'CareLink',
    slug: 'carelink',
    scheme: 'carelink',
    bundleId: 'com.vivantihealth.carelink',
    apiUrl: 'https://find.caregivers.lk/api',
    owner: '',
    easProjectId: '',
  },
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const key = process.env.BRAND ?? 'carelink';
  const brand = BRANDS[key];
  if (!brand) throw new Error(`Unknown BRAND "${key}". Known: ${Object.keys(BRANDS).join(', ')}`);
  const projectId = process.env.EAS_PROJECT_ID || brand.easProjectId;
  const owner = process.env.EXPO_OWNER || brand.owner;
  // Android push goes through Firebase: EAS Build provides this file from the
  // GOOGLE_SERVICES_JSON file variable (BUILDING.md, step 4). Never committed.
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;

  return {
    ...config,
    name: brand.name,
    slug: brand.slug,
    scheme: brand.scheme,
    ...(owner ? { owner } : {}),
    // The store version people see (1.2.0). Raise it for each store release;
    // Settings > Mobile app compares against it. Build numbers are kept by EAS.
    version: '0.1.0',
    // Over-the-air updates only reach builds of the same version, so a JS
    // update never lands in an app without the native code it needs.
    runtimeVersion: { policy: 'appVersion' },
    ...(projectId ? { updates: { url: `https://u.expo.dev/${projectId}` } } : {}),
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    ios: { bundleIdentifier: brand.bundleId, supportsTablet: false },
    android: { package: brand.bundleId, ...(googleServicesFile ? { googleServicesFile } : {}) },
    plugins: [
      'expo-router',
      'expo-notifications',
      // "Use my location" on Find: while the app is open only, never in the background.
      ['expo-location', { locationWhenInUsePermission: `${brand.name} uses your location, only when you ask, to show caregivers near you.` }],
    ],
    // The iPhone permission message in Sinhala and Tamil (locales/*.json; English is above).
    locales: { si: './locales/si.json', ta: './locales/ta.json' },
    extra: {
      brand: key,
      brandName: brand.name,
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? brand.apiUrl,
      // Push needs the Expo (EAS) project's id; without it the app simply doesn't register for push.
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
