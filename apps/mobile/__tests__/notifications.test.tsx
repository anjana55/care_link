import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { NotificationItem, NotificationsSummary, TodoItem } from '@care-platform/shared';
import en from '../src/i18n/en.json';
import NotificationsScreen from '../app/notifications';
import { Bell, badgeLabel } from '../src/notifications/Bell';
import { TodoCards } from '../src/notifications/TodoCards';
import { pinImportant } from '../src/notifications/Lists';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

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
  body: 'Your booking BK-1 starts on 10 Nov.',
  path: '/bookings/b-1',
  link: null,
  important: false,
  createdAt: '2026-11-04T05:00:00.000Z',
  readAt: null,
  ...over,
});

function serve(summary: NotificationsSummary, items: NotificationItem[] = [], nextCursor: string | null = null) {
  return serveApi({
    'GET /me/notifications/summary': () => ({ status: 200, body: summary }),
    'GET /me/notifications': (_b, q) => (q.before ? { status: 200, body: { items: [notice({ id: 'n-0', title: 'An older one' })], nextCursor: null } } : { status: 200, body: { items, nextCursor } }),
    'POST /me/notifications/read': () => ({ status: 200, body: { marked: 1 } }),
  });
}

const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);

beforeEach(async () => {
  mockRouter.reset();
  await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
});

describe('the bell', () => {
  it('shows unread notifications plus things to do as one number, and opens Notifications', async () => {
    serve({ unread: 2, todos: [todo()], badge: 3 });
    await show(<Bell />);
    const bell = await screen.findByLabelText('Notifications, 3 new');
    expect(screen.getByText('3', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(bell);
    expect(mockRouter.push).toHaveBeenCalledWith('/notifications');
    expect(badgeLabel(14)).toBe('9+');
  });

  it('is not there for someone who is not signed in', async () => {
    await tokenStore.clear();
    const calls = serve({ unread: 0, todos: [], badge: 0 });
    await show(<Bell />);
    await waitFor(() => expect(screen.queryByLabelText(/Notifications/)).toBeNull());
    expect(calls.some((c) => c.route === 'GET /me/notifications/summary')).toBe(false);
  });
});

describe('the Notifications screen', () => {
  it('leads with To do, each with one big button that opens the right screen', async () => {
    serve({ unread: 0, badge: 2, todos: [todo(), todo({ key: 'r', kind: 'RATE_CAREGIVER', path: '/bookings/b0000000-0000-4000-8000-000000000001/rate/pub_1', urgent: false, dueOn: null, params: { reference: 'BK-9' } })] });
    await show(<NotificationsScreen />);
    expect(await screen.findByText('Invoice INV-7 (LKR 12,500.00) is overdue')).toBeTruthy();
    expect(screen.getByText(en.notifications.text.RATE_CAREGIVER.replace('{reference}', 'BK-9'))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Pay now: Invoice INV-7 (LKR 12,500.00) is overdue'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/invoices/${INVOICE}`);
    await fireEvent.press(screen.getByLabelText(`Rate: ${en.notifications.text.RATE_CAREGIVER.replace('{reference}', 'BK-9')}`));
    expect(mockRouter.push).toHaveBeenCalledWith('/bookings/b0000000-0000-4000-8000-000000000001/rate/pub_1');
    // Let the history finish loading before the screen goes.
    expect(await screen.findByText(en.notifications.empty)).toBeTruthy();
  });

  it('opens a notification, marks it read, and marks all read', async () => {
    const calls = serve({ unread: 1, todos: [], badge: 1 }, [notice()]);
    await show(<NotificationsScreen />);
    await fireEvent.press(await screen.findByLabelText(/Booking confirmed/));
    expect(mockRouter.push).toHaveBeenCalledWith('/bookings');
    await waitFor(() => expect(calls.find((c) => c.route === 'POST /me/notifications/read')?.body).toEqual({ ids: ['n-1'] }));

    await fireEvent.press(await screen.findByLabelText(en.notifications.markAllRead));
    await waitFor(() => expect(calls.filter((c) => c.route === 'POST /me/notifications/read').map((c) => c.body)).toContainEqual({ all: true }));
  });

  it('pins an important announcement, opens its link on the website, and loads older ones', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    serve({ unread: 2, todos: [], badge: 2 }, [notice(), notice({ id: 'n-2', category: 'ANNOUNCEMENT', title: 'Office closed on Poya day', path: '/notifications', link: '/account/bookings', important: true })], 'c-1');
    await show(<NotificationsScreen />);
    expect(await screen.findByText('Office closed on Poya day')).toBeTruthy();
    expect(screen.getByText(en.notifications.important)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.notifications.openLink));
    expect(open).toHaveBeenCalledWith('https://find.caregivers.lk/account/bookings');
    await fireEvent.press(screen.getByLabelText(en.notifications.loadMore));
    expect(await screen.findByText('An older one')).toBeTruthy();
    open.mockRestore();
  });

  it('says when there is nothing yet', async () => {
    serve({ unread: 0, todos: [], badge: 0 });
    await show(<NotificationsScreen />);
    expect(await screen.findByText(en.notifications.todoEmpty)).toBeTruthy();
    expect(await screen.findByText(en.notifications.empty)).toBeTruthy();
  });

  it('pins only unread important notices', () => {
    const order = pinImportant([notice({ id: 'c' }), notice({ id: 'a', important: true, readAt: '2026-11-04T06:00:00.000Z' }), notice({ id: 'b', important: true })]);
    expect(order.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('To do cards', () => {
  it("leave out what a caregiver's Today already shows, and write the rest in the caregiver's words", async () => {
    await tokenStore.set(tokensFor('CAREGIVER'));
    serve({
      unread: 0,
      badge: 3,
      todos: [
        todo({ key: 'document:police', kind: 'DOCUMENT_REJECTED', path: '/documents', params: { document: 'police' } }),
        todo({ key: 'expiry:x', kind: 'DOCUMENT_EXPIRING', path: '/documents', urgent: false, params: { document: 'PASSPORT', daysLeft: -2 } }),
        todo({ key: 'shift:x', kind: 'SHIFT_TODAY', path: '/shifts', params: { time: '08:00', reference: 'BK-3' } }),
      ],
    });
    await show(<TodoCards skip={['UPLOAD_DOCUMENT', 'DOCUMENT_REJECTED']} />);
    expect(await screen.findByText('Your passport has expired')).toBeTruthy();
    expect(screen.getByText('Shift today at 08:00 (BK-3)')).toBeTruthy();
    expect(screen.queryByText(/police clearance/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('View shift: Shift today at 08:00 (BK-3)'));
    expect(mockRouter.push).toHaveBeenCalledWith('/shifts');
  });

  it('show nothing when there is nothing to do', async () => {
    const calls = serve({ unread: 5, todos: [], badge: 5 });
    await show(<TodoCards />);
    await waitFor(() => expect(calls.some((c) => c.route === 'GET /me/notifications/summary')).toBe(true));
    expect(screen.queryByText(en.notifications.todo)).toBeNull();
  });
});
