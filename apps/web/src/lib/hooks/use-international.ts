'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EmployerEnquiry,
  EmployerEnquiryList,
  EnquiryDetailsInput,
  EmployerEnquiryStatus,
  OverseasStaffSummary,
  EmployerAdminRow,
  StaffCandidate,
  StaffCandidateWithEnquiry,
  TalentPoolRow,
  CandidateStatus,
  SharedProfileReviewItem,
  TrainingEnrolmentRow,
  TrainingEnrolmentStatus,
  TrainingProgramme,
  TrainingProgrammeInput,
  CheckinUpdate,
  PlacementInvoice,
  PlacementInvoiceInput,
  PlacementPaymentInput,
  PlacementUpdate,
  StaffExpiringDocument,
  StaffPlacement,
  StaffPlacementInvoiceRow,
  StaffVacancy,
  StaffVacancyApplication,
  VacancyInput,
  AssessmentInput,
  InterviewInput,
  InterviewUpdate,
  OfferReview,
  OverseasReport,
  DepartureItem,
  DepartureItemUpdate,
  StaffAssessment,
  StaffInterview,
  StaffJobOffer,
  StaffWelfareReport,
  TrainingCertificate,
  WelfareStatus,
} from '@care-platform/shared';
import { API_URL, api, getStoredTokens } from '../api/client';

/** Staff side of the international paths: overseas enquiries, shared-profile review, training. */

export function useInternationalSummary(enabled = true) {
  return useQuery({
    queryKey: ['international', 'summary'],
    queryFn: () => api.get<OverseasStaffSummary>('/international/enquiries/summary'),
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
    mutationFn: ({ id, ...body }: { id: string; status: TrainingEnrolmentStatus; progressPercent?: number | null; score?: number | null }) =>
      api.patch<TrainingEnrolmentRow>(`/international/training/enrolments/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['international', 'enrolments', programmeId] });
      queryClient.invalidateQueries({ queryKey: ['international', 'programmes'] });
    },
  });
}

// --- phase 2: employers, candidates, talent pool -------------------------------

/** Admins: correct what the employer sent, or link the enquiry to an employer account. */
export function useEditEnquiryDetails(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EnquiryDetailsInput) => api.put<EmployerEnquiry>(`/international/enquiries/${id}/details`, body),
    onSuccess: (data) => {
      queryClient.setQueryData(['international', 'enquiry', id], data);
      queryClient.invalidateQueries({ queryKey: ['international', 'enquiries'] });
      queryClient.invalidateQueries({ queryKey: ['international', 'employers'] });
    },
  });
}

export function useEmployerAccounts(status: string) {
  return useQuery({
    queryKey: ['international', 'employers', status],
    queryFn: () => api.get<EmployerAdminRow[]>('/international/employers', { status }),
  });
}

export function useReviewEmployer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'VERIFY' | 'REJECT' | 'SUSPEND'; note?: string }) =>
      api.patch<EmployerAdminRow>(`/international/employers/${id}/review`, { decision, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['international', 'employers'] });
      queryClient.invalidateQueries({ queryKey: ['international', 'summary'] });
    },
  });
}

export function useTalentPool(filters: { country?: string; minReady?: number; search?: string }, enabled = true) {
  return useQuery({
    queryKey: ['international', 'talent-pool', filters],
    queryFn: () =>
      api.get<TalentPoolRow[]>('/international/talent-pool', {
        ...(filters.country ? { country: filters.country } : {}),
        ...(filters.minReady ? { minReady: filters.minReady } : {}),
        ...(filters.search ? { search: filters.search } : {}),
      }),
    enabled,
  });
}

export function useEnquiryCandidates(enquiryId: string) {
  return useQuery({
    queryKey: ['international', 'candidates', enquiryId],
    queryFn: () => api.get<StaffCandidate[]>(`/international/enquiries/${enquiryId}/candidates`),
  });
}

export function useProposeCandidate(enquiryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { caregiverId: string; messageToEmployer?: string }) => api.post<StaffCandidate[]>(`/international/enquiries/${enquiryId}/candidates`, body),
    onSuccess: (data) => {
      queryClient.setQueryData(['international', 'candidates', enquiryId], data);
      queryClient.invalidateQueries({ queryKey: ['international', 'enquiry', enquiryId] });
      queryClient.invalidateQueries({ queryKey: ['international', 'enquiries'] });
    },
  });
}

export function useUpdateCandidate(enquiryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: CandidateStatus; interviewAt?: string | null; messageToEmployer?: string | null; staffNote?: string | null }) =>
      api.patch<StaffCandidate>(`/international/candidates/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['international', 'candidates', enquiryId] });
      queryClient.invalidateQueries({ queryKey: ['international', 'interview-requests'] });
      // Marking someone Placed opens a placement.
      queryClient.invalidateQueries({ queryKey: ['international', 'placements'] });
      queryClient.invalidateQueries({ queryKey: ['international', 'summary'] });
    },
  });
}

export function useInterviewRequests() {
  return useQuery({
    queryKey: ['international', 'interview-requests'],
    queryFn: () => api.get<StaffCandidateWithEnquiry[]>('/international/interview-requests'),
  });
}

