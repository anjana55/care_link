import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import {
  LandingHero,
  LandingApps,
  LandingHowItWorks,
  LandingGallery,
  LandingCta,
} from '@/components/landing/landing-sections';

export const metadata: Metadata = {
  title: 'CareLink — Find trusted caregivers. Manage care with confidence.',
  description:
    'CareLink connects families with verified caregivers and gives care teams one place to manage them.',
};

/**
 * The landing page.
 *
 * This used to be a near-copy of /find, plus a separate static HTML file served
 * by nginx at exactly "/" that shadowed this route entirely in production. The
 * real marketing page now lives here as a proper route, so it shares the header,
 * footer, theme and translations with every page it links to. The search
 * experience itself is /find - see components/search/finder-page.tsx.
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader showBackLink={false} />

      <main className="flex-1">
        <LandingHero />
        <LandingApps />
        <LandingHowItWorks />
        <LandingGallery />
        <LandingCta />
      </main>

      <SiteFooter />
    </div>
  );
}
