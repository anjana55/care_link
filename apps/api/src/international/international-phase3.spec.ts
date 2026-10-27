import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { expiryState } from '@care-platform/shared';
import type { Database } from '../database/database.module';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { VacanciesService, checkSalary, isVacancyOpen } from './vacancies.service';
import { checkPlacementChange, checkinSchedule, contractEndsOn, guaranteeEndsOn } from './placements.service';
import { PlacementInvoicesService, afterPayment, isOverdue, placementInvoiceNumber, placementNotifyUrl } from './placement-invoices.service';
import { reminderStage } from './document-expiry.service';
import { CandidatesService } from './candidates.service';
import { EmployerPhase3Controller, PlacementPayhereNotifyController, PublicVacanciesController, StaffOverseasPhase3Controller } from './phase3.controllers';
import { addDays } from './dates';

/**
 * Phase 3 of the international paths: the vacancy board, placements and
 * their check-ins, placement-fee invoices and document expiry reminders.
 * Same recorded stand-in database as the earlier phases' specs.
 */
function fakeDb(results: unknown[]) {
  const writes: { op: string; values: Record<string, unknown> }[] = [];
  const queue = [...results];
  const chain = (op: string | null): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          const value = op ? undefined : queue.shift();
          return (resolve: (v: unknown) => void) => resolve(value);
        }
        if (prop === 'values' || prop === 'set') {
          return (values: Record<string, unknown>) => {
            writes.push({ op: op ?? String(prop), values });
            return chain(op);
          };
        }
        if (prop === 'insert' || prop === 'update' || prop === 'delete') return () => chain(String(prop));
        return () => chain(op);
      },
    });
  return { db: chain(null) as Database, writes, queue };
}

const notifier = () => ({
  toStaff: jest.fn().mockResolvedValue(undefined),
  toAddress: jest.fn().mockResolvedValue(undefined),
  staffUrl: (p: string) => `https://staff.example${p}`,
  publicUrl: (p: string) => `https://site.example${p}`,
});

const VACANCY = {
  id: 'vac-1',
  reference: 'VC-7K2Q9M',
  enquiryId: 'enq-1',
  employerId: 'emp-1',
  title: 'Care assistant, nursing home',
  country: 'JP',
  status: 'PUBLISHED' as string,
  closesOn: null as string | null,
  publishedAt: new Date(),
};

// --- pure rules -------------------------------------------------------------------

describe('vacancy rules', () => {
  it('is open only while published and not past its closing day', () => {
    expect(isVacancyOpen({ status: 'PUBLISHED', closesOn: null }, '2026-10-26')).toBe(true);
    expect(isVacancyOpen({ status: 'PUBLISHED', closesOn: '2026-10-26' }, '2026-10-26')).toBe(true);
    expect(isVacancyOpen({ status: 'PUBLISHED', closesOn: '2026-10-25' }, '2026-10-26')).toBe(false);
    expect(isVacancyOpen({ status: 'PENDING_REVIEW', closesOn: null }, '2026-10-26')).toBe(false);
    expect(isVacancyOpen({ status: 'FILLED', closesOn: null }, '2026-10-26')).toBe(false);
  });

  it('needs a sensible salary range with its currency and period', () => {
    expect(() => checkSalary({})).not.toThrow();
    expect(() => checkSalary({ salaryMin: 1800, salaryMax: 2200, salaryCurrency: 'USD', salaryPeriod: 'MONTH' })).not.toThrow();
    expect(() => checkSalary({ salaryMin: 2200, salaryMax: 1800, salaryCurrency: 'USD', salaryPeriod: 'MONTH' })).toThrow(/below the lowest/);
    expect(() => checkSalary({ salaryMin: 1800 })).toThrow(/currency/);
  });
});

