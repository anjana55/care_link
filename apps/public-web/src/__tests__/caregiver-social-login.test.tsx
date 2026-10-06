import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CaregiverLoginPage from '@/app/caregiver/login/page';
import CaregiverSocialCallbackPage from '@/app/caregiver/social/callback/page';
import { LOGIN_NONCE_KEY } from '@/components/caregivers/social-login-buttons';
import { I18nProvider } from '@/lib/i18n';

/**
 * Returning-caregiver sign-in with Google / Microsoft / Facebook.
 *
 * Two things matter most here: the buttons only exist for providers the
 * environment has configured, and the callback refuses to spend a sign-in code
 * unless the nonce that came back through the provider is the one this browser
 * tab generated (otherwise a link sent to someone else could sign them in as
 * the sender).
 */

const get = jest.fn();
const post = jest.fn();
const applyTokens = jest.fn();
let search = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
jest.mock('@/lib/api/auth-context', () => ({
  useAuth: () => ({ login: jest.fn(), applyTokens, user: null }),
}));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

const ALL = { GOOGLE: true, MICROSOFT: true, FACEBOOK: true };
const whatsappOff = { enabled: false, caregiver: { register: false, login: false, recovery: false } };

function mockConfig(providers: Record<string, boolean> | Error) {
  get.mockImplementation((path: string) => {
    if (path === '/auth/social/providers') {
      return providers instanceof Error ? Promise.reject(providers) : Promise.resolve(providers);
    }
    if (path === '/auth/whatsapp/config') return Promise.resolve(whatsappOff);
    return Promise.resolve({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=s' });
  });
}

function renderNode(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  applyTokens.mockReset();
  search = '';
  window.sessionStorage.clear();
});

describe('caregiver login page', () => {
  it('offers the configured providers alongside the email form', async () => {
    mockConfig(ALL);
    const { container } = renderNode(<CaregiverLoginPage />);

    expect(await screen.findByRole('button', { name: /continue with google/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /continue with microsoft/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /continue with facebook/i })).toBeDefined();
    // The existing way in is untouched.
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('shows only the providers this environment has configured', async () => {
    mockConfig({ GOOGLE: true, MICROSOFT: false, FACEBOOK: false });
    renderNode(<CaregiverLoginPage />);

    expect(await screen.findByRole('button', { name: /continue with google/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /microsoft/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /facebook/i })).toBeNull();
  });

  it('keeps the email form and shows no provider section when the lookup fails', async () => {
    mockConfig(new Error('network down'));
    const { container } = renderNode(<CaregiverLoginPage />);

    await waitFor(() => expect(get).toHaveBeenCalledWith('/auth/social/providers'));
    expect(screen.queryByRole('button', { name: /continue with/i })).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('stores a nonce, sends it to the API, and navigates to the provider', async () => {
    mockConfig(ALL);
    const assign = jest.fn();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });
    renderNode(<CaregiverLoginPage />);

    fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringContaining('accounts.google.com')));
    const nonce = window.sessionStorage.getItem(LOGIN_NONCE_KEY);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(get).toHaveBeenCalledWith('/auth/social/google/login-url', { nonce });
  });

  it('links new visitors to the single registration form', async () => {
    mockConfig(ALL);
    const { container } = renderNode(<CaregiverLoginPage />);
    await screen.findByRole('button', { name: /continue with google/i });
    expect(container.querySelector('a[href="/caregiver/signup"]')).not.toBeNull();
  });
});

describe('social callback page, sign-in flow', () => {
  const assign = jest.fn();
  beforeEach(() => {
    assign.mockReset();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });
    applyTokens.mockReturnValue({ role: 'CAREGIVER' });
    post.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
  });

  it('exchanges the code and lands on the dashboard when the nonce matches', async () => {
    window.sessionStorage.setItem(LOGIN_NONCE_KEY, 'n-123');
    search = 'code=abc&flow=login&nonce=n-123';
    renderNode(<CaregiverSocialCallbackPage />);

    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/social/exchange', { code: 'abc' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/caregiver/dashboard'));
    // Single use: a refresh of the callback URL must not find a nonce to reuse.
    expect(window.sessionStorage.getItem(LOGIN_NONCE_KEY)).toBeNull();
  });

  it('refuses, without spending the code, when the nonce is not this tab\'s', async () => {
    window.sessionStorage.setItem(LOGIN_NONCE_KEY, 'mine');
    search = 'code=abc&flow=login&nonce=someone-elses';
    renderNode(<CaregiverSocialCallbackPage />);

    expect(await screen.findByText(/not started in this browser tab/i)).toBeDefined();
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses when this tab never started a sign-in', async () => {
    search = 'code=abc&flow=login&nonce=anything';
    renderNode(<CaregiverSocialCallbackPage />);

    expect(await screen.findByText(/not started in this browser tab/i)).toBeDefined();
    expect(post).not.toHaveBeenCalled();
  });

  it('sends an unregistered provider account to registration, not to a dead end', async () => {
    search = 'error=not_registered&flow=login&provider=google';
    const { container } = renderNode(<CaregiverSocialCallbackPage />);

    expect(await screen.findByText(/no caregiver account is linked/i)).toBeDefined();
    expect(container.querySelector('a[href="/caregiver/signup"]')).not.toBeNull();
    expect(container.querySelector('a[href="/caregiver/login"]')).not.toBeNull();
  });

  it('returns a failed sign-in to the sign-in page, not the registration form', async () => {
    search = 'error=declined&flow=login';
    const { container } = renderNode(<CaregiverSocialCallbackPage />);

    await screen.findByText(/cancelled the sign-in/i);
    expect(container.querySelector('a[href="/caregiver/login"]')).not.toBeNull();
    expect(container.querySelector('a[href="/caregiver/signup"]')).toBeNull();
  });

  it('leaves the registration flow as it was: no nonce needed there', async () => {
    search = 'code=abc';
    renderNode(<CaregiverSocialCallbackPage />);

    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/social/exchange', { code: 'abc' }));
  });
});
