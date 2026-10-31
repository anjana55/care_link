import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { CareChecklistItem, CareChecklistShift, ClientBooking, ClientCareDay } from '@care-platform/shared';
import en from '../src/i18n/en.json';
import Bookings from '../app/(client)/bookings';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

const CG = '11111111-2222-4333-8444-555555555555';

const booking = (over: Partial<ClientBooking> = {}): ClientBooking =>
  ({
    id: 'b-1',
    reference: 'BK-7Q2',
    status: 'CONFIRMED',
    scheduleType: 'DAILY',
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    rateType: 'DAILY',
    rateAmount: '3500.00',
    caregiverPublicId: CG,
    caregiver: null,
    shifts: [
      // 08:00-20:00 and an overnight 20:00-08:00, Sri Lanka time.
      { id: 's-1', startsAt: '2026-11-02T02:30:00.000Z', endsAt: '2026-11-02T14:30:00.000Z', status: 'SCHEDULED', isCover: false },
      { id: 's-2', startsAt: '2026-11-02T14:30:00.000Z', endsAt: '2026-11-03T02:30:00.000Z', status: 'SCHEDULED', isCover: true },
    ],
    ...over,
  }) as ClientBooking;

const item = (over: Partial<CareChecklistItem> = {}): CareChecklistItem =>
  ({
    occurrenceId: 'o-1',
    activityId: 'a-1',
    dueKey: '08:00',
    dueAt: '2026-11-02T02:30:00.000Z',
    dueBy: '2026-11-02T03:30:00.000Z',
    remindAt: null,
    reminderMinutesBefore: null,
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

const shift = (over: Partial<CareChecklistShift> = {}): CareChecklistShift => ({
  shiftId: 's-1',
  bookingId: 'b-1',
  bookingReference: 'BK-7Q2',
  startsAt: '2026-11-02T02:30:00.000Z',
  endsAt: '2026-11-02T14:30:00.000Z',
  shiftStatus: 'SCHEDULED',
  cutOffAt: '2026-11-02T18:30:00.000Z',
  locked: false,
  canMark: true,
  isCover: false,
  caregiverName: null,
  planNotes: 'Mum prefers tea, not coffee',
  items: [item(), item({ activityId: 'a-2', dueKey: 'MORNING', timing: 'SLOT', slot: 'MORNING', title: 'Short walk', isCritical: false, instructions: '' })],
  ...over,
});

const day = (over: Partial<ClientCareDay> = {}): ClientCareDay => ({
  date: '2026-11-02',
  today: '2026-11-02',
  reminders: true,
  hasCarePlans: true,
  shifts: [shift()],
  ...over,
});

const client = () => tokenStore.set(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1' }));
const show = () => render(<AppProviders><Bookings /></AppProviders>);

beforeEach(() => mockRouter.reset());

describe('bookings', () => {
  it('lists each booking with its dates, rate and shifts in Sri Lanka time', async () => {
    await client();
    serveApi({
      'GET /me/bookings': () => ({ status: 200, body: [booking()] }),
      'GET /me/care': () => ({ status: 200, body: day({ hasCarePlans: false }) }),
    });
    await show();

    expect(await screen.findByText('BK-7Q2')).toBeTruthy();
    expect(screen.getByText(en.account.bookings.status.CONFIRMED)).toBeTruthy();
    expect(screen.getByText(`LKR 3,500.00 ${en.account.bookings.rateUnit.DAILY}`)).toBeTruthy();
    expect(screen.getByText('08:00–20:00')).toBeTruthy();
    // The overnight shift ends the next day, and someone else is covering it.
    expect(screen.getByText(/20:00–08:00/)).toHaveTextContent(`20:00–08:00 (+1) ${en.account.bookings.cover}`);
    expect(screen.getByText(en.account.requests.notOnline)).toBeTruthy();
    // No care plan: no checklist.
    expect(screen.queryByText(en.carePlan.todayTitle)).toBeNull();
  });

  it('says when there are none yet, and points to the requests', async () => {
    await client();
    serveApi({
      'GET /me/bookings': () => ({ status: 200, body: [] }),
      'GET /me/care': () => ({ status: 200, body: day({ hasCarePlans: false }) }),
    });
    await show();
    expect(await screen.findByText(en.account.bookings.empty)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.care.viewRequests }));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/requests');
  });

  it('asks someone without an account to sign in', async () => {
    serveApi({});
    await show();
    expect(await screen.findByRole('button', { name: en.signIn.client })).toBeTruthy();
  });
});

describe('today’s care', () => {
  it('ticks items off: Done, or Not done with what happened', async () => {
    await client();
    let current = shift();
    const calls = serveApi({
      'GET /me/bookings': () => ({ status: 200, body: [booking()] }),
      'GET /me/care': () => ({ status: 200, body: day({ shifts: [current] }) }),
      'PUT /me/care/records': (body) => {
        current = {
          ...current,
          items: current.items.map((i) => (i.activityId === body.activityId ? { ...i, status: body.status as 'DONE', source: 'CLIENT', reason: (body.reason as string) ?? null } : i)),
        };
        return { status: 200, body: current };
      },
    });
    await show();

    expect(await screen.findByText(en.carePlan.todayTitle)).toBeTruthy();
    expect(screen.getByText(en.carePlan.leftToReview.replace('{count}', '2'))).toBeTruthy();
    expect(screen.getByText('Mum prefers tea, not coffee')).toBeTruthy();
    expect(screen.getByText(en.carePlan.slot.MORNING)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: `${en.carePlan.done}: Morning tablets` }));
    await waitFor(() => expect(screen.getByRole('button', { name: `${en.carePlan.done}: Morning tablets` })).toBeSelected());
    expect(screen.getByText(en.carePlan.leftToReview.replace('{count}', '1'))).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: `${en.carePlan.notDone}: Short walk` }));
    const why = await screen.findByLabelText(en.carePlan.reasonPlaceholder);
    await fireEvent.changeText(why, '  Raining all morning ');
    await fireEvent.press(screen.getByRole('button', { name: en.carePlan.saveReason }));
    expect(await screen.findByText('“Raining all morning”')).toBeTruthy();

    expect(calls.filter((c) => c.route === 'PUT /me/care/records').map((c) => c.body)).toEqual([
      { shiftId: 's-1', activityId: 'a-1', dueKey: '08:00', status: 'DONE', reason: null },
      { shiftId: 's-1', activityId: 'a-2', dueKey: 'MORNING', status: 'NOT_DONE', reason: null },
      { shiftId: 's-1', activityId: 'a-2', dueKey: 'MORNING', status: 'NOT_DONE', reason: 'Raining all morning' },
    ]);
  });

  it('shows a closed day read-only, with what was recorded', async () => {
    await client();
    serveApi({
      'GET /me/bookings': () => ({ status: 200, body: [booking()] }),
      'GET /me/care': () => ({
        status: 200,
        body: day({
          shifts: [
            shift({
              locked: true,
              canMark: false,
              items: [item({ status: 'DONE', source: 'AUTO' }), item({ activityId: 'a-2', title: 'Short walk', status: 'NOT_DONE', source: 'CLIENT', reason: 'Rain' })],
            }),
          ],
        }),
      }),
    });
    await show();
    expect(await screen.findByText(en.carePlan.closed)).toBeTruthy();
    expect(screen.getByText(en.carePlan.outcome.auto)).toBeTruthy();
    expect(screen.getByText(en.carePlan.outcome.notDone)).toBeTruthy();
    expect(screen.queryByRole('button', { name: `${en.carePlan.done}: Morning tablets` })).toBeNull();
    expect(screen.queryByText(/Left to review/)).toBeNull();
  });

  it('moves between days, and back to today', async () => {
    await client();
    // The API answers for the day asked about.
    const calls = serveApi({
      'GET /me/bookings': () => ({ status: 200, body: [booking()] }),
      'GET /me/care': (_, query) => {
        const date = query.date ?? '2026-11-02';
        return { status: 200, body: day({ date, shifts: date === '2026-11-02' ? [shift()] : [] }) };
      },
    });
    await show();

    await fireEvent.press(await screen.findByRole('button', { name: en.carePlan.nextDay }));
    expect(await screen.findByText(en.carePlan.dayTitle.replace('{date}', '3 Nov 2026'))).toBeTruthy();
    expect(screen.getByText(en.carePlan.nothingThisDay)).toBeTruthy();
    expect(calls.filter((c) => c.route === 'GET /me/care').map((c) => c.query.date)).toContain('2026-11-03');

    await fireEvent.press(screen.getByRole('link', { name: en.carePlan.today }));
    expect(await screen.findByText(en.carePlan.todayTitle)).toBeTruthy();
  });

  it('switches the 8 pm reminder off and on', async () => {
    await client();
    let reminders = true;
    const calls = serveApi({
      'GET /me/bookings': () => ({ status: 200, body: [] }),
      'GET /me/care': () => ({ status: 200, body: day({ reminders }) }),
      'PUT /me/care/reminders': (body) => ((reminders = body.enabled as boolean), { status: 200, body: { reminders } }),
    });
    await show();
    const toggle = await screen.findByLabelText(en.carePlan.reminders);
    expect(toggle).toHaveProp('value', true);
    await fireEvent(toggle, 'valueChange', false);
    await waitFor(() => expect(screen.getByLabelText(en.carePlan.reminders)).toHaveProp('value', false));
    expect(calls.find((c) => c.route === 'PUT /me/care/reminders')!.body).toEqual({ enabled: false });
  });

  it('shows the API’s reason when an item can’t be marked', async () => {
    await client();
    serveApi({
      'GET /me/bookings': () => ({ status: 200, body: [] }),
      'GET /me/care': () => ({ status: 200, body: day() }),
      'PUT /me/care/records': () => ({ status: 409, body: { message: 'This day is closed' } }),
    });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: `${en.carePlan.done}: Morning tablets` }));
    expect(await screen.findByText('This day is closed')).toBeTruthy();
  });
});
