import { BadRequestException } from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';

/** A db whose select(...).from(...).where(...).limit(...) resolves to `rows`. */
function fakeDb(rows: unknown[]) {
  const chain = { from: () => chain, where: () => chain, limit: async () => rows };
  return { select: () => chain } as never;
}

const ACCOUNT = { id: 'acc-1', bankName: 'Commercial Bank', branch: null, accountName: 'CareLink', accountNumber: '1000123', active: true };

describe('BankAccountsService.resolvePayment', () => {
  it('accepts cash with no detail and no account', async () => {
    const svc = new BankAccountsService(fakeDb([]));
    await expect(svc.resolvePayment({ paymentType: 'CASH' })).resolves.toMatchObject({ paymentType: 'CASH', method: null, bankAccountId: null, note: 'cash' });
  });

  it('keeps a detail that belongs to the type, and names the bank account', async () => {
    const svc = new BankAccountsService(fakeDb([ACCOUNT]));
    await expect(svc.resolvePayment({ paymentType: 'BANK', method: 'CHEQUE', bankAccountId: 'acc-1' })).resolves.toEqual({
      paymentType: 'BANK',
      method: 'CHEQUE',
      bankAccountId: 'acc-1',
      note: 'cheque · Commercial Bank - 1000123 (CareLink)',
    });
  });

  it('rejects a detail from another type, a hand-picked PayHere, and an account on a non-bank payment', async () => {
    const svc = new BankAccountsService(fakeDb([ACCOUNT]));
    await expect(svc.resolvePayment({ paymentType: 'CASH', method: 'CHEQUE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.resolvePayment({ paymentType: 'ONLINE', method: 'PAYHERE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.resolvePayment({ paymentType: 'ONLINE', bankAccountId: 'acc-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an account that has been turned off', async () => {
    const svc = new BankAccountsService(fakeDb([{ ...ACCOUNT, active: false }]));
    await expect(svc.resolvePayment({ paymentType: 'BANK', bankAccountId: 'acc-1' })).rejects.toThrow(/turned off/);
  });
});
