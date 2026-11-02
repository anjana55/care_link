import { redirect } from 'next/navigation';

/** Analytics now shares a page with ads (Settings > Ads & analytics). */
export default function AnalyticsRedirect() {
  redirect('/settings/ads#analytics');
}
