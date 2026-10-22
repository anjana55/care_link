'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

/** Settings > Ads as the admin sees it. */
export interface AdsSettings {
  enabled: boolean;
  publisherId: string | null;
  slotHome: string | null;
  slotSearch: string | null;
  slotProfile: string | null;
  /** The line the public site serves at /ads.txt; null until there is a publisher ID. */
  adsTxt: string | null;
  updatedAt: string;
}

export interface AdsSettingsInput {
  enabled?: boolean;
  publisherId?: string;
  slotHome?: string;
  slotSearch?: string;
  slotProfile?: string;
}

const KEY = ['ads-settings'] as const;

/** Admin-only. */
export function useAdsSettings() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<AdsSettings>('/settings/ads') });
}

export function useUpdateAdsSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: AdsSettingsInput) => api.patch<AdsSettings>('/settings/ads', v),
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
  });
}
