'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CareType, CareTypePricing, CaregiverRateCard } from '@care-platform/shared';
import { api } from '../api/client';

const PRICING = ['pricing-settings'] as const;
const card = (caregiverId: string) => ['caregiver-rates', caregiverId] as const;

/** Settings > Rates and fees. Staff may read it; only an admin's save is accepted. */
export function usePricing(enabled = true) {
  return useQuery({ queryKey: PRICING, queryFn: () => api.get<CareTypePricing[]>('/settings/pricing'), enabled });
}

export function useUpdatePricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { careType: CareType; values: Partial<Omit<CareTypePricing, 'careType'>> }) => api.patch<CareTypePricing[]>(`/settings/pricing/${v.careType}`, v.values),
    onSuccess: (data) => {
      queryClient.setQueryData(PRICING, data);
      // Every rate card shows the band and the client's price.
      queryClient.invalidateQueries({ queryKey: ['caregiver-rates'] });
    },
  });
}

export function useCaregiverRates(caregiverId: string | undefined) {
  return useQuery({ queryKey: card(caregiverId ?? ''), queryFn: () => api.get<CaregiverRateCard>(`/caregivers/${caregiverId}/rates`), enabled: Boolean(caregiverId) });
}

export function useSaveCaregiverRates(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rates: { careType: CareType; amount: number | null }[]) => api.put<CaregiverRateCard>(`/caregivers/${caregiverId}/rates`, { rates }),
    onSuccess: (data) => queryClient.setQueryData(card(caregiverId), data),
  });
}
