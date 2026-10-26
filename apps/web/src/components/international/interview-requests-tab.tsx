'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/provider';
import { useInterviewRequests } from '@/lib/hooks/use-international';
import { countryName } from './shared';

/** Employers waiting for staff to arrange an interview, oldest first. */
export function InterviewRequestsTab() {
  const { t, locale } = useTranslation();
  const { data = [], isLoading } = useInterviewRequests();
  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-ink/60">{t('international.interviews.hint')}</p>
      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('international.enquiries.reference')}</th>
              <th className="px-4 py-3 font-medium">{t('international.enquiries.employer')}</th>
              <th className="px-4 py-3 font-medium">{t('international.pool.caregiver')}</th>
              <th className="px-4 py-3 font-medium">{t('international.interviews.note')}</th>
              <th className="px-4 py-3 font-medium">{t('international.interviews.asked')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink/50">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!isLoading && data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink/50">
                  {t('international.interviews.empty')}
                </td>
              </tr>
            )}
            {data.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/international/${c.enquiry.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                    {c.enquiry.reference}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {c.enquiry.organisationName}
                  <div className="text-xs text-ink/50">{countryName(c.enquiry.country, locale)}</div>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/caregivers/${c.caregiverId}`} className="text-brand-dark hover:underline">
                    {c.fullName}
                  </Link>
                  <div className="text-xs tabular-nums text-ink/50">{c.registrationNumber}</div>
                  {!c.profileLive && <div className="text-xs text-danger">{t('international.candidates.notLive')}</div>}
                </td>
                <td className="max-w-xs px-4 py-3 text-ink/70">{c.employerMessage ?? '—'}</td>
                <td className="px-4 py-3 text-ink/70">{new Date(c.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
