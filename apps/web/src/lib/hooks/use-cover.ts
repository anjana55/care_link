'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SendCoverOffersInput, ShiftCover } from '@care-platform/shared';
import { api } from '@/lib/api/client';

const key = (shiftId: string) => ['visits', 'cover', shiftId] as const;

/** One shift's cover: who has been asked and who else could take it. Refetched while open - a caregiver may answer at any moment. */
export function useShiftCover(shiftId: string, enabled = true) {
  return useQuery({ queryKey: key(shiftId), queryFn: () => api.get<ShiftCover>(`/visits/${shiftId}/cover`), enabled, refetchInterval: 20_000 });
}

function useCoverChange<T>(shiftId: string, run: (input: T) => Promise<ShiftCover>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (data) => {
      queryClient.setQueryData(key(shiftId), data);
      queryClient.invalidateQueries({ queryKey: ['visits', 'today'] });
      queryClient.invalidateQueries({ queryKey: ['bookings', 'detail'] });
    },
  });
}

export function useSendCoverOffers(shiftId: string) {
  return useCoverChange(shiftId, (input: SendCoverOffersInput) => api.post<ShiftCover>(`/visits/${shiftId}/cover/offers`, input));
}

export function useWithdrawCoverOffer(shiftId: string) {
  return useCoverChange(shiftId, (offerId: string) => api.post<ShiftCover>(`/visits/${shiftId}/cover/offers/${offerId}/withdraw`, {}));
}
