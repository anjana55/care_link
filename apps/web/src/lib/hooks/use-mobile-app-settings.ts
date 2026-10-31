'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppConfig, AppPlatform } from '@care-platform/shared';
import { api } from '../api/client';

/** Settings > Mobile app as the admin sees it. */
export type MobileAppSettings = AppConfig & { updatedAt: string };

/** Per platform: what the form sends back. An empty string clears a field. */
export type MobileAppSettingsInput = Partial<Record<AppPlatform, { minimumVersion?: string; latestVersion?: string; storeUrl?: string }>>;

const KEY = ['mobile-app-settings'] as const;

/** Admin-only. */
export function useMobileAppSettings() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<MobileAppSettings>('/settings/mobile-app') });
}

export function useUpdateMobileAppSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: MobileAppSettingsInput) => api.patch<MobileAppSettings>('/settings/mobile-app', v),
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
  });
}
