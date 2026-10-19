'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CaregiverRelation,
  ClientCareRequest,
  CreateCareRequestBody,
  SavedCaregiverItem,
  ClientBooking,
  ClientInvoice,
  PayhereCheckout,
} from '@care-platform/shared';
import { api, ApiError } from '../api/client';
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

/** The client's issued invoices (GET /me/invoices). Drafts never appear. */
export function useMyInvoices() {
  const client = useIsClient();
  const key = useClientKey();
  return useQuery({
    queryKey: [...key, 'invoices'],
    queryFn: () => api.get<ClientInvoice[]>('/me/invoices'),
    enabled: Boolean(client),
  });
}

/**
 * One invoice. `poll` re-reads it every few seconds - used right after the
 * client comes back from PayHere, while PayHere's confirmation is on its way
 * to the API (the browser's return proves nothing; that notification does).
 */
export function useMyInvoice(id: string, poll = false) {
  const client = useIsClient();
  const key = useClientKey();
  return useQuery({
    queryKey: [...key, 'invoices', id],
    queryFn: () => api.get<ClientInvoice>(`/me/invoices/${id}`),
    enabled: Boolean(client) && Boolean(id),
    // "Not yours / not there" won't change on a retry - show it straight away
    // instead of after React Query's three retries.
    retry: (count, err) => !(err instanceof ApiError && (err.status === 403 || err.status === 404)) && count < 3,
    refetchInterval: (q) => (poll && q.state.data?.status === 'ISSUED' ? 3000 : false),
  });
}

/** Starts a PayHere checkout for the balance; the caller posts the returned form to PayHere. */
export function useStartOnlinePayment(id: string) {
  return useMutation({
    mutationFn: (email?: string) => api.post<PayhereCheckout>(`/me/invoices/${id}/payhere`, email ? { email } : {}),
  });
}
