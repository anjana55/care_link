'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminAiSettings,
  AiFeatureStatus,
  AssistantAction,
  AssistantConversation,
  AssistantConversationSummary,
  StaffSuggestionsResponse,
} from '@care-platform/shared';
import { api } from '../api/client';

/** Which AI features are on (ADMIN + STAFF). A failure just hides them. */
export function useAiStatus(enabled = true) {
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<AiFeatureStatus>('/ai/status'),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** Admin-only. */
export function useAiSettings() {
  return useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<AdminAiSettings>('/settings/ai') });
}

/**
 * Caregiver suggestions for a request. Only fetched when asked for - each one
 * may cost a model call - and kept for a few minutes so reopening the panel
 * does not ask again.
 */
export function useRequestSuggestions(requestId: string, enabled: boolean, radiusKm?: number) {
  return useQuery({
    queryKey: ['care-requests', requestId, 'suggestions', radiusKm ?? null],
    queryFn: () => api.get<StaffSuggestionsResponse>(`/care-requests/${requestId}/suggestions`, radiusKm ? { radiusKm } : undefined),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// --- assistant -----------------------------------------------------------------

export function useConversations() {
  return useQuery({
    queryKey: ['assistant', 'conversations'],
    queryFn: () => api.get<AssistantConversationSummary[]>('/assistant/conversations'),
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ['assistant', 'conversation', id],
    queryFn: () => api.get<AssistantConversation>(`/assistant/conversations/${id}`),
    enabled: Boolean(id),
  });
}

export function useAssistantMutations() {
  const queryClient = useQueryClient();
  const refreshList = () => queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] });

  const create = useMutation({
    mutationFn: () => api.post<AssistantConversationSummary>('/assistant/conversations'),
    onSuccess: refreshList,
  });

  const send = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.post<AssistantConversation>(`/assistant/conversations/${id}/messages`, { content }),
    onSuccess: (convo) => {
      queryClient.setQueryData(['assistant', 'conversation', convo.id], convo);
      refreshList();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/assistant/conversations/${id}`),
    onSuccess: refreshList,
  });

  /** Approving changes a request or booking: everything showing those must refetch. */
  const decide = useMutation({
    mutationFn: ({ actionId, approve }: { actionId: string; approve: boolean; conversationId: string }) =>
      api.post<AssistantAction>(`/assistant/actions/${actionId}/${approve ? 'approve' : 'reject'}`),
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: ['assistant', 'conversation', vars.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['care-requests'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });

  return { create, send, remove, decide };
}
