import { interviewIcs, type Interview, type Locale } from '@care-platform/shared';

const tag = (locale: Locale) => (locale === 'en' ? 'en-GB' : `${locale}-LK`);

/**
 * An interview time in the viewer's own time zone, with the zone named -
 * the employer in Osaka and the caregiver in Kandy each read their own clock.
 */
export function fmtInterview(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(tag(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(new Date(iso));
}

export const isUpcoming = (i: Pick<Interview, 'status' | 'scheduledAt' | 'durationMinutes'>, now = Date.now()) =>
  i.status === 'SCHEDULED' && new Date(i.scheduledAt).getTime() + i.durationMinutes * 60_000 > now;

/** Saves the interview as an .ics file the phone or calendar app opens. Built here; nothing is sent anywhere. */
export function downloadIcs(i: Interview, summary: string) {
  const blob = new Blob([interviewIcs(i, summary)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `interview-${i.round}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
