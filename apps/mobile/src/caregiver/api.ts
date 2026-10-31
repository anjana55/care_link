import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CareChecklistShift, CaregiverPayout, CaregiverShift, CreateIssueReportBody, MyIssueReport, OwnCaregiver } from '@care-platform/shared';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';

/**
 * The signed-in caregiver's own area (the website's /caregiver pages). The
 * caregiver record is the one in the session, never an id from anywhere else.
 */
export function useCaregiver() {
  const { user } = useAuth();
  return user?.role === 'CAREGIVER' && user.caregiverId ? { userId: user.userId, caregiverId: user.caregiverId } : null;
}

const key = (userId: string | undefined) => ['caregiver', userId ?? 'none'] as const;

export function useOwnCaregiver() {
  const me = useCaregiver();
  return useQuery({
    queryKey: [...key(me?.userId), 'record'],
    queryFn: () => api.get<OwnCaregiver>(`/caregivers/${encodeURIComponent(me!.caregiverId)}`),
    enabled: Boolean(me),
  });
}

/** Confirmed shifts, upcoming and recent, in time order. */
export function useMyShifts() {
  const me = useCaregiver();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: [...key(me?.userId), 'shifts', locale],
    queryFn: async () => (await api.get<CaregiverShift[]>('/me/shifts')).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    enabled: Boolean(me),
  });
}

/** What to do on one shift, from the booking's care plan - read-only for the caregiver. */
export function useShiftCarePlan(shiftId: string | null) {
  const me = useCaregiver();
  const { locale } = useTranslation();
  return useQuery({
    queryKey: [...key(me?.userId), 'shift-care', shiftId, locale],
    queryFn: () => api.get<CareChecklistShift>(`/me/shifts/${encodeURIComponent(shiftId!)}/care`),
    enabled: Boolean(me && shiftId),
  });
}

export function useMyShiftIssues() {
  const me = useCaregiver();
  return useQuery({
    queryKey: [...key(me?.userId), 'issues'],
    queryFn: () => api.get<MyIssueReport[]>('/me/issues'),
    enabled: Boolean(me),
  });
}

export function useReportShiftIssue() {
  const queryClient = useQueryClient();
  const me = useCaregiver();
  return useMutation({
    mutationFn: ({ shiftId, ...body }: CreateIssueReportBody & { shiftId: string }) =>
      api.post<MyIssueReport>(`/me/shifts/${encodeURIComponent(shiftId)}/issues`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...key(me?.userId), 'issues'] }),
  });
}

/** Approved and paid statements only. */
export function useMyPayouts() {
  const me = useCaregiver();
  return useQuery({
    queryKey: [...key(me?.userId), 'payouts'],
    queryFn: () => api.get<CaregiverPayout[]>('/me/payouts'),
    enabled: Boolean(me),
  });
}
