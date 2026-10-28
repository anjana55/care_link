'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertOctagon, ChevronDown, ChevronRight, Phone } from 'lucide-react';
import { EMERGENCY_NUMBERS, type CountryCode, type StaffWelfareReport, type WelfareSeverity } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useWelfareActions, useWelfareReports } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DeleteRecordButton } from '@/components/overseas-admin/delete-record-button';
import { countryName } from './shared';

export const SEVERITY_STYLES: Record<WelfareSeverity, string> = {
  SOS: 'bg-danger text-white',
  URGENT: 'bg-danger/15 text-danger',
  CONCERN: 'bg-accent-light text-accent',
  QUESTION: 'bg-paper text-ink/70',
};

const FILTERS = ['open', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'all'] as const;

const when = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : `${locale}-LK`, { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Caregivers abroad telling us something is wrong. SOS and urgent first,
 * then the longest waiting. Each report shows how to reach the caregiver
 * right now - phone and address abroad, and their emergency contact at home.
 * Never shown to the employer.
 */
export function WelfareTab() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('open');
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('report');
    if (id) {
      setFocus(id);
      setFilter('all');
    }
  }, []);
  const { data = [], isLoading } = useWelfareReports(filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/60">{t('international.welfare.hint')}</p>
        <Select className="sm:w-56" value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])} aria-label={t('international.welfare.filter')}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`international.welfare.filters.${f}`)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && data.length === 0 && <p className="rounded-lg border border-dashed border-border bg-white py-10 text-center text-sm text-ink/50">{t('international.welfare.empty')}</p>}
      <ul className="space-y-2">
        {data.map((r) => (
          <ReportRow key={`${r.id}-${focus}`} report={r} initiallyOpen={r.id === focus || (r.status === 'OPEN' && (r.severity === 'SOS' || r.severity === 'URGENT'))} />
        ))}
      </ul>
    </div>
  );
}

function ReportRow({ report: r, initiallyOpen }: { report: StaffWelfareReport; initiallyOpen: boolean }) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const [reply, setReply] = useState('');
  const { reply: send, setStatus } = useWelfareActions();
  const emergency = (r.severity === 'SOS' || r.severity === 'URGENT') && r.status !== 'RESOLVED';
  const local = EMERGENCY_NUMBERS[r.country as CountryCode];

  return (
    <li className={cn('rounded-lg border bg-white', emergency && r.status === 'OPEN' ? 'border-danger' : 'border-border')}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        <span className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold', SEVERITY_STYLES[r.severity])}>
          {r.severity === 'SOS' && <AlertOctagon size={12} aria-hidden />}
          {t(`international.welfare.severity.${r.severity}`)}
        </span>
        <span className="font-medium text-ink">{r.fullName}</span>
        <span className="text-sm text-ink/70">
          {countryName(r.country, locale)} · {t(`international.welfare.category.${r.category}`)}
        </span>
        <span className="text-xs tabular-nums text-ink/50">
          {r.reference} · {when(r.createdAt, locale)}
        </span>
        <span className="ml-auto text-xs font-medium text-ink/60">{t(`international.welfare.status.${r.status}`)}</span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-border px-4 py-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-2">
            {r.messages.map((m) => (
              <div key={m.id} className={cn('max-w-[90%] rounded-lg px-3 py-2 text-sm', m.from === 'STAFF' ? 'ml-auto bg-brand-light' : 'bg-paper')}>
                <p className="text-xs font-semibold text-ink/60">
                  {m.from === 'STAFF' ? t('international.welfare.us') : r.fullName} · {when(m.createdAt, locale)}
                </p>
                <p className="whitespace-pre-line text-ink">{m.body}</p>
              </div>
            ))}
            <form
              className="space-y-2 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                send.mutate({ id: r.id, body: reply.trim() }, { onSuccess: () => setReply('') });
              }}
            >
              <Textarea rows={2} maxLength={3000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('international.welfare.replyPlaceholder')} aria-label={t('international.welfare.reply')} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" type="submit" disabled={!reply.trim() || send.isPending}>
                  {t('international.welfare.send')}
                </Button>
                {r.status === 'OPEN' && (
                  <Button size="sm" type="button" variant="secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: 'ACKNOWLEDGED' })}>
                    {t('international.welfare.acknowledge')}
                  </Button>
                )}
                {r.status !== 'RESOLVED' ? (
                  <Button size="sm" type="button" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: 'RESOLVED' })}>
                    {t('international.welfare.resolve')}
                  </Button>
                ) : (
                  <Button size="sm" type="button" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: 'ACKNOWLEDGED' })}>
                    {t('international.welfare.reopen')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-ink/50">{t('international.welfare.replyHint')}</p>
              {(send.isError || setStatus.isError) && <p className="text-xs text-danger">{t('common.actionFailed')}</p>}
            </form>
            {r.status === 'RESOLVED' && (
              <div className="flex justify-end">
                <DeleteRecordButton path={`/international/welfare/${r.id}`} title={t('overseasAdmin.welfare.deleteTitle', { reference: r.reference })} body={t('overseasAdmin.welfare.deleteBody')} />
              </div>
            )}
          </div>
          <aside className="space-y-3 rounded bg-paper p-3 text-sm">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink/60">
              <Phone size={13} aria-hidden />
              {t('international.welfare.reach')}
            </h4>
            <dl className="space-y-2">
              <div>
                <dt className="text-xs text-ink/50">{t('international.welfare.phoneAbroad')}</dt>
                <dd className="font-medium text-ink">{r.contact.phoneAbroad ? <a href={`tel:${r.contact.phoneAbroad.replace(/[^+\d]/g, '')}`} className="text-brand-dark hover:underline">{r.contact.phoneAbroad}</a> : '-'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink/50">{t('international.welfare.addressAbroad')}</dt>
                <dd className="whitespace-pre-line text-ink">{r.contact.addressAbroad ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink/50">{t('international.welfare.homeContact')}</dt>
                <dd className="text-ink">
                  {r.contact.emergencyContactName ?? '-'}
                  {r.contact.emergencyContactRelationship && <span className="text-ink/60"> ({r.contact.emergencyContactRelationship})</span>}
                  {r.contact.emergencyContactNumber && <span className="block tabular-nums">{r.contact.emergencyContactNumber}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink/50">{t('international.welfare.employer')}</dt>
                <dd className="text-ink">{r.organisationName}</dd>
              </div>
              {local && (
                <div>
                  <dt className="text-xs text-ink/50">{t('international.welfare.localEmergency')}</dt>
                  <dd className="text-ink">{t('international.welfare.localNumbers', { police: local.police, ambulance: local.ambulance })}</dd>
                </div>
              )}
            </dl>
            <div className="flex flex-col gap-1 text-xs">
              <Link href={`/international/placements/${r.placementId}`} className="text-brand-dark hover:underline">
                {t('international.welfare.openPlacement')}
              </Link>
              <Link href={`/caregivers/${r.caregiverId}`} className="text-brand-dark hover:underline">
                {t('international.welfare.openCaregiver')}
              </Link>
            </div>
          </aside>
        </div>
      )}
    </li>
  );
}
