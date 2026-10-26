import type { Metadata } from 'next';
import { getBranding } from '@/lib/branding/server';
import { FinderPage } from '@/components/search/finder-page';
import {
  LandingApps,
  LandingHowItWorks,
  LandingGallery,
  LandingCta,
} from '@/components/landing/landing-sections';
import { AdSlot } from '@/components/ads/adsense';

export async function generateMetadata(): Promise<Metadata> {
  const { companyName, tagline } = await getBranding();
  return {
    title: { absolute: `${companyName} — ${tagline ?? 'Find trusted caregivers. Manage care with confidence.'}` },
    description: `${companyName} connects families with verified caregivers and gives care teams one place to manage them.`,
  };
}

/**
 * The landing page: the caregiver finder, map first, with the marketing
 * sections underneath.
 *
 * It used to open on a text hero whose main button sent visitors on to /find.
 * Now the first screen is the search itself - a map of where caregivers are,
 * with AI Search and Normal Search floating over it - so nobody has to click
 * through to start looking. /find serves the same finder with its own
 * shorter sections underneath.
 */
export default function LandingPage() {
  return (
    <FinderPage variant="landing">
      <LandingApps />
      <LandingHowItWorks />
      <AdSlot placement="home" className="pb-8" />
      <LandingGallery />
      <LandingCta />
    </FinderPage>
  );
}
