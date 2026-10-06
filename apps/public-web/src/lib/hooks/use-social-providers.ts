'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export type SocialProviderName = 'GOOGLE' | 'MICROSOFT' | 'FACEBOOK';

/**
 * Which of Google / Microsoft / Facebook this environment has credentials for.
 * Anonymous and secret-free. A failed lookup just means "show no provider
 * buttons" - it must never take the rest of the sign-in page down with it.
 */
export function useSocialProviders() {
  return useQuery({
    queryKey: ['social-providers'],
    queryFn: () => api.get<Record<SocialProviderName, boolean>>('/auth/social/providers'),
    retry: false,
    staleTime: 60_000,
  });
}
