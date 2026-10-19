import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID as uuid } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { fromCents, toCents, type PayhereCheckout } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { payhereCheckouts, patients, users } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BillingSettingsService } from './billing-settings.service';
import { BillingNotifier } from './billing-notifier.service';
import { InvoicesService } from './invoices.service';
import { PAYHERE_STATUS, PAYHERE_URLS, checkoutHash, payhereText, splitName, verifyNotification, type PayhereNotification } from './payhere';

type Tx = Database;
type CheckoutStatus = (typeof payhereCheckouts.$inferSelect)['status'];

const STATUS_FOR: Record<string, CheckoutStatus> = {
  [PAYHERE_STATUS.SUCCESS]: 'SUCCESS',
  [PAYHERE_STATUS.PENDING]: 'PENDING',
  [PAYHERE_STATUS.CANCELLED]: 'CANCELLED',
  [PAYHERE_STATUS.FAILED]: 'FAILED',
  [PAYHERE_STATUS.CHARGEDBACK]: 'CHARGEDBACK',
};

/**
 * Paying an invoice online through PayHere.
 *
 * The client asks to pay; we record a checkout (its id is PayHere's order_id),
 * work out the hash here, and hand the browser a form to post to PayHere. The
 * browser never decides the amount: it is the invoice's balance at that
 * moment, and the hash binds PayHere to it.
 *
 * Nothing the browser is told afterwards counts. The payment is recorded only
 * when PayHere's own notification arrives with a signature our secret
 * produces, for the order and the exact amount we created. A notification
 * repeated (PayHere retries) is applied once: the checkout moves to SUCCESS
 * once, and the payment row is unique on PayHere's payment id.
 */
@Injectable()
export class PayhereService {
  private readonly logger = new Logger(PayhereService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly settings: BillingSettingsService,
    private readonly invoices: InvoicesService,
    private readonly notifier: BillingNotifier,
  ) {}

  private publicUrl(path: string) {
    return `${(this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '')}${path}`;
  }