describe('placement rules', () => {
  const base = {
    id: 'pl-1',
    status: 'PRE_DEPARTURE',
    departureOn: null,
    arrivedOn: null,
    contractStartOn: null,
    contractMonths: null,
    endedOn: null,
    endReason: null,
    guaranteeMonths: 3,
  } as never as Parameters<typeof checkPlacementChange>[0];

  it('schedules welfare check-ins from the arrival date', () => {
    expect(checkinSchedule('2026-11-01')).toEqual([
      { kind: 'ARRIVAL', dueOn: '2026-11-04' },
      { kind: 'DAY_30', dueOn: '2026-12-01' },
      { kind: 'DAY_90', dueOn: '2027-01-30' },
      { kind: 'DAY_180', dueOn: '2027-04-30' },
    ]);
  });

  it('works out the contract end and the replacement guarantee', () => {
    expect(contractEndsOn({ contractStartOn: '2026-11-15', contractMonths: 24 })).toBe('2028-11-15');
    expect(contractEndsOn({ contractStartOn: null, contractMonths: 24 })).toBeNull();
    expect(guaranteeEndsOn({ contractStartOn: null, arrivedOn: '2026-11-30', guaranteeMonths: 3 })).toBe('2027-02-28');
    expect(guaranteeEndsOn({ contractStartOn: '2026-12-01', arrivedOn: '2026-11-30', guaranteeMonths: 0 })).toBeNull();
  });

  it('refuses a deployed placement without an arrival date, and an early end without a reason', () => {
    expect(() => checkPlacementChange(base, { ...base, status: 'DEPLOYED' })).toThrow(/arrival date/);
    expect(() => checkPlacementChange(base, { ...base, status: 'ENDED_EARLY' })).toThrow(/why/);
    expect(() => checkPlacementChange(base, { ...base, departureOn: '2026-11-02', arrivedOn: '2026-11-01' })).toThrow(/before departure/);
  });

  it('fills the end date in, and clears it when a placement is reopened', () => {
    expect(checkPlacementChange(base, { ...base, status: 'ENDED_EARLY', endReason: 'Family emergency' }, '2027-01-10')).toEqual({ endedOn: '2027-01-10' });
    expect(checkPlacementChange(base, { ...base, status: 'COMPLETED', contractStartOn: '2025-01-01', contractMonths: 24 }, '2027-01-10')).toEqual({ endedOn: '2027-01-01' });
    const ended = { ...base, status: 'ENDED_EARLY', endedOn: '2027-01-10', endReason: 'x' } as typeof base;
    expect(checkPlacementChange(ended, { ...ended, status: 'DEPLOYED', arrivedOn: '2026-11-01' })).toEqual({ endedOn: null, endReason: null });
  });
});

describe('placement invoice rules', () => {
  it('numbers invoices per year without gaps', () => {
    expect(placementInvoiceNumber(2026, 7)).toBe('PF-2026-0007');
    expect(placementInvoiceNumber(2027, 12345)).toBe('PF-2027-12345');
  });

  it('settles on full payment and reopens on a refund, never refunding more than was paid', () => {
    const inv = { amount: '2500.00', amountPaid: '0.00', status: 'ISSUED' as const };
    expect(afterPayment(inv, '1000.00')).toEqual({ amountPaid: '1000.00', status: 'ISSUED' });
    expect(afterPayment({ ...inv, amountPaid: '1000.00' }, '1500.00')).toEqual({ amountPaid: '2500.00', status: 'PAID' });
    expect(afterPayment({ ...inv, amountPaid: '2500.00', status: 'PAID' }, '-500.00')).toEqual({ amountPaid: '2000.00', status: 'ISSUED' });
    expect(() => afterPayment(inv, '-0.01')).toThrow(/refund/);
    expect(() => afterPayment({ ...inv, status: 'DRAFT' as never }, '10.00')).toThrow(/issued invoice/);
  });

  it('is overdue only when issued, unpaid and past due', () => {
    expect(isOverdue({ status: 'ISSUED', dueDate: '2026-10-25' }, '2026-10-26')).toBe(true);
    expect(isOverdue({ status: 'ISSUED', dueDate: '2026-10-26' }, '2026-10-26')).toBe(false);
    expect(isOverdue({ status: 'PAID', dueDate: '2026-10-01' }, '2026-10-26')).toBe(false);
  });

  it('sends PayHere placement payments to their own notify address', () => {
    expect(placementNotifyUrl('https://find.caregivers.lk/api/payments/payhere/notify')).toBe('https://find.caregivers.lk/api/payments/payhere/placement-notify');
  });
});

