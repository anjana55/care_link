import type { Metadata } from 'next';
import { FinderPage } from '@/components/search/finder-page';

export const metadata: Metadata = {
  title: 'CareLink Finder — Find the right caregiver',
  description: 'Search verified caregivers by skill, location, language and availability.',
};

export default function FindPage() {
  return <FinderPage />;
}
