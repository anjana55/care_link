'use client';

import Link from 'next/link';
import { Search, UserPlus, Users, ShieldCheck, KeyRound, Code2, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { HeroBanner } from '@/components/common/hero-banner';

interface AppCard {
  href: string;
  icon: LucideIcon;
  tagKey: string;
  titleKey: string;
  descKey: string;
  ctaKey: string;
  /** Same Next.js app (client-side route) vs. a different app entirely (needs a full page load). */
  internal: boolean;
}

const APPS: AppCard[] = [
  { href: '/find', icon: Search, tagKey: 'appFindTag', titleKey: 'appFindTitle', descKey: 'appFindDesc', ctaKey: 'appFindCta', internal: true },
  {
    href: '/staff/register',
    icon: UserPlus,
    tagKey: 'appRegisterCaregiverTag',
    titleKey: 'appRegisterCaregiverTitle',
    descKey: 'appRegisterCaregiverDesc',
    ctaKey: 'appRegisterCaregiverCta',
    internal: false,
  },
  {
    href: '/register',
    icon: Users,
    tagKey: 'appRegisterFamilyTag',
    titleKey: 'appRegisterFamilyTitle',
    descKey: 'appRegisterFamilyDesc',
    ctaKey: 'appRegisterFamilyCta',
    internal: true,
  },
  { href: '/staff', icon: ShieldCheck, tagKey: 'appStaffTag', titleKey: 'appStaffTitle', descKey: 'appStaffDesc', ctaKey: 'appStaffCta', internal: false },
  { href: '/staff/users', icon: KeyRound, tagKey: 'appUsersTag', titleKey: 'appUsersTitle', descKey: 'appUsersDesc', ctaKey: 'appUsersCta', internal: false },
  { href: '/api/docs', icon: Code2, tagKey: 'appApiTag', titleKey: 'appApiTitle', descKey: 'appApiDesc', ctaKey: 'appApiCta', internal: false },
];

/**
 * The CareLink "home" - a cross-app hub, distinct from /find's own
 * search-focused marketing (its how-it-works/trust/multilingual sections
 * live right next to the search box there). This page's only job is
 * getting each kind of visitor to the right app: families to /find or
 * /register, caregivers to /staff/register, staff/admins to /staff or
 * /staff/users, developers to /api/docs.
 *
 * /staff is a separate Next.js app (its own basePath, see
 * apps/web/next.config.js) - intentionally untouched here, just linked to.
 * Those cards use a plain <a> (full page load) rather than next/link,
 * since client-side routing can't cross into a different app's bundle.
 */
export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <main>
      <header className="border-b border-border bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-sm font-semibold text-brand-dark">
            {t('landing.brand')}
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link href="/login" className="text-sm font-medium text-ink/60 hover:text-ink">
              {t('nav.signIn')}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-10 sm:grid-cols-2 sm:py-16">
        <div className="text-center sm:text-left">
          <span className="inline-block rounded-DEFAULT bg-brand-light px-3 py-1 text-xs font-semibold text-brand-dark">
            {t('landing.eyebrow')}
          </span>
          <h1 className="mt-4 text-3xl font-bold leading-tight text-ink sm:text-4xl">
            {t('landing.heroTitle')} <span className="text-brand">{t('landing.heroTitleHighlight')}</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-ink/60 sm:mx-0">{t('landing.heroSubtitle')}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3 sm:justify-start">
            <Link
              href="/find"
              className="inline-flex items-center rounded-DEFAULT bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              {t('landing.ctaFind')}
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center rounded-DEFAULT border border-border bg-white px-6 py-2.5 text-sm font-semibold text-ink hover:border-brand"
            >
              {t('landing.ctaRegisterFamily')}
            </Link>
          </div>
        </div>
        <HeroBanner alt={t('landing.heroImageAlt')} />
      </section>

      {/* Announcement / campaign banner placeholder */}
      <section className="mx-auto max-w-5xl px-4 pb-4">
        <div
          role="img"
          aria-label={t('landing.bannerAlt')}
          className="flex h-28 w-full items-center justify-center rounded-lg border border-dashed border-brand/40 bg-gradient-to-r from-brand-light via-white to-accent-light"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-brand/60">{t('landing.bannerAlt')}</p>
        </div>
      </section>

      {/* Apps grid - the actual "tie everything together" section */}
      <section className="mx-auto max-w-5xl px-4 py-12">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">{t('landing.appsEyebrow')}</p>
        <h2 className="mt-1 text-2xl font-bold text-ink">{t('landing.appsTitle')}</h2>
        <p className="mt-2 max-w-2xl text-ink/60">{t('landing.appsSubtitle')}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.map((app) => {
            const Icon = app.icon;
            const content = (
              <>
                <div className="flex h-11 w-11 items-center justify-center rounded-DEFAULT bg-brand-light text-brand-dark">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <span className="mt-3 inline-block w-fit rounded-DEFAULT bg-accent-light px-2 py-0.5 text-xs font-semibold text-accent">
                  {t(`landing.${app.tagKey}`)}
                </span>
                <h3 className="mt-2 text-base font-semibold text-ink">{t(`landing.${app.titleKey}`)}</h3>
                <p className="mt-1 flex-1 text-sm text-ink/60">{t(`landing.${app.descKey}`)}</p>
                <span className="mt-3 text-sm font-semibold text-brand">{t(`landing.${app.ctaKey}`)} &rarr;</span>
              </>
            );
            const className =
              'flex flex-col rounded-lg border border-border bg-white p-5 transition-colors hover:border-brand hover:shadow-sm';
            return app.internal ? (
              <Link key={app.href} href={app.href} className={className}>
                {content}
              </Link>
            ) : (
              <a key={app.href} href={app.href} className={className}>
                {content}
              </a>
            );
          })}
        </div>
      </section>

      {/* Feature screenshot placeholder */}
      <section className="mx-auto max-w-5xl px-4 pb-12">
        <div className="mx-auto max-w-2xl">
          <HeroBanner alt={t('landing.featureImageAlt')} />
        </div>
      </section>

      <footer className="border-t border-border py-6 text-center text-xs text-ink/40">
        <p className="mx-auto max-w-2xl px-4">
          &copy; {new Date().getFullYear()} {t('landing.footerNote')}
        </p>
      </footer>
    </main>
  );
}
