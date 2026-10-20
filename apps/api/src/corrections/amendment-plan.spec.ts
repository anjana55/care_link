import { colomboToUtc } from '@care-platform/shared';
import { buildLines } from '../billing/line-builder';
import { fromBuilt } from '../billing/billing-lines';
import { describeChanges, planAmendment, type PlanBooking, type PlanDocument, type PlanShift } from './amendment-plan';

const booking = (over: Partial<PlanBooking> = {}): PlanBooking => ({
  id: 'b1',
  reference: 'BK-TEST01',
  patientId: 'p1',
  caregiverId: 'cgA',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  rateType: 'HOURLY',
  rateAmount: '500.00',
  payRateType: 'HOURLY',
  payRateAmount: '300.00',
  ...over,
});

const shift = (id: string, date: string, from = '08:00', to = '16:00', over: Partial<PlanShift> = {}): PlanShift => ({
  id,
  bookingId: 'b1',
  caregiverId: 'cgA',
  startsAt: colomboToUtc(date, from),
  endsAt: colomboToUtc(date, to),
  status: 'COMPLETED',
  rateType: null,
  rateAmount: null,
  payRateType: null,
  payRateAmount: null,
  note: null,
  ...over,
});

/** A document whose lines are exactly what the line builder makes for these shifts. */
function doc(kind: 'INVOICE' | 'PAYOUT', b: PlanBooking, shifts: PlanShift[], over: Partial<PlanDocument> = {}): PlanDocument {
  const caregiverId = over.caregiverId ?? (kind === 'PAYOUT' ? 'cgA' : undefined);
  const built = buildLines({
    mode: kind,
    language: 'en',
    from: '2026-10-01',
    to: '2026-10-31',
    statuses: ['COMPLETED'],
    caregiverId,
    bookings: [
      {
        id: b.id,
        reference: b.reference,
        caregiverId: b.caregiverId,
        startDate: b.startDate,
        endDate: b.endDate,
        rateType: kind === 'INVOICE' ? b.rateType : b.payRateType,
        rateAmount: kind === 'INVOICE' ? b.rateAmount : b.payRateAmount,
      },
    ],
    shifts: shifts.map((s) => ({ ...s, rateType: kind === 'INVOICE' ? s.rateType : s.payRateType, rateAmount: kind === 'INVOICE' ? s.rateAmount : s.payRateAmount })),
    billedShiftIds: new Set(),
    billedPeriods: [],
  });
  return {
    kind,
    id: `${kind}-1`,
    label: kind === 'INVOICE' ? 'INV-0001' : 'PS-AAAAAA',
    status: 'DRAFT',
    basis: kind === 'INVOICE' ? 'COMPLETED' : undefined,
    caregiverId,
    language: 'en',
    amountPaid: '0.00',
    partyName: kind === 'INVOICE' ? 'Client' : 'Caregiver A',
    lines: fromBuilt(built.lines, 0).map((l) => ({ ...l, discountType: l.discountType, discountValue: l.discountValue })),
    ...over,
  };
}

const names = new Map([
  ['cgA', 'Caregiver A'],
  ['cgB', 'Caregiver B'],
]);

