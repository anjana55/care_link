'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Experience } from '@/lib/api/types';
import { useExperiences, useRemoveExperience, useSaveExperience } from '@/lib/hooks/use-caregivers';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input, Label, RequiredLegend, Select, Textarea } from '@/components/ui/input';
import { VerificationBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const STATUSES = ['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'] as const;
const statusKey = (s: string) => `caregivers.edit.${s === 'PENDING' ? 'pending' : s === 'IN_PROGRESS' ? 'inProgress' : s.toLowerCase()}`;

type FormValues = {
  employerOrClient: string;
  role: string;
  country: string;
  location: string;
  startDate: string;
  endDate: string;
  careType: string;
  patientCategory: string;
  referenceContact: string;
  description: string;
  verificationStatus: Experience['verificationStatus'];
};

const EMPTY: FormValues = {
  employerOrClient: '',
  role: '',
  country: 'Sri Lanka',
  location: '',
  startDate: '',
  endDate: '',
  careType: '',
  patientCategory: '',
  referenceContact: '',
  description: '',
  verificationStatus: 'PENDING',
};

const day = (d: string | null) => (d ? d.slice(0, 10) : '');

const fromExperience = (e: Experience): FormValues => ({
  employerOrClient: e.employerOrClient,
  role: e.role,
  country: e.country,
  location: e.location ?? '',
  startDate: day(e.startDate),
  endDate: day(e.endDate),
  careType: e.careType ?? '',
  patientCategory: e.patientCategory ?? '',
  referenceContact: e.referenceContact ?? '',
  description: e.description ?? '',
  verificationStatus: e.verificationStatus,
});

/** Whole months between two dates (the end defaults to today, for current roles). */
function months(start: string, end: string | null) {
  const a = new Date(day(start));
  const b = end ? new Date(day(end)) : new Date();
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() >= a.getDate() ? 0 : -1);
}

/**
 * The caregiver's work history on their staff profile. Every office role can
 * read it; only admins add, correct, verify or remove entries. Entries the
 * caregiver adds themselves show here too, marked Pending until checked.
 */
