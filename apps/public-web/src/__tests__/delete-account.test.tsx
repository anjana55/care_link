import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n';
import DeleteAccountPage from '@/app/delete-account/page';
import en from '@/lib/i18n/dictionaries/en.json';

/**
 * "Delete your account" - the page Google Play asks for. Signed out it offers
 * to sign in and come back; signed in as a client or caregiver it asks for
 * confirmation, makes the same request as the app, and ends the session.
 */

const post = jest.fn();
const logout = jest.fn();
let auth: { user: unknown; loading: boolean } = { user: null, loading: false };

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), usePathname: () => '/delete-account' }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ ...auth, logout }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: jest.fn(), post: (...a: unknown[]) => post(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
// The header and footer bring in branding and navigation that aren't the subject here.
jest.mock('@/components/layout/site-header', () => ({ SiteHeader: () => null }));
jest.mock('@/components/layout/site-footer', () => ({ SiteFooter: () => null }));

const show = () => render(<I18nProvider>{<DeleteAccountPage />}</I18nProvider>);

beforeEach(() => {
  post.mockReset();
  logout.mockReset();
  window.localStorage.clear();
});

it('explains what happens, and signed out offers to sign in and come back', () => {
  auth = { user: null, loading: false };
  show();
  expect(screen.getByRole('heading', { name: en.deleteAccount.title })).toBeTruthy();
  expect(screen.getByText(en.deleteAccount.steps.erased)).toBeTruthy();
  expect(screen.getByText(en.deleteAccount.steps.kept)).toBeTruthy();
  expect(screen.queryByRole('button', { name: en.deleteAccount.delete })).toBeNull();

  const client = screen.getByRole('link', { name: en.deleteAccount.signInClient });
  expect(client.getAttribute('href')).toBe('/login');
  expect(screen.getByRole('link', { name: en.deleteAccount.signInCaregiver }).getAttribute('href')).toBe('/caregiver/login');
  fireEvent.click(client);
  expect(JSON.parse(window.localStorage.getItem('care-platform-return-to')!).path).toBe('/delete-account');
});

it('closes a signed-in account once confirmed, and signs this browser out', async () => {
  auth = { user: { userId: 'u-1', email: 'amali@example.com', role: 'PATIENT_GUARDIAN', patientId: 'p-1' }, loading: false };
  post.mockResolvedValue({ eraseAfter: '2026-11-15T03:30:00.000Z' });
  show();
  expect(screen.getByText('Signed in as amali@example.com')).toBeTruthy();
  const button = screen.getByRole('button', { name: en.deleteAccount.delete }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(post).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('checkbox', { name: en.deleteAccount.confirm }));
  fireEvent.click(button);
  expect(await screen.findByText(en.deleteAccount.done.replace('{date}', '15 Nov 2026'))).toBeTruthy();
  expect(post).toHaveBeenCalledWith('/me/account/deletion');
  expect(logout).toHaveBeenCalled();
});

it("shows the API's reason when it refuses", async () => {
  auth = { user: { userId: 'u-2', email: null, phone: '+94771234567', role: 'CAREGIVER', caregiverId: 'c-1' }, loading: false };
  const { ApiError } = jest.requireActual('@/lib/api/client');
  post.mockRejectedValue(new ApiError(500, 'Something went wrong'));
  show();
  expect(screen.getByText('Signed in as +94771234567')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: en.deleteAccount.confirm }));
  fireEvent.click(screen.getByRole('button', { name: en.deleteAccount.delete }));
  expect(await screen.findByText('Something went wrong')).toBeTruthy();
  await waitFor(() => expect(logout).not.toHaveBeenCalled());
});

it("isn't for staff or employer accounts", () => {
  auth = { user: { userId: 'u-3', email: 'hr@example.com', role: 'EMPLOYER', employerId: 'e-1' }, loading: false };
  show();
  expect(screen.getByText(en.deleteAccount.notHere)).toBeTruthy();
  expect(screen.queryByRole('button', { name: en.deleteAccount.delete })).toBeNull();
});