describe('planAmendment', () => {
  const b = booking();
  const s1 = shift('s1', '2026-10-12');
  const s2 = shift('s2', '2026-10-13');

  it('carries a longer shift on a paid invoice as a client adjustment, and refreshes a draft statement', () => {
    const longer = { ...s1, endsAt: colomboToUtc('2026-10-12', '19:00') }; // 8h -> 11h
    const plan = planAmendment({
      before: { booking: b, shifts: [s1, s2] },
      after: { booking: b, shifts: [longer, s2] },
      touched: new Set(['s1']),
      documents: [doc('INVOICE', b, [s1, s2], { status: 'PAID', amountPaid: '8000.00' }), doc('PAYOUT', b, [s1, s2])],
      caregiverNames: names,
      clientName: 'Client',
    });
    const inv = plan.documents.find((d) => d.kind === 'INVOICE')!;
    expect(inv).toMatchObject({ action: 'CARRY', choices: ['CARRY'], before: '4000.00', after: '5500.00', difference: '1500.00' });
    const pay = plan.documents.find((d) => d.kind === 'PAYOUT')!;
    expect(pay).toMatchObject({ action: 'REFRESH', difference: '900.00' });
    expect(pay.rebuilt.get(pay.lines[0].lineId)).toMatchObject({ quantity: '11.00', amount: '3300.00' });
    expect(plan.adjustments).toEqual([
      expect.objectContaining({ side: 'CLIENT', patientId: 'p1', amount: '1500.00', sourceLabel: 'INV-0001', description: 'BK-TEST01 · 12 Oct' }),
    ]);
    expect(plan.unbilled).toEqual({ client: [], pay: [] });
  });

  it('replaces an issued invoice with nothing paid by default, or carries it when staff choose to', () => {
    const missed = { ...s1, status: 'MISSED' as const };
    const input = {
      before: { booking: b, shifts: [s1, s2] },
      after: { booking: b, shifts: [missed, s2] },
      touched: new Set(['s1']),
      documents: [doc('INVOICE', b, [s1, s2], { status: 'ISSUED' })],
      caregiverNames: names,
      clientName: 'Client',
    };
    const replaced = planAmendment(input);
    expect(replaced.documents[0]).toMatchObject({ action: 'REPLACE', choices: ['REPLACE', 'CARRY'], difference: '-4000.00' });
    expect(replaced.documents[0].lines[0].after).toBeNull();
    expect(replaced.adjustments).toEqual([]);

    const carried = planAmendment({ ...input, invoiceChoices: { 'INVOICE-1': 'CARRY' } });
    expect(carried.documents[0].action).toBe('CARRY');
    expect(carried.adjustments[0]).toMatchObject({ side: 'CLIENT', amount: '-4000.00' });
    expect(carried.warnings.some((w) => w.includes('owed back'))).toBe(true);
  });

  it('removes a missed shift from a draft invoice', () => {
    const plan = planAmendment({
      before: { booking: b, shifts: [s1, s2] },
      after: { booking: b, shifts: [{ ...s1, status: 'MISSED' }, s2] },
      touched: new Set(['s1']),
      documents: [doc('INVOICE', b, [s1, s2])],
      caregiverNames: names,
      clientName: 'Client',
    });
    expect(plan.documents[0]).toMatchObject({ action: 'REFRESH', difference: '-4000.00' });
    expect([...plan.documents[0].rebuilt.values()]).toEqual([null]);
  });

  it('names only the shifts whose money changed in a carried difference', () => {
    const plan = planAmendment({
      before: { booking: b, shifts: [s1, s2] },
      after: { booking: b, shifts: [{ ...s1, status: 'MISSED' }, { ...s2, caregiverId: 'cgB' }] },
      touched: new Set(['s1', 's2']),
      documents: [doc('INVOICE', b, [s1, s2], { status: 'PAID', amountPaid: '8000.00' })],
      caregiverNames: names,
      clientName: 'Client',
    });
    expect(plan.documents[0].lines.map((l) => l.serviceDate)).toEqual(['2026-10-12']);
    expect(plan.adjustments[0]).toMatchObject({ amount: '-4000.00', description: 'BK-TEST01 · 12 Oct' });
  });

  it('pays the real caregiver directly when the shift was on a paid statement for someone else', () => {
    const plan = planAmendment({
      before: { booking: b, shifts: [s1, s2] },
      after: { booking: b, shifts: [{ ...s1, caregiverId: 'cgB' }, s2] },
      touched: new Set(['s1']),
      documents: [doc('PAYOUT', b, [s1, s2], { status: 'PAID' })],
      caregiverNames: names,
      clientName: 'Client',
    });
    expect(plan.documents[0]).toMatchObject({ action: 'CARRY', difference: '-2400.00' });
    expect(plan.adjustments).toEqual([
      expect.objectContaining({ side: 'CAREGIVER', caregiverId: 'cgA', amount: '-2400.00' }),
      expect.objectContaining({ side: 'CAREGIVER', caregiverId: 'cgB', amount: '2400.00', partyName: 'Caregiver B' }),
    ]);
    // Paid to B by the adjustment, so not "unpaid" as well.
    expect(plan.unbilled.pay).toEqual([]);
  });

  it('reopens an approved statement and leaves the moved shift for the new caregiver to be paid', () => {
    const plan = planAmendment({
      before: { booking: b, shifts: [s1, s2] },
      after: { booking: b, shifts: [{ ...s1, caregiverId: 'cgB' }, s2] },
      touched: new Set(['s1']),
      documents: [doc('PAYOUT', b, [s1, s2], { status: 'APPROVED' })],
      caregiverNames: names,
      clientName: 'Client',
    });
    expect(plan.documents[0]).toMatchObject({ action: 'REOPEN', difference: '-2400.00' });
    expect(plan.adjustments).toEqual([]);
    expect(plan.unbilled.pay).toEqual(['2026-10-12 08:00 · Caregiver B']);
  });

  it('re-prices every line on the booking when the agreed rate was wrong', () => {
    const daily = booking({ rateType: 'DAILY', rateAmount: '3000.00' });
    const plan = planAmendment({
      before: { booking: daily, shifts: [s1, s2] },
      after: { booking: { ...daily, rateAmount: '3500.00' }, shifts: [s1, s2] },
      touched: new Set(),
      documents: [doc('INVOICE', daily, [s1, s2], { status: 'PAID', amountPaid: '6000.00', taxed: true })],
      caregiverNames: names,
      clientName: 'Client',
    });
    expect(plan.documents[0]).toMatchObject({ action: 'CARRY', before: '6000.00', after: '7000.00', difference: '1000.00' });
    expect(plan.adjustments[0]).toMatchObject({ amount: '1000.00', description: 'BK-TEST01 · 12 Oct, 13 Oct' });
    expect(plan.warnings.some((w) => w.includes('before that discount and tax'))).toBe(true);
  });

  it('leaves a document the client has seen alone when only the wording would change', () => {
    const daily = booking({ rateType: 'DAILY', rateAmount: '3000.00' });
    const plan = planAmendment({
      before: { booking: daily, shifts: [s1] },
      after: { booking: daily, shifts: [{ ...s1, endsAt: colomboToUtc('2026-10-12', '18:00') }] },
      touched: new Set(['s1']),
      documents: [doc('INVOICE', daily, [s1], { status: 'ISSUED' })],
      caregiverNames: names,
      clientName: 'Client',
    });
    expect(plan.documents).toEqual([]);
    expect(plan.adjustments).toEqual([]);
  });

  it('keeps a line discount when the line is rebuilt', () => {
    const d = doc('INVOICE', b, [s1]);
    d.lines[0] = { ...d.lines[0], discountType: 'PERCENT', discountValue: '10.00', amount: '3600.00' };
    const plan = planAmendment({
      before: { booking: b, shifts: [s1] },
      after: { booking: b, shifts: [{ ...s1, endsAt: colomboToUtc('2026-10-12', '18:00') }] },
      touched: new Set(['s1']),
      documents: [d],
      caregiverNames: names,
      clientName: 'Client',
    });
    expect(plan.documents[0].rebuilt.get(d.lines[0].id)).toMatchObject({ quantity: '10.00', amount: '4500.00' });
    expect(plan.documents[0].difference).toBe('900.00');
  });

  it('does not touch a monthly line for a change of times', () => {
    const monthly = booking({ rateType: 'MONTHLY', rateAmount: '90000.00', payRateType: 'MONTHLY', payRateAmount: '60000.00' });
    const plan = planAmendment({
      before: { booking: monthly, shifts: [s1, s2] },
      after: { booking: monthly, shifts: [{ ...s1, endsAt: colomboToUtc('2026-10-12', '20:00') }, s2] },
      touched: new Set(['s1']),
      documents: [doc('INVOICE', monthly, [s1, s2], { status: 'PAID', amountPaid: '90000.00' })],
      caregiverNames: names,
      clientName: 'Client',
    });
    expect(plan.documents).toEqual([]);
  });

  it('lists a forgotten shift as not yet billed or paid', () => {
    const added = shift('new', '2026-10-14');
    const plan = planAmendment({
      before: { booking: b, shifts: [s1] },
      after: { booking: b, shifts: [s1, added] },
      touched: new Set(['new']),
      documents: [doc('INVOICE', b, [s1], { status: 'PAID', amountPaid: '4000.00' })],
      caregiverNames: names,
      clientName: 'Client',
    });
    expect(plan.documents).toEqual([]);
    expect(plan.unbilled).toEqual({ client: ['2026-10-14 08:00'], pay: ['2026-10-14 08:00 · Caregiver A'] });
  });
});

describe('describeChanges', () => {
  it('says what changed on each shift and on the booking', () => {
    const b = booking();
    const s1 = shift('s1', '2026-10-12');
    const out = describeChanges(
      { booking: b, shifts: [s1] },
      { booking: { ...b, rateAmount: '550.00' }, shifts: [{ ...s1, endsAt: colomboToUtc('2026-10-12', '19:00'), caregiverId: 'cgB', status: 'COMPLETED' }] },
      new Set(['s1']),
      names,
    );
    expect(out[0]).toEqual({ shiftId: null, date: '', changes: ['client rate LKR 500.00 per hour → LKR 550.00 per hour'] });
    expect(out[1]).toEqual({ shiftId: 's1', date: '2026-10-12', changes: ['times 08:00–16:00 → 08:00–19:00 (11 h)', 'worked by Caregiver B (was Caregiver A)'] });
  });
});