describe('document expiry', () => {
  it('reads a date as valid, expiring (within 90 days) or expired', () => {
    expect(expiryState('2027-06-01', '2026-10-26')).toEqual({ daysLeft: 218, state: 'VALID' });
    expect(expiryState(addDays('2026-10-26', 90), '2026-10-26')).toEqual({ daysLeft: 90, state: 'EXPIRING' });
    expect(expiryState('2026-10-25', '2026-10-26')).toEqual({ daysLeft: -1, state: 'EXPIRED' });
  });

  it('reminds at 90 days, at 30 days, and once after - not about long-lapsed documents', () => {
    expect(reminderStage(120)).toBeNull();
    expect(reminderStage(90)).toBe('DAYS_90');
    expect(reminderStage(31)).toBe('DAYS_90');
    expect(reminderStage(30)).toBe('DAYS_30');
    expect(reminderStage(0)).toBe('DAYS_30');
    expect(reminderStage(-1)).toBe('EXPIRED');
    expect(reminderStage(-31)).toBeNull();
  });
});

// --- services ------------------------------------------------------------------------

describe('VacanciesService', () => {
  function vacancies(results: unknown[]) {
    const fake = fakeDb(results);
    const n = notifier();
    const candidates = { propose: jest.fn().mockResolvedValue([{ id: 'cand-1', caregiverId: 'cg-1' }]) };
    const readiness = { forCaregivers: jest.fn().mockResolvedValue(new Map([['cg-1', { items: [], done: 5, total: 7 }]])) };
    const shared = { liveSlugs: jest.fn().mockResolvedValue(new Map([['cg-1', 'abc123def456']])) };
    const service = new VacanciesService(fake.db, {} as never, {} as never, candidates as never, readiness as never, shared as never, n as never);
    return { service, candidates, n, ...fake };
  }

  it('takes an application only for an open vacancy', async () => {
    const { service, writes } = vacancies([[{ ...VACANCY, status: 'CLOSED' }]]);
    await expect(service.apply('cg-1', 'vc-7k2q9m', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(writes).toHaveLength(0);
  });

  it('refuses a second application to the same vacancy', async () => {
    const { service, writes } = vacancies([[VACANCY], [{ id: 'app-1', status: 'APPLIED' }]]);
    await expect(service.apply('cg-1', 'VC-7K2Q9M', {})).rejects.toThrow(/already applied/);
    expect(writes).toHaveLength(0);
  });

  it('caps the applications a caregiver can have waiting', async () => {
    const { service } = vacancies([[VACANCY], [], [{ n: 10 }]]);
    await expect(service.apply('cg-1', 'VC-7K2Q9M', {})).rejects.toThrow(/up to 10/);
  });

  it('records an application and tells staff', async () => {
    const { service, writes, n } = vacancies([[VACANCY], [], [{ n: 2 }], []]);
    await service.apply('cg-1', 'VC-7K2Q9M', { message: 'I have 4 years in elder care' });
    expect(writes).toEqual([{ op: 'insert', values: expect.objectContaining({ vacancyId: 'vac-1', caregiverId: 'cg-1', message: 'I have 4 years in elder care' }) }]);
    expect(n.toStaff).toHaveBeenCalled();
  });

  it('lets a caregiver withdraw only their own application, and only before staff act on it', async () => {
    await expect(vacancies([[{ id: 'app-1', caregiverId: 'someone-else', status: 'APPLIED' }]]).service.withdraw('cg-1', 'app-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(vacancies([[{ id: 'app-1', caregiverId: 'cg-1', status: 'PUT_FORWARD' }]]).service.withdraw('cg-1', 'app-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('puts an applicant forward as a candidate on the vacancy enquiry, without the generic "interest" email', async () => {
    const app = { id: 'app-1', vacancyId: 'vac-1', caregiverId: 'cg-1', status: 'APPLIED' };
    const { service, candidates, writes, n } = vacancies([[app], [VACANCY], [VACANCY], [{ a: { ...app, status: 'PUT_FORWARD', createdAt: new Date() }, registrationNumber: 'CG-1', fullName: 'Nadeesha Perera' }], []]);
    await service.updateApplication('app-1', { status: 'PUT_FORWARD', messageToEmployer: 'Strong dementia care experience' });
    expect(candidates.propose).toHaveBeenCalledWith('enq-1', { caregiverId: 'cg-1', messageToEmployer: 'Strong dementia care experience' }, { source: 'APPLICATION', notifyCaregiver: false });
    expect(writes[0].values).toEqual(expect.objectContaining({ status: 'PUT_FORWARD', candidateId: 'cand-1' }));
    await new Promise((r) => setImmediate(r));
    expect(n.toAddress).toHaveBeenCalledWith(undefined, 'application PUT_FORWARD', expect.anything());
  });

  it('needs a note to send a vacancy back', async () => {
    const { service } = vacancies([[{ ...VACANCY, status: 'PENDING_REVIEW' }]]);
    await expect(service.review('vac-1', { status: 'REJECTED' }, 'staff-1')).rejects.toThrow(/why/);
  });
});

describe('CandidatesService and placements', () => {
  it('opens a placement when staff mark a candidate Placed', async () => {
    const candidate = { id: 'cand-1', enquiryId: 'enq-1', caregiverId: 'cg-1', status: 'SELECTED', interviewAt: null, createdAt: new Date(), updatedAt: new Date() };
    const fake = fakeDb([[candidate], [{ c: { ...candidate, status: 'PLACED' }, registrationNumber: 'CG-1', fullName: 'N P' }]]);
    const placements = { openForCandidate: jest.fn().mockResolvedValue('pl-1') };
    const shared = { liveSlugs: jest.fn().mockResolvedValue(new Map()) };
    const service = new CandidatesService(fake.db, shared as never, {} as never, notifier() as never, placements as never);
    await service.update('cand-1', { status: 'PLACED' }, 'staff-1');
    expect(placements.openForCandidate).toHaveBeenCalledWith('cand-1', 'staff-1');
  });
});

describe('PlacementInvoicesService', () => {
  const settings = { getResolved: jest.fn(), sellerOf: jest.fn() };
  it("never shows an employer a draft, or another employer's invoice", async () => {
    const draft = fakeDb([[{ id: 'inv-1', employerId: 'emp-1', status: 'DRAFT' }]]);
    await expect(new PlacementInvoicesService(draft.db, settings as never, notifier() as never).getForEmployer('emp-1', 'inv-1')).rejects.toBeInstanceOf(NotFoundException);
    const other = fakeDb([[{ id: 'inv-1', employerId: 'emp-2', status: 'ISSUED' }]]);
    await expect(new PlacementInvoicesService(other.db, settings as never, notifier() as never).getForEmployer('emp-1', 'inv-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('changes only drafts', async () => {
    const fake = fakeDb([[{ id: 'inv-1', status: 'ISSUED' }]]);
    await expect(
      new PlacementInvoicesService(fake.db, settings as never, notifier() as never).update('inv-1', { currency: 'USD', amount: 100, description: 'Placement fee' }),
    ).rejects.toThrow(/draft/);
    expect(fake.writes).toHaveLength(0);
  });

  it('ignores a PayHere notification that does not carry our signature', async () => {
    const s = { getResolved: jest.fn().mockResolvedValue({ payhereMerchantId: 'M1', payhereMerchantSecret: 'secret' }) };
    const fake = fakeDb([]);
    const result = await new PlacementInvoicesService(fake.db, s as never, notifier() as never).handleNotification({
      merchant_id: 'M1',
      order_id: 'o-1',
      payhere_amount: '2500.00',
      payhere_currency: 'USD',
      status_code: '2',
      md5sig: 'NOT-THE-SIGNATURE',
    });
    expect(result).toBe('BAD_SIGNATURE');
    expect(fake.writes).toHaveLength(0);
  });
});

// --- who can reach what ------------------------------------------------------------------

describe('phase 3 route access', () => {
  const reflector = new Reflector();
  const roles = (cls: object, method?: string) =>
    reflector.getAllAndOverride<string[]>(ROLES_KEY, [method ? (cls as { prototype: Record<string, () => void> }).prototype[method] : (cls as never), cls as never]);

  it('keeps employer routes for employers and staff routes for staff', () => {
    expect(roles(EmployerPhase3Controller)).toEqual(['EMPLOYER']);
    expect(roles(StaffOverseasPhase3Controller)).toEqual(['ADMIN', 'STAFF']);
    expect(roles(StaffOverseasPhase3Controller, 'runReminders')).toEqual(['ADMIN']);
  });

  it('opens only the vacancy board and the PayHere callback to the public', () => {
    const isPublic = (cls: { prototype: object }, method: string) => reflector.get<boolean>(IS_PUBLIC_KEY, (cls.prototype as Record<string, () => void>)[method]);
    expect(isPublic(PublicVacanciesController, 'list')).toBe(true);
    expect(isPublic(PublicVacanciesController, 'one')).toBe(true);
    expect(isPublic(PlacementPayhereNotifyController, 'notify')).toBe(true);
    for (const m of ['vacancyList', 'invoice', 'payOnline']) expect(isPublic(EmployerPhase3Controller, m)).toBeFalsy();
  });
});
