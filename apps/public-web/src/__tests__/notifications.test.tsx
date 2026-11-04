import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationItem, NotificationsPage as Page, NotificationsSummary, TodoItem } from '@care-platform/shared';
import { I18nProvider } from '@/lib/i18n';
import { NotificationBell, badgeLabel } from '@/components/notifications/notification-bell';
import { NotificationsPage, TodoCards } from '@/components/notifications/notifications-page';
import { pinImportant } from '@/components/notifications/notification-list';
import { SiteHeader } from '@/components/layout/site-header';

/**
 * The bell on the public site. The API is replaced by recorded calls; what
 * the API sends, to whom, is covered by apps/api's notifications e2e suite.
 */

const get = jest.fn();
const post = jest.fn();
let auth: { user: unknown; loading: boolean } = { user: null, loading: false };
let wide = true;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/account/requests',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/hooks/use-media-query', () => ({ useMediaQuery: () => wide }));
jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ ...auth, logout: jest.fn() }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const CLIENT = { userId: 'u-client', email: 'amali@example.com', role: 'PATIENT_GUARDIAN', patientId: 'p-1' };
const CAREGIVER = { userId: 'u-cg', email: 'nimal@example.com', role: 'CAREGIVER', caregiverId: 'cg-1' };
const STAFF = { userId: 'u-staff', email: 'staff@example.com', role: 'STAFF' };
const INVOICE = 'a0000000-0000-4000-8000-000000000001';

const todo = (over: Partial<TodoItem> = {}): TodoItem => ({
  key: `invoice:${INVOICE}`,
  kind: 'PAY_INVOICE',
  path: `/invoices/${INVOICE}`,
  urgent: true,
  dueOn: '2026-11-01',
  params: { number: 'INV-7', amount: 'LKR 12,500.00', overdue: 1 },
  ...over,
});
const notice = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n-1',
  category: 'BOOKING',
  title: 'Booking confirmed',
  body: 'Your booking BK-1 starts on 2026-11-10.',
  path: '/bookings/b-1',
  link: null,
  important: false,
  createdAt: '2026-11-04T05:00:00.000Z',
  readAt: null,
  ...over,
});

function answer(summary: NotificationsSummary, page: Page = { items: [], nextCursor: null }) {
  get.mockImplementation(async (path: string) => {
    if (path === '/me/notifications/summary') return summary;
    if (path === '/me/notifications') return page;
    throw new Error(`unexpected ${path}`);
  });
}

function renderUi(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{ui}</I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset().mockResolvedValue({ marked: 1 });
  auth = { user: CLIENT, loading: false };
  wide = true;
});

