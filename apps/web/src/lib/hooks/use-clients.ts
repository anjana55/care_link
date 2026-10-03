'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Client, ClientListResponse, ClientStatus } from '../api/types';

export interface ClientFilters {
  search?: string;
  status?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

function buildClientQuery(filters: ClientFilters): string {
  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.status) query.set('status', filters.status);
  if (filters.isActive !== undefined) query.set('isActive', String(filters.isActive));
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