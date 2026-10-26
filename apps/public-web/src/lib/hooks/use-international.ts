'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Locale, OverseasReadiness, SharedProfileSettings, SharedProfileUpdate } from '@care-platform/shared';
import { internationalApi, workAbroadApi } from '../api/international';
import { useCaregiverId } from './use-caregiver-portal';

// --- public ---------------------------------------------------------------

export function useInternationalSummary() {
  return useQuery({ queryKey: ['international', 'summary'], queryFn: internationalApi.summary, staleTime: 5 * 60 * 1000 });
}

export function useTalentDirectory(locale: Locale, page: number, country?: string) {
  return useQuery({
    queryKey: ['international', 'talent', locale, page, country ?? null],
    queryFn: () => internationalApi.talent({ locale, page, pageSize: 12, ...(country ? { country } : {}) }),
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
    onSuccess: (data) => queryClient.setQueryData(['portal', id, 'overseas'], data),
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
      // The photo preview is fetched separately; make it fetch again.
      queryClient.invalidateQueries({ queryKey: ['portal', id, 'shared-profile-photo'] });
    },
  });
}
