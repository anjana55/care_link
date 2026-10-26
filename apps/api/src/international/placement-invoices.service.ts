import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, asc, count, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import {
  PAYHERE_CURRENCIES,
  PLACEMENT_INVOICE_TERMS_DAYS,
  fromCents,
  toCents,
  type BillingParty,
  type PayhereCheckout,
  type PlacementInvoice,
  type PlacementInvoiceSummary,
  type StaffPlacementInvoiceRow,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  employerEnquiries,
  employers,
  placementCheckouts,
  placementInvoiceCounters,
  placementInvoicePayments,
  placementInvoices,
  placements,
  users,
} from '../database/schema';
import { BillingSettingsService } from '../billing/billing-settings.service';
import { PAYHERE_STATUS, PAYHERE_URLS, checkoutHash, payhereText, splitName, verifyNotification, type PayhereNotification } from '../billing/payhere';
import { PlacementInvoiceDto, PlacementInvoiceQueryDto, PlacementPaymentDto, UpdatePlacementInvoiceDto } from './dto/phase3.dto';
import { InternationalNotifier } from './international-notifier.service';
import { iso } from './employer-enquiries.service';
import { addDays, todayColombo } from './dates';

type InvoiceRow = typeof placementInvoices.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type CheckoutStatus = (typeof placementCheckouts.$inferSelect)['status'];

const STATUS_FOR: Record<string, CheckoutStatus> = {
  [PAYHERE_STATUS.SUCCESS]: 'SUCCESS',
  [PAYHERE_STATUS.PENDING]: 'PENDING',
  [PAYHERE_STATUS.CANCELLED]: 'CANCELLED',
  [PAYHERE_STATUS.FAILED]: 'FAILED',
  [PAYHERE_STATUS.CHARGEDBACK]: 'CHARGEDBACK',
};

/** "PF-2026-0007" */
export const placementInvoiceNumber = (year: number, n: number) => `PF-${year}-${String(n).padStart(4, '0')}`;

export const balanceCents = (inv: Pick<InvoiceRow, 'amount' | 'amountPaid'>) => toCents(inv.amount) - toCents(inv.amountPaid);

/** Issued, unpaid and past its due date. */
export const isOverdue = (inv: Pick<InvoiceRow, 'status' | 'dueDate'>, today = todayColombo()) => inv.status === 'ISSUED' && Boolean(inv.dueDate && inv.dueDate < today);

/** Where an invoice stands after a payment or refund. A refund can never take back more than was paid. */
export function afterPayment(inv: Pick<InvoiceRow, 'amount' | 'amountPaid' | 'status'>, amount: string): { amountPaid: string; status: 'ISSUED' | 'PAID' } {
  if (inv.status !== 'ISSUED' && inv.status !== 'PAID') throw new BadRequestException('Payments can only be recorded against an issued invoice.');
  const paid = toCents(inv.amountPaid) + toCents(amount);
  if (paid < 0) throw new BadRequestException('A refund cannot be more than has been paid.');
  return { amountPaid: fromCents(paid), status: paid >= toCents(inv.amount) ? 'PAID' : 'ISSUED' };
}

/**
 * The placement fee: the platform's revenue on the international path. Staff
 * raise an invoice to the employer (usually from a placement), issue it -
 * which numbers it, freezes who it is from, and emails the employer - and
 * record payments as they arrive: a bank transfer by hand, or a card payment
 * online through PayHere when the currency allows.
 *
 * As with client invoices (PayhereService), nothing the browser says about
 * an online payment counts: only PayHere's signed notification, for the
 * exact amount and currency of the checkout we created.
 */
@Injectable()
export class PlacementInvoicesService {
  private readonly logger = new Logger(PlacementInvoicesService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly settings: BillingSettingsService,
    private readonly notifier: InternationalNotifier,
  ) {}

  // --- staff -------------------------------------------------------------------

