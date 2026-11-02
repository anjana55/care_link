import { fireEvent, screen } from '@testing-library/react-native';
import en from '../src/i18n/en.json';
import { longDay } from '@/ui/Calendar';

const MONTH_TITLE = /^[A-Z][a-z]+ \d{4}$/;
const monthIndex = (y: number, m: number) => y * 12 + m;

/**
 * Opens the date field labelled `field` and chooses `day` (YYYY-MM-DD) on its
 * calendar the way a person would: a year at a time where the calendar offers
 * that, then a month at a time, then the day, then "Choose this date".
 */
export async function pickDate(field: string, day: string) {
  await fireEvent.press(screen.getByRole('button', { name: field }));
  const target = monthIndex(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1);
  for (let i = 0; i < 400; i++) {
    const shown = new Date(`1 ${screen.getByText(MONTH_TITLE).props.children} UTC`);
    const at = monthIndex(shown.getUTCFullYear(), shown.getUTCMonth());
    if (at === target) break;
    const years = Math.trunc((target - at) / 12);
    const yearButton = years ? screen.queryByRole('button', { name: years > 0 ? en.calendar.nextYear : en.calendar.previousYear }) : null;
    if (yearButton && !yearButton.props.accessibilityState?.disabled) await fireEvent.press(yearButton);
    else await fireEvent.press(screen.getByRole('button', { name: target > at ? en.calendar.nextMonth : en.calendar.previousMonth }));
  }
  await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${longDay(day, 'en')}`) }));
  await fireEvent.press(screen.getByRole('button', { name: en.calendar.confirm }));
}
