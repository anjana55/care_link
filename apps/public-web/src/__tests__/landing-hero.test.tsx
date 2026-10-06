import { render, screen } from '@testing-library/react';
import { LandingHero } from '@/components/landing/landing-sections';
import { I18nProvider } from '@/lib/i18n';

/**
 * Regression guard. This button has pointed at two wrong places: once at
 * /register (the patient/guardian form) and once at /staff/register/whatsapp
 * (which put caregiver sign-up behind the office-staff area). Both sent
 * prospective caregivers somewhere they do not belong, and neither failed
 * loudly, so nothing else in the app would have caught it.
 */
describe('Landing hero', () => {
  function renderHero() {
    return render(
      <I18nProvider>
        <LandingHero />
      </I18nProvider>,
    );
  }

  it('sends "Join as a caregiver" straight to the registration form', () => {
    renderHero();
    expect(screen.getByRole('link', { name: 'Join as a caregiver' })).toHaveAttribute('href', '/caregiver/signup');
  });

  it('keeps caregiver sign-up out of both the patient form and the staff area', () => {
    const { container } = renderHero();
    const cta = screen.getByRole('link', { name: 'Join as a caregiver' });

    expect(cta.getAttribute('href')).not.toMatch(/^\/(staff|register)/);
    // The patient form has its own entry point elsewhere; the caregiver CTA
    // must not double as one.
    expect(container.querySelector('a[href="/register"]')).toBeNull();
  });

  it('still sends families to the search page', () => {
    renderHero();
    expect(screen.getByRole('link', { name: 'Search caregivers' })).toHaveAttribute('href', '/find');
  });
});
