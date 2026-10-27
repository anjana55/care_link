'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useEmployerAccount, useEmployerEnquiries, useOfferActions } from '@/lib/hooks/use-international';
import { OfferForm } from '@/components/international/offer-form';

/** A new job offer to one of the caregivers on the employer's enquiries. Staff read it before the caregiver does. */
function NewOfferPage() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const candidateId = useSearchParams().get('candidate');
  const { data: account } = useEmployerAccount();
  const { data: enquiries = [], isLoading } = useEmployerEnquiries(locale);
  const { make } = useOfferActions();
  const enquiry = enquiries.find((e) => e.candidates.some((c) => c.id === candidateId));
  const candidate = enquiry?.candidates.find((c) => c.id === candidateId);

  if (isLoading || !account) return <div className="h-96 animate-pulse rounded-lg bg-white" aria-hidden />;
  if (!enquiry || !candidate?.talent) {
    return (
      <div className="rounded-lg border border-border bg-white p-8 text-center">
        <p className="text-sm text-ink/60">{t('employer.offers.noCandidate')}</p>
        <Link href="/employer" className="mt-3 inline-block text-sm font-semibold text-brand">
          {t('employer.nav.overview')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/employer" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-brand-dark">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t('employer.nav.overview')}
      </Link>
      <div>
        <h1 className="text-xl font-bold text-ink">{t('employer.offers.newTitle', { name: candidate.talent.firstName })}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('employer.offers.newIntro', { reference: enquiry.reference })}</p>
      </div>
      <div className="rounded-lg border border-border bg-white p-5 sm:p-6">
        <OfferForm
          initial={{ country: enquiry.country as never }}
          organisationName={account.organisationName}
          talentFirstName={candidate.talent.firstName}
          pending={make.isPending}
          error={make.error}
          submitLabel={t('employer.offers.signSend')}
          onSubmit={(body) => make.mutate({ candidateId: candidate.id, body }, { onSuccess: (o) => router.push(`/employer/offers/${o.id}`) })}
        />
      </div>
    </div>
  );
}

export default function NewOfferRoute() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-white" aria-hidden />}>
      <NewOfferPage />
    </Suspense>
  );
}
