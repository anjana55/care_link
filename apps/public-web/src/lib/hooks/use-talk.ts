'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyTalkRequest, TalkRequestInput } from '@care-platform/shared';
import { api } from '../api/client';
import { useAuth } from '../api/auth-context';

/** "Talk to a person": the signed-in client's or caregiver's own messages to staff. */
export function useMyTalkRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['talk', user?.userId],
    queryFn: () => api.get<MyTalkRequest[]>('/me/talk-to-a-person'),
    enabled: Boolean(user),
  });
}

export function useAskForAPerson() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TalkRequestInput) => api.post<MyTalkRequest>('/me/talk-to-a-person', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['talk', user?.userId] }),
  });
}
