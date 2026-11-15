import { arrivalCodeShown, checkInOpen, distanceMetres, minutesLate, visitState } from '@care-platform/shared';

const settings = { earlyMinutes: 60, lateAfterMinutes: 15 };
// A day shift, 08:00 to 17:00 in Sri Lanka.
const shift = { startsAt: '2026-11-16T02:30:00.000Z', endsAt: '2026-11-16T11:30:00.000Z', checkedInAt: null, checkedOutAt: null };
const at = (hhmm: string) => new Date(`2026-11-16T${hhmm}:00.000Z`);

describe('where a visit stands', () => {
  it('opens check-in an hour before the start and calls it late fifteen minutes after', () => {
    expect(visitState(shift, settings, at('01:29'))).toBe('UPCOMING');
    expect(visitState(shift, settings, at('01:30'))).toBe('DUE');
    expect(visitState(shift, settings, at('02:44'))).toBe('DUE');
    expect(visitState(shift, settings, at('02:45'))).toBe('LATE');
    expect(visitState(shift, settings, at('11:29'))).toBe('LATE');
    expect(visitState(shift, settings, at('11:30'))).toBe('NOT_RECORDED');
  });

  it('lets a caregiver check in while it is due or late, never before or after', () => {
    expect(['UPCOMING', 'DUE', 'LATE', 'IN', 'OUT', 'NOT_RECORDED'].filter((s) => checkInOpen(s as 'DUE'))).toEqual(['DUE', 'LATE']);
  });

  it('follows the check-in and check-out once they exist, whatever the clock says', () => {
    const inside = { ...shift, checkedInAt: '2026-11-16T02:33:00.000Z' };
    expect(visitState(inside, settings, at('02:50'))).toBe('IN');
    expect(visitState(inside, settings, at('23:00'))).toBe('IN');
    expect(visitState({ ...inside, checkedOutAt: '2026-11-16T11:31:00.000Z' }, settings, at('12:00'))).toBe('OUT');
  });

  it('calls a very short shift late once it is half over', () => {
    const short = { ...shift, endsAt: '2026-11-16T02:50:00.000Z' }; // twenty minutes
    expect(visitState(short, settings, at('02:39'))).toBe('DUE');
    expect(visitState(short, settings, at('02:40'))).toBe('LATE');
  });

  it('counts the minutes since the start', () => {
    expect(minutesLate(shift, at('02:52'))).toBe(22);
    expect(minutesLate(shift, at('02:00'))).toBe(0);
  });
});

describe('when the client sees the arrival code', () => {
  it('shows it from twelve hours before the shift until the caregiver checks in or the shift ends', () => {
    expect(arrivalCodeShown(shift, new Date('2026-11-15T14:29:00.000Z'))).toBe(false);
    expect(arrivalCodeShown(shift, new Date('2026-11-15T14:30:00.000Z'))).toBe(true);
    expect(arrivalCodeShown(shift, at('05:00'))).toBe(true);
    expect(arrivalCodeShown({ ...shift, checkedInAt: '2026-11-16T02:33:00.000Z' }, at('05:00'))).toBe(false);
    expect(arrivalCodeShown(shift, at('11:30'))).toBe(false);
  });
});

describe('distance between two check-ins', () => {
  it('is in whole metres', () => {
    const door = { latitude: 6.9271, longitude: 79.8612 };
    expect(distanceMetres(door, door)).toBe(0);
    // One thousandth of a degree of latitude is about 111 m anywhere.
    expect(distanceMetres(door, { latitude: 6.9281, longitude: 79.8612 })).toBeGreaterThan(105);
    expect(distanceMetres(door, { latitude: 6.9281, longitude: 79.8612 })).toBeLessThan(117);
  });
});
