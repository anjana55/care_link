import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';

/** The signed-in header's phone menu: everything but the bell, as labelled rows. */

const logout = jest.fn();
const hardNavigate = jest.fn();
let user: unknown = null;

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), usePathname: () => '/find' }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/navigation', () => ({ hardNavigate: (url: string) => hardNavigate(url) }));
jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ user, loading: false, logout }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: jest.fn(async () => ({ unread: 0, todos: [], badge: 0 })), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <I18nProvider>
        <SiteHeader />
      </I18nProvider>
    </QueryClientProvider>,
  );

describe('site header phone menu', () => {
  beforeEach(() => {
    logout.mockReset();
    hardNavigate.mockReset();
  });

  it('is not offered to a signed-out visitor, who keeps Sign in on the bar', () => {
    user = null;
    show();
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeDefined();
  });

  it('opens to labelled rows and signs out from there', () => {
    user = { userId: 'u-1', email: 'amali@example.com', role: 'PATIENT_GUARDIAN', patientId: 'p-1' };
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    const menu = within(document.getElementById('site-phone-menu')!);
    expect(menu.getByRole('link', { name: 'My account' }).getAttribute('href')).toBe('/account');
    expect(menu.getByRole('link', { name: 'Hire from Sri Lanka' }).getAttribute('href')).toBe('/international');
    expect(menu.getByText('Language')).toBeDefined();

    fireEvent.click(menu.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
    expect(hardNavigate).toHaveBeenCalledWith('/');
  });

  it('closes on Esc', () => {
    user = { userId: 'u-1', email: 'amali@example.com', role: 'PATIENT_GUARDIAN', patientId: 'p-1' };
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('site-phone-menu')).toBeNull();
  });
});
