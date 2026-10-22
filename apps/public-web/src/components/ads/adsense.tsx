'use client';

import { createContext, useContext, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { DISABLED_ADS, adsAllowedOn, type AdPlacement, type PublicAdsConfig } from '@care-platform/shared';
import { cn } from '@/lib/utils';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

const AdsContext = createContext<PublicAdsConfig>(DISABLED_ADS);

export function useAds() {
  return useContext(AdsContext);
}

/**
 * Google AdSense (Settings > Ads) for the public site. The root layout fetches
 * the config on the server and hands it down here.
 *
 * The AdSense code is loaded only once a visitor is on a page that may carry
 * ads (adsAllowedOn: the landing page, search and public caregiver profiles) -
 * never on sign-in, registration or account pages. With Auto ads switched on in
 * AdSense, Google places ads on those pages by itself; <AdSlot> adds the
 * manually placed units an admin configured.
 */
export function AdsProvider({ config, children }: { config: PublicAdsConfig; children: React.ReactNode }) {
  return (
    <AdsContext.Provider value={config}>
      <AdsenseLoader />
      {children}
    </AdsContext.Provider>
  );
}

/**
 * Adds the AdSense script to <head> the first time the visitor is on an
 * ad-carrying page. Added by hand rather than with next/script, whose extra
 * data-nscript attribute AdSense warns about.
 */
function AdsenseLoader() {
  const { enabled, publisherId } = useAds();
  const pathname = usePathname();
  const allowed = enabled && Boolean(publisherId) && adsAllowedOn(pathname);

  useEffect(() => {
    if (!allowed || !publisherId) return;
    if (document.querySelector(`script[src^="${ADSENSE_SRC}"]`)) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = `${ADSENSE_SRC}?client=${encodeURIComponent(publisherId)}`;
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
  }, [allowed, publisherId]);

  return null;
}

// <ins> elements already handed to AdSense. React's development double-mount
// would otherwise push the same one twice, which AdSense reports as an error.
const pushed = new WeakSet<Element>();

/**
 * A manually placed ad unit. Renders nothing - no gap, no label - unless ads
 * are on, this page may carry them, and the admin set a unit for this spot.
 */
export function AdSlot({ placement, className }: { placement: AdPlacement; className?: string }) {
  const { enabled, publisherId, slots } = useAds();
  const pathname = usePathname();
  const slot = enabled && publisherId && adsAllowedOn(pathname) ? slots[placement] : null;
  const ref = useRef<HTMLModElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!slot || !el || pushed.has(el)) return;
    pushed.add(el);
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* An ad that fails to load leaves the space empty; the page itself is unaffected. */
    }
  }, [slot]);

  if (!slot || !publisherId) return null;
  return (
    <div className={cn('mx-auto w-full max-w-3xl px-4', className)} data-ad-placement={placement}>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={publisherId}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
