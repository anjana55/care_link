import { createHash } from 'crypto';
import { computeTotals, formatLkr, fromCents, toCents } from '@care-platform/shared';
import { buildLines, monthsIn, type LineBooking, type LineShift } from './line-builder';
import { checkoutHash, splitName, verifyNotification } from './payhere';

const md5 = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase();

describe('money in cents', () => {
  it('parses and prints two-place decimals exactly', () => {
    expect(toCents('1234.5')).toBe(123450);
    expect(toCents('-0.05')).toBe(-5);
    expect(toCents('0')).toBe(0);
    expect(fromCents(123450)).toBe('1234.50');
    expect(fromCents(-5)).toBe('-0.05');
    expect(() => toCents('12.345')).toThrow();
    expect(() => toCents('1,000')).toThrow();
  });

  it('formats rupees for display', () => {
    expect(formatLkr('1234567.5')).toBe('LKR 1,234,567.50');
    expect(formatLkr('-250')).toBe('-LKR 250.00');
    expect(formatLkr(null)).toBe('—');
  });
});

describe('computeTotals', () => {
  it('adds lines, takes line discounts, then the invoice discount, then tax', () => {
    const t = computeTotals({
      lines: [
        { quantity: '12.00', unitPrice: '500.00' }, // 6000
        { quantity: '1', unitPrice: '3500', discountType: 'PERCENT', discountValue: '10' }, // 3500 - 350 = 3150
        { quantity: '1', unitPrice: '1000', discountType: 'AMOUNT', discountValue: '200' }, // 800
      ],
      discountType: 'PERCENT',
      discountValue: '5',
      taxRate: '18',
    });
    expect(t.lines.map((l) => l.amount)).toEqual(['6000.00', '3150.00', '800.00']);
    expect(t.subtotal).toBe('9950.00');
    expect(t.discount).toBe('497.50');
    expect(t.taxableAmount).toBe('9452.50');
    expect(t.tax).toBe('1701.45');
    expect(t.total).toBe('11153.95');
  });

  it('rounds each line half away from zero, to the cent', () => {
    // 7.25 h x 333.33 = 2416.6425 -> 2416.64; 0.5 x 0.05 = 0.025 -> 0.03
    const t = computeTotals({ lines: [{ quantity: '7.25', unitPrice: '333.33' }, { quantity: '0.5', unitPrice: '0.05' }] });
    expect(t.lines.map((l) => l.amount)).toEqual(['2416.64', '0.03']);
    expect(t.total).toBe('2416.67');
  });

  it('lets an adjustment credit the invoice, but never discounts a credit', () => {
    const t = computeTotals({
      lines: [
        { quantity: '1', unitPrice: '5000' },
        { quantity: '1', unitPrice: '-1500', discountType: 'PERCENT', discountValue: '50' },
      ],
    });
    expect(t.lines[1]).toEqual({ gross: '-1500.00', discount: '0.00', amount: '-1500.00' });
    expect(t.total).toBe('3500.00');
  });

  it('never discounts below zero', () => {
    const line = computeTotals({ lines: [{ quantity: '1', unitPrice: '100', discountType: 'AMOUNT', discountValue: '250' }] });
    expect(line.lines[0].amount).toBe('0.00');
    const invoice = computeTotals({ lines: [{ quantity: '1', unitPrice: '100' }], discountType: 'AMOUNT', discountValue: '999' });
    expect(invoice.discount).toBe('100.00');
    expect(invoice.total).toBe('0.00');
    const pct = computeTotals({ lines: [{ quantity: '1', unitPrice: '100' }], discountType: 'PERCENT', discountValue: '150' });
    expect(pct.total).toBe('0.00');
  });

  it('charges tax only on taxable lines, after their share of the invoice discount', () => {
    const t = computeTotals({
      lines: [
        { quantity: '1', unitPrice: '8000', taxable: true },
        { quantity: '1', unitPrice: '2000', taxable: false }, // a reimbursed expense
      ],
      discountType: 'AMOUNT',
      discountValue: '1000',
      taxRate: '18',
    });
    // 80% of the discount falls on the taxable line: 8000 - 800 = 7200; 18% = 1296
    expect(t.taxableAmount).toBe('7200.00');
    expect(t.tax).toBe('1296.00');
    expect(t.total).toBe('10296.00');
  });

  it('charges no tax without a rate', () => {
    expect(computeTotals({ lines: [{ quantity: '1', unitPrice: '100' }], taxRate: null }).tax).toBe('0.00');
  });
});

