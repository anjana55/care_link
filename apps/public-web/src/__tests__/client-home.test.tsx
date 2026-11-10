import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationsSummary } from '@care-platform/shared';
import { I18nProvider } from '@/lib/i18n';
import AccountHomePage from '@/app/account/page';
import { accountHome } from '@/lib/account-home';

/** A client's home on the website: what is waiting, then a card for each thing they can do. */

const get = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/account',
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
  useAuth: () => ({ user: { userId: 'u-client', email: 'amali@example.com', role: 'PATIENT_GUARDIAN', patientId: 'p-1' }, loading: false, logout: jest.fn() }),
}));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

function show(summary: NotificationsSummary) {
  get.mockImplementation(async (path: string) => {
    if (path === '/me/notifications/summary') return summary;
    throw new Error(`unexpected ${path}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <I18nProvider>
        <AccountHomePage />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const card = (name: RegExp) => screen.getByRole('link', { name });

describe('client home', () => {
  beforeEach(() => get.mockReset());

  it('is where My account lands for a client', () => {
    expect(accountHome({ role: 'PATIENT_GUARDIAN' })).toBe('/account');
  });

  it('greets by name, lists what is waiting and puts the numbers on the cards', async () => {
    show({
      unread: 2,
      badge: 4,
      firstName: 'Amali',
      unreadBy: { REQUEST: 2 },
      todos: [
        { key: 'invoice:1', kind: 'PAY_INVOICE', path: '/invoices/1', urgent: true, dueOn: '2026-11-01', params: { number: 'INV-7', amount: 'LKR 12,500.00', overdue: 1 } },
        { key: 'care:1', kind: 'TICK_OFF_CARE', path: '/bookings', urgent: false, dueOn: null, params: { count: 3 } },
      ],
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Amali' })).toBeDefined();
    expect(screen.getByText(/INV-7/)).toBeDefined();

    expect(card(/Find caregivers/).getAttribute('href')).toBe('/find');
    expect(within(card(/^Bookings/)).getByLabelText('1 waiting')).toBeDefined();
    expect(within(card(/^Invoices/)).getByLabelText('1 waiting')).toBeDefined();
    expect(within(card(/My requests/)).getByLabelText('2 waiting')).toBeDefined();
    expect(within(card(/Saved caregivers/)).queryByLabelText(/waiting/)).toBeNull();
  });

  it('says so when nothing is waiting', async () => {
    show({ unread: 0, badge: 0, todos: [], firstName: null });
    expect(await screen.findByText('Nothing to do right now.')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'My account' })).toBeDefined();
  });
});
