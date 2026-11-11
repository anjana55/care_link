/**
 * In-app notifications: the bell on the website and in the app.
 *
 * Two lists sit behind one bell:
 * - **To do** - things still waiting on the person (pay an invoice, rate a
 *   caregiver, upload a document). Worked out live from the data on every
 *   request and never stored, so an item disappears the moment it is done.
 * - **Notifications** - every notice we sent them, stored, read or unread.
 *
 * The bell's number is unread notifications plus open to-dos.
 *
 * Every notice carries the screen it is about as an *app path* - the same
 * path the push notification carries (/bookings/{id}, /invoices/{id},
 * /shifts ...). The app maps it to a screen; the website maps it to a page
 * with webPathFor(), so the two can't drift.
 */

export const NOTIFICATION_LANGUAGES = ['en', 'si', 'ta'] as const;
export type NotificationLanguage = (typeof NOTIFICATION_LANGUAGES)[number];

/** A notice's title and body in each language (the bell shows whichever the person reads the site in). */
export type NotificationText = Record<NotificationLanguage, { title: string; body: string }>;

/** What a notice is about - picks its icon, and lets the history be filtered later. */
export const NOTIFICATION_CATEGORIES = ['BOOKING', 'REQUEST', 'INVOICE', 'PAYOUT', 'REVIEW', 'CARE', 'DOCUMENT', 'ANNOUNCEMENT', 'REMINDER', 'OTHER'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  /** In the language asked for, with the company name filled in. */
  title: string;
  body: string;
  /** The app path it opens (see webPathFor for the website). */
  path: string;
  /** An announcement's own link, if staff gave one: a page on the site (/...) or https://... */
  link: string | null;
  /** Pinned to the top of the list until read. */
  important: boolean;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsPage {
  items: NotificationItem[];
  /** Pass as ?before= for the next page; null when there is no more. */
  nextCursor: string | null;
}

// --- To do -------------------------------------------------------------------------------

export const TODO_KINDS = [
  // Clients
  'PAY_INVOICE',
  'RATE_CAREGIVER',
  'TICK_OFF_CARE',
  // Caregivers
  'UPLOAD_DOCUMENT',
  'DOCUMENT_REJECTED',
  'DOCUMENT_EXPIRING',
  'SHIFT_TODAY',
] as const;
export type TodoKind = (typeof TODO_KINDS)[number];

/**
 * One thing waiting on the person. Its text is written by the website and
 * app from `kind` and `params`, in whatever language they read in - the API
 * sends no sentences, so a to-do never shows in the wrong language.
 */
export interface TodoItem {
  /** Stable while the thing is open: `invoice:<id>`, `review:<bookingId>:<publicId>`, `document:<type>`... */
  key: string;
  kind: TodoKind;
  /** The app path its button opens. */
  path: string;
  /** Overdue, expired or happening today: shown first and in a warning colour. */
  urgent: boolean;
  /** Date it is due or expires (YYYY-MM-DD, Colombo), when there is one. */
  dueOn: string | null;
  /**
   * What the text needs, by kind:
   * PAY_INVOICE: number, amount (formatted LKR), overdue (1|0)
   * RATE_CAREGIVER: caregiver (display name), reference
   * TICK_OFF_CARE: count
   * UPLOAD_DOCUMENT, DOCUMENT_REJECTED, DOCUMENT_EXPIRING: document (CORE_DOCUMENTS label or document type), daysLeft
   * SHIFT_TODAY: time (HH:mm), reference
   */
  params: Record<string, string | number | null>;
}

/** One call drives the bell: its number, and the To do list. */
export interface NotificationsSummary {
  unread: number;
  todos: TodoItem[];
  /** unread + todos.length: the bell's number and the app icon's badge. */
  badge: number;
  /**
   * Unread notices by category, for numbers on the app's home cards (REQUEST
   * on My requests). Categories with none are left out. Optional: an older
   * API doesn't send it, and the app then shows no number.
   */
  unreadBy?: Partial<Record<NotificationCategory, number>>;
  /** The signed-in person's first name, for a greeting (see greetingName). Null when there is none to show. */
  firstName?: string | null;
}

/**
 * The name to greet someone by, from their full name: the first word that
 * isn't an initial or a title, so "W.A. Kamala Perera" and "Mrs. Kamala
 * Perera" are both greeted as Kamala. Null when nothing is left (a name of
 * initials only), so the greeting falls back to a plain one.
 */
export function greetingName(fullName: string | null | undefined): string | null {
  const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'rev', 'prof', 'sir', 'madam']);
  for (const word of (fullName ?? '').trim().split(/\s+/)) {
    const bare = word.replace(/[.,]/g, '');
    if (!bare) continue;
    if (word.includes('.') && bare.length <= 3) continue; // W.A., K.
    if (bare.length === 1) continue; // K
    if (TITLES.has(bare.toLowerCase())) continue;
    return bare.length > 40 ? bare.slice(0, 40) : bare;
  }
  return null;
}

/**
 * The documents staff need to verify a caregiver, as the caregiver's
 * documents page asks for them. A caregiver missing one has it on their To do.
 */
