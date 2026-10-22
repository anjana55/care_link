import { render } from '@testing-library/react';
import { DISABLED_ADS, type PublicAdsConfig } from '@care-platform/shared';
import { AdSlot, AdsProvider } from '@/components/ads/adsense';

/**
 * Google AdSense (Settings > Ads) on the public site: the AdSense code and ad
 * units appear only when an admin switched ads on, and only on the landing
 * page, search and public caregiver profiles - never on sign-in or account pages.
 */

let pathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));

const ON: PublicAdsConfig = {
  enabled: true,
  publisherId: 'ca-pub-0123456789012345',
  slots: { home: '1111111111', search: '2222222222', profile: null },
};

function renderAt(path: string, config: PublicAdsConfig, ui: React.ReactNode = null) {
  pathname = path;
  return render(<AdsProvider config={config}>{ui}</AdsProvider>);
}

const adsenseScript = () => document.head.querySelector('script[src*="pagead2.googlesyndication.com"]');

beforeEach(() => {
  document.head.innerHTML = '';
  delete window.adsbygoogle;
});

describe('AdSense on the public site', () => {
  it('loads nothing while ads are off', () => {
    const { container } = renderAt('/', DISABLED_ADS, <AdSlot placement="home" />);
    expect(adsenseScript()).toBeNull();
    expect(container.querySelector('ins')).toBeNull();
  });

  it('loads the AdSense code once, with the publisher ID, on an ad-carrying page', () => {
    renderAt('/find', ON);
    const script = adsenseScript() as HTMLScriptElement;
    expect(script.src).toBe('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-0123456789012345');
    expect(script.async).toBe(true);
    expect(script.crossOrigin).toBe('anonymous');
    renderAt('/', ON);
    expect(document.head.querySelectorAll('script').length).toBe(1);
  });

  it.each(['/login', '/register', '/account/invoices', '/caregiver/login', '/verify-email'])('never loads ads on %s', (path) => {
    const { container } = renderAt(path, ON, <AdSlot placement="home" />);
    expect(adsenseScript()).toBeNull();
    expect(container.querySelector('ins')).toBeNull();
  });

  it('draws a configured unit and hands it to AdSense', () => {
    const { container } = renderAt('/', ON, <AdSlot placement="home" />);
    const ins = container.querySelector('ins.adsbygoogle')!;
    expect(ins.getAttribute('data-ad-client')).toBe('ca-pub-0123456789012345');
    expect(ins.getAttribute('data-ad-slot')).toBe('1111111111');
    expect(window.adsbygoogle).toHaveLength(1);
  });

  it('leaves no trace where no unit is configured', () => {
    const { container } = renderAt('/caregivers/abc123', ON, <AdSlot placement="profile" />);
    expect(container.innerHTML).toBe('');
    expect(adsenseScript()).not.toBeNull(); // Auto ads can still place ads on this page
  });
});
