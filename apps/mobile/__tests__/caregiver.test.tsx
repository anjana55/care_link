import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { CareChecklistItem, CareChecklistShift, CaregiverPayout, CaregiverShift } from '@care-platform/shared';
import en from '../src/i18n/en.json';
import Today from '../app/(caregiver)/home';
import Shifts from '../app/(caregiver)/shifts';
import Payments from '../app/(caregiver)/payments';
import { remindersFor, REMINDER_KIND } from '../src/caregiver/reminders';
import { screenFor } from '../src/push/notifications';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

// A real phone, whose notifications the app may set.
jest.mock('expo-device', () => ({ isDevice: true }));
const mockNotifications = {
  permission: 'granted',
  scheduled: [] as { identifier: string; content: { data: Record<string, unknown> } }[],
  set: [] as { identifier: string; content: Record<string, any>; trigger: Record<string, any> }[],
  cancelled: [] as string[],
};
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => mockNotifications.scheduled),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => void mockNotifications.cancelled.push(id)),
  getPermissionsAsync: jest.fn(async () => ({ status: mockNotifications.permission })),
  requestPermissionsAsync: jest.fn(async () => ({ status: mockNotifications.permission })),
  scheduleNotificationAsync: jest.fn(async (r: { identifier: string; content: Record<string, any>; trigger: Record<string, any> }) => {
    mockNotifications.set.push(r);
    return r.identifier;
  }),
}));

const HOUR = 60 * 60_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

const shift = (n: number, startsIn: number, over: Partial<CaregiverShift> = {}): CaregiverShift => ({
  id: `s-${n}`,
  startsAt: at(startsIn),
  endsAt: at(startsIn + 8 * HOUR),
  status: 'SCHEDULED',
  isCover: false,
  bookingReference: `BK-${n}`,
  scheduleType: 'DAILY' as never,
  area: 'Dehiwala',
  hasCarePlan: true,
  ...over,
});

const item = (over: Partial<CareChecklistItem> = {}): CareChecklistItem =>
  ({
    occurrenceId: 'o-1',
    activityId: 'a-1',
    dueKey: '08:00',
    dueAt: at(3 * HOUR),
    dueBy: at(4 * HOUR),
    remindAt: at(2 * HOUR),
    reminderMinutesBefore: 60,
    category: 'MEDICATION',
    title: 'Morning tablets',
    instructions: 'With breakfast',
    timing: 'AT_TIMES',
    slot: null,
    isCritical: true,
    status: null,
    source: null,
    reason: null,
    recordedAt: null,
    recordedBy: null,
    ...over,
  }) as CareChecklistItem;

const plan = (shiftId: string, items: CareChecklistItem[]): CareChecklistShift => ({
  shiftId,
  bookingId: 'b-1',
  bookingReference: 'BK-1',
  startsAt: at(HOUR),
  endsAt: at(9 * HOUR),
  shiftStatus: 'SCHEDULED',
  cutOffAt: at(20 * HOUR),
  locked: false,
  canMark: false,
  isCover: false,
  caregiverName: null,
  planNotes: 'Mum likes tea',
  items,
});

const caregiverRecord = { id: 'cg-1', fullName: 'Nimali Perera', registrationNumber: 'CG-0042', status: 'ACTIVE' };
const signIn = () => tokenStore.set(tokensFor('CAREGIVER', { caregiverId: 'cg-1', phone: '+94771234567' }));
const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);

beforeEach(() => {
  mockRouter.reset();
  mockNotifications.permission = 'granted';
  mockNotifications.scheduled = [];
  mockNotifications.set = [];
  mockNotifications.cancelled = [];
});

