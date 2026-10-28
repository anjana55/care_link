import { careCutOff, careOccurrenceId, careOccurrences, colomboToUtc, type CareActivityFields, type CareActivityForShift } from '@care-platform/shared';
import { activitiesInForce, earliestEditDate, planCarePlanEdit, type EditableActivity } from './plan-edit';

const act = (p: Partial<CareActivityForShift> & { id: string }): CareActivityForShift => ({
  timing: 'ANY',
  slot: null,
  times: [],
  daysOfWeek: null,
  sortOrder: 0,
  effectiveFrom: '2026-11-01',
  effectiveTo: null,
  ...p,
});
const shift = (date: string, start: string, endDate: string, end: string) => ({ startsAt: colomboToUtc(date, start), endsAt: colomboToUtc(endDate, end) });
const keys = (occ: { activityId: string; dueKey: string }[]) => occ.map((o) => `${o.activityId}@${o.dueKey}`);

describe('care occurrences', () => {
  // 2026-11-02 is a Monday.
  const day = shift('2026-11-02', '08:00', '2026-11-02', '17:00');
  const night = shift('2026-11-02', '20:00', '2026-11-03', '08:00');
  const liveIn = shift('2026-11-02', '08:00', '2026-11-03', '08:00');

  it('puts an any-time activity on every shift once', () => {
    expect(keys(careOccurrences([act({ id: 'a' })], day))).toEqual(['a@ANY']);
    expect(keys(careOccurrences([act({ id: 'a' })], night))).toEqual(['a@ANY']);
  });

  it('keeps only the set times that fall inside the shift, in time order', () => {
    const meds = act({ id: 'm', timing: 'AT_TIMES', times: ['20:00', '08:00', '14:00'] });
    expect(keys(careOccurrences([meds], day))).toEqual(['m@08:00', 'm@14:00']);
    // 08:00 is the night shift's end - not inside it.
    expect(keys(careOccurrences([meds], night))).toEqual(['m@20:00']);
    // A 24-hour live-in day has each time once; 08:00 at its start, not again at its end.
    expect(keys(careOccurrences([meds], liveIn))).toEqual(['m@08:00', 'm@14:00', 'm@20:00']);
  });

  it('dates a set time after midnight on the next day', () => {
    const turn = act({ id: 't', timing: 'AT_TIMES', times: ['02:00'] });
    const [o] = careOccurrences([turn], night);
    expect(o.dueKey).toBe('02:00');
    expect(o.dueDate).toBe('2026-11-03');
  });

  it('includes a slot only when it overlaps the shift', () => {
    const morning = act({ id: 'am', timing: 'SLOT', slot: 'MORNING' });
    const nightSlot = act({ id: 'pm', timing: 'SLOT', slot: 'NIGHT', sortOrder: 1 });
    expect(keys(careOccurrences([morning, nightSlot], day))).toEqual(['am@MORNING']);
    // The night shift overlaps the night slot from its start and the morning from 06:00.
    expect(keys(careOccurrences([morning, nightSlot], night))).toEqual(['pm@NIGHT', 'am@MORNING']);
  });

  it('follows the weekday of the shift start and the dates the activity is in force', () => {
    const mwf = act({ id: 'w', daysOfWeek: [1, 3, 5] });
    expect(keys(careOccurrences([mwf], day))).toEqual(['w@ANY']);
    expect(keys(careOccurrences([mwf], shift('2026-11-03', '08:00', '2026-11-03', '17:00')))).toEqual([]);
    const ended = act({ id: 'e', effectiveTo: '2026-11-01' });
    const later = act({ id: 'l', effectiveFrom: '2026-11-03' });
    expect(careOccurrences([ended, later], day)).toEqual([]);
  });
});