// --- phase 3: vacancies, placements, placement invoices, expiring documents ----------

const invalidateOverseas = (queryClient: ReturnType<typeof useQueryClient>, ...keys: string[]) => {
  for (const key of keys) queryClient.invalidateQueries({ queryKey: ['international', key] });
  queryClient.invalidateQueries({ queryKey: ['international', 'summary'] });
};

export function useStaffVacancies(filters: { status?: string; enquiryId?: string }, enabled = true) {
  return useQuery({
    queryKey: ['international', 'vacancies', filters],
    queryFn: () => api.get<StaffVacancy[]>('/international/vacancies', { ...(filters.status ? { status: filters.status } : {}), ...(filters.enquiryId ? { enquiryId: filters.enquiryId } : {}) }),
    enabled,
  });
}

export function useSaveStaffVacancy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: VacancyInput & { enquiryId?: string } }) =>
      id ? api.put<StaffVacancy>(`/international/vacancies/${id}`, body) : api.post<StaffVacancy>('/international/vacancies', body),
    onSuccess: () => invalidateOverseas(queryClient, 'vacancies'),
  });
}

export function useReviewVacancy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: 'PUBLISHED' | 'REJECTED' | 'CLOSED' | 'FILLED'; note?: string }) =>
      api.patch<StaffVacancy>(`/international/vacancies/${id}/review`, { status, ...(note ? { note } : {}) }),
    onSuccess: () => invalidateOverseas(queryClient, 'vacancies'),
  });
}

export function useVacancyApplications(vacancyId: string | null) {
  return useQuery({
    queryKey: ['international', 'vacancy-applications', vacancyId],
    queryFn: () => api.get<StaffVacancyApplication[]>(`/international/vacancies/${vacancyId}/applications`),
    enabled: Boolean(vacancyId),
  });
}

export function useUpdateApplication(vacancyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: 'PUT_FORWARD' | 'NOT_SUCCESSFUL' | 'APPLIED'; messageToEmployer?: string | null; staffNote?: string | null }) =>
      api.patch<StaffVacancyApplication>(`/international/vacancy-applications/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['international', 'vacancy-applications', vacancyId] });
      queryClient.invalidateQueries({ queryKey: ['international', 'candidates'] });
      invalidateOverseas(queryClient, 'vacancies');
    },
  });
}

export function usePlacements(status: string, enabled = true) {
  return useQuery({
    queryKey: ['international', 'placements', status],
    queryFn: () => api.get<StaffPlacement[]>('/international/placements', status === 'all' ? {} : { status }),
    enabled,
  });
}

export function usePlacement(id: string) {
  return useQuery({ queryKey: ['international', 'placement', id], queryFn: () => api.get<StaffPlacement>(`/international/placements/${id}`) });
}

export function useUpdatePlacement(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PlacementUpdate) => api.patch<StaffPlacement>(`/international/placements/${id}`, body),
    onSuccess: (data) => {
      queryClient.setQueryData(['international', 'placement', id], data);
      invalidateOverseas(queryClient, 'placements');
    },
  });
}

export function useRecordCheckin(placementId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ checkinId, ...body }: CheckinUpdate & { checkinId: string }) => api.patch<StaffPlacement>(`/international/placements/${placementId}/checkins/${checkinId}`, body),
    onSuccess: (data) => {
      queryClient.setQueryData(['international', 'placement', placementId], data);
      invalidateOverseas(queryClient, 'placements');
    },
  });
}

export function usePlacementInvoices(status: string, enabled = true) {
  return useQuery({
    queryKey: ['international', 'placement-invoices', status],
    queryFn: () => api.get<StaffPlacementInvoiceRow[]>('/international/placement-invoices', status === 'all' ? {} : { status }),
    enabled,
  });
}

export function usePlacementInvoice(id: string) {
  return useQuery({ queryKey: ['international', 'placement-invoice', id], queryFn: () => api.get<PlacementInvoice>(`/international/placement-invoices/${id}`) });
}

type InvoiceAction =
  | { kind: 'create'; body: PlacementInvoiceInput }
  | { kind: 'update'; id: string; body: Omit<PlacementInvoiceInput, 'placementId' | 'enquiryId'> }
  | { kind: 'issue'; id: string }
  | { kind: 'void'; id: string; reason: string }
  | { kind: 'payment'; id: string; body: PlacementPaymentInput };

/** Every change to a placement invoice; its answer replaces the cached invoice. */
export function usePlacementInvoiceAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (a: InvoiceAction): Promise<PlacementInvoice> => {
      switch (a.kind) {
        case 'create':
          return api.post('/international/placement-invoices', a.body);
        case 'update':
          return api.put(`/international/placement-invoices/${a.id}`, a.body);
        case 'issue':
          return api.post(`/international/placement-invoices/${a.id}/issue`);
        case 'void':
          return api.post(`/international/placement-invoices/${a.id}/void`, { reason: a.reason });
        case 'payment':
          return api.post(`/international/placement-invoices/${a.id}/payments`, a.body);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['international', 'placement-invoice', data.id], data);
      invalidateOverseas(queryClient, 'placement-invoices', 'placement', 'placements');
    },
  });
}

export function useDeleteDraftInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/international/placement-invoices/${id}`),
    onSuccess: () => invalidateOverseas(queryClient, 'placement-invoices', 'placement', 'placements'),
  });
}

