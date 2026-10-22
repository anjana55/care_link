import { render } from '@testing-library/react';
import { DISABLED_ANALYTICS, type PublicAnalyticsConfig } from '@care-platform/shared';
import { GoogleAnalytics } from '@/components/analytics/google-analytics';

/**
 * Google Analytics (Settings > Analytics) on the public site: gtag.js loads
 * only when an admin switched it on, page views carry no query string, and
 * account / caregiver-portal pages are never measured.
 */

let pathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));

const ID = 'G-AB12CD34EF';
const ON: PublicAnalyticsConfig = { enabled: true, measurementId: ID };

const gtagScript = () => document.head.querySelector('script[src*="googletagmanager.com/gtag/js"]') as HTMLScriptElement | null;
/** The gtag calls queued so far, as plain arrays. */
const calls = () => (window.dataLayer ?? []).map((args) => Array.from(args as ArrayLike<unknown>));
const pageViews = () => calls().filter((c) => c[0] === 'event' && c[1] === 'page_view').map((c) => c[2] as Record<string, string>);

function renderAt(path: string, config: PublicAnalyticsConfig) {
  pathname = path;
  return render(<GoogleAnalytics config={config} />);
}

beforeEach(() => {
  document.head.innerHTML = '';
  delete window.dataLayer;
  delete window.gtag;
  delete window[`ga-disable-${ID}`];
});

describe('Google Analytics on the public site', () => {
  it('loads nothing while switched off', () => {
    renderAt('/', DISABLED_ANALYTICS);
    expect(gtagScript()).toBeNull();
    expect(window.dataLayer).toBeUndefined();
  });

  it('loads gtag.js once with the measurement ID, and sends a page view without the query string', () => {
    const { rerender } = renderAt('/find?q=dementia care', ON);
    expect(gtagScript()!.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${ID}`);
    expect(calls()).toContainEqual(['config', ID, { send_page_view: false }]);
    expect(pageViews()[0]).toMatchObject({ page_path: '/find', page_location: 'http://localhost/find' });

    pathname = '/caregivers/abc123';
    rerender(<GoogleAnalytics config={ON} />);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    expect(pageViews().map((v) => v.page_path)).toEqual(['/find', '/caregivers/abc123']);
  });

  it.each(['/account', '/account/invoices/inv-1', '/caregiver/dashboard', '/caregiver/social/callback'])(
    'never loads or reports on %s',
    (path) => {
      renderAt(path, ON);
      expect(gtagScript()).toBeNull();
      expect(pageViews()).toHaveLength(0);
    },
  );

  it("switches Google's opt-out flag on when the visitor moves to an unmeasured page, and off again after", () => {
    const { rerender } = renderAt('/login', ON);
    expect(window[`ga-disable-${ID}`]).toBe(false);

    pathname = '/account/bookings';
    rerender(<GoogleAnalytics config={ON} />);
    expect(window[`ga-disable-${ID}`]).toBe(true);
    expect(pageViews()).toHaveLength(1);

    pathname = '/';
    rerender(<GoogleAnalytics config={ON} />);
    expect(window[`ga-disable-${ID}`]).toBe(false);
    expect(pageViews().map((v) => v.page_path)).toEqual(['/login', '/']);
  });
});
