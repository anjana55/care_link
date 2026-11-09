import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CaregiverOwnRatings, PublicReviewsPage, ReviewSubmitBody, ReviewableCaregiver } from '@care-platform/shared';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { useClient } from '@/care/api';

/**
 * Ratings, as on the website: a client rating the caregivers who cared for
 * them, the reviews on a public profile, and a caregiver's own ratings. The
 * client's sit under ['client-care', userId] with their bookings, so one
 * refresh (pull down on Bookings, or a new rating) updates both.
 */
const careKey = (userId: string | undefined) => ['client-care', userId ?? 'none'] as const;

export function usePendingReviews() {
  const client = useClient();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: [...careKey(client?.userId), 'reviews', 'pending', locale],
    queryFn: () => api.get<ReviewableCaregiver[]>('/me/reviews/pending'),
    enabled: Boolean(client),
  });
}

export function useBookingReview(bookingId: string | null, publicId: string | null) {
  const client = useClient();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: [...careKey(client?.userId), 'reviews', bookingId, publicId, locale],
    queryFn: () => api.get<ReviewableCaregiver>(`/me/bookings/${bookingId}/reviews/${publicId}`),
    enabled: Boolean(client && bookingId && publicId),
  });
}

export function useSubmitReview(bookingId: string, publicId: string) {
  const queryClient = useQueryClient();
  const client = useClient();
  return useMutation({
    mutationFn: (body: ReviewSubmitBody) => api.put<ReviewableCaregiver>(`/me/bookings/${bookingId}/reviews/${publicId}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: careKey(client?.userId) }),
  });
}

export function useDeleteReview(bookingId: string, publicId: string) {
  const queryClient = useQueryClient();
  const client = useClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`/me/bookings/${bookingId}/reviews/${publicId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: careKey(client?.userId) }),
  });
}

/** Approved reviews on a public profile, a page at a time. Works signed out. */
export function usePublicReviews(publicId: string | null) {
  const { locale } = useTranslation();
  return useInfiniteQuery({
    queryKey: ['public-reviews', publicId, locale],
    queryFn: ({ pageParam }) => api.request<PublicReviewsPage>(`/public/caregivers/${publicId}/reviews`, { params: { page: pageParam, locale }, anonymous: true }),
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
    queryKey: ['caregiver', user?.userId ?? 'none', 'ratings', locale],
    queryFn: () => api.get<CaregiverOwnRatings>('/me/reviews'),
    enabled: user?.role === 'CAREGIVER',
  });
}
