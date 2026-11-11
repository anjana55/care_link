'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentDecisionView,
  AgentRunResult,
  AutomationActionKey,
  AutomationCaseType,
  AutomationEndpointInput,
  AutomationEndpointTestResult,
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
  useOverviewMutation((v: { action: AutomationActionKey; autoAllowed?: boolean; resetRecord?: boolean; limits?: Record<string, number> }) =>
    api.patch<AutomationOverview>(`/settings/automation/actions/${v.action}`, { autoAllowed: v.autoAllowed, resetRecord: v.resetRecord, limits: v.limits }),
  );

export const useUpdatePromotionBar = () => useOverviewMutation((v: Partial<PromotionBar>) => api.patch<AutomationOverview>('/settings/automation', v));

export const useSetFunctionEndpoints = () =>
  useOverviewMutation((v: { key: AutomationFunction; endpointId?: string | null; fallbackEndpointId?: string | null }) =>
    api.patch<AutomationOverview>(`/settings/automation/functions/${v.key}/endpoints`, { endpointId: v.endpointId, fallbackEndpointId: v.fallbackEndpointId }),
  );

export const useSaveEndpoint = () =>
  useOverviewMutation((v: { id?: string; input: AutomationEndpointInput & { copyDefault?: boolean } }) =>
    v.id ? api.patch<AutomationOverview>(`/settings/automation/endpoints/${v.id}`, v.input) : api.post<AutomationOverview>('/settings/automation/endpoints', v.input),
  );

export const useDeleteEndpoint = () => useOverviewMutation((v: { id: string }) => api.delete<AutomationOverview>(`/settings/automation/endpoints/${v.id}`));

export const useTestEndpoint = () =>
  useMutation({ mutationFn: (id: string) => api.post<AutomationEndpointTestResult>(`/settings/automation/endpoints/${id}/test`, {}) });

export const useRetryJob = () => useOverviewMutation((v: { id: string }) => api.post<AutomationOverview>(`/settings/automation/jobs/${v.id}/retry`, {}));

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

// --- proposals waiting for a person ----------------------------------------------

const PROPOSALS = ['automation-proposals'] as const;

/** Every proposal still waiting for approval. Also what the dashboard counts. */
export function useAwaitingProposals(enabled = true) {
  return useQuery({
    queryKey: PROPOSALS,
    queryFn: () => api.get<AgentDecisionView[]>('/automation/decisions?awaitingStaff=true&pageSize=100'),
    enabled,
    staleTime: 30_000,
  });
}

/** Approve (carried out now, under your name) or decline one proposal. */
export function useDecideProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; approve: boolean; reason?: string }) =>
      v.approve
        ? api.post<AgentDecisionView>(`/automation/decisions/${v.id}/approve`, {})
        : api.post<AgentDecisionView>(`/automation/decisions/${v.id}/decline`, { reason: v.reason }),
    // The step may have created or changed records anywhere: refetch what is on screen.
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export const useRunAgent = () =>
  useMutation({ mutationFn: (key: AutomationFunction) => api.post<AgentRunResult>(`/settings/automation/functions/${key}/run`, {}) });
