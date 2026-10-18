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
    (s, i) => ({ ...s, status: (i === 4 ? 'CANCELLED' : 'SCHEDULED') as 'SCHEDULED' | 'CANCELLED' }),
  );
  const base = { startDate: '2026-10-19', endDate: '2026-10-23' };
  it('counts hours or days of shifts that are going ahead, not cancelled ones', () => {
    expect(BookingsService.estimate({ ...base, rateType: 'HOURLY', rateAmount: '500' }, shifts)).toMatchObject({ shifts: 4, hours: 36, units: 36, total: '18000.00' });
    expect(BookingsService.estimate({ ...base, rateType: 'DAILY', rateAmount: '3500.50' }, shifts)).toMatchObject({ units: 4, total: '14002.00' });
  });
  it('pro-rates a monthly rate over the booked days, and says nothing without a rate', () => {
    expect(BookingsService.estimate({ startDate: '2026-10-01', endDate: '2026-10-30', rateType: 'MONTHLY', rateAmount: '60000' }, shifts).total).toBe('60000.00');
    expect(BookingsService.estimate({ ...base, rateType: null, rateAmount: null }, shifts).total).toBeNull();
  });
});
