import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CaregiverLoginPage from '@/app/caregiver/login/page';
import LoginPage from '@/app/login/page';
import { AuthProvider } from '@/lib/api/auth-context';
import { I18nProvider } from '@/lib/i18n';

/**
 * Signing in on the public site with credentials that belong to another portal.
 *
 * The real AuthProvider and the real login pages are used; only the network is
 * faked. That matters: the bug was in the seam between them - the API said "yes",
 * the context quietly refused the role, and the page showed nothing - which a
 * test that mocks `useAuth` cannot see.
 */

const post = jest.fn();
const get = jest.fn();
const push = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: jest.fn() }) }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

const jwt = (payload: Record<string, unknown>) => ['e30', btoa(JSON.stringify(payload)), 'sig'].join('.');
const tokensFor = (payload: Record<string, unknown>) => ({ accessToken: jwt(payload), refreshToken: 'refresh-token' });
const { ApiError } = jest.requireActual('@/lib/api/client');

let assign: jest.Mock;

function renderPage(page: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <AuthProvider>{page}</AuthProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

async function signIn(email: string, password: string) {
  fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in|log in|login/i }));
}

beforeEach(() => {
  window.localStorage.clear();
  post.mockReset();
  push.mockReset();
  assign = jest.fn();
  Object.defineProperty(window, 'location', { value: { assign }, writable: true });
  get.mockImplementation((path: string) =>
    Promise.resolve(path === '/auth/whatsapp/config' ? { enabled: false, caregiver: { register: false, login: false, recovery: false }, customer: { register: false, login: false, recovery: false } } : {}),
  );
});

describe.each([
  ['the caregiver login', <CaregiverLoginPage key="c" />],
  ['the patient login', <LoginPage key="p" />],
])('%s, given an office-staff account', (_name, page) => {
  it.each(['ADMIN', 'STAFF', 'VERIFIER'])('shows "Invalid credentials" and signs nobody in (%s)', async (role) => {
    post.mockResolvedValue(tokensFor({ sub: 's1', email: 'staff@care-platform.local', role }));
    renderPage(page);

    await signIn('staff@care-platform.local', 'correct-staff-password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(assign).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    // And the staff session was not left behind in this site's storage.
    expect(window.localStorage.length).toBe(0);
  });

  it('shows exactly what a wrong password shows', async () => {
    // Wrong password: the API itself refuses.
    post.mockRejectedValue(new ApiError(401, 'Invalid credentials'));
    const wrong = renderPage(page);
    await signIn('someone@example.com', 'wrong-password');
    const wrongText = (await screen.findByRole('alert')).textContent;
    wrong.unmount();

    // Right password, wrong portal: the API accepts, this site refuses.
    post.mockResolvedValue(tokensFor({ sub: 's1', role: 'STAFF' }));
    renderPage(page);
    await signIn('staff@care-platform.local', 'correct-staff-password');
    const staffText = (await screen.findByRole('alert')).textContent;

    expect(staffText).toBe(wrongText);
  });
});

describe('the caregiver login, given a caregiver', () => {
  it('still signs them in and takes them to their dashboard', async () => {
    post.mockResolvedValue(tokensFor({ sub: 'c1', email: 'c@example.com', role: 'CAREGIVER', caregiverId: 'cg-1' }));
    renderPage(<CaregiverLoginPage />);

    await signIn('c@example.com', 'right-password');

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/caregiver/dashboard'));
    expect(JSON.parse(window.localStorage.getItem('care-platform-patient-tokens')!).refreshToken).toBe('refresh-token');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the portal each sign-in names', () => {
  it('the caregiver login says it is the caregiver portal', async () => {
    post.mockResolvedValue(tokensFor({ sub: 'c1', role: 'CAREGIVER', caregiverId: 'cg-1' }));
    renderPage(<CaregiverLoginPage />);
    await signIn('c@example.com', 'right-password');

    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/login', { email: 'c@example.com', password: 'right-password', portal: 'caregiver' }));
  });

  it('the client login says it is the customer portal', async () => {
    post.mockResolvedValue(tokensFor({ sub: 'p1', role: 'PATIENT_GUARDIAN' }));
    renderPage(<LoginPage />);
    await signIn('p@example.com', 'right-password');

    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/login', { email: 'p@example.com', password: 'right-password', portal: 'customer' }));
  });
});

describe('the way to the right sign-in', () => {
  // Shown to everyone, whatever they type, so it says nothing about any account.
  it('the caregiver login always links to the client and staff sign-ins', async () => {
    const { container } = renderPage(<CaregiverLoginPage />);
    await screen.findByLabelText(/email/i);

    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
    expect(container.querySelector('a[href="/staff/login"]')).not.toBeNull();
  });

  it('the client login always links to the caregiver and staff sign-ins', async () => {
    const { container } = renderPage(<LoginPage />);
    await screen.findByLabelText(/email/i);

    expect(container.querySelector('a[href="/caregiver/login"]')).not.toBeNull();
    expect(container.querySelector('a[href="/staff/login"]')).not.toBeNull();
  });

  it('does not change after a failed sign-in, so a refusal teaches nothing', async () => {
    post.mockResolvedValue(tokensFor({ sub: 's1', role: 'STAFF' }));
    const { container } = renderPage(<CaregiverLoginPage />);
    const before = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));

    await signIn('staff@care-platform.local', 'correct-staff-password');
    await screen.findByRole('alert');

    expect(Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(before);
  });
});
