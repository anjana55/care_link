'use client';

import { useState } from 'react';
import { AlertOctagon, CalendarClock, CalendarPlus, Check, CheckCircle2, Circle, FileSignature, LifeBuoy, MessageCircle, Phone, Trash2, Video } from 'lucide-react';
import {
  ASSESSMENT_LIMITS,
  CONTACT_ABROAD_LIMITS,
  EMERGENCY_NUMBERS,
  WELFARE_LIMITS,
  assessmentKindValues,
  assessmentProviderValues,
  cefrLevelValues,
  welfareCategoryValues,
  type AssessmentInput,
  type CaregiverJobOffer,
  type CaregiverPlacement,
  type CountryCode,
  type WelfareCategory,
  type WelfareReport,
  type WelfareSeverity,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { ApiError } from '@/lib/api/client';
import { fmtDate, fmtDateTime } from '@/lib/colombo-time';
import { downloadIcs, fmtInterview, isUpcoming } from '@/lib/interview-time';
import { useMyAssessments, useMyInterviews, useMyOffers, useMyPlacements, useMyWelfare, useSaveContactAbroad } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { OfferStatusBadge, OfferTermsList, SignatureLine } from './offer-terms';
import { cn } from '@/lib/utils';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function Section({ id, title, intro, tone = 'plain', icon, children }: { id: string; title: string; intro?: string; tone?: 'plain' | 'brand' | 'alert'; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        'scroll-mt-6 rounded-lg border p-5 sm:p-6',
        tone === 'brand' ? 'border-brand/40 bg-brand-light/40' : tone === 'alert' ? 'border-amber-300 bg-amber-50' : 'border-border bg-white',
      )}
    >
      <h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-semibold text-ink">
        {icon}
        {title}
      </h2>
      {intro && <p className="mt-1 text-sm text-ink/70">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

// --- job offers ---------------------------------------------------------------------------

/**
 * Offers that reached the caregiver. Accepting is a signature: they type their
 * full name, and confirm they have read the terms. The employer is named by
 * kind and country only - our team gives the rest and helps them decide.
 */
export function MyOffersCard() {
  const { t } = useTranslation();
  const { data = [] } = useMyOffers();
  if (!data.length) return null;
  const waiting = data.some((o) => o.status === 'SENT' && !o.expired);
  return (
    <Section
      id="offers"
      title={t('portal.workAbroad.offers.title')}
      intro={waiting ? t('portal.workAbroad.offers.introWaiting') : t('portal.workAbroad.offers.intro')}
      tone={waiting ? 'brand' : 'plain'}
      icon={<FileSignature className="h-5 w-5 text-brand" aria-hidden />}
    >
      <div className="space-y-4">
        {data.map((o) => (
          <OfferItem key={o.id} offer={o} />
        ))}
      </div>
    </Section>
  );
}

function OfferItem({ offer: o }: { offer: CaregiverJobOffer }) {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const { respond } = useMyOffers();
  const [mode, setMode] = useState<'idle' | 'accept' | 'decline'>('idle');
  const [name, setName] = useState('');
  const [read, setRead] = useState(false);
  const [reason, setReason] = useState('');
  const open = o.status === 'SENT' && !o.expired;

  return (
    <article aria-labelledby={`offer-${o.id}`} className="rounded-lg border border-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={`offer-${o.id}`} className="font-semibold text-ink">
            {o.jobTitle}
          </h3>
          <p className="text-sm text-ink/60">
            {t('portal.workAbroad.interest.who', { type: t(`international.employerTypes.${o.organisationType}`), country: countries.name(o.country) })} · {o.reference}
          </p>
        </div>
        <OfferStatusBadge status={o.status} expired={o.expired} />
      </div>
      {open && o.expiresOn && <p className="mt-2 text-sm font-medium text-brand-dark">{t('portal.workAbroad.offers.answerBy', { date: fmtDate(o.expiresOn, locale) })}</p>}
      <div className="mt-3">
        <OfferTermsList terms={o} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <SignatureLine label={t('overseas.employerSignature')} signature={o.employerSignature} />
        <SignatureLine label={t('overseas.yourSignature')} signature={o.caregiverSignature} />
      </div>
      {o.status === 'DECLINED' && o.declineReason && <p className="mt-2 text-sm text-ink/60">{t('portal.workAbroad.offers.yourReason', { reason: o.declineReason })}</p>}

      {open && mode === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button size="sm" onClick={() => setMode('accept')}>
            {t('portal.workAbroad.offers.accept')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('decline')}>
            {t('portal.workAbroad.offers.decline')}
          </Button>
          <p className="w-full text-xs text-ink/60">{t('portal.workAbroad.offers.talkFirst')}</p>
        </div>
      )}

      {open && mode === 'accept' && (
        <form
          className="mt-4 space-y-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            respond.mutate({ offerId: o.id, body: { action: 'ACCEPT', signatureName: name.trim() } }, { onSuccess: () => setMode('idle') });
          }}
        >
          <p className="text-sm text-ink/80">{t('portal.workAbroad.offers.inPrinciple')}</p>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} className="mt-1 h-4 w-4 accent-brand" />
            {t('portal.workAbroad.offers.readTerms')}
          </label>
          <div>
            <Label htmlFor={`sign-${o.id}`} required>
              {t('portal.workAbroad.offers.signLabel')}
            </Label>
            <Input id={`sign-${o.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" className="max-w-sm font-serif text-lg italic" />
            <p className="mt-1 text-xs text-ink/50">{t('portal.workAbroad.offers.signHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!read || name.trim().length < 2 || respond.isPending}>
              {t('portal.workAbroad.offers.signAccept')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode('idle')}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}

      {open && mode === 'decline' && (
        <form
          className="mt-4 space-y-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            respond.mutate({ offerId: o.id, body: { action: 'DECLINE', reason: reason.trim() || null } }, { onSuccess: () => setMode('idle') });
          }}
        >
          <div>
            <Label htmlFor={`reason-${o.id}`}>{t('portal.workAbroad.offers.reasonLabel')}</Label>
            <Textarea id={`reason-${o.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="danger" disabled={respond.isPending}>
              {t('portal.workAbroad.offers.confirmDecline')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode('idle')}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
      {respond.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorText(respond.error, t('portal.saveError'))}
        </p>
      )}
    </article>
  );
}

