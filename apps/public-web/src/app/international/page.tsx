import { Suspense } from 'react';
import type { Metadata } from 'next';
import { InternationalPage } from '@/components/international/international-page';

export const metadata: Metadata = {
  title: 'Hire caregivers from Sri Lanka',
  description: 'Verified, trained caregivers from Sri Lanka for agencies, care homes, hospitals and families abroad. You pay a placement fee only when a caregiver starts work.',
};

export default function Page() {
  // useSearchParams (the ?talent= link from a shared profile) needs a Suspense boundary at build time.
  return (
    <Suspense>
      <InternationalPage />
    </Suspense>
  );
}
