import { useEffect } from 'react';
import type { CareChecklistShift } from '@care-platform/shared';
import { localNotifications } from '@/push/notifications';

/** Marks the reminders the app set, so it only ever replaces its own. */
export const REMINDER_KIND = 'care-reminder';

export interface Reminder {
  /** Stable per item and shift, so setting them again replaces rather than duplicates. */
  id: string;
  at: Date;
  title: string;
  body: string;
}

/**
 * The care-plan items on these shifts that have a reminder still to come and
 * aren't marked yet: what the phone should remind the caregiver about.
 */
export function remindersFor(shifts: CareChecklistShift[], when: (item: CareChecklistShift['items'][number]) => string, now = Date.now()): Reminder[] {
  const all = shifts.flatMap((s) =>
    s.items
      .filter((i) => i.remindAt && i.status === null && new Date(i.remindAt).getTime() > now)
      .map((i) => ({ id: `${REMINDER_KIND}:${i.occurrenceId}`, at: new Date(i.remindAt!), title: i.title, body: `${when(i)} · ${s.bookingReference}` })),
  );
  // One reminder per item, even if the same plan arrives twice.
  return all.filter((r, i) => all.findIndex((x) => x.id === r.id) === i);
}

/**
 * Activity reminders on the caregiver's phone, from their care plans: each
 * item with a reminder time pops up then, even with no signal. Set again
 * whenever the plans change - the app's earlier reminders are replaced, and
 * nothing else on the phone is touched. Asks for permission only when there's
 * something to remind about. Quietly does nothing where the phone can't.
 */
export function useCareReminders(reminders: Reminder[] | null) {
  const signature = reminders ? reminders.map((r) => `${r.id}@${r.at.getTime()}`).join('|') : null;
  useEffect(() => {
    if (reminders === null) return;
    const n = localNotifications();
    if (!n) return;
    (async () => {
      const scheduled = await n.getAllScheduledNotificationsAsync();
      await Promise.all(
        scheduled.filter((r) => r.content.data?.kind === REMINDER_KIND).map((r) => n.cancelScheduledNotificationAsync(r.identifier)),
      );
      if (!reminders.length) return;
      let { status } = await n.getPermissionsAsync();
      if (status !== 'granted') ({ status } = await n.requestPermissionsAsync());
      if (status !== 'granted') return;
      for (const r of reminders) {
        await n.scheduleNotificationAsync({
          identifier: r.id,
          content: { title: r.title, body: r.body, data: { kind: REMINDER_KIND, path: '/home' }, sound: 'default' },
          trigger: { type: n.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: 'default' },
        });
      }
    })().catch(() => undefined);
    // Only when the reminders themselves change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
