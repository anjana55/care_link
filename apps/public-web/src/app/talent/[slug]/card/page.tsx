'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { useTalentProfile } from '@/lib/hooks/use-international';
import { useBranding } from '@/lib/branding/provider';
import { BrandMark } from '@/components/layout/brand-mark';
import { TalentPhoto } from '@/components/international/talent-card';

const LEVELS = ['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="border-b border-ink/15 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink/60">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-ink">{children}</div>
    </section>
  );
}

/**
 * A one-page talent card - the CV overseas agencies expect - printed or saved
 * as PDF from the browser. Drawn from the same live shared profile as the
 * profile page (the same allow-list: first name and photo, nothing that
 * reaches the caregiver directly), with the link back to ask about them.
 *
 * Printing from the browser rather than generating a PDF on the server keeps
 * every script right: a caregiver's name or bio may be in Sinhala or Tamil.
 */
export default function TalentCardPage() {
  const { t, locale } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const countries = useCountryNames();
  const { companyName } = useBranding();
  const { data: talent, isLoading, isError } = useTalentProfile(slug, locale);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (talent) document.title = `${talent.firstName} - ${companyName}`;
  }, [talent, companyName]);

  if (isLoading) return <p className="p-10 text-center text-sm text-ink/60">{t('common.loading')}</p>;
  if (isError || !talent) return <p className="p-10 text-center text-sm text-ink/60">{t('talent.notFound')}</p>;

  const askUrl = `${origin}/international?talent=${talent.slug}#enquiry`;
  const month = (iso: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${iso}T00:00:00`));
  const today = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date());

  return (
    <div className="min-h-screen bg-paper py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-4 print:hidden">
        <Link href={`/talent/${talent.slug}`} className="inline-flex items-center gap-1.5 text-sm text-ink/60 hover:text-brand">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('talent.card.back')}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-DEFAULT bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          <Printer className="h-4 w-4" aria-hidden />
          {t('talent.card.print')}
        </button>
      </div>

      <article className="mx-auto min-h-[297mm] w-full max-w-[210mm] bg-white px-[14mm] py-[12mm] shadow-sm print:min-h-0 print:shadow-none">
        <header className="flex items-center justify-between border-b-2 border-brand pb-3">
          <BrandMark />
          <p className="text-[11px] text-ink/50">{t('talent.card.title')}</p>
        </header>

        <div className="mt-6 flex gap-6">
          <TalentPhoto photoUrl={talent.photoUrl} firstName={talent.firstName} className="h-32 w-32 shrink-0 text-5xl" />
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-ink">{talent.firstName}</h1>
            {talent.headline && <p className="mt-1 text-base text-ink/70">{talent.headline}</p>}
            <p className="mt-2 text-sm text-ink/70">
              {t('results.approxAge', { age: talent.approxAge })} · {t('results.yearsExperience', { years: talent.yearsExperience })}
            </p>
            <p className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
              {talent.verified && <span className="rounded-full bg-accent px-2.5 py-0.5 text-white">{t('results.verified')}</span>}
              {talent.hasVerifiedQualification && <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-brand-dark">{t('results.verifiedQualification')}</span>}
            </p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-[1.4fr_1fr] gap-8">
          <div className="space-y-6">
            {talent.bio && (
              <Block title={t('talent.about', { name: talent.firstName })}>
                <p className="whitespace-pre-line">{talent.bio}</p>
              </Block>
            )}
            {talent.skills.length > 0 && (
              <Block title={t('talent.skills')}>
                <p>{talent.skills.join(' · ')}</p>
              </Block>
            )}
            {talent.qualifications.length > 0 && (
              <Block title={t('talent.qualifications')}>
                <ul className="list-inside list-disc">
                  {talent.qualifications.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </Block>
            )}
            {talent.completedTraining.length > 0 && (
              <Block title={t('talent.training')}>
                <ul className="list-inside list-disc">
                  {talent.completedTraining.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-ink/50">{t('talent.trainingNote')}</p>
              </Block>
            )}
          </div>
          <div className="space-y-6">
            {(talent.targetCountries.length > 0 || talent.availableFrom) && (
              <Block title={t('talent.workAbroad')}>
                {talent.targetCountries.length > 0 && <p>{talent.targetCountries.map(countries.name).join(', ')}</p>}
                {talent.availableFrom && <p className="mt-1">{t('talent.availableFrom', { month: month(talent.availableFrom) })}</p>}
              </Block>
            )}
            {talent.languages.length > 0 && (
              <Block title={t('talent.languages')}>
                <ul>
                  {talent.languages.map((l) => (
                    <li key={l.name}>
                      {l.name}
                      {l.proficiency && LEVELS.includes(l.proficiency) && <span className="text-ink/60"> - {t(`talent.levels.${l.proficiency}`)}</span>}
                    </li>
                  ))}
                </ul>
              </Block>
            )}
            {talent.careTypes.length > 0 && (
              <Block title={t('profile.careTypes')}>
                <ul>
                  {talent.careTypes.map((c) => (
                    <li key={c}>{t(`careTypes.${c}`)}</li>
                  ))}
                </ul>
              </Block>
            )}
          </div>
        </div>

        <footer className="mt-10 border-t border-ink/15 pt-4 text-xs text-ink/60">
          <p className="font-semibold text-ink">{t('talent.card.askTitle', { brand: companyName })}</p>
          <p className="mt-1 break-all">{askUrl}</p>
          <p className="mt-3">{t('talent.card.footer', { brand: companyName, date: today })}</p>
        </footer>
      </article>
    </div>
  );
}
