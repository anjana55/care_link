import { BadRequestException } from '@nestjs/common';
import {
  MAX_CARE_INSTRUCTIONS,
  MAX_CARE_TITLE,
  careActivityProblems,
  cleanLocalizedText,
  normalizeCareActivity,
  type CareActivityFields,
  type CareActivityView,
  type IsoWeekday,
  type LocalizedText,
} from '@care-platform/shared';
import type { CareActivityDto } from './dto/care-plan.dto';

/** An activity row as stored (templates and plans share these columns). */
export interface ActivityRow {
  id: string;
  sortOrder: number;
  category: CareActivityFields['category'];
  title: LocalizedText;
  instructions: LocalizedText | null;
  timing: CareActivityFields['timing'];
  slot: CareActivityFields['slot'];
  times: string | null;
  daysOfWeek: string | null;
  isCritical: boolean;
  reminderMinutesBefore: number | null;
  onTimeMinutes: number | null;
}

/** MySQL JSON columns can come back as a string from some drivers; accept both. */
const json = (v: unknown): LocalizedText => {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as LocalizedText;
    } catch {
      return {};
    }
  }
  return (v as LocalizedText) ?? {};
};

export function rowToFields(r: ActivityRow): CareActivityFields {
  return {
    category: r.category,
    title: json(r.title),
    instructions: json(r.instructions),
    timing: r.timing,
    slot: r.slot ?? null,
    times: r.times ? r.times.split(',').filter(Boolean) : [],
    daysOfWeek: r.daysOfWeek ? (r.daysOfWeek.split(',').map(Number) as IsoWeekday[]) : null,
    isCritical: Boolean(r.isCritical),
    reminderMinutesBefore: r.reminderMinutesBefore ?? null,
    onTimeMinutes: r.onTimeMinutes ?? null,
  };
}

export const rowToView = (r: ActivityRow): CareActivityView => ({ id: r.id, sortOrder: r.sortOrder, ...rowToFields(r) });

export function fieldsToColumns(f: CareActivityFields) {
  const n = normalizeCareActivity(f);
  return {
    category: n.category,
    title: n.title,
    instructions: Object.keys(n.instructions).length ? n.instructions : null,
    timing: n.timing,
    slot: n.slot,
    times: n.times.length ? n.times.join(',') : null,
    daysOfWeek: n.daysOfWeek ? n.daysOfWeek.join(',') : null,
    isCritical: n.isCritical,
    reminderMinutesBefore: n.reminderMinutesBefore,
    onTimeMinutes: n.onTimeMinutes,
  };
}

const PROBLEM_TEXT: Record<string, string> = {
  category: 'Choose a category for each activity',
  title: 'Give each activity a title',
  timing: 'Choose when each activity is done',
  slot: 'Choose the part of the day',
  times: 'Enter the times as HH:MM, each once',
  daysOfWeek: 'Choose at least one day, or every shift',
  reminder: 'Choose when to remind the caregiver',
  onTime: 'Choose how long an item counts as on time',
};

/** Cleans the activities from a form and rejects the first one that does not make sense. */
export function cleanActivities<T extends CareActivityDto>(list: T[]): (CareActivityFields & { id?: string })[] {
  return list.map((a) => {
    const fields: CareActivityFields & { id?: string } = {
      ...(a.id ? { id: a.id } : {}),
      category: a.category,
      title: cleanLocalizedText(a.title, MAX_CARE_TITLE),
      instructions: cleanLocalizedText(a.instructions, MAX_CARE_INSTRUCTIONS),
      timing: a.timing,
      slot: a.slot ?? null,
      times: a.times ?? [],
      daysOfWeek: a.daysOfWeek?.length ? a.daysOfWeek : null,
      isCritical: Boolean(a.isCritical),
      reminderMinutesBefore: a.reminderMinutesBefore ?? null,
      onTimeMinutes: a.onTimeMinutes ?? null,
    };
    const [problem] = careActivityProblems(fields);
    if (problem) throw new BadRequestException(PROBLEM_TEXT[problem] ?? 'Check the activities');
    return fields;
  });
}
