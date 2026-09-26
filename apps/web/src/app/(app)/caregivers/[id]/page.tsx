'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api } from '@/lib/api/client';
import {
  useCaregiver,
  useUpdateCaregiverStatus,
  useUpdateCaregiver,
  useDeleteCaregiver,
  useLocations,
  useUpsertHealthInformation,
  useSkills,
  useLanguages,
  useAssignSkill,
  useRemoveSkill,
  useAssignLanguage,
  useRemoveLanguage,
  useQualifications,
  useAddQualification,
  useRemoveQualification,
  useSetQualificationVerification,
  useSetDocumentVerification,
  useRemoveDocument,
  useUploadDocument,
  useAddReference,
  useRemoveReference,
  useSetReferenceVerification,
  useAddVerification,
  useUpdateVerification,
} from '@/lib/hooks/use-caregivers';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StatusBadge, VerificationBadge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { allowedNextStatuses } from '@/lib/caregiver-status';
import { Select } from '@/components/ui/input';
import { PersonalInfoFields } from '@/components/caregivers/personal-info-fields';
import { makePersonalInfoSchema, type PersonalInfoValues } from '@/lib/schemas/personal-info';
import { Trash2 } from 'lucide-react';
import { DocumentViewButton } from '@/components/caregivers/document-view-button';
import { IconButton } from '@/components/ui/icon-button';

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-ink/50">{label}</div>
      <div className="text-sm text-ink">{value ?? '—'}</div>
    </div>
  );
}