describe('the bell', () => {
  it('shows unread notifications plus things to do as one number, and caps it at 9+', async () => {
    answer({ unread: 2, todos: [todo()], badge: 3 });
    renderUi(<NotificationBell />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 3 new' });
    expect(within(bell).getByText('3')).toBeInTheDocument();
    expect(badgeLabel(12)).toBe('9+');
  });

  it('opens a panel with To do first, then recent notifications, and marks one read when opened', async () => {
    answer({ unread: 1, todos: [todo()], badge: 2 }, { items: [notice()], nextCursor: null });
    renderUi(<NotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 new' }));
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(within(panel).getByText('Invoice INV-7 (LKR 12,500.00) is overdue')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Pay now' })).toHaveAttribute('href', `/account/invoices/${INVOICE}`);
    const item = await within(panel).findByRole('link', { name: /Booking confirmed/ });
    expect(item).toHaveAttribute('href', '/account/bookings');
    fireEvent.click(item);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/me/notifications/read', { ids: ['n-1'] }));
    expect(within(panel).getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/account/notifications');
  });

  it('marks everything read from the panel', async () => {
    answer({ unread: 3, todos: [], badge: 3 }, { items: [notice()], nextCursor: null });
    renderUi(<NotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 3 new' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/me/notifications/read', { all: true }));
  });

  it('goes straight to the notifications page on a phone', async () => {
    wide = false;
    auth = { user: CAREGIVER, loading: false };
    answer({ unread: 0, todos: [], badge: 0 });
    renderUi(<NotificationBell />);
    expect(await screen.findByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/caregiver/notifications');
  });

  it('is only for clients and caregivers', () => {
    auth = { user: STAFF, loading: false };
    renderUi(<NotificationBell />);
    expect(screen.queryByRole('button', { name: /Notifications/ })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('sits in the site header for a signed-in client', async () => {
    answer({ unread: 1, todos: [], badge: 1 });
    renderUi(<SiteHeader />);
    expect(await screen.findByRole('button', { name: 'Notifications, 1 new' })).toBeInTheDocument();
  });

  it('checks again every minute', async () => {
    jest.useFakeTimers();
    try {
      answer({ unread: 0, todos: [], badge: 0 });
      renderUi(<NotificationBell />);
      await act(async () => {
        await Promise.resolve();
      });
      const before = get.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(61_000);
      });
      expect(get.mock.calls.length).toBeGreaterThan(before);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('To do', () => {
  it("writes a caregiver's to-dos in their language, with one button each", async () => {
    auth = { user: CAREGIVER, loading: false };
    answer({
      unread: 0,
      badge: 3,
      todos: [
        todo({ key: 'document:police', kind: 'DOCUMENT_REJECTED', path: '/documents', dueOn: null, params: { document: 'police' } }),
        todo({ key: 'expiry:x', kind: 'DOCUMENT_EXPIRING', path: '/documents', urgent: false, dueOn: '2026-11-20', params: { document: 'PASSPORT', daysLeft: 16 } }),
        todo({ key: 'shift:x', kind: 'SHIFT_TODAY', path: '/shifts', params: { time: '08:00', reference: 'BK-3' } }),
      ],
    });
    renderUi(<TodoCards />);
    expect(await screen.findByText('Upload your police clearance certificate again - the last one could not be accepted')).toBeInTheDocument();
    expect(screen.getByText('Your passport expires in 16 days')).toBeInTheDocument();
    expect(screen.getByText('Shift today at 08:00 (BK-3)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View shift' })).toHaveAttribute('href', '/caregiver/shifts');
    expect(screen.getAllByRole('link', { name: /Upload/ }).map((a) => a.getAttribute('href'))).toEqual(['/caregiver/documents', '/caregiver/documents']);
  });

  it('shows nothing on the landing page when there is nothing to do', async () => {
    answer({ unread: 4, todos: [], badge: 4 });
    const { container } = renderUi(<TodoCards />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('reads in Sinhala', async () => {
    window.localStorage.setItem('care-platform-public-locale', 'si');
    try {
      answer({ unread: 0, badge: 1, todos: [todo({ kind: 'RATE_CAREGIVER', key: 'r', path: '/bookings/b/rate/p', urgent: false, params: { reference: 'BK-9' } })] });
      renderUi(<TodoCards />);
      expect(await screen.findByText(/BK-9/)).toHaveTextContent('සත්කාරකයා ශ්‍රේණිගත කරන්න');
    } finally {
      window.localStorage.removeItem('care-platform-public-locale');
    }
  });
});

describe('the notifications page', () => {
  it('lists the history, pins important unread notices, opens announcement links, and loads older ones', async () => {
    const announcement = notice({ id: 'n-2', category: 'ANNOUNCEMENT', title: 'Office closed on Poya day', body: 'Closed Friday', path: '/notifications', link: 'https://example.lk/hours', important: true });
    answer({ unread: 2, todos: [], badge: 2 }, { items: [notice(), announcement], nextCursor: 'c-1' });
    renderUi(<NotificationsPage />);
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Office closed on Poya day');
    expect(items[0]).toHaveTextContent('Important');
    expect(screen.getByRole('link', { name: 'Open link' })).toHaveAttribute('target', '_blank');

    fireEvent.click(screen.getByRole('button', { name: /Office closed on Poya day/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/me/notifications/read', { ids: ['n-2'] }));

    get.mockImplementation(async (path: string, params?: { before?: string }) => {
      if (path === '/me/notifications' && params?.before === 'c-1') return { items: [notice({ id: 'n-0', title: 'Older one' })], nextCursor: null };
      if (path === '/me/notifications/summary') return { unread: 2, todos: [], badge: 2 };
      return { items: [notice(), announcement], nextCursor: 'c-1' };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(await screen.findByText('Older one')).toBeInTheDocument();
  });

  it('says when there is nothing yet', async () => {
    answer({ unread: 0, todos: [], badge: 0 });
    renderUi(<NotificationsPage />);
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
    expect(screen.getByText('Nothing to do right now.')).toBeInTheDocument();
  });

  it('pins only unread important notices', () => {
    const read = notice({ id: 'a', important: true, readAt: '2026-11-04T06:00:00.000Z' });
    const pinned = notice({ id: 'b', important: true });
    expect(pinImportant([notice({ id: 'c' }), read, pinned]).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
});