describe('Today', () => {
  it('shows where the registration stands, the next shifts, and the care plan for the one starting soon', async () => {
    await signIn();
    const calls = serveApi({
      'GET /caregivers/cg-1': () => ({ status: 200, body: caregiverRecord }),
      'GET /me/shifts': () => ({
        status: 200,
        body: [
          shift(9, -30 * HOUR), // over
          shift(5, 72 * HOUR, { area: 'Galle' }), // in three days
          shift(1, HOUR), // soon
          shift(6, 2 * HOUR, { status: 'CANCELLED' }),
        ],
      }),
      'GET /me/shifts/s-1/care': () => ({ status: 200, body: plan('s-1', [item()]) }),
    });
    await show(<Today />);

    expect(await screen.findByText('Nimali Perera')).toBeTruthy();
    expect(screen.getByText(en.portal.status.ACTIVE)).toBeTruthy();
    expect(screen.getByText(en.portal.statusHelp.ACTIVE)).toBeTruthy();
    expect(screen.getByText(`${en.portal.registrationNumber} CG-0042`)).toBeTruthy();

    // Soonest first; the past and the cancelled are left out.
    expect(await screen.findByText('BK-1 · Dehiwala')).toBeTruthy();
    expect(screen.getAllByText(/^BK-\d · /).map((n) => n.props.children)).toEqual(['BK-1 · Dehiwala', 'BK-5 · Galle']);
    expect(screen.queryByText(/BK-9/)).toBeNull();
    expect(screen.queryByText(/BK-6/)).toBeNull();
    // Only the shift starting within a day opens its plan.
    expect(await screen.findAllByText(/Morning tablets/)).toHaveLength(1);
    expect(screen.getByText('Mum likes tea')).toBeTruthy();
    // The shift in three days doesn't open its plan yet.
    expect(calls.some((c) => c.route === 'GET /me/shifts/s-5/care')).toBe(false);
  });

  it('sets the plan’s activity reminders on the phone, replacing only its own', async () => {
    await signIn();
    mockNotifications.scheduled = [
      { identifier: 'care-reminder:old', content: { data: { kind: REMINDER_KIND } } },
      { identifier: 'someone-else', content: { data: { kind: 'other' } } },
    ];
    serveApi({
      'GET /caregivers/cg-1': () => ({ status: 200, body: caregiverRecord }),
      'GET /me/shifts': () => ({ status: 200, body: [shift(1, HOUR)] }),
      'GET /me/shifts/s-1/care': () => ({
        status: 200,
        body: plan('s-1', [
          item(),
          item({ occurrenceId: 'o-2', title: 'Already done', status: 'DONE' }),
          item({ occurrenceId: 'o-3', title: 'No reminder', remindAt: null }),
          item({ occurrenceId: 'o-4', title: 'Reminder passed', remindAt: at(-HOUR) }),
        ]),
      }),
    });
    await show(<Today />);

    await waitFor(() => expect(mockNotifications.set).toHaveLength(1));
    expect(mockNotifications.cancelled).toEqual(['care-reminder:old']);
    const r = mockNotifications.set[0];
    expect(r.identifier).toBe('care-reminder:o-1');
    expect(r.content).toMatchObject({ title: 'Morning tablets', body: '08:00 · BK-1', data: { kind: REMINDER_KIND, path: '/home' } });
    expect(r.trigger.type).toBe('date');
    expect(r.trigger.date.getTime()).toBeGreaterThan(Date.now());
  });

  it('sets nothing when the caregiver doesn’t allow notifications', async () => {
    await signIn();
    mockNotifications.permission = 'denied';
    serveApi({
      'GET /caregivers/cg-1': () => ({ status: 200, body: caregiverRecord }),
      'GET /me/shifts': () => ({ status: 200, body: [shift(1, HOUR)] }),
      'GET /me/shifts/s-1/care': () => ({ status: 200, body: plan('s-1', [item()]) }),
    });
    await show(<Today />);
    await screen.findByText('Mum likes tea');
    await new Promise((r) => setTimeout(r, 50));
    expect(mockNotifications.set).toHaveLength(0);
  });

  it('says when nothing is booked, and sends a client to Find', async () => {
    await signIn();
    serveApi({ 'GET /caregivers/cg-1': () => ({ status: 200, body: caregiverRecord }), 'GET /me/shifts': () => ({ status: 200, body: [] }) });
    await show(<Today />);
    expect(await screen.findByText(en.portal.shifts.noBooked)).toBeTruthy();
    screen.unmount();

    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await show(<Today />);
    expect(await screen.findByText('redirect:/find')).toBeTruthy();
  });
});