export default function CaregiverProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { data: locations } = useLocations();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);
  const [isHealthEditing, setIsHealthEditing] = useState(false);
  const [healthForm, setHealthForm] = useState({
    hasDiabetes: false,
    hasHighBloodPressure: false,
    physicalAbilityToLiftPatients: true,
    surgicalHistory: '',
    mentalHealthInformation: '',
    otherNotes: '',
  });

  const { data: caregiver, isLoading } = useCaregiver(id);
  const updateStatus = useUpdateCaregiverStatus(id);
  const updateCaregiver = useUpdateCaregiver(id);
  const deleteCaregiver = useDeleteCaregiver(id);
  const upsertHealthInfo = useUpsertHealthInformation(id);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [skillId, setSkillId] = useState('');
  const [skillProficiency, setSkillProficiency] = useState('INTERMEDIATE');
  const [skillYears, setSkillYears] = useState(1);
  const [languageId, setLanguageId] = useState('');
  const [languageProficiency, setLanguageProficiency] = useState('FLUENT');

  const { data: allSkills } = useSkills();
  const { data: allLanguages } = useLanguages();
  const assignSkill = useAssignSkill(id);
  const removeSkill = useRemoveSkill(id);
  const assignLanguage = useAssignLanguage(id);
  const removeLanguage = useRemoveLanguage(id);

  const [qualName, setQualName] = useState('');
  const [qualType, setQualType] = useState('NVQ');
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [qualInstitution, setQualInstitution] = useState('');
  const [qualCertificateNumber, setQualCertificateNumber] = useState('');
  const [qualIssueDate, setQualIssueDate] = useState('');

  const { data: qualifications, isLoading: isLoadingQualifications } = useQualifications(id);
  const addQualification = useAddQualification(id);
  const removeQualification = useRemoveQualification(id);
  const setVerification = useSetQualificationVerification(id);
  const setDocumentVerification = useSetDocumentVerification(id);
  const removeDocument = useRemoveDocument(id);
  const uploadDocument = useUploadDocument(id);
  const addReference = useAddReference(id);
  const removeReference = useRemoveReference(id);
  const setReferenceVerification = useSetReferenceVerification(id);

  const [docType, setDocType] = useState('NIC');
  const [deleteRefId, setDeleteRefId] = useState<string | null>(null);
  const [refName, setRefName] = useState('');
  const [refRelationship, setRefRelationship] = useState('');
  const [refPhone, setRefPhone] = useState('');
  const [refEmail, setRefEmail] = useState('');
  const [refNotes, setRefNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: references } = useQuery({
    queryKey: ['references', id],
    queryFn: () => api.get<{ id: string; name: string; relationship: string; phone: string; email?: string | null; notes?: string | null; verificationStatus: string }[]>(`/caregivers/${id}/references`),
    enabled: Boolean(id),
  });
  const { data: verifications } = useQuery({
    queryKey: ['verifications', id],
    queryFn: () => api.get<{ id: string; verificationType: string; status: string; notes?: string | null }[]>(`/caregivers/${id}/verifications`),
    enabled: Boolean(id),
  });
  const addVerification = useAddVerification(id);
  const updateVerification = useUpdateVerification(id);

  const [verifType, setVerifType] = useState('IDENTITY');
  const [verifStatus, setVerifStatus] = useState('PENDING');
  const [verifNotes, setVerifNotes] = useState('');
  const { data: auditEntries } = useQuery({
    queryKey: ['audit', id],
    queryFn: () => api.get<any[]>(`/audit-logs?entityType=Caregiver&entityId=${id}`),
    enabled: Boolean(id) && (user?.role === 'ADMIN'),
  });
  const canSeeHealth = user?.role === 'ADMIN';
  const { data: healthInfo } = useQuery({
    queryKey: ['health-information', id],
    queryFn: async () => {
      const result = await api.get<any>(`/caregivers/${id}/health-information`);
      return result ?? null;
    },
    enabled: Boolean(id) && canSeeHealth,
    placeholderData: null,
  });

  const personalInfoSchemaLocalized = makePersonalInfoSchema(t);

  const form = useForm<PersonalInfoValues>({
    resolver: zodResolver(personalInfoSchemaLocalized),
    defaultValues: {
      fullName: '',
      permanentAddress: '',
      nic: '',
      passportNumber: '',
      dateOfBirth: '',
      gender: 'MALE',
      civilStatus: 'SINGLE',
      heightCm: undefined,
      weightKg: undefined,
      primaryPhone: '',
      secondaryPhone: '',
      emergencyContactName: '',
      emergencyContactNumber: '',
      emergencyContactRelationship: '',
      policeDivision: '',
      policeStation: '',
      district: '',
      city: '',
      postalCode: '',
    },
  });

  // Enter edit mode if ?edit=1 in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === '1') {
      setIsEditing(true);
    }
  }, []);

  // Populate form when caregiver data loads and editing
  useEffect(() => {
    if (isEditing && caregiver) {
      form.reset({
        fullName: caregiver.fullName ?? '',
        permanentAddress: caregiver.permanentAddress ?? '',
        nic: caregiver.nic ?? '',
        passportNumber: caregiver.passportNumber ?? '',
        dateOfBirth: caregiver.dateOfBirth ? caregiver.dateOfBirth.slice(0, 10) : '',
        gender: caregiver.gender as any,
        civilStatus: caregiver.civilStatus as any,
        heightCm: caregiver.heightCm ?? undefined,
        weightKg: caregiver.weightKg ?? undefined,
        primaryPhone: caregiver.primaryPhone ?? '',
        secondaryPhone: caregiver.secondaryPhone ?? '',
        emergencyContactName: caregiver.emergencyContactName ?? '',
        emergencyContactNumber: caregiver.emergencyContactNumber ?? '',
        emergencyContactRelationship: caregiver.emergencyContactRelationship ?? '',
        policeDivision: caregiver.policeDivision ?? '',
        policeStation: caregiver.policeStation ?? '',
        district: caregiver.district ?? '',
        city: caregiver.city ?? '',
        postalCode: caregiver.postalCode ?? '',
      });
    }
  }, [isEditing, caregiver, form]);

  // Populate health form when entering health edit mode
  useEffect(() => {
    if (isHealthEditing && healthInfo) {
      setHealthForm({
        hasDiabetes: healthInfo.hasDiabetes ?? false,
        hasHighBloodPressure: healthInfo.hasHighBloodPressure ?? false,
        physicalAbilityToLiftPatients: healthInfo.physicalAbilityToLiftPatients ?? true,
        surgicalHistory: healthInfo.surgicalHistory ?? '',
        mentalHealthInformation: healthInfo.mentalHealthInformation ?? '',
        otherNotes: healthInfo.otherNotes ?? '',
      });
      setHealthError(null);
    }
  }, [isHealthEditing, healthInfo]);

  if (isLoading || !caregiver) return <p className="text-sm text-ink/50">{t('common.loading')}</p>;

  const nextStatuses = allowedNextStatuses(caregiver.status);

  const onSave = form.handleSubmit((data) => {
    updateCaregiver.mutate(data, { onSuccess: () => setIsEditing(false) });
  });

  const isAdminOrStaff = user?.role === 'ADMIN' || user?.role === 'STAFF';

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">{caregiver.fullName}</h1>
          <p className="text-sm text-ink/50">{caregiver.registrationNumber}</p>
        </div>
        <div className="flex items-center gap-3">
          {isEditing ? (
            <>
              <Button
                type="button"
                variant="primary"
                disabled={updateCaregiver.isPending}
                onClick={onSave}
              >
                {t('common.save')}
              </Button>
              <Button variant="secondary" onClick={() => setIsEditing(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <>
              <StatusBadge status={caregiver.status} label={t(`caregivers.status.${caregiver.status}`)} />
              {nextStatuses.length > 0 && (user?.role === 'ADMIN' || user?.role === 'VERIFIER') && (
                <Select
                  className="w-52"
                  value=""
                  onChange={(e) => e.target.value && updateStatus.mutate(e.target.value)}
                >
                  <option value="">Move to…</option>
                  {nextStatuses.map((s) => (
                    <option key={s} value={s}>
                      {t(`caregivers.status.${s}`)}
                    </option>
                  ))}
                </Select>
              )}
              {isAdminOrStaff && (
                <>
                  <Button variant="secondary" onClick={() => setIsEditing(true)}>
                    {t('common.edit')}
                  </Button>
                  {!isDeleteConfirm ? (
                    <Button variant="danger" onClick={() => setIsDeleteConfirm(true)}>
                      {t('common.delete')}
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-danger">{t('caregivers.confirmDelete')}</span>
                      <Button variant="primary" size="sm" disabled={deleteCaregiver.isPending} onClick={() => deleteCaregiver.mutate()}>
                        {t('common.confirm')}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setIsDeleteConfirm(false)}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('caregivers.profile.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="qualifications">{t('caregivers.profile.tabs.qualifications')}</TabsTrigger>
          <TabsTrigger value="documents">{t('caregivers.profile.tabs.documents')}</TabsTrigger>
          <TabsTrigger value="references">{t('caregivers.profile.tabs.references')}</TabsTrigger>
          <TabsTrigger value="verification">{t('caregivers.profile.tabs.verification')}</TabsTrigger>
          {canSeeHealth && <TabsTrigger value="restricted">{t('caregivers.profile.tabs.restricted')}</TabsTrigger>}
          {user?.role === 'ADMIN' && <TabsTrigger value="audit">{t('caregivers.profile.tabs.audit')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview">
          {isEditing ? (
            <form onSubmit={onSave} className="space-y-5">
              <PersonalInfoFields register={form.register} errors={form.formState.errors} locations={locations ?? []} />
              <div className="flex justify-end border-t border-border pt-4">
                <Button type="submit" disabled={updateCaregiver.isPending}>
                  {updateCaregiver.isPending ? t('common.loading') : t('common.save')}
                </Button>
              </div>
            </form>
          ) : (
            <Card>
              <CardContent className="grid grid-cols-1 gap-5 py-5 sm:grid-cols-3">
                <Field label="NIC" value={caregiver.nic} />
                <Field label="Passport" value={caregiver.passportNumber} />
                <Field label="Date of birth" value={caregiver.dateOfBirth?.slice(0, 10)} />
                <Field label="Gender" value={caregiver.gender} />
                <Field label="Civil status" value={caregiver.civilStatus} />
                <Field label="Height / weight" value={`${caregiver.heightCm ?? '—'} cm / ${caregiver.weightKg ?? '—'} kg`} />
                <Field label="Primary phone" value={caregiver.primaryPhone} />
                <Field label="Secondary phone" value={caregiver.secondaryPhone} />
                <Field label="Address" value={caregiver.permanentAddress} />
                <Field label="Emergency contact" value={`${caregiver.emergencyContactName} (${caregiver.emergencyContactRelationship})`} />
                <Field label="Emergency number" value={caregiver.emergencyContactNumber} />
                <Field label="Police division / station" value={`${caregiver.policeDivision ?? '—'} / ${caregiver.policeStation ?? '—'}`} />
                <Field label="District" value={caregiver.district} />
                <Field label="City" value={caregiver.city} />
                <Field label="Postal code" value={caregiver.postalCode} />
              </CardContent>
            </Card>
          )}

          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Card>
              <CardContent className="py-5">
                <h4 className="mb-3 text-sm font-semibold text-ink">{t('caregivers.profile.tabs.skills')}</h4>
                {isEditing ? (
                  <div className="space-y-3">
                    {caregiver.skills.map((s) => (
                      <div key={s.skillId} className="flex items-center justify-between rounded border border-border px-3 py-2">
                        <span className="text-sm text-ink">{s.name} · {s.proficiency}</span>
                        <IconButton
                          icon={<Trash2 size={15} />}
                          aria-label="Delete skill"
                          onClick={() => removeSkill.mutate(s.skillId)}
                          disabled={removeSkill.isPending}
                        />
                      </div>
                    ))}
                    <div className="flex flex-wrap items-end gap-3 rounded border border-dashed border-border p-3">
                      <div className="min-w-[180px] flex-1">
                        <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.selectSkill')}</div>
                        <Select
                          value={skillId}
                          onChange={(e) => { setSkillId(e.target.value); setSkillProficiency('INTERMEDIATE'); setSkillYears(1); }}
                        >
                          <option value="">{t('caregivers.edit.selectSkill')}</option>
                          {(allSkills ?? []).filter((sk) => !caregiver.skills.some((a) => a.skillId === sk.id)).map((sk) => (
                            <option key={sk.id} value={sk.id}>{sk.name}</option>
                          ))}
                        </Select>
                      </div>
                      <div className="w-40">
                        <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.proficiency')}</div>
                        <Select value={skillProficiency} onChange={(e) => setSkillProficiency(e.target.value)}>
                          {['BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'].map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </Select>
                      </div>
                      <div className="w-36">
                        <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.yearsOfExperience')}</div>
                        <input
                          type="number"
                          min={0}
                          value={skillYears}
                          onChange={(e) => setSkillYears(Number(e.target.value))}
                          className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!skillId || assignSkill.isPending}
                        onClick={() => {
                          assignSkill.mutate({ skillId, proficiency: skillProficiency, yearsOfExperience: skillYears }, {
                            onSuccess: () => { setSkillId(''); setSkillProficiency('INTERMEDIATE'); setSkillYears(1); },
                          });
                        }}
                      >
                        {t('caregivers.edit.addSkill')}
                      </Button>
                    </div>
                    {caregiver.skills.length === 0 && <p className="text-sm text-ink/40">{t('caregivers.edit.noSkills')}</p>}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {caregiver.skills.map((s) => (
                      <span key={s.skillId} className="rounded bg-brand-light px-2 py-1 text-xs text-brand-dark">
                        {s.name} · {s.proficiency}
                      </span>
                    ))}
                    {caregiver.skills.length === 0 && <span className="text-sm text-ink/40">None recorded</span>}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-5">
                <h4 className="mb-3 text-sm font-semibold text-ink">{t('caregivers.profile.tabs.languages')}</h4>
                {isEditing ? (
                  <div className="space-y-3">
                    {caregiver.languages.map((l) => (
                      <div key={l.languageId} className="flex items-center justify-between rounded border border-border px-3 py-2">
                        <span className="text-sm text-ink">{l.name} · {l.proficiency}</span>
                        <IconButton
                          icon={<Trash2 size={15} />}
                          aria-label="Delete language"
                          onClick={() => removeLanguage.mutate(l.languageId)}
                          disabled={removeLanguage.isPending}
                        />
                      </div>
                    ))}
                    <div className="flex flex-wrap items-end gap-3 rounded border border-dashed border-border p-3">
                      <div className="min-w-[180px] flex-1">
                        <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.selectLanguage')}</div>
                        <Select
                          value={languageId}
                          onChange={(e) => { setLanguageId(e.target.value); setLanguageProficiency('FLUENT'); }}
                        >
                          <option value="">{t('caregivers.edit.selectLanguage')}</option>
                          {(allLanguages ?? []).filter((lg) => !caregiver.languages.some((a) => a.languageId === lg.id)).map((lg) => (
                            <option key={lg.id} value={lg.id}>{lg.name}</option>
                          ))}
                        </Select>
                      </div>
                      <div className="w-40">
                        <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.proficiency')}</div>
                        <Select value={languageProficiency} onChange={(e) => setLanguageProficiency(e.target.value)}>
                          {['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'].map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!languageId || assignLanguage.isPending}
                        onClick={() => {
                          assignLanguage.mutate({ languageId, proficiency: languageProficiency }, {
                            onSuccess: () => { setLanguageId(''); setLanguageProficiency('FLUENT'); },
                          });
                        }}
                      >
                        {t('caregivers.edit.addLanguage')}
                      </Button>
                    </div>
                    {caregiver.languages.length === 0 && <p className="text-sm text-ink/40">{t('caregivers.edit.noLanguages')}</p>}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {caregiver.languages.map((l) => (
                      <span key={l.languageId} className="rounded bg-accent-light px-2 py-1 text-xs text-accent">
                        {l.name} · {l.proficiency}
                      </span>
                    ))}
                    {caregiver.languages.length === 0 && <span className="text-sm text-ink/40">None recorded</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="qualifications">
          <Card>
            <CardContent className="py-5 space-y-3">
              <h4 className="text-sm font-semibold text-ink">{t('caregivers.edit.qualifications')}</h4>
              {isEditing ? (
                <>
                  {isLoadingQualifications && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
                  {qualifications?.map((q) => (
                    <div key={q.id} className="flex items-center justify-between rounded border border-border px-3 py-2">
                      <div>
                        <div className="text-sm text-ink">{q.name}</div>
                        <div className="text-xs text-ink/50">
                          {q.type.replace('_', ' ')} · {q.institution}
                          {q.certificateNumber && ` · ${q.certificateNumber}`}
                        </div>
                      </div>
                      {(user?.role === 'ADMIN' || user?.role === 'VERIFIER') && (
                        <Select
                          value={q.verificationStatus || 'PENDING'}
                          onChange={(e) => setVerification.mutate({ qualificationId: q.id, status: e.target.value })}
                          disabled={setVerification.isPending}
                          className="w-32"
                        >
                          {(['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'] as const).map((status) => (
                            <option key={status} value={status}>
                              {t(`caregivers.edit.${status === 'PENDING' ? 'pending' : status === 'IN_PROGRESS' ? 'inProgress' : status.toLowerCase()}`)}
                            </option>
                          ))}
                        </Select>
                      )}
                      <IconButton
                        icon={<Trash2 size={15} />}
                        aria-label="Delete qualification"
                        onClick={() => removeQualification.mutate(q.id)}
                        disabled={removeQualification.isPending}
                      />
                    </div>
                  ))}
                  <div className="rounded border border-dashed border-border bg-white p-5 space-y-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.qualificationName')}</div>
                        <input
                          type="text"
                          value={qualName}
                          onChange={(e) => setQualName(e.target.value)}
                          className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.qualificationType')}</div>
                        <Select value={qualType} onChange={(e) => setQualType(e.target.value)}>
                          {['NVQ', 'NURSING_DIPLOMA', 'NURSING_DEGREE', 'CAREGIVER_CERTIFICATE', 'FIRST_AID', 'OTHER'].map(
                            (tp) => (
                              <option key={tp} value={tp}>{tp.replace('_', ' ')}</option>
                            ),
                          )}
                        </Select>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.institution')}</div>
                        <input
                          type="text"
                          value={qualInstitution}
                          onChange={(e) => setQualInstitution(e.target.value)}
                          className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.certificateNumber')}</div>
                        <input
                          type="text"
                          value={qualCertificateNumber}
                          onChange={(e) => setQualCertificateNumber(e.target.value)}
                          className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.issueDate')}</div>
                        <input
                          type="date"
                          value={qualIssueDate}
                          onChange={(e) => setQualIssueDate(e.target.value)}
                          className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!qualName || !qualInstitution || addQualification.isPending}
                      onClick={() => {
                        addQualification.mutate({
                          name: qualName,
                          type: qualType,
                          institution: qualInstitution,
                          certificateNumber: qualCertificateNumber || null,
                          issueDate: qualIssueDate || null,
                        }, {
                          onSuccess: () => {
                            setQualName('');
                            setQualType('NVQ');
                            setQualInstitution('');
                            setQualCertificateNumber('');
                            setQualIssueDate('');
                          },
                        });
                      }}
                    >
                      {t('caregivers.edit.addQualification')}
                    </Button>
                  </div>
                  {qualifications?.length === 0 && <p className="text-sm text-ink/40">{t('caregivers.edit.noQualifications')}</p>}
                </>
              ) : (
                <div className="space-y-2">
                  {qualifications?.map((q) => (
                    <div key={q.id} className="flex items-center justify-between rounded border border-border px-3 py-2">
                      <div>
                        <div className="text-sm text-ink">{q.name}</div>
                        <div className="text-xs text-ink/50">
                          {q.type.replace('_', ' ')} · {q.institution}
                          {q.certificateNumber && ` · ${q.certificateNumber}`}
                        </div>
                      </div>
                      {(user?.role === 'ADMIN' || user?.role === 'VERIFIER') && (
                        <Select
                          value={q.verificationStatus || 'PENDING'}
                          onChange={(e) => setVerification.mutate({ qualificationId: q.id, status: e.target.value })}
                          disabled={setVerification.isPending}
                          className="w-32"
                        >
                          {(['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'] as const).map((status) => (
                            <option key={status} value={status}>
                              {t(`caregivers.edit.${status === 'PENDING' ? 'pending' : status === 'IN_PROGRESS' ? 'inProgress' : status.toLowerCase()}`)}
                            </option>
                          ))}
                        </Select>
                      )}
                      {q.verificationStatus && !(user?.role === 'ADMIN' || user?.role === 'VERIFIER') && (
                        <VerificationBadge status={q.verificationStatus} />
                      )}
                    </div>
                  ))}
                  {(!qualifications || qualifications.length === 0) && (
                    <p className="text-sm text-ink/40">{t('caregivers.edit.noQualifications')}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardContent className="divide-y divide-border py-5">
              <div className="rounded border border-dashed border-border bg-white p-5">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.documentType')}</div>
                    <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
                      {['NIC', 'PASSPORT', 'GRAMA_NILADHARI_CERTIFICATE', 'POLICE_CLEARANCE', 'CAREGIVER_CERTIFICATE', 'NVQ_CERTIFICATE', 'NURSING_CERTIFICATE', 'CV', 'OTHER'].map(
                        (tp) => (
                          <option key={tp} value={tp}>{tp.replace('_', ' ')}</option>
                        ),
                      )}
                    </Select>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.fileLabel')}</div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadDocument.mutate({ documentType: docType, file });
                      }}
                      className="text-sm text-ink/70 file:mr-3 file:rounded file:border-0 file:bg-brand-light file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-dark"
                    />
                  </div>
                  {uploadDocument.isPending && (
                    <span className="flex items-center gap-1 text-xs text-ink/50">
                      {t('caregivers.edit.uploading')}
                    </span>
                  )}
                </div>
              </div>
              {caregiver.documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-3 first:pt-5 last:pb-5">
                  <div>
                    <div className="text-sm text-ink">{d.documentType.replace('_', ' ')}</div>
                    <div className="text-xs text-ink/50">{d.originalFilename}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(user?.role === 'ADMIN' || user?.role === 'VERIFIER') && (
                      <Select
                        value={d.verificationStatus || 'PENDING'}
                        onChange={(e) => setDocumentVerification.mutate({ documentId: d.id, status: e.target.value })}
                        disabled={setDocumentVerification.isPending}
                        className="w-32"
                      >
                        {(['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'] as const).map((status) => (
                          <option key={status} value={status}>
                            {t(`caregivers.edit.${status === 'PENDING' ? 'pending' : status === 'IN_PROGRESS' ? 'inProgress' : status.toLowerCase()}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                    {user?.role === 'ADMIN' && (deleteDocId !== d.id ? (
                      <IconButton
                        icon={<Trash2 size={15} />}
                        aria-label="Delete document"
                        onClick={() => setDeleteDocId(d.id)}
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-danger">{t('caregivers.confirmDeleteDocument')}</span>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={removeDocument.isPending}
                          onClick={() => { removeDocument.mutate(d.id); setDeleteDocId(null); }}
                        >
                          {t('common.confirm')}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setDeleteDocId(null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    ))}
                    <DocumentViewButton caregiverId={id} documentId={d.id} />
                  </div>
                  {!(user?.role === 'ADMIN' || user?.role === 'VERIFIER') && (
                    <VerificationBadge status={d.verificationStatus} />
                  )}
                </div>
              ))}
              {caregiver.documents.length === 0 && <p className="py-5 text-sm text-ink/40">No documents uploaded.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="references">
          <Card>
            <CardContent className="divide-y divide-border py-5">
              <div className="rounded border border-dashed border-border bg-white p-5 space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.referenceName')}</div>
                    <input
                      type="text"
                      value={refName}
                      onChange={(e) => setRefName(e.target.value)}
                      className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.referenceRelationship')}</div>
                    <input
                      type="text"
                      value={refRelationship}
                      onChange={(e) => setRefRelationship(e.target.value)}
                      className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.referencePhone')}</div>
                    <input
                      type="text"
                      value={refPhone}
                      onChange={(e) => setRefPhone(e.target.value)}
                      className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.referenceEmail')}</div>
                    <input
                      type="email"
                      value={refEmail}
                      onChange={(e) => setRefEmail(e.target.value)}
                      className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.referenceNotes')}</div>
                    <input
                      type="text"
                      value={refNotes}
                      onChange={(e) => setRefNotes(e.target.value)}
                      className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!refName || !refRelationship || !refPhone || addReference.isPending}
                  onClick={() => {
                    addReference.mutate(
                      { name: refName, relationship: refRelationship, phone: refPhone, email: refEmail || undefined, notes: refNotes || undefined },
                      {
                        onSuccess: () => {
                          setRefName('');
                          setRefRelationship('');
                          setRefPhone('');
                          setRefEmail('');
                          setRefNotes('');
                        },
                      },
                    );
                  }}
                >
                  {t('caregivers.edit.addReference')}
                </Button>
              </div>
              {references?.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-3 first:pt-5 last:pb-5">
                  <div>
                    <div className="text-sm text-ink">
                      {r.name} <span className="text-ink/40">· {r.relationship}</span>
                    </div>
                    <div className="text-xs text-ink/50">{r.phone}</div>
                    {r.email && <div className="text-xs text-ink/40">{r.email}</div>}
                    {r.notes && <div className="text-xs text-ink/40">{r.notes}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    {(user?.role === 'ADMIN' || user?.role === 'VERIFIER') && (
                      <Select
                        value={r.verificationStatus || 'PENDING'}
                        onChange={(e) => setReferenceVerification.mutate({ referenceId: r.id, status: e.target.value })}
                        disabled={setReferenceVerification.isPending}
                        className="w-32"
                      >
                        {(['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'] as const).map((status) => (
                          <option key={status} value={status}>
                            {t(`caregivers.edit.${status === 'PENDING' ? 'pending' : status === 'IN_PROGRESS' ? 'inProgress' : status.toLowerCase()}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                    {user?.role === 'ADMIN' && (deleteRefId !== r.id ? (
                      <IconButton
                        icon={<Trash2 size={15} />}
                        aria-label="Delete reference"
                        onClick={() => setDeleteRefId(r.id)}
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-danger">{t('caregivers.confirmDeleteReference')}</span>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={removeReference.isPending}
                          onClick={() => { removeReference.mutate(r.id); setDeleteRefId(null); }}
                        >
                          {t('common.confirm')}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setDeleteRefId(null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    ))}
                  </div>
                  {!(user?.role === 'ADMIN' || user?.role === 'VERIFIER') && (
                    <VerificationBadge status={r.verificationStatus} />
                  )}
                </div>
              ))}
              {references?.length === 0 && <p className="py-5 text-sm text-ink/40">No references on file.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verification">
          <Card>
            <CardContent className="divide-y divide-border py-5">
              <div className="rounded border border-dashed border-border bg-white p-5 space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.verificationType')}</div>
                    <Select value={verifType} onChange={(e) => setVerifType(e.target.value)}>
                      {['IDENTITY', 'POLICE_CLEARANCE', 'QUALIFICATION', 'EXPERIENCE', 'REFERENCE', 'OVERALL'].map(
                        (tp) => (
                          <option key={tp} value={tp}>{tp.replace('_', ' ')}</option>
                        ),
                      )}
                    </Select>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.verificationStatus')}</div>
                    <Select value={verifStatus} onChange={(e) => setVerifStatus(e.target.value)}>
                      {['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'].map((s) => (
                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-ink/70">{t('caregivers.edit.verificationNotes')}</div>
                    <input
                      type="text"
                      value={verifNotes}
                      onChange={(e) => setVerifNotes(e.target.value)}
                      className="w-full rounded border border-border bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={addVerification.isPending}
                  onClick={() => {
                    addVerification.mutate(
                      { verificationType: verifType, status: verifStatus, notes: verifNotes || undefined },
                      {
                        onSuccess: () => {
                          setVerifType('IDENTITY');
                          setVerifStatus('PENDING');
                          setVerifNotes('');
                        },
                      },
                    );
                  }}
                >
                  {t('caregivers.edit.addVerification')}
                </Button>
              </div>
              {verifications?.map((v) => (
                <div key={v.id} className="flex items-center justify-between py-3 first:pt-5 last:pb-5">
                  <div>
                    <div className="text-sm text-ink">{v.verificationType.replace('_', ' ')}</div>
                    {v.notes && <div className="text-xs text-ink/40">{v.notes}</div>}
                  </div>
                  {(user?.role === 'ADMIN' || user?.role === 'VERIFIER') && (
                    <Select
                      value={v.status || 'PENDING'}
                      onChange={(e) => updateVerification.mutate({ verificationId: v.id, status: e.target.value })}
                      disabled={updateVerification.isPending}
                      className="w-32"
                    >
                      {(['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'] as const).map((status) => (
                        <option key={status} value={status}>
                          {t(`caregivers.edit.${status === 'PENDING' ? 'pending' : status === 'IN_PROGRESS' ? 'inProgress' : status.toLowerCase()}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                  {!(user?.role === 'ADMIN' || user?.role === 'VERIFIER') && (
                    <VerificationBadge status={v.status} />
                  )}
                </div>
              ))}
              {verifications?.length === 0 && <p className="py-5 text-sm text-ink/40">No verification records yet.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        {canSeeHealth && (
          <TabsContent value="restricted">
            <Card>
              <CardContent className="py-5">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-ink">{t('healthInfo.title')}</h4>
                  {!isHealthEditing && (
                    <Button variant="secondary" size="sm" onClick={() => setIsHealthEditing(true)}>
                      {t('healthInfo.edit')}
                    </Button>
                  )}
                </div>
                {isHealthEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      console.log('Health form submit:', healthForm);
                      setHealthError(null);
                      upsertHealthInfo.mutate(healthForm, {
                        onSuccess: () => {
                          setIsHealthEditing(false);
                          setHealthError(null);
                        },
                        onError: (err) => {
                          console.error('Health save error:', err);
                          setHealthError(err instanceof Error ? err.message : String(err));
                        },
                      });
                    }}
                    className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                  >
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={healthForm.hasDiabetes}
                        onChange={(e) => setHealthForm((f) => ({ ...f, hasDiabetes: e.target.checked }))}
                        className="h-4 w-4"
                      />
                      {t('healthInfo.diabetes')}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={healthForm.hasHighBloodPressure}
                        onChange={(e) => setHealthForm((f) => ({ ...f, hasHighBloodPressure: e.target.checked }))}
                        className="h-4 w-4"
                      />
                      {t('healthInfo.highBloodPressure')}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={healthForm.physicalAbilityToLiftPatients}
                        onChange={(e) =>
                          setHealthForm((f) => ({ ...f, physicalAbilityToLiftPatients: e.target.checked }))
                        }
                        className="h-4 w-4"
                      />
                      {t('healthInfo.physicalAbilityToLift')}
                    </label>
                    <div className="flex items-center gap-2">
                      <Button type="submit" variant="primary" size="sm" disabled={upsertHealthInfo.isPending}>
                        {upsertHealthInfo.isPending ? t('common.loading') : t('healthInfo.save')}
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setIsHealthEditing(false)}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                    {healthError && (
                      <div className="col-span-2 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                        {healthError}
                      </div>
                    )}
                    <div className="sm:col-span-2">
                      <div className="mb-1 text-xs font-medium text-ink/70">{t('healthInfo.surgicalHistory')}</div>
                      <textarea
                        className="w-full rounded border border-border bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-brand"
                        rows={2}
                        value={healthForm.surgicalHistory}
                        onChange={(e) => setHealthForm((f) => ({ ...f, surgicalHistory: e.target.value }))}
                        placeholder={t('healthInfo.placeholder.surgicalHistory')}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <div className="mb-1 text-xs font-medium text-ink/70">{t('healthInfo.mentalHealth')}</div>
                      <textarea
                        className="w-full rounded border border-border bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-brand"
                        rows={2}
                        value={healthForm.mentalHealthInformation}
                        onChange={(e) => setHealthForm((f) => ({ ...f, mentalHealthInformation: e.target.value }))}
                        placeholder={t('healthInfo.placeholder.mentalHealth')}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <div className="mb-1 text-xs font-medium text-ink/70">{t('healthInfo.otherNotes')}</div>
                      <textarea
                        className="w-full rounded border border-border bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-brand"
                        rows={2}
                        value={healthForm.otherNotes}
                        onChange={(e) => setHealthForm((f) => ({ ...f, otherNotes: e.target.value }))}
                        placeholder={t('healthInfo.placeholder.otherNotes')}
                      />
                    </div>
                  </form>
                ) : (
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label={t('healthInfo.diabetes')} value={healthInfo?.hasDiabetes ? t('common.yes') : t('common.no')} />
                    <Field label={t('healthInfo.highBloodPressure')} value={healthInfo?.hasHighBloodPressure ? t('common.yes') : t('common.no')} />
                    <Field
                      label={t('healthInfo.physicalAbilityToLift')}
                      value={healthInfo?.physicalAbilityToLiftPatients ? t('common.yes') : t('common.no')}
                    />
                    <Field label={t('healthInfo.surgicalHistory')} value={healthInfo?.surgicalHistory} />
                    <Field label={t('healthInfo.mentalHealth')} value={healthInfo?.mentalHealthInformation} />
                    <Field label={t('healthInfo.otherNotes')} value={healthInfo?.otherNotes} />
                  </div>
                )}
              </CardContent>
            </Card>
            <p className="mt-3 text-xs text-ink/40">Access to this tab is restricted and every view is recorded in the audit log.</p>
          </TabsContent>
        )}

        {user?.role === 'ADMIN' && (
          <TabsContent value="audit">
            <Card>
              <CardContent className="divide-y divide-border py-5">
                {auditEntries?.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between py-3 first:pt-5 last:pb-5 text-sm">
                    <span className="text-ink">{a.action.replace(/_/g, ' ')}</span>
                    <span className="text-ink/40">{new Date(a.createdAt).toLocaleString()}</span>
                  </div>
                ))}
                {auditEntries?.length === 0 && <p className="py-5 text-sm text-ink/40">No audit entries yet.</p>}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
