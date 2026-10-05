'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Client, ClientListResponse, ClientStatus, ClientGender } from '../api/types';

/** The body of PATCH /patients/:id. Every field is optional - the service
 * writes only what is named, and a blank phone is a no-op rather than a clear,
 * so `phone` and `dateOfBirth` are omitted rather than sent as ''. */
export interface ClientUpdateValues {
  fullName?: string;
  email?: string;
  phone?: string;
  permanentAddress?: string;
  nic?: string;
  dateOfBirth?: string;
  gender?: ClientGender;
  districtId?: number;
  cityId?: number;
  notes?: string;
}

export interface ClientFilters {
  search?: string;
  status?: string;
  isActive?: boolean;
  /** Intake facets. These match nothing on rows registered before the intake
   * form existed, so a filtered list legitimately drops those clients. */
  districtId?: number;
  cityId?: number;
  careSchedule?: string;
  careStart?: string;
  contactMethod?: string;
  registrantType?: string;
  verification?: 'VERIFIED' | 'UNVERIFIED';
  page?: number;
  pageSize?: number;
}

function buildClientQuery(filters: ClientFilters): string {
  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.status) query.set('status', filters.status);
  if (filters.isActive !== undefined) query.set('isActive', String(filters.isActive));
  if (filters.districtId) query.set('districtId', String(filters.districtId));
  if (filters.cityId) query.set('cityId', String(filters.cityId));
  if (filters.careSchedule) query.set('careSchedule', filters.careSchedule);
  if (filters.careStart) query.set('careStart', filters.careStart);
  if (filters.contactMethod) query.set('contactMethod', filters.contactMethod);
  if (filters.registrantType) query.set('registrantType', filters.registrantType);
  if (filters.verification) query.set('verification', filters.verification);
  query.set('page', String(filters.page ?? 1));
  query.set('pageSize', String(filters.pageSize ?? 20));
  return query.toString();
}

export function useClients(filters: ClientFilters) {
  return useQuery({
    queryKey: ['clients', filters],
    queryFn: () => api.get<ClientListResponse>(`/patients?${buildClientQuery(filters)}`),
  });
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: ['client', id],
    queryFn: () => api.get<Client>(`/patients/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdateClientStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: ClientStatus) => api.patch<Client>(`/patients/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

/** Staff edit of a client's details (PATCH /patients/:id).
 *
 * The form must OMIT a blank phone or dateOfBirth rather than sending `''`:
 * the API rejects an empty date string outright, and treats a blank phone as
 * "not submitted" - clearing a WhatsApp-only client's number would leave them
 * with no way to sign in and no endpoint that could undo it. */
export function useUpdateClient(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ClientUpdateValues) => api.patch<Client>(`/patients/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

/** Admin-only: flips the login account's active flag (ADMIN gating is
 * enforced server-side by @Roles('ADMIN') on PATCH /patients/:id/active). */
export function useSetClientActive(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (isActive: boolean) => api.patch<Client>(`/patients/${id}/active`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/patients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}
