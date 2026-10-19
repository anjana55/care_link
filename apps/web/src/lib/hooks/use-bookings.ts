'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  BookingDetail,
  BookingListResponse,
  BookingPatternInput,
  BookingStatus,
  BookingSummary,
  CreateBookingInput,
  RateType,
  ShiftStatus,
} from '../api/types';

export interface BookingFilters {
  status?: BookingStatus;
  search?: string;
  patientId?: string;
  caregiverId?: string;
  careRequestId?: string;
  page?: number;
  pageSize?: number;
}

const qs = (f: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export function useBookings(filters: BookingFilters, enabled = true) {
  return useQuery({
    queryKey: ['bookings', 'list', filters],
    queryFn: () => api.get<BookingListResponse>(`/bookings${qs(filters as Record<string, unknown>)}`),
    enabled,
  });
}

export function useBookingSummary(enabled = true) {
  return useQuery({
    queryKey: ['bookings', 'summary'],
    queryFn: () => api.get<BookingSummary>('/bookings/summary'),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useBooking(id: string) {
  return useQuery({
    queryKey: ['bookings', 'detail', id],
    queryFn: () => api.get<BookingDetail>(`/bookings/${id}`),
    enabled: Boolean(id),
  });
}

function useBookingWrite<V>(id: string, fn: (v: V) => Promise<BookingDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      queryClient.setQueryData(['bookings', 'detail', id], detail);
      queryClient.invalidateQueries({ queryKey: ['bookings', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['bookings', 'summary'] });
      // Confirming closes the linked request.
      queryClient.invalidateQueries({ queryKey: ['care-requests'] });
    },
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBookingInput) => api.post<BookingDetail>('/bookings', input),
    onSuccess: (detail) => {
      queryClient.setQueryData(['bookings', 'detail', detail.id], detail);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export const useConfirmBooking = (id: string) => useBookingWrite(id, () => api.post<BookingDetail>(`/bookings/${id}/confirm`, {}));
export const useCancelBooking = (id: string) => useBookingWrite(id, (reason: string) => api.post<BookingDetail>(`/bookings/${id}/cancel`, { reason }));
export const useCompleteBooking = (id: string) => useBookingWrite(id, () => api.post<BookingDetail>(`/bookings/${id}/complete`, {}));
export const useExtendBooking = (id: string) => useBookingWrite(id, (endDate: string) => api.post<BookingDetail>(`/bookings/${id}/extend`, { endDate }));
export const useAddBookingNote = (id: string) => useBookingWrite(id, (note: string) => api.post<BookingDetail>(`/bookings/${id}/notes`, { note }));
export const useUpdateBooking = (id: string) =>
  useBookingWrite(id, (v: { rateType?: RateType | null; rateAmount?: string | null; payRateType?: RateType | null; payRateAmount?: string | null; notes?: string; pattern?: BookingPatternInput }) =>
    api.patch<BookingDetail>(`/bookings/${id}`, v),
  );
export const useAddShift = (id: string) =>
  useBookingWrite(id, (v: { start: string; end: string; caregiverId?: string; note?: string }) => api.post<BookingDetail>(`/bookings/${id}/shifts`, v));
export const useUpdateShift = (id: string) =>
  useBookingWrite(id, ({ shiftId, ...v }: { shiftId: string; start?: string; end?: string; caregiverId?: string; status?: ShiftStatus; note?: string | null }) =>
    api.patch<BookingDetail>(`/bookings/${id}/shifts/${shiftId}`, v),
  );
export const useRemoveShift = (id: string) => useBookingWrite(id, (shiftId: string) => api.delete<BookingDetail>(`/bookings/${id}/shifts/${shiftId}`));
