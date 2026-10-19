'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { addDays, colomboToday, generateShifts, isoToColomboLocal, MAX_GENERATED_SHIFTS, SCHEDULE_PRESETS, shiftHours, type IsoWeekday } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useCreateBooking } from '@/lib/hooks/use-bookings';
import { useCareRequest } from '@/lib/hooks/use-care-requests';
import { fmtDay, fmtTime, fmtWeekday } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { ClientPicker } from '@/components/requests/client-picker';
import { CaregiverPicker, type PickedCaregiver } from '@/components/requests/caregiver-picker';
import { cn } from '@/lib/utils';
import type { Client, RateType, ScheduleType } from '@/lib/api/types';

const TYPES: ScheduleType[] = ['DAY', 'NIGHT', 'LIVE_IN', 'CUSTOM'];
const RATE_TYPES: RateType[] = ['DAILY', 'MONTHLY', 'HOURLY'];
const WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export default function NewBookingRoute() {
  return (
    <Suspense>
      <NewBookingPage />
    </Suspense>
  );
}

/**
 * Create a booking: who, which pattern, what rate. The pattern is previewed as
 * the shifts it will make - the same generator the API uses - and saved as a
 * DRAFT, so staff can still adjust any single shift before confirming.
 */
function NewBookingPage() {
  const { t, locale } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const requestId = params.get('requestId') ?? '';
  const { data: request } = useCareRequest(requestId);
  const create = useCreateBooking();

  const [client, setClient] = useState<Client | null>(null);
  const [caregiver, setCaregiver] = useState<PickedCaregiver | null>(null);
  const [scheduleType, setScheduleType] = useState<ScheduleType>('DAY');
  const [days, setDays] = useState<IsoWeekday[]>(SCHEDULE_PRESETS.DAY.days);
  const [start, setStart] = useState(SCHEDULE_PRESETS.DAY.start);
  const [end, setEnd] = useState(SCHEDULE_PRESETS.DAY.end);
  const [startDate, setStartDate] = useState(addDays(colomboToday(), 1));
  const [endDate, setEndDate] = useState(addDays(colomboToday(), 28));
  const [rateType, setRateType] = useState<RateType | ''>('');
  const [rateAmount, setRateAmount] = useState('');
  const [payRateType, setPayRateType] = useState<RateType | ''>('');
  const [payRateAmount, setPayRateAmount] = useState('');
  const [language, setLanguage] = useState<'en' | 'si' | 'ta'>('en');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!authLoading && user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [authLoading, user, router]);

  // From a request: its client, caregiver and language, and its schedule as a starting point.
  useEffect(() => {
    if (!request) return;
    if (request.caregiver)
      setCaregiver({ id: request.caregiver.id, fullName: request.caregiver.fullName, registrationNumber: request.caregiver.registrationNumber, status: request.caregiver.status });
    setLanguage(request.language);
    const sched = request.client.careSchedule;
    if (sched === 'DAY' || sched === 'NIGHT' || sched === 'LIVE_IN_24H') pickType(sched === 'LIVE_IN_24H' ? 'LIVE_IN' : sched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  function pickType(type: ScheduleType) {
    setScheduleType(type);
    if (type !== 'CUSTOM') {
      setDays(SCHEDULE_PRESETS[type].days);
      setStart(SCHEDULE_PRESETS[type].start);
      setEnd(SCHEDULE_PRESETS[type].end);
    }
  }
  const toggleDay = (d: IsoWeekday) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const preview = useMemo(
    () => generateShifts({ startDate, endDate, daysOfWeek: days, shiftStartTime: start, shiftEndTime: end }),
    [startDate, endDate, days, start, end],
  );
  const hours = preview.length ? shiftHours(preview[0].startsAt, preview[0].endsAt) : 0;
  const overnight = end <= start;

  const patientId = request ? request.client.id : client?.id;
  const ready = Boolean(patientId && caregiver && preview.length > 0 && preview.length <= MAX_GENERATED_SHIFTS && (!rateType || /^\d{1,8}(\.\d{1,2})?$/.test(rateAmount)) && (!payRateType || /^\d{1,8}(\.\d{1,2})?$/.test(payRateAmount)));

  const submit = () =>
    create.mutate(
      {
        ...(requestId ? { careRequestId: requestId } : { patientId }),
        caregiverId: caregiver?.id,
        scheduleType,
        daysOfWeek: days,
        shiftStartTime: start,
        shiftEndTime: end,
        startDate,
        endDate,
        ...(rateType ? { rateType, rateAmount } : {}),
        ...(payRateType ? { payRateType, payRateAmount } : {}),
        language,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      { onSuccess: (b) => router.push(`/bookings/${b.id}`) },
    );

  if (authLoading || !user) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  const weekdayName = (d: IsoWeekday) => fmtWeekday(d, locale);

  return (
    <div className="max-w-3xl">
      <Link href={request ? `/requests/${request.id}` : '/bookings'} className="mb-4 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ChevronLeft size={16} />
        {request ? request.reference : t('bookings.back')}
      </Link>
      <h1 className="text-xl font-semibold text-ink">{t('bookings.new.title')}</h1>
      <p className="mb-6 mt-1 text-sm text-ink/60">{t('bookings.new.subtitle')}</p>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('bookings.new.whoTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label required>{t('bookings.table.client')}</Label>
              {request ? (
                <div className="rounded border border-border bg-paper px-3 py-2 text-sm">
                  <span className="font-medium text-ink">{request.client.fullName}</span>
                  {request.client.recipientName && <span className="text-ink/60"> · {t('requests.forRecipient', { name: request.client.recipientName })}</span>}
                </div>
              ) : client ? (
                <div className="flex items-center justify-between gap-3 rounded border border-border bg-paper px-3 py-2 text-sm">
                  <span className="font-medium text-ink">{client.fullName}</span>
                  <Button size="sm" variant="secondary" onClick={() => setClient(null)}>
                    {t('requests.new.changeClient')}
                  </Button>
                </div>
              ) : (
                <ClientPicker onPick={setClient} />
              )}
            </div>
            <div>
              <Label required>{t('bookings.table.caregiver')}</Label>
              {caregiver ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-paper px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-ink">{caregiver.fullName}</span>
                    <span className="tabular-nums text-ink/50">{caregiver.registrationNumber}</span>
                    <StatusBadge status={caregiver.status} label={t(`caregivers.status.${caregiver.status}`)} />
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setCaregiver(null)}>
                    {t('requests.new.changeClient')}
                  </Button>
                </div>
              ) : (
                <CaregiverPicker onPick={setCaregiver} />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('bookings.new.patternTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
            <div>
              <Label>{t('bookings.new.days')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={days.includes(d)}
                    onClick={() => {
                      toggleDay(d);
                      setScheduleType('CUSTOM');
                    }}
                    className={cn('w-14 rounded border py-1.5 text-sm', days.includes(d) ? 'border-brand bg-brand-light font-medium text-brand-dark' : 'border-border text-ink/60 hover:bg-paper')}
                  >
                    {weekdayName(d)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <Label htmlFor="start" required>{t('bookings.new.startTime')}</Label>
                <Input id="start" type="time" step={900} value={start} onChange={(e) => { setStart(e.target.value); setScheduleType('CUSTOM'); }} />
              </div>
              <div>
                <Label htmlFor="end" required>{t('bookings.new.endTime')}</Label>
                <Input id="end" type="time" step={900} value={end} onChange={(e) => { setEnd(e.target.value); setScheduleType('CUSTOM'); }} />
              </div>
              <div>
                <Label htmlFor="startDate" required>{t('bookings.new.startDate')}</Label>
                <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="endDate" required>{t('bookings.new.endDate')}</Label>
                <Input id="endDate" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-ink/50">
              {overnight ? t('bookings.new.overnightHint', { hours }) : t('bookings.new.hoursHint', { hours })} {t('bookings.new.timesHint')}
            </p>

            <div className="rounded border border-border bg-paper p-3" aria-live="polite">
              <p className={cn('text-sm font-medium', preview.length > MAX_GENERATED_SHIFTS || !preview.length ? 'text-danger' : 'text-ink')}>
                {preview.length > MAX_GENERATED_SHIFTS ? t('bookings.new.tooMany') : preview.length ? t('bookings.new.willCreate', { count: preview.length }) : t('bookings.new.none')}
              </p>
              {preview.length > 0 && preview.length <= MAX_GENERATED_SHIFTS && (
                <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs tabular-nums text-ink/60 sm:grid-cols-2">
                  {preview.slice(0, 6).map((s) => (
                    <li key={s.startsAt.toISOString()}>
                      {fmtDay(s.startsAt.toISOString(), locale)} · {fmtTime(s.startsAt.toISOString(), locale)}–{fmtTime(s.endsAt.toISOString(), locale)}
                      {isoToColomboLocal(s.endsAt).slice(0, 10) !== isoToColomboLocal(s.startsAt).slice(0, 10) && ' (+1)'}
                    </li>
                  ))}
                  {preview.length > 6 && <li>{t('bookings.new.andMore', { count: preview.length - 6 })}</li>}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('bookings.new.rateTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="rateType">{t('bookings.new.rateType')}</Label>
              <Select id="rateType" value={rateType} onChange={(e) => setRateType(e.target.value as RateType | '')}>
                <option value="">{t('bookings.new.noRate')}</option>
                {RATE_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {t(`bookings.rateType.${r}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="rateAmount" required={Boolean(rateType)}>{t('bookings.new.rateAmount')}</Label>
              <Input id="rateAmount" inputMode="decimal" placeholder="3500.00" disabled={!rateType} value={rateAmount} onChange={(e) => setRateAmount(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="language" required>{t('requests.new.language')}</Label>
              <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'si' | 'ta')}>
                {(['en', 'si', 'ta'] as const).map((l) => (
                  <option key={l} value={l}>
                    {t(`requests.detail.language.${l}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="payRateType">{t('bookings.new.payRateType')}</Label>
              <Select id="payRateType" value={payRateType} onChange={(e) => setPayRateType(e.target.value as RateType | '')}>
                <option value="">{t('bookings.new.noPayRate')}</option>
                {RATE_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {t(`bookings.rateType.${r}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="payRateAmount" required={Boolean(payRateType)}>{t('bookings.new.payRateAmount')}</Label>
              <Input id="payRateAmount" inputMode="decimal" placeholder="2500.00" disabled={!payRateType} value={payRateAmount} onChange={(e) => setPayRateAmount(e.target.value)} />
            </div>
            <p className="self-end text-xs text-ink/50">{t('bookings.new.payRateHint')}</p>
            <div className="sm:col-span-3">
              <Label htmlFor="notes">{t('bookings.new.notes')}</Label>
              <Textarea id="notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {create.isError && (
          <p role="alert" className="text-sm text-danger">
            {create.error instanceof ApiError ? create.error.message : t('requests.detail.saveFailed')}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={!ready || create.isPending}>
            {create.isPending ? t('common.loading') : t('bookings.new.submit')}
          </Button>
          <span className="text-sm text-ink/50">{t('bookings.new.draftHint')}</span>
        </div>
      </div>
    </div>
  );
}
