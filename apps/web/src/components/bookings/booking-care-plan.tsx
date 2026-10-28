'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BookmarkPlus, ClipboardList, Pencil } from 'lucide-react';
import { pickText, type CarePlanActivityView, type Locale } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useBookingCarePlan, useCarePlanTemplates, useCreateCarePlan, useSaveCarePlanAsTemplate, useUpdateCarePlan } from '@/lib/hooks/use-care-plans';
import { fmtDate } from '@/lib/colombo-time';
import { ActivityEditor, draftProblems, fromDraft, toDraft, whenText, type DraftActivity } from '@/components/care-plans/activity-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.message ? err.message : fallback);

/**
 * The booking's care plan: what the caregiver does on each shift, which the
 * client ticks off. Started from a template, from the client's earlier plan,
 * or blank; changed from a date, so days before it keep what was due then.
 */
export function BookingCarePlan({ bookingId, editable }: { bookingId: string; editable: boolean }) {
  const { t, locale } = useTranslation();
  const { data, isLoading } = useBookingCarePlan(bookingId);
  const [editing, setEditing] = useState(false);

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('carePlans.plan.title')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-ink/50">{t('common.loading')}</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList size={16} aria-hidden />
          {t('carePlans.plan.title')}
        </CardTitle>
        {data.plan && !editing && (
          <div className="flex flex-wrap gap-2">
            <SaveAsTemplate bookingId={bookingId} />
            {editable && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil size={14} aria-hidden />
                {t('carePlans.plan.edit')}
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {!data.plan ? (
          editable ? (
            <StartPlan bookingId={bookingId} careType={data.careType} copyable={data.copyableBookings} />
          ) : (
            <p className="text-sm text-ink/50">{t('carePlans.plan.none')}</p>
          )
        ) : editing ? (
          <EditPlan bookingId={bookingId} response={data} onDone={() => setEditing(false)} />
        ) : (
          <div className="space-y-3">
            {data.plan.sourceTemplate && (
              <p className="text-xs text-ink/50">
                {t('carePlans.plan.fromTemplate')}{' '}
                <Link href={`/care-plans/${data.plan.sourceTemplate.id}`} className="text-brand-dark hover:underline">
                  {data.plan.sourceTemplate.name}
                </Link>
              </p>
            )}
            {data.inForceOn > data.today && (
              <p className="rounded border border-accent/30 bg-accent-light px-3 py-2 text-sm text-accent">{t('carePlans.plan.pendingFrom', { date: fmtDate(data.inForceOn, locale) })}</p>
            )}
            {data.plan.notes && <p className="whitespace-pre-wrap rounded bg-paper px-3 py-2 text-sm text-ink">{data.plan.notes}</p>}
            <ActivityList activities={data.plan.activities} locale={locale} />
            {data.plan.history.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-ink/60">{t('carePlans.plan.history', { count: data.plan.history.length })}</summary>
                <ul className="mt-2 space-y-1 text-xs text-ink/60">
                  {data.plan.history.map((a) => (
                    <li key={a.id}>
                      {pickText(a.title, locale)} — {t('carePlans.plan.ranUntil', { from: fmtDate(a.effectiveFrom, locale), to: fmtDate(a.effectiveTo!, locale) })}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityList({ activities, locale }: { activities: CarePlanActivityView[]; locale: Locale }) {
  const { t } = useTranslation();
  if (!activities.length) return <p className="text-sm text-ink/50">{t('carePlans.plan.noActivities')}</p>;
  return (
    <ol className="divide-y divide-border">
      {activities.map((a) => (
        <li key={a.id} className="py-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-ink">{pickText(a.title, locale)}</span>
            {a.isCritical && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-light px-1.5 py-0.5 text-xs text-accent">
                <AlertTriangle size={11} aria-hidden />
                {t('carePlans.critical')}
              </span>
            )}
            <span className="text-xs text-ink/50">{t(`carePlans.category.${a.category}`)}</span>
          </div>
          <p className="text-xs text-ink/60">{whenText(a, t, locale)}</p>
          {pickText(a.instructions, locale) && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink/70">{pickText(a.instructions, locale)}</p>}
        </li>
      ))}
    </ol>
  );
}

function StartPlan({ bookingId, careType, copyable }: { bookingId: string; careType: string | null; copyable: { id: string; reference: string; startDate: string }[] }) {
  const { t, locale } = useTranslation();
  const { data: templates } = useCarePlanTemplates('ACTIVE');
  const create = useCreateCarePlan(bookingId);
  // Templates for this booking's kind of care first, then the rest.
  const sorted = useMemo(
    () => [...(templates ?? [])].sort((a, b) => Number(b.careTypes.includes(careType as never)) - Number(a.careTypes.includes(careType as never)) || a.name.localeCompare(b.name)),
    [templates, careType],
  );
  const [source, setSource] = useState('');

  const start = () => {
    const [kind, id] = source.split(':');
    create.mutate(kind === 'template' ? { templateId: id } : kind === 'booking' ? { fromBookingId: id } : {});
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink/60">{t('carePlans.plan.startHint')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <Label htmlFor="planSource">{t('carePlans.plan.startFrom')}</Label>
          <Select id="planSource" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t('carePlans.plan.blank')}</option>
            {sorted.length > 0 && (
              <optgroup label={t('carePlans.plan.templates')}>
                {sorted.map((tpl) => (
                  <option key={tpl.id} value={`template:${tpl.id}`}>
                    {tpl.name} ({t('carePlans.templates.activityCount', { count: tpl.activityCount })})
                  </option>
                ))}
              </optgroup>
            )}
            {copyable.length > 0 && (
              <optgroup label={t('carePlans.plan.copyFrom')}>
                {copyable.map((b) => (
                  <option key={b.id} value={`booking:${b.id}`}>
                    {b.reference} · {fmtDate(b.startDate, locale)}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
        <Button disabled={create.isPending} onClick={start}>
          {t('carePlans.plan.create')}
        </Button>
      </div>
      {templates && templates.length === 0 && (
        <p className="text-xs text-ink/50">
          {t('carePlans.plan.noTemplates')}{' '}
          <Link href="/care-plans/new" className="text-brand-dark hover:underline">
            {t('carePlans.templates.new')}
          </Link>
        </p>
      )}
      {create.isError && (
        <p role="alert" className="text-danger">
          {errorText(create.error, t('requests.detail.saveFailed'))}
        </p>
      )}
    </div>
  );
}

function EditPlan({
  bookingId,
  response,
  onDone,
}: {
  bookingId: string;
  response: NonNullable<ReturnType<typeof useBookingCarePlan>['data']>;
  onDone: () => void;
}) {
  const { t, locale } = useTranslation();
  const update = useUpdateCarePlan(bookingId);
  const [from, setFrom] = useState(response.suggestedEffectiveFrom);
  const [notes, setNotes] = useState(response.plan?.notes ?? '');
  const [activities, setActivities] = useState<DraftActivity[]>(() => (response.plan?.activities ?? []).map((a) => toDraft(a)));
  const [textLocale, setTextLocale] = useState<Locale>(locale);
  const [touched, setTouched] = useState(false);
  const problems = draftProblems(activities);

  const save = () => {
    setTouched(true);
    if (Object.keys(problems).length || !from || from < response.minEffectiveFrom) return;
    update.mutate({ effectiveFrom: from, notes: notes.trim() || null, activities: activities.map(fromDraft) }, { onSuccess: onDone });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <div>
          <Label htmlFor="effFrom" required>
            {t('carePlans.plan.effectiveFrom')}
          </Label>
          <Input id="effFrom" type="date" min={response.minEffectiveFrom} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <p className="self-end text-xs text-ink/60">{t('carePlans.plan.effectiveHint', { min: fmtDate(response.minEffectiveFrom, locale) })}</p>
      </div>
      <div>
        <Label htmlFor="planNotes">{t('carePlans.plan.notes')}</Label>
        <Textarea id="planNotes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('carePlans.plan.notesPlaceholder')} />
        <p className="mt-1 text-xs text-ink/50">{t('carePlans.plan.notesHint')}</p>
      </div>
      <ActivityEditor value={activities} onChange={setActivities} textLocale={textLocale} onTextLocaleChange={setTextLocale} problems={touched ? problems : {}} />
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button disabled={update.isPending} onClick={save}>
          {update.isPending ? t('common.loading') : t('carePlans.plan.saveFrom', { date: from ? fmtDate(from, locale) : '…' })}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        {update.isError && (
          <span role="alert" className="text-sm text-danger">
            {errorText(update.error, t('requests.detail.saveFailed'))}
          </span>
        )}
      </div>
    </div>
  );
}

function SaveAsTemplate({ bookingId }: { bookingId: string }) {
  const { t } = useTranslation();
  const save = useSaveCarePlanAsTemplate(bookingId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);

  if (done) {
    return (
      <Link href={`/care-plans/${done.id}`} className="self-center text-xs text-brand-dark hover:underline">
        {t('carePlans.plan.savedAsTemplate', { name: done.name })}
      </Link>
    );
  }
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <BookmarkPlus size={14} aria-hidden />
        {t('carePlans.plan.saveAsTemplate')}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input className="h-8 w-56" aria-label={t('carePlans.templates.name')} placeholder={t('carePlans.templates.name')} value={name} onChange={(e) => setName(e.target.value)} />
      <Button size="sm" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate(name.trim(), { onSuccess: (tpl) => setDone({ id: tpl.id, name: tpl.name }) })}>
        {t('common.save')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t('common.cancel')}
      </Button>
      {save.isError && <span className="text-xs text-danger">{errorText(save.error, t('requests.detail.saveFailed'))}</span>}
    </div>
  );
}
