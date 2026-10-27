'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/provider';
import { useInterviewRequests, useStaffInterviews } from '@/lib/hooks/use-international';
import { countryName } from './shared';
import { fmtIn } from './interviews-panel';

/** Employers waiting for staff to arrange an interview, oldest first; then the interviews already booked. */
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
      <UpcomingInterviews />
    </div>
  );
}

function UpcomingInterviews() {
  const { t, locale } = useTranslation();
  const { data = [], isLoading } = useStaffInterviews('upcoming');
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-semibold text-ink">{t('international.interviews.upcoming')}</h2>
      {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && data.length === 0 && <p className="text-sm text-ink/50">{t('international.interviews.noneUpcoming')}</p>}
      {data.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-white">
          {data.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium tabular-nums text-ink">{fmtIn(i.scheduledAt, 'Asia/Colombo', locale)}</span>
              <Link href={`/caregivers/${i.caregiverId}`} className="text-brand-dark hover:underline">
                {i.fullName}
              </Link>
              <span className="text-ink/70">{i.organisationName}</span>
              <span className="text-xs text-ink/50">
                {t('international.interviews.round', { n: i.round })} · {t(`international.interviews.mode.${i.mode}`)}
              </span>
              <Link href={`/international/${i.enquiryId}`} className="ml-auto text-xs tabular-nums text-brand-dark hover:underline">
                {i.enquiryReference}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
