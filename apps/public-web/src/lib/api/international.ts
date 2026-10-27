import type {
  CaregiverExpiringDocument,
  CaregiverPlacement,
  CaregiverVacancyApplication,
  EmployerPlacement,
  PayhereCheckout,
  PlacementInvoice,
  PlacementInvoiceSummary,
  PublicVacancy,
  PublicVacancyList,
  Vacancy,
  VacancyInput,
  CaregiverEmployerInterest,
  EmployerAccount,
  EmployerAccountEnquiryRequest,
  EmployerAccountUpdate,
  EmployerOwnEnquiry,
  EmployerRegistrationRequest,
  InterviewRequest,
  PublicTalentCard,
  ReadinessReport,
  CaregiverTrainingEnrolment,
  EmployerEnquiryReceipt,
  EmployerEnquiryRequest,
  InternationalSummary,
  Locale,
  OverseasReadiness,
  PublicTalentList,
  PublicTalentProfile,
  PublicTrainingProgramme,
  SharedProfileSettings,
  SharedProfileUpdate,
} from '@care-platform/shared';
import { api } from './client';

/** The public international pages: employer enquiries, talent profiles and training. */
export const internationalApi = {
  summary: () => api.get<InternationalSummary>('/public/international/summary'),
  sendEnquiry: (body: EmployerEnquiryRequest) => api.post<EmployerEnquiryReceipt>('/public/international/enquiries', body),
  talent: (params: { locale: Locale; page?: number; pageSize?: number; country?: string; languageId?: string; training?: string; verifiedOnly?: boolean }) =>
    api.get<PublicTalentList>('/public/talent', params),
  talentProfile: (slug: string, locale: Locale) => api.get<PublicTalentProfile>(`/public/talent/${encodeURIComponent(slug)}`, { locale }),
  training: (locale: Locale) => api.get<PublicTrainingProgramme[]>('/public/training', { locale }),
  vacancies: (params: { page?: number; pageSize?: number; country?: string; careSetting?: string; search?: string }) => api.get<PublicVacancyList>('/public/vacancies', params),
  vacancy: (reference: string) => api.get<PublicVacancy>(`/public/vacancies/${encodeURIComponent(reference)}`),
};

/** A caregiver's own Work abroad section. */
export const workAbroadApi = {
  readiness: (id: string) => api.get<OverseasReadiness>(`/caregivers/${id}/overseas`),
  saveReadiness: (id: string, body: OverseasReadiness) => api.put<OverseasReadiness>(`/caregivers/${id}/overseas`, body),
  enrolments: (id: string) => api.get<CaregiverTrainingEnrolment[]>(`/caregivers/${id}/training`),
  registerInterest: (id: string, programmeId: string) => api.post<CaregiverTrainingEnrolment[]>(`/caregivers/${id}/training/${programmeId}`),
  withdraw: (id: string, programmeId: string) => api.delete<CaregiverTrainingEnrolment[]>(`/caregivers/${id}/training/${programmeId}`),
  sharedProfile: (id: string) => api.get<SharedProfileSettings>(`/caregivers/${id}/shared-profile`),
  saveSharedProfile: (id: string, body: SharedProfileUpdate) => api.put<SharedProfileSettings>(`/caregivers/${id}/shared-profile`, body),
  share: (id: string, consentVersion: string) => api.post<SharedProfileSettings>(`/caregivers/${id}/shared-profile/share`, { consent: true, consentVersion }),
  unshare: (id: string) => api.post<SharedProfileSettings>(`/caregivers/${id}/shared-profile/unshare`),
  withdrawConsent: (id: string) => api.post<SharedProfileSettings>(`/caregivers/${id}/shared-profile/withdraw-consent`),
  newLink: (id: string) => api.post<SharedProfileSettings>(`/caregivers/${id}/shared-profile/new-link`),
  uploadPhoto: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<SharedProfileSettings>(`/caregivers/${id}/shared-profile/photo`, form);
  },
  deletePhoto: (id: string) => api.delete<SharedProfileSettings>(`/caregivers/${id}/shared-profile/photo`),
  checklist: (id: string) => api.get<ReadinessReport>(`/caregivers/${id}/overseas/checklist`),
  interest: (id: string) => api.get<CaregiverEmployerInterest[]>(`/caregivers/${id}/overseas/interest`),
  applications: (id: string) => api.get<CaregiverVacancyApplication[]>(`/caregivers/${id}/vacancy-applications`),
  apply: (id: string, reference: string, message?: string) =>
    api.post<CaregiverVacancyApplication[]>(`/caregivers/${id}/vacancies/${encodeURIComponent(reference)}/apply`, message ? { message } : {}),
  withdrawApplication: (id: string, applicationId: string) => api.delete<CaregiverVacancyApplication[]>(`/caregivers/${id}/vacancy-applications/${applicationId}`),
  placements: (id: string) => api.get<CaregiverPlacement[]>(`/caregivers/${id}/overseas/placements`),
  datedDocuments: (id: string) => api.get<CaregiverExpiringDocument[]>(`/caregivers/${id}/overseas/documents`),
};

/** An overseas employer's own account. */
export const employerApi = {
  register: (body: EmployerRegistrationRequest) => api.post<{ message: string; devVerificationUrl?: string }>('/auth/register-employer', body),
  me: () => api.get<EmployerAccount>('/employer/me'),
  updateMe: (body: EmployerAccountUpdate) => api.patch<EmployerAccount>('/employer/me', body),
  enquiries: (locale: Locale) => api.get<EmployerOwnEnquiry[]>('/employer/enquiries', { locale }),
  createEnquiry: (body: EmployerAccountEnquiryRequest) => api.post<{ reference: string }>('/employer/enquiries', body),
  requestInterview: (body: InterviewRequest, locale: Locale) => api.post<EmployerOwnEnquiry[]>(`/employer/candidates?locale=${locale}`, body),
  act: (id: string, body: { action: 'REQUEST_INTERVIEW' | 'SELECT' | 'DECLINE'; message?: string }, locale: Locale) =>
    api.patch<EmployerOwnEnquiry[]>(`/employer/candidates/${id}?locale=${locale}`, body),
  shortlist: (locale: Locale) => api.get<PublicTalentCard[]>('/employer/shortlist', { locale }),
  addToShortlist: (slug: string, locale: Locale) => api.put<PublicTalentCard[]>(`/employer/shortlist/${encodeURIComponent(slug)}?locale=${locale}`),
  removeFromShortlist: (slug: string, locale: Locale) => api.delete<PublicTalentCard[]>(`/employer/shortlist/${encodeURIComponent(slug)}?locale=${locale}`),
  vacancies: () => api.get<Vacancy[]>('/employer/vacancies'),
  createVacancy: (body: VacancyInput) => api.post<Vacancy>('/employer/vacancies', body),
  updateVacancy: (id: string, body: VacancyInput) => api.put<Vacancy>(`/employer/vacancies/${id}`, body),
  closeVacancy: (id: string) => api.post<Vacancy>(`/employer/vacancies/${id}/close`),
  placements: (locale: Locale) => api.get<EmployerPlacement[]>('/employer/placements', { locale }),
  invoices: () => api.get<PlacementInvoiceSummary[]>('/employer/invoices'),
  invoice: (id: string) => api.get<PlacementInvoice>(`/employer/invoices/${id}`),
  payInvoice: (id: string) => api.post<PayhereCheckout>(`/employer/invoices/${id}/payhere`),
};
