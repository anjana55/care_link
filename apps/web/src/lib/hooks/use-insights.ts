'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { BusinessInsights, InsightRange, Locale } from '@care-platform/shared';
import { api } from '../api/client';

/** The dashboard's business vital signs. Refreshes every five minutes while open; switching range keeps the old numbers on screen until the new ones land. */
export function useBusinessInsights(range: InsightRange, locale: Locale, enabled = true) {
  return useQuery({
    queryKey: ['insights', 'overview', range, locale],
    queryFn: () => api.get<BusinessInsights>('/insights/overview', { range, locale }),
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}
