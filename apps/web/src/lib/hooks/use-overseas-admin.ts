'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CareType, CountryCode, EmployerAdminRow, EmployerEnquiry, EmployerType, TrainingEnrolmentRow, VisaSponsorship } from '@care-platform/shared';
import { api } from '../api/client';

/**
 * Admin create / edit / delete for Overseas records (the API's
 * AdminOverseasController). Every success refreshes all Overseas lists and
 * counts: a deleted enquiry changes the summary badges too.
 */
function useRefreshOverseas() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['international'] });
    queryClient.invalidateQueries({ queryKey: ['caregiver'] });
  };
}

/** DELETE any admin-deletable Overseas record, e.g. `/international/offers/<id>`. */
export function useOverseasDelete() {
  const refresh = useRefreshOverseas();
  return useMutation({ mutationFn: (path: string) => api.delete(path), onSuccess: refresh });
}

export interface StaffEnquiryInput {
  organisationName: string;
  organisationType: EmployerType;
  country: CountryCode;
  contactName: string;
  email: string;
  phone?: string;
  website?: string;
  rolesCount: number;
  careSettings: CareType[];
  languages?: string;
  startTimeframe?: string;
  visaSponsorship: VisaSponsorship;
  message?: string;
  employerId?: string | null;
  staffNote?: string | null;
}

export function useCreateEnquiry() {
  const refresh = useRefreshOverseas();
  return useMutation({ mutationFn: (body: StaffEnquiryInput) => api.post<EmployerEnquiry>('/international/enquiries', body), onSuccess: refresh });
}

export interface EmployerInput {
  organisationName?: string;
  organisationType?: EmployerType;
  country?: CountryCode;
  contactName?: string;
  phone?: string | null;
  website?: string | null;
  companyRegistrationNumber?: string | null;
  email?: string;
}

export function useCreateEmployer() {
  const refresh = useRefreshOverseas();
  return useMutation({
    mutationFn: (body: EmployerInput & { email: string; sendPasswordLink: boolean; status: 'VERIFIED' | 'PENDING_REVIEW' }) =>
      api.post<EmployerAdminRow & { passwordLinkSent: boolean }>('/international/employers', body),
    onSuccess: refresh,
  });
}

export function useEditEmployer() {
  const refresh = useRefreshOverseas();
  return useMutation({ mutationFn: ({ id, ...body }: EmployerInput & { id: string }) => api.put<EmployerAdminRow>(`/international/employers/${id}`, body), onSuccess: refresh });
}

export function useEnrolCaregiver(programmeId: string) {
  const refresh = useRefreshOverseas();
  return useMutation({
    mutationFn: (body: { caregiverId: string; status: 'INTERESTED' | 'ENROLLED' }) => api.post<TrainingEnrolmentRow[]>(`/international/training/programmes/${programmeId}/enrolments`, body),
    onSuccess: refresh,
  });
}
