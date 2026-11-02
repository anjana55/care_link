import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ClientBooking } from '@care-platform/shared';
import en from '../src/i18n/en.json';
import Start from '../app/(client)/start';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { pickDate } from '../test-utils/calendar';
import { tokenStore } from '@/api';
import { nextVisit } from '@/care/next-visit';
import { Calendar, DateField, longDay, monthGrid } from '@/ui/Calendar';
import { PageHeader } from '@/ui/PageHeader';
import { CaregiversIllustration } from '@/ui/Illustration';

/**
 * The app's simpler look for older and less confident people: Back and Home
 * on every screen, a home of big tiles for clients, and calendars wherever a
 * date is chosen.
 */
jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());
// A build that has react-native-svg's native views.
jest.mock('@/native', () => ({ ...jest.requireActual('@/native'), hasNativeView: () => true }));

const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);

beforeEach(async () => {
  mockRouter.reset();
  await tokenStore.clear();
});

describe('the welcome picture', () => {
  it('is drawn on a build with the drawing library, named for screen readers', async () => {
    await show(<CaregiversIllustration width={320} />);
    expect(await screen.findByTestId('caregivers-illustration')).toHaveProp('accessibilityLabel', en.welcome.pictureLabel);
    expect(screen.queryByTestId('caregivers-illustration-simple')).toBeNull();
  });
});

