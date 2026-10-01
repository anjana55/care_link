'use client';

import { CheckCircle2, ShieldCheck, Globe2, ArrowRight } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

export function HowItWorksSection() {
  const { t } = useTranslation();
  const steps = [
    { title: t('sections.howItWorksStep1Title'), body: t('sections.howItWorksStep1Body') },
    { title: t('sections.howItWorksStep2Title'), body: t('sections.howItWorksStep2Body') },
    { title: t('sections.howItWorksStep3Title'), body: t('sections.howItWorksStep3Body') },
  ];
  return (
    <section className="mx-auto max-w-4xl px-4 py-10">
      <h2 className="text-center text-xl font-semibold text-ink">{t('sections.howItWorksTitle')}</h2>
      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        {steps.map((step, i) => (
          <div key={step.title} className="text-center">
            <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
              {i + 1}
            </div>
            <h3 className="text-sm font-semibold text-ink">{step.title}</h3>
            <p className="mt-1 text-sm text-ink/60">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function TrustSection() {
  const { t } = useTranslation();
  return (
    <section className="bg-brand-light/40 py-10">
      <div className="mx-auto grid max-w-4xl gap-6 px-4 sm:grid-cols-2">
        <div className="flex gap-3">
          <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-brand" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-ink">{t('sections.verifiedTitle')}</h3>
            <p className="mt-1 text-sm text-ink/60">{t('sections.verifiedBody')}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <ShieldCheck className="h-6 w-6 flex-shrink-0 text-brand" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-ink">{t('sections.safetyTitle')}</h3>
            <p className="mt-1 text-sm text-ink/60">{t('sections.safetyBody')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function MultilingualSection() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex max-w-4xl items-center justify-center gap-3 px-4 py-8 text-center">
      <Globe2 className="h-5 w-5 text-ink/40" aria-hidden />
      <p className="text-sm text-ink/60">
        <span className="font-medium text-ink">{t('sections.multilingualTitle')}.</span> {t('sections.multilingualBody')}
      </p>
    </section>
  );
}

export function CallToActionSection({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="bg-brand py-12 text-center text-white">
      <h2 className="text-xl font-semibold">{t('sections.ctaTitle')}</h2>
      <p className="mt-2 text-sm text-white/80">{t('sections.ctaBody')}</p>
      <button
        type="button"
        onClick={onStart}
        className="mt-5 inline-flex items-center gap-2 rounded-DEFAULT bg-white px-6 py-2.5 text-sm font-semibold text-brand hover:bg-white/90"
      >
        {t('sections.ctaButton')} <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </section>
  );
}