  async create(dto: PlacementInvoiceDto, userId: string): Promise<PlacementInvoice> {
    let enquiryId = dto.enquiryId ?? null;
    if (dto.placementId) {
      const [p] = await this.db.select({ enquiryId: placements.enquiryId }).from(placements).where(eq(placements.id, dto.placementId)).limit(1);
      if (!p) throw new NotFoundException('Placement not found');
      enquiryId = p.enquiryId;
    }
    if (!enquiryId) throw new BadRequestException('Choose the placement or enquiry this invoice is for.');
    const [row] = await this.db
      .select({ e: employerEnquiries, employerName: employers.organisationName, employerEmail: users.email })
      .from(employerEnquiries)
      .leftJoin(employers, eq(employerEnquiries.employerId, employers.id))
      .leftJoin(users, eq(employers.userId, users.id))
      .where(eq(employerEnquiries.id, enquiryId))
      .limit(1);
    if (!row) throw new NotFoundException('Enquiry not found');
    const id = uuid();
    await this.db.insert(placementInvoices).values({
      id,
      enquiryId,
      placementId: dto.placementId ?? null,
      employerId: row.e.employerId,
      currency: dto.currency,
      amount: fromCents(toCents(dto.amount)),
      description: dto.description,
      billToName: dto.billToName ?? row.employerName ?? row.e.organisationName,
      billToEmail: dto.billToEmail !== undefined ? dto.billToEmail : (row.employerEmail ?? row.e.email),
      billToAddress: dto.billToAddress ?? null,
      billToCountry: dto.billToCountry !== undefined ? dto.billToCountry : row.e.country,
      notes: dto.notes ?? null,
      createdByUserId: userId,
    });
    return this.get(id);
  }

