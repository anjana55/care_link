import { Text } from 'react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { NotificationsSummary, TodoItem, TodoKind } from '@care-platform/shared';
import CaregiverTabs from '../app/(caregiver)/_layout';
import ClientTabs from '../app/(client)/_layout';
import { AppProviders } from '../test-utils/app';

/**
 * Numbers on the tab bar: a tab says how many things are waiting behind it,
 * from the same summary as the bell, and says nothing when there are none.
 */
jest.mock('@expo/vector-icons/Ionicons', () => Object.assign(() => null, { glyphMap: {} }));

let mockSummary: NotificationsSummary | undefined;
jest.mock('@/notifications/api', () => ({
  ...jest.requireActual('@/notifications/api'),
  useNotificationsSummary: () => ({ data: mockSummary, isPending: false }),
}));

const todo = (kind: TodoKind, n: number): TodoItem => ({ key: `${kind}:${n}`, kind, path: '/', urgent: false, dueOn: null, params: {} });
const page = (name: string) => () => <Text>{name}</Text>;

const app = (initialUrl: string) =>
  renderRouter(
    {
      _layout: () => (
        <AppProviders>
          <Stack screenOptions={{ headerShown: false }} />
        </AppProviders>
      ),
      '(caregiver)/_layout': CaregiverTabs,
      '(caregiver)/home': page('Today'),
      '(caregiver)/shifts': page('Shifts'),
      '(caregiver)/payments': page('Payments'),
      '(caregiver)/me': page('Me'),
      '(caregiver)/documents': page('Documents'),
      '(caregiver)/profile': page('Profile'),
      '(caregiver)/ratings': page('Ratings'),
      '(client)/_layout': ClientTabs,
      '(client)/start': page('Home'),
      '(client)/find': page('Find'),
      '(client)/bookings': page('Bookings'),
      '(client)/account': page('Account'),
      '(client)/requests': page('Requests'),
      '(client)/saved': page('Saved'),
      '(client)/invoices': page('Invoices'),
    },
    { initialUrl },
  );

describe('tab bar numbers', () => {
  it('client: care and ratings on Bookings, invoices and office replies on My account', async () => {
    mockSummary = {
      unread: 2,
      badge: 5,
      unreadBy: { REQUEST: 2 },
      todos: [todo('TICK_OFF_CARE', 1), todo('RATE_CAREGIVER', 1), todo('PAY_INVOICE', 1)],
    };
    const r = await app('/start');
    expect(r.getByRole('button', { name: 'Bookings, 2 waiting' })).toBeTruthy();
    expect(r.getByRole('button', { name: 'My account, 3 waiting' })).toBeTruthy();
  });

  it('caregiver: documents on My account', async () => {
    mockSummary = { unread: 0, badge: 2, todos: [todo('UPLOAD_DOCUMENT', 1), todo('DOCUMENT_EXPIRING', 1), todo('SHIFT_TODAY', 1)] };
    const r = await app('/home');
    expect(r.getByRole('button', { name: 'My account, 2 waiting' })).toBeTruthy();
  });

  it('shows no number when nothing is waiting', async () => {
    mockSummary = { unread: 0, badge: 0, todos: [] };
    const r = await app('/start');
    expect(r.queryByRole('button', { name: /waiting/ })).toBeNull();
    expect(r.getByRole('button', { name: /Bookings/ })).toBeTruthy();
  });
});
