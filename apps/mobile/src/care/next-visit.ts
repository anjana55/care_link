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