describe('occurrence windows and reminders (for a caregiver app)', () => {
  const day = shift('2026-11-02', '08:00', '2026-11-02', '17:00');
  const iso = (d: string, t: string) => colomboToUtc(d, t).toISOString();
  const window = (o: { dueAt: Date; dueBy: Date; remindAt: Date | null }) => [o.dueAt.toISOString(), o.dueBy.toISOString(), o.remindAt?.toISOString() ?? null];

  it('gives a set-time item an hour on time by default, or the activity\'s own allowance, never past the shift', () => {
    const [nine, fourThirty] = careOccurrences([act({ id: 'm', timing: 'AT_TIMES', times: ['09:00', '16:30'], reminderMinutesBefore: 15 })], day);
    expect(window(nine)).toEqual([iso('2026-11-02', '09:00'), iso('2026-11-02', '10:00'), iso('2026-11-02', '08:45')]);
    expect(window(fourThirty)).toEqual([iso('2026-11-02', '16:30'), iso('2026-11-02', '17:00'), iso('2026-11-02', '16:15')]);
    const [tight] = careOccurrences([act({ id: 'm', timing: 'AT_TIMES', times: ['09:00'], onTimeMinutes: 15 })], day);
    expect(window(tight)).toEqual([iso('2026-11-02', '09:00'), iso('2026-11-02', '09:15'), null]);
  });

  it('gives a slot item the part of the slot inside the shift, and an any-time item the whole shift', () => {
    const [am] = careOccurrences([act({ id: 'b', timing: 'SLOT', slot: 'MORNING', reminderMinutesBefore: 0 })], day);
    expect(window(am)).toEqual([iso('2026-11-02', '08:00'), iso('2026-11-02', '12:00'), iso('2026-11-02', '08:00')]);
    const [any] = careOccurrences([act({ id: 'l' })], day);
    expect(window(any)).toEqual([iso('2026-11-02', '08:00'), iso('2026-11-02', '17:00'), null]);
  });

  it('keys each occurrence by shift, activity and due time', () => {
    expect(careOccurrenceId('s1', 'm', '09:00')).toBe('s1:m:09:00');
  });
});

describe('care cut-off', () => {
  it('is midnight after the day a day shift ends', () => {
    expect(careCutOff(colomboToUtc('2026-11-02', '17:00')).toISOString()).toBe(colomboToUtc('2026-11-03', '00:00').toISOString());
  });
  it('waits for the end of the day an overnight shift finishes', () => {
    expect(careCutOff(colomboToUtc('2026-11-03', '08:00')).toISOString()).toBe(colomboToUtc('2026-11-04', '00:00').toISOString());
  });
  it('treats a shift ending exactly at midnight as belonging to the day before', () => {
    expect(careCutOff(colomboToUtc('2026-11-03', '00:00')).toISOString()).toBe(colomboToUtc('2026-11-03', '00:00').toISOString());
  });
  it('is Colombo midnight, not UTC midnight', () => {
    // 18:30 UTC on the 2nd = 00:00 Colombo on the 3rd.
    expect(careCutOff(colomboToUtc('2026-11-02', '17:00')).toISOString()).toBe('2026-11-02T18:30:00.000Z');
  });
});

const fields = (title: string, extra: Partial<CareActivityFields> = {}): CareActivityFields => ({
  category: 'PERSONAL_CARE',
  title: { en: title },
  instructions: {},
  timing: 'ANY',
  slot: null,
  times: [],
  daysOfWeek: null,
  isCritical: false,
  reminderMinutesBefore: null,
  onTimeMinutes: null,
  ...extra,
});
const row = (id: string, title: string, p: Partial<EditableActivity> = {}): EditableActivity => ({
  id,
  sortOrder: 0,
  effectiveFrom: '2026-11-01',
  effectiveTo: null,
  hasRecords: true,
  ...fields(title),
  ...p,
});

