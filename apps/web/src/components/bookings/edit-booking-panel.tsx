'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, BellRing } from 'lucide-react';
import { colomboToday, colomboToUtc, generateShifts, MAX_GENERATED_SHIFTS, planRoster, SCHEDULE_PRESETS, type IsoWeekday } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useUpdateBooking } from '@/lib/hooks/use-bookings';
import { fmtDate, fmtWeekday } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { CaregiverPicker, type PickedCaregiver } from '@/components/requests/caregiver-picker';
import { cn } from '@/lib/utils';
import type { BookingDetail, ScheduleType, UpdateBookingInput } from '@/lib/api/types';

const TYPES: ScheduleType[] = ['DAY', 'NIGHT', 'LIVE_IN', 'CUSTOM'];
const WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const sameDays = (a: number[], b: number[]) => a.length === b.length && [...a].sort().every((d, i) => d === [...b].sort()[i]);

/**
 * Edit a booking's pattern, booked caregiver, notes and notice language.
 *
 * DRAFT: the roster is rebuilt from the new pattern. CONFIRMED: the change
 * applies from a chosen day, and the client and affected caregivers are told.
 * Either way, shifts that still fit keep their edits, covers and own rates -
 * the preview uses the same roster rule (planRoster) as the API, so what it
 * says is what saving does.
 */
