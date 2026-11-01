import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from '@/app/login/page';
import ClientSocialCallbackPage from '@/app/social/callback/page';
import CaregiverSocialCallbackPage from '@/app/caregiver/social/callback/page';
import SignInMethodsPage from '@/app/account/sign-in/page';
import { ProviderChoices } from '@/components/caregivers/provider-choices';
import { LOGIN_NONCE_KEY } from '@/components/caregivers/social-login-buttons';
import { I18nProvider } from '@/lib/i18n';
import { hardNavigate } from '@/lib/navigation';
import { rememberReturnTo } from '@/lib/return-to';
import en from '@/lib/i18n/dictionaries/en.json';

/**
 * Google, Microsoft and Facebook for clients: the buttons on the client
 * sign-in, the client's callback page, linking from My account, and the
 * provider step after registration.
 */

jest.mock('@/lib/navigation', () => ({ hardNavigate: jest.fn() }));
const get = jest.fn();
const post = jest.fn();
const applyTokens = jest.fn();
let search = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/account/sign-in',
  useSearchParams: () => new URLSearchParams(search),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/api/auth-context', () => ({
  useAuth: () => ({ login: jest.fn(), applyTokens, user: null, loading: false, logout: jest.fn() }),
}));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));
jest.mock('@/components/layout/site-header', () => ({ SiteHeader: () => null }));
jest.mock('@/components/layout/site-footer', () => ({ SiteFooter: () => null }));

const show = (node: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{node}</I18nProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  applyTokens.mockReset();
  jest.mocked(hardNavigate).mockReset();
  search = '';
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('client sign-in page', () => {
  it('offers the providers, and starts a client sign-in', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/auth/social/providers') return Promise.resolve({ GOOGLE: true, MICROSOFT: false, FACEBOOK: true });
      if (path === '/auth/whatsapp/config') return Promise.resolve({ enabled: false, customer: { login: false, register: false } });
      return Promise.resolve({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=s' });
    });
    show(<LoginPage />);
    fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }));
    expect(screen.queryByRole('button', { name: /continue with microsoft/i })).toBeNull();
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=s'));
    const nonce = window.sessionStorage.getItem(LOGIN_NONCE_KEY);
    expect(get).toHaveBeenCalledWith('/auth/social/google/login-url', { nonce, side: 'client' });
    // The email form is still there.
    expect(screen.getByText(en.socialSignIn.orEmail)).toBeDefined();
  });
});

describe("the client's callback page", () => {
  it('spends the code and goes back to where the client set out from', async () => {
    window.sessionStorage.setItem(LOGIN_NONCE_KEY, 'n-1');
    rememberReturnTo('/caregivers/abc');
    search = 'code=c0de&flow=login&nonce=n-1';
    post.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    applyTokens.mockReturnValue({ role: 'PATIENT_GUARDIAN' });
    show(<ClientSocialCallbackPage />);
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/caregivers/abc'));
    expect(post).toHaveBeenCalledWith('/auth/social/exchange', { code: 'c0de' });
  });

  it("lands on Find by default, and refuses a session that isn't a client's", async () => {
    search = 'code=c0de';
    post.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    applyTokens.mockReturnValue({ role: 'PATIENT_GUARDIAN' });
    const first = show(<ClientSocialCallbackPage />);
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/find'));
    first.unmount();

    jest.mocked(hardNavigate).mockReset();
    applyTokens.mockReturnValue(null);
    show(<ClientSocialCallbackPage />);
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/login'));
  });

  it('says when no account is linked yet, with a way to register', async () => {
    search = 'error=not_registered&flow=login';
    show(<ClientSocialCallbackPage />);
    expect(await screen.findByText(en.socialSignIn.errors.notRegistered)).toBeDefined();
    expect(screen.getByRole('link', { name: en.socialSignIn.register }).getAttribute('href')).toBe('/register');
    expect(screen.getByRole('link', { name: en.socialSignIn.backToSignIn }).getAttribute('href')).toBe('/login');
    expect(post).not.toHaveBeenCalled();
  });

  it("sends a caregiver's account to the caregiver sign-in, and the reverse", async () => {
    search = 'error=wrong_portal&flow=login';
    const client = show(<ClientSocialCallbackPage />);
    expect(await screen.findByText(en.socialSignIn.errors.wrongPortalClient)).toBeDefined();
    expect(screen.getByRole('link', { name: en.socialSignIn.otherSignIn.caregiver }).getAttribute('href')).toBe('/caregiver/login');
    client.unmount();

    show(<CaregiverSocialCallbackPage />);
    expect(await screen.findByText(en.socialSignIn.errors.wrongPortalCaregiver)).toBeDefined();
    expect(screen.getByRole('link', { name: en.socialSignIn.otherSignIn.client }).getAttribute('href')).toBe('/login');
  });

  it('after a failed link, offers the way back to Sign-in methods', async () => {
    search = 'error=email_mismatch';
    show(<ClientSocialCallbackPage />);
    expect(await screen.findByText(en.socialSignIn.errors.emailMismatch)).toBeDefined();
    expect(screen.getByRole('link', { name: en.socialSignIn.signInMethods }).getAttribute('href')).toBe('/account/sign-in');
  });
});

describe('My account › Sign-in methods', () => {
  it('shows how the client signs in, and links a provider', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/me/sign-in-methods') {
        return Promise.resolve({ email: 'amali@example.com', password: true, linked: ['GOOGLE'], providers: { GOOGLE: true, MICROSOFT: true, FACEBOOK: false } });
      }
      return Promise.resolve({ url: 'https://login.microsoftonline.com/x?state=s' });
    });
    post.mockResolvedValue({ pendingToken: 'tok', pendingTokenExpiresInSeconds: 900, providers: {} });
    show(<SignInMethodsPage />);

    expect(await screen.findByText(en.account.signIn.on.replace('{email}', 'amali@example.com'))).toBeDefined();
    expect(screen.getByText(en.account.signIn.linked)).toBeDefined();
    expect(screen.queryByText('Facebook')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Link Microsoft' }));

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('https://login.microsoftonline.com/x?state=s'));
    expect(post).toHaveBeenCalledWith('/me/social/link-grant');
    expect(get).toHaveBeenCalledWith('/auth/social/microsoft/authorize-url', { token: 'tok' });
    // The callback brings them back here.
    expect(JSON.parse(window.localStorage.getItem('care-platform-return-to')!).path).toBe('/account/sign-in');
  });
});

describe('after client registration', () => {
  it('offers the providers, without the caregivers’ email-and-password choice', () => {
    show(<ProviderChoices pendingToken="tok" providers={{ GOOGLE: true, MICROSOFT: false, FACEBOOK: false }} expiresInSeconds={900} offerPassword={false} />);
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: en.caregiverSignup.emailPasswordButton })).toBeNull();
  });

  it('shows nothing when no provider is switched on', () => {
    const { container } = show(<ProviderChoices pendingToken="tok" providers={{ GOOGLE: false, MICROSOFT: false, FACEBOOK: false }} expiresInSeconds={900} offerPassword={false} />);
    expect(container.textContent).toBe('');
  });
});
