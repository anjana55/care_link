import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_BRANDING, type PublicBranding } from '@care-platform/shared';
import { BrandingProvider } from '@/lib/branding/provider';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { BrandMark } from '@/components/layout/brand-mark';
import { useTranslation } from '@/lib/i18n';

/**
 * White-label (Settings > Branding): the public site speaks with the
 * configured company name wherever the dictionaries say `{brand}`, offers only
 * the configured languages, and starts in the configured default language.
 */

const GOLDEN: PublicBranding = {
  ...DEFAULT_BRANDING,
  companyName: 'Golden Years Care',
  shortName: 'GY',
  primaryColor: '#1A5FB4',
  accentColor: '#8F3B76',
  defaultLocale: 'si',
  enabledLocales: ['en', 'si'],
};

function Probe() {
  const { t, locale } = useTranslation();
  return (
    <p data-testid="probe" data-locale={locale}>
      {t('caregiverClaim.haveStaffCode')}
    </p>
  );
}

function renderWith(branding: PublicBranding, ui: React.ReactNode) {
  // The provider re-checks the API once on load; it answers with the same branding.
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => branding })) as unknown as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BrandingProvider initial={branding}>{ui}</BrandingProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => window.localStorage.clear());

describe('white-label branding on the public site', () => {
  it('fills {brand} with the configured company name', async () => {
    renderWith({ ...GOLDEN, defaultLocale: 'en' }, <Probe />);
    expect(await screen.findByText('I have a code from the Golden Years Care office')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('{brand}');
    expect(document.body.textContent).not.toContain('CareLink');
  });

  it('starts in the default language, and ignores a stored language that is no longer offered', async () => {
    window.localStorage.setItem('care-platform-public-locale', 'ta');
    renderWith(GOLDEN, <Probe />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveAttribute('data-locale', 'si'));
    expect(window.localStorage.getItem('care-platform-public-locale')).toBe('si');
  });

  it('offers only the enabled languages, and hides the switcher when there is one', () => {
    const { unmount } = renderWith(GOLDEN, <LanguageSwitcher />);
    const group = screen.getByRole('group');
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['EN', 'සිං']);
    unmount();

    renderWith({ ...GOLDEN, enabledLocales: ['si'] }, <LanguageSwitcher />);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('shows the logo when there is one, and the name when there is not', () => {
    const { unmount } = renderWith(GOLDEN, <BrandMark />);
    expect(screen.getByText('Golden Years Care')).toBeInTheDocument();
    unmount();

    renderWith({ ...GOLDEN, logoVersion: 'abc123' }, <BrandMark />);
    expect(screen.getByRole('img', { name: 'Golden Years Care' })).toHaveAttribute('src', '/api/branding/logo?v=abc123');
  });

  it('paints the page in the configured colours', async () => {
    renderWith(GOLDEN, <Probe />);
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--color-brand')).toBe('26 95 180'));
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('143 59 118');
  });
});