describe('editing a care plan from a date', () => {
  const from = '2026-11-10';

  it('leaves unchanged activities alone and only re-orders them', () => {
    const edit = planCarePlanEdit([row('a', 'Bath', { sortOrder: 0 }), row('b', 'Lunch', { sortOrder: 1 })], [{ id: 'b', ...fields('Lunch') }, { id: 'a', ...fields('Bath') }], from);
    expect(edit.close).toEqual([]);
    expect(edit.insert).toEqual([]);
    expect(edit.update.map((u) => [u.id, u.sortOrder])).toEqual([
      ['b', 0],
      ['a', 1],
    ]);
  });

  it('closes a changed activity the day before and starts the new version, linked to it', () => {
    const edit = planCarePlanEdit([row('a', 'Bath')], [{ id: 'a', ...fields('Bed bath') }], from);
    expect(edit.close).toEqual([{ id: 'a', effectiveTo: '2026-11-09' }]);
    expect(edit.insert).toEqual([{ fields: expect.objectContaining({ title: { en: 'Bed bath' } }), sortOrder: 0, replaces: 'a' }]);
  });

  it('changes in place an activity that has not started and has nothing recorded', () => {
    const edit = planCarePlanEdit([row('a', 'Bath', { effectiveFrom: from, hasRecords: false })], [{ id: 'a', ...fields('Bed bath') }], from);
    expect(edit.update).toEqual([{ id: 'a', fields: expect.objectContaining({ title: { en: 'Bed bath' } }), sortOrder: 0, change: 'content' }]);
    expect(edit.close).toEqual([]);
  });

  it('changes only the reminder or on-time window in place, even on an activity that already ran', () => {
    const edit = planCarePlanEdit([row('a', 'Tablets')], [{ id: 'a', ...fields('Tablets', { reminderMinutesBefore: 15 }) }], from);
    expect(edit.close).toEqual([]);
    expect(edit.insert).toEqual([]);
    expect(edit.update).toEqual([{ id: 'a', fields: expect.objectContaining({ reminderMinutesBefore: 15 }), sortOrder: 0, change: 'settings' }]);
  });

  it('closes a removed activity that already ran, and deletes one that never applied', () => {
    const edit = planCarePlanEdit([row('ran', 'Bath'), row('new', 'Walk', { effectiveFrom: from, hasRecords: false })], [], from);
    expect(edit.close).toEqual([{ id: 'ran', effectiveTo: '2026-11-09' }]);
    expect(edit.remove).toEqual(['new']);
  });

  it('adds activities without a known id from the date, and never uses one id twice', () => {
    const edit = planCarePlanEdit([row('a', 'Bath')], [{ id: 'a', ...fields('Bath') }, { id: 'a', ...fields('Bath') }, fields('Walk')], from);
    expect(edit.insert.map((i) => [i.fields.title.en, i.sortOrder, i.replaces])).toEqual([
      ['Bath', 1, null],
      ['Walk', 2, null],
    ]);
  });

  it('ignores activities that already ended before the date', () => {
    const edit = planCarePlanEdit([row('old', 'Bath', { effectiveTo: '2026-11-05' })], [], from);
    expect(edit).toEqual({ update: [], close: [], remove: [], insert: [] });
  });

  it('only allows edits from today or the latest change already planned', () => {
    const rows = [row('a', 'Bath', { effectiveFrom: '2026-11-01', effectiveTo: '2026-11-14' }), row('b', 'Bath 2', { effectiveFrom: '2026-11-15' })];
    expect(earliestEditDate(rows, '2026-11-08')).toBe('2026-11-15');
    expect(earliestEditDate([row('a', 'Bath')], '2026-11-08')).toBe('2026-11-08');
    // A row closed before it started (same-day edit with records) does not hold edits back.
    expect(earliestEditDate([row('dead', 'Bath', { effectiveFrom: '2026-11-20', effectiveTo: '2026-11-19' })], '2026-11-08')).toBe('2026-11-08');
    expect(activitiesInForce(rows, '2026-11-15').map((r) => r.id)).toEqual(['b']);
  });
});