export function useExpiringDocuments(withinDays: number, enabled = true) {
  return useQuery({
    queryKey: ['international', 'expiring-documents', withinDays],
    queryFn: () => api.get<StaffExpiringDocument[]>('/international/expiring-documents', { withinDays }),
    enabled,
  });
}

export function useRunReminders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ reminders: number; overdueCheckins: number; overdueInvoices: number }>('/international/reminders/run'),
    onSuccess: () => invalidateOverseas(queryClient, 'expiring-documents'),
  });
}

// --- phase 4: results and certificates, interviews, offers, departure, welfare, reports ----

export function useAssessments(filters: { status?: string; caregiverId?: string }, enabled = true) {
  return useQuery({
    queryKey: ['international', 'assessments', filters],
    queryFn: () => api.get<StaffAssessment[]>('/international/assessments', filters),
    enabled,
  });
}

export function useAssessmentActions() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['international', 'assessments'] });
    queryClient.invalidateQueries({ queryKey: ['international', 'summary'] });
  };
  const record = useMutation({ mutationFn: ({ caregiverId, body }: { caregiverId: string; body: AssessmentInput }) => api.post<StaffAssessment>(`/international/caregivers/${caregiverId}/assessments`, body), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: AssessmentInput }) => api.put<StaffAssessment>(`/international/assessments/${id}`, body), onSuccess: refresh });
  const verify = useMutation({ mutationFn: ({ id, verified }: { id: string; verified: boolean }) => api.patch<StaffAssessment>(`/international/assessments/${id}/verify`, { verified }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/international/assessments/${id}`), onSuccess: refresh });
  return { record, update, verify, remove };
}

export function useRevokeCertificate(programmeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<TrainingCertificate>(`/international/certificates/${id}/revoke`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['international', 'enrolments', programmeId] }),
  });
}

export function useStaffInterviews(when: 'upcoming' | 'past' | 'all', enabled = true) {
  return useQuery({ queryKey: ['international', 'interviews', when], queryFn: () => api.get<StaffInterview[]>('/international/interviews', { when }), enabled });
}

export function useInterviewActions(enquiryId: string | null) {
  const queryClient = useQueryClient();
  const refresh = () => {
    if (enquiryId) queryClient.invalidateQueries({ queryKey: ['international', 'candidates', enquiryId] });
    queryClient.invalidateQueries({ queryKey: ['international', 'interviews'] });
    queryClient.invalidateQueries({ queryKey: ['international', 'interview-requests'] });
    queryClient.invalidateQueries({ queryKey: ['international', 'summary'] });
  };
  const schedule = useMutation({ mutationFn: ({ candidateId, body }: { candidateId: string; body: InterviewInput }) => api.post<StaffInterview>(`/international/candidates/${candidateId}/interviews`, body), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: InterviewUpdate }) => api.patch<StaffInterview>(`/international/interviews/${id}`, body), onSuccess: refresh });
  return { schedule, update };
}

export function useStaffOffers(status: string, enabled = true) {
  return useQuery({ queryKey: ['international', 'offers', status], queryFn: () => api.get<StaffJobOffer[]>('/international/offers', status ? { status } : undefined), enabled });
}

export function useReviewOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: OfferReview }) => api.patch<StaffJobOffer>(`/international/offers/${id}/review`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['international', 'offers'] });
      queryClient.invalidateQueries({ queryKey: ['international', 'candidates'] });
      queryClient.invalidateQueries({ queryKey: ['international', 'summary'] });
    },
  });
}

export function useUpdateChecklistItem(placementId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ item, body }: { item: DepartureItem; body: DepartureItemUpdate }) => api.patch<StaffPlacement>(`/international/placements/${placementId}/checklist/${item}`, body),
    onSuccess: (data) => queryClient.setQueryData(['international', 'placement', placementId], data),
  });
}

export function useWelfareReports(status: string, enabled = true) {
  return useQuery({ queryKey: ['international', 'welfare', status], queryFn: () => api.get<StaffWelfareReport[]>('/international/welfare', { status }), enabled, refetchInterval: 30_000 });
}

export function useWelfareActions() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['international', 'welfare'] });
    queryClient.invalidateQueries({ queryKey: ['international', 'summary'] });
  };
  const reply = useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => api.post<StaffWelfareReport>(`/international/welfare/${id}/messages`, { body }), onSuccess: refresh });
  const setStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: WelfareStatus }) => api.patch<StaffWelfareReport>(`/international/welfare/${id}/status`, { status }), onSuccess: refresh });
  return { reply, setStatus };
}

export function useOverseasReport(range: { from?: string; to?: string }, enabled = true) {
  return useQuery({ queryKey: ['international', 'report', range], queryFn: () => api.get<OverseasReport>('/international/reports', range), enabled });
}
