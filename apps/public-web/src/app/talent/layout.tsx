import type { Metadata } from 'next';

/**
 * Shared caregiver profiles are public at their link, but kept out of search
 * engines: a caregiver who pauses sharing or withdraws consent should not
 * stay findable in someone else's index. The talent directory on
 * /international is where employers browse them.
 */
export const metadata: Metadata = {
  title: 'Caregiver profile',
  robots: { index: false, follow: false },
};

export default function TalentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
