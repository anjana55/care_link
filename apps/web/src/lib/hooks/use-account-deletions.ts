'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StaffAccountDeletion } from '@care-platform/shared';
import { api } from '../api/client';

const KEY = ['account-deletions'] as const;

/** ADMIN + STAFF: deletion requests, pending first. */
export function useAccountDeletions() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<StaffAccountDeletion[]>('/account-deletions') });
}

export function useCancelAccountDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/account-deletions/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
