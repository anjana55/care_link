import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CareLink Finder — Find the right caregiver',
  description: 'Search verified caregivers by skill, location, language and availability.',
};

export default function FindLayout({ children }: { children: React.ReactNode }) {
  return children;
}
