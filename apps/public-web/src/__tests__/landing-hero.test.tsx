import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinderPage } from '@/components/search/finder-page';
import { renderWithProviders } from '@/lib/test/test-utils';

jest.mock('@/components/layout/site-header', () => ({ SiteHeader: () => null }));
jest.mock('@/components/layout/site-footer', () => ({ SiteFooter: () => null }));
jest.mock('@/lib/hooks/use-client-care', () => ({ useIsClient: () => null }));
jest.mock('@/components/care/find-for-me', () => ({ FindForMeCard: () => null }));
jest.mock('@/lib/hooks/use-public-search', () => ({
  useSearchConfig: () => ({ data: { aiSearchEnabled: true }, isLoading: false }),
  useMetaSkills: () => ({ data: [] }),
  useMetaLanguages: () => ({ data: [] }),
  useLocationTree: () => ({ data: [] }),
  useCities: () => ({ data: [] }),
  useClientSearchOrigin: () => ({ data: undefined }),
  useCaregiverCoverage: () => ({ data: [] }),
  useCaregiverSearch: () => ({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() }),
}));

/**
 * Regression guard. The caregiver sign-up link on the landing page has pointed
 * at two wrong places: once at /register (the patient/guardian form) and once
 * at /staff/register/whatsapp (which put caregiver sign-up behind the
 * office-staff area). Both sent prospective caregivers somewhere they do not
 * belong, and neither failed loudly. The landing page now opens on the finder,
 * and the link lives at the foot of its search panel.
 */
describe('Landing page caregiver link', () => {
  function renderLanding() {
    const client = new QueryClient();
    return render(<QueryClientProvider client={client}>{renderWithProviders(<FinderPage variant="landing" />)}</QueryClientProvider>);
  }

  it('sends "Join as a caregiver" straight to the registration form', () => {
    renderLanding();
    expect(screen.getByRole('link', { name: 'Join as a caregiver' })).toHaveAttribute('href', '/caregiver/signup');
  });

  it('keeps caregiver sign-up out of both the patient form and the staff area', () => {
    const { container } = renderLanding();
    const cta = screen.getByRole('link', { name: 'Join as a caregiver' });
    expect(cta.getAttribute('href')).not.toMatch(/^\/(staff|register)/);
    expect(container.querySelector('a[href="/register"]')).toBeNull();
  });
});
