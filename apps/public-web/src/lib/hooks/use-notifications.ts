'use client';

import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationsPage, NotificationsSummary } from '@care-platform/shared';
import { api } from '../api/client';
import { useAuth } from '../api/auth-context';
import { useTranslation } from '../i18n';

/**
 * The bell: its number and To do list (one cheap call, polled every minute
 * while the tab is visible and on focus), the notifications history, and
 * marking things read. Only clients and caregivers have a bell.
 */

/** How often the bell checks for news while the page is open. */
export const BELL_POLL_MS = 60_000;

export function useBellUser() {
  const { user } = useAuth();
  return user && (user.role === 'PATIENT_GUARDIAN' || user.role === 'CAREGIVER') ? user : null;
}

const key = (userId: string | null) => ['notifications', userId] as const;

export function useNotificationsSummary() {
  const user = useBellUser();
  return useQuery({
    queryKey: [...key(user?.userId ?? null), 'summary'],
    queryFn: () => api.get<NotificationsSummary>('/me/notifications/summary'),
    enabled: Boolean(user),
    refetchInterval: BELL_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useNotifications() {
  const user = useBellUser();
  const { locale } = useTranslation();
  return useInfiniteQuery({
    queryKey: [...key(user?.userId ?? null), 'list', locale],
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
      if (res?.marked) void queryClient.invalidateQueries({ queryKey: key(user?.userId ?? null) });
    },
  });
}

/**
 * Opening a page about something marks the notifications about it read -
 * an invoice page clears "Invoice issued" from the bell without a click on it.
 */
export function useMarkPathsRead(paths: (string | null | undefined)[]) {
  const user = useBellUser();
  const { mutate } = useMarkRead();
  const list = paths.filter((p): p is string => Boolean(p)).join('|');
  useEffect(() => {
    if (user && list) mutate({ paths: list.split('|') });
  }, [user, list, mutate]);
}
