'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Locale, PublicBranding } from '@care-platform/shared';
import { api } from '../api/client';
import { BRANDING_QUERY_KEY } from '../branding/provider';

/** Settings > Branding as the admin sees it: the public branding plus the logo's type. */
export interface BrandingSettings extends PublicBranding {
  logoMimeType: string | null;
  updatedAt: string;
}

export interface BrandingSettingsInput {
  companyName?: string;
  shortName?: string;
  tagline?: string;
  primaryColor?: string;
  accentColor?: string;
  defaultLocale?: Locale;
  enabledLocales?: Locale[];
}

const KEY = ['branding-settings'] as const;

/** Admin-only. */
export function useBrandingSettings() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<BrandingSettings>('/settings/branding') });
}

/**
 * Every change also refreshes the app-wide branding, so the staff app repaints
 * itself - name, colours, logo, languages - the moment a save lands.
 */
function useBrandingMutation<V>(fn: (v: V) => Promise<BrandingSettings>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
      void queryClient.invalidateQueries({ queryKey: BRANDING_QUERY_KEY });
    },
  });
}

export function useUpdateBrandingSettings() {
  return useBrandingMutation((v: BrandingSettingsInput) => api.patch<BrandingSettings>('/settings/branding', v));
}

export function useUploadLogo() {
  return useBrandingMutation((file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<BrandingSettings>('/settings/branding/logo', form);
  });
}

export function useRemoveLogo() {
  return useBrandingMutation(() => api.delete<BrandingSettings>('/settings/branding/logo'));
}