export const CORE_DOCUMENTS = [
  { label: 'identity', anyOf: ['NIC', 'PASSPORT'] },
  { label: 'police', anyOf: ['POLICE_CLEARANCE'] },
  { label: 'gn', anyOf: ['GRAMA_NILADHARI_CERTIFICATE'] },
] as const;
export type CoreDocumentLabel = (typeof CORE_DOCUMENTS)[number]['label'];

/** A document on To do from this many days before it expires. */
export const TODO_EXPIRY_DAYS = 30;

// --- Paths -------------------------------------------------------------------------------

/** Which category an app path belongs to. */
export function notificationCategory(path: string): NotificationCategory {
  if (/^\/bookings\/[^/]+\/rate\//.test(path) || path === '/me/ratings') return 'REVIEW';
  if (/^\/(bookings|shifts)(\/|$)/.test(path)) return 'BOOKING';
  if (/^\/requests(\/|$)/.test(path) || path === '/care-offers') return 'REQUEST';
  if (/^\/invoices(\/|$)/.test(path)) return 'INVOICE';
  if (path === '/payments') return 'PAYOUT';
  if (path === '/care') return 'CARE';
  if (path === '/documents') return 'DOCUMENT';
  if (path === '/notifications') return 'ANNOUNCEMENT';
  return 'OTHER';
}

const UUID = '[0-9a-fA-F-]{36}';
const PUBLIC_ID = '[A-Za-z0-9_-]{1,36}';

/**
 * The website page for an app path, for a client (PATIENT_GUARDIAN) or a
 * caregiver. Anything it doesn't know opens the person's notifications page.
 */
export function webPathFor(path: string, role: 'PATIENT_GUARDIAN' | 'CAREGIVER' | string): string {
  const caregiver = role === 'CAREGIVER';
  const home = caregiver ? '/caregiver/notifications' : '/account/notifications';
  const rate = new RegExp(`^/bookings/(${UUID})/rate/(${PUBLIC_ID})$`).exec(path);
  if (rate && !caregiver) return `/account/bookings/${rate[1]}/rate/${rate[2]}`;
  const invoice = new RegExp(`^/invoices/(${UUID})$`).exec(path);
  if (invoice && !caregiver) return `/account/invoices/${invoice[1]}`;
  if (caregiver) {
    if (/^\/(shifts|bookings)(\/|$)/.test(path) || path === '/care') return '/caregiver/shifts';
    if (path === '/payments') return '/caregiver/payments';
    if (path === '/me/ratings') return '/caregiver/ratings';
    if (path === '/documents') return '/caregiver/documents';
    if (path === '/care-offers') return '/caregiver/care-offers';
    if (/^\/requests(\/|$)/.test(path)) return '/caregiver/dashboard';
    return home;
  }
  if (/^\/bookings(\/|$)/.test(path) || path === '/care') return '/account/bookings';
  if (/^\/invoices(\/|$)/.test(path)) return '/account/invoices';
  if (/^\/requests(\/|$)/.test(path)) return '/account/requests';
  return home;
}

// --- Announcements -------------------------------------------------------------------

export const ANNOUNCEMENT_AUDIENCES = ['CLIENTS', 'CAREGIVERS', 'ALL'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const MAX_ANNOUNCEMENT_TITLE = 120;
export const MAX_ANNOUNCEMENT_BODY = 1000;

export interface Announcement {
  id: string;
  audience: AnnouncementAudience;
  text: NotificationText;
  link: string | null;
  important: boolean;
  sendPush: boolean;
  sendWhatsapp: boolean;
  createdByName: string | null;
  createdAt: string;
  publishedAt: string | null;
  /** How many people it went to, once published. */
  recipients: number;
  /** How many of them have opened it. */
  readCount: number;
}

// --- Settings ------------------------------------------------------------------------

/** Settings > Notifications. */
export interface NotificationSettings {
  /** Reminders (the ladder) on or off. The bell and event notices always work. */
  remindersEnabled: boolean;
  /** No reminder pushes or messages from this hour (Colombo)... */
  quietStartHour: number;
  /** ...until this hour. */
  quietEndHour: number;
  /** At most this many reminder messages per person per day; more are combined into one digest. */
  dailyReminderCap: number;
  /** Notifications older than this are deleted. */
  retentionDays: number;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  remindersEnabled: true,
  quietStartHour: 21,
  quietEndHour: 7,
  dailyReminderCap: 2,
  retentionDays: 180,
};

export const NOTIFICATION_SETTINGS_LIMITS = {
  hour: { min: 0, max: 23 },
  dailyReminderCap: { min: 1, max: 5 },
  retentionDays: { min: 30, max: 730 },
} as const;

/** True when `hour` (0-23, Colombo) is inside the quiet hours. Quiet hours may run past midnight. */
export function inQuietHours(hour: number, s: Pick<NotificationSettings, 'quietStartHour' | 'quietEndHour'>): boolean {
  const { quietStartHour: start, quietEndHour: end } = s;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
