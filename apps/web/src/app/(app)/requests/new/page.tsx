'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, UserPlus, Users } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useCreatePhoneRequest } from '@/lib/hooks/use-care-requests';
import { useClient } from '@/lib/hooks/use-clients';
import { useCities, useLocationTree } from '@/lib/hooks/use-caregivers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, RequiredLegend, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { ClientPicker } from '@/components/requests/client-picker';
import { CaregiverPicker, type PickedCaregiver } from '@/components/requests/caregiver-picker';
import { cn } from '@/lib/utils';
import type { Client, PhoneClientInput } from '@/lib/api/types';
import { careTypeValues, type CareType } from '@care-platform/shared';

const RELATIONSHIPS = ['PARENT', 'SPOUSE', 'CHILD', 'SIBLING', 'OTHER_RELATIVE', 'FRIEND', 'OTHER'] as const;
const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const METHODS = ['PHONE_CALL', 'WHATSAPP', 'EMAIL'] as const;
const TIMES = ['ANYTIME', 'MORNING', 'AFTERNOON', 'EVENING'] as const;
const SCHEDULES = ['DAY', 'NIGHT', 'LIVE_IN_24H', 'NOT_SURE'] as const;
const STARTS = ['IMMEDIATELY', 'WITHIN_WEEK', 'WITHIN_MONTH', 'JUST_EXPLORING'] as const;
const CAREGIVER_GENDERS = ['NO_PREFERENCE', 'MALE', 'FEMALE'] as const;
const LANGUAGES = ['en', 'si', 'ta'] as const;

type CallerDraft = {
  fullName: string;
  phone: string;
  email: string;
  registrantType: 'SELF' | 'GUARDIAN';
  recipientName: string;
  recipientRelationship: string;
  recipientAge: string;
  recipientGender: string;
  alternatePhone: string;
  preferredContactMethod: string;
  preferredContactTime: string;
  districtId: string;
  cityId: string;
  careAddress: string;
  careNeeds: string;
  careSchedule: string;
  careStart: string;
  preferredCaregiverGender: string;
  consentConfirmed: boolean;
};

const EMPTY_CALLER: CallerDraft = {
  fullName: '',
  phone: '',
  email: '',
  registrantType: 'GUARDIAN',
  recipientName: '',
  recipientRelationship: '',
  recipientAge: '',
  recipientGender: '',
  alternatePhone: '',
  preferredContactMethod: 'PHONE_CALL',
  preferredContactTime: 'ANYTIME',
  districtId: '',
  cityId: '',
  careAddress: '',
  careNeeds: '',
  careSchedule: '',
  careStart: '',
  preferredCaregiverGender: 'NO_PREFERENCE',
  consentConfirmed: false,
};

/** What the form still needs before it can be sent, so the button can say so. */
function missingCallerFields(c: CallerDraft): string[] {
  const missing: string[] = [];
  if (c.fullName.trim().length < 2) missing.push('fullName');
  if (c.phone.trim().length < 7) missing.push('phone');
  if (c.registrantType === 'GUARDIAN') {
    if (c.recipientName.trim().length < 2) missing.push('recipientName');
    if (!c.recipientRelationship) missing.push('recipientRelationship');
  }
  if (c.recipientAge === '') missing.push('recipientAge');
  if (!c.recipientGender) missing.push('recipientGender');
  if (!c.districtId || !c.cityId) missing.push('location');
  if (c.careNeeds.trim().length < 10) missing.push('careNeeds');
  if (!c.careSchedule) missing.push('careSchedule');
  if (!c.careStart) missing.push('careStart');
  if (!c.consentConfirmed) missing.push('consent');
  return missing;
}

function toPayload(c: CallerDraft): PhoneClientInput {
  const guardian = c.registrantType === 'GUARDIAN';
  const opt = (v: string) => v.trim() || undefined;
  return {
    fullName: c.fullName.trim(),
    phone: c.phone.trim(),
    email: opt(c.email),
    consentConfirmed: c.consentConfirmed,
    registrantType: c.registrantType,
    recipientName: guardian ? c.recipientName.trim() : undefined,
    recipientRelationship: guardian ? c.recipientRelationship : undefined,
    recipientAge: Number(c.recipientAge),
    recipientGender: c.recipientGender,
    alternatePhone: opt(c.alternatePhone),
    preferredContactMethod: c.preferredContactMethod,
    preferredContactTime: c.preferredContactTime,
    districtId: Number(c.districtId),
    cityId: Number(c.cityId),
    careAddress: opt(c.careAddress),
    careNeeds: c.careNeeds.trim(),
    careSchedule: c.careSchedule,
    careStart: c.careStart,
    preferredCaregiverGender: c.preferredCaregiverGender,
  };
}

