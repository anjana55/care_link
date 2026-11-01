'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StaffAccountDeletion } from '@care-platform/shared';
import { api } from '../api/client';

const KEY = ['account-deletions'] as const;

/** ADMIN + STAFF: deletion requests, pending first. */
export function useAccountDeletions() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<StaffAccountDeletion[]>('/account-deletions') });
}

/** How many are waiting, for the sidebar badge. Polled like the Requests badge. */
export function useAccountDeletionSummary(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'summary'],
    queryFn: () => api.get<{ pending: number }>('/account-deletions/summary'),
    enabled,
    refetchInterval: 60_000,
  });
}

/** The waiting request for one caregiver or client, if they asked to delete their account. */
export function usePendingAccountDeletion(who: { caregiverId: string } | { patientId: string }, enabled = true) {
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api.get<StaffAccountDeletion[]>('/account-deletions'), enabled });
  return (
    data?.find(
      (r) => r.status === 'PENDING' && ('caregiverId' in who ? r.caregiverId === who.caregiverId : r.patientId === who.patientId),
    ) ?? null
  );
}

export function useCancelAccountDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/account-deletions/${id}/cancel`),
    // Everything that shows the account: the queue and badge, and the record it restores.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      void queryClient.invalidateQueries({ queryKey: ['caregivers'] });
      void queryClient.invalidateQueries({ queryKey: ['caregiver'] });
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      void queryClient.invalidateQueries({ queryKey: ['client'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}
