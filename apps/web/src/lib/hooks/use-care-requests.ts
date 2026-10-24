'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  CareRequestCloseReason,
  CareRequestDetail,
  CareRequestListResponse,
  CareRequestStatus,
  CareRequestSummary,
  CreatePhoneRequestInput,
  StaffRef,
} from '../api/types';

export interface CareRequestFilters {
  status?: CareRequestStatus;
  scope?: 'open';
  search?: string;
  assigned?: 'me' | 'unassigned';
  patientId?: string;
  caregiverId?: string;
  unmatched?: boolean;
  source?: 'WEB' | 'PHONE';
  page?: number;
  pageSize?: number;
}

function buildQuery(filters: CareRequestFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

export function useCareRequests(filters: CareRequestFilters, enabled = true) {
  return useQuery({
    queryKey: ['care-requests', 'list', filters],
    queryFn: () => api.get<CareRequestListResponse>(`/care-requests${buildQuery(filters)}`),
    enabled,
  });
}

/**
 * Counts for the sidebar badge and dashboard. Polled, so a new request shows up
 * for whoever has the staff app open without them reloading.
 */
export function useCareRequestSummary(enabled = true) {
  return useQuery({
    queryKey: ['care-requests', 'summary'],
    queryFn: () => api.get<CareRequestSummary>('/care-requests/summary'),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useCareRequest(id: string) {
  return useQuery({
    queryKey: ['care-requests', 'detail', id],
    queryFn: () => api.get<CareRequestDetail>(`/care-requests/${id}`),
    enabled: Boolean(id),
  });
}

export function useAssignableStaff() {
  return useQuery({
    queryKey: ['care-requests', 'assignable-staff'],
    queryFn: () => api.get<StaffRef[]>('/care-requests/assignable-staff'),
    staleTime: 5 * 60_000,
  });
}

/** Every write returns the fresh detail; seed it and refresh lists and counts. */
function useRequestWrite<V, R extends CareRequestDetail = CareRequestDetail>(id: string, fn: (values: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      queryClient.setQueryData(['care-requests', 'detail', id], detail);
      queryClient.invalidateQueries({ queryKey: ['care-requests', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['care-requests', 'summary'] });
    },
  });
}

export function useUpdateCareRequestStatus(id: string) {
  return useRequestWrite(id, (values: { status: CareRequestStatus; closeReason?: CareRequestCloseReason; note?: string }) =>
    api.patch<CareRequestDetail>(`/care-requests/${id}/status`, values),
  );
}

export function useAddCareRequestNote(id: string) {
  return useRequestWrite(id, (note: string) => api.post<CareRequestDetail>(`/care-requests/${id}/notes`, { note }));
}

export function useAssignCareRequest(id: string) {
  return useRequestWrite(id, (userId: string | null) => api.patch<CareRequestDetail>(`/care-requests/${id}/assign`, { userId }));
}

/** A request taken during a phone call (POST /care-requests). */
export function useCreatePhoneRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePhoneRequestInput) => api.post<CareRequestDetail>('/care-requests', input),
    onSuccess: (detail) => {
      queryClient.setQueryData(['care-requests', 'detail', detail.id], detail);
      queryClient.invalidateQueries({ queryKey: ['care-requests', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['care-requests', 'summary'] });
      // A new caller is a new client.
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

/** "Notify caregiver": tells the attached caregiver about the request now. */
export function useNotifyCareRequestCaregiver(id: string) {
  return useRequestWrite(id, () => api.post<CareRequestDetail & { notifiedBy: 'EMAIL' | 'WHATSAPP' }>(`/care-requests/${id}/notify-caregiver`, {}));
}

export function useSetCareRequestCaregiver(id: string) {
  return useRequestWrite(id, (caregiverId: string | null) => api.patch<CareRequestDetail>(`/care-requests/${id}/caregiver`, { caregiverId }));
}
