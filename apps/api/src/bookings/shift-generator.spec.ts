import { addDays, colomboLocalToIso, generateShifts, isoToColomboLocal, isValidDate, shiftHours, toColombo } from '@care-platform/shared';
import { BookingsService } from './bookings.service';

describe('shift generation (Colombo time)', () => {
  // 2026-10-19 is a Monday.
  it('makes one shift per chosen weekday, in Colombo wall-clock time', () => {
    const shifts = generateShifts({ startDate: '2026-10-19', endDate: '2026-11-01', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00' });
    expect(shifts).toHaveLength(10);
    expect(isoToColomboLocal(shifts[0].startsAt)).toBe('2026-10-19T08:00');
    expect(isoToColomboLocal(shifts[0].endsAt)).toBe('2026-10-19T17:00');
    expect(shifts[0].startsAt.toISOString()).toBe('2026-10-19T02:30:00.000Z');
    expect(shifts.map((s) => toColombo(s.startsAt).weekday)).not.toContain(6);
  });

  it('runs a night shift into the next morning, and a live-in day for 24 hours', () => {
    const [night] = generateShifts({ startDate: '2026-10-19', endDate: '2026-10-19', daysOfWeek: [1], shiftStartTime: '20:00', shiftEndTime: '08:00' });
    expect(isoToColomboLocal(night.endsAt)).toBe('2026-10-20T08:00');
    expect(shiftHours(night.startsAt, night.endsAt)).toBe(12);
    const live = generateShifts({ startDate: '2026-10-19', endDate: '2026-10-20', daysOfWeek: [1, 2, 3, 4, 5, 6, 7], shiftStartTime: '08:00', shiftEndTime: '08:00' });
    expect(live.map((s) => shiftHours(s.startsAt, s.endsAt))).toEqual([24, 24]);
    // Back to back, not overlapping.
    expect(live[0].endsAt.getTime()).toBe(live[1].startsAt.getTime());
  });

  it('crosses month and year ends correctly and rejects nonsense', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(generateShifts({ startDate: '2026-10-20', endDate: '2026-10-19', daysOfWeek: [1], shiftStartTime: '08:00', shiftEndTime: '17:00' })).toEqual([]);
    expect(colomboLocalToIso('2026-10-19T25:00')).toBeNull();
    expect(colomboLocalToIso('2026-10-19T08:15')).toBe('2026-10-19T02:45:00.000Z');
  });
});

describe('rate estimate', () => {
  const shifts = generateShifts({ startDate: '2026-10-19', endDate: '2026-10-23', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00' }).map(
    (s, i) => ({
      ...s,
      id: `s${i}`,
      caregiverId: 'cg',
      status: (i === 4 ? 'CANCELLED' : 'SCHEDULED') as 'SCHEDULED' | 'CANCELLED',
      rateType: null as 'HOURLY' | 'DAILY' | null,
      rateAmount: null as string | null,
      payRateType: null as 'HOURLY' | 'DAILY' | null,
      payRateAmount: null as string | null,
    }),
  );
  const base = { id: 'b', reference: 'BK-TEST', caregiverId: 'cg', startDate: '2026-10-19', endDate: '2026-10-23' };
  it('counts hours or days of shifts that are going ahead, not cancelled ones', () => {
    expect(BookingsService.estimate('CLIENT', { ...base, rateType: 'HOURLY', rateAmount: '500' }, shifts)).toMatchObject({ shifts: 4, hours: 36, units: 36, total: '18000.00' });
    expect(BookingsService.estimate('CLIENT', { ...base, rateType: 'DAILY', rateAmount: '3500.50' }, shifts)).toMatchObject({ units: 4, total: '14002.00' });
  });
  it('prices a monthly rate by the calendar month, and says nothing without a rate', () => {
    expect(BookingsService.estimate('CLIENT', { ...base, startDate: '2026-10-01', endDate: '2026-10-30', rateType: 'MONTHLY', rateAmount: '60000' }, shifts).total).toBe('60000.00');
    expect(BookingsService.estimate('CLIENT', { ...base, rateType: null, rateAmount: null }, shifts).total).toBeNull();
  });
  it("prices a shift with its own rate at that rate, on its own side only", () => {
    const own = shifts.map((s, i) => (i === 0 ? { ...s, rateType: 'DAILY' as const, rateAmount: '6000.00', payRateType: 'HOURLY' as const, payRateAmount: '400.00' } : s));
    // 3 days at 3500 + one holiday shift at 6000.
    expect(BookingsService.estimate('CLIENT', { ...base, rateType: 'DAILY', rateAmount: '3500' }, own)).toMatchObject({ total: '16500.00', ownRateShifts: 1 });
    // Pay: 3 x 9h x 300 + 9h x 400.
    expect(BookingsService.estimate('PAY', { ...base, rateType: 'HOURLY', rateAmount: '300' }, own)).toMatchObject({ total: '11700.00' });
    // No booking rate: only the priced shift counts, the rest are flagged.
    expect(BookingsService.estimate('CLIENT', { ...base, rateType: null, rateAmount: null }, own)).toMatchObject({ total: '6000.00', unpriced: 3 });
  });
});
