import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { openItemCount, type AccountOpenItems } from '@care-platform/shared';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';

export interface DeletionRequestedNotice {
  role: 'CAREGIVER' | 'PATIENT_GUARDIAN';
  name: string | null;
  /** The caregiver's registration number, or the client's email or phone. */
  reference: string | null;
  requestedAt: Date;
  eraseAfter: Date;
  openItems: AccountOpenItems;
}

/** What still holds an erasure back, in words: "2 upcoming shifts, 1 unpaid invoice". */
const OPEN_ITEM_WORDS: Record<keyof AccountOpenItems, [string, string]> = {
  upcomingShifts: ['upcoming shift', 'upcoming shifts'],
  unpaidPayouts: ['payout not yet paid', 'payouts not yet paid'],
  activePlacements: ['active placement abroad', 'active placements abroad'],
  activeBookings: ['active booking', 'active bookings'],
  unpaidInvoices: ['unpaid invoice', 'unpaid invoices'],
  openCareRequests: ['open care request', 'open care requests'],
  openAdjustments: ['open billing correction', 'open billing corrections'],
};

export function describeOpenItems(items: AccountOpenItems): string {
  return (Object.keys(OPEN_ITEM_WORDS) as (keyof AccountOpenItems)[])
    .filter((k) => items[k] > 0)
    .map((k) => `${items[k]} ${OPEN_ITEM_WORDS[k][items[k] === 1 ? 0 : 1]}`)
    .join(', ');
}

/** A date as staff read it, in Sri Lanka time: "14 Nov 2026, 8:14 pm". */
export const colomboDateTime = (d: Date) =>
  d.toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

/**
 * Tells staff when someone deletes their own account in the app or on the
 * website: who, when it will be erased, and what has to be settled first.
 * Sent to the same list as new care requests (Settings > Email). Best-effort:
 * a failed email is logged, never thrown - the request has already happened,
 * and it is waiting in Account deletions either way.
 */
@Injectable()
export class AccountDeletionNotifier {
  private readonly logger = new Logger(AccountDeletionNotifier.name);

  constructor(
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
    private readonly config: ConfigService,
  ) {}

  async requested(n: DeletionRequestedNotice): Promise<void> {
    try {
      const to = await this.emailSettings.staffAlertRecipients();
      if (!to.length) {
        this.logger.warn('Account deletion request: no staff email address to alert - it is waiting in Account deletions.');
        return;
      }
      const caregiver = n.role === 'CAREGIVER';
      const who = `${caregiver ? 'Caregiver' : 'Client'} ${n.name ?? '(no name)'}${n.reference ? ` (${n.reference})` : ''}`;
      const open = openItemCount(n.openItems);
      const paragraphs = [
        `${who} deleted their account on ${colomboDateTime(n.requestedAt)}.`,
        caregiver
          ? 'The account is locked: they are signed out, cannot sign in, and no longer appear in search or on shared profile links.'
          : 'The account is locked: they are signed out and cannot sign in.',
        open
          ? `Still open, to settle before it can be erased: ${describeOpenItems(n.openItems)}. It will be erased once these are settled, from ${colomboDateTime(n.eraseAfter)}.`
          : `Nothing is open. It will be erased on ${colomboDateTime(n.eraseAfter)}.`,
        'If it was a mistake, cancel the request in Account deletions before then: that restores the account as it was.',
      ];
      await this.email.sendNotificationEmail(
        to,
        {
          subject: `Account deleted by ${caregiver ? 'a caregiver' : 'a client'}: ${n.name ?? n.reference ?? 'unknown'}`,
          blocks: [{ lang: 'en', heading: 'An account deletion request', paragraphs }],
          cta: { label: 'Open Account deletions', url: this.staffUrl('/account-deletions') },
          footer: 'Sent to the request alert list in Settings > Email, or to every admin and staff account when that list is empty.',
        },
        'account deletion request',
      );
    } catch (err) {
      this.logger.warn(`Account deletion request: staff alert failed - ${(err as Error).message}`);
    }
  }

  private staffUrl(path: string) {
    return `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}${path}`;
  }
}
