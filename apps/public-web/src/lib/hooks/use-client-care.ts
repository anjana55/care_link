'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CaregiverRelation,
  ClientCareRequest,
  CreateCareRequestBody,
  SavedCaregiverItem,
  ClientBooking,
} from '@care-platform/shared';
import { api } from '../api/client';
import { useAuth } from '../api/auth-context';
import { useTranslation } from '../i18n';

/**
 * The signed-in client's requests and shortlist (/me/... on the API).
 *
 * Everything is keyed under ['client', patientId] so signing out and in as
 * someone else on the same browser can never show the previous person's list
 * from cache, and one invalidation refreshes the lot.
 */
export function useIsClient() {
  const { user } = useAuth();
  return user?.role === 'PATIENT_GUARDIAN' ? user : null;
}

function useClientKey() {
  const client = useIsClient();
  return ['client', client?.patientId ?? null] as const;
}

function useInvalidateClient() {
  const queryClient = useQueryClient();
  const key = useClientKey();
  return () => queryClient.invalidateQueries({ queryKey: key });
}

export function useMyRequests() {
  const client = useIsClient();
  const { locale } = useTranslation();
  const key = useClientKey();
  return useQuery({
    // Locale in the key: the caregiver summaries name places in the visitor's language.
    queryKey: [...key, 'requests', locale],
    queryFn: () => api.get<ClientCareRequest[]>('/me/care-requests'),
    enabled: Boolean(client),
  });
}

export function useSavedCaregivers() {
  const client = useIsClient();
  const { locale } = useTranslation();
  const key = useClientKey();
  return useQuery({
    queryKey: [...key, 'saved', locale],
    queryFn: () => api.get<SavedCaregiverItem[]>('/me/saved-caregivers'),
    enabled: Boolean(client),
  });
}

/** Saved / open-request state for the caregivers currently on screen. */
export function useCaregiverRelations(publicIds: string[]) {
  const client = useIsClient();
  const key = useClientKey();
  const ids = [...new Set(publicIds)].sort();
  const query = useQuery({
    queryKey: [...key, 'relations', ids.join(',')],
    queryFn: () => api.get<CaregiverRelation[]>(`/me/caregiver-relations?publicIds=${encodeURIComponent(ids.join(','))}`),
    enabled: Boolean(client) && ids.length > 0,
  });
  const byId = new Map((query.data ?? []).map((r) => [r.caregiverPublicId, r]));
  return { ...query, byId };
}

export function useSendRequest() {
  const invalidate = useInvalidateClient();
  return useMutation({
    mutationFn: (body: CreateCareRequestBody) => api.post<ClientCareRequest>('/me/care-requests', body),
    onSuccess: () => invalidate(),
  });
}

export function useCancelRequest() {
  const invalidate = useInvalidateClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ClientCareRequest>(`/me/care-requests/${id}/cancel`, {}),
    onSuccess: () => invalidate(),
  });
}

export function useToggleSaved() {
  const invalidate = useInvalidateClient();
  return useMutation({
    mutationFn: ({ publicId, save }: { publicId: string; save: boolean }) =>
      save ? api.put<{ saved: boolean }>(`/me/saved-caregivers/${publicId}`, {}) : api.delete<{ saved: boolean }>(`/me/saved-caregivers/${publicId}`),
    onSuccess: () => invalidate(),
  });
}

/** The client's confirmed bookings and their shifts (GET /me/bookings). */
export function useMyBookings() {
  const client = useIsClient();
  const { locale } = useTranslation();
  const key = useClientKey();
  return useQuery({
    queryKey: [...key, 'bookings', locale],
    queryFn: () => api.get<ClientBooking[]>('/me/bookings'),
    enabled: Boolean(client),
  });
}
