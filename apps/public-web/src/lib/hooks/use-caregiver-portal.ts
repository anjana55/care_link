'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CareChecklistShift, CaregiverPayout, CaregiverShift, CreateIssueReportBody, MyIssueReport } from '@care-platform/shared';
import { api } from '../api/client';
import { useAuth } from '../api/auth-context';
import type {
  Availability, CaregiverDocument, DocumentType, Experience, NamedItem, OwnCaregiver, Qualification,
} from '../api/portal-types';

/**
 * Everything the signed-in caregiver's own pages read and write.
 *
 * The caregiver id comes from the session (the JWT's `caregiverId`), never from
 * a URL, so there is no address a caregiver could edit to land on someone
 * else's record - and the API checks the same thing again on every call.
 */
export function useCaregiverId() {
  const { user } = useAuth();
  return user?.caregiverId ?? null;
}

const base = (id: string) => `/caregivers/${id}`;

export function useOwnCaregiver() {
  const id = useCaregiverId();
  return useQuery({
    queryKey: ['portal', id, 'caregiver'],
    queryFn: () => api.get<OwnCaregiver>(base(id!)),
    enabled: Boolean(id),
  });
}

/** Writes through to a list/record and refreshes everything the portal shows from it. */
function useInvalidate() {
  const queryClient = useQueryClient();
  const id = useCaregiverId();
  return (...keys: string[]) => {
    for (const key of keys) queryClient.invalidateQueries({ queryKey: ['portal', id, key] });
  };
}

export function useUpdateProfile() {
  const id = useCaregiverId();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => api.patch<OwnCaregiver>(`${base(id!)}/profile`, values),
    onSuccess: () => invalidate('caregiver'),
  });
}

export function useSubmitRegistration() {
  const id = useCaregiverId();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api.patch<OwnCaregiver>(`${base(id!)}/status`, { status: 'REGISTERED' }),
    onSuccess: () => invalidate('caregiver'),
  });
}

// --- documents -------------------------------------------------------------

export function useDocuments() {
  const id = useCaregiverId();
  return useQuery({
    queryKey: ['portal', id, 'documents'],
    queryFn: () => api.get<CaregiverDocument[]>(`${base(id!)}/documents`),
    enabled: Boolean(id),
  });
}

export function useUploadDocument() {
  const id = useCaregiverId();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ file, documentType, expiresOn }: { file: File; documentType: DocumentType; expiresOn?: string }) => {
      const form = new FormData();
      form.append('documentType', documentType);
      if (expiresOn) form.append('expiresOn', expiresOn);
      form.append('file', file);
      return api.post<CaregiverDocument>(`${base(id!)}/documents`, form);
    },
    onSuccess: () => invalidate('documents', 'caregiver', 'dated-documents'),
  });
}

export function useDeleteDocument() {
  const id = useCaregiverId();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (documentId: string) => api.delete(`${base(id!)}/documents/${documentId}`),
    onSuccess: () => invalidate('documents', 'caregiver'),
  });
}

// --- shifts (availability) -------------------------------------------------

export function useAvailability() {
  const id = useCaregiverId();
  return useQuery({
    queryKey: ['portal', id, 'availability'],
    // The API answers 200 with an empty body when nothing is saved yet.
    queryFn: async () => (await api.get<Availability | null>(`${base(id!)}/availability`)) ?? null,
    enabled: Boolean(id),
  });
}

export function useSaveAvailability() {
  const id = useCaregiverId();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => api.put<Availability>(`${base(id!)}/availability`, values),
    onSuccess: () => invalidate('availability'),
  });
}

// --- skills, languages, qualifications, experience -------------------------

export function useCatalog(kind: 'skills' | 'languages') {
  return useQuery({
    queryKey: ['catalog', kind],
    queryFn: () => api.get<NamedItem[]>(`/${kind}`),
    staleTime: 5 * 60 * 1000,
  });
}

export function useToggleAssignment(kind: 'skills' | 'languages') {
  const id = useCaregiverId();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ itemId, assigned }: { itemId: string; assigned: boolean }) =>
      assigned
        ? api.delete(`${base(id!)}/${kind}/${itemId}`)
        : api.post(`${base(id!)}/${kind}`, kind === 'skills' ? { skillId: itemId } : { languageId: itemId }),
    onSuccess: () => invalidate('caregiver'),
  });
}

function useRecords<T>(kind: 'qualifications' | 'experiences') {
  const id = useCaregiverId();
  const invalidate = useInvalidate();
  const list = useQuery({
    queryKey: ['portal', id, kind],
    queryFn: () => api.get<T[]>(`${base(id!)}/${kind}`),
    enabled: Boolean(id),
  });
  const save = useMutation({
    mutationFn: ({ recordId, values }: { recordId?: string; values: Record<string, unknown> }) =>
      recordId ? api.patch(`${base(id!)}/${kind}/${recordId}`, values) : api.post(`${base(id!)}/${kind}`, values),
    onSuccess: () => invalidate(kind),
  });
  const remove = useMutation({
    mutationFn: (recordId: string) => api.delete(`${base(id!)}/${kind}/${recordId}`),
    onSuccess: () => invalidate(kind),
  });
  return { list, save, remove };
}

export const useQualifications = () => useRecords<Qualification>('qualifications');
export const useExperiences = () => useRecords<Experience>('experiences');

/** The caregiver's own confirmed shifts - covers included - from a week ago to two months ahead. */
export function useMyShifts() {
  const id = useCaregiverId();
  return useQuery({
    queryKey: ['portal', id, 'booked-shifts'],
    queryFn: () => api.get<CaregiverShift[]>('/me/shifts'),
    enabled: Boolean(id),
  });
}

/** The caregiver's approved and paid payout statements (GET /me/payouts). */
export function useMyPayouts() {
  const id = useCaregiverId();
  return useQuery({
    queryKey: ['portal', id, 'payouts'],
    queryFn: () => api.get<CaregiverPayout[]>('/me/payouts'),
    enabled: Boolean(id),
  });
}

/** The caregiver's own problem reports and staff's answers (GET /me/issues). */
export function useMyShiftIssues() {
  const id = useCaregiverId();
  return useQuery({
    queryKey: ['portal', id, 'issues'],
    queryFn: () => api.get<MyIssueReport[]>('/me/issues'),
    enabled: Boolean(id),
  });
}

/** Tell staff something about one of their shifts is wrong - its times, whether it happened, or the pay. */
export function useReportShiftIssue() {
  const id = useCaregiverId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shiftId, ...body }: CreateIssueReportBody & { shiftId: string }) => api.post<MyIssueReport>(`/me/shifts/${shiftId}/issues`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', id, 'issues'] }),
  });
}

/** The care plan for one of the caregiver's own shifts - read-only, from a day before it until its day ends. */
export function useShiftCarePlan(shiftId: string | null) {
  const id = useCaregiverId();
  return useQuery({
    queryKey: ['portal', id, 'shift-care', shiftId],
    queryFn: () => api.get<CareChecklistShift>(`/me/shifts/${shiftId}/care`),
    enabled: Boolean(id && shiftId),
  });
}
