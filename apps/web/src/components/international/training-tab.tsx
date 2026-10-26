'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus, Users } from 'lucide-react';
import {
  trainingCategoryValues,
  trainingEnrolmentStatusValues,
  trainingFormatValues,
  type TrainingEnrolmentStatus,
  type TrainingProgramme,
  type TrainingProgrammeInput,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useSaveTrainingProgramme, useTrainingEnrolments, useTrainingProgrammes, useUpdateEnrolment } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const EMPTY: TrainingProgrammeInput = {
  category: 'ENGLISH',
  format: 'IN_PERSON',
  titleEn: '',
  titleSi: null,
  titleTa: null,
  descriptionEn: '',
  descriptionSi: null,
  descriptionTa: null,
  duration: null,
  feeLkr: null,
  nextStartDate: null,
  isActive: true,
  sortOrder: 0,
};

/**
 * The platform's own training programmes (English and basic caregiving to
 * start with) and who has signed up for each. Marking someone Completed puts
 * the programme on their shared profile - so it is staff, not the caregiver,
 * who records it.
 */
export function TrainingTab() {
  const { t } = useTranslation();
  const { data: programmes = [], isLoading } = useTrainingProgrammes();
  const [editing, setEditing] = useState<{ id?: string; values: TrainingProgrammeInput } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/60">{t('international.training.hint')}</p>
        <Button size="sm" onClick={() => setEditing({ values: EMPTY })}>
          <Plus size={14} aria-hidden />
          {t('international.training.add')}
        </Button>
      </div>

      {editing && <ProgrammeForm initial={editing} onDone={() => setEditing(null)} />}

      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && programmes.length === 0 && !editing && (
        <p className="rounded-lg border border-dashed border-border bg-white py-10 text-center text-sm text-ink/50">{t('international.training.empty')}</p>
      )}

      <div className="grid gap-3">
        {programmes.map((p) => (
          <div key={p.id} className={cn('rounded-lg border bg-white p-4', selected === p.id ? 'border-brand' : 'border-border', !p.isActive && 'opacity-70')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">{p.titleEn}</h3>
                  <span className="rounded bg-accent-light px-2 py-0.5 text-xs text-accent">{t(`international.training.categories.${p.category}`)}</span>
                  {!p.isActive && <span className="rounded bg-ink/10 px-2 py-0.5 text-xs text-ink/60">{t('international.training.inactive')}</span>}
                </div>
                <p className="mt-1 text-xs text-ink/60">
                  {t(`international.training.formats.${p.format}`)}
                  {p.duration && ` · ${p.duration}`}
                  {` · ${p.feeLkr ? `LKR ${p.feeLkr.toLocaleString()}` : t('international.training.free')}`}
                  {p.nextStartDate && ` · ${t('international.training.starts', { date: p.nextStartDate })}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setSelected(selected === p.id ? null : p.id)}>
                  <Users size={14} aria-hidden />
                  {t('international.training.signUps', { count: p.enrolmentCount })}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ id: p.id, values: toInput(p) })} aria-label={t('international.training.edit')}>
                  <Pencil size={14} aria-hidden />
                </Button>
              </div>
            </div>
            {selected === p.id && <Enrolments programmeId={p.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function toInput(p: TrainingProgramme): TrainingProgrammeInput {
  const { id: _id, enrolmentCount: _count, ...rest } = p;
  return rest;
}

function ProgrammeForm({ initial, onDone }: { initial: { id?: string; values: TrainingProgrammeInput }; onDone: () => void }) {
  const { t } = useTranslation();
  const save = useSaveTrainingProgramme();
  const [v, setV] = useState<TrainingProgrammeInput>(initial.values);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<TrainingProgrammeInput>) => setV((x) => ({ ...x, ...patch }));
  const text = (value: string) => (value.trim() ? value : null);

  return (
    <form
      className="space-y-4 rounded-lg border border-brand/40 bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!v.titleEn.trim() || !v.descriptionEn.trim()) return setError(t('international.training.englishRequired'));
        save.mutate({ id: initial.id, body: v }, { onSuccess: onDone, onError: (err) => setError(err instanceof Error ? err.message : String(err)) });
      }}
    >
      <h3 className="font-semibold text-ink">{initial.id ? t('international.training.editTitle') : t('international.training.addTitle')}</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="tp-cat">{t('international.training.category')}</Label>
          <Select id="tp-cat" value={v.category} onChange={(e) => set({ category: e.target.value as TrainingProgrammeInput['category'] })}>
            {trainingCategoryValues.map((c) => (
              <option key={c} value={c}>
                {t(`international.training.categories.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="tp-format">{t('international.training.format')}</Label>
          <Select id="tp-format" value={v.format} onChange={(e) => set({ format: e.target.value as TrainingProgrammeInput['format'] })}>
            {trainingFormatValues.map((f) => (
              <option key={f} value={f}>
                {t(`international.training.formats.${f}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="tp-duration">{t('international.training.duration')}</Label>
          <Input id="tp-duration" value={v.duration ?? ''} onChange={(e) => set({ duration: text(e.target.value) })} placeholder="8 weeks" maxLength={100} />
        </div>
        <div>
          <Label htmlFor="tp-fee">{t('international.training.fee')}</Label>
          <Input id="tp-fee" type="number" min={0} value={v.feeLkr ?? ''} onChange={(e) => set({ feeLkr: e.target.value === '' ? null : Number(e.target.value) })} />
        </div>
        <div>
          <Label htmlFor="tp-start">{t('international.training.nextStart')}</Label>
          <Input id="tp-start" type="date" value={v.nextStartDate ?? ''} onChange={(e) => set({ nextStartDate: e.target.value || null })} />
        </div>
        <div>
          <Label htmlFor="tp-order">{t('international.training.sortOrder')}</Label>
          <Input id="tp-order" type="number" min={0} value={v.sortOrder} onChange={(e) => set({ sortOrder: Number(e.target.value) || 0 })} />
        </div>
      </div>

      {(['En', 'Si', 'Ta'] as const).map((lang) => (
        <div key={lang} className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <div>
            <Label htmlFor={`tp-title-${lang}`}>{t(`international.training.title${lang}`)}</Label>
            <Input
              id={`tp-title-${lang}`}
              value={(v[`title${lang}`] as string | null) ?? ''}
              onChange={(e) => set({ [`title${lang}`]: lang === 'En' ? e.target.value : text(e.target.value) } as Partial<TrainingProgrammeInput>)}
              maxLength={200}
            />
          </div>
          <div>
            <Label htmlFor={`tp-desc-${lang}`}>{t(`international.training.description${lang}`)}</Label>
            <Textarea
              id={`tp-desc-${lang}`}
              rows={2}
              value={(v[`description${lang}`] as string | null) ?? ''}
              onChange={(e) => set({ [`description${lang}`]: lang === 'En' ? e.target.value : text(e.target.value) } as Partial<TrainingProgrammeInput>)}
              maxLength={4000}
            />
          </div>
        </div>
      ))}
      <p className="text-xs text-ink/50">{t('international.training.translationHint')}</p>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={v.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
        {t('international.training.active')}
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function Enrolments({ programmeId }: { programmeId: string }) {
  const { t } = useTranslation();
  const { data = [], isLoading } = useTrainingEnrolments(programmeId);
  const update = useUpdateEnrolment(programmeId);

  if (isLoading) return <p className="mt-3 text-sm text-ink/50">{t('common.loading')}</p>;
  if (!data.length) return <p className="mt-3 text-sm text-ink/50">{t('international.training.noSignUps')}</p>;

  return (
    <div className="mt-4 overflow-x-auto border-t border-border pt-3">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink/50">
          <tr>
            <th className="py-2 pr-4 font-medium">{t('international.training.caregiver')}</th>
            <th className="py-2 pr-4 font-medium">{t('international.training.signedUp')}</th>
            <th className="py-2 pr-4 font-medium">{t('international.training.statusLabel')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((e) => (
            <tr key={e.id} className="border-t border-border">
              <td className="py-2 pr-4">
                <Link href={`/caregivers/${e.caregiverId}`} className="font-medium text-brand-dark hover:underline">
                  {e.fullName}
                </Link>
                <div className="text-xs tabular-nums text-ink/50">{e.registrationNumber}</div>
              </td>
              <td className="py-2 pr-4 text-ink/70">{new Date(e.createdAt).toLocaleDateString()}</td>
              <td className="py-2 pr-4">
                <Select
                  className="w-44"
                  value={e.status}
                  disabled={update.isPending}
                  aria-label={t('international.training.statusLabel')}
                  onChange={(ev) => update.mutate({ id: e.id, status: ev.target.value as TrainingEnrolmentStatus })}
                >
                  {trainingEnrolmentStatusValues.map((s) => (
                    <option key={s} value={s}>
                      {t(`international.training.enrolment.${s}`)}
                    </option>
                  ))}
                </Select>
                {e.completedAt && <div className="mt-0.5 text-xs text-ink/50">{t('international.training.completedOn', { date: e.completedAt })}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
