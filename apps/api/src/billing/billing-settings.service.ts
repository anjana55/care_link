import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import type { BillingParty } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { billingSettings } from '../database/schema';
import { decryptSecret, deriveKey, encryptSecret } from '../common/utils/secret-box.util';
import { UpdateBillingSettingsDto } from './dto/billing-settings.dto';
import { PAYHERE_URLS } from './payhere';

const SETTINGS_ID = 'default';
type Row = typeof billingSettings.$inferSelect;

export interface ResolvedBillingSettings extends Omit<Row, 'payhereMerchantSecretEncrypted'> {
  payhereMerchantSecret: string | null;
  /** PayHere switched on AND complete - the only state in which "Pay online" is offered. */
  payhereUsable: boolean;
  /** Where PayHere posts its notifications. */
  payhereNotifyUrl: string;
}

export type AdminBillingSettings = Omit<ResolvedBillingSettings, 'payhereMerchantSecret'> & {
  payhereMerchantSecretSet: boolean;
  payhereMerchantSecretLast4: string | null;
  payhereCheckoutUrl: string;
};

/**
 * Owns the single admin-managed billing row (Settings > Billing). Read on
 * every use rather than cached, like the email and WhatsApp settings, so a
 * change - or switching online payment off in an incident - applies at once
 * on every API instance.
 */
