import { FIRST_BOOKING_DAYS, draftBooking, type DraftInput } from './booking-draft-rules';

const input = (over: Partial<DraftInput> = {}): DraftInput => ({
  schedule: 'DAY', urgency: 'WITHIN_WEEK', desiredStartDate: '2026-11-16', today: '2026-11-12', rateType: 'DAILY', payRate: 3000, clientRate: 3450, ...over,
});

describe('booking draft rules', () => {
  it('drafts two weeks of the usual hours from the day the client asked for, at the agreed rates', () => {
    const r = draftBooking(input());
    expect(r).toEqual({
      ok: true,
      draft: {
        scheduleType: 'DAY', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00', startDate: '2026-11-16', endDate: '2026-11-29', shifts: 10,
        rateType: 'DAILY', rateAmount: '3450.00', payRateType: 'DAILY', payRateAmount: '3000.00',
      },
      summary: 'Day shifts, Monday to Friday, 08:00-17:00, from 2026-11-16 for 14 days (10 shifts), at the rates agreed in the offer',
    });
    expect(FIRST_BOOKING_DAYS).toBe(14);
  });

  it('never starts today or in the past', () => {
    expect(draftBooking(input({ desiredStartDate: '2026-11-12' }))).toMatchObject({ draft: { startDate: '2026-11-13' } });
    expect(draftBooking(input({ desiredStartDate: '2026-11-01' }))).toMatchObject({ draft: { startDate: '2026-11-13' } });
  });

  it('starts tomorrow when care is needed at once and no date was given', () => {
    const r = draftBooking(input({ desiredStartDate: null, urgency: 'IMMEDIATELY', schedule: 'LIVE_IN_24H' }));
    expect(r).toMatchObject({ ok: true, draft: { scheduleType: 'LIVE_IN', startDate: '2026-11-13', endDate: '2026-11-26', shifts: 14, shiftStartTime: '08:00', shiftEndTime: '08:00' } });
    expect(draftBooking(input({ schedule: 'NIGHT' }))).toMatchObject({ draft: { scheduleType: 'NIGHT', shiftStartTime: '20:00', shiftEndTime: '08:00', shifts: 14 } });
  });

  it('asks a person rather than guess the hours or the start', () => {
    expect(draftBooking(input({ schedule: 'NOT_SURE' }))).toEqual({ ok: false, why: 'the client was not sure what hours they need' });
    expect(draftBooking(input({ schedule: null }))).toMatchObject({ ok: false });
    expect(draftBooking(input({ desiredStartDate: null }))).toEqual({ ok: false, why: 'the request has no start date' });
    expect(draftBooking(input({ desiredStartDate: null, urgency: null }))).toMatchObject({ ok: false });
  });

  it('leaves out rates that were never agreed', () => {
    const none = draftBooking(input({ rateType: null, payRate: null, clientRate: null }));
    expect(none).toMatchObject({ ok: true, summary: expect.stringContaining('rates still to be agreed') });
    if (none.ok) expect(none.draft).not.toHaveProperty('payRateAmount');
    const payOnly = draftBooking(input({ clientRate: null }));
    if (payOnly.ok) {
      expect(payOnly.draft.payRateAmount).toBe('3000.00');
      expect(payOnly.draft).not.toHaveProperty('rateAmount');
      expect(payOnly.summary).toContain("the client's rate is still to be set");
    }
    expect.assertions(5);
  });
});