/**
 * Take a request down during a phone call: who is calling (an existing client,
 * or a first-time caller added here), which caregiver they asked about - if
 * any; staff can match later - and what they asked for. The request then sits
 * in the queue like one sent from the website, and the caller gets the same
 * confirmation and updates.
 */
// useSearchParams needs a Suspense boundary for the static build.
export default function NewPhoneRequestRoute() {
  return (
    <Suspense>
      <NewPhoneRequestPage />
    </Suspense>
  );
}

function NewPhoneRequestPage() {
  const { t, locale } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const create = useCreatePhoneRequest();

  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [client, setClient] = useState<Client | null>(null);
  const [caller, setCaller] = useState<CallerDraft>(EMPTY_CALLER);
  const [caregiver, setCaregiver] = useState<PickedCaregiver | null>(null);
  const [message, setMessage] = useState('');
  const [careType, setCareType] = useState<CareType | ''>('');
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>('en');

  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [authLoading, user, router]);

  // Started from a client's record: that client is already chosen.
  const presetId = params.get('patientId') ?? undefined;
  const { data: preset } = useClient(presetId);
  useEffect(() => {
    if (preset) setClient(preset);
  }, [preset]);

  const { data: tree } = useLocationTree(locale);
  const districts = useMemo(
    () => (tree ?? []).flatMap((p) => p.districts).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [tree, locale],
  );
  const { data: cities = [] } = useCities(caller.districtId ? Number(caller.districtId) : null, locale);

  const set = <K extends keyof CallerDraft>(key: K, value: CallerDraft[K]) => setCaller((c) => ({ ...c, [key]: value }));

  const missing = mode === 'new' ? missingCallerFields(caller) : client ? [] : ['client'];
  const ready = missing.length === 0;

  const submit = () => {
    if (!ready) return;
    create.mutate(
      {
        ...(mode === 'existing' ? { patientId: client!.id } : { newClient: toPayload(caller) }),
        ...(caregiver ? { caregiverId: caregiver.id } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
        ...(careType ? { careType } : {}),
        language,
      },
      { onSuccess: (detail) => router.push(`/requests/${detail.id}`) },
    );
  };

  if (authLoading || !user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const opt = (group: string, value: string) => t(`clients.options.${group}.${value}`);

  return (
    <div className="max-w-3xl">
      <Link href="/requests" className="mb-4 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ChevronLeft size={16} />
        {t('requests.back')}
      </Link>
      <h1 className="text-xl font-semibold text-ink">{t('requests.new.title')}</h1>
      <p className="mb-6 mt-1 text-sm text-ink/60">{t('requests.new.subtitle')}</p>

      <div className="space-y-4">
        {/* 1. Caller -------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>{t('requests.new.callerTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 inline-flex rounded border border-border p-0.5" role="tablist">
              {(
                [
                  ['existing', Users, 'requests.new.existingClient'],
                  ['new', UserPlus, 'requests.new.newCaller'],
                ] as const
              ).map(([key, Icon, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  onClick={() => setMode(key)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                    mode === key ? 'bg-brand text-white' : 'text-ink/70 hover:bg-paper',
                  )}
                >
                  <Icon size={15} aria-hidden />
                  {t(label)}
                </button>
              ))}
            </div>

            {mode === 'existing' &&
              (client ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-paper px-3 py-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{client.fullName}</span>
                      <StatusBadge status={client.status} label={t(`clients.status.${client.status}`)} />
                    </div>
                    <div className="text-xs text-ink/50">
                      {[client.phone || client.accountPhone, client.email, client.recipientName && t('requests.forRecipient', { name: client.recipientName })]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setClient(null)}>
                    {t('requests.new.changeClient')}
                  </Button>
                </div>
              ) : (
                <>
                  <ClientPicker onPick={setClient} />
                  <p className="mt-2 text-xs text-ink/50">{t('requests.new.searchFirstHint')}</p>
                </>
              ))}

            {mode === 'new' && (
              <div className="space-y-5">
                <RequiredLegend label={t('common.requiredField')} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="fullName" required>{t('requests.new.fullName')}</Label>
                    <Input id="fullName" value={caller.fullName} onChange={(e) => set('fullName', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="phone" required>{t('requests.new.phone')}</Label>
                    <Input id="phone" type="tel" placeholder="0771234567" value={caller.phone} onChange={(e) => set('phone', e.target.value)} />
                    <p className="mt-1 text-xs text-ink/50">{t('requests.new.phoneHint')}</p>
                  </div>
                  <div>
                    <Label htmlFor="email">{t('requests.new.email')}</Label>
                    <Input id="email" type="email" value={caller.email} onChange={(e) => set('email', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="alternatePhone">{t('requests.new.alternatePhone')}</Label>
                    <Input id="alternatePhone" type="tel" value={caller.alternatePhone} onChange={(e) => set('alternatePhone', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="preferredContactMethod" required>{t('requests.detail.preferredContact')}</Label>
                    <Select id="preferredContactMethod" value={caller.preferredContactMethod} onChange={(e) => set('preferredContactMethod', e.target.value)}>
                      {METHODS.filter((m) => m !== 'EMAIL' || caller.email.trim()).map((m) => (
                        <option key={m} value={m}>
                          {opt('contactMethod', m)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="preferredContactTime">{t('requests.new.contactTime')}</Label>
                    <Select id="preferredContactTime" value={caller.preferredContactTime} onChange={(e) => set('preferredContactTime', e.target.value)}>
                      {TIMES.map((v) => (
                        <option key={v} value={v}>
                          {opt('contactTime', v)}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <fieldset className="border-t border-border pt-4">
                  <legend className="mb-2 text-sm font-semibold text-ink">{t('requests.new.whoNeedsCare')}</legend>
                  <div className="mb-3 flex flex-wrap gap-4 text-sm">
                    {(['GUARDIAN', 'SELF'] as const).map((v) => (
                      <label key={v} className="flex items-center gap-2">
                        <input type="radio" name="registrantType" checked={caller.registrantType === v} onChange={() => set('registrantType', v)} />
                        {t(`requests.new.registrant.${v}`)}
                      </label>
                    ))}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {caller.registrantType === 'GUARDIAN' && (
                      <>
                        <div>
                          <Label htmlFor="recipientName" required>{t('requests.new.recipientName')}</Label>
                          <Input id="recipientName" value={caller.recipientName} onChange={(e) => set('recipientName', e.target.value)} />
                        </div>
                        <div>
                          <Label htmlFor="recipientRelationship" required>{t('requests.new.relationship')}</Label>
                          <Select id="recipientRelationship" value={caller.recipientRelationship} onChange={(e) => set('recipientRelationship', e.target.value)}>
                            <option value="">—</option>
                            {RELATIONSHIPS.map((v) => (
                              <option key={v} value={v}>
                                {opt('relationship', v)}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </>
                    )}
                    <div>
                      <Label htmlFor="recipientAge" required>{t('requests.new.age')}</Label>
                      <Input id="recipientAge" type="number" min={0} max={120} value={caller.recipientAge} onChange={(e) => set('recipientAge', e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="recipientGender" required>{t('requests.new.gender')}</Label>
                      <Select id="recipientGender" value={caller.recipientGender} onChange={(e) => set('recipientGender', e.target.value)}>
                        <option value="">—</option>
                        {GENDERS.map((v) => (
                          <option key={v} value={v}>
                            {opt('gender', v)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </fieldset>

                <fieldset className="border-t border-border pt-4">
                  <legend className="mb-2 text-sm font-semibold text-ink">{t('requests.new.careTitle')}</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="districtId" required>{t('personalInfo.fields.district')}</Label>
                      <Select
                        id="districtId"
                        value={caller.districtId}
                        onChange={(e) => setCaller((c) => ({ ...c, districtId: e.target.value, cityId: '' }))}
                      >
                        <option value="">—</option>
                        {districts.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="cityId" required>{t('requests.new.city')}</Label>
                      <Select id="cityId" value={caller.cityId} disabled={!caller.districtId} onChange={(e) => set('cityId', e.target.value)}>
                        <option value="">—</option>
                        {[...cities]
                          .sort((a, b) => a.name.localeCompare(b.name, locale))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="careAddress">{t('requests.detail.careAddress')}</Label>
                      <Input id="careAddress" value={caller.careAddress} onChange={(e) => set('careAddress', e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="careNeeds" required>{t('requests.detail.careNeeds')}</Label>
                      <Textarea id="careNeeds" rows={3} maxLength={1000} value={caller.careNeeds} onChange={(e) => set('careNeeds', e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="careSchedule" required>{t('requests.detail.schedule')}</Label>
                      <Select id="careSchedule" value={caller.careSchedule} onChange={(e) => set('careSchedule', e.target.value)}>
                        <option value="">—</option>
                        {SCHEDULES.map((v) => (
                          <option key={v} value={v}>
                            {opt('careSchedule', v)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="careStart" required>{t('requests.new.start')}</Label>
                      <Select id="careStart" value={caller.careStart} onChange={(e) => set('careStart', e.target.value)}>
                        <option value="">—</option>
                        {STARTS.map((v) => (
                          <option key={v} value={v}>
                            {opt('careStart', v)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="preferredCaregiverGender">{t('requests.detail.genderPreference')}</Label>
                      <Select id="preferredCaregiverGender" value={caller.preferredCaregiverGender} onChange={(e) => set('preferredCaregiverGender', e.target.value)}>
                        {CAREGIVER_GENDERS.map((v) => (
                          <option key={v} value={v}>
                            {opt('caregiverGender', v)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </fieldset>

                <label className="flex items-start gap-3 rounded border border-border bg-paper p-3 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={caller.consentConfirmed} onChange={(e) => set('consentConfirmed', e.target.checked)} />
                  <span>
                    <span className="font-medium text-ink">{t('requests.new.consent')}</span>
                    <span className="block text-xs text-ink/60">{t('requests.new.consentHint')}</span>
                  </span>
                </label>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Caregiver ----------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>{t('requests.new.caregiverTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {caregiver ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-paper px-3 py-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{caregiver.fullName}</span>
                    <StatusBadge status={caregiver.status} label={t(`caregivers.status.${caregiver.status}`)} />
                  </div>
                  <div className="text-xs tabular-nums text-ink/50">{caregiver.registrationNumber}</div>
                  {caregiver.status !== 'ACTIVE' && <p className="mt-1 text-xs text-accent">{t('requests.new.notListedWarning')}</p>}
                </div>
                <Button size="sm" variant="secondary" onClick={() => setCaregiver(null)}>
                  {t('requests.new.matchLater')}
                </Button>
              </div>
            ) : (
              <>
                <p className="mb-2 text-sm text-ink/60">{t('requests.new.caregiverHint')}</p>
                <CaregiverPicker onPick={setCaregiver} />
              </>
            )}
          </CardContent>
        </Card>

        {/* 3. The request ---------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>{t('requests.new.requestTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="careType">{t('requests.detail.careType')}</Label>
              <Select id="careType" value={careType} onChange={(e) => setCareType(e.target.value as CareType | '')}>
                <option value="">{t('requests.new.careTypeNotSaid')}</option>
                {careTypeValues.map((type) => (
                  <option key={type} value={type}>
                    {t(`careTypes.${type}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="message">{t('requests.detail.phoneMessage')}</Label>
              <Textarea
                id="message"
                rows={3}
                maxLength={1000}
                placeholder={t('requests.new.messagePlaceholder')}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="language" required>{t('requests.new.language')}</Label>
              <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value as (typeof LANGUAGES)[number])}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`requests.detail.language.${l}`)}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-ink/50">{t('requests.new.languageHint')}</p>
            </div>
          </CardContent>
        </Card>

        {create.isError && (
          <p role="alert" className="text-sm text-danger">
            {create.error instanceof ApiError ? create.error.message : t('requests.detail.saveFailed')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={!ready || create.isPending}>
            {create.isPending ? t('common.loading') : t('requests.new.submit')}
          </Button>
          {!ready && (
            <span className="text-sm text-ink/50">
              {missing.includes('client') ? t('requests.new.needClient') : t('requests.new.needFields', { count: missing.length })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
