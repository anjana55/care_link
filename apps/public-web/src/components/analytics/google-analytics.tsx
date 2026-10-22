'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { analyticsAllowedOn, cleanAnalyticsPath, type PublicAnalyticsConfig } from '@care-platform/shared';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    [gaDisable: `ga-disable-${string}`]: boolean | undefined;
  }
}

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js';

/**
 * Google Analytics 4 (Settings > Analytics) for the public site. The root
 * layout fetches the config on the server and hands it down here.
 *
 * - gtag.js is loaded only once a visitor reaches a measured page
 *   (analyticsAllowedOn) - never on account or caregiver-portal pages.
 * - Page views are sent by hand on every client-side navigation, with the
 *   query string and #fragment removed, so search terms (which can describe a
 *   person's health) never reach Google.
 * - Moving on to an unmeasured page sets Google's own opt-out flag
 *   (window['ga-disable-G-…']), which stops every hit - including Enhanced
 *   measurement's automatic ones - until the visitor is back on a measured page.
 */
export function GoogleAnalytics({ config }: { config: PublicAnalyticsConfig }) {
  const pathname = usePathname();
  const id = config.enabled ? config.measurementId : null;
  const allowed = Boolean(id) && analyticsAllowedOn(pathname);

  useEffect(() => {
    if (!id) return;
    window[`ga-disable-${id}`] = !allowed;
    if (!allowed || !pathname) return;

    if (!window.gtag) {
      window.dataLayer = window.dataLayer || [];
      // gtag must push the arguments object itself, exactly as Google's snippet does.
      window.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer!.push(arguments);
      };
      window.gtag('js', new Date());
      // Page views are sent below, so the cleaned URL is the only one reported.
      window.gtag('config', id, { send_page_view: false });
    }
    if (!document.querySelector(`script[src^="${GTAG_SRC}"]`)) {
      const script = document.createElement('script');
      script.async = true;
      script.src = `${GTAG_SRC}?id=${encodeURIComponent(id)}`;
      document.head.appendChild(script);
    }

    const path = cleanAnalyticsPath(pathname);
    const pageLocation = `${window.location.origin}${path}`;
    // `set` so Enhanced measurement's own events also carry the cleaned URL.
    window.gtag('set', { page_location: pageLocation });
    window.gtag('event', 'page_view', { page_location: pageLocation, page_path: path, page_title: document.title });
  }, [id, allowed, pathname]);

  return null;
}
