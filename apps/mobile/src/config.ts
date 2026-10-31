import Constants from 'expo-constants';

/**
 * Build-time settings from app.config.ts (per brand). The API address can be
 * overridden for development with EXPO_PUBLIC_API_URL.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; brandName?: string };

const apiUrl = (extra.apiUrl ?? 'https://find.caregivers.lk/api').replace(/\/+$/, '');

export const config = {
  apiUrl,
  /** The public website: the API sits under its /api, so the site is the API address without it. */
  siteUrl: apiUrl.replace(/\/api$/, ''),
  /** The name to show before the deployment's own branding has loaded. */
  brandName: extra.brandName ?? 'CareLink',
};
