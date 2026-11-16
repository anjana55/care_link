import { ADVANCE_INVOICE_LEAD_DAYS, advancePeriods } from '@care-platform/shared';

describe('advancePeriods', () => {
  const booking = { startDate: '2026-11-18', endDate: '2027-01-20' };

  it('bills the rest of the month a running booking is in', () => {
    expect(advancePeriods(booking, '2026-11-18')).toEqual([{ periodStart: '2026-11-18', periodEnd: '2026-11-30' }]);
    expect(advancePeriods(booking, '2026-11-25')).toEqual([{ periodStart: '2026-11-18', periodEnd: '2026-11-30' }]);
  });

  it(`adds the next month once it is ${ADVANCE_INVOICE_LEAD_DAYS} days or fewer away`, () => {
    expect(advancePeriods(booking, '2026-11-25')).toHaveLength(1);
    expect(advancePeriods(booking, '2026-11-26')).toEqual([
      { periodStart: '2026-11-18', periodEnd: '2026-11-30' },
      { periodStart: '2026-12-01', periodEnd: '2026-12-31' },
    ]);
  });

  it('starts each month from its first day, and stops at the booking end', () => {
    expect(advancePeriods(booking, '2026-12-10')).toEqual([{ periodStart: '2026-12-01', periodEnd: '2026-12-31' }]);
    expect(advancePeriods(booking, '2026-12-27')).toEqual([
      { periodStart: '2026-12-01', periodEnd: '2026-12-31' },
      { periodStart: '2027-01-01', periodEnd: '2027-01-20' },
    ]);
    expect(advancePeriods(booking, '2027-01-28')).toEqual([{ periodStart: '2027-01-01', periodEnd: '2027-01-20' }]);
  });

  it('bills the first month of a booking that has not started yet as soon as it is asked', () => {
    expect(advancePeriods(booking, '2026-09-03')).toEqual([{ periodStart: '2026-11-18', periodEnd: '2026-11-30' }]);
  });

  it('has nothing for a booking that is over, or one whose dates are the wrong way round', () => {
    expect(advancePeriods(booking, '2027-02-01')).toEqual([]);
    expect(advancePeriods({ startDate: '2026-11-18', endDate: '2026-11-10' }, '2026-11-01')).toEqual([]);
  });

  it('crosses a year end and a leap February', () => {
    expect(advancePeriods({ startDate: '2027-12-20', endDate: '2028-03-05' }, '2027-12-28')).toEqual([
      { periodStart: '2027-12-20', periodEnd: '2027-12-31' },
      { periodStart: '2028-01-01', periodEnd: '2028-01-31' },
    ]);
    expect(advancePeriods({ startDate: '2027-12-20', endDate: '2028-03-05' }, '2028-02-10')).toEqual([{ periodStart: '2028-02-01', periodEnd: '2028-02-29' }]);
  });

  it('takes a different lead time', () => {
    expect(advancePeriods(booking, '2026-11-20', 10)).toHaveLength(1);
    expect(advancePeriods(booking, '2026-11-21', 10)).toHaveLength(2);
  });
});
