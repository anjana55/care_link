'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SendCareOfferInput, StaffCareOffer } from '@care-platform/shared';
import { api } from '../api/client';

const key = (requestId: string) => ['care-offers', requestId] as const;

/** The offers sent on one request. Refetched while open: a caregiver may answer at any moment. */
export function useRequestOffers(requestId: string) {
  return useQuery({ queryKey: key(requestId), queryFn: () => api.get<StaffCareOffer[]>(`/care-requests/${requestId}/offers`), enabled: Boolean(requestId), refetchInterval: 30_000 });
}

export function useSendOffer(requestId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendCareOfferInput) => api.post<StaffCareOffer[]>(`/care-requests/${requestId}/offers`, input),
    onSuccess: (data) => queryClient.setQueryData(key(requestId), data),
  });
}

export function useWithdrawOffer(requestId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (offerId: string) => api.post<StaffCareOffer[]>(`/care-requests/${requestId}/offers/${offerId}/withdraw`, {}),
    onSuccess: (data) => queryClient.setQueryData(key(requestId), data),
  });
}

/** The offer the request's caregiver accepted, for the booking form's rates. */
export function useAcceptedOffer(requestId: string) {
  return useQuery({
    queryKey: ['care-offer-accepted', requestId],
    queryFn: () => api.get<{ offer: StaffCareOffer | null }>(`/care-requests/${requestId}/offers/accepted`),
    enabled: Boolean(requestId),
  });
}
