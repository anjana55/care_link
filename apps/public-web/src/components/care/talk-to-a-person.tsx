'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { TALK_CONTACT_METHODS, TALK_MESSAGE_MAX, type TalkAboutType, type TalkContactMethod } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useAskForAPerson, useMyTalkRequests } from '@/lib/hooks/use-talk';
import { useMyBookings, useMyRequests } from '@/lib/hooks/use-client-care';
import { useMyShifts } from '@/lib/hooks/use-caregiver-portal';
import { Button } from '@/components/ui/button';
import { Label, Select, Textarea } from '@/components/ui/input';

type Option = { value: string; label: string };

/** What a client can name: their open requests and live bookings. */
function useClientOptions(enabled: boolean): Option[] {
  const { t } = useTranslation();
  const requests = useMyRequests();
  const bookings = useMyBookings();
  return useMemo(() => {
    if (!enabled) return [];
    const reqs = (requests.data ?? []).filter((r) => r.status === 'NEW' || r.status === 'IN_PROGRESS').map((r) => ({ value: `REQUEST:${r.id}`, label: t('talk.aboutRequest', { ref: r.reference }) }));
    const books = (bookings.data ?? []).filter((b) => b.status === 'CONFIRMED' || b.status === 'DRAFT').map((b) => ({ value: `BOOKING:${b.id}`, label: t('talk.aboutBooking', { ref: b.reference, date: b.startDate }) }));
    return [...reqs, ...books];
  }, [enabled, requests.data, bookings.data, t]);
}

/** What a caregiver can name: their coming shifts. */
function useCaregiverOptions(enabled: boolean): Option[] {
  const { t } = useTranslation();
  const shifts = useMyShifts();
  return useMemo(() => {
    if (!enabled) return [];
    const now = Date.now();
    return (shifts.data ?? [])
      .filter((s) => s.status === 'SCHEDULED' && new Date(s.endsAt).getTime() > now)
      .slice(0, 20)
      .map((s) => ({ value: `SHIFT:${s.id}`, label: t('talk.aboutShift', { ref: s.bookingReference, date: s.startsAt.slice(0, 10) }) }));
  }, [enabled, shifts.data, t]);
}

/**
 * "Talk to a person": whatever the agents are doing, a client or caregiver
 * can always ask for a member of staff. Naming one of their requests,
 * bookings or shifts hands that case to staff straight away.
 */
export function TalkToAPerson({ role }: { role: 'CLIENT' | 'CAREGIVER' }) {
  const { t } = useTranslation();
  const ask = useAskForAPerson();
  const mine = useMyTalkRequests();
  const clientOptions = useClientOptions(role === 'CLIENT');
  const caregiverOptions = useCaregiverOptions(role === 'CAREGIVER');
  const options = role === 'CLIENT' ? clientOptions : caregiverOptions;
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState<TalkContactMethod>('CALL');
  const [about, setAbout] = useState('');
  const [sent, setSent] = useState(false);
  const error = ask.error instanceof ApiError && ask.error.message ? (Array.isArray(ask.error.message) ? ask.error.message[0] : ask.error.message) : ask.error ? t('care.actionError') : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const [type, id] = about ? about.split(':') : [];
    ask.mutate(
      { message: message.trim(), contact, ...(type && id ? { about: { type: type as TalkAboutType, id } } : {}) },
      {
        onSuccess: () => {
          setSent(true);
          setMessage('');
          setAbout('');
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-white p-5">
        <h1 className="text-lg font-semibold text-ink">{t('talk.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('talk.intro')}</p>
        {sent ? (
          <div className="mt-4 flex items-start gap-3 rounded-DEFAULT border border-brand/30 bg-brand-light p-3 text-sm text-brand-dark" role="status">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">{t('talk.sentTitle')}</p>
              <p>{t('talk.sentBody')}</p>
              <button type="button" className="mt-1 font-medium text-brand hover:underline" onClick={() => setSent(false)}>
                {t('talk.another')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4">
            <div>
              <Label htmlFor="talk-message" required>{t('talk.message')}</Label>
              <Textarea id="talk-message" rows={4} maxLength={TALK_MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>
            {options.length > 0 && (
              <div>
                <Label htmlFor="talk-about">{t('talk.about')}</Label>
                <Select id="talk-about" value={about} onChange={(e) => setAbout(e.target.value)}>
                  <option value="">{t('talk.aboutNone')}</option>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-ink/50">{t('talk.aboutHint')}</p>
              </div>
            )}
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">{t('talk.contact')}</legend>
              <div className="flex flex-wrap gap-2">
                {TALK_CONTACT_METHODS.map((m) => (
                  <label key={m} className={`cursor-pointer rounded-DEFAULT border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-brand/40 ${contact === m ? 'border-brand bg-brand-light text-brand-dark' : 'border-border text-ink/80'}`}>
                    <input type="radio" name="talk-contact" value={m} checked={contact === m} onChange={() => setContact(m)} className="sr-only" />
                    {t(`talk.contactMethods.${m}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={ask.isPending || message.trim().length < 5}>{t('talk.send')}</Button>
          </form>
        )}
      </section>
      {(mine.data ?? []).length > 0 && (
        <section className="rounded-lg border border-border bg-white p-5" aria-labelledby="talk-mine">
          <h2 id="talk-mine" className="text-base font-semibold text-ink">{t('talk.mine')}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {mine.data!.map((r) => (
              <li key={r.id} className="rounded-DEFAULT border border-border px-3 py-2">
                <p className="flex justify-between gap-3">
                  <span className="text-ink/60">{new Date(r.createdAt).toLocaleString()}</span>
                  <span className={r.status === 'OPEN' ? 'text-amber-700' : 'text-brand-dark'}>{t(`talk.status.${r.status}`)}</span>
                </p>
                <p className="mt-1 whitespace-pre-line text-ink">{r.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
