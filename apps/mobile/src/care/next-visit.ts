import type { ClientBooking, PortalShift } from '@care-platform/shared';

/**
 * A client's next caregiver visit, for their home: the earliest scheduled
 * shift of a confirmed booking that hasn't ended yet (one under way counts).
 */
export function nextVisit(bookings: ClientBooking[], now = Date.now()): { booking: ClientBooking; shift: PortalShift } | null {
  let best: { booking: ClientBooking; shift: PortalShift } | null = null;
  for (const booking of bookings) {
    if (booking.status !== 'CONFIRMED') continue;
    for (const shift of booking.shifts) {
      if (shift.status !== 'SCHEDULED' || new Date(shift.endsAt).getTime() <= now) continue;
      if (!best || new Date(shift.startsAt).getTime() < new Date(best.shift.startsAt).getTime()) best = { booking, shift };
    }
  }
  return best;
}

/** The Sri Lanka calendar day (yyyy-mm-dd) an instant falls on. */
function colomboDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Whether a client has care today: a shift of a confirmed booking, not
 * cancelled, that starts or ends on today's date in Sri Lanka (a night shift
 * from yesterday still counts). Home shows "Today's care" only then.
 */
export function hasCareToday(bookings: ClientBooking[], now = Date.now()): boolean {
  const today = colomboDay(new Date(now).toISOString());
  return bookings.some(
    (booking) =>
      booking.status === 'CONFIRMED' &&
      booking.shifts.some((shift) => shift.status !== 'CANCELLED' && (colomboDay(shift.startsAt) === today || colomboDay(shift.endsAt) === today)),
  );
}
