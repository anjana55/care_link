'use client';

import { AdsSettingsSection } from '@/components/settings/ads-settings-section';
import { AnalyticsSettingsSection } from '@/components/settings/analytics-settings-section';

/** Settings > Ads & analytics (admin): what the public site shows and measures. Each part saves on its own. */
export default function AdsAndAnalyticsPage() {
  return (
    <div className="space-y-12">
      <AdsSettingsSection />
      <AnalyticsSettingsSection />
    </div>
  );
}
