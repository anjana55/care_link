'use client';

import Link from 'next/link';
import {
  Search,
  UserRound,
  FolderKanban,
  ShieldCheck,
  Settings,
  HeartPulse,
  Languages,
  BadgeCheck,
  ArrowRight,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

/**
 * The marketing landing page.
 *
 * This was a standalone static file (deploy/landing/index.html) served by nginx
 * at exactly "/", which meant it was a separate codebase from the apps it links
 * into: its own theme, English-only, and unable to reuse the header, footer or
 * language switcher. It is a route now, so the whole site shares one shell.
 */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold uppercase tracking-[0.1em] text-accent">{children}</p>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h2>
      {body && <p className="mx-auto mt-3 max-w-xl text-ink/60">{body}</p>}
    </div>
  );
}

export function LandingHero() {
  const { t } = useTranslation();

  return (
    <section className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-12 sm:py-20 lg:grid-cols-[1.05fr_.95fr]">
      <div>
        <span className="inline-block rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-brand-dark">
          {t('landing.pill')}
        </span>

        <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl lg:text-5xl">
          {t('landing.heroTitle')}
        </h1>

        <p className="mt-4 max-w-lg text-ink/60">{t('landing.heroBody')}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/find"
            className="inline-flex items-center gap-2 rounded bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            {t('landing.ctaSearch')}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          {/*
            "Join as a caregiver" goes to the chooser at /caregiver/join, which
            offers email and WhatsApp sign-up. Not /register - that is the
            patient/guardian form - and not /staff/register, which put
            caregivers behind the office-staff area.
          */}
          <Link
            href="/caregiver/join"
            className="inline-flex items-center rounded border border-border bg-white px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
          >
            {t('landing.ctaRegister')}
          </Link>
        </div>

        <dl className="mt-10 flex flex-wrap gap-8">
          {(
            [
              ['landing.statLocations', 'landing.statLocationsLabel'],
              ['landing.statLanguages', 'landing.statLanguagesLabel'],
              ['landing.statVerified', 'landing.statVerifiedLabel'],
            ] as const
          ).map(([value, label]) => (
            <div key={label}>
              <dd className="text-2xl font-bold text-brand-dark">{t(value)}</dd>
              <dt className="mt-0.5 text-sm text-ink/60">{t(label)}</dt>
            </div>
          ))}
        </dl>
      </div>

      {/*
        This panel replaces the dashed "Hero image 1200 x 900 px" placeholder the
        static page shipped. It carries the same information without looking
        broken to a visitor, and can be swapped for a real photograph later
        without changing the surrounding layout.
      */}
      <div className="relative overflow-hidden rounded-lg bg-brand-dark">
        <div className="absolute inset-0 bg-gradient-to-br from-brand via-brand-dark to-accent opacity-90" />
        <div className="relative flex aspect-[4/3] flex-col items-center justify-center gap-3 p-8 text-center text-white">
          <HeartPulse className="h-14 w-14" strokeWidth={1.5} aria-hidden />
          <p className="text-xl font-semibold">{t('landing.panelTitle')}</p>
          <p className="max-w-xs text-sm text-white/80">{t('landing.panelBody')}</p>
        </div>
      </div>
    </section>
  );
}

/** The inside of an app card - shared by the router Link and the plain anchor. */
function AppCardBody({ app }: { app: { icon: typeof Search; tag: string; title: string; body: string; cta: string } }) {
  const { t } = useTranslation();
  const Icon = app.icon;

  return (
    <>
      <div className="flex h-11 w-11 items-center justify-center rounded bg-brand-light text-brand-dark">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <span className="w-fit rounded-full bg-accent-light px-2.5 py-0.5 text-xs font-semibold text-accent-dark">
        {t(app.tag)}
      </span>
      <h3 className="text-base font-semibold text-ink">{t(app.title)}</h3>
      <p className="flex-1 text-sm text-ink/60">{t(app.body)}</p>
      <span className="text-sm font-semibold text-brand transition-colors group-hover:text-brand-dark">
        {t(app.cta)} <ArrowRight className="inline h-3.5 w-3.5" aria-hidden />
      </span>
    </>
  );
}

