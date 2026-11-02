import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import { bookings, caregivers, careRequests, invoices, patients, payoutStatements } from '../../database/schema';

/**
 * Where the staff member is in the app when they ask - so "this booking" or
 * "assign it to me" needs no reference typed out.
 *
 * Only the page's path comes from the browser. What it means is worked out
 * here: the page from a fixed list, and a record from the database by its id
 * (so a made-up label can't put words in the model's mouth, and a record that
 * doesn't exist, or was deleted, is simply not mentioned).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** List pages and other screens, by path. The longest matching prefix wins. */
const PAGES: Record<string, string> = {
  '/dashboard': 'the dashboard (overview of caregivers and work)',
  '/requests': 'the Requests queue (care requests from clients)',
  '/requests/new': 'the form for taking a new care request over the phone',
  '/bookings': 'the Bookings list',
  '/bookings/new': 'the form for a new booking',
  '/care-plans': 'the Care plans list',
  '/invoices': 'the Invoices list',
  '/invoices/new': 'the form for a new invoice',
  '/payouts': 'the caregiver Payouts list',
  '/caregivers': 'the Caregivers list',
  '/caregivers/new': 'the form for adding a caregiver',
  '/clients': 'the Clients list',
  '/international': 'the Overseas (international placements) area',
  '/training': 'the Training area',
  '/account-deletions': 'the Account deletions queue',
  '/users': 'staff user management',
  '/settings': 'Settings',
  '/settings/import-export': 'Settings > Import & export (caregiver and client spreadsheets)',
};

type Kind = 'request' | 'booking' | 'caregiver' | 'client' | 'invoice' | 'payout';
const RECORD_ROUTES: Record<string, Kind> = {
  requests: 'request',
  bookings: 'booking',
  caregivers: 'caregiver',
  clients: 'client',
  invoices: 'invoice',
  payouts: 'payout',
};

export interface AssistantPageContext {
  path: string;
}

/** A sentence or two for the system prompt, or null when the path says nothing useful. */
export async function describeContext(db: Database, ctx: AssistantPageContext | undefined): Promise<string | null> {
  const path = ctx?.path?.split(/[?#]/)[0].replace(/\/+$/, '') || '';
  if (!path.startsWith('/')) return null;
  const parts = path.split('/').filter(Boolean);

  // A record page: /bookings/<id>, /caregivers/<id>...
  const kind = RECORD_ROUTES[parts[0]];
  if (kind && parts.length === 2 && UUID.test(parts[1])) {
    const record = await describeRecord(db, kind, parts[1]);
    if (record) return record;
  }

  const page = Object.keys(PAGES)
    .filter((p) => path === p || path.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  return page ? `They are on ${PAGES[page]}.` : null;
}

async function describeRecord(db: Database, kind: Kind, id: string): Promise<string | null> {
  const thisOne = (what: string, how: string) =>
    ` When they say "this", "it" or "here" without naming anything, they mean this ${what}${how ? ` - ${how}` : ''}.`;

  switch (kind) {
    case 'request': {
      const [r] = await db.select({ reference: careRequests.reference, status: careRequests.status }).from(careRequests).where(eq(careRequests.id, id)).limit(1);
      return r ? `They have care request ${r.reference} open (status ${r.status}).${thisOne('request', `look it up with get_request("${r.reference}")`)}` : null;
    }
    case 'booking': {
      const [b] = await db.select({ reference: bookings.reference, status: bookings.status }).from(bookings).where(eq(bookings.id, id)).limit(1);
      return b ? `They have booking ${b.reference} open (status ${b.status}).${thisOne('booking', `look it up with get_booking("${b.reference}")`)}` : null;
    }
    case 'caregiver': {
      const [c] = await db
        .select({ name: caregivers.fullName, reg: caregivers.registrationNumber, status: caregivers.status })
        .from(caregivers)
        .where(and(eq(caregivers.id, id), isNull(caregivers.deletedAt)))
        .limit(1);
      return c
        ? `They have the profile of caregiver ${c.name} (${c.reg}, id ${id}, status ${c.status}) open.${thisOne('caregiver', `their bookings are list_bookings(caregiver_id: "${id}")`)}`
        : null;
    }
    case 'client': {
      const [p] = await db.select({ name: patients.fullName }).from(patients).where(eq(patients.id, id)).limit(1);
      return p ? `They have the record of client ${p.name} (id ${id}) open.${thisOne('client', `their bookings are list_bookings(client_id: "${id}")`)}` : null;
    }
    case 'invoice': {
      const [i] = await db.select({ number: invoices.number, status: invoices.status }).from(invoices).where(eq(invoices.id, id)).limit(1);
      return i ? `They have invoice ${i.number ?? '(draft, no number yet)'} open (status ${i.status}). You have no tool for invoices; say so if they ask you to change it.` : null;
    }
    case 'payout': {
      const [s] = await db.select({ reference: payoutStatements.reference, status: payoutStatements.status }).from(payoutStatements).where(eq(payoutStatements.id, id)).limit(1);
      return s ? `They have payout statement ${s.reference} open (status ${s.status}). You have no tool for payouts; say so if they ask you to change it.` : null;
    }
  }
}
