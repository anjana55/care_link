import { DEFAULT_CHECK_IN_SETTINGS, coverOfferMinutes } from '@care-platform/shared';
import { COVER_AFTER_LATE_MINUTES, COVER_MAX_OFFERS, COVER_MIN_REMAINING_MINUTES, coverRequest, coverStep, shiftSchedule } from './cover-rules';

const settings = DEFAULT_CHECK_IN_SETTINGS;
const start = new Date('2026-11-16T03:00:00Z'); // 08:30 in Sri Lanka
const end = new Date('2026-11-16T09:00:00Z');
const at = (minutesAfterStart: number) => new Date(start.getTime() + minutesAfterStart * 60_000);
const visit = { startsAt: start, endsAt: end, status: 'SCHEDULED', checkedInAt: null };
const dueAt = settings.lateAfterMinutes + COVER_AFTER_LATE_MINUTES;
const offer = (status: 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN', expiresInMinutes = 15, from = at(dueAt)) => ({ status, expiresAt: new Date(from.getTime() + expiresInMinutes * 60_000) });

describe('coverStep', () => {
  it('waits until the caregiver has been chased and given time to answer', () => {
    expect(coverStep(visit, settings, [], at(dueAt - 1))).toEqual({ step: 'none' });
    expect(coverStep(visit, settings, [], at(dueAt))).toEqual({ step: 'offer', wave: 1, minutesLate: dueAt, minutesLeft: 360 - dueAt });
  });

  it('does nothing before the start, once someone has checked in, or for a shift that is not scheduled', () => {
    expect(coverStep(visit, settings, [], at(-30)).step).toBe('none');
    expect(coverStep({ ...visit, checkedInAt: at(20) }, settings, [], at(60)).step).toBe('none');
    expect(coverStep({ ...visit, status: 'CANCELLED' }, settings, [], at(60)).step).toBe('none');
    expect(coverStep({ ...visit, status: 'COMPLETED' }, settings, [], at(60)).step).toBe('none');
  });

  it('does nothing once the visit is over', () => {
    expect(coverStep(visit, settings, [], at(361)).step).toBe('none');
  });

  it('waits while an offer is out, and stops when someone has accepted', () => {
    expect(coverStep(visit, settings, [offer('OFFERED')], at(dueAt + 5)).step).toBe('none');
    expect(coverStep(visit, settings, [offer('DECLINED'), offer('ACCEPTED')], at(dueAt + 30)).step).toBe('none');
  });

  it('treats an offer past its deadline as unanswered even before the clean-up reaches it', () => {
    const three = [offer('OFFERED'), offer('OFFERED'), offer('OFFERED')];
    expect(coverStep(visit, settings, three, at(dueAt + 14)).step).toBe('none');
    expect(coverStep(visit, settings, three, at(dueAt + 16))).toMatchObject({ step: 'offer', wave: 2 });
  });

  it('asks the next caregivers when everyone asked said no, and gives up after the last wave', () => {
    const declined = (n: number) => Array.from({ length: n }, () => offer('DECLINED'));
    expect(coverStep(visit, settings, declined(3), at(dueAt + 20))).toMatchObject({ step: 'offer', wave: 2 });
    expect(coverStep(visit, settings, declined(COVER_MAX_OFFERS), at(dueAt + 40))).toEqual({ step: 'giveUp', asked: COVER_MAX_OFFERS, minutesLate: dueAt + 40 });
  });

  it('does not start looking with too little of the visit left, and gives up if it runs short while looking', () => {
    const late = at(360 - COVER_MIN_REMAINING_MINUTES + 1);
    expect(coverStep(visit, settings, [], late)).toEqual({ step: 'none' });
    expect(coverStep(visit, settings, [offer('EXPIRED')], late)).toMatchObject({ step: 'giveUp', asked: 1 });
  });
});

describe('what a shift asks for', () => {
  it('reads day, night and live-in from the shift times in Sri Lanka', () => {
    expect(shiftSchedule('2026-11-16T03:00:00Z', '2026-11-16T09:00:00Z')).toBe('DAY'); // 08:30
    expect(shiftSchedule('2026-11-16T14:00:00Z', '2026-11-17T00:00:00Z')).toBe('NIGHT'); // 19:30
    expect(shiftSchedule('2026-11-15T23:00:00Z', '2026-11-16T03:00:00Z')).toBe('NIGHT'); // 04:30
    expect(shiftSchedule('2026-11-16T03:00:00Z', '2026-11-17T03:00:00Z')).toBe('LIVE_IN_24H');
  });

  it('describes the shift without anything about the client', () => {
    expect(coverRequest({ startsAt: start, endsAt: end, careType: null, districtId: 5, cityId: 77 })).toEqual({
      careType: '',
      districtId: 5,
      cityId: 77,
      schedule: 'DAY',
      urgency: 'IMMEDIATELY',
      desiredStartDate: '2026-11-16',
    });
  });
});

describe('coverOfferMinutes', () => {
  it('is short for a shift that has started or is about to, longer for one further off', () => {
    expect(coverOfferMinutes(visit, at(30))).toBe(15);
    expect(coverOfferMinutes(visit, at(-90))).toBe(15);
    expect(coverOfferMinutes(visit, at(-10 * 60))).toBe(60);
    expect(coverOfferMinutes(visit, at(-3 * 24 * 60))).toBe(240);
  });

  it('never runs past the end of the shift', () => {
    expect(coverOfferMinutes(visit, at(352))).toBe(8);
    expect(coverOfferMinutes(visit, at(400))).toBe(1);
  });
});
