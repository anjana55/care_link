'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  AmendBookingInput,
  AmendmentPreview,
  BillingAdjustmentView,
  BookingCorrections,
  BookingDetail,
  BookingListResponse,
  BookingStatus,
  BookingSummary,
  CreateBookingInput,
  ShiftRateInput,
  ShiftStatus,
  UpdateBookingInput,
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
export const useUpdateBooking = (id: string) => useBookingWrite(id, (v: UpdateBookingInput) => api.patch<BookingDetail>(`/bookings/${id}`, v));
export const useAddShift = (id: string) =>
  useBookingWrite(id, (v: { start: string; end: string; caregiverId?: string; note?: string } & ShiftRateInput) => api.post<BookingDetail>(`/bookings/${id}/shifts`, v));
export const useUpdateShift = (id: string) =>
  useBookingWrite(id, ({ shiftId, ...v }: { shiftId: string; start?: string; end?: string; caregiverId?: string; status?: ShiftStatus; note?: string | null } & ShiftRateInput) =>
    api.patch<BookingDetail>(`/bookings/${id}/shifts/${shiftId}`, v),
  );
export const useRemoveShift = (id: string) => useBookingWrite(id, (shiftId: string) => api.delete<BookingDetail>(`/bookings/${id}/shifts/${shiftId}`));

// --- corrections ---------------------------------------------------------------------

export function useBookingCorrections(id: string) {
  return useQuery({
    queryKey: ['bookings', 'corrections', id],
    queryFn: () => api.get<BookingCorrections>(`/bookings/${id}/amendments`),
    enabled: Boolean(id),
  });
}

/** What a correction would do. Writes nothing, so it touches no cache. */
export function usePreviewCorrection(id: string) {
  return useMutation({ mutationFn: (input: AmendBookingInput) => api.post<AmendmentPreview>(`/bookings/${id}/amendments/preview`, input) });
}

export function useApplyCorrection(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AmendBookingInput) => api.post<BookingDetail>(`/bookings/${id}/amendments`, input),
    onSuccess: (detail) => {
      queryClient.setQueryData(['bookings', 'detail', id], detail);
      queryClient.invalidateQueries({ queryKey: ['bookings', 'corrections', id] });
      queryClient.invalidateQueries({ queryKey: ['bookings', 'list'] });
      // Invoices and pay statements may have been refreshed, replaced or noted.
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
    },
  });
}

/** Settle (dealt with outside the documents) or cancel an open adjustment. */
export function useCloseAdjustment(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, outcome, reason }: { id: string; outcome: 'settle' | 'cancel'; reason: string }) =>
      api.post<BillingAdjustmentView>(`/billing-adjustments/${id}/${outcome}`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookings', 'corrections', bookingId] }),
  });
}