// --- interviews -----------------------------------------------------------------------------

export function MyInterviewsCard() {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const { data = [] } = useMyInterviews();
  const upcoming = data.filter((i) => isUpcoming(i)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  if (!upcoming.length) return null;
  return (
    <Section id="interviews" title={t('portal.workAbroad.interviews.title')} intro={t('portal.workAbroad.interviews.intro')} tone="brand" icon={<CalendarClock className="h-5 w-5 text-brand" aria-hidden />}>
      <ul className="space-y-3">
        {upcoming.map((i) => (
          <li key={i.id} className="rounded-lg border border-border bg-white p-4">
            <p className="font-semibold text-ink">{fmtInterview(i.scheduledAt, locale)}</p>
            <p className="mt-0.5 text-sm text-ink/60">
              {t('portal.workAbroad.interest.who', { type: t(`international.employerTypes.${i.organisationType}`), country: countries.name(i.country) })} ·{' '}
              {t(`overseas.interviewMode.${i.mode}`)} · {t('overseas.minutes', { n: i.durationMinutes })} · {t('overseas.round', { n: i.round })}
            </p>
            {i.meetingLink && (
              <a href={i.meetingLink} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-dark">
                <Video className="h-4 w-4" aria-hidden />
                {t('overseas.joinCall')}
              </a>
            )}
            {i.location && <p className="mt-2 text-sm text-ink/80">{i.location}</p>}
            {i.instructions && <p className="mt-2 whitespace-pre-line rounded bg-paper px-3 py-2 text-sm text-ink/80">{i.instructions}</p>}
            <button
              type="button"
              onClick={() => downloadIcs(i, t('overseas.icsSummaryCaregiver', { country: countries.name(i.country) }))}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink/70 hover:text-brand-dark"
            >
              <CalendarPlus className="h-4 w-4" aria-hidden />
              {t('overseas.addToCalendar')}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// --- departure ----------------------------------------------------------------------------------

/** What is left before the caregiver flies, the flight, and where they can be reached abroad. */
export function DepartureCard() {
  const { t, locale } = useTranslation();
  const { data = [] } = useMyPlacements();
  const current = data.find((p) => p.status === 'PRE_DEPARTURE' || p.status === 'DEPLOYED');
  if (!current) return null;
  const { checklist, departureDetails } = current.journey;
  const done = checklist.filter((c) => c.done).length;

  return (
    <Section id="departure" title={t('portal.workAbroad.departure.title')} intro={t('portal.workAbroad.departure.intro')}>
      {current.status === 'PRE_DEPARTURE' && (
        <>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={done} aria-label={t('portal.workAbroad.departure.progress', { done, total: checklist.length })}>
              <div className="h-full rounded-full bg-brand" style={{ width: `${(done / checklist.length) * 100}%` }} />
            </div>
            <span className="text-sm tabular-nums text-ink/70">{t('portal.workAbroad.departure.progress', { done, total: checklist.length })}</span>
          </div>
          <ol className="mt-4 space-y-2">
            {checklist.map((c) => (
              <li key={c.item} className="flex items-start gap-2 text-sm">
                {c.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink/30" aria-hidden />}
                <span className="min-w-0">
                  <span className={cn('font-medium', c.done ? 'text-ink' : 'text-ink/80')}>{t(`overseas.departure.${c.item}`)}</span>
                  <span className="sr-only">: {c.done ? t('portal.workAbroad.departure.done') : t('portal.workAbroad.departure.todo')}</span>
                  {c.done && c.doneOn && <span className="ml-2 text-xs text-ink/50">{fmtDate(c.doneOn, locale)}</span>}
                  {!c.done && c.dueOn && <span className="ml-2 text-xs font-medium text-accent-dark">{t('portal.workAbroad.departure.due', { date: fmtDate(c.dueOn, locale) })}</span>}
                  {c.note && <span className="block text-xs text-ink/60">{c.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      {departureDetails && (
        <p className="mt-4 rounded bg-brand-light/60 px-3 py-2 text-sm text-ink">
          <span className="font-semibold">{t('portal.workAbroad.departure.flight')}</span> {departureDetails}
        </p>
      )}
      <ContactAbroadForm placement={current} />
    </Section>
  );
}

function ContactAbroadForm({ placement }: { placement: CaregiverPlacement }) {
  const { t } = useTranslation();
  const save = useSaveContactAbroad();
  const [address, setAddress] = useState(placement.journey.addressAbroad ?? '');
  const [phone, setPhone] = useState(placement.journey.phoneAbroad ?? '');
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="mt-5 space-y-3 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        save.mutate({ placementId: placement.id, body: { addressAbroad: address.trim() || null, phoneAbroad: phone.trim() || null } }, { onSuccess: () => setSaved(true) });
      }}
    >
      <div>
        <h3 className="text-sm font-semibold text-ink">{t('portal.workAbroad.departure.contactTitle')}</h3>
        <p className="text-xs text-ink/60">{t('portal.workAbroad.departure.contactIntro')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="phone-abroad">{t('portal.workAbroad.departure.phone')}</Label>
          <Input id="phone-abroad" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={CONTACT_ABROAD_LIMITS.phone} placeholder="+81 90 1234 5678" autoComplete="tel" />
        </div>
        <div>
          <Label htmlFor="address-abroad">{t('portal.workAbroad.departure.address')}</Label>
          <Textarea id="address-abroad" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={CONTACT_ABROAD_LIMITS.address} rows={2} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={save.isPending}>
          {t('portal.workAbroad.save')}
        </Button>
        {saved && (
          <span role="status" className="flex items-center gap-1 text-sm text-brand-dark">
            <Check className="h-4 w-4" aria-hidden />
            {t('portal.workAbroad.departure.saved')}
          </span>
        )}
      </div>
      {save.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorText(save.error, t('portal.saveError'))}
        </p>
      )}
    </form>
  );
}

// --- welfare ---------------------------------------------------------------------------------------

/**
 * Help while abroad. The SOS button is two taps - press, then confirm - and
 * needs no typing: it reaches every member of our team at once. Local
 * emergency numbers come first, because in real danger the police or an
 * ambulance are faster than us.
 */
export function WelfareCard() {
  const { t } = useTranslation();
  const countries = useCountryNames();
  const { data: placements = [] } = useMyPlacements();
  const current = placements.find((p) => p.status === 'PRE_DEPARTURE' || p.status === 'DEPLOYED');
  const { data: reports = [], report } = useMyWelfare();
  const [sosArmed, setSosArmed] = useState(false);
  const [sent, setSent] = useState<WelfareSeverity | null>(null);
  const [severity, setSeverity] = useState<WelfareSeverity>('CONCERN');
  const [category, setCategory] = useState<WelfareCategory>('OTHER');
  const [message, setMessage] = useState('');
  if (!current) return null;
  const local = EMERGENCY_NUMBERS[current.country as CountryCode];
  const abroad = current.status === 'DEPLOYED';

  const send = (sev: WelfareSeverity, body: { category: WelfareCategory; message?: string }) =>
    report.mutate(
      { placementId: current.id, body: { severity: sev, ...body } },
      {
        onSuccess: () => {
          setSent(sev);
          setSosArmed(false);
          setMessage('');
        },
      },
    );

  return (
    <Section id="help" title={t('portal.workAbroad.welfare.title')} intro={t('portal.workAbroad.welfare.intro')} tone={abroad ? 'alert' : 'plain'} icon={<LifeBuoy className="h-5 w-5 text-amber-700" aria-hidden />}>
      {abroad && (
        <div className="rounded-lg border border-red-200 bg-white p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <Phone className="h-4 w-4" aria-hidden />
            {local
              ? t('portal.workAbroad.welfare.localNumbers', { country: countries.name(current.country), police: local.police, ambulance: local.ambulance })
              : t('portal.workAbroad.welfare.localGeneric')}
          </p>
          <div className="mt-3">
            {!sosArmed ? (
              <button
                type="button"
                onClick={() => setSosArmed(true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-3 text-base font-bold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300 sm:w-auto"
              >
                <AlertOctagon className="h-5 w-5" aria-hidden />
                {t('portal.workAbroad.welfare.sos')}
              </button>
            ) : (
              <div role="alertdialog" aria-labelledby="sos-confirm" className="space-y-2">
                <p id="sos-confirm" className="text-sm font-semibold text-ink">
                  {t('portal.workAbroad.welfare.sosConfirm')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={report.isPending}
                    onClick={() => send('SOS', { category: 'SAFETY' })}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {t('portal.workAbroad.welfare.sosSend')}
                  </button>
                  <Button variant="ghost" onClick={() => setSosArmed(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-ink/60">{t('portal.workAbroad.welfare.sosHint')}</p>
          </div>
        </div>
      )}

      {sent && (
        <p role="status" className="mt-3 rounded bg-brand-light px-3 py-2 text-sm font-medium text-brand-dark">
          {sent === 'SOS' ? t('portal.workAbroad.welfare.sosSent') : t('portal.workAbroad.welfare.sent')}
        </p>
      )}

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(severity, { category, message: message.trim() });
        }}
      >
        <h3 className="text-sm font-semibold text-ink">{t('portal.workAbroad.welfare.reportTitle')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="w-sev">{t('portal.workAbroad.welfare.how')}</Label>
            <Select id="w-sev" value={severity} onChange={(e) => setSeverity(e.target.value as WelfareSeverity)}>
              {(['QUESTION', 'CONCERN', 'URGENT'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`overseas.welfareSeverity.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="w-cat">{t('portal.workAbroad.welfare.about')}</Label>
            <Select id="w-cat" value={category} onChange={(e) => setCategory(e.target.value as WelfareCategory)}>
              {welfareCategoryValues.map((c) => (
                <option key={c} value={c}>
                  {t(`overseas.welfareCategory.${c}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="w-msg" required>
            {t('portal.workAbroad.welfare.message')}
          </Label>
          <Textarea id="w-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={WELFARE_LIMITS.message} rows={3} />
          <p className="mt-1 text-xs text-ink/50">{t('portal.workAbroad.welfare.private')}</p>
        </div>
        <Button type="submit" size="sm" disabled={message.trim().length < 5 || report.isPending}>
          {t('portal.workAbroad.welfare.send')}
        </Button>
        {report.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorText(report.error, t('portal.saveError'))}
          </p>
        )}
      </form>

      {reports.length > 0 && (
        <div className="mt-6 space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-ink">{t('portal.workAbroad.welfare.yours')}</h3>
          {reports.map((r) => (
            <ReportThread key={r.id} report={r} />
          ))}
        </div>
      )}
    </Section>
  );
}

function ReportThread({ report: r }: { report: WelfareReport }) {
  const { t, locale } = useTranslation();
  const { message } = useMyWelfare();
  const [reply, setReply] = useState('');
  const [open, setOpen] = useState(r.status !== 'RESOLVED');
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="rounded-lg border border-border bg-white">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', r.severity === 'SOS' || r.severity === 'URGENT' ? 'bg-red-100 text-red-800' : 'bg-paper text-ink/70')}>
          {t(`overseas.welfareSeverity.${r.severity}`)}
        </span>
        <span className="font-medium text-ink">{t(`overseas.welfareCategory.${r.category}`)}</span>
        <span className="text-xs text-ink/50">
          {r.reference} · {fmtDateTime(r.createdAt, locale)}
        </span>
        <span className="ml-auto text-xs font-semibold text-ink/60">{t(`overseas.welfareStatus.${r.status}`)}</span>
      </summary>
      <div className="space-y-2 border-t border-border px-4 py-3">
        {r.messages.map((m) => (
          <div key={m.id} className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm', m.from === 'STAFF' ? 'bg-brand-light text-ink' : 'ml-auto bg-paper text-ink')}>
            <p className="text-xs font-semibold text-ink/60">{m.from === 'STAFF' ? t('portal.workAbroad.welfare.ourTeam') : t('portal.workAbroad.welfare.you')}</p>
            <p className="whitespace-pre-line">{m.body}</p>
            <p className="mt-0.5 text-[11px] text-ink/40">{fmtDateTime(m.createdAt, locale)}</p>
          </div>
        ))}
        <form
          className="flex gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            message.mutate({ reportId: r.id, body: reply.trim() }, { onSuccess: () => setReply('') });
          }}
        >
          <label htmlFor={`reply-${r.id}`} className="sr-only">
            {t('portal.workAbroad.welfare.reply')}
          </label>
          <Input id={`reply-${r.id}`} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={WELFARE_LIMITS.message} placeholder={t('portal.workAbroad.welfare.reply')} />
          <Button type="submit" size="sm" variant="secondary" disabled={!reply.trim() || message.isPending} aria-label={t('portal.workAbroad.welfare.sendReply')}>
            <MessageCircle className="h-4 w-4" aria-hidden />
          </Button>
        </form>
      </div>
    </details>
  );
}

// --- test results ---------------------------------------------------------------------------------------

const EMPTY_RESULT: AssessmentInput = { kind: 'ENGLISH', provider: 'IELTS', title: '', score: '', cefrLevel: null, takenOn: '', validUntil: '' };

/** English tests and other results. Our team checks the original before a result counts or shows on the shared profile. */
export function MyResultsCard() {
  const { t, locale } = useTranslation();
  const { data = [], add, remove } = useMyAssessments();
  const [form, setForm] = useState<AssessmentInput>(EMPTY_RESULT);
  const [adding, setAdding] = useState(false);
  const set = <K extends keyof AssessmentInput>(k: K, v: AssessmentInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Section id="results" title={t('portal.workAbroad.results.title')} intro={t('portal.workAbroad.results.intro')}>
      {data.length === 0 && !adding && <p className="text-sm text-ink/60">{t('portal.workAbroad.results.none')}</p>}
      {data.length > 0 && (
        <ul className="divide-y divide-border rounded border border-border">
          {data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {a.title}
                  {a.score && <span className="ml-2 tabular-nums text-ink/70">{a.score}</span>}
                  {a.cefrLevel && <span className="ml-2 rounded bg-paper px-1.5 py-0.5 text-xs font-semibold text-ink/70">{a.cefrLevel}</span>}
                </p>
                <p className="text-xs text-ink/50">
                  {t(`overseas.provider.${a.provider}`)} · {fmtDate(a.takenOn, locale)}
                  {a.validUntil && ` · ${t('portal.workAbroad.results.validUntil', { date: fmtDate(a.validUntil, locale) })}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', a.verified ? 'bg-brand text-white' : 'bg-accent-light text-accent-dark')}>
                  {a.verified ? t('portal.workAbroad.results.verified') : t('portal.workAbroad.results.waiting')}
                </span>
                {!a.verified && (
                  <button type="button" onClick={() => remove.mutate(a.id)} disabled={remove.isPending} className="rounded p-1 text-ink/40 hover:text-danger" aria-label={t('portal.workAbroad.results.remove', { title: a.title })}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!adding ? (
        <Button size="sm" variant="secondary" className="mt-4" onClick={() => setAdding(true)}>
          {t('portal.workAbroad.results.add')}
        </Button>
      ) : (
        <form
          className="mt-4 space-y-3 rounded-lg border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(
              { ...form, score: form.score || null, cefrLevel: form.cefrLevel || null, validUntil: form.validUntil || null },
              {
                onSuccess: () => {
                  setForm(EMPTY_RESULT);
                  setAdding(false);
                },
              },
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="r-kind">{t('portal.workAbroad.results.kind')}</Label>
              <Select id="r-kind" value={form.kind} onChange={(e) => set('kind', e.target.value as AssessmentInput['kind'])}>
                {assessmentKindValues.map((k) => (
                  <option key={k} value={k}>
                    {t(`overseas.assessmentKind.${k}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="r-provider">{t('portal.workAbroad.results.provider')}</Label>
              <Select id="r-provider" value={form.provider} onChange={(e) => set('provider', e.target.value as AssessmentInput['provider'])}>
                {assessmentProviderValues
                  .filter((p) => p !== 'PLATFORM')
                  .map((p) => (
                    <option key={p} value={p}>
                      {t(`overseas.provider.${p}`)}
                    </option>
                  ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="r-title" required>
                {t('portal.workAbroad.results.testName')}
              </Label>
              <Input id="r-title" value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={ASSESSMENT_LIMITS.title} placeholder={t('portal.workAbroad.results.testNamePlaceholder')} required />
            </div>
            <div>
              <Label htmlFor="r-score">{t('portal.workAbroad.results.score')}</Label>
              <Input id="r-score" value={form.score ?? ''} onChange={(e) => set('score', e.target.value)} maxLength={ASSESSMENT_LIMITS.score} placeholder="6.5" />
            </div>
            <div>
              <Label htmlFor="r-cefr">{t('portal.workAbroad.results.cefr')}</Label>
              <Select id="r-cefr" value={form.cefrLevel ?? ''} onChange={(e) => set('cefrLevel', (e.target.value || null) as AssessmentInput['cefrLevel'])}>
                <option value="">{t('portal.workAbroad.results.cefrUnknown')}</option>
                {cefrLevelValues.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="r-taken" required>
                {t('portal.workAbroad.results.takenOn')}
              </Label>
              <Input id="r-taken" type="date" value={form.takenOn} onChange={(e) => set('takenOn', e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="r-valid">{t('portal.workAbroad.results.validUntilLabel')}</Label>
              <Input id="r-valid" type="date" value={form.validUntil ?? ''} onChange={(e) => set('validUntil', e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-ink/60">{t('portal.workAbroad.results.bringOriginal')}</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={add.isPending || !form.title.trim() || !form.takenOn}>
              {t('portal.workAbroad.results.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
          </div>
          {add.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorText(add.error, t('portal.saveError'))}
            </p>
          )}
        </form>
      )}
    </Section>
  );
}
