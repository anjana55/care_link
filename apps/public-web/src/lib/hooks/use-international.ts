'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmployerAccountEnquiryRequest, EmployerAccountUpdate, InterviewRequest, Locale, OverseasReadiness, SharedProfileSettings, SharedProfileUpdate } from '@care-platform/shared';
import { employerApi, internationalApi, workAbroadApi } from '../api/international';
import { useAuth } from '../api/auth-context';
import { useCaregiverId } from './use-caregiver-portal';

// --- public ---------------------------------------------------------------

export function useInternationalSummary() {
  return useQuery({ queryKey: ['international', 'summary'], queryFn: internationalApi.summary, staleTime: 5 * 60 * 1000 });
}

export interface TalentFilters {
  country?: string;
  languageId?: string;
  training?: string;
  verifiedOnly?: boolean;
}

export function useTalentDirectory(locale: Locale, page: number, filters: TalentFilters = {}) {
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '' && v !== false));
  return useQuery({
    queryKey: ['international', 'talent', locale, page, clean],
    queryFn: () => internationalApi.talent({ locale, page, pageSize: 12, ...clean }),
    staleTime: 60 * 1000,
  });
}

export function useTalentProfile(slug: string | null, locale: Locale) {
  return useQuery({
    queryKey: ['international', 'talent-profile', slug, locale],
    queryFn: () => internationalApi.talentProfile(slug!, locale),
    enabled: Boolean(slug),
    retry: false,
  });
}

export function useTrainingProgrammes(locale: Locale) {
  return useQuery({ queryKey: ['international', 'training', locale], queryFn: () => internationalApi.training(locale), staleTime: 5 * 60 * 1000 });
}

export function useSendEnquiry() {
  return useMutation({ mutationFn: internationalApi.sendEnquiry });
}

// --- the caregiver's own Work abroad section ---------------------------------

export function useOverseasReadiness() {
  const id = useCaregiverId();
  return useQuery({ queryKey: ['portal', id, 'overseas'], queryFn: () => workAbroadApi.readiness(id!), enabled: Boolean(id) });
}

export function useSaveOverseasReadiness() {
  const id = useCaregiverId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OverseasReadiness) => workAbroadApi.saveReadiness(id!, body),
    onSuccess: (data) => {
      queryClient.setQueryData(['portal', id, 'overseas'], data);
      queryClient.invalidateQueries({ queryKey: ['portal', id, 'overseas-checklist'] });
    },
  });
}

export function useMyTraining() {
  const id = useCaregiverId();
  return useQuery({ queryKey: ['portal', id, 'training'], queryFn: () => workAbroadApi.enrolments(id!), enabled: Boolean(id) });
}

export function useTrainingInterest() {
  const id = useCaregiverId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ programmeId, interested }: { programmeId: string; interested: boolean }) =>
      interested ? workAbroadApi.registerInterest(id!, programmeId) : workAbroadApi.withdraw(id!, programmeId),
    onSuccess: (data) => queryClient.setQueryData(['portal', id, 'training'], data),
  });
}

export function useSharedProfile() {
  const id = useCaregiverId();
  return useQuery({ queryKey: ['portal', id, 'shared-profile'], queryFn: () => workAbroadApi.sharedProfile(id!), enabled: Boolean(id) });
}

type SharedProfileAction =
  | { kind: 'save'; body: SharedProfileUpdate }
  | { kind: 'share'; consentVersion: string }
  | { kind: 'unshare' }
  | { kind: 'withdrawConsent' }
  | { kind: 'newLink' }
  | { kind: 'uploadPhoto'; file: File }
  | { kind: 'deletePhoto' };

/** Every change to the shared profile goes through one mutation, and its answer replaces the cached settings. */
export function useSharedProfileAction() {
  const id = useCaregiverId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: SharedProfileAction): Promise<SharedProfileSettings> => {
      switch (action.kind) {
        case 'save':
          return workAbroadApi.saveSharedProfile(id!, action.body);
        case 'share':
          return workAbroadApi.share(id!, action.consentVersion);
        case 'unshare':
          return workAbroadApi.unshare(id!);
        case 'withdrawConsent':
          return workAbroadApi.withdrawConsent(id!);
        case 'newLink':
          return workAbroadApi.newLink(id!);
        case 'uploadPhoto':
          return workAbroadApi.uploadPhoto(id!, action.file);
        case 'deletePhoto':
          return workAbroadApi.deletePhoto(id!);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['portal', id, 'shared-profile'], data);
      queryClient.invalidateQueries({ queryKey: ['portal', id, 'overseas-checklist'] });
      // The photo preview is fetched separately; make it fetch again.
      queryClient.invalidateQueries({ queryKey: ['portal', id, 'shared-profile-photo'] });
    },
  });
}

export function useReadinessChecklist() {
  const id = useCaregiverId();
  return useQuery({ queryKey: ['portal', id, 'overseas-checklist'], queryFn: () => workAbroadApi.checklist(id!), enabled: Boolean(id) });
}

export function useEmployerInterest() {
  const id = useCaregiverId();
  return useQuery({ queryKey: ['portal', id, 'overseas-interest'], queryFn: () => workAbroadApi.interest(id!), enabled: Boolean(id) });
}

// --- the employer's own account ---------------------------------------------------

/** True for a signed-in overseas employer. */
export function useIsEmployer() {
  const { user } = useAuth();
  return user?.role === 'EMPLOYER' ? user : null;
}

export function useEmployerAccount() {
  const employer = useIsEmployer();
  return useQuery({ queryKey: ['employer', employer?.employerId, 'me'], queryFn: employerApi.me, enabled: Boolean(employer) });
}

export function useUpdateEmployerAccount() {
  const employer = useIsEmployer();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EmployerAccountUpdate) => employerApi.updateMe(body),
    onSuccess: (data) => queryClient.setQueryData(['employer', employer?.employerId, 'me'], data),
  });
}

export function useEmployerEnquiries(locale: Locale) {
  const employer = useIsEmployer();
  return useQuery({ queryKey: ['employer', employer?.employerId, 'enquiries', locale], queryFn: () => employerApi.enquiries(locale), enabled: Boolean(employer) });
}

export function useCreateEmployerEnquiry() {
  const employer = useIsEmployer();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EmployerAccountEnquiryRequest) => employerApi.createEnquiry(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employer', employer?.employerId, 'enquiries'] }),
  });
}

export function useCandidateActions(locale: Locale) {
  const employer = useIsEmployer();
  const queryClient = useQueryClient();
  const key = ['employer', employer?.employerId, 'enquiries', locale];
  const requestInterview = useMutation({
    mutationFn: (body: InterviewRequest) => employerApi.requestInterview(body, locale),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const act = useMutation({
    mutationFn: ({ id, action, message }: { id: string; action: 'REQUEST_INTERVIEW' | 'SELECT' | 'DECLINE'; message?: string }) =>
      employerApi.act(id, { action, message }, locale),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  return { requestInterview, act };
}

export function useShortlist(locale: Locale) {
  const employer = useIsEmployer();
  const queryClient = useQueryClient();
  const key = ['employer', employer?.employerId, 'shortlist', locale];
  const query = useQuery({ queryKey: key, queryFn: () => employerApi.shortlist(locale), enabled: Boolean(employer) });
  const toggle = useMutation({
    mutationFn: ({ slug, saved }: { slug: string; saved: boolean }) => (saved ? employerApi.addToShortlist(slug, locale) : employerApi.removeFromShortlist(slug, locale)),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  return { ...query, toggle };
}