export function EditBookingPanel({ booking, onClose }: { booking: BookingDetail; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const update = useUpdateBooking(booking.id);
  const draft = booking.status === 'DRAFT';
  const today = colomboToday();

  const [effectiveFrom, setEffectiveFrom] = useState(booking.startDate > today ? booking.startDate : today);
  const [caregiver, setCaregiver] = useState<PickedCaregiver | null>(null);
  const [picking, setPicking] = useState(false);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(booking.scheduleType);
  const [days, setDays] = useState<IsoWeekday[]>(booking.daysOfWeek as IsoWeekday[]);
  const [start, setStart] = useState(booking.shiftStartTime);
  const [end, setEnd] = useState(booking.shiftEndTime);
  const [startDate, setStartDate] = useState(booking.startDate);
  const [endDate, setEndDate] = useState(booking.endDate);
  const [language, setLanguage] = useState(booking.language);
  const [notes, setNotes] = useState(booking.notes ?? '');

  function pickType(type: ScheduleType) {
    setScheduleType(type);
    if (type !== 'CUSTOM') {
      setDays(SCHEDULE_PRESETS[type].days);
      setStart(SCHEDULE_PRESETS[type].start);
      setEnd(SCHEDULE_PRESETS[type].end);
    }
  }
  const toggleDay = (d: IsoWeekday) => {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
    setScheduleType('CUSTOM');
  };

  const patternChanged =
    scheduleType !== booking.scheduleType ||
    !sameDays(days, booking.daysOfWeek) ||
    start !== booking.shiftStartTime ||
    end !== booking.shiftEndTime ||
    (draft && startDate !== booking.startDate) ||
    endDate !== booking.endDate;
  const caregiverChanged = Boolean(caregiver && caregiver.id !== booking.caregiver?.id);
  const reshaping = patternChanged || caregiverChanged;
  const notesChanged = notes.trim() !== (booking.notes ?? '');
  const languageChanged = language !== booking.language;
  const changed = reshaping || notesChanged || languageChanged;

  // What saving would do to the roster - the API's own rule, run here.
  const preview = useMemo(() => {
    if (!reshaping) return null;
    const now = new Date();
    const fromInstant = draft ? null : new Date(Math.max(colomboToUtc(effectiveFrom, '00:00').getTime(), now.getTime()));
    const existing = booking.shifts
      .filter((s) => (draft ? s.status === 'DRAFT' : s.status === 'SCHEDULED' && new Date(s.startsAt) >= fromInstant!))
      .map((s) => ({ id: s.id, caregiverId: s.caregiver?.id ?? '', startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt), ref: s }));
    const generated = patternChanged
      ? generateShifts({ startDate: draft ? startDate : effectiveFrom, endDate, daysOfWeek: days, shiftStartTime: start, shiftEndTime: end }).filter((g) => draft || g.startsAt > now)
      : null;
    const booked = booking.caregiver?.id ?? '';
    const plan = planRoster(existing, generated, booked, caregiver?.id ?? booked);
    const moved = plan.keep.filter((k) => k.caregiverId !== k.shift.caregiverId);
    // The API refuses to cancel billed shifts or move shifts already on a pay statement.
    const billed = new Set<string>();
    if (!draft) {
      for (const d of plan.drop) {
        if (d.ref.invoice) billed.add(d.ref.invoice.number ?? t('bookings.edit.draftInvoice'));
        if (d.ref.payout) billed.add(d.ref.payout.reference);
      }
      for (const m of moved) if (m.shift.ref.payout) billed.add(m.shift.ref.payout.reference);
    }
    return { plan, moved, generated, billed: [...billed] };
  }, [reshaping, draft, effectiveFrom, booking, patternChanged, startDate, endDate, days, start, end, caregiver, t]);

  const tooMany = (preview?.generated?.length ?? 0) > MAX_GENERATED_SHIFTS;
  const noShifts = patternChanged && preview?.generated?.length === 0;
  const rosterChanges = preview ? preview.plan.drop.length + preview.plan.add.length + preview.moved.length : 0;
  const effectiveInvalid = !draft && reshaping && (effectiveFrom < today || effectiveFrom < booking.startDate || effectiveFrom > endDate);
  const ready = changed && days.length > 0 && endDate >= (draft ? startDate : booking.startDate) && !tooMany && !noShifts && !effectiveInvalid && !(preview?.billed.length);

  const submit = () => {
    const v: UpdateBookingInput = {
      ...(patternChanged
        ? { pattern: { scheduleType, daysOfWeek: days, shiftStartTime: start, shiftEndTime: end, startDate: draft ? startDate : booking.startDate, endDate } }
        : {}),
      ...(caregiverChanged ? { caregiverId: caregiver!.id } : {}),
      ...(!draft && reshaping ? { effectiveFrom } : {}),
      ...(languageChanged ? { language } : {}),
      ...(notesChanged ? { notes: notes.trim() } : {}),
    };
    update.mutate(v, { onSuccess: onClose });
  };

  return (
    <Card className="mb-4 border-brand/40">
      <CardHeader>
        <CardTitle>{t('bookings.edit.title')}</CardTitle>
        <p className="mt-1 text-sm text-ink/60">{draft ? t('bookings.edit.subtitleDraft') : t('bookings.edit.subtitleConfirmed')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {!draft && (
          <div className="max-w-xs">
            <Label htmlFor="effectiveFrom" required>
              {t('bookings.edit.effectiveFrom')}
            </Label>
            <Input
              id="effectiveFrom"
              type="date"
              min={booking.startDate > today ? booking.startDate : today}
              max={endDate}
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              aria-invalid={effectiveInvalid}
            />
            <p className="mt-1 text-xs text-ink/50">{t('bookings.edit.effectiveHint')}</p>
          </div>
        )}

        <div>
          <Label>{t('bookings.edit.caregiver')}</Label>
          {picking ? (
            <CaregiverPicker
              autoFocus
              onPick={(c) => {
                setCaregiver(c.id === booking.caregiver?.id ? null : c);
                setPicking(false);
              }}
              onCancel={() => setPicking(false)}
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-paper px-3 py-2 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                {caregiverChanged && <span className="text-ink/40 line-through">{booking.caregiver?.fullName}</span>}
                <span className="font-medium text-ink">{(caregiver ?? booking.caregiver)?.fullName}</span>
                <span className="tabular-nums text-ink/50">{(caregiver ?? booking.caregiver)?.registrationNumber}</span>
                {caregiver && <StatusBadge status={caregiver.status} label={t(`caregivers.status.${caregiver.status}`)} />}
              </span>
              <span className="flex gap-2">
                {caregiverChanged && (
                  <Button size="sm" variant="secondary" onClick={() => setCaregiver(null)}>
                    {t('bookings.edit.keepCaregiver', { name: booking.caregiver?.fullName ?? '' })}
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
                  {t('bookings.edit.change')}
                </Button>
              </span>
            </div>
          )}
          <p className="mt-1 text-xs text-ink/50">{t('bookings.edit.caregiverHint')}</p>
        </div>

        <div className="space-y-3">
          <Label>{t('bookings.new.patternTitle')}</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('bookings.table.schedule')}>
            {TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={scheduleType === type}
                onClick={() => pickType(type)}
                className={cn('rounded border px-3 py-1.5 text-sm font-medium', scheduleType === type ? 'border-brand bg-brand text-white' : 'border-border text-ink/70 hover:bg-paper')}
              >
                {t(`bookings.scheduleType.${type}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label={t('bookings.new.days')}>
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days.includes(d)}
                onClick={() => toggleDay(d)}
                className={cn('w-14 rounded border py-1.5 text-sm', days.includes(d) ? 'border-brand bg-brand-light font-medium text-brand-dark' : 'border-border text-ink/60 hover:bg-paper')}
              >
                {fmtWeekday(d, locale)}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <Label htmlFor="editStart" required>
                {t('bookings.new.startTime')}
              </Label>
              <Input id="editStart" type="time" step={900} value={start} onChange={(e) => { setStart(e.target.value); setScheduleType('CUSTOM'); }} />
            </div>
            <div>
              <Label htmlFor="editEnd" required>
                {t('bookings.new.endTime')}
              </Label>
              <Input id="editEnd" type="time" step={900} value={end} onChange={(e) => { setEnd(e.target.value); setScheduleType('CUSTOM'); }} />
            </div>
            <div>
              <Label htmlFor="editStartDate" required>
                {t('bookings.new.startDate')}
              </Label>
              <Input id="editStartDate" type="date" disabled={!draft} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="editEndDate" required>
                {t('bookings.new.endDate')}
              </Label>
              <Input id="editEndDate" type="date" min={draft ? startDate : effectiveFrom} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-ink/50">
            {!draft && `${t('bookings.edit.firstDayFixed', { date: fmtDate(booking.startDate, locale) })} `}
            {end <= start && `${t('bookings.detail.nextDay')}. `}
            {t('bookings.new.timesHint')}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="editLanguage">{t('requests.new.language')}</Label>
            <Select id="editLanguage" value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'si' | 'ta')}>
              {(['en', 'si', 'ta'] as const).map((l) => (
                <option key={l} value={l}>
                  {t(`requests.detail.language.${l}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="editNotes">{t('bookings.new.notes')}</Label>
            <Textarea id="editNotes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {preview && (
          <div className={cn('rounded border p-3 text-sm', preview.billed.length || tooMany || noShifts ? 'border-danger/40 bg-danger-light/40' : 'border-border bg-paper')} aria-live="polite">
            {tooMany ? (
              <p className="text-danger">{t('bookings.new.tooMany')}</p>
            ) : noShifts ? (
              <p className="text-danger">{t('bookings.new.none')}</p>
            ) : rosterChanges === 0 ? (
              <p className="text-ink/70">{t('bookings.edit.noRosterChange')}</p>
            ) : (
              <>
                {preview.generated && (
                  <p className="font-medium text-ink">
                    {draft
                      ? t('bookings.edit.previewDraft', { kept: preview.plan.keep.length, removed: preview.plan.drop.length, added: preview.plan.add.length })
                      : t('bookings.edit.previewConfirmed', {
                          date: fmtDate(effectiveFrom, locale),
                          kept: preview.plan.keep.length,
                          cancelled: preview.plan.drop.length,
                          added: preview.plan.add.length,
                        })}
                  </p>
                )}
                {caregiverChanged && (
                  <p className="text-ink/70">
                    {t('bookings.edit.previewMoved', { count: preview.moved.length + preview.plan.add.length, name: caregiver!.fullName })}
                  </p>
                )}
                {!draft && !preview.billed.length && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-accent">
                    <BellRing size={12} aria-hidden />
                    {t('bookings.edit.willNotify')}
                  </p>
                )}
              </>
            )}
            {preview.billed.length > 0 && (
              <p className="mt-1 flex items-start gap-1.5 text-danger" role="alert">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                {t('bookings.edit.billedBlock', { docs: preview.billed.join(', ') })}
              </p>
            )}
          </div>
        )}

        {update.isError && (
          <p role="alert" className="text-sm text-danger">
            {update.error instanceof ApiError && update.error.message ? update.error.message : t('requests.detail.saveFailed')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!ready || update.isPending} onClick={submit}>
            {update.isPending ? t('common.loading') : !draft && rosterChanges > 0 ? t('bookings.edit.saveNotify') : t('bookings.edit.save')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {!changed && <span className="text-sm text-ink/50">{t('bookings.edit.nothing')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
