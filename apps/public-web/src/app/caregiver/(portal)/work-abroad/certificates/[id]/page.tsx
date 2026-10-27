'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { fmtDate } from '@/lib/colombo-time';
import { useMyTraining, useTrainingProgrammes } from '@/lib/hooks/use-international';
import { useBranding } from '@/lib/branding/provider';
import { BrandMark } from '@/components/layout/brand-mark';

/**
 * The caregiver's certificate of completion, to print or save as PDF. The
 * certificate itself is in English whatever language the page is in: it is
 * read by employers abroad. It says "completed", never "qualified" or
 * "accredited" - the programmes are the platform's own. The check address
 * lets an employer confirm it is genuine.
 */
export default function CertificatePage() {
  const { t, locale } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data: mine = [], isLoading } = useMyTraining();
  const { data: programmes = [] } = useTrainingProgrammes(locale);
  const branding = useBranding();
  const enrolment = mine.find((e) => e.id === id);
  const cert = enrolment?.certificate;
  const programme = programmes.find((p) => p.id === enrolment?.programmeId);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const checkUrl = cert ? `${origin}/verify/${cert.verifyCode}` : '';

  if (isLoading) return <div className="h-96 animate-pulse rounded-lg bg-white" aria-hidden />;
  if (!cert || cert.revoked) {
    return (
      <div className="rounded-lg border border-border bg-white p-8 text-center">
        <p className="text-sm text-ink/60">{t('portal.workAbroad.certificate.missing')}</p>
        <Link href="/caregiver/work-abroad#training" className="mt-3 inline-block text-sm font-semibold text-brand">
          {t('portal.workAbroad.certificate.back')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/caregiver/work-abroad#training" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/70 hover:text-brand-dark">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('portal.workAbroad.certificate.back')}
        </Link>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
          <Printer className="h-4 w-4" aria-hidden />
          {t('portal.workAbroad.certificate.print')}
        </button>
        <p className="w-full text-xs text-ink/60">{t('portal.workAbroad.certificate.englishNote')}</p>
      </div>

      <article lang="en" className="mx-auto aspect-[1.414/1] w-full max-w-3xl border-[10px] border-double border-brand/60 bg-white p-8 text-center shadow-sm sm:p-12 print:shadow-none">
        <div className="flex justify-center">
          <BrandMark />
        </div>
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.25em] text-ink/50">Certificate of completion</p>
        <p className="mt-6 text-sm text-ink/60">This is to certify that</p>
        <p className="mt-2 font-serif text-3xl italic text-ink sm:text-4xl">{cert.holderName}</p>
        <p className="mt-4 text-sm text-ink/60">has completed the programme</p>
        <p className="mt-2 text-xl font-semibold text-ink">{cert.programmeTitle}</p>
        {programme?.duration && <p className="mt-1 text-sm text-ink/60">{programme.duration}</p>}
        {cert.score !== null && <p className="mt-3 text-sm text-ink/70">Final assessment score: {cert.score} / 100</p>}
        <div className="mt-10 grid grid-cols-2 gap-6 text-left text-xs text-ink/60">
          <div>
            <p className="font-semibold uppercase tracking-wide">Issued</p>
            <p className="mt-1 text-sm text-ink">{fmtDate(cert.issuedOn, 'en')}</p>
          </div>
          <div className="text-right">
            <p className="font-semibold uppercase tracking-wide">Certificate number</p>
            <p className="mt-1 font-mono text-sm text-ink">{cert.number}</p>
          </div>
        </div>
        <p className="mt-8 border-t border-border pt-3 text-[11px] text-ink/50">
          Check this certificate at {checkUrl}
          <br />
          A programme run by {branding.companyName}. This certificate records completion; it is not an accredited qualification.
        </p>
      </article>
    </div>
  );
}