  async checkout(user: AuthenticatedUser, invoiceId: string, email?: string): Promise<PayhereCheckout> {
    const s = await this.settings.getResolved();
    if (!s.payhereUsable) throw new BadRequestException('Online payment is not available right now - please contact us to pay');
    const { invoice, balance } = await this.invoices.payableForClient(user, invoiceId);
    const [patient] = await this.db.select().from(patients).where(eq(patients.id, invoice.patientId)).limit(1);
    const [account] = await this.db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, patient.userId)).limit(1);
    const receiptTo = account?.email || invoice.billToEmail || email || null;
    if (!receiptTo) throw new BadRequestException('Enter an email address for your payment receipt');
    const phone = account?.phone || patient.phone || invoice.billToPhone;
    if (!phone) throw new BadRequestException('Add a phone number to your account to pay online');

    const orderId = uuid();
    await this.db.insert(payhereCheckouts).values({
      id: orderId,
      invoiceId,
      amount: balance,
      currency: 'LKR',
      mode: s.payhereMode,
      status: 'PENDING',
      createdByUserId: user.userId,
    });
    const name = splitName(invoice.billToName);
    const fields: Record<string, string> = {
      merchant_id: s.payhereMerchantId!,
      return_url: this.publicUrl(`/account/invoices/${invoiceId}?payment=return`),
      cancel_url: this.publicUrl(`/account/invoices/${invoiceId}?payment=cancelled`),
      notify_url: s.payhereNotifyUrl,
      order_id: orderId,
      items: payhereText(`Invoice ${invoice.number}`),
      currency: 'LKR',
      amount: balance,
      first_name: payhereText(name.first, 50) || 'Client',
      last_name: payhereText(name.last, 50) || 'Client',
      email: receiptTo,
      phone,
      address: payhereText(invoice.billToAddress || patient.city || 'Sri Lanka'),
      city: payhereText(patient.city || patient.district || 'Colombo', 50),
      country: 'Sri Lanka',
      custom_1: invoiceId,
      hash: checkoutHash(s.payhereMerchantId!, orderId, balance, 'LKR', s.payhereMerchantSecret!),
    };
    return { action: PAYHERE_URLS[s.payhereMode], fields };
  }

  /**
   * PayHere's server-to-server notification. Returns whether it was believed;
   * the controller answers 200 either way once the signature checks out, so
   * PayHere stops retrying, and 400 when it does not.
   */
  async handleNotification(n: PayhereNotification): Promise<'OK' | 'BAD_SIGNATURE' | 'IGNORED'> {
    const s = await this.settings.getResolved();
    if (!s.payhereMerchantId || !s.payhereMerchantSecret) {
      this.logger.warn('PayHere notification received but no merchant is configured - ignored');
      return 'IGNORED';
    }
    if (!verifyNotification(n, s.payhereMerchantId, s.payhereMerchantSecret)) {
      this.logger.warn(`PayHere notification for order ${n.order_id ?? '?'} failed signature verification - ignored`);
      return 'BAD_SIGNATURE';
    }
    const next = STATUS_FOR[n.status_code ?? ''];
    if (!next) {
      this.logger.warn(`PayHere notification for order ${n.order_id} has an unknown status ${n.status_code} - ignored`);
      return 'IGNORED';
    }

    let settledInvoice = null as string | null;
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      await t.execute(sql`SELECT id FROM payhere_checkouts WHERE id = ${n.order_id} FOR UPDATE`);
      const [c] = await tx.select().from(payhereCheckouts).where(eq(payhereCheckouts.id, n.order_id!)).limit(1);
      if (!c) {
        this.logger.warn(`PayHere notification for unknown order ${n.order_id} - ignored`);
        return;
      }
      const amountOk = n.payhere_currency === c.currency && toCents(n.payhere_amount!) === toCents(c.amount);
      const patch = { paymentId: n.payment_id ?? c.paymentId, method: n.method?.slice(0, 20) ?? c.method, statusMessage: n.status_message?.slice(0, 255) ?? null, updatedAt: new Date() };

      if (next === 'SUCCESS') {
        if (!amountOk) {
          this.logger.error(`PayHere order ${c.id}: paid ${n.payhere_amount} ${n.payhere_currency}, expected ${c.amount} ${c.currency} - NOT applied; check it in the PayHere portal`);
          await tx.update(payhereCheckouts).set({ ...patch, status: 'FAILED', statusMessage: 'Amount did not match the checkout' }).where(eq(payhereCheckouts.id, c.id));
          return;
        }
        if (c.status === 'SUCCESS') return; // a retry of one we already applied
        await tx.update(payhereCheckouts).set({ ...patch, status: 'SUCCESS' }).where(eq(payhereCheckouts.id, c.id));
        const result = await this.invoices.applyExternalPayment(t, c.invoiceId, {
          amount: c.amount,
          method: 'PAYHERE',
          externalId: n.payment_id || c.id,
          reference: n.payment_id ?? null,
          note: n.method ? `PayHere ${n.method}` : 'PayHere',
        });
        if (result.settled) settledInvoice = c.invoiceId;
        return;
      }

      if (next === 'CHARGEDBACK') {
        if (c.status === 'SUCCESS') {
          await this.invoices.applyExternalPayment(t, c.invoiceId, {
            amount: fromCents(-toCents(c.amount)),
            method: 'PAYHERE',
            externalId: `${n.payment_id || c.id}:chargeback`,
            reference: n.payment_id ?? null,
            note: 'PayHere chargeback',
          });
        }
        await tx.update(payhereCheckouts).set({ ...patch, status: 'CHARGEDBACK' }).where(eq(payhereCheckouts.id, c.id));
        return;
      }

      // Pending, cancelled or failed: nothing moves on the invoice. A late
      // "failed" never undoes a success already applied.
      if (c.status !== 'SUCCESS' && c.status !== 'CHARGEDBACK') {
        await tx.update(payhereCheckouts).set({ ...patch, status: next }).where(eq(payhereCheckouts.id, c.id));
      }
    });
    if (settledInvoice) void this.notifier.invoicePaid(settledInvoice);
    return 'OK';
  }
}
