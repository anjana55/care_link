'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { SocialProviderSettings } from '../api/types';

/** Admin-only: the three providers' sign-in settings. */
export function useSocialAuthSettings() {
  return useQuery({
    queryKey: ['social-auth-settings'],
    queryFn: () => api.get<SocialProviderSettings[]>('/settings/social-auth'),
  });
}
