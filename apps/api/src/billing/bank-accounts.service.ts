import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { bankAccountLabel, isMethodAllowedForType, type BankAccount, type PaymentMethod, type PaymentType } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bankAccounts, invoicePayments, payoutStatements } from '../database/schema';
import type { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';

type Row = typeof bankAccounts.$inferSelect;

const toDto = (r: Row): BankAccount => ({
  id: r.id,
  bankName: r.bankName,
  branch: r.branch,
  accountName: r.accountName,
  accountNumber: r.accountNumber,
  active: r.active,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** What a payment says about how it was made, checked and ready to store. */
export interface PaymentDetails {
  paymentType: PaymentType;
  method: PaymentMethod | null;
  bankAccountId: string | null;
  /** "bank transfer · Commercial Bank - 1234 (CareLink)" - for the document's history. */
  note: string;
}

const TYPE_NOTE: Record<PaymentType, string> = { CASH: 'cash', BANK: 'bank', ONLINE: 'online' };
const METHOD_NOTE: Record<PaymentMethod, string> = {
  CASH: 'cash',
  BANK_TRANSFER: 'bank transfer',
  CHEQUE: 'cheque',
  CARD: 'card',
  PAYHERE: 'PayHere',
  OTHER: 'other',
};

/**
 * The business's own bank accounts (Settings > Billing), and the one place a
 * payment's type / detail / account combination is checked, for client
 * payments and caregiver payouts alike.
 */
@Injectable()
export class BankAccountsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Active accounts first; staff need the list to record payments, so this is not admin-only. */
  async list(): Promise<BankAccount[]> {
    const rows = await this.db.select().from(bankAccounts).orderBy(desc(bankAccounts.active), asc(bankAccounts.bankName), asc(bankAccounts.accountNumber));
    return rows.map(toDto);
  }

  async create(dto: CreateBankAccountDto): Promise<BankAccount> {
    const id = uuid();
    await this.db.insert(bankAccounts).values({
      id,
      bankName: dto.bankName,
      branch: dto.branch ?? null,
      accountName: dto.accountName,
      accountNumber: dto.accountNumber,
      active: dto.active ?? true,
    });
    return toDto(await this.rowOrThrow(id));
  }

  async update(id: string, dto: UpdateBankAccountDto): Promise<BankAccount> {
    await this.rowOrThrow(id);
    await this.db
      .update(bankAccounts)
      .set({
        ...(dto.bankName !== undefined ? { bankName: dto.bankName } : {}),
        ...(dto.branch !== undefined ? { branch: dto.branch || null } : {}),
        ...(dto.accountName !== undefined ? { accountName: dto.accountName } : {}),
        ...(dto.accountNumber !== undefined ? { accountNumber: dto.accountNumber } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        updatedAt: new Date(),
      })
      .where(eq(bankAccounts.id, id));
    return toDto(await this.rowOrThrow(id));
  }

  /** Only an account no payment points at can be deleted; otherwise it is deactivated instead. */
  async remove(id: string): Promise<void> {
    await this.rowOrThrow(id);
    const [incoming] = await this.db.select({ id: invoicePayments.id }).from(invoicePayments).where(eq(invoicePayments.bankAccountId, id)).limit(1);
    const [outgoing] = await this.db.select({ id: payoutStatements.id }).from(payoutStatements).where(eq(payoutStatements.bankAccountId, id)).limit(1);
    if (incoming || outgoing) {
      throw new ConflictException('Payments have been recorded against this account. Turn it off instead, so past payments keep showing it.');
    }
    await this.db.delete(bankAccounts).where(eq(bankAccounts.id, id));
  }

  /**
   * Checks how a payment was made and returns what to store:
   *  - the detail (cheque, card...) must belong to the type, and PayHere is
   *    never picked by hand - those entries come from PayHere itself;
   *  - only BANK payments name an account, and it must be an active one.
   */
  async resolvePayment(input: { paymentType: PaymentType; method?: PaymentMethod | null; bankAccountId?: string | null }): Promise<PaymentDetails> {
    const method = input.method ?? null;
    if (method === 'PAYHERE') throw new BadRequestException('PayHere payments are recorded automatically when the client pays online');
    if (!isMethodAllowedForType(input.paymentType, method)) throw new BadRequestException('That detail does not match the payment type');

    let account: Row | null = null;
    if (input.bankAccountId) {
      if (input.paymentType !== 'BANK') throw new BadRequestException('Only a bank payment can name a bank account');
      account = await this.rowOrThrow(input.bankAccountId);
      if (!account.active) throw new BadRequestException('That bank account is turned off - choose another, or turn it back on in Settings > Billing');
    }

    return {
      paymentType: input.paymentType,
      method,
      bankAccountId: account?.id ?? null,
      note: [method ? METHOD_NOTE[method] : TYPE_NOTE[input.paymentType], account ? bankAccountLabel(account) : null].filter(Boolean).join(' · '),
    };
  }

  /** Account labels by id, for showing stored payments. */
  async labels(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!wanted.length) return new Map();
    const rows = await this.db.select().from(bankAccounts);
    return new Map(rows.filter((r) => wanted.includes(r.id)).map((r) => [r.id, bankAccountLabel(r)]));
  }

  /** How a stored payment reads in a history note. */
  static noteFor(p: { paymentType: PaymentType | null; method: PaymentMethod | null }, accountLabel?: string | null): string {
    const head = p.method ? METHOD_NOTE[p.method] : p.paymentType ? TYPE_NOTE[p.paymentType] : '';
    return [head, accountLabel].filter(Boolean).join(' · ');
  }

  private async rowOrThrow(id: string): Promise<Row> {
    const [row] = await this.db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
    if (!row) throw new NotFoundException('Bank account not found');
    return row;
  }
}