@Injectable()
export class BillingSettingsService {
  private readonly encryptionKey: Buffer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    const root = this.config.get<string>('SETTINGS_ENCRYPTION_KEY') || this.config.get<string>('JWT_REFRESH_SECRET') || '';
    this.encryptionKey = deriveKey(root, 'billing-settings');
  }

  private async getRow(db: Database = this.db): Promise<Row> {
    const [existing] = await db.select().from(billingSettings).where(eq(billingSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;
    await db.insert(billingSettings).values({ id: SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
    const [created] = await db.select().from(billingSettings).where(eq(billingSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  private defaultNotifyBase() {
    const web = (this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '');
    return `${web}/api`;
  }

  private resolve(row: Row): ResolvedBillingSettings {
    const { payhereMerchantSecretEncrypted, ...rest } = row;
    const secret = decryptSecret(payhereMerchantSecretEncrypted, this.encryptionKey);
    const base = (row.payhereNotifyBaseUrl?.trim() || this.defaultNotifyBase()).replace(/\/+$/, '');
    return {
      ...rest,
      payhereMerchantSecret: secret,
      payhereUsable: row.payhereEnabled && Boolean(row.payhereMerchantId) && Boolean(secret),
      payhereNotifyUrl: `${base}/payments/payhere/notify`,
    };
  }

  async getResolved(): Promise<ResolvedBillingSettings> {
    return this.resolve(await this.getRow());
  }

  async getForAdmin(): Promise<AdminBillingSettings> {
    const { payhereMerchantSecret, ...rest } = this.resolve(await this.getRow());
    return {
      ...rest,
      payhereMerchantSecretSet: Boolean(payhereMerchantSecret),
      // An API-issued secret, not a person's password: the tail helps an admin tell two apart.
      payhereMerchantSecretLast4: payhereMerchantSecret ? payhereMerchantSecret.slice(-4) : null,
      payhereCheckoutUrl: PAYHERE_URLS[rest.payhereMode],
    };
  }

  /** Who invoices are from, as printed. Copied onto an invoice when it is issued. */
  sellerOf(s: Pick<Row, 'businessName' | 'businessAddress' | 'businessPhone' | 'businessEmail' | 'registrationNumber' | 'taxRegistrationNumber'>): BillingParty {
    return {
      name: s.businessName,
      address: s.businessAddress,
      phone: s.businessPhone,
      email: s.businessEmail,
      registrationNumber: s.registrationNumber,
      taxRegistrationNumber: s.taxRegistrationNumber,
    };
  }

  /**
   * Takes the next invoice number and moves the counter on, inside the
   * caller's transaction: the row is locked until it commits, so two invoices
   * issued at the same moment can never share a number, and a rolled-back
   * issue gives its number back.
   */
  async takeInvoiceNumber(tx: Database): Promise<{ number: string; settings: Row }> {
    await this.getRow(tx);
    await tx.execute(sql`SELECT id FROM billing_settings WHERE id = ${SETTINGS_ID} FOR UPDATE`);
    const [row] = await tx.select().from(billingSettings).where(eq(billingSettings.id, SETTINGS_ID)).limit(1);
    await tx.update(billingSettings).set({ nextInvoiceNumber: row.nextInvoiceNumber + 1 }).where(eq(billingSettings.id, SETTINGS_ID));
    return { number: `${row.invoicePrefix}-${String(row.nextInvoiceNumber).padStart(6, '0')}`, settings: row };
  }

  async update(dto: UpdateBillingSettingsDto, updatedBy: string): Promise<AdminBillingSettings> {
    const current = await this.getResolved();
    const text = (v: string | undefined, fallback: string | null) => (v === undefined ? fallback : v.trim() || null);

    if (dto.nextInvoiceNumber !== undefined && dto.nextInvoiceNumber < current.nextInvoiceNumber) {
      throw new BadRequestException('The next invoice number can only move forward - lower numbers may already be used');
    }
    const next = {
      businessName: text(dto.businessName, current.businessName) ?? 'CareLink',
      businessAddress: text(dto.businessAddress, current.businessAddress),
      businessPhone: text(dto.businessPhone, current.businessPhone),
      businessEmail: text(dto.businessEmail, current.businessEmail),
      registrationNumber: text(dto.registrationNumber, current.registrationNumber),
      taxEnabled: dto.taxEnabled ?? current.taxEnabled,
      taxName: text(dto.taxName, current.taxName) ?? 'VAT',
      taxRate: dto.taxRate !== undefined ? Number(dto.taxRate).toFixed(2) : current.taxRate,
      taxRegistrationNumber: text(dto.taxRegistrationNumber, current.taxRegistrationNumber),
      invoicePrefix: dto.invoicePrefix ?? current.invoicePrefix,
      nextInvoiceNumber: dto.nextInvoiceNumber ?? current.nextInvoiceNumber,
      paymentTermsDays: dto.paymentTermsDays ?? current.paymentTermsDays,
      invoiceFooter: dto.invoiceFooter === undefined ? current.invoiceFooter : dto.invoiceFooter.trim() || null,
      payhereEnabled: dto.payhereEnabled ?? current.payhereEnabled,
      payhereMode: dto.payhereMode ?? current.payhereMode,
      payhereMerchantId: text(dto.payhereMerchantId, current.payhereMerchantId),
      payhereNotifyBaseUrl: text(dto.payhereNotifyBaseUrl, current.payhereNotifyBaseUrl),
    };
    const newSecret = dto.payhereMerchantSecret?.trim() || null;
    const clearSecret = Boolean(dto.clearPayhereMerchantSecret);
    const nextSecret = clearSecret ? null : (newSecret ?? current.payhereMerchantSecret);

    if (next.taxEnabled && !(Number(next.taxRate) > 0)) throw new BadRequestException('Set a tax rate above zero before turning tax on');
    if (next.payhereEnabled) {
      const missing: string[] = [];
      if (!next.payhereMerchantId) missing.push('merchant ID');
      if (!nextSecret) missing.push('merchant secret');
      if (missing.length) throw new BadRequestException(`Cannot turn on online payment without: ${missing.join(', ')}`);
    }

    const patch: Partial<typeof billingSettings.$inferInsert> = { ...next, updatedBy, updatedAt: new Date() };
    if (clearSecret) patch.payhereMerchantSecretEncrypted = null;
    else if (newSecret) patch.payhereMerchantSecretEncrypted = encryptSecret(newSecret, this.encryptionKey);
    await this.db.update(billingSettings).set(patch).where(eq(billingSettings.id, SETTINGS_ID));
    return this.getForAdmin();
  }
}
