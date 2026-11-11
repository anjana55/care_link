'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AutomationActionKey,
  AutomationCaseType,
  AutomationFunction,
  AutomationMode,
  AutomationOverview,
  CaseAutomationView,
  PromotionBar,
} from '@care-platform/shared';
import { api } from '../api/client';

const KEY = ['automation-overview'] as const;

/** Settings > Automation, admin only. Every change answers with the whole page again. */
export function useAutomationOverview(enabled = true) {
  // Refetched while open: a trip or a new verdict should show without a reload.
  return useQuery({ queryKey: KEY, queryFn: () => api.get<AutomationOverview>('/settings/automation'), enabled, refetchInterval: 30_000 });
}

function useOverviewMutation<V>(send: (v: V) => Promise<AutomationOverview>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: send, onSuccess: (data) => queryClient.setQueryData(KEY, data) });
}

export const useSetMasterSwitch = () =>
  useOverviewMutation((v: { on: boolean; reason?: string }) => api.post<AutomationOverview>('/settings/automation/master', v));

export const useSetAutomationMode = () =>
  useOverviewMutation((v: { key: AutomationFunction; mode: AutomationMode }) =>
    api.patch<AutomationOverview>(`/settings/automation/functions/${v.key}`, { mode: v.mode }),
  );

export const useResetAutomationTrip = () =>
  useOverviewMutation((v: { key: AutomationFunction }) => api.post<AutomationOverview>(`/settings/automation/functions/${v.key}/reset`, {}));

export const useSetActionPolicy = () =>
  useOverviewMutation((v: { action: AutomationActionKey; autoAllowed?: boolean; resetRecord?: boolean }) =>
    api.patch<AutomationOverview>(`/settings/automation/actions/${v.action}`, { autoAllowed: v.autoAllowed, resetRecord: v.resetRecord }),
  );

export const useUpdatePromotionBar = () => useOverviewMutation((v: Partial<PromotionBar>) => api.patch<AutomationOverview>('/settings/automation', v));

// --- on a case page (staff and admin) -------------------------------------------

const caseKey = (caseType: AutomationCaseType, caseId: string) => ['automation-case', caseType, caseId] as const;

/** Who is driving one case, the agent's handover note and its latest decisions. */
export function useCaseAutomation(caseType: AutomationCaseType, caseId: string | undefined) {
  return useQuery({
    queryKey: caseKey(caseType, caseId ?? ''),
    queryFn: () => api.get<CaseAutomationView>(`/automation/cases/${caseType}/${caseId}`),
    enabled: Boolean(caseId),
    staleTime: 30_000,
  });
}

export function useCaseDriverSwitch(caseType: AutomationCaseType, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { to: 'STAFF'; reason?: string } | { to: 'AGENT' }) =>
      v.to === 'STAFF'
        ? api.post<CaseAutomationView>(`/automation/cases/${caseType}/${caseId}/take-over`, { reason: v.reason })
        : api.post<CaseAutomationView>(`/automation/cases/${caseType}/${caseId}/hand-back`, {}),
    onSuccess: (data) => queryClient.setQueryData(caseKey(caseType, caseId), data),
  });
}
