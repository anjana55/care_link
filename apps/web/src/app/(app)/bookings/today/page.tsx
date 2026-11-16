'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { CHECK_IN_NOTE_MAX, colomboLocalToIso, type TodayVisit } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useRecordVisit, useTodayVisits } from '@/lib/hooks/use-check-in';
import { fmtDate, fmtTime } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { PhoneLink } from '@/components/clients/contact-links';
import { ShiftStatusBadge } from '@/components/bookings/booking-badges';
import { VisitChip, VisitNotes } from '@/components/bookings/visit-chip';
import { CoverPanel } from '@/components/bookings/cover-panel';

/**
 * Today's visits: every shift on today's roster in time order, and whether
 * the caregiver has checked in. Late ones come first. Staff can record a
 * check-in or check-out for a caregiver who phoned instead - the manual way
 * always works - and find cover for a visit whose caregiver cannot come.
 */
export default function TodayVisitsPage() {
  const { t, locale } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const allowed = !!user && (user.role === 'ADMIN' || user.role === 'STAFF');
  useEffect(() => {
    if (!authLoading && user && !allowed) router.replace('/dashboard');
  }, [authLoading, user, allowed, router]);
  const { data, isLoading } = useTodayVisits(allowed);

  if (authLoading || !allowed || isLoading || !data) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;

  const late = data.visits.filter((v) => v.minutesLate !== null);
  const rest = data.visits.filter((v) => v.minutesLate === null);
  const here = data.visits.filter((v) => v.checkIn.state === 'IN').length;

  return (
    <div>
      <Link href="/bookings" className="mb-3 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft size={14} aria-hidden />
        {t('visits.back')}
      </Link>
      <h1 className="text-xl font-semibold text-ink">{t('visits.title')}</h1>
      <p className="mb-4 text-sm text-ink/60">
        {fmtDate(data.date, locale)} · {t('visits.summary', { total: data.visits.length, here, late: late.length })}
      </p>
      {!data.settings.enabled && (
        <p className="mb-4 rounded border border-accent/30 bg-accent-light px-3 py-2 text-sm text-accent">
          {t('visits.off')}{' '}
          {user.role === 'ADMIN' && (
            <Link href="/settings/check-in" className="font-medium underline">
              {t('visits.offLink')}
            </Link>
          )}
        </p>
      )}

      {data.visits.length === 0 ? (
        <p className="rounded border border-dashed border-border bg-white px-4 py-10 text-center text-sm text-ink/50">{t('visits.none')}</p>
      ) : (
        <>
          {late.length > 0 && (
            <section aria-labelledby="late-heading" className="mb-6">
              <h2 id="late-heading" className="mb-2 text-sm font-semibold text-danger">
                {t('visits.lateHeading', { n: late.length })}
              </h2>
              <ul className="space-y-2">
                {late.map((v) => (
                  <VisitRow key={v.shiftId} visit={v} date={data.date} on={data.settings.enabled} />
                ))}
              </ul>
            </section>
          )}
          <ul className="space-y-2">
            {rest.map((v) => (
              <VisitRow key={v.shiftId} visit={v} date={data.date} on={data.settings.enabled} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function VisitRow({ visit: v, date, on }: { visit: TodayVisit; date: string; on: boolean }) {
  const { t, locale } = useTranslation();
  const [recording, setRecording] = useState<'check-in' | 'check-out' | null>(null);
  const [covering, setCovering] = useState(false);
  const live = v.shiftStatus === 'SCHEDULED' || v.shiftStatus === 'COMPLETED';
  const canIn = on && live && !v.checkIn.checkedInAt && !v.paused;
  const canOut = on && live && !!v.checkIn.checkedInAt && !v.checkIn.checkedOutAt;
  // Cover is for a visit nobody has come to yet. It needs no check-in switch: a caregiver can phone in sick either way.
  // A paused visit is not meant to happen: no cover is looked for.
  const canCover = !v.paused && v.shiftStatus === 'SCHEDULED' && !v.checkIn.checkedInAt && new Date(v.endsAt).getTime() > Date.now();

  return (
    <li className={`rounded-lg border bg-white p-3 ${v.minutesLate !== null ? 'border-danger/40' : 'border-border'}`} data-testid={`visit-${v.shiftId}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="w-28 shrink-0 text-sm tabular-nums text-ink">
          {fmtTime(v.startsAt, locale)}–{fmtTime(v.endsAt, locale)}
        </div>
        <div className="min-w-[12rem] flex-1 text-sm">
          <Link href={`/bookings/${v.bookingId}`} className="font-medium text-brand-dark hover:underline">
            {v.client.fullName}
          </Link>
          <span className="text-ink/50"> · {v.bookingReference}</span>
          {v.client.recipientName && <p className="text-xs text-ink/60">{t('visits.careFor', { name: v.client.recipientName })}</p>}
          {v.client.area && <p className="text-xs text-ink/50">{v.client.area}</p>}
        </div>
        <div className="min-w-[12rem] flex-1 text-sm">
          <Link href={`/caregivers/${v.caregiver.id}`} className="text-ink hover:underline">
            {v.caregiver.fullName}
          </Link>
          {v.isCover && <span className="ml-1 text-xs text-accent">({t('visits.cover')})</span>}
          {v.paused && <p className="text-xs font-medium text-danger">{t('visits.paused')}</p>}
          {v.coverWaiting > 0 && <p className="text-xs font-medium text-accent">{t('visits.coverPanel.waiting', { n: v.coverWaiting })}</p>}
          <p className="text-xs text-ink/50">{v.caregiver.registrationNumber}</p>
          {v.caregiver.phone && (
            <p className="text-xs">
              <PhoneLink phone={v.caregiver.phone} whatsapp />
            </p>
          )}
        </div>
        <div className="min-w-[10rem] text-sm">
          {live ? on ? <VisitChip checkIn={v.checkIn} minutesLate={v.minutesLate} /> : null : <ShiftStatusBadge status={v.shiftStatus} label={t(`bookings.shiftStatus.${v.shiftStatus}`)} />}
          {on && live && <VisitNotes checkIn={v.checkIn} />}
          {/* The code matters only while the caregiver can still use it. */}
          {on && live && !v.checkIn.checkedInAt && v.checkIn.state !== 'NOT_RECORDED' && (
            <p className="mt-1 text-xs text-ink/50">
              {t('visits.code')} <span className="font-medium tabular-nums text-ink">{v.checkIn.arrivalCode}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(canIn || canOut) && !recording && (
            <Button variant="secondary" size="sm" onClick={() => (setCovering(false), setRecording(canIn ? 'check-in' : 'check-out'))}>
              {canIn ? t('visits.recordIn') : t('visits.recordOut')}
            </Button>
          )}
          {(canCover || v.coverWaiting > 0) && !covering && (
            <Button variant="secondary" size="sm" onClick={() => (setRecording(null), setCovering(true))}>
              {t('visits.coverPanel.find')}
            </Button>
          )}
        </div>
      </div>
      {recording && <RecordForm shiftId={v.shiftId} what={recording} date={date} onDone={() => setRecording(null)} />}
      {covering && <CoverPanel shiftId={v.shiftId} onClose={() => setCovering(false)} />}
    </li>
  );
}

/** "The caregiver phoned at ten past": an optional time today (now when left empty) and a note. */
function RecordForm({ shiftId, what, date, onDone }: { shiftId: string; what: 'check-in' | 'check-out'; date: string; onDone: () => void }) {
  const { t } = useTranslation();
  const record = useRecordVisit(shiftId, what);
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = `${what}-${shiftId}`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const at = time ? (colomboLocalToIso(`${date}T${time}`) ?? undefined) : undefined;
    record.mutate({ at, note: note.trim() || undefined }, { onSuccess: onDone, onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('visits.recordError')) });
  };

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3">
      <div>
        <Label htmlFor={`${id}-time`}>{what === 'check-in' ? t('visits.arrivedAt') : t('visits.leftAt')}</Label>
        <Input id={`${id}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" aria-describedby={`${id}-hint`} />
      </div>
      <div className="min-w-[14rem] flex-1">
        <Label htmlFor={`${id}-note`}>{t('visits.noteLabel')}</Label>
        <Input id={`${id}-note`} value={note} maxLength={CHECK_IN_NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder={t('visits.notePlaceholder')} />
      </div>
      <Button type="submit" size="sm" disabled={record.isPending}>
        {what === 'check-in' ? t('visits.recordIn') : t('visits.recordOut')}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onDone}>
        {t('common.cancel')}
      </Button>
      <p id={`${id}-hint`} className="w-full text-xs text-ink/50">
        {t('visits.timeHint')}
      </p>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
