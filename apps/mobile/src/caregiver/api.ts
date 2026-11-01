import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CareChecklistShift,
  CaregiverDocument,
  CaregiverPayout,
  CaregiverShift,
  CreateIssueReportBody,
  DocumentType,
  Experience,
  MyIssueReport,
  NamedItem,
  OwnCaregiver,
  Qualification,
} from '@care-platform/shared';
import { api, tokenStore } from '@/api';
import { config } from '@/config';
import { currentLanguage } from '@/i18n';
import { openDocument } from './document-files';
import type { PickedFile } from './documents';
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

// --- documents ---------------------------------------------------------------

const documentsPath = (caregiverId: string) => `/caregivers/${encodeURIComponent(caregiverId)}/documents`;

/** The caregiver's own documents, newest first. */
export function useMyDocuments() {
  const me = useCaregiver();
  return useQuery({
    queryKey: [...key(me?.userId), 'documents'],
    queryFn: async () => (await api.get<CaregiverDocument[]>(documentsPath(me!.caregiverId))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    enabled: Boolean(me),
  });
}

/** Changes the list here and the "documents needed" on Today (which reads the caregiver record). */
function useDocumentsChanged() {
  const queryClient = useQueryClient();
  const me = useCaregiver();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [...key(me?.userId), 'documents'] }),
      queryClient.invalidateQueries({ queryKey: [...key(me?.userId), 'record'] }),
    ]);
}

export function useUploadDocument() {
  const me = useCaregiver();
  const changed = useDocumentsChanged();
  return useMutation({
    mutationFn: ({ file, documentType, expiresOn }: { file: PickedFile; documentType: DocumentType; expiresOn: string | null }) => {
      const form = new FormData();
      form.append('documentType', documentType);
      if (expiresOn) form.append('expiresOn', expiresOn);
      // React Native sends a { uri, name, type } part as the file itself.
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
      return api.post<CaregiverDocument>(documentsPath(me!.caregiverId), form);
    },
    onSuccess: changed,
  });
}

export function useRemoveDocument() {
  const me = useCaregiver();
  const changed = useDocumentsChanged();
  return useMutation({
    mutationFn: (documentId: string) => api.delete<void>(`${documentsPath(me!.caregiverId)}/${encodeURIComponent(documentId)}`),
    onSuccess: changed,
  });
}

/**
 * Opens an uploaded document in the phone's viewer. The file route needs the
 * sign-in header, so the app downloads it itself; if the session has just run
 * out (the download fails with a 401), it is renewed once and the download
 * tried again.
 */
export function useOpenDocument(open: typeof openDocument = openDocument) {
  const me = useCaregiver();
  return useMutation({
    mutationFn: async (doc: { id: string; mimeType: string; title: string }) => {
      const url = `${config.apiUrl}${documentsPath(me!.caregiverId)}/${encodeURIComponent(doc.id)}/file`;
      const headers = (token?: string) => ({ 'Accept-Language': currentLanguage(), ...(token ? { Authorization: `Bearer ${token}` } : {}) });
      try {
        await open(url, headers(tokenStore.get()?.accessToken), doc);
      } catch (err) {
        if (!/\b401\b/.test(String((err as Error)?.message ?? err))) throw err;
        const renewed = await api.refreshSession().catch(() => null);
        if (!renewed) throw err;
        await open(url, headers(renewed.accessToken), doc);
      }
    },
  });
}

// --- profile -----------------------------------------------------------------

const caregiverPath = (caregiverId: string) => `/caregivers/${encodeURIComponent(caregiverId)}`;

/** Saves the caregiver's own details (a partial update: only what changed). */
export function useUpdateOwnProfile() {
  const queryClient = useQueryClient();
  const me = useCaregiver();
  return useMutation({
    mutationFn: (changes: Record<string, unknown>) => api.patch<OwnCaregiver>(`${caregiverPath(me!.caregiverId)}/profile`, changes),
    onSuccess: (saved) => {
      queryClient.setQueryData([...key(me?.userId), 'record'], saved);
      return queryClient.invalidateQueries({ queryKey: [...key(me?.userId), 'record'] });
    },
  });
}

/** Every skill or language there is to choose from. */
export function useCatalog(kind: 'skills' | 'languages') {
  const me = useCaregiver();
  return useQuery({
    queryKey: ['catalog', kind],
    queryFn: async () => (await api.get<NamedItem[]>(`/${kind}`)).sort((a, b) => a.name.localeCompare(b.name)),
    enabled: Boolean(me),
    staleTime: 60 * 60_000,
  });
}

/**
 * Ticks or unticks one skill or language, saved straight away as on the
 * website. The list then shows what the API holds, so a failed save unticks itself.
 */
export function useToggleAssignment(kind: 'skills' | 'languages') {
  const queryClient = useQueryClient();
  const me = useCaregiver();
  return useMutation({
    mutationFn: ({ itemId, assigned }: { itemId: string; assigned: boolean }) =>
      assigned
        ? api.delete(`${caregiverPath(me!.caregiverId)}/${kind}/${encodeURIComponent(itemId)}`)
        : api.post(`${caregiverPath(me!.caregiverId)}/${kind}`, kind === 'skills' ? { skillId: itemId } : { languageId: itemId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...key(me?.userId), 'record'] }),
  });
}

/** Qualifications or work history, to show; they are added and changed on the website. */
export function useMyRecords<T extends Qualification | Experience>(kind: 'qualifications' | 'experiences') {
  const me = useCaregiver();
  return useQuery({
    queryKey: [...key(me?.userId), kind],
    queryFn: () => api.get<T[]>(`${caregiverPath(me!.caregiverId)}/${kind}`),
    enabled: Boolean(me),
  });
}
