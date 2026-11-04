import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationsPage, NotificationsSummary } from '@care-platform/shared';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';

/**
 * The bell: its number and To do list, the notifications history, and
 * marking things read. Fresh when the app comes back to the front and when a
 * push arrives (PushRegistration invalidates it), and every minute while open.
 */

export const BELL_POLL_MS = 60_000;

export function useBellUser() {
  const { user } = useAuth();
  return user && (user.role === 'PATIENT_GUARDIAN' || user.role === 'CAREGIVER') ? user : null;
}

export const notificationsKey = (userId: string | null | undefined) => ['notifications', userId ?? 'none'] as const;

export function useNotificationsSummary() {
  const user = useBellUser();
  const queryClient = useQueryClient();
  // Back from the background: check at once rather than wait for the next minute.
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void queryClient.invalidateQueries({ queryKey: notificationsKey(user.userId) });
    });
    return () => sub.remove();
  }, [user, queryClient]);
  return useQuery({
    queryKey: [...notificationsKey(user?.userId), 'summary'],
    queryFn: () => api.get<NotificationsSummary>('/me/notifications/summary'),
    enabled: Boolean(user),
    refetchInterval: BELL_POLL_MS,
    staleTime: 15_000,
  });
}

export function useNotifications() {
  const user = useBellUser();
  const { locale } = useTranslation();
  return useInfiniteQuery({
    queryKey: [...notificationsKey(user?.userId), 'list', locale],
    queryFn: ({ pageParam }) => api.get<NotificationsPage>('/me/notifications', pageParam ? { before: pageParam } : undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(user),
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  const user = useBellUser();
  return useMutation({
    mutationFn: (body: { ids?: string[]; paths?: string[]; all?: boolean }) => api.post<{ marked: number }>('/me/notifications/read', body),
    onSuccess: (res) => {
      if (res?.marked) void queryClient.invalidateQueries({ queryKey: notificationsKey(user?.userId) });
    },
  });
}

/** Opening a screen about something clears its notices from the bell. */
export function useMarkPathsRead(paths: (string | null | undefined)[]) {
  const user = useBellUser();
  const { mutate } = useMarkRead();
  const list = paths.filter((p): p is string => Boolean(p)).join('|');
  useEffect(() => {
    if (user && list) mutate({ paths: list.split('|') });
  }, [user, list, mutate]);
}
