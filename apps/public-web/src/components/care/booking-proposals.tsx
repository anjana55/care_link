'use client';

import { useState } from 'react';
import { CLIENT_REVIEW_NOTE_MAX, type ClientBookingProposal } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useAnswerBookingProposal, useBookingProposals } from '@/lib/hooks/use-client-care';
import { fmtDate, fmtWeekday } from '@/lib/colombo-time';
import { CaregiverSummary } from '@/components/care/caregiver-summary';

/**
 * Bookings the office has prepared and asked the client to check: who is
 * coming, on which days, at what times, and what it costs. They accept it as
 * it is or say what to change. Nothing is booked until it is confirmed, and
 * the card says so.
 */
export function BookingProposals() {
  const { data } = useBookingProposals();
  if (!data?.length) return null;
  return (
    <ul className="mb-6 space-y-4">
      {data.map((p) => (
        <li key={p.id}>
          <Proposal proposal={p} />
        </li>
      ))}
    </ul>
  );
}

function Proposal({ proposal: p }: { proposal: ClientBookingProposal }) {
  const { t, locale } = useTranslation();
  const answer = useAnswerBookingProposal();
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState('');
  const waiting = p.status === 'ASKED';
  const days = p.daysOfWeek.length === 7 ? t('account.bookingCheck.everyDay') : p.daysOfWeek.map((d) => fmtWeekday(d, locale)).join(', ');
  const overnight = p.shiftEndTime <= p.shiftStartTime;

  return (
    <section aria-labelledby={`check-${p.id}`} className={`rounded-lg border p-4 sm:p-5 ${waiting ? 'border-brand bg-brand-light/40' : 'border-border bg-white'}`}>
      <h2 id={`check-${p.id}`} className="text-base font-semibold text-ink">
        {t(`account.bookingCheck.title.${p.status}`)}
      </h2>
      <p className="mt-1 text-sm text-ink/70">{t(`account.bookingCheck.intro.${p.status}`)}</p>

      <div className="mt-4">
        {p.caregiver ? (
          <CaregiverSummary publicId={p.caregiver.publicId} caregiver={p.caregiver} unavailableText={t('account.requests.notOnline')} />
        ) : (
          <p className="text-sm text-ink/70">{t('account.bookingCheck.caregiverByTeam')}</p>
        )}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-ink/50">{t('account.bookingCheck.days')}</dt>
          <dd className="text-ink">{days}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink/50">{t('account.bookingCheck.times')}</dt>
          <dd className="tabular-nums text-ink">
            {p.shiftStartTime} – {p.shiftEndTime}
            {overnight && <span className="text-ink/60"> {t('account.bookingCheck.nextDay')}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink/50">{t('account.bookings.dates')}</dt>
          <dd className="text-ink">
            {fmtDate(p.startDate, locale)} – {fmtDate(p.endDate, locale)} <span className="text-ink/60">({t('account.bookingCheck.visits', { n: p.shiftCount })})</span>
          </dd>
        </div>
        {p.rateType && p.rateAmount && (
          <div>
            <dt className="text-xs text-ink/50">{t('account.bookingCheck.price')}</dt>
            <dd className="font-medium text-ink">
              LKR {Number(p.rateAmount).toLocaleString('en-LK', { minimumFractionDigits: 2 })} {t(`account.bookings.rateUnit.${p.rateType}`)}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-ink/50">{t('account.bookings.reference')}</dt>
          <dd className="tabular-nums text-ink">{p.reference}</dd>
        </div>
      </dl>
      {p.status === 'CHANGES_REQUESTED' && p.note && (
        <p className="mt-3 rounded bg-paper px-3 py-2 text-sm text-ink/80">
          <span className="text-xs text-ink/50">{t('account.bookingCheck.youAsked')}</span>
          <br />
          {p.note}
        </p>
      )}

      {waiting && !changing && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={answer.isPending}
            onClick={() => answer.mutate({ id: p.id })}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {t('account.bookingCheck.accept')}
          </button>
          <button type="button" disabled={answer.isPending} onClick={() => setChanging(true)} className="rounded border border-border bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-60">
            {t('account.bookingCheck.change')}
          </button>
        </div>
      )}
      {waiting && changing && (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim().length >= 3) answer.mutate({ id: p.id, note: note.trim() });
          }}
        >
          <label htmlFor={`change-${p.id}`} className="block text-sm font-medium text-ink">
            {t('account.bookingCheck.changeLabel')}
          </label>
          <textarea
            id={`change-${p.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={CLIENT_REVIEW_NOTE_MAX}
            rows={3}
            placeholder={t('account.bookingCheck.changePlaceholder')}
            className="mt-1 w-full rounded border border-border bg-white px-3 py-2 text-sm text-ink"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" disabled={answer.isPending || note.trim().length < 3} className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">
              {t('account.bookingCheck.send')}
            </button>
            <button type="button" onClick={() => setChanging(false)} className="rounded border border-border bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
              {t('account.bookingCheck.back')}
            </button>
          </div>
        </form>
      )}
      {waiting && <p className="mt-3 text-xs text-ink/60">{t('account.bookingCheck.notBookedYet')}</p>}
      {answer.isError && (
        <p role="alert" className="mt-2 text-sm text-accent">
          {(answer.error as Error).message || t('account.bookingCheck.failed')}
        </p>
      )}
    </section>
  );
}
