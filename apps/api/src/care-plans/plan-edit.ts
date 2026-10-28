import { addDays, normalizeCareActivity, sameCareActivity, type CareActivityFields } from '@care-platform/shared';

/** A plan activity as the edit rule needs it. */
export interface EditableActivity extends CareActivityFields {
  id: string;
  sortOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Someone (or the sweep) has recorded an outcome against it. */
  hasRecords: boolean;
}

export interface CarePlanEdit {
  /** Rows changed in place: an activity not yet in force with nothing recorded, or only a new position. */
  update: { id: string; fields: CareActivityFields; sortOrder: number; contentChanged: boolean }[];
  /** Rows that stop the day before the edit takes effect. */
  close: { id: string; effectiveTo: string }[];
  /** Rows that never applied and have nothing recorded - deleted outright. */
  remove: string[];
  /** New rows from the edit's date on; `replaces` links an edited activity to its earlier version. */
  insert: { fields: CareActivityFields; sortOrder: number; replaces: string | null }[];
}

/**
 * The plan as it is in force on `from`: activities that have started by then
 * and have not ended before it.
 */
export function activitiesInForce<T extends { effectiveFrom: string; effectiveTo: string | null }>(all: T[], on: string): T[] {
  return all.filter((a) => a.effectiveFrom <= on && (!a.effectiveTo || a.effectiveTo >= on));
}

/**
 * The earliest date an edit may take effect: today (an edit never rewrites the
 * past) and no earlier than the latest change already planned, so the plan
 * always reads as one list per date.
 */
export function earliestEditDate(all: { effectiveFrom: string; effectiveTo: string | null }[], today: string): string {
  const live = all.filter((a) => !a.effectiveTo || a.effectiveTo >= a.effectiveFrom);
  return live.reduce((max, a) => (a.effectiveFrom > max ? a.effectiveFrom : max), today);
}

/**
 * What saving the plan as `incoming` from `from` does to the stored rows.
 * Pure, so the rule is read and tested in one place:
 *
 * - An incoming activity with the id of one in force and the same content
 *   keeps that row (its position may change).
 * - Changed content: a row that only starts on or after `from` with nothing
 *   recorded is changed in place; otherwise the old row closes the day before
 *   `from` and a new row starts on `from`, linked to it.
 * - A row in force that is not in `incoming` is deleted when it never applied
 *   and has nothing recorded, otherwise closed the day before `from`.
 * - Anything without a known id is new from `from`.
 */
export function planCarePlanEdit(existing: EditableActivity[], incoming: (CareActivityFields & { id?: string })[], from: string): CarePlanEdit {
  const current = activitiesInForce(existing, from).concat(existing.filter((a) => a.effectiveFrom > from));
  const byId = new Map(current.map((a) => [a.id, a]));
  const kept = new Set<string>();
  const edit: CarePlanEdit = { update: [], close: [], remove: [], insert: [] };
  const dayBefore = addDays(from, -1);
  const fresh = (a: EditableActivity) => a.effectiveFrom >= from && !a.hasRecords;

  incoming.forEach((raw, sortOrder) => {
    const fields = normalizeCareActivity(stripId(raw));
    const old = raw.id ? byId.get(raw.id) : undefined;
    if (!old || kept.has(old.id)) {
      edit.insert.push({ fields, sortOrder, replaces: null });
      return;
    }
    kept.add(old.id);
    if (sameCareActivity(old, fields)) {
      if (old.sortOrder !== sortOrder) edit.update.push({ id: old.id, fields: normalizeCareActivity(stripRow(old)), sortOrder, contentChanged: false });
    } else if (fresh(old)) {
      edit.update.push({ id: old.id, fields, sortOrder, contentChanged: true });
    } else {
      edit.close.push({ id: old.id, effectiveTo: dayBefore });
      edit.insert.push({ fields, sortOrder, replaces: old.id });
    }
  });

  for (const old of current) {
    if (kept.has(old.id)) continue;
    if (fresh(old)) edit.remove.push(old.id);
    else edit.close.push({ id: old.id, effectiveTo: dayBefore });
  }
  return edit;
}

function stripId(a: CareActivityFields & { id?: string }): CareActivityFields {
  return {
    category: a.category,
    title: a.title,
    instructions: a.instructions ?? {},
    timing: a.timing,
    slot: a.slot ?? null,
    times: a.times ?? [],
    daysOfWeek: a.daysOfWeek ?? null,
    isCritical: Boolean(a.isCritical),
  };
}

const stripRow = (a: EditableActivity): CareActivityFields => stripId(a);
