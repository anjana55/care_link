'use client';

import { SkillsSection } from '@/components/settings/reference-skills';
import { LanguagesSection } from '@/components/settings/reference-languages';

/** Settings > Skills & languages: the two short lists caregivers are matched on, on one page. */
export default function SkillsAndLanguagesPage() {
  return (
    <div className="space-y-10">
      <SkillsSection />
      <LanguagesSection />
    </div>
  );
}