describe('monthsIn', () => {
  it('counts a whole calendar month as one, whatever its length', () => {
    expect(monthsIn('2026-10-01', '2026-10-31')).toBe('1.00');
    expect(monthsIn('2027-02-01', '2027-02-28')).toBe('1.00');
    expect(monthsIn('2026-10-01', '2026-12-31')).toBe('3.00');
  });

  it('counts part-months as days / 30', () => {
    expect(monthsIn('2026-10-15', '2026-10-31')).toBe('0.57'); // 17 / 30
    expect(monthsIn('2026-10-15', '2026-11-14')).toBe('1.03'); // 17 + 14 days
    expect(monthsIn('2026-10-20', '2026-10-20')).toBe('0.03');
  });
});

describe('buildLines', () => {
  // Shifts are UTC instants; 02:30Z is 08:00 Colombo.
  const at = (date: string, hhmm: string) => new Date(new Date(`${date}T${hhmm}:00+05:30`).toISOString());
  const booking = (over: Partial<LineBooking> = {}): LineBooking => ({
    id: 'b1',
    reference: 'BK-AAAAAA',
    caregiverId: 'cg1',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    rateType: 'DAILY',
    rateAmount: '3500.00',
    ...over,
  });
  const shift = (id: string, date: string, over: Partial<LineShift> = {}): LineShift => ({
    id,
    bookingId: 'b1',
    caregiverId: 'cg1',
    startsAt: at(date, '08:00'),
    endsAt: at(date, '20:00'),
    status: 'COMPLETED',
    ...over,
  });
  const base = { mode: 'INVOICE' as const, language: 'en' as const, from: '2026-10-01', to: '2026-10-31', statuses: ['COMPLETED'] as const, billedShiftIds: new Set<string>(), billedPeriods: [] };

  it('bills one day per completed shift at a daily rate, in time order', () => {
    const r = buildLines({ ...base, bookings: [booking()], shifts: [shift('s2', '2026-10-21'), shift('s1', '2026-10-20'), shift('s3', '2026-10-22', { status: 'MISSED' })] });
    expect(r.lines.map((l) => [l.shiftId, l.serviceDate, l.quantity, l.unit, l.unitPrice])).toEqual([
      ['s1', '2026-10-20', '1.00', 'DAY', '3500.00'],
      ['s2', '2026-10-21', '1.00', 'DAY', '3500.00'],
    ]);
    expect(r.lines[0].description).toBe('Care shift 08:00–20:00 (BK-AAAAAA)');
  });

  it('bills hours at an hourly rate, and dates a night shift by the day it starts', () => {
    const night = shift('n1', '2026-10-31', { startsAt: at('2026-10-31', '20:00'), endsAt: at('2026-11-01', '07:30') });
    const r = buildLines({ ...base, bookings: [booking({ rateType: 'HOURLY', rateAmount: '400.00' })], shifts: [night] });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ serviceDate: '2026-10-31', quantity: '11.50', unit: 'HOUR', unitPrice: '400.00' });
  });

  it('leaves out shifts outside the period, and ones already billed', () => {
    const r = buildLines({
      ...base,
      bookings: [booking()],
      shifts: [shift('s0', '2026-09-30'), shift('s1', '2026-10-01'), shift('s2', '2026-10-02'), shift('s3', '2026-11-01')],
      billedShiftIds: new Set(['s2']),
    });
    expect(r.lines.map((l) => l.shiftId)).toEqual(['s1']);
    expect(r.skipped).toBe(1);
  });

  it('bills scheduled shifts too when billing in advance', () => {
    const r = buildLines({ ...base, statuses: ['SCHEDULED', 'COMPLETED'], bookings: [booking()], shifts: [shift('s1', '2026-10-20', { status: 'SCHEDULED' })] });
    expect(r.lines).toHaveLength(1);
  });

  it('bills a monthly rate once per booking for the part of the period it runs', () => {
    const r = buildLines({
      ...base,
      bookings: [booking({ rateType: 'MONTHLY', rateAmount: '90000.00', startDate: '2026-10-15' })],
      shifts: [shift('s1', '2026-10-15'), shift('s2', '2026-10-16')],
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ unit: 'MONTH', quantity: '0.57', unitPrice: '90000.00', shiftId: null, periodStart: '2026-10-15', periodEnd: '2026-10-31' });
  });

  it('does not bill a monthly period twice', () => {
    const r = buildLines({
      ...base,
      bookings: [booking({ rateType: 'MONTHLY', rateAmount: '90000.00' })],
      shifts: [shift('s1', '2026-10-20')],
      billedPeriods: [{ bookingId: 'b1', periodStart: '2026-10-01', periodEnd: '2026-10-31' }],
    });
    expect(r.lines).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it('prices at zero, and says so, when the booking has no rate', () => {
    const r = buildLines({ ...base, bookings: [booking({ rateType: null, rateAmount: null })], shifts: [shift('s1', '2026-10-20')] });
    expect(r.lines[0]).toMatchObject({ unit: 'HOUR', quantity: '12.00', unitPrice: '0.00' });
    expect(r.unpriced).toBe(1);
  });

  it('pays a caregiver only for the shifts they worked, covers included', () => {
    const shifts = [shift('s1', '2026-10-20'), shift('s2', '2026-10-21', { caregiverId: 'cover' }), shift('s3', '2026-10-22')];
    const own = buildLines({ ...base, mode: 'PAYOUT', caregiverId: 'cg1', bookings: [booking()], shifts });
    const cover = buildLines({ ...base, mode: 'PAYOUT', caregiverId: 'cover', bookings: [booking()], shifts });
    expect(own.lines.map((l) => l.shiftId)).toEqual(['s1', 's3']);
    expect(cover.lines.map((l) => l.shiftId)).toEqual(['s2']);
    expect(cover.lines[0].description).toBe('BK-AAAAAA · 08:00–20:00');
  });

  it('pays a cover on a monthly booking per shift, at a thirtieth of the month', () => {
    const shifts = [shift('s1', '2026-10-20'), shift('s2', '2026-10-21', { caregiverId: 'cover' })];
    const b = booking({ rateType: 'MONTHLY', rateAmount: '60000.00' });
    const cover = buildLines({ ...base, mode: 'PAYOUT', caregiverId: 'cover', bookings: [b], shifts });
    expect(cover.lines[0]).toMatchObject({ unit: 'DAY', quantity: '1.00', unitPrice: '2000.00', shiftId: 's2' });
    const own = buildLines({ ...base, mode: 'PAYOUT', caregiverId: 'cg1', bookings: [b], shifts });
    expect(own.lines[0]).toMatchObject({ unit: 'MONTH', quantity: '1.00' });
  });

  it('writes invoice lines in the invoice language', () => {
    const r = buildLines({ ...base, language: 'si', bookings: [booking()], shifts: [shift('s1', '2026-10-20')] });
    expect(r.lines[0].description).toBe('රැකවරණ වාරය 08:00–20:00 (BK-AAAAAA)');
  });
});