  /** Only a draft can change; an issued invoice is voided and raised again. */
  async update(id: string, dto: UpdatePlacementInvoiceDto): Promise<PlacementInvoice> {
    const inv = await this.row(id);
    if (inv.status !== 'DRAFT') throw new BadRequestException('Only a draft invoice can be changed.');
    await this.db
      .update(placementInvoices)
      .set({
        currency: dto.currency,
        amount: fromCents(toCents(dto.amount)),
        description: dto.description,
        ...(dto.billToName !== undefined ? { billToName: dto.billToName } : {}),
        ...(dto.billToEmail !== undefined ? { billToEmail: dto.billToEmail } : {}),
        ...(dto.billToAddress !== undefined ? { billToAddress: dto.billToAddress } : {}),
        ...(dto.billToCountry !== undefined ? { billToCountry: dto.billToCountry } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(placementInvoices.id, id));
    return this.get(id);
  }

  async deleteDraft(id: string): Promise<{ success: true }> {
    const inv = await this.row(id);
    if (inv.status !== 'DRAFT') throw new BadRequestException('Only a draft invoice can be deleted - void an issued one.');
    await this.db.delete(placementInvoices).where(eq(placementInvoices.id, id));
    return { success: true };
  }

  /**
   * Numbers the invoice (without gaps, per year), freezes the business
   * details on it, and sends it to the employer.
   */
  async issue(id: string): Promise<PlacementInvoice> {
    const s = await this.settings.getResolved();
    const today = todayColombo();
    await this.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(placementInvoices).where(eq(placementInvoices.id, id)).for('update').limit(1);
      if (!inv) throw new NotFoundException('Invoice not found');
      if (inv.status !== 'DRAFT') throw new BadRequestException('This invoice has already been issued.');
      const number = await this.nextNumber(tx, Number(today.slice(0, 4)));
      await tx
        .update(placementInvoices)
        .set({
          number,
          status: 'ISSUED',
          issueDate: today,
          dueDate: addDays(today, PLACEMENT_INVOICE_TERMS_DAYS),
          sellerSnapshot: JSON.stringify(this.settings.sellerOf(s)),
          footer: s.invoiceFooter,
          issuedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(placementInvoices.id, id));
    });
    const issued = await this.get(id);
    void this.notifyIssued(issued);
    return issued;
  }

  async void(id: string, reason: string): Promise<PlacementInvoice> {
    const inv = await this.row(id);
    if (inv.status !== 'ISSUED') throw new BadRequestException('Only an issued invoice can be voided.');
    if (toCents(inv.amountPaid) !== 0) throw new BadRequestException('Refund the payments on this invoice before voiding it.');
    await this.db.update(placementInvoices).set({ status: 'VOID', voidedAt: new Date(), voidReason: reason, updatedAt: new Date() }).where(eq(placementInvoices.id, id));
    return this.get(id);
  }

  async recordPayment(id: string, dto: PlacementPaymentDto, userId: string): Promise<PlacementInvoice> {
    if (toCents(dto.amount) === 0) throw new BadRequestException('Enter an amount.');
    let settled = false;
    await this.db.transaction(async (tx) => {
      settled = await this.applyPayment(tx, id, {
        amount: fromCents(toCents(dto.amount)),
        method: dto.method,
        paidOn: dto.paidOn,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
        externalId: null,
        recordedByUserId: userId,
      });
    });
    const inv = await this.get(id);
    if (settled) void this.notifyPaid(inv);
    return inv;
  }

  async list(query: PlacementInvoiceQueryDto): Promise<StaffPlacementInvoiceRow[]> {
    const today = todayColombo();
    const where =
      query.status === 'overdue'
        ? and(eq(placementInvoices.status, 'ISSUED'), lt(placementInvoices.dueDate, today))
        : query.status
          ? eq(placementInvoices.status, query.status)
          : undefined;
    const rows = await this.db
      .select({ i: placementInvoices, reference: employerEnquiries.reference })
      .from(placementInvoices)
      .innerJoin(employerEnquiries, eq(placementInvoices.enquiryId, employerEnquiries.id))
      .where(where)
      .orderBy(desc(placementInvoices.createdAt))
      .limit(300);
    return rows.map(({ i, reference }) => ({ ...toSummary(i, today), enquiryReference: reference, billToName: i.billToName, description: i.description }));
  }

  async get(id: string): Promise<PlacementInvoice> {
    const [row] = await this.db
      .select({ i: placementInvoices, reference: employerEnquiries.reference })
      .from(placementInvoices)
      .innerJoin(employerEnquiries, eq(placementInvoices.enquiryId, employerEnquiries.id))
      .where(eq(placementInvoices.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Invoice not found');
    const [payments, s] = await Promise.all([
      this.db.select().from(placementInvoicePayments).where(eq(placementInvoicePayments.invoiceId, id)).orderBy(asc(placementInvoicePayments.createdAt)),
      this.settings.getResolved(),
    ]);
    const i = row.i;
    const summary = toSummary(i, todayColombo());
    return {
      ...summary,
      enquiryId: i.enquiryId,
      enquiryReference: row.reference,
      placementId: i.placementId,
      employerId: i.employerId,
      description: i.description,
      billToName: i.billToName,
      billToEmail: i.billToEmail,
      billToAddress: i.billToAddress,
      billToCountry: i.billToCountry,
      // A draft shows today's details; an issued invoice keeps the ones it was issued with.
      seller: i.sellerSnapshot ? (JSON.parse(i.sellerSnapshot) as BillingParty) : this.settings.sellerOf(s),
      footer: i.status === 'DRAFT' ? s.invoiceFooter : i.footer,
      notes: i.notes,
      voidReason: i.voidReason,
      payments: payments.map((p) => ({
        id: p.id,
        amount: fromCents(toCents(p.amount)),
        method: p.method,
        paidOn: p.paidOn,
        reference: p.reference,
        note: p.note,
        createdAt: iso(p.createdAt),
      })),
      payOnline: s.payhereUsable && i.status === 'ISSUED' && toCents(summary.balance) > 0 && (PAYHERE_CURRENCIES as readonly string[]).includes(i.currency),
      createdAt: iso(i.createdAt),
    };
  }

  async summariesForPlacements(placementIds: string[], { includeDrafts }: { includeDrafts: boolean }): Promise<Map<string, PlacementInvoiceSummary[]>> {
    const out = new Map<string, PlacementInvoiceSummary[]>();
    if (!placementIds.length) return out;
    const rows = await this.db
      .select()
      .from(placementInvoices)
      .where(and(inArray(placementInvoices.placementId, placementIds), includeDrafts ? undefined : ne(placementInvoices.status, 'DRAFT')))
      .orderBy(asc(placementInvoices.createdAt));
    const today = todayColombo();
    for (const r of rows) {
      const list = out.get(r.placementId!) ?? [];
      list.push(toSummary(r, today));
      out.set(r.placementId!, list);
    }
    return out;
  }

  async overdueCount(today = todayColombo()): Promise<number> {
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(placementInvoices)
      .where(and(eq(placementInvoices.status, 'ISSUED'), lt(placementInvoices.dueDate, today)));
    return Number(n);
  }

  // --- the employer --------------------------------------------------------------------

  async listForEmployer(employerId: string): Promise<PlacementInvoiceSummary[]> {
    const rows = await this.db
      .select()
      .from(placementInvoices)
      .where(and(eq(placementInvoices.employerId, employerId), ne(placementInvoices.status, 'DRAFT')))
      .orderBy(desc(placementInvoices.issuedAt))
      .limit(100);
    const today = todayColombo();
    return rows.map((r) => toSummary(r, today));
  }

  /** One of the employer's own issued invoices - a draft, or someone else's, reads as not found. */
  async getForEmployer(employerId: string, id: string): Promise<PlacementInvoice> {
    const inv = await this.row(id).catch(() => null);
    if (!inv || inv.employerId !== employerId || inv.status === 'DRAFT') throw new NotFoundException('Invoice not found');
    return this.get(id);
  }

  /** The PayHere form for the invoice's balance. The browser never chooses the amount. */
  async checkout(employerId: string, id: string, userId: string): Promise<PayhereCheckout> {
    const inv = await this.getForEmployer(employerId, id);
    if (!inv.payOnline) throw new BadRequestException('This invoice cannot be paid online - please pay by bank transfer.');
    const s = await this.settings.getResolved();
    const [account] = await this.db
      .select({ e: employers, email: users.email })
      .from(employers)
      .innerJoin(users, eq(employers.userId, users.id))
      .where(eq(employers.id, employerId))
      .limit(1);
    const phone = account?.e.phone;
    if (!phone) throw new BadRequestException('Add a phone number to your employer account to pay online.');
    const email = account?.email ?? inv.billToEmail;
    if (!email) throw new BadRequestException('Add an email address to pay online.');

    const orderId = uuid();
    await this.db.insert(placementCheckouts).values({
      id: orderId,
      invoiceId: id,
      amount: inv.balance,
      currency: inv.currency,
      mode: s.payhereMode,
      createdByUserId: userId,
    });
    const name = splitName(account?.e.contactName || inv.billToName);
    const fields: Record<string, string> = {
      merchant_id: s.payhereMerchantId!,
      return_url: this.notifier.publicUrl(`/employer/invoices/${id}?payment=return`),
      cancel_url: this.notifier.publicUrl(`/employer/invoices/${id}?payment=cancelled`),
      notify_url: placementNotifyUrl(s.payhereNotifyUrl),
      order_id: orderId,
      items: payhereText(`Placement fee ${inv.number}`),
      currency: inv.currency,
      amount: inv.balance,
      first_name: payhereText(name.first, 50) || 'Employer',
      last_name: payhereText(name.last, 50) || 'Employer',
      email,
      phone,
      address: payhereText(inv.billToAddress || inv.billToName),
      city: payhereText(inv.billToAddress?.split(',').pop() || inv.billToName, 50) || 'City',
      country: payhereText(countryName(inv.billToCountry ?? account?.e.country ?? ''), 50) || 'Sri Lanka',
      custom_1: id,
      hash: checkoutHash(s.payhereMerchantId!, orderId, inv.balance, inv.currency, s.payhereMerchantSecret!),
    };
    return { action: PAYHERE_URLS[s.payhereMode], fields };
  }

  /** PayHere's notification for a placement checkout. See PayhereService.handleNotification for the same rules. */
  async handleNotification(n: PayhereNotification): Promise<'OK' | 'BAD_SIGNATURE' | 'IGNORED'> {
    const s = await this.settings.getResolved();
    if (!s.payhereMerchantId || !s.payhereMerchantSecret) return 'IGNORED';
    if (!verifyNotification(n, s.payhereMerchantId, s.payhereMerchantSecret)) {
      this.logger.warn(`PayHere placement notification for order ${n.order_id ?? '?'} failed signature verification - ignored`);
      return 'BAD_SIGNATURE';
    }
    const next = STATUS_FOR[n.status_code ?? ''];
    if (!next) return 'IGNORED';

    let settled: string | null = null;
    await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(placementCheckouts).where(eq(placementCheckouts.id, n.order_id!)).for('update').limit(1);
      if (!c) {
        this.logger.warn(`PayHere placement notification for unknown order ${n.order_id} - ignored`);
        return;
      }
      const amountOk = n.payhere_currency === c.currency && toCents(n.payhere_amount!) === toCents(c.amount);
      const patch = { paymentId: n.payment_id ?? c.paymentId, method: n.method?.slice(0, 20) ?? c.method, statusMessage: n.status_message?.slice(0, 255) ?? null, updatedAt: new Date() };
      const paidOn = todayColombo();

      if (next === 'SUCCESS') {
        if (!amountOk) {
          this.logger.error(`PayHere placement order ${c.id}: paid ${n.payhere_amount} ${n.payhere_currency}, expected ${c.amount} ${c.currency} - NOT applied`);
          await tx.update(placementCheckouts).set({ ...patch, status: 'FAILED', statusMessage: 'Amount did not match the checkout' }).where(eq(placementCheckouts.id, c.id));
          return;
        }
        if (c.status === 'SUCCESS') return;
        await tx.update(placementCheckouts).set({ ...patch, status: 'SUCCESS' }).where(eq(placementCheckouts.id, c.id));
        const done = await this.applyPayment(tx, c.invoiceId, {
          amount: fromCents(toCents(c.amount)),
          method: 'CARD_ONLINE',
          paidOn,
          reference: n.payment_id ?? null,
          note: n.method ? `PayHere ${n.method}` : 'PayHere',
          externalId: n.payment_id || c.id,
          recordedByUserId: null,
        });
        if (done) settled = c.invoiceId;
        return;
      }
      if (next === 'CHARGEDBACK') {
        if (c.status === 'SUCCESS') {
          await this.applyPayment(tx, c.invoiceId, {
            amount: fromCents(-toCents(c.amount)),
            method: 'CARD_ONLINE',
            paidOn,
            reference: n.payment_id ?? null,
            note: 'PayHere chargeback',
            externalId: `${n.payment_id || c.id}:chargeback`,
            recordedByUserId: null,
          });
        }
        await tx.update(placementCheckouts).set({ ...patch, status: 'CHARGEDBACK' }).where(eq(placementCheckouts.id, c.id));
        return;
      }
      if (c.status !== 'SUCCESS' && c.status !== 'CHARGEDBACK') {
        await tx.update(placementCheckouts).set({ ...patch, status: next }).where(eq(placementCheckouts.id, c.id));
      }
    });
    if (settled) void this.get(settled).then((inv) => this.notifyPaid(inv));
    return 'OK';
  }

  // --- internals ----------------------------------------------------------------------------

  /** Records money against an invoice inside the caller's transaction. True when it settled the invoice. */
  private async applyPayment(
    tx: Tx,
    invoiceId: string,
    p: { amount: string; method: (typeof placementInvoicePayments.$inferInsert)['method']; paidOn: string; reference: string | null; note: string | null; externalId: string | null; recordedByUserId: string | null },
  ): Promise<boolean> {
    const [inv] = await tx.select().from(placementInvoices).where(eq(placementInvoices.id, invoiceId)).for('update').limit(1);
    if (!inv) throw new NotFoundException('Invoice not found');
    if (p.externalId) {
      const [dup] = await tx.select({ id: placementInvoicePayments.id }).from(placementInvoicePayments).where(eq(placementInvoicePayments.externalId, p.externalId)).limit(1);
      if (dup) return false;
    }
    const next = afterPayment(inv, p.amount);
    await tx.insert(placementInvoicePayments).values({ id: uuid(), invoiceId, ...p });
    await tx
      .update(placementInvoices)
      .set({
        amountPaid: next.amountPaid,
        status: next.status,
        paidAt: next.status === 'PAID' ? (inv.paidAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(placementInvoices.id, invoiceId));
    return next.status === 'PAID' && inv.status !== 'PAID';
  }

  /** The year's next number. The counter row is locked until the issuing transaction commits. */
  private async nextNumber(tx: Tx, year: number): Promise<string> {
    await tx.insert(placementInvoiceCounters).values({ year, lastNumber: 0 }).onDuplicateKeyUpdate({ set: { year: sql`year` } });
    const [c] = await tx.select().from(placementInvoiceCounters).where(eq(placementInvoiceCounters.year, year)).for('update').limit(1);
    const n = (c?.lastNumber ?? 0) + 1;
    await tx.update(placementInvoiceCounters).set({ lastNumber: n }).where(eq(placementInvoiceCounters.year, year));
    return placementInvoiceNumber(year, n);
  }

  private async row(id: string): Promise<InvoiceRow> {
    const [row] = await this.db.select().from(placementInvoices).where(eq(placementInvoices.id, id)).limit(1);
    if (!row) throw new NotFoundException('Invoice not found');
    return row;
  }

  private async notifyIssued(inv: PlacementInvoice) {
    await this.notifier.toAddress(inv.billToEmail, `placement invoice ${inv.number}`, {
      subject: `Invoice ${inv.number} - placement fee`,
      paragraphs: [
        `Please find invoice ${inv.number} for ${inv.description}: ${inv.currency} ${inv.amount}, due ${inv.dueDate}.`,
        inv.employerId
          ? `Sign in to your employer account to see the invoice${inv.payOnline ? ' and pay it online by card' : ''}, or pay by bank transfer using the details on it.`
          : 'Reply to this email for a copy of the invoice and our bank details.',
      ],
      ...(inv.employerId ? { cta: { label: 'View invoice', url: this.notifier.publicUrl(`/employer/invoices/${inv.id}`) } } : {}),
    });
  }

  private async notifyPaid(inv: PlacementInvoice) {
    await this.notifier.toStaff(`placement invoice paid ${inv.number}`, {
      subject: `Placement fee paid - ${inv.number}`,
      paragraphs: [`${inv.billToName} has paid invoice ${inv.number} (${inv.currency} ${inv.amount}).`],
      cta: { label: 'Open invoices', url: this.notifier.staffUrl('/international?tab=invoices') },
    });
    await this.notifier.toAddress(inv.billToEmail, `placement invoice receipt ${inv.number}`, {
      subject: `Payment received - ${inv.number}`,
      paragraphs: [`Thank you. We have received payment in full for invoice ${inv.number} (${inv.currency} ${inv.amount}).`],
    });
  }
}

/** PayHere posts placement payments to their own address next to the client-invoice one. */
export function placementNotifyUrl(clientNotifyUrl: string): string {
  return clientNotifyUrl.replace(/\/notify$/, '/placement-notify');
}

function toSummary(i: InvoiceRow, today: string): PlacementInvoiceSummary {
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    currency: i.currency,
    amount: fromCents(toCents(i.amount)),
    amountPaid: fromCents(toCents(i.amountPaid)),
    balance: fromCents(i.status === 'VOID' ? 0 : balanceCents(i)),
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    overdue: isOverdue(i, today),
  };
}

function countryName(code: string): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
