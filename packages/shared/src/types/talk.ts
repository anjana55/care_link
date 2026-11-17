/**
 * "Talk to a person": a client or caregiver asks for a member of staff. If
 * they say what it is about (one of their requests, bookings or shifts), the
 * agents step back from that case until staff hand it back.
 */
export const TALK_CONTACT_METHODS = ['CALL', 'WHATSAPP', 'EMAIL'] as const;
export type TalkContactMethod = (typeof TALK_CONTACT_METHODS)[number];
export const TALK_ABOUT_TYPES = ['REQUEST', 'BOOKING', 'SHIFT'] as const;
export type TalkAboutType = (typeof TALK_ABOUT_TYPES)[number];
export const TALK_MESSAGE_MIN = 5;
export const TALK_MESSAGE_MAX = 1000;
/** Open requests one person can have at a time. */
export const TALK_MAX_OPEN = 3;

/** POST /me/talk-to-a-person */
export interface TalkRequestInput {
  message: string;
  contact: TalkContactMethod;
  about?: { type: TalkAboutType; id: string };
}

/** GET /me/talk-to-a-person: their own, newest first. */
export interface MyTalkRequest {
  id: string;
  createdAt: string;
  message: string;
  contact: TalkContactMethod;
  status: 'OPEN' | 'HANDLED';
  handledAt: string | null;
}

/** GET /talk-requests (staff). */
export interface StaffTalkRequest extends MyTalkRequest {
  role: 'CLIENT' | 'CAREGIVER';
  person: { name: string; phone: string | null; email: string | null; patientId: string | null; caregiverId: string | null };
  about: { type: TalkAboutType; id: string; reference: string; bookingId: string | null; requestId: string | null } | null;
  handledByName: string | null;
  staffNote: string | null;
}
