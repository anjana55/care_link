'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CheckInSettings, StaffCheckIn, StaffCheckInInput, TodayVisits } from '@care-platform/shared';
import { api } from '@/lib/api/client';

const KEY = ['visits'] as const;
type AdminCheckInSettings = CheckInSettings & { updatedAt: string };

/** Today's roster with where every visit stands. Refreshed every minute: "late" depends on the clock. */
export function useTodayVisits(enabled = true) {
  return useQuery({ queryKey: [...KEY, 'today'], queryFn: () => api.get<TodayVisits>('/visits/today'), enabled, refetchInterval: 60_000 });
}

/** Record a check-in or a check-out on a caregiver's behalf. */
export function useRecordVisit(shiftId: string, what: 'check-in' | 'check-out') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StaffCheckInInput) => api.post<StaffCheckIn>(`/visits/${shiftId}/${what}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ['bookings', 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['insights'] });
    },
  });
}

export function useCheckInSettings() {
  return useQuery({ queryKey: [...KEY, 'settings'], queryFn: () => api.get<AdminCheckInSettings>('/settings/check-in') });
}

export function useUpdateCheckInSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CheckInSettings>) => api.patch<AdminCheckInSettings>('/settings/check-in', body),
    onSuccess: (data) => {
      queryClient.setQueryData([...KEY, 'settings'], data);
      queryClient.invalidateQueries({ queryKey: [...KEY, 'today'] });
    },
  });
}
