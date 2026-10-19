import { generateShifts } from '@care-platform/shared';
import { planRoster } from './roster-plan';

const week = (days: (1 | 2 | 3 | 4 | 5 | 6 | 7)[], start = '08:00', end = '17:00') =>
  generateShifts({ startDate: '2026-10-19', endDate: '2026-10-25', daysOfWeek: days, shiftStartTime: start, shiftEndTime: end });
const rows = (gen: { startsAt: Date; endsAt: Date }[], caregiverId = 'A') => gen.map((g, i) => ({ id: `r${i}`, caregiverId, ...g }));

describe('planRoster', () => {
  it('keeps shifts that still fit, drops the rest and adds what is new', () => {
    const existing = rows(week([1, 2, 3, 4, 5])); // Mon-Fri
    const plan = planRoster(existing, week([1, 3, 5, 6]), 'A'); // Mon, Wed, Fri, Sat
    expect(plan.keep.map((k) => k.shift.id)).toEqual(['r0', 'r2', 'r4']);
    expect(plan.drop.map((d) => d.id)).toEqual(['r1', 'r3']);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].caregiverId).toBe('A');
  });

  it('replaces every shift when the times change', () => {
    const existing = rows(week([1, 2]));
    const plan = planRoster(existing, week([1, 2], '09:00', '17:00'), 'A');
    expect(plan.keep).toHaveLength(0);
    expect(plan.drop).toHaveLength(2);
    expect(plan.add).toHaveLength(2);
  });

  it('moves the booked caregiver’s shifts to the new one but leaves covers alone', () => {
    const existing = rows(week([1, 2, 3]));
    existing[1].caregiverId = 'COVER';
    const plan = planRoster(existing, null, 'A', 'B');
    expect(plan.keep.map((k) => k.caregiverId)).toEqual(['B', 'COVER', 'B']);
    expect(plan.drop).toHaveLength(0);
    expect(plan.add).toHaveLength(0);
  });

  it('gives new shifts to the new booked caregiver when both change', () => {
    const plan = planRoster(rows(week([1])), week([1, 2]), 'A', 'B');
    expect(plan.keep[0].caregiverId).toBe('B');
    expect(plan.add.map((a) => a.caregiverId)).toEqual(['B']);
  });

  it('matches each slot once, preferring the booked caregiver’s shift', () => {
    const [mon] = week([1]);
    const existing = [
      { id: 'cover', caregiverId: 'COVER', ...mon },
      { id: 'booked', caregiverId: 'A', ...mon },
    ];
    const plan = planRoster(existing, [mon], 'A');
    expect(plan.keep.map((k) => k.shift.id)).toEqual(['booked']);
    expect(plan.drop.map((d) => d.id)).toEqual(['cover']);
  });
});
