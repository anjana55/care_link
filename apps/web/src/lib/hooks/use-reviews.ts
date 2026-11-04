'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewSettings, StaffCaregiverRatings, StaffReview, StaffReviewFilter, StaffReviewList } from '@care-platform/shared';
import { api } from '../api/client';

const KEY = ['reviews'] as const;

/** ADMIN + STAFF: the moderation queue, one filter and page at a time. */
export function useStaffReviews(q: { filter: StaffReviewFilter; search?: string; page: number }) {
  return useQuery({
    queryKey: [...KEY, 'list', q],
    queryFn: () => api.get<StaffReviewList>('/reviews', { filter: q.filter, search: q.search || undefined, page: q.page, pageSize: 25 }),
  });
}

/** Written reviews waiting and low ratings, for the sidebar badge. Polled like the Requests badge. */
export function useReviewCounts(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'counts'],
    queryFn: () => api.get<StaffReviewList['counts']>('/reviews/counts'),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useCaregiverRatings(caregiverId: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'caregiver', caregiverId],
    queryFn: () => api.get<StaffCaregiverRatings>(`/reviews/caregivers/${caregiverId}`),
    enabled: enabled && Boolean(caregiverId),
  });
}

export function useBookingRatings(bookingId: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'booking', bookingId],
    queryFn: () => api.get<StaffReview[]>(`/reviews/bookings/${bookingId}`),
    enabled: enabled && Boolean(bookingId),
  });
}

export type ReviewAction = { id: string; action: 'approve-comment' } | { id: string; action: 'reject-comment' | 'hide'; reason: string } | { id: string; action: 'unhide' };

export function useReviewAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (a: ReviewAction) => api.post<StaffReview>(`/reviews/${a.id}/${a.action}`, 'reason' in a ? { reason: a.reason } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export type AdminReviewSettings = ReviewSettings & { updatedAt: string };

export function useReviewSettings() {
  return useQuery({ queryKey: [...KEY, 'settings'], queryFn: () => api.get<AdminReviewSettings>('/settings/reviews') });
}

export function useUpdateReviewSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ReviewSettings>) => api.patch<AdminReviewSettings>('/settings/reviews', body),
    onSuccess: (data) => queryClient.setQueryData([...KEY, 'settings'], data),
  });
}
