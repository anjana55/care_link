'use client';

import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  CaregiverDetail,
  CaregiverListResponse,
  CaregiverSearchFilters,
  DashboardStats,
  Skill,
  Language,
  Location,
  Qualification,
} from '../api/types';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardStats>('/caregivers/dashboard'),
  });
}

function buildCaregiverQuery(filters: CaregiverSearchFilters): string {
  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.status) query.set('status', filters.status);
  if (filters.gender) query.set('gender', filters.gender);
  if (filters.skillIds?.length) query.set('skillIds', filters.skillIds.join(','));
  if (filters.languageIds?.length) query.set('languageIds', filters.languageIds.join(','));
  if (filters.locationIds?.length) query.set('locationIds', filters.locationIds.join(','));
  if (filters.dayDuty) query.set('dayDuty', 'true');
  if (filters.nightDuty) query.set('nightDuty', 'true');
  if (filters.liveIn24h) query.set('liveIn24h', 'true');
  query.set('page', String(filters.page ?? 1));
  query.set('pageSize', String(filters.pageSize ?? 20));
  return query.toString();
}

export function useCaregivers(filters: CaregiverSearchFilters) {
  return useQuery({
    queryKey: ['caregivers', filters],
    queryFn: () => api.get<CaregiverListResponse>(`/caregivers?${buildCaregiverQuery(filters)}`),
  });
}

export function useCaregiver(id: string | undefined) {
  return useQuery({
    queryKey: ['caregiver', id],
    queryFn: () => api.get<CaregiverDetail>(`/caregivers/${id}`),
    enabled: Boolean(id),
  });
}

export function useSkills() {
  return useQuery({ queryKey: ['skills'], queryFn: () => api.get<Skill[]>('/skills') });
}

export function useLanguages() {
  return useQuery({ queryKey: ['languages'], queryFn: () => api.get<Language[]>('/languages') });
}

export function useLocations() {
  return useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/locations') });
}

export function useInvalidateCaregiver(id: string | undefined) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['caregiver', id] });
    queryClient.invalidateQueries({ queryKey: ['caregivers'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateCaregiver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post<CaregiverDetail>('/caregivers', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregivers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateCaregiverStatus(id: string) {
  const invalidate = useInvalidateCaregiver(id);
  return useMutation({
    mutationFn: (status: string) => api.patch<CaregiverDetail>(`/caregivers/${id}/status`, { status }),
    onSuccess: invalidate,
  });
}

export function useUpdateCaregiver(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch<CaregiverDetail>(`/caregivers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregiver', id] });
      queryClient.invalidateQueries({ queryKey: ['caregivers'] });
      queryClient.invalidateQueries({ queryKey: ['caregiver-skills', id] });
      queryClient.invalidateQueries({ queryKey: ['caregiver-languages', id] });
    },
  });
}

export function useAssignSkill(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { skillId: string; proficiency: string; yearsOfExperience?: number }) =>
      api.post(`/caregivers/${caregiverId}/skills`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregiver', caregiverId] });
      queryClient.invalidateQueries({ queryKey: ['caregiver-skills', caregiverId] });
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });
}

export function useRemoveSkill(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) => api.delete(`/caregivers/${caregiverId}/skills/${skillId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregiver', caregiverId] });
      queryClient.invalidateQueries({ queryKey: ['caregiver-skills', caregiverId] });
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });
}

export function useAssignLanguage(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { languageId: string; proficiency: string }) =>
      api.post(`/caregivers/${caregiverId}/languages`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregiver', caregiverId] });
      queryClient.invalidateQueries({ queryKey: ['caregiver-languages', caregiverId] });
      queryClient.invalidateQueries({ queryKey: ['languages'] });
    },
  });
}

export function useRemoveLanguage(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (languageId: string) => api.delete(`/caregivers/${caregiverId}/languages/${languageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregiver', caregiverId] });
      queryClient.invalidateQueries({ queryKey: ['caregiver-languages', caregiverId] });
      queryClient.invalidateQueries({ queryKey: ['languages'] });
    },
  });
}

export function useQualifications(caregiverId: string) {
  return useQuery({
    queryKey: ['qualifications', caregiverId],
    queryFn: () => api.get<Qualification[]>(`/caregivers/${caregiverId}/qualifications`),
  });
}

export function useAddQualification(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post(`/caregivers/${caregiverId}/qualifications`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qualifications', caregiverId] });
    },
  });
}

export function useRemoveQualification(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/caregivers/${caregiverId}/qualifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qualifications', caregiverId] });
    },
  });
}

export function useSetQualificationVerification(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { qualificationId: string; status: string }) =>
      api.patch(`/caregivers/${caregiverId}/qualifications/${data.qualificationId}/verification`, { status: data.status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qualifications', caregiverId] });
    },
  });
}

export function useSetDocumentVerification(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { documentId: string; status: string }) =>
      api.patch(`/caregivers/${caregiverId}/documents/${data.documentId}/verification`, { status: data.status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregiver', caregiverId] });
    },
  });
}

export function useRemoveDocument(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/caregivers/${caregiverId}/documents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregiver', caregiverId] });
    },
  });
}

export function useUploadDocument(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { documentType: string; file: File }) => {
      const formData = new FormData();
      formData.append('documentType', data.documentType);
      formData.append('file', data.file);
      return api.upload(`/caregivers/${caregiverId}/documents`, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregiver', caregiverId] });
    },
  });
}

export function useAddReference(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; relationship: string; phone: string; email?: string; notes?: string }) =>
      api.post(`/caregivers/${caregiverId}/references`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['references', caregiverId] });
    },
  });
}

export function useRemoveReference(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/caregivers/${caregiverId}/references/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['references', caregiverId] });
    },
  });
}

export function useSetReferenceVerification(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { referenceId: string; status: string }) =>
      api.patch(`/caregivers/${caregiverId}/references/${data.referenceId}/verification`, { status: data.status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['references', caregiverId] });
    },
  });
}

export function useAddVerification(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { verificationType: string; status?: string; notes?: string }) =>
      api.post(`/caregivers/${caregiverId}/verifications`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verifications', caregiverId] });
    },
  });
}

export function useUpdateVerification(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { verificationId: string; status: string; notes?: string }) =>
      api.patch(`/caregivers/${caregiverId}/verifications/${data.verificationId}`, {
        status: data.status,
        notes: data.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verifications', caregiverId] });
    },
  });
}

export function useViewDocument(caregiverId: string) {
  return useMutation({
    mutationFn: async (documentId: string) => {
      const tokens = typeof window !== 'undefined'
        ? (JSON.parse(window.localStorage.getItem('care-platform-tokens') || 'null') as { accessToken: string } | null)
        : null;
      const res = await fetch(`http://localhost:3001/caregivers/${caregiverId}/documents/${documentId}/file`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to download document');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    },
  });
}

export function useUpsertHealthInformation(caregiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put(`/caregivers/${caregiverId}/health-information`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health-information', caregiverId] });
    },
  });
}

export function useDeleteCaregiver(id: string) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api.delete(`/caregivers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregivers'] });
      router.push('/caregivers');
    },
  });
}