describe('Back and Home', () => {
  it('Back goes back a screen when there is one, and home when the screen was opened from a link', async () => {
    await show(<PageHeader title="Bookings" />);
    mockRouter.canGoBack.mockReturnValue(true);
    await fireEvent.press(screen.getByRole('button', { name: en.nav.back }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);

    mockRouter.canGoBack.mockReturnValue(false);
    await fireEvent.press(screen.getByRole('button', { name: en.nav.back }));
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/');
  });

  it("Home opens the person's own home: a client's tiles, a caregiver's Today", async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await show(<PageHeader title="Saved" />);
    await fireEvent.press(await screen.findByRole('button', { name: en.nav.home }));
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/start');
    screen.unmount();

    await tokenStore.set(tokensFor('CAREGIVER'));
    await show(<PageHeader title="Shifts" />);
    await fireEvent.press(await screen.findByRole('button', { name: en.nav.home }));
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/home');
  });

  it('marks Home as where the person already is, on a home screen', async () => {
    await show(<PageHeader isHome />);
    expect(screen.getByRole('button', { name: en.nav.home })).toHaveProp('accessibilityState', { selected: true });
    await fireEvent.press(screen.getByRole('button', { name: en.nav.home }));
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('the calendar', () => {
  it('lays a month out in weeks that start on Monday', () => {
    // 1 November 2026 is a Sunday.
    const nov = monthGrid('2026-11-01');
    expect(nov.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(nov.length % 7).toBe(0);
    expect(nov.filter(Boolean)).toHaveLength(30);
    expect(monthGrid('2027-02-01').filter(Boolean)).toHaveLength(28);
    expect(monthGrid('2028-02-01').filter(Boolean)).toHaveLength(29);
  });

  it("lets only days in range be chosen, and doesn't page past the range", async () => {
    const picked: string[] = [];
    await render(
      <AppProviders>
        <Calendar value="2026-11-12" onChange={(d) => picked.push(d)} today="2026-11-02" min="2026-11-02" max="2026-12-15" />
      </AppProviders>,
    );
    expect(await screen.findByText('November 2026')).toBeTruthy();
    // Today is ringed and named; yesterday can't be chosen; the chosen day is marked.
    expect(screen.getByRole('button', { name: `${longDay('2026-11-02', 'en')}, ${en.calendar.today}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: longDay('2026-11-01', 'en') })).toHaveProp('accessibilityState', { selected: false, disabled: true });
    expect(screen.getByRole('button', { name: longDay('2026-11-12', 'en') })).toHaveProp('accessibilityState', { selected: true, disabled: false });
    expect(screen.getByRole('button', { name: en.calendar.previousMonth })).toHaveProp('accessibilityState', { disabled: true });
    // A range under a year has no year switcher.
    expect(screen.queryByRole('button', { name: en.calendar.nextYear })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: longDay('2026-11-20', 'en') }));
    expect(picked).toEqual(['2026-11-20']);

    await fireEvent.press(screen.getByRole('button', { name: en.calendar.nextMonth }));
    expect(screen.getByText('December 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: longDay('2026-12-16', 'en') })).toHaveProp('accessibilityState', { selected: false, disabled: true });
    expect(screen.getByRole('button', { name: en.calendar.nextMonth })).toHaveProp('accessibilityState', { disabled: true });
  });

  it('offers a year at a time for long ranges, such as an expiry date', async () => {
    await render(
      <AppProviders>
        <Calendar value={null} onChange={() => undefined} today="2026-11-02" min="2026-11-02" max="2046-12-31" />
      </AppProviders>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: en.calendar.nextYear }));
    expect(screen.getByText('November 2027')).toBeTruthy();
    expect(screen.getByRole('button', { name: en.calendar.previousYear })).toHaveProp('accessibilityState', { disabled: false });
  });

  it('writes the month and days in Sinhala and Tamil too', async () => {
    const day = longDay('2026-11-12', 'si');
    expect(day).not.toBe(longDay('2026-11-12', 'en'));
    expect(day).toContain('2026');
  });

  it('a date field shows the day in words, and only takes it when Choose this date is pressed', async () => {
    function Form() {
      const [day, setDay] = useState<string | null>(null);
      return <DateField label="Start date" value={day} onChange={setDay} today="2026-11-02" min="2026-11-02" max="2027-05-01" none="Not set" />;
    }
    await show(<Form />);
    const field = await screen.findByRole('button', { name: 'Start date' });
    expect(field).toHaveProp('accessibilityValue', { text: 'Not set' });

    await fireEvent.press(field);
    expect(screen.getByText(en.calendar.tapADay)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.calendar.confirm })).toHaveProp('accessibilityState', { disabled: true });
    // Closing without choosing changes nothing.
    await fireEvent.press(screen.getAllByRole('button', { name: en.nav.back }).at(-1)!);
    expect(screen.getByRole('button', { name: 'Start date' })).toHaveProp('accessibilityValue', { text: 'Not set' });

    await pickDate('Start date', '2027-01-15');
    expect(screen.getByRole('button', { name: 'Start date' })).toHaveProp('accessibilityValue', { text: longDay('2027-01-15', 'en') });
  });
});

describe('the client home', () => {
  const booking = (over: Partial<ClientBooking> = {}): ClientBooking =>
    ({
      id: 'b-1',
      reference: 'BK-7Q2',
      status: 'CONFIRMED',
      scheduleType: 'DAY',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      rateType: null,
      rateAmount: null,
      caregiverPublicId: '11111111-2222-4333-8444-555555555555',
      caregiver: { publicId: '11111111-2222-4333-8444-555555555555' },
      shifts: [],
      ...over,
    }) as ClientBooking;
  const shift = (id: string, startsAt: string, endsAt: string, status = 'SCHEDULED') => ({ id, startsAt, endsAt, status, isCover: false }) as ClientBooking['shifts'][number];

  it('finds the next visit: the earliest scheduled shift of a confirmed booking that has not ended', () => {
    const now = Date.parse('2026-11-02T06:00:00Z');
    const bookings = [
      booking({ id: 'b-1', shifts: [shift('past', '2026-11-01T02:30:00Z', '2026-11-01T14:30:00Z'), shift('later', '2026-11-04T02:30:00Z', '2026-11-04T14:30:00Z')] }),
      booking({ id: 'b-2', shifts: [shift('now', '2026-11-02T02:30:00Z', '2026-11-02T14:30:00Z', 'CANCELLED'), shift('soon', '2026-11-03T02:30:00Z', '2026-11-03T14:30:00Z')] }),
      booking({ id: 'b-3', status: 'DRAFT', shifts: [shift('draft', '2026-11-02T08:00:00Z', '2026-11-02T10:00:00Z')] }),
    ];
    expect(nextVisit(bookings, now)?.shift.id).toBe('soon');
    expect(nextVisit([booking({ shifts: [shift('on', '2026-11-02T02:30:00Z', '2026-11-02T14:30:00Z')] })], now)?.shift.id).toBe('on');
    expect(nextVisit([], now)).toBeNull();
  });

  it('has a big tile for everything a client does, and their next visit', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    const soon = new Date(Date.now() + 86_400_000);
    soon.setUTCHours(2, 30, 0, 0);
    const end = new Date(soon.getTime() + 12 * 3_600_000);
    serveApi({ 'GET /me/bookings': () => ({ status: 200, body: [booking({ shifts: [shift('s-1', soon.toISOString(), end.toISOString())] })] }) });
    await show(<Start />);

    expect(await screen.findByText(en.clientHome.nextVisit)).toBeTruthy();
    expect(screen.getByText(/08:00/)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.nav.home })).toHaveProp('accessibilityState', { selected: true });

    const tiles: [string, string][] = [
      [en.welcome.findCare, '/find'],
      [en.account.nav.bookings, '/bookings'],
      [en.carePlan.todayTitle, '/bookings'],
      [en.account.nav.invoices, '/invoices'],
      [en.account.nav.saved, '/saved'],
      [en.account.nav.requests, '/requests'],
      [en.clientHome.search, '/find'],
    ];
    for (const [name, to] of tiles) {
      await fireEvent.press(screen.getByRole('button', { name }));
      expect(mockRouter.navigate).toHaveBeenLastCalledWith(to);
    }
  });

  it('works for someone not signed in yet: no next visit, the same tiles', async () => {
    serveApi({});
    await show(<Start />);
    expect(await screen.findByText(en.clientHome.welcome)).toBeTruthy();
    expect(screen.queryByText(en.clientHome.nextVisit)).toBeNull();
    expect(screen.getByRole('button', { name: en.account.nav.bookings })).toBeTruthy();
  });
});