export function ExperienceCard({ caregiverId, canEdit }: { caregiverId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const { data: experiences, isLoading, isError } = useExperiences(caregiverId);
  const save = useSaveExperience(caregiverId);
  const remove = useRemoveExperience(caregiverId);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY);
  const [deleting, setDeleting] = useState<Experience | null>(null);

  const sorted = [...(experiences ?? [])].sort((a, b) => day(b.startDate).localeCompare(day(a.startDate)));
  const totalMonths = sorted.reduce((sum, e) => sum + months(e.startDate, e.endDate), 0);
  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => setForm((f) => ({ ...f, [k]: v }));

  const open = (e?: Experience) => {
    save.reset();
    setForm(e ? fromExperience(e) : EMPTY);
    setEditing(e ? e.id : 'new');
  };

  const submit = () => {
    const original = editing && editing !== 'new' ? sorted.find((e) => e.id === editing) : undefined;
    const data: Record<string, unknown> = {
      employerOrClient: form.employerOrClient.trim(),
      role: form.role.trim(),
      country: form.country.trim(),
      startDate: form.startDate,
    };
    // Optional fields: omitted when empty on a new entry, cleared (null) on an edit.
    for (const k of ['location', 'endDate', 'careType', 'patientCategory', 'referenceContact', 'description'] as const) {
      const v = form[k].trim();
      if (v) data[k] = v;
      else if (original) data[k] = null;
    }
    if (original) {
      if (form.verificationStatus !== original.verificationStatus) data.verificationStatus = form.verificationStatus;
    }
    save.mutate({ id: original?.id, data }, { onSuccess: () => setEditing(null) });
  };

  const datesInvalid = Boolean(form.startDate && form.endDate && form.endDate < form.startDate);
  const formReady = form.employerOrClient.trim() && form.role.trim() && form.country.trim() && form.startDate && !datesInvalid;
  const errorText = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : t('common.actionFailed'));

  const formView = (
    <form
      className="space-y-4 rounded border border-brand/40 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (formReady) submit();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{editing === 'new' ? t('caregivers.experience.addTitle') : t('caregivers.experience.editTitle')}</h3>
        <RequiredLegend label={t('common.requiredField')} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="exp-employer" required>{t('caregivers.me.experience.employerOrClient')}</Label>
          <Input id="exp-employer" value={form.employerOrClient} onChange={(e) => set('employerOrClient', e.target.value)} maxLength={255} required />
        </div>
        <div>
          <Label htmlFor="exp-role" required>{t('caregivers.me.experience.role')}</Label>
          <Input id="exp-role" value={form.role} onChange={(e) => set('role', e.target.value)} maxLength={255} required />
        </div>
        <div>
          <Label htmlFor="exp-country" required>{t('caregivers.me.experience.country')}</Label>
          <Input id="exp-country" value={form.country} onChange={(e) => set('country', e.target.value)} maxLength={100} required />
        </div>
        <div>
          <Label htmlFor="exp-location">{t('caregivers.me.experience.location')}</Label>
          <Input id="exp-location" value={form.location} onChange={(e) => set('location', e.target.value)} maxLength={255} />
        </div>
        <div>
          <Label htmlFor="exp-start" required>{t('caregivers.me.experience.startDate')}</Label>
          <Input id="exp-start" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="exp-end">{t('caregivers.me.experience.endDate')}</Label>
          <Input id="exp-end" type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => set('endDate', e.target.value)} />
          <p className={`mt-1 text-xs ${datesInvalid ? 'text-danger' : 'text-ink/50'}`}>{datesInvalid ? t('caregivers.experience.endBeforeStart') : t('caregivers.experience.endHint')}</p>
        </div>
        <div>
          <Label htmlFor="exp-care">{t('caregivers.me.experience.careType')}</Label>
          <Input id="exp-care" value={form.careType} onChange={(e) => set('careType', e.target.value)} maxLength={100} />
        </div>
        <div>
          <Label htmlFor="exp-patients">{t('caregivers.experience.patientCategory')}</Label>
          <Input id="exp-patients" value={form.patientCategory} onChange={(e) => set('patientCategory', e.target.value)} maxLength={100} />
        </div>
        <div>
          <Label htmlFor="exp-ref">{t('caregivers.experience.referenceContact')}</Label>
          <Input id="exp-ref" value={form.referenceContact} onChange={(e) => set('referenceContact', e.target.value)} maxLength={255} />
        </div>
        {editing !== 'new' && (
          <div>
            <Label htmlFor="exp-status">{t('caregivers.experience.verification')}</Label>
            <Select id="exp-status" value={form.verificationStatus} onChange={(e) => set('verificationStatus', e.target.value as FormValues['verificationStatus'])}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(statusKey(s))}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor="exp-desc">{t('caregivers.me.experience.description')}</Label>
          <Textarea id="exp-desc" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
        </div>
      </div>
      {save.isError && <p className="text-sm text-danger">{errorText(save.error)}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={!formReady || save.isPending}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">{t('caregivers.experience.title')}</h2>
            {sorted.length > 0 && (
              <p className="text-sm text-ink/60">
                {t('caregivers.experience.summary', { n: sorted.length, years: Math.floor(totalMonths / 12), months: totalMonths % 12 })}
              </p>
            )}
          </div>
          {canEdit && editing === null && (
            <Button size="sm" variant="secondary" onClick={() => open()}>
              <Plus size={14} aria-hidden className="mr-1.5" />
              {t('caregivers.experience.add')}
            </Button>
          )}
        </div>
        {!canEdit && <p className="text-xs text-ink/50">{t('caregivers.experience.adminOnly')}</p>}

        {editing === 'new' && formView}

        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {isError && <p className="text-sm text-danger">{t('common.actionFailed')}</p>}
        {!isLoading && !isError && sorted.length === 0 && editing !== 'new' && <p className="text-sm text-ink/40">{t('caregivers.me.experience.noExperienceYet')}</p>}

        <ul className="space-y-3">
          {sorted.map((e) =>
            editing === e.id ? (
              <li key={e.id}>{formView}</li>
            ) : (
              <li key={e.id} className="rounded border border-border px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">
                      {e.role} · {e.employerOrClient}
                    </div>
                    <div className="mt-0.5 text-xs text-ink/60">
                      {[e.location, e.country].filter(Boolean).join(', ')} · {day(e.startDate)} — {e.endDate ? day(e.endDate) : t('caregivers.me.experience.present')}
                      {' · '}
                      {t('caregivers.experience.duration', { years: Math.floor(months(e.startDate, e.endDate) / 12), months: months(e.startDate, e.endDate) % 12 })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <VerificationBadge status={e.verificationStatus} label={t(statusKey(e.verificationStatus))} />
                    {canEdit && editing === null && (
                      <>
                        <IconButton icon={<Pencil size={15} />} aria-label={t('caregivers.experience.edit')} title={t('caregivers.experience.edit')} onClick={() => open(e)} />
                        <IconButton
                          icon={<Trash2 size={15} />}
                          aria-label={t('caregivers.experience.delete')}
                          title={t('caregivers.experience.delete')}
                          className="text-ink/50 hover:text-danger"
                          onClick={() => {
                            remove.reset();
                            setDeleting(e);
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
                {(e.careType || e.patientCategory || e.referenceContact) && (
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                    {e.careType && (
                      <div>
                        <dt className="text-ink/50">{t('caregivers.me.experience.careType')}</dt>
                        <dd className="text-ink">{e.careType}</dd>
                      </div>
                    )}
                    {e.patientCategory && (
                      <div>
                        <dt className="text-ink/50">{t('caregivers.experience.patientCategory')}</dt>
                        <dd className="text-ink">{e.patientCategory}</dd>
                      </div>
                    )}
                    {e.referenceContact && (
                      <div>
                        <dt className="text-ink/50">{t('caregivers.experience.referenceContact')}</dt>
                        <dd className="text-ink">{e.referenceContact}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {e.description && <p className="mt-2 whitespace-pre-line text-sm text-ink/80">{e.description}</p>}
              </li>
            ),
          )}
        </ul>

        {deleting && (
          <ConfirmDialog
            title={t('caregivers.experience.deleteTitle')}
            message={t('caregivers.experience.deleteMessage', { role: deleting.role, employer: deleting.employerOrClient })}
            confirmLabel={t('caregivers.experience.delete')}
            tone="danger"
            pending={remove.isPending}
            error={remove.isError ? errorText(remove.error) : null}
            onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
            onCancel={() => setDeleting(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}
