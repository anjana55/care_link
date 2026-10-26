'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EmployerEnquiry,
  EmployerEnquiryList,
  EmployerEnquiryStatus,
  EmployerEnquirySummary,
  SharedProfileReviewItem,
  TrainingEnrolmentRow,
  TrainingEnrolmentStatus,
  TrainingProgramme,
  TrainingProgrammeInput,
} from '@care-platform/shared';
import { API_URL, api, getStoredTokens } from '../api/client';

/** Staff side of the international paths: overseas enquiries, shared-profile review, training. */

export function useInternationalSummary(enabled = true) {
  return useQuery({
    queryKey: ['international', 'summary'],
    queryFn: () => api.get<EmployerEnquirySummary & { pendingProfiles: number }>('/international/enquiries/summary'),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useEmployerEnquiries(filters: { status?: string; search?: string; page?: number }, enabled = true) {
  return useQuery({
    queryKey: ['international', 'enquiries', filters],
    queryFn: () =>
      api.get<EmployerEnquiryList>('/international/enquiries', {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.search ? { search: filters.search } : {}),
        page: filters.page ?? 1,
        pageSize: 25,
      }),
    enabled,
  });
}

export function useEmployerEnquiry(id: string) {
  return useQuery({ queryKey: ['international', 'enquiry', id], queryFn: () => api.get<EmployerEnquiry>(`/international/enquiries/${id}`) });
}

export function useUpdateEmployerEnquiry(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { status?: EmployerEnquiryStatus; staffNote?: string | null; placementFeeAmount?: number | null; placementFeeCurrency?: string | null }) =>
      api.patch<EmployerEnquiry>(`/international/enquiries/${id}`, body),
    onSuccess: (data) => {
      queryClient.setQueryData(['international', 'enquiry', id], data);
      queryClient.invalidateQueries({ queryKey: ['international', 'enquiries'] });
      queryClient.invalidateQueries({ queryKey: ['international', 'summary'] });
    },
  });
}

export function useSharedProfileQueue(status: string, enabled = true) {
  return useQuery({
    queryKey: ['international', 'shared-profiles', status],
    queryFn: () => api.get<SharedProfileReviewItem[]>('/international/shared-profiles', { status }),
    enabled,
  });
}

export function useReviewSharedProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caregiverId, decision, note }: { caregiverId: string; decision: 'APPROVE' | 'REJECT'; note?: string }) =>
      api.patch<SharedProfileReviewItem>(`/international/shared-profiles/${caregiverId}/review`, { decision, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['international', 'shared-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['international', 'summary'] });
    },
  });
}

/** The caregiver's photo for review - an authorised request, so a blob URL rather than a plain <img src>. */
export function useSharedProfilePhoto(caregiverId: string, hasPhoto: boolean, version: string) {
  return useQuery({
    queryKey: ['international', 'photo', caregiverId, version],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/caregivers/${caregiverId}/shared-profile/photo`, {
        headers: { Authorization: `Bearer ${getStoredTokens()?.accessToken}` },
      });
      if (!res.ok) throw new Error('photo');
      return URL.createObjectURL(await res.blob());
    },
    enabled: hasPhoto,
    staleTime: Infinity,
  });
}

export function useTrainingProgrammes(enabled = true) {
  return useQuery({ queryKey: ['international', 'programmes'], queryFn: () => api.get<TrainingProgramme[]>('/international/training/programmes'), enabled });
}

export function useSaveTrainingProgramme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: TrainingProgrammeInput }) =>
      id ? api.put<TrainingProgramme>(`/international/training/programmes/${id}`, body) : api.post<TrainingProgramme>('/international/training/programmes', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['international', 'programmes'] }),
  });
}

export function useTrainingEnrolments(programmeId: string | null) {
  return useQuery({
    queryKey: ['international', 'enrolments', programmeId],
    queryFn: () => api.get<TrainingEnrolmentRow[]>(`/international/training/programmes/${programmeId}/enrolments`),
    enabled: Boolean(programmeId),
  });
}

export function useUpdateEnrolment(programmeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TrainingEnrolmentStatus }) => api.patch<TrainingEnrolmentRow>(`/international/training/enrolments/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['international', 'enrolments', programmeId] });
      queryClient.invalidateQueries({ queryKey: ['international', 'programmes'] });
    },
  });
}
