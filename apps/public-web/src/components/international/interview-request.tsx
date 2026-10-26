'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Heart, MessageSquare } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useCandidateActions, useEmployerAccount, useEmployerEnquiries, useShortlist } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';

/** Save / unsave a shared profile on the signed-in employer's shortlist. */
export function ShortlistButton({ slug }: { slug: string }) {
  const { t, locale } = useTranslation();
  const { data = [], toggle } = useShortlist(locale);
  const saved = data.some((c) => c.slug === slug);
  return (
    <Button type="button" variant="secondary" aria-pressed={saved} disabled={toggle.isPending} onClick={() => toggle.mutate({ slug, saved: !saved })}>
      <Heart className={saved ? 'h-4 w-4 fill-current text-danger' : 'h-4 w-4'} aria-hidden />
      {saved ? t('employer.shortlist.saved') : t('employer.shortlist.save')}
    </Button>
  );
}

/**
 * "I'd like to interview her", for a signed-in employer on a shared profile:
 * pick one of their open enquiries and add a note. Staff arrange it.
 */
export function InterviewRequestPanel({ slug, firstName }: { slug: string; firstName: string }) {
  const { t, locale } = useTranslation();
  const { data: account } = useEmployerAccount();
  const { data: enquiries = [] } = useEmployerEnquiries(locale);
  const { requestInterview } = useCandidateActions(locale);
  const open = enquiries.filter((e) => ['NEW', 'IN_PROGRESS', 'INTRODUCED'].includes(e.status));
  const [enquiryId, setEnquiryId] = useState('');
  const [message, setMessage] = useState('');
  const chosen = enquiryId || open[0]?.id || '';
  const already = enquiries.find((e) => e.id === chosen)?.candidates.find((c) => c.talent?.slug === slug && c.status !== 'NOT_PROCEEDING' && c.status !== 'PROPOSED');

  if (!account) return null;
  if (account.status !== 'VERIFIED') {
    return <p className="rounded-DEFAULT border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-accent-dark">{t('employer.request.notVerified')}</p>;
  }
  if (!open.length) {
    return (
      <p className="rounded-DEFAULT border border-border bg-paper px-4 py-3 text-sm text-ink/70">
        {t('employer.request.noEnquiry')}{' '}
        <Link href={`/employer/enquiries/new?talent=${encodeURIComponent(slug)}`} className="font-semibold text-brand hover:text-brand-dark">
          {t('employer.nav.newEnquiry')}
        </Link>
      </p>
    );
  }
  if (requestInterview.isSuccess) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-DEFAULT border border-brand/30 bg-brand-light/50 px-4 py-3 text-sm text-brand-dark">
        <Check className="h-4 w-4" aria-hidden />
        {t('employer.request.sent', { name: firstName })}
      </p>
    );
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-paper p-4"
      onSubmit={(e) => {
        e.preventDefault();
        requestInterview.mutate({ enquiryId: chosen, talentSlug: slug, message: message.trim() || undefined });
      }}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <MessageSquare className="h-4 w-4 text-brand" aria-hidden />
        {t('employer.request.title', { name: firstName })}
      </p>
      {open.length > 1 && (
        <label className="block text-xs text-ink/60">
          {t('employer.request.forEnquiry')}
          <Select className="mt-1" value={chosen} onChange={(e) => setEnquiryId(e.target.value)}>
            {open.map((e) => (
              <option key={e.id} value={e.id}>
                {e.reference} · {t('employer.overview.roles', { count: e.rolesCount })}
              </option>
            ))}
          </Select>
        </label>
      )}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder={t('employer.overview.messagePlaceholder')}
        aria-label={t('employer.overview.messageLabel')}
        className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
      />
      {already ? (
        <p className="text-sm text-ink/60">{t('employer.request.already')}</p>
      ) : (
        <Button type="submit" disabled={requestInterview.isPending}>
          {t('employer.overview.requestInterview')}
        </Button>
      )}
      {requestInterview.isError && (
        <p role="alert" className="text-xs text-danger">
          {requestInterview.error instanceof ApiError ? requestInterview.error.message : t('portal.saveError')}
        </p>
      )}
      <p className="text-xs text-ink/50">{t('employer.request.hint')}</p>
    </form>
  );
}
