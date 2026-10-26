'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BadgeCheck, CalendarDays, Check, Copy, FileDown, GraduationCap, MessageSquare, Plane } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { useIsEmployer, useTalentProfile } from '@/lib/hooks/use-international';
import { InterviewRequestPanel, ShortlistButton } from '@/components/international/interview-request';
import { ApiError } from '@/lib/api/client';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LoadingState, ErrorState } from '@/components/common/states';
import { VerifiedBadge } from '@/components/results/verified-badge';
import { TalentPhoto } from '@/components/international/talent-card';

const LEVELS = ['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * A caregiver's shared profile: what they chose to publish (first name, photo,
 * introduction) beside what the platform has checked. There is no way to
 * contact the caregiver directly from here - "Ask about her" sends an
 * enquiry to staff, who make the introduction.
 */
export default function TalentProfilePage() {
  const { t, locale } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const countries = useCountryNames();
  const { data: talent, isLoading, isError, error, refetch } = useTalentProfile(slug, locale);
  const notFound = error instanceof ApiError && error.status === 404;
  const [copied, setCopied] = useState(false);
  const employer = useIsEmployer();

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked - the address bar still has it */
    }
  }

  const month = (iso: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${iso}T00:00:00`));

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="3xl" backHref="/international#talent" backLabel={t('talent.back')} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {isLoading && <LoadingState label={t('common.loading')} />}
        {isError && notFound && (
          <div className="py-16 text-center">
            <p className="text-sm text-ink/60">{t('talent.notFound')}</p>
            <Link href="/international" className="mt-4 inline-block text-sm font-semibold text-brand hover:text-brand-dark">
              {t('talent.browseOthers')}
            </Link>
          </div>
        )}
        {isError && !notFound && <ErrorState onRetry={() => refetch()} />}

        {talent && (
          <article className="rounded-lg border border-border bg-white p-6 sm:p-8">
            <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:text-left">
              <TalentPhoto photoUrl={talent.photoUrl} firstName={talent.firstName} className="h-32 w-32 shrink-0 text-5xl" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h1 className="text-2xl font-bold text-ink sm:text-3xl">{talent.firstName}</h1>
                  {talent.verified && <VerifiedBadge size="md" />}
                </div>
                {talent.headline && <p className="mt-1 text-ink/70">{talent.headline}</p>}
                <p className="mt-2 text-sm text-ink/60">
                  {t('results.approxAge', { age: talent.approxAge })} · {t('results.yearsExperience', { years: talent.yearsExperience })}
                </p>
                {talent.hasVerifiedQualification && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-dark">
                    <BadgeCheck className="h-4 w-4" aria-hidden />
                    {t('results.verifiedQualification')}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-3 sm:justify-start">
              {/* A signed-in employer saves and asks for interviews from their account;
                  anyone else sends an enquiry. Either way, staff make the introduction. */}
              {employer ? (
                <ShortlistButton slug={talent.slug} />
              ) : (
                <Link
                  href={`/international?talent=${encodeURIComponent(talent.slug)}#enquiry`}
                  className="inline-flex items-center gap-2 rounded-DEFAULT bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
                >
                  <MessageSquare className="h-4 w-4" aria-hidden />
                  {t('talent.ask', { name: talent.firstName })}
                </Link>
              )}
              <Link
                href={`/talent/${encodeURIComponent(talent.slug)}/card`}
                className="inline-flex items-center gap-2 rounded-DEFAULT border border-border px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
              >
                <FileDown className="h-4 w-4" aria-hidden />
                {t('talent.card.download')}
              </Link>
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex items-center gap-2 rounded-DEFAULT border border-border px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
              >
                {copied ? <Check className="h-4 w-4 text-brand" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                {copied ? t('talent.copied') : t('talent.copyLink')}
              </button>
            </div>

            {employer && (
              <div className="mt-5">
                <InterviewRequestPanel slug={talent.slug} firstName={talent.firstName} />
              </div>
            )}

            <div className="mt-8 space-y-5">
              {talent.bio && (
                <Section title={t('talent.about', { name: talent.firstName })}>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-ink/80">{talent.bio}</p>
                </Section>
              )}

              {(talent.targetCountries.length > 0 || talent.availableFrom) && (
                <Section title={t('talent.workAbroad')}>
                  {talent.targetCountries.length > 0 && (
                    <p className="flex items-start gap-2 text-sm text-ink/80">
                      <Plane className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                      {t('talent.wantsToWorkIn', { countries: talent.targetCountries.map(countries.name).join(', ') })}
                    </p>
                  )}
                  {talent.availableFrom && (
                    <p className="mt-1.5 flex items-start gap-2 text-sm text-ink/80">
                      <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                      {t('talent.availableFrom', { month: month(talent.availableFrom) })}
                    </p>
                  )}
                </Section>
              )}

              {talent.completedTraining.length > 0 && (
                <Section title={t('talent.training')}>
                  <ul className="space-y-1">
                    {talent.completedTraining.map((title) => (
                      <li key={title} className="flex items-center gap-2 text-sm text-ink/80">
                        <GraduationCap className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                        {title}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-ink/50">{t('talent.trainingNote')}</p>
                </Section>
              )}

              {talent.languages.length > 0 && (
                <Section title={t('talent.languages')}>
                  <ul className="flex flex-wrap gap-2">
                    {talent.languages.map((l) => (
                      <li key={l.name} className="rounded-full bg-paper px-3 py-1 text-sm text-ink/80">
                        {l.name}
                        {l.proficiency && LEVELS.includes(l.proficiency) && <span className="text-ink/50"> · {t(`talent.levels.${l.proficiency}`)}</span>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {talent.careTypes.length > 0 && (
                <Section title={t('profile.careTypes')}>
                  <ul className="flex flex-wrap gap-2">
                    {talent.careTypes.map((type) => (
                      <li key={type} className="rounded-full bg-paper px-3 py-1 text-sm text-ink/80">
                        {t(`careTypes.${type}`)}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {talent.skills.length > 0 && (
                <Section title={t('talent.skills')}>
                  <ul className="flex flex-wrap gap-2">
                    {talent.skills.map((skill) => (
                      <li key={skill} className="rounded-full bg-paper px-3 py-1 text-sm text-ink/80">
                        {skill}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {talent.qualifications.length > 0 && (
                <Section title={t('talent.qualifications')}>
                  <ul className="list-inside list-disc space-y-1 text-sm text-ink/80">
                    {talent.qualifications.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </Section>
              )}

              <p className="border-t border-border pt-5 text-xs text-ink/50">{t('talent.privacyNote')}</p>
            </div>
          </article>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
