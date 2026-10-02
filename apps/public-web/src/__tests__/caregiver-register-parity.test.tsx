import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CaregiverRegisterPage from '@/app/caregiver/register/page';
import CaregiverRegisterWhatsappPage from '@/app/caregiver/register/whatsapp/page';
import { I18nProvider } from '@/lib/i18n';

const get = jest.fn();
const post = jest.fn();

jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ user: null, logout: jest.fn() }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

const config = {
  enabled: true,
  caregiver: { register: true, login: true, recovery: true },
  customer: { register: true, login: true, recovery: true },
  otpLength: 6,
};

function renderPage(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <I18nProvider>{node}</I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

/** Resolves once the WhatsApp config query has actually answered, not merely fired. */
async function configSettled(client: QueryClient) {
  await waitFor(() => expect(client.getQueryState(['whatsapp-config'])?.status).toBe('success'));
}

/** True when `a` sits before `b` in document order. */
function comesBefore(a: Element, b: Element) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) => {
    if (path === '/auth/whatsapp/config') return Promise.resolve(config);
    if (path === '/public/meta/locations') return Promise.resolve([]);
    return Promise.resolve(null);
  });
});

/**
 * The two sign-up pages were ported separately and drifted within a day: one
 * offered the other route under its subtitle, the other at the bottom of the
 * form. They now share a layout module; this checks the shared result rather
 * than the sharing, so a future edit to either page alone still fails here.
 */
describe('the two caregiver sign-up pages agree', () => {
  it('offers the WhatsApp route above the form on the email page, exactly once', async () => {
    const { container, client } = renderPage(<CaregiverRegisterPage />);
    await configSettled(client);

    const link = screen.getByRole('link', { name: 'Sign up with WhatsApp' });
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(comesBefore(link, form!)).toBe(true);
    expect(container.querySelectorAll('a[href="/caregiver/register/whatsapp"]')).toHaveLength(1);
  });

  it('offers the email route above the form on the WhatsApp page, exactly once', async () => {
    const { container, client } = renderPage(<CaregiverRegisterWhatsappPage />);
    await configSettled(client);

    const link = screen.getByRole('link', { name: 'Sign up with email instead' });
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(comesBefore(link, form!)).toBe(true);
    expect(container.querySelectorAll('a[href="/caregiver/register"]')).toHaveLength(1);
  });

  it('styles the cross-link identically on both pages', async () => {
    const first = renderPage(<CaregiverRegisterPage />);
    await configSettled(first.client);
    const emailClasses = screen.getByRole('link', { name: 'Sign up with WhatsApp' }).parentElement!.className;
    first.unmount();

    const second = renderPage(<CaregiverRegisterWhatsappPage />);
    await configSettled(second.client);
    const whatsappLink = screen.getByRole('link', { name: 'Sign up with email instead' });

    expect(whatsappLink.parentElement!.className).toBe(emailClasses);
  });

  it('drops the cross-link on the email page when WhatsApp sign-up is switched off', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/auth/whatsapp/config') {
        return Promise.resolve({ ...config, caregiver: { ...config.caregiver, register: false } });
      }
      if (path === '/public/meta/locations') return Promise.resolve([]);
      return Promise.resolve(null);
    });

    const { container, client } = renderPage(<CaregiverRegisterPage />);
    await configSettled(client);

    expect(container.querySelector('a[href="/caregiver/register/whatsapp"]')).toBeNull();
    // The form itself is unaffected - email sign-up cannot be switched off.
    expect(container.querySelector('form')).not.toBeNull();
  });
});
