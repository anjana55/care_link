'use client';

import { useState } from 'react';
import { CalendarClock, CalendarPlus, Video } from 'lucide-react';
import { INTERVIEW_LIMITS, interviewModeValues, type EmployerInterview, type InterviewInput, type InterviewMode, type StaffCandidate } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useInterviewActions } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Zones staff most often book in: ours, and the employers'. */
export const INTERVIEW_ZONES = [
  'Asia/Colombo',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Dubai',
  'Asia/Qatar',
  'Asia/Riyadh',
  'Asia/Kuwait',
  'Asia/Jerusalem',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Berlin',
  'Europe/Rome',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
  'America/Toronto',
  'America/New_York',
] as const;

/** The offset (ms) of `zone` from UTC at instant `ms`. */
function zoneOffset(ms: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ms;
}

/**
 * A wall-clock time in a zone ("2026-11-04T10:00" in Asia/Tokyo) as an exact
 * instant. Checked twice so a time near a daylight-saving change lands right.
 */
export function zonedToIso(local: string, zone: string): string {
  const [d, t] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, day, h, min);
  let ms = wall - zoneOffset(wall, zone);
  ms = wall - zoneOffset(ms, zone);
  return new Date(ms).toISOString();
}

/** An instant as a datetime-local value in `zone`. */
export function isoToZoned(iso: string, zone: string): string {
  const ms = new Date(iso).getTime();
  return new Date(ms + zoneOffset(ms, zone)).toISOString().slice(0, 16);
}

