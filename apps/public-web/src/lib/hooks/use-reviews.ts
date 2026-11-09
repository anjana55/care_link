'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CaregiverOwnRatings, PublicReviewsPage, ReviewSubmitBody, ReviewableCaregiver } from '@care-platform/shared';
import { api } from '../api/client';
import { useAuth } from '../api/auth-context';
import { useTranslation } from '../i18n';
import { useIsClient } from './use-client-care';

/**
 * Ratings on the public site: the client rating the caregivers who cared for
 * them, the reviews on a public profile, and a caregiver's own ratings.
 * The client's are keyed under ['client', patientId] like the rest of their
 * account, so one invalidation refreshes bookings and ratings together.
 */

/** Caregivers the client can rate now and hasn't yet - the banner on Bookings. */
export function usePendingReviews() {
  const client = useIsClient();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: ['client', client?.patientId ?? null, 'reviews', 'pending', locale],
    queryFn: () => api.get<ReviewableCaregiver[]>('/me/reviews/pending'),
    enabled: Boolean(client),
  });
}

/** One caregiver on one booking, with the client's review of them if any. */
export function useBookingReview(bookingId: string, publicId: string) {
  const client = useIsClient();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: ['client', client?.patientId ?? null, 'reviews', bookingId, publicId, locale],
    queryFn: () => api.get<ReviewableCaregiver>(`/me/bookings/${bookingId}/reviews/${publicId}`),
    enabled: Boolean(client) && Boolean(bookingId) && Boolean(publicId),
  });
}

export function useSubmitReview(bookingId: string, publicId: string) {
  const queryClient = useQueryClient();
  const client = useIsClient();
  return useMutation({
    mutationFn: (body: ReviewSubmitBody) => api.put<ReviewableCaregiver>(`/me/bookings/${bookingId}/reviews/${publicId}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client', client?.patientId ?? null] }),
  });
}

export function useDeleteReview(bookingId: string, publicId: string) {
  const queryClient = useQueryClient();
  const client = useIsClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`/me/bookings/${bookingId}/reviews/${publicId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client', client?.patientId ?? null] }),
  });
}

/** Approved reviews on a public profile, a page at a time. */
export function usePublicReviews(publicId: string) {
  const { locale } = useTranslation();
  return useInfiniteQuery({
    queryKey: ['public-reviews', publicId, locale],
    queryFn: ({ pageParam }) => api.get<PublicReviewsPage>(`/public/caregivers/${publicId}/reviews`, { page: pageParam, locale }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: Boolean(publicId),
  });
}

/** The signed-in caregiver's own ratings. */
export function useMyRatings() {
  const { user } = useAuth();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: ['caregiver', user?.caregiverId ?? null, 'ratings', locale],
    queryFn: () => api.get<CaregiverOwnRatings>('/me/reviews'),
    enabled: user?.role === 'CAREGIVER',
  });
}
