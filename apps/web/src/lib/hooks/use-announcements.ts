'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Announcement, AnnouncementAudience, NotificationSettings } from '@care-platform/shared';
import { api } from '../api/client';

const KEY = ['announcements'] as const;

export interface AnnouncementBody {
  audience: AnnouncementAudience;
  en: { title: string; body: string };
  si?: { title?: string; body?: string };
  ta?: { title?: string; body?: string };
  link?: string | null;
  important?: boolean;
  sendPush?: boolean;
  sendWhatsapp?: boolean;
}

/** ADMIN + STAFF: the office's messages to clients and caregivers, newest first. */
export function useAnnouncements(enabled = true) {
  return useQuery({ queryKey: [...KEY, 'list'], queryFn: () => api.get<Announcement[]>('/announcements'), enabled });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: KEY });
}

export function useSaveAnnouncement() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: AnnouncementBody }) =>
      id ? api.patch<Announcement>(`/announcements/${id}`, body) : api.post<Announcement>('/announcements', body),
    onSuccess: () => invalidate(),
  });
}

export function usePublishAnnouncement() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.post<Announcement>(`/announcements/${id}/publish`), onSuccess: () => invalidate() });
}

export function useDeleteAnnouncement() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.delete<void>(`/announcements/${id}`), onSuccess: () => invalidate() });
}

/** Settings > Notifications (admin). */
export function useNotificationSettings(enabled = true) {
  return useQuery({
    queryKey: ['settings', 'notifications'],
    queryFn: () => api.get<NotificationSettings & { updatedAt: string }>('/settings/notifications'),
    enabled,
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<NotificationSettings>) => api.patch<NotificationSettings & { updatedAt: string }>('/settings/notifications', body),
    onSuccess: (data) => queryClient.setQueryData(['settings', 'notifications'], data),
  });
}
