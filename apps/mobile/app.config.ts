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
}

const BRANDS: Record<string, Brand> = {
  carelink: {
    name: 'CareLink',
    slug: 'carelink',
    scheme: 'carelink',
    bundleId: 'com.vivantihealth.carelink',
    apiUrl: 'https://find.caregivers.lk/api',
  },
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const key = process.env.BRAND ?? 'carelink';
  const brand = BRANDS[key];
  if (!brand) throw new Error(`Unknown BRAND "${key}". Known: ${Object.keys(BRANDS).join(', ')}`);

  return {
    ...config,
    name: brand.name,
    slug: brand.slug,
    scheme: brand.scheme,
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    ios: { bundleIdentifier: brand.bundleId, supportsTablet: false },
    android: { package: brand.bundleId },
    plugins: ['expo-router'],
    extra: {
      brand: key,
      brandName: brand.name,
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? brand.apiUrl,
    },
  };
};