export function fmtIn(iso: string, zone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : `${locale}-LK`, {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(new Date(iso));
}

const STATUS_STYLES: Record<EmployerInterview['status'], string> = {
  SCHEDULED: 'bg-brand-light text-brand-dark',
  COMPLETED: 'bg-brand text-white',
  CANCELLED: 'bg-ink/10 text-ink/60 line-through',
  NO_SHOW: 'bg-danger/10 text-danger',
};

/**
 * Interviews for one candidate: each round with its time in Colombo and in
 * the zone it was booked for, and the employer's feedback; and the form to
 * book the next one. Both sides are emailed whenever a round is booked,
 * moved or cancelled.
 */
export function InterviewsPanel({ enquiryId, candidate }: { enquiryId: string; candidate: StaffCandidate }) {
  const { t } = useTranslation();
  const [booking, setBooking] = useState(false);
  const closed = candidate.status === 'PLACED' || candidate.status === 'NOT_PROCEEDING';
  return (
    <div className="mt-3 rounded border border-border bg-paper/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink/60">
          <CalendarClock size={14} aria-hidden />
          {t('international.interviews.title')}
        </h4>
        {!closed && !booking && (
          <Button size="sm" variant="secondary" onClick={() => setBooking(true)} disabled={!candidate.profileLive}>
            <CalendarPlus size={14} aria-hidden className="mr-1" />
            {t('international.interviews.book')}
          </Button>
        )}
      </div>
      {candidate.interviews.length === 0 && !booking && <p className="mt-2 text-xs text-ink/50">{t('international.interviews.none')}</p>}
      <ul className="mt-2 space-y-2">
        {candidate.interviews.map((i) => (
          <InterviewRow key={i.id} enquiryId={enquiryId} interview={i} />
        ))}
      </ul>
      {booking && <InterviewForm enquiryId={enquiryId} candidateId={candidate.id} onDone={() => setBooking(false)} />}
    </div>
  );
}

function InterviewRow({ enquiryId, interview: i }: { enquiryId: string; interview: EmployerInterview }) {
  const { t, locale } = useTranslation();
  const { update } = useInterviewActions(enquiryId);
  const [mode, setMode] = useState<'idle' | 'move' | 'cancel'>('idle');
  const [reason, setReason] = useState('');
  const past = new Date(i.scheduledAt).getTime() < Date.now();

  return (
    <li className="rounded bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{t('international.interviews.round', { n: i.round })}</span>
        <span className="tabular-nums text-ink/80">{fmtIn(i.scheduledAt, 'Asia/Colombo', locale)}</span>
        <span className="text-xs text-ink/50">
          {t(`international.interviews.mode.${i.mode}`)} · {t('international.interviews.minutes', { n: i.durationMinutes })}
        </span>
        <span className={cn('ml-auto rounded px-2 py-0.5 text-xs font-medium', STATUS_STYLES[i.status])}>{t(`international.interviews.status.${i.status}`)}</span>
      </div>
      {i.meetingLink && (
        <a href={i.meetingLink} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-dark hover:underline">
          <Video size={12} aria-hidden />
          {i.meetingLink}
        </a>
      )}
      {i.location && <p className="mt-1 text-xs text-ink/70">{i.location}</p>}
      {i.cancelReason && <p className="mt-1 text-xs text-ink/60">{t('international.interviews.cancelledBecause', { reason: i.cancelReason })}</p>}
      {i.feedback && (
        <p className="mt-2 rounded bg-brand-light/50 px-2 py-1.5 text-xs text-ink">
          <span className="font-semibold">{t('international.interviews.feedback')}</span> {i.feedback}
        </p>
      )}

      {i.status === 'SCHEDULED' && mode === 'idle' && (
        <div className="mt-2 flex flex-wrap gap-2">
          {past ? (
            <>
              <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => update.mutate({ id: i.id, body: { status: 'COMPLETED' } })}>
                {t('international.interviews.markHeld')}
              </Button>
              <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: i.id, body: { status: 'NO_SHOW' } })}>
                {t('international.interviews.markNoShow')}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setMode('move')}>
              {t('international.interviews.move')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setMode('cancel')}>
            {t('international.interviews.cancel')}
          </Button>
        </div>
      )}
      {mode === 'move' && <InterviewForm enquiryId={enquiryId} existing={i} onDone={() => setMode('idle')} />}
      {mode === 'cancel' && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ id: i.id, body: { status: 'CANCELLED', cancelReason: reason.trim() } }, { onSuccess: () => setMode('idle') });
          }}
        >
          <div className="min-w-48 flex-1">
            <Label htmlFor={`cr-${i.id}`}>{t('international.interviews.cancelReason')}</Label>
            <Input id={`cr-${i.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={INTERVIEW_LIMITS.reason} />
          </div>
          <Button size="sm" variant="danger" type="submit" disabled={!reason.trim() || update.isPending}>
            {t('international.interviews.confirmCancel')}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setMode('idle')}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
      {update.isError && <p className="mt-1 text-xs text-danger">{update.error instanceof Error ? update.error.message : t('common.actionFailed')}</p>}
    </li>
  );
}

function InterviewForm({ enquiryId, candidateId, existing, onDone }: { enquiryId: string; candidateId?: string; existing?: EmployerInterview; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const { schedule, update } = useInterviewActions(enquiryId);
  const [zone, setZone] = useState<string>('Asia/Colombo');
  const [when, setWhen] = useState(existing ? isoToZoned(existing.scheduledAt, 'Asia/Colombo') : '');
  const [duration, setDuration] = useState(String(existing?.durationMinutes ?? 30));
  const [mode, setMode] = useState<InterviewMode>(existing?.mode ?? 'VIDEO');
  const [link, setLink] = useState(existing?.meetingLink ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [instructions, setInstructions] = useState(existing?.instructions ?? '');
  const mutation = existing ? update : schedule;
  const iso = when ? zonedToIso(when, zone) : null;

  return (
    <form
      className="mt-3 space-y-3 rounded border border-dashed border-brand/40 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!iso) return;
        const body: InterviewInput = {
          scheduledAt: iso,
          durationMinutes: Number(duration),
          mode,
          meetingLink: link.trim() || null,
          location: location.trim() || null,
          instructions: instructions.trim() || null,
        };
        if (existing) update.mutate({ id: existing.id, body }, { onSuccess: onDone });
        else schedule.mutate({ candidateId: candidateId!, body }, { onSuccess: onDone });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="iv-when">{t('international.interviews.when')}</Label>
          <Input
            id="iv-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="iv-zone">{t('international.interviews.zone')}</Label>
          <Select
            id="iv-zone"
            value={zone}
            onChange={(e) => {
              // Keep the same instant; show it in the new zone.
              if (iso) setWhen(isoToZoned(iso, e.target.value));
              setZone(e.target.value);
            }}
          >
            {INTERVIEW_ZONES.map((z) => (
              <option key={z} value={z}>
                {z.replace('_', ' ')}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="iv-dur">{t('international.interviews.duration')}</Label>
          <Select id="iv-dur" value={duration} onChange={(e) => setDuration(e.target.value)}>
            {[15, 20, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {t('international.interviews.minutes', { n: m })}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {iso && zone !== 'Asia/Colombo' && <p className="text-xs text-ink/60">{t('international.interviews.inColombo', { when: fmtIn(iso, 'Asia/Colombo', locale) })}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="iv-mode">{t('international.interviews.how')}</Label>
          <Select id="iv-mode" value={mode} onChange={(e) => setMode(e.target.value as InterviewMode)}>
            {interviewModeValues.map((m) => (
              <option key={m} value={m}>
                {t(`international.interviews.mode.${m}`)}
              </option>
            ))}
          </Select>
        </div>
        {mode === 'VIDEO' && (
          <div className="sm:col-span-2">
            <Label htmlFor="iv-link">{t('international.interviews.link')}</Label>
            <Input id="iv-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" maxLength={INTERVIEW_LIMITS.link} required />
          </div>
        )}
        {mode === 'IN_PERSON' && (
          <div className="sm:col-span-2">
            <Label htmlFor="iv-loc">{t('international.interviews.location')}</Label>
            <Input id="iv-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={INTERVIEW_LIMITS.location} required />
          </div>
        )}
      </div>
      <div>
        <Label htmlFor="iv-ins">{t('international.interviews.instructions')}</Label>
        <Textarea id="iv-ins" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={INTERVIEW_LIMITS.instructions} placeholder={t('international.interviews.instructionsPlaceholder')} />
      </div>
      <p className="text-xs text-ink/50">{t('international.interviews.emailed')}</p>
      {mutation.isError && <p className="text-xs text-danger">{mutation.error instanceof Error ? mutation.error.message : t('common.actionFailed')}</p>}
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={!iso || mutation.isPending}>
          {existing ? t('international.interviews.saveMove') : t('international.interviews.bookButton')}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