describe('Shifts', () => {
  it('opens a shift’s care plan, and reports a problem only on a shift that has started', async () => {
    await signIn();
    const calls = serveApi({
      'GET /me/shifts': () => ({ status: 200, body: [shift(1, -2 * HOUR), shift(2, 48 * HOUR, { hasCarePlan: false })] }),
      'GET /me/issues': () => ({ status: 200, body: [] }),
      'GET /me/shifts/s-1/care': () => ({ status: 200, body: plan('s-1', [item({ status: 'NOT_DONE', source: 'CLIENT' })]) }),
      'POST /me/shifts/s-1/issues': (body) => ({ status: 201, body: { id: 'ir-1', ...body } }),
    });
    await show(<Shifts />);

    expect(await screen.findByText('BK-1 · Dehiwala')).toBeTruthy();
    // One care plan to open, one shift to report on.
    expect(screen.getAllByRole('link', { name: en.carePlan.showPlan })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: en.issues.reportShort })).toHaveLength(1);

    await fireEvent.press(screen.getByRole('link', { name: en.carePlan.showPlan }));
    expect(await screen.findByText(en.carePlan.outcome.notDone)).toBeTruthy();

    await fireEvent.press(screen.getByRole('link', { name: en.issues.reportShort }));
    // The caregiver's own categories.
    expect(screen.getByRole('radio', { name: en.issues.category.PAY })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: en.issues.category.CHARGE })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: en.issues.category.TIMES }));
    await fireEvent.changeText(screen.getByLabelText(en.issues.tellUs), 'I stayed until 9 pm');
    await fireEvent.press(screen.getByRole('button', { name: en.issues.send }));

    expect(await screen.findByText(en.issues.sent)).toBeTruthy();
    expect(calls.find((c) => c.route === 'POST /me/shifts/s-1/issues')!.body).toEqual({ category: 'TIMES', message: 'I stayed until 9 pm' });
  });
});

describe('Payments', () => {
  it('lists statements, and opens one to its lines', async () => {
    await signIn();
    const payouts: CaregiverPayout[] = [
      {
        id: 'p-1',
        reference: 'PO-3',
        status: 'PAID',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        lines: [
          { description: 'Day shift', serviceDate: '2026-10-02', quantity: '1', unit: 'DAY', unitPrice: '3000.00', discount: '0', amount: '3000.00' } as never,
          { description: 'Advance', serviceDate: null, quantity: '1', unit: 'ITEM', unitPrice: '-500.00', discount: '0', amount: '-500.00' } as never,
        ],
        total: '2500.00',
        paidOn: '2026-11-02',
        paymentType: 'BANK',
        paymentMethod: 'BANK_TRANSFER',
        paymentReference: 'TRX-889',
      },
      { id: 'p-2', reference: 'PO-4', status: 'APPROVED', periodStart: '2026-11-01', periodEnd: '2026-11-30', lines: [], total: '9000.00', paidOn: null, paymentType: null, paymentMethod: null, paymentReference: null },
    ];
    serveApi({ 'GET /me/payouts': () => ({ status: 200, body: payouts }) });
    await show(<Payments />);

    expect(await screen.findByText('LKR 2,500.00')).toBeTruthy();
    expect(screen.getByText(`PO-3 · ${en.portal.payments.paidOn.replace('{date}', '2 Nov 2026')}`)).toBeTruthy();
    expect(screen.queryByText('Day shift')).toBeNull();

    await fireEvent.press(screen.getAllByRole('button')[0]);
    expect(screen.getByText(/Day shift/)).toBeTruthy();
    expect(screen.getByText('-LKR 500.00')).toBeTruthy();
    expect(screen.getByText(en.portal.payments.reference.replace('{reference}', 'TRX-889'))).toBeTruthy();

    await fireEvent.press(screen.getAllByRole('button')[1]);
    expect(screen.getByText(en.portal.payments.approvedHint)).toBeTruthy();
  });
});

describe('reminders and notifications', () => {
  it('remind about what still needs doing, once each', () => {
    const when = () => '08:00';
    const now = Date.now();
    const out = remindersFor([plan('s-1', [item(), item({ occurrenceId: 'o-1' })])], when, now);
    expect(out.map((r) => r.id)).toEqual(['care-reminder:o-1']);
    expect(remindersFor([plan('s-1', [item({ status: 'NOT_DONE' })])], when, now)).toEqual([]);
  });

  it('open the caregiver’s Shifts and Payments', () => {
    expect(screenFor('/shifts')).toBe('/shifts');
    expect(screenFor('/payments')).toBe('/payments');
    expect(screenFor('/shifts/x')).toBe('/home');
  });
});
