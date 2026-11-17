'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StaffTalkRequest } from '@care-platform/shared';
import { api, ApiError } from '@/lib/api/client';
import { useTranslation } from '@/lib/i18n/provider';
import { fmtDateTime } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { PhoneLink } from '@/components/clients/contact-links';

/**
 * People waiting: clients and caregivers who asked to talk to a person. The
 * longest waiting first. Staff reach them the way they asked and mark it
 * handled; a case they named stays with staff until handed back on it.
 */
export default function PeopleWaitingPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'OPEN' | 'HANDLED'>('OPEN');
  const { data, isLoading } = useQuery({ queryKey: ['talk-requests', tab], queryFn: () => api.get<StaffTalkRequest[]>(`/talk-requests?status=${tab}`) });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold text-ink">{t('peopleWaiting.title')}</h1>
      <p className="mt-1 text-sm text-ink/60">{t('peopleWaiting.subtitle')}</p>
      <div className="mt-4 flex gap-2" role="tablist">
        {(['OPEN', 'HANDLED'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`rounded-DEFAULT px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-brand text-white' : 'bg-white text-ink/70 ring-1 ring-border'}`} onClick={() => setTab(k)}>
            {t(k === 'OPEN' ? 'peopleWaiting.openTab' : 'peopleWaiting.handledTab')}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {data && data.length === 0 && <p className="text-sm text-ink/50">{t('peopleWaiting.none')}</p>}
        {data?.map((r) => <Row key={r.id} r={r} />)}
      </div>
    </div>
  );
}

function Row({ r }: { r: StaffTalkRequest }) {
  const { t, locale } = useTranslation();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const handle = useMutation({
    mutationFn: () => api.post<StaffTalkRequest>(`/talk-requests/${r.id}/handled`, note.trim() ? { note: note.trim() } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talk-requests'] });
      qc.invalidateQueries({ queryKey: ['insights'] });
    },
  });
  const personHref = r.person.patientId ? `/clients/${r.person.patientId}` : r.person.caregiverId ? `/caregivers/${r.person.caregiverId}` : null;
  const aboutHref = r.about?.requestId ? `/requests/${r.about.requestId}` : r.about?.bookingId ? `/bookings/${r.about.bookingId}` : null;
  const error = handle.error instanceof ApiError && handle.error.message ? String(handle.error.message) : null;

  return (
    <article className="rounded-lg border border-border bg-white p-4" data-testid="talk-request">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          {personHref ? <Link href={personHref} className="font-medium text-brand-dark hover:underline">{r.person.name}</Link> : <span className="font-medium">{r.person.name}</span>}
          <span className="text-ink/50"> · {t(r.role === 'CLIENT' ? 'peopleWaiting.client' : 'peopleWaiting.caregiver')}</span>
          {r.about && (
            <span className="text-ink/50">
              {' · '}
              {aboutHref ? <Link href={aboutHref} className="hover:underline">{t('peopleWaiting.about', { ref: r.about.reference })}</Link> : t('peopleWaiting.about', { ref: r.about.reference })}
            </span>
          )}
        </p>
        <p className="text-xs text-ink/50">{t('peopleWaiting.waitingSince', { when: fmtDateTime(r.createdAt, locale) })}</p>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm text-ink">{r.message}</p>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium text-accent">{t(`peopleWaiting.contact.${r.contact}`)}</span>
        {r.person.phone && <PhoneLink phone={r.person.phone} whatsapp />}
        {r.person.email && <a href={`mailto:${r.person.email}`} className="text-brand hover:underline">{r.person.email}</a>}
      </p>
      {r.status === 'OPEN' ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handle.mutate();
          }}
        >
          <div className="min-w-[16rem] flex-1">
            <Label htmlFor={`note-${r.id}`}>{t('peopleWaiting.note')}</Label>
            <Input id={`note-${r.id}`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={handle.isPending}>{t('peopleWaiting.handle')}</Button>
          {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
        </form>
      ) : (
        <p className="mt-2 text-xs text-ink/60">
          {t('peopleWaiting.handledBy', { name: r.handledByName ?? '-', when: r.handledAt ? fmtDateTime(r.handledAt, locale) : '' })}
          {r.staffNote && <span className="block text-ink/80">“{r.staffNote}”</span>}
        </p>
      )}
    </article>
  );
}
