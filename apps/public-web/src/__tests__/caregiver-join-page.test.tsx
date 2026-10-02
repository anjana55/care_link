import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CaregiverJoinPage from '@/app/caregiver/join/page';
import { I18nProvider } from '@/lib/i18n';

const get = jest.fn();

jest.mock('@/lib/api/auth-context', () => ({
  useAuth: () => ({ user: null, logout: jest.fn() }),
}));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), post: jest.fn() },
}));

const config = (caregiverRegister: boolean) => ({
  enabled: true,
  caregiver: { register: caregiverRegister, login: true, recovery: true },
  customer: { register: true, login: true, recovery: true },
  otpLength: 6,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <CaregiverJoinPage />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

/**
 * Caregiver sign-up lives on the public site, not behind /staff. These lock in
 * both the destination URLs and the feature-flag behaviour, which is the part
 * that silently regressed once already (the landing CTA pointed at the patient
 * /register form).
 */
const EMAIL_LINK = 'a[href="/caregiver/register"]';
const WHATSAPP_LINK = 'a[href="/caregiver/register/whatsapp"]';
const UNAVAILABLE_COPY =
  'WhatsApp registration is not available right now. Please register with your email address.';

/**
 * The WhatsApp card is the only part of this page that depends on the config
 * lookup. Until it settles the card renders in its "unavailable" form, so
 * waiting on the card itself proves nothing - these wait on the outcome each
 * branch actually produces.
 */
describe('Caregiver join page', () => {
  it('offers both sign-up routes when caregiver WhatsApp registration is on', async () => {
    get.mockResolvedValue(config(true));
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector(WHATSAPP_LINK)).toBeInTheDocument());
    expect(container.querySelector(EMAIL_LINK)).toBeInTheDocument();
  });

  it('never links into /staff', async () => {
    get.mockResolvedValue(config(true));
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector(WHATSAPP_LINK)).toBeInTheDocument());
    expect(container.querySelector('a[href^="/staff"]')).toBeNull();
  });

  it('keeps the email option and explains the missing WhatsApp one when the flag is off', async () => {
    get.mockResolvedValue(config(false));
    const { container } = renderPage();

    expect(await screen.findByText(UNAVAILABLE_COPY)).toBeInTheDocument();
    expect(container.querySelector(EMAIL_LINK)).toBeInTheDocument();
    // Shown as a dead card rather than a link to a form that would reject the
    // visitor.
    expect(container.querySelector(WHATSAPP_LINK)).toBeNull();
  });

  it('does not take the email option down when the config lookup fails', async () => {
    get.mockRejectedValue(new Error('network down'));
    const { container } = renderPage();

    expect(await screen.findByText(UNAVAILABLE_COPY)).toBeInTheDocument();
    expect(container.querySelector(EMAIL_LINK)).toBeInTheDocument();
  });

  it('exposes the site header, so a visitor can always get back', async () => {
    get.mockResolvedValue(config(true));
    renderPage();
    expect(await screen.findByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});
