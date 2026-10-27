'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Plane, UserPlus } from 'lucide-react';
import { candidateStatusValues, type CandidateStatus, type EmployerEnquiry, type StaffCandidate } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useEnquiryCandidates, useProposeCandidate, useTalentPool, useUpdateCandidate } from '@/lib/hooks/use-international';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ReadinessBar } from './readiness-bar';

const STATUS_STYLES: Record<CandidateStatus, string> = {
  PROPOSED: 'bg-accent-light text-accent',
  INTERVIEW_REQUESTED: 'bg-accent text-white',
  INTERVIEW_SCHEDULED: 'bg-brand-light text-brand-dark',
  SELECTED: 'bg-brand text-white',
  PLACED: 'bg-brand-dark text-white',
  NOT_PROCEEDING: 'bg-ink/10 text-ink/60',
};

/** datetime-local value for an ISO time, in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The caregivers on an enquiry. Staff put caregivers forward from the talent
 * pool (only those with a live shared profile - the employer can see nothing
 * else), arrange interviews, and record how each one ends.
 */
export function CandidatesCard({ enquiry }: { enquiry: EmployerEnquiry }) {
  const { t } = useTranslation();
  const { data: candidates = [], isLoading } = useEnquiryCandidates(enquiry.id);
  const open = ['NEW', 'IN_PROGRESS', 'INTRODUCED'].includes(enquiry.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('international.candidates.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-ink/60">{t('international.candidates.hint')}</p>
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {!isLoading && candidates.length === 0 && <p className="text-sm text-ink/50">{t('international.candidates.empty')}</p>}
        <div className="space-y-3">
          {candidates.map((c) => (
            <CandidateEditor key={c.id} enquiryId={enquiry.id} candidate={c} />
          ))}
        </div>
        {open && <ProposeForm enquiry={enquiry} existing={candidates.map((c) => c.caregiverId)} />}
      </CardContent>
    </Card>
  );
}

function CandidateEditor({ enquiryId, candidate: c }: { enquiryId: string; candidate: StaffCandidate }) {
  const { t } = useTranslation();
  const update = useUpdateCandidate(enquiryId);
  const [status, setStatus] = useState<CandidateStatus>(c.status);
  const [interviewAt, setInterviewAt] = useState(toLocalInput(c.interviewAt));
  const [messageToEmployer, setMessageToEmployer] = useState(c.messageToEmployer ?? '');
  const [staffNote, setStaffNote] = useState(c.staffNote ?? '');
  const [saved, setSaved] = useState(false);
  const dirty =
    status !== c.status || interviewAt !== toLocalInput(c.interviewAt) || messageToEmployer !== (c.messageToEmployer ?? '') || staffNote !== (c.staffNote ?? '');

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href={`/caregivers/${c.caregiverId}`} className="font-medium text-brand-dark hover:underline">
            {c.fullName}
          </Link>
          <span className="ml-2 text-xs tabular-nums text-ink/50">{c.registrationNumber}</span>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink/50">
            <span>{t(`international.candidates.source.${c.source}`)}</span>
            {c.profileLive && c.talentSlug ? (
              <a href={`/talent/${c.talentSlug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                <ExternalLink size={11} aria-hidden />
                {t('international.pool.live')}
              </a>
            ) : (
              <span className="text-danger">{t('international.candidates.notLive')}</span>
            )}
          </div>
        </div>
        <span className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS_STYLES[c.status])}>{t(`international.candidates.status.${c.status}`)}</span>
      </div>
      {c.employerMessage && (
        <p className="mt-2 rounded bg-paper px-3 py-2 text-sm text-ink/80">
          <span className="font-semibold">{t('international.candidates.employerSaid')}</span> {c.employerMessage}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`st-${c.id}`}>{t('international.enquiries.status')}</Label>
          <Select
            id={`st-${c.id}`}
            value={status}
            onChange={(e) => {
              setSaved(false);
              setStatus(e.target.value as CandidateStatus);
            }}
          >
            {candidateStatusValues.map((s) => (
              <option key={s} value={s}>
                {t(`international.candidates.status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`iv-${c.id}`}>{t('international.candidates.interviewAt')}</Label>
          <Input
            id={`iv-${c.id}`}
            type="datetime-local"
            value={interviewAt}
            onChange={(e) => {
              setSaved(false);
              setInterviewAt(e.target.value);
            }}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`me-${c.id}`}>{t('international.candidates.messageToEmployer')}</Label>
          <Textarea id={`me-${c.id}`} rows={2} maxLength={1000} value={messageToEmployer} onChange={(e) => (setSaved(false), setMessageToEmployer(e.target.value))} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`sn-${c.id}`}>{t('international.detail.note')}</Label>
          <Textarea id={`sn-${c.id}`} rows={2} maxLength={1000} value={staffNote} onChange={(e) => (setSaved(false), setStaffNote(e.target.value))} />
        </div>
      </div>
      {status === 'PLACED' && c.status !== 'PLACED' && <p className="mt-2 text-xs text-ink/60">{t('international.candidates.placedHint')}</p>}
      {c.placementId && (
        <Link href={`/international/placements/${c.placementId}`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-dark hover:underline">
          <Plane size={12} aria-hidden />
          {t('international.candidates.openPlacement')}
        </Link>
      )}
      {update.isError && <p className="mt-2 text-xs text-danger">{update.error instanceof Error ? update.error.message : t('common.actionFailed')}</p>}
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          disabled={!dirty || update.isPending}
          onClick={() =>
            update.mutate(
              {
                id: c.id,
                status,
                interviewAt: interviewAt ? new Date(interviewAt).toISOString() : null,
                messageToEmployer: messageToEmployer.trim() || null,
                staffNote: staffNote.trim() || null,
              },
              { onSuccess: () => setSaved(true) },
            )
          }
        >
          {t('common.save')}
        </Button>
        {saved && <span className="text-xs text-brand-dark">{t('international.detail.saved')}</span>}
      </div>
    </div>
  );
}

function ProposeForm({ enquiry, existing }: { enquiry: EmployerEnquiry; existing: string[] }) {
  const { t } = useTranslation();
  const [sameCountry, setSameCountry] = useState(true);
  const { data: pool = [], isLoading } = useTalentPool({ country: sameCountry ? enquiry.country : undefined });
  const propose = useProposeCandidate(enquiry.id);
  const [caregiverId, setCaregiverId] = useState('');
  const [message, setMessage] = useState('');
  const options = useMemo(() => pool.filter((p) => p.profileLive && !existing.includes(p.caregiverId)), [pool, existing]);
  const chosen = options.find((o) => o.caregiverId === caregiverId);

  return (
    <form
      className="space-y-3 rounded-lg border border-dashed border-brand/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!caregiverId) return;
        propose.mutate({ caregiverId, messageToEmployer: message.trim() || undefined }, { onSuccess: () => (setCaregiverId(''), setMessage('')) });
      }}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <UserPlus size={16} aria-hidden />
        {t('international.candidates.propose')}
      </h3>
      <label className="flex items-center gap-2 text-xs text-ink/70">
        <input type="checkbox" checked={sameCountry} onChange={(e) => setSameCountry(e.target.checked)} />
        {t('international.candidates.sameCountry')}
      </label>
      <Select value={caregiverId} onChange={(e) => setCaregiverId(e.target.value)} aria-label={t('international.candidates.choose')}>
        <option value="">{isLoading ? t('common.loading') : options.length ? t('international.candidates.choose') : t('international.candidates.noneAvailable')}</option>
        {options.map((o) => (
          <option key={o.caregiverId} value={o.caregiverId}>
            {o.fullName} ({o.registrationNumber}) · {o.readiness.done}/{o.readiness.total}
          </option>
        ))}
      </Select>
      {chosen && <ReadinessBar report={chosen.readiness} />}
      <Textarea rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('international.candidates.messagePlaceholder')} />
      {propose.isError && <p className="text-xs text-danger">{propose.error instanceof Error ? propose.error.message : t('common.actionFailed')}</p>}
      <Button type="submit" size="sm" disabled={!caregiverId || propose.isPending}>
        {t('international.candidates.proposeButton')}
      </Button>
      <p className="text-xs text-ink/50">{t('international.candidates.proposeHint')}</p>
    </form>
  );
}