export function LandingApps() {
  const { t } = useTranslation();

  // `external` marks a destination served by another container rather than by
  // this app. Those need a plain anchor: next/link would try to resolve them
  // through the app router, which has no such route and renders its 404.
  const apps = [
    {
      href: '/find',
      icon: Search,
      tag: 'landing.apps.finder.tag',
      title: 'landing.apps.finder.title',
      body: 'landing.apps.finder.body',
      cta: 'landing.apps.finder.cta',
      external: false,
    },
    {
      href: '/login',
      icon: UserRound,
      tag: 'landing.apps.account.tag',
      title: 'landing.apps.account.title',
      body: 'landing.apps.account.body',
      cta: 'landing.apps.account.cta',
      external: false,
    },
    {
      href: '/register',
      icon: FolderKanban,
      tag: 'landing.apps.register.tag',
      title: 'landing.apps.register.title',
      body: 'landing.apps.register.body',
      cta: 'landing.apps.register.cta',
      external: false,
    },
    {
      href: '/api/docs',
      icon: Settings,
      tag: 'landing.apps.api.tag',
      title: 'landing.apps.api.title',
      body: 'landing.apps.api.body',
      cta: 'landing.apps.api.cta',
      // Served by the API container (see the prefix note in nginx.conf).
      external: true,
    },
  ] as const;

  return (
    <section className="border-t border-border bg-white py-16">
      <div className="mx-auto max-w-5xl px-4">
        <SectionHeading
          eyebrow={t('landing.apps.eyebrow')}
          title={t('landing.apps.title')}
          body={t('landing.apps.body')}
        />

        {/* Four cards, so a 2x2 grid rather than 3-across with a lone orphan. */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {apps.map(({ external, ...app }) =>
            external ? (
              <a
                key={app.href}
                href={app.href}
                className="group flex flex-col gap-3 rounded-lg border border-border bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-brand hover:shadow-lg"
              >
                <AppCardBody app={app} />
              </a>
            ) : (
              <Link
                key={app.href}
                href={app.href}
                className="group flex flex-col gap-3 rounded-lg border border-border bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-brand hover:shadow-lg"
              >
                <AppCardBody app={app} />
              </Link>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

export function LandingHowItWorks() {
  const { t } = useTranslation();

  const steps = [1, 2, 3, 4].map((n) => ({
    title: t(`landing.steps.step${n}Title`),
    body: t(`landing.steps.step${n}Body`),
  }));

  return (
    <section className="py-16">
      <div className="mx-auto max-w-3xl px-4">
        <SectionHeading eyebrow={t('landing.steps.eyebrow')} title={t('landing.steps.title')} />

        <ol className="mt-10 space-y-3">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-lg border border-border bg-white p-5"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">{step.title}</h3>
                <p className="mt-1 text-sm text-ink/60">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function LandingGallery() {
  const { t } = useTranslation();

  /*
    The static page showed three dashed "Photo 1 / 600 x 600 px" boxes under the
    line "Swap these placeholders for photos of your team". That instruction was
    aimed at whoever wrote the page, not at the people visiting it, so the
    section now makes the same point with real content about the product.
  */
  const cards = [
    { icon: BadgeCheck, title: 'landing.gallery.verifiedTitle', body: 'landing.gallery.verifiedBody' },
    { icon: Languages, title: 'landing.gallery.languageTitle', body: 'landing.gallery.languageBody' },
    { icon: ShieldCheck, title: 'landing.gallery.privacyTitle', body: 'landing.gallery.privacyBody' },
  ] as const;

  return (
    <section className="border-t border-border bg-white py-16">
      <div className="mx-auto max-w-5xl px-4">
        <SectionHeading
          eyebrow={t('landing.gallery.eyebrow')}
          title={t('landing.gallery.title')}
          body={t('landing.gallery.body')}
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {cards.map((card) => (
            <div key={card.title} className="rounded-lg border border-border p-6">
              <card.icon className="h-6 w-6 text-accent" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold text-ink">{t(card.title)}</h3>
              <p className="mt-1.5 text-sm text-ink/60">{t(card.body)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LandingCta() {
  const { t } = useTranslation();

  return (
    <section className="px-4 pb-16">
      <div className="mx-auto max-w-3xl rounded-lg bg-gradient-to-br from-brand to-accent px-6 py-12 text-center">
        <h2 className="text-2xl font-bold text-white">{t('landing.cta.title')}</h2>
        <p className="mx-auto mt-3 max-w-lg text-sm text-white/85">{t('landing.cta.body')}</p>
        <Link
          href="/find"
          className="mt-7 inline-flex items-center gap-2 rounded bg-white px-6 py-2.5 text-sm font-semibold text-brand-dark transition-colors hover:bg-white/90"
        >
          {t('landing.cta.button')}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
