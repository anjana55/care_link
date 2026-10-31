import Constants from 'expo-constants';

/**
 * Build-time settings from app.config.ts (per brand). The API address can be
 * overridden for development with EXPO_PUBLIC_API_URL.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; brandName?: string };

export const config = {
  apiUrl: (extra.apiUrl ?? 'https://find.caregivers.lk/api').replace(/\/+$/, ''),
  /** The name to show before the deployment's own branding has loaded. */
  brandName: extra.brandName ?? 'CareLink',
};
