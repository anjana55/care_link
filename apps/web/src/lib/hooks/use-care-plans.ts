'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CareChecklistShift,
  CareLogResponse,
  CarePlanResponse,
  CarePlanTemplateInput,
  CarePlanTemplateSummary,
  CarePlanTemplateView,
  CareRecordInput,
  CreateCarePlanInput,
  UpdateCarePlanInput,
} from '@care-platform/shared';
import { api } from '../api/client';

// --- templates ------------------------------------------------------------------------

export function useCarePlanTemplates(status: 'ACTIVE' | 'ARCHIVED' | 'ALL' = 'ACTIVE', enabled = true) {
  return useQuery({
    queryKey: ['care-plan-templates', 'list', status],
    queryFn: () => api.get<CarePlanTemplateSummary[]>(`/care-plan-templates?status=${status}`),
    enabled,
  });
}

export function useCarePlanTemplate(id: string) {
  return useQuery({
    queryKey: ['care-plan-templates', 'detail', id],
    queryFn: () => api.get<CarePlanTemplateView>(`/care-plan-templates/${id}`),
    enabled: Boolean(id) && id !== 'new',
  });
}

function useTemplateWrite<V>(fn: (v: V) => Promise<CarePlanTemplateView>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (t) => {
      queryClient.setQueryData(['care-plan-templates', 'detail', t.id], t);
      queryClient.invalidateQueries({ queryKey: ['care-plan-templates', 'list'] });
    },
  });
}

export const useCreateCarePlanTemplate = () => useTemplateWrite((v: CarePlanTemplateInput) => api.post<CarePlanTemplateView>('/care-plan-templates', v));
export const useUpdateCarePlanTemplate = (id: string) => useTemplateWrite((v: CarePlanTemplateInput) => api.put<CarePlanTemplateView>(`/care-plan-templates/${id}`, v));
export const useDuplicateCarePlanTemplate = () => useTemplateWrite((id: string) => api.post<CarePlanTemplateView>(`/care-plan-templates/${id}/duplicate`, {}));
export const useSetCarePlanTemplateStatus = (id: string) =>
  useTemplateWrite((status: 'ACTIVE' | 'ARCHIVED') => api.post<CarePlanTemplateView>(`/care-plan-templates/${id}/${status === 'ARCHIVED' ? 'archive' : 'restore'}`, {}));

// --- a booking's plan -------------------------------------------------------------------

export function useBookingCarePlan(bookingId: string, enabled = true) {
  return useQuery({
    queryKey: ['bookings', 'care-plan', bookingId],
    queryFn: () => api.get<CarePlanResponse>(`/bookings/${bookingId}/care-plan`),
    enabled: Boolean(bookingId) && enabled,
  });
}

function usePlanWrite<V>(bookingId: string, fn: (v: V) => Promise<CarePlanResponse>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res) => {
      queryClient.setQueryData(['bookings', 'care-plan', bookingId], res);
      queryClient.invalidateQueries({ queryKey: ['bookings', 'care-log', bookingId] });
      // The booking's history gains a care-plan entry.
      queryClient.invalidateQueries({ queryKey: ['bookings', 'detail', bookingId] });
    },
  });
}

export const useCreateCarePlan = (bookingId: string) => usePlanWrite(bookingId, (v: CreateCarePlanInput) => api.post<CarePlanResponse>(`/bookings/${bookingId}/care-plan`, v));
export const useUpdateCarePlan = (bookingId: string) => usePlanWrite(bookingId, (v: UpdateCarePlanInput) => api.put<CarePlanResponse>(`/bookings/${bookingId}/care-plan`, v));

export function useSaveCarePlanAsTemplate(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<CarePlanTemplateView>(`/bookings/${bookingId}/care-plan/save-as-template`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['care-plan-templates', 'list'] }),
  });
}

// --- the care log -------------------------------------------------------------------------

export function useCareLog(bookingId: string, range: { from?: string; to?: string }, enabled = true) {
  const q = new URLSearchParams();
  if (range.from) q.set('from', range.from);
  if (range.to) q.set('to', range.to);
  const qs = q.toString();
  return useQuery({
    queryKey: ['bookings', 'care-log', bookingId, range],
    queryFn: () => api.get<CareLogResponse>(`/bookings/${bookingId}/care-log${qs ? `?${qs}` : ''}`),
    enabled: Boolean(bookingId) && enabled,
  });
}

export function useCorrectCareRecord(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: CareRecordInput) => api.put<CareChecklistShift>(`/bookings/${bookingId}/care-log/records`, v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookings', 'care-log', bookingId] }),
  });
}