describe('PayHere', () => {
  const merchant = '1211149';
  const secret = 'MzM3NjQ0MDkzODMwMzM0NjI1MTUyMjg4NTkzODkxMzQ3NTQ4MDQ0';

  it('hashes the checkout the way PayHere documents it', () => {
    const expected = md5(`${merchant}ORDER-1` + `1000.00` + `LKR` + md5(secret));
    expect(checkoutHash(merchant, 'ORDER-1', '1000.00', 'LKR', secret)).toBe(expected);
  });

  const signed = (status: string, amount = '1000.00') => ({
    merchant_id: merchant,
    order_id: 'ORDER-1',
    payment_id: '320025071278',
    payhere_amount: amount,
    payhere_currency: 'LKR',
    status_code: status,
    md5sig: md5(`${merchant}ORDER-1${amount}LKR${status}${md5(secret)}`),
  });

  it('believes a notification signed with our secret', () => {
    expect(verifyNotification(signed('2'), merchant, secret)).toBe(true);
    expect(verifyNotification({ ...signed('2'), md5sig: signed('2').md5sig.toLowerCase() }, merchant, secret)).toBe(true);
  });

  it('rejects a notification whose values were changed, or signed with another secret', () => {
    expect(verifyNotification({ ...signed('2'), payhere_amount: '1.00' }, merchant, secret)).toBe(false);
    expect(verifyNotification({ ...signed('-2'), status_code: '2' }, merchant, secret)).toBe(false);
    expect(verifyNotification(signed('2'), merchant, 'another-secret')).toBe(false);
    expect(verifyNotification({ ...signed('2'), merchant_id: '999' }, merchant, secret)).toBe(false);
    expect(verifyNotification({ ...signed('2'), md5sig: undefined }, merchant, secret)).toBe(false);
  });

  it('splits one full name into the first and last names PayHere wants', () => {
    expect(splitName('Nimal Kumara Perera')).toEqual({ first: 'Nimal Kumara', last: 'Perera' });
    expect(splitName('Madonna')).toEqual({ first: 'Madonna', last: 'Madonna' });
  });
});
