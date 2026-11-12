import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CareChecklistShift, CareRecordInput, ClientBooking, ClientBookingProposal, ClientCareDay } from '@care-platform/shared';
import { api } from '@/api';
import { useTranslation } from '@/i18n';
import { useClient } from './api';

/** The client's bookings and the day's care checklist (the website's /account/bookings). */
const key = (userId: string | undefined) => ['client-care', userId ?? 'none'] as const;

export function useMyBookings() {
  const client = useClient();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: [...key(client?.userId), 'bookings', locale],
    queryFn: () => api.get<ClientBooking[]>('/me/bookings'),
    enabled: Boolean(client),
  });
}

/** One day's checklist; null `date` is today (the API decides what today is, in Sri Lanka). */
export function useCareDay(date: string | null) {
  const client = useClient();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: [...key(client?.userId), 'care', date ?? 'today', locale],
    queryFn: () => api.get<ClientCareDay>('/me/care', date ? { date } : undefined),
    enabled: Boolean(client),
  });
}

/** Marks one item Done or Not done; the answer is the shift as it now stands, put straight into the day. */
export function useMarkCareItem(date: string | null) {
  const queryClient = useQueryClient();
  const client = useClient();
  const { locale } = useTranslation();
  return useMutation({
    mutationFn: (body: CareRecordInput) => api.put<CareChecklistShift>('/me/care/records', body),
    onSuccess: (shift) =>
      queryClient.setQueryData<ClientCareDay>([...key(client?.userId), 'care', date ?? 'today', locale], (day) =>
        day ? { ...day, shifts: day.shifts.map((s) => (s.shiftId === shift.shiftId ? shift : s)) } : day,
      ),
  });
}

/** The 8 pm reminder about unmarked items: on or off. */
export function useSetCareReminders() {
  const queryClient = useQueryClient();
  const client = useClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.put<{ reminders: boolean }>('/me/care/reminders', { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...key(client?.userId), 'care'] }),
  });
}

/** Draft bookings the office has asked this client to check (GET /me/booking-proposals). */
export function useBookingProposals() {
  const client = useClient();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: [...key(client?.userId), 'booking-proposals', locale],
    queryFn: () => api.get<ClientBookingProposal[]>('/me/booking-proposals'),
    enabled: Boolean(client),
  });
}

/** Accept a draft as it is, or say what should change. Either way the list is refreshed - also after a refusal, which means it was out of date. */
export function useAnswerBookingProposal() {
  const queryClient = useQueryClient();
  const client = useClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      note === undefined
        ? api.post<ClientBookingProposal[]>(`/me/booking-proposals/${id}/accept`, {})
        : api.post<ClientBookingProposal[]>(`/me/booking-proposals/${id}/request-changes`, { note }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...key(client?.userId), 'booking-proposals'] }),
  });
}
