'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

/** Settings > Analytics as the admin sees it. */
export interface AnalyticsSettings {
  enabled: boolean;
  measurementId: string | null;
  updatedAt: string;
}

export interface AnalyticsSettingsInput {
  enabled?: boolean;
  measurementId?: string;
}

const KEY = ['analytics-settings'] as const;

/** Admin-only. */
export function useAnalyticsSettings() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<AnalyticsSettings>('/settings/analytics') });
}

export function useUpdateAnalyticsSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: AnalyticsSettingsInput) => api.patch<AnalyticsSettings>('/settings/analytics', v),
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
  });
}
