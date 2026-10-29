import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CaregiverClaimPage from '@/app/caregiver/claim/page';
import { I18nProvider } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { hardNavigate } from '@/lib/navigation';

// Full page loads go through hardNavigate; jsdom can neither perform them nor,
// since jsdom 26, let window.location be replaced to watch for them.
jest.mock('@/lib/navigation', () => ({ hardNavigate: jest.fn() }));

/**
 * "Finish setting up your account": registration number -> code -> the same
 * provider buttons the registration form ends with. The page must hand the
 * pending token from the verify step to those buttons unchanged, and must
 * never claim a code was definitely sent (the API will not say).
 */

const get = jest.fn();
const post = jest.fn();

jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ user: null, logout: jest.fn() }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <CaregiverClaimPage />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

it('walks from registration number to code to the provider buttons', async () => {
  post.mockImplementation((path: string) => {
    if (path === '/auth/caregiver/claim/start') return Promise.resolve({ message: 'sent', resendAfterSeconds: 60 });
    if (path === '/auth/caregiver/claim/verify')
      return Promise.resolve({
        registrationNumber: 'CG-2026-123456',
        pendingToken: 'pending-abc',
        pendingTokenExpiresInSeconds: 900,
        providers: { GOOGLE: true, MICROSOFT: false, FACEBOOK: false },
      });
    return Promise.reject(new Error('unexpected ' + path));
  });
  get.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2' });

  renderPage();
  fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: 'cg-2026-123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));

  await screen.findByLabelText(/^Code/);
  // Normalised before it is sent or shown.
  expect(post).toHaveBeenCalledWith('/auth/caregiver/claim/start', { registrationNumber: 'CG-2026-123456' });
  expect(screen.getByText(/Registration number: CG-2026-123456/)).toBeInTheDocument();
  // Hedged wording: the API answers the same whether or not anything was sent.
  expect(screen.getByText(/If this registration can be finished online/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: '482915' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  const google = await screen.findByRole('button', { name: 'Continue with Google' });
  expect(post).toHaveBeenCalledWith('/auth/caregiver/claim/verify', { registrationNumber: 'CG-2026-123456', code: '482915' });

  const assign = jest.fn();
  jest.mocked(hardNavigate).mockImplementation(assign);
  fireEvent.click(google);
  await waitFor(() => expect(get).toHaveBeenCalledWith('/auth/social/google/authorize-url', { token: 'pending-abc' }));
});

it('lets someone with a staff-issued code skip sending one', async () => {
  post.mockRejectedValue(new ApiError(401, 'This code is invalid or has expired. Request a new one and try again.'));
  renderPage();
  fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: 'CG-2026-123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'I have a code from the CareLink office' }));

  await screen.findByText('Enter the code the CareLink office gave you.');
  expect(post).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: 'ABCD-EFGH' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This code is invalid or has expired');
});

it('asks for the registration number before doing anything', () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter your registration number');
  expect(post).not.toHaveBeenCalled();
});

// A pasted note in the number box used to be carried to the code step and
// echoed as "Registration number: ADD A WAY TO CHANGE...", failing only when
// the code was submitted, with a misleading "Enter your registration number".
it.each([
  ['Send me a code'],
  ['I have a code from the CareLink office'],
])('stops on step one when the number is not a registration number (%s)', (button) => {
  renderPage();
  fireEvent.change(screen.getByLabelText(/Registration number/), {
    target: { value: 'add a way to change caregiver email address. right now, before signin' },
  });
  fireEvent.click(screen.getByRole('button', { name: button }));
  expect(screen.getByRole('alert')).toHaveTextContent("That doesn't look like a registration number");
  expect(screen.queryByLabelText(/^Code/)).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

it('accepts the ways people retype a registration number', async () => {
  renderPage();
  fireEvent.change(screen.getByLabelText(/Registration number/), { target: { value: ' cg 2026\u2013123456 ' } });
  fireEvent.click(screen.getByRole('button', { name: 'I have a code from the CareLink office' }));
  await screen.findByLabelText(/^Code/);
  expect(screen.getByText(/Registration number: CG-2026-123456/)).toBeInTheDocument();
});
