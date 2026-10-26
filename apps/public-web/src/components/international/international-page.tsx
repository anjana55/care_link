'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, BadgeCheck, GraduationCap, HandCoins, Handshake, Languages, ShieldCheck, Users } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { useInternationalSummary, useIsEmployer, useTalentDirectory, useTalentProfile } from '@/lib/hooks/use-international';
import { useMetaLanguages } from '@/lib/hooks/use-public-search';
import { EmployerEnquiryForm } from './employer-enquiry-form';
import { TalentCard } from './talent-card';
import { Select } from '@/components/ui/input';

/**
 * "Hire from Sri Lanka": the page for overseas employers - agencies, care
 * homes, hospitals and families abroad looking for caregivers.
 *
 * Staff-mediated end to end. Employers see shared profiles caregivers chose to
 * publish and send an enquiry; they never get a caregiver's contact details,
 * and staff make every introduction. The fee model is said plainly on the
 * page: the employer pays a placement fee when a caregiver starts work, and
 * caregivers are never charged one.
 */
export function InternationalPage() {
  const { t, locale } = useTranslation();
  const params = useSearchParams();
  const countries = useCountryNames();
  const { data: summary } = useInternationalSummary();
  const [page, setPage] = useState(1);
  const [country, setCountry] = useState('');
  const [languageId, setLanguageId] = useState('');
  const [training, setTraining] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const { data: languages = [] } = useMetaLanguages();
  const employer = useIsEmployer();
  const { data: talent, isLoading: talentLoading } = useTalentDirectory(locale, page, {
    country: country || undefined,
    languageId: languageId || undefined,
    training: training || undefined,
    verifiedOnly,
  });
  const filter = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  // Arrived from a shared profile's "Ask about her" button.
  const [talentSlug, setTalentSlug] = useState<string | null>(null);
  useEffect(() => setTalentSlug(params.get('talent')), [params]);
  const { data: asked } = useTalentProfile(talentSlug, locale);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (asked) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [asked]);

  const steps = [1, 2, 3, 4].map((n) => ({ title: t(`international.steps.step${n}Title`), body: t(`international.steps.step${n}Body`) }));
  const reasons = [
    { icon: ShieldCheck, key: 'verified' },
    { icon: GraduationCap, key: 'trained' },
    { icon: Handshake, key: 'mediated' },
    { icon: HandCoins, key: 'ethical' },
  ] as const;
  const faqs = ['fee', 'workerFees', 'visas', 'contact', 'languages'] as const;
  const stats = summary
    ? [
        { value: summary.openToOverseas, label: t('international.stats.open'), icon: Users },
        { value: summary.sharedProfiles, label: t('international.stats.profiles'), icon: BadgeCheck },
        { value: summary.trainingCompletions, label: t('international.stats.training'), icon: Languages },
      ]
    : [];

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="full" />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-brand-dark text-white">
          <div className="absolute inset-0 bg-gradient-to-br from-brand via-brand-dark to-accent opacity-90" aria-hidden />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.2fr_.8fr] lg:items-center">
            <div>
              <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide">{t('international.pill')}</span>
              <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">{t('international.heroTitle')}</h1>
              <p className="mt-4 max-w-xl text-white/85">{t('international.heroBody')}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#enquiry" className="inline-flex items-center gap-2 rounded bg-white px-5 py-2.5 text-sm font-semibold text-brand-dark transition-colors hover:bg-white/90">
                  {t('international.ctaEnquire')}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
                <a href="#talent" className="inline-flex items-center rounded border border-white/40 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                  {t('international.ctaBrowse')}
                </a>
              </div>
              <p className="mt-5 text-sm text-white/80">
                {employer ? (
                  <Link href="/employer" className="font-semibold text-white underline-offset-2 hover:underline">
                    {t('international.account.open')}
                  </Link>
                ) : (
                  <>
                    {t('international.account.prompt')}{' '}
                    <Link href="/employer/register" className="font-semibold text-white underline-offset-2 hover:underline">
                      {t('international.account.create')}
                    </Link>{' '}
                    ·{' '}
                    <Link href="/employer/login" className="font-semibold text-white underline-offset-2 hover:underline">
                      {t('nav.signIn')}
                    </Link>
                  </>
                )}
              </p>
            </div>
            {stats.length > 0 && (
              <dl className="grid grid-cols-3 gap-3 lg:grid-cols-1">
                {stats.map((s) => (
                  <div key={s.label} className="rounded-lg bg-white/10 p-4 backdrop-blur">
                    <s.icon className="h-5 w-5 text-white/70" aria-hidden />
                    <dd className="mt-2 text-2xl font-bold sm:text-3xl">{s.value}</dd>
                    <dt className="mt-0.5 text-xs text-white/75 sm:text-sm">{s.label}</dt>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </section>

        {/* How it works */}
        <section className="py-16">
          <div className="mx-auto max-w-5xl px-4">
            <p className="text-center text-xs font-bold uppercase tracking-[0.1em] text-accent">{t('international.steps.eyebrow')}</p>
            <h2 className="mt-2 text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('international.steps.title')}</h2>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, i) => (
                <li key={step.title} className="rounded-lg border border-border bg-white p-5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
                  <h3 className="mt-3 text-sm font-semibold text-ink">{step.title}</h3>
                  <p className="mt-1 text-sm text-ink/60">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Why */}
        <section className="border-y border-border bg-white py-16">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('international.why.title')}</h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              {reasons.map(({ icon: Icon, key }) => (
                <div key={key} className="flex gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-brand-light text-brand-dark">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{t(`international.why.${key}Title`)}</h3>
                    <p className="mt-1 text-sm text-ink/60">{t(`international.why.${key}Body`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Talent directory */}
        <section id="talent" className="scroll-mt-20 py-16">
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('international.talent.title')}</h2>
                <p className="mt-2 max-w-2xl text-sm text-ink/60">{t('international.talent.body')}</p>
              </div>
              <div className="flex flex-wrap items-end gap-3 text-sm text-ink/70">
                <label className="flex flex-col gap-1">
                  <span className="text-xs">{t('international.talent.filterCountry')}</span>
                  <Select value={country} onChange={filter(setCountry)} className="w-44">
                    <option value="">{t('international.talent.anyCountry')}</option>
                    {countries.sorted.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs">{t('international.talent.filterLanguage')}</span>
                  <Select value={languageId} onChange={filter(setLanguageId)} className="w-40">
                    <option value="">{t('international.talent.anyLanguage')}</option>
                    {languages.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs">{t('international.talent.filterTraining')}</span>
                  <Select value={training} onChange={filter(setTraining)} className="w-44">
                    <option value="">{t('international.talent.anyTraining')}</option>
                    <option value="ENGLISH">{t('workAbroad.categories.ENGLISH')}</option>
                    <option value="CAREGIVING">{t('workAbroad.categories.CAREGIVING')}</option>
                  </Select>
                </label>
                <label className="flex h-10 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={verifiedOnly}
                    onChange={(e) => {
                      setVerifiedOnly(e.target.checked);
                      setPage(1);
                    }}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                  />
                  {t('international.talent.verifiedOnly')}
                </label>
              </div>
            </div>

            {talentLoading && <div className="mt-8 h-40 animate-pulse rounded-lg bg-paper" aria-hidden />}
            {talent && talent.items.length === 0 && (
              <p className="mt-8 rounded-lg border border-dashed border-border bg-white p-8 text-center text-sm text-ink/60">{t('international.talent.empty')}</p>
            )}
            {talent && talent.items.length > 0 && (
              <>
                <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {talent.items.map((item) => (
                    <TalentCard key={item.slug} talent={item} />
                  ))}
                </div>
                {talent.total > talent.pageSize && (
                  <div className="mt-6 flex items-center justify-center gap-3 text-sm">
                    <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-DEFAULT border border-border px-4 py-2 disabled:opacity-40">
                      {t('international.talent.previous')}
                    </button>
                    <span className="text-ink/60">{t('results.page', { page, totalPages: Math.ceil(talent.total / talent.pageSize) })}</span>
                    <button
                      type="button"
                      disabled={page * talent.pageSize >= talent.total}
                      onClick={() => setPage((p) => p + 1)}
                      className="rounded-DEFAULT border border-border px-4 py-2 disabled:opacity-40"
                    >
                      {t('international.talent.next')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Enquiry */}
        <section id="enquiry" ref={formRef} className="scroll-mt-20 border-t border-border bg-white py-16">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('international.form.title')}</h2>
            <p className="mb-8 mt-2 text-sm text-ink/60">{t('international.form.body')}</p>
            {employer ? (
              <p className="rounded-lg border border-brand/30 bg-brand-light/40 p-5 text-sm text-ink">
                {t('international.account.signedIn')}{' '}
                <Link
                  href={asked ? `/employer/enquiries/new?talent=${encodeURIComponent(asked.slug)}` : '/employer/enquiries/new'}
                  className="font-semibold text-brand-dark underline-offset-2 hover:underline"
                >
                  {t('employer.nav.newEnquiry')}
                </Link>
              </p>
            ) : (
              <EmployerEnquiryForm
                talent={asked ? { slug: asked.slug, firstName: asked.firstName } : null}
                onClearTalent={() => setTalentSlug(null)}
              />
            )}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 py-16">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-2xl font-bold tracking-tight text-ink">{t('international.faq.title')}</h2>
            <div className="mt-6 divide-y divide-border rounded-lg border border-border bg-white">
              {faqs.map((key) => (
                <details key={key} className="group p-5">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-ink marker:hidden">
                    <span className="flex items-center justify-between gap-4">
                      {t(`international.faq.${key}Q`)}
                      <span aria-hidden className="text-ink/40 transition-transform group-open:rotate-45">+</span>
                    </span>
                  </summary>
                  <p className="mt-2 text-sm text-ink/70">{t(`international.faq.${key}A`)}</p>
                </details>
              ))}
            </div>
            <p className="mt-8 text-center text-sm text-ink/60">
              {t('international.caregiverPrompt')}{' '}
              <Link href="/work-abroad" className="font-semibold text-brand hover:text-brand-dark">
                {t('international.caregiverLink')}
              </Link>
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
