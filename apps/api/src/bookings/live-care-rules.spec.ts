import { COMPLETE_MIN_SHARE, FLAG_AFTER_CHASE_MINUTES, flagReason, liveStep, type LiveVisit } from './live-care-rules';

const settings = { earlyMinutes: 60, lateAfterMinutes: 15 };
// A day shift, 08:00 to 17:00 in Sri Lanka (nine hours).
const visit = (over: Partial<LiveVisit> = {}): LiveVisit => ({
  startsAt: '2026-11-16T02:30:00.000Z', endsAt: '2026-11-16T11:30:00.000Z', status: 'SCHEDULED', checkedInAt: null, checkedOutAt: null, chasedAt: null, ...over,
});
const at = (hhmm: string, day = 16) => new Date(`2026-11-${day}T${hhmm}:00.000Z`);

describe('what the live-care agent does about a visit', () => {
  it('does nothing before the visit is late', () => {
    expect(liveStep(visit(), settings, at('01:00'))).toEqual({ step: 'none' });
    expect(liveStep(visit(), settings, at('02:44'))).toEqual({ step: 'none' });
  });

  it('chases the caregiver once the visit is late, and only once', () => {
    expect(liveStep(visit(), settings, at('02:46'))).toEqual({ step: 'chase', minutesLate: 16 });
    expect(liveStep(visit({ chasedAt: '2026-11-16T02:46:00.000Z' }), settings, at('02:55'))).toEqual({ step: 'none' });
  });

  it('tells staff when the caregiver has still not checked in a while after the chase', () => {
    const chased = visit({ chasedAt: '2026-11-16T02:46:00.000Z' });
    expect(liveStep(chased, settings, at('03:00'))).toEqual({ step: 'none' });
    expect(liveStep(chased, settings, at('03:01'))).toEqual({ step: 'flag', kind: 'STILL_LATE', minutes: 31 });
    expect(FLAG_AFTER_CHASE_MINUTES).toBe(15);
  });

  it('leaves a visit alone once the caregiver is there', () => {
    expect(liveStep(visit({ checkedInAt: '2026-11-16T02:50:00.000Z', chasedAt: '2026-11-16T02:46:00.000Z' }), settings, at('05:00'))).toEqual({ step: 'none' });
    expect(liveStep(visit({ checkedInAt: '2026-11-16T02:50:00.000Z' }), settings, at('13:00'))).toEqual({ step: 'none' });
  });

  it('completes the shift when the caregiver was there for most of it', () => {
    const done = visit({ checkedInAt: '2026-11-16T02:33:00.000Z', checkedOutAt: '2026-11-16T11:31:00.000Z' });
    expect(liveStep(done, settings, at('11:32'))).toEqual({ step: 'complete', minutesThere: 538, ofMinutes: 540 });
    // Exactly three quarters is enough; a minute less is not.
    expect(liveStep(visit({ checkedInAt: '2026-11-16T02:30:00.000Z', checkedOutAt: '2026-11-16T09:15:00.000Z' }), settings, at('09:16')).step).toBe('complete');
    expect(liveStep(visit({ checkedInAt: '2026-11-16T02:30:00.000Z', checkedOutAt: '2026-11-16T09:14:00.000Z' }), settings, at('09:16'))).toEqual({ step: 'flag', kind: 'LEFT_EARLY', minutes: 404, ofMinutes: 540 });
    expect(COMPLETE_MIN_SHARE).toBe(0.75);
  });

  it('tells staff about a visit that ended with no check-in, but not about old history', () => {
    expect(liveStep(visit(), settings, at('11:31'))).toEqual({ step: 'flag', kind: 'NO_CHECK_IN', minutes: 540 });
    expect(liveStep(visit(), settings, at('23:29'))).toMatchObject({ step: 'flag' });
    expect(liveStep(visit(), settings, at('23:31'))).toEqual({ step: 'none' });
    expect(liveStep(visit({ checkedInAt: '2026-11-16T02:33:00.000Z', checkedOutAt: '2026-11-16T11:31:00.000Z' }), settings, at('00:00', 18))).toEqual({ step: 'none' });
  });

  it('acts only on scheduled shifts', () => {
    for (const status of ['COMPLETED', 'MISSED', 'CANCELLED', 'DRAFT']) expect(liveStep(visit({ status }), settings, at('03:30'))).toEqual({ step: 'none' });
  });

  it('says why in plain words', () => {
    expect(flagReason('STILL_LATE', { minutes: 31 }, 'CG-0001', '08:00')).toBe('CG-0001 was due at 08:00, was asked to check in, and still has not (31 min late)');
    expect(flagReason('NO_CHECK_IN', { minutes: 540 }, 'CG-0001', '08:00')).toBe('The 08:00 visit ended with no check-in from CG-0001');
    expect(flagReason('LEFT_EARLY', { minutes: 404, ofMinutes: 540 }, 'CG-0001', '08:00')).toBe('CG-0001 checked out after 6 h 44 min of a 9 h visit');
  });
});
