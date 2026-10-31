import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CaregiverRelation, ClientCareRequest, CreateCareRequestBody, SavedCaregiverItem } from '@care-platform/shared';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';

/**
 * A signed-in client's shortlist and requests (the website's /account/saved
 * and /account/requests). Keyed by the client, so signing in as someone else
 * never shows the last person's list, and by language for the caregiver
 * details inside them.
 */
export function useClient() {
  const { user } = useAuth();
  return user?.role === 'PATIENT_GUARDIAN' ? user : null;
}

const careKey = (userId: string | undefined) => ['client-care', userId ?? 'none'] as const;

function useRefresh() {
  const queryClient = useQueryClient();
  const client = useClient();
  return () => queryClient.invalidateQueries({ queryKey: careKey(client?.userId) });
}

export function useMyRequests() {
  const client = useClient();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: [...careKey(client?.userId), 'requests', locale],
    queryFn: () => api.get<ClientCareRequest[]>('/me/care-requests'),
    enabled: Boolean(client),
  });
}

export function useSavedCaregivers() {
  const client = useClient();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: [...careKey(client?.userId), 'saved', locale],
    queryFn: () => api.get<SavedCaregiverItem[]>('/me/saved-caregivers'),
    enabled: Boolean(client),
  });
}

/** Whether the client saved this caregiver, and any open request for them. */
export function useRelation(publicId: string | null) {
  const client = useClient();
  return useQuery({
    queryKey: [...careKey(client?.userId), 'relations', publicId],
    queryFn: async () => (await api.get<CaregiverRelation[]>('/me/caregiver-relations', { publicIds: publicId! }))[0] ?? null,
    enabled: Boolean(client && publicId),
  });
}

export function useSetSaved() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ publicId, saved }: { publicId: string; saved: boolean }) =>
      saved ? api.put(`/me/saved-caregivers/${encodeURIComponent(publicId)}`) : api.delete(`/me/saved-caregivers/${encodeURIComponent(publicId)}`),
    onSettled: refresh,
  });
}

export function useSendRequest() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: CreateCareRequestBody) => api.post<ClientCareRequest>('/me/care-requests', body),
    onSuccess: refresh,
  });
}

export function useCancelRequest() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => api.post(`/me/care-requests/${encodeURIComponent(id)}/cancel`),
    onSettled: refresh,
  });
}
