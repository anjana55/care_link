import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CERTIFICATE_CODE_PATTERN, EMERGENCY_NUMBERS, canonicalOfferTerms, departureItemValues, interviewIcs, type OfferTerms } from '@care-platform/shared';
import type { Database } from '../database/database.module';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { CAREGIVER_SCOPE_KEY } from '../common/decorators/caregiver-scope.decorator';
import { TrainingService, checkCompletion, firstNameOf } from './training.service';
import { AssessmentsService, checkDates } from './assessments.service';
import { candidateAfterInterviews, checkWhen, describeWhen } from './interviews.service';
import { OffersService, checkOfferDates, checkSignature, isExpired, termsHash } from './offers.service';
import { checklistOf } from './journey.service';
import { WelfareService, checkReport } from './welfare.service';
import { MoneyTotals, colomboMonth, dayBoundsUtc, median, monthsBetween, resolveRange } from './reports.service';
import { randomCode } from './codes';
import { CaregiverPhase4Controller, EmployerPhase4Controller, PublicCertificatesController, StaffPhase4Controller } from './phase4.controllers';
import { addDays, todayColombo } from './dates';

/**
 * Phase 4 of the international paths: test results and certificates of
 * completion, interviews and job offers, departure and welfare, and reports.
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
  toAllStaff: jest.fn().mockResolvedValue(undefined),
  toAddress: jest.fn().mockResolvedValue(undefined),
  staffUrl: (p: string) => `https://staff.example${p}`,
  publicUrl: (p: string) => `https://site.example${p}`,
});

const TERMS: OfferTerms = {
  jobTitle: 'Senior carer',
  country: 'JP',
  city: 'Osaka',
  startDate: null,
  contractMonths: 24,
  hoursPerWeek: 40,
  salaryAmount: 2500,
  salaryCurrency: 'USD',
  salaryPeriod: 'MONTH',
  accommodation: 'PROVIDED_FREE',
  mealsProvided: true,
  flightsPaidBy: 'EMPLOYER',
  annualLeaveDays: 14,
  probationMonths: 3,
  otherTerms: null,
};

const offerRow = (over: Record<string, unknown> = {}) => ({
  id: 'of-1',
  reference: 'OF-7K2Q9M',
  candidateId: 'cand-1',
  enquiryId: 'enq-1',
  employerId: 'emp-1',
  caregiverId: 'cg-1',
  status: 'SENT',
  ...TERMS,
  expiresOn: addDays(todayColombo(), 7),
  termsHash: termsHash(TERMS),
  employerSignatureName: 'Aiko Tanaka',
  employerSignedAt: new Date(),
  caregiverSignatureName: null,
  caregiverSignedAt: null,
  reviewNote: null,
  declineReason: null,
  sentAt: new Date(),
  respondedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const ENQUIRY = { id: 'enq-1', reference: 'EQ-1', organisationName: 'Sakura Care', email: 'hr@sakura.example', country: 'JP', employerId: 'emp-1' };

// --- certificates ---------------------------------------------------------------------------

describe('certificates of completion', () => {
  it('needs a score at or above the pass mark when the programme has one', () => {
    expect(() => checkCompletion(null, null)).not.toThrow();
    expect(() => checkCompletion(70, null)).toThrow(/final score/);
    expect(() => checkCompletion(70, 69)).toThrow(/below/);
    expect(() => checkCompletion(70, 70)).not.toThrow();
  });

  it('refuses completion below the pass mark before writing anything', async () => {
    const fake = fakeDb([[{ e: { id: 'e1', programmeId: 'p1', status: 'ENROLLED', score: null, completedAt: null }, passMark: 70 }]]);
    const service = new TrainingService(fake.db);
    await expect(service.updateEnrolment('e1', { status: 'COMPLETED', score: 60 })).rejects.toThrow(BadRequestException);
    expect(fake.writes).toHaveLength(0);
  });

  it('shows only a first name on the public check, and codes have no look-alike characters', () => {
    expect(firstNameOf('  Nimali   Perera ')).toBe('Nimali');
    for (let i = 0; i < 50; i++) expect(randomCode(12)).toMatch(CERTIFICATE_CODE_PATTERN);
  });
});

// --- assessments --------------------------------------------------------------------------------

describe('test results', () => {
  it('refuses a future test date or a result that runs out before it was taken', () => {
    const today = '2026-10-27';
    expect(() => checkDates({ takenOn: '2026-11-01' }, today)).toThrow(/future/);
    expect(() => checkDates({ takenOn: '2026-01-01', validUntil: '2025-12-01' }, today)).toThrow(/run out/);
    expect(() => checkDates({ takenOn: '2026-01-01', validUntil: '2028-01-01' }, today)).not.toThrow();
  });

  it("does not let a caregiver claim one of the platform's own assessments", async () => {
    const fake = fakeDb([[{ n: 0 }]]);
    const service = new AssessmentsService(fake.db);
    await expect(
      service.addByCaregiver('cg-1', { kind: 'ENGLISH', provider: 'PLATFORM', title: 'Our English test', takenOn: '2026-01-10' }),
    ).rejects.toThrow(/recorded by our team/);
    expect(fake.writes).toHaveLength(0);
  });
});

// --- interviews -------------------------------------------------------------------------------------

describe('interviews', () => {
  const at = (iso: string) => new Date(iso);

  it('books only from a few minutes ago to a year ahead', () => {
    const now = Date.parse('2026-10-27T05:00:00Z');
    expect(() => checkWhen(at('2026-10-27T04:00:00Z'), now)).toThrow(/past/);
    expect(() => checkWhen(at('2026-10-27T04:58:00Z'), now)).not.toThrow();
    expect(() => checkWhen(at('2027-12-01T00:00:00Z'), now)).toThrow(/year/);
    expect(() => checkWhen(new Date('nonsense'), now)).toThrow(/valid/);
  });

  it('tells email readers the Sri Lanka time and UTC', () => {
    expect(describeWhen(at('2026-11-04T04:30:00Z'))).toBe('Wed, 4 Nov 2026, 10:00 Sri Lanka time (04:30 UTC)');
  });

  it('moves the candidate to scheduled, and back to the request when every interview is called off', () => {
    const now = Date.parse('2026-10-27T00:00:00Z');
    const next = at('2026-11-01T04:00:00Z');
    expect(candidateAfterInterviews('INTERVIEW_REQUESTED', [{ status: 'SCHEDULED', scheduledAt: next }], now)).toEqual({ status: 'INTERVIEW_SCHEDULED', interviewAt: next });
    expect(candidateAfterInterviews('INTERVIEW_SCHEDULED', [{ status: 'CANCELLED', scheduledAt: next }], now)).toEqual({ status: 'INTERVIEW_REQUESTED', interviewAt: null });
    // One already held: they stay interviewed.
    expect(
      candidateAfterInterviews('INTERVIEW_SCHEDULED', [{ status: 'COMPLETED', scheduledAt: at('2026-10-20T04:00:00Z') }, { status: 'CANCELLED', scheduledAt: next }], now).status,
    ).toBe('INTERVIEW_SCHEDULED');
    // A hire decision is never undone by the calendar.
    expect(candidateAfterInterviews('SELECTED', [{ status: 'SCHEDULED', scheduledAt: next }], now).status).toBe('SELECTED');
  });

  it('builds a calendar file in UTC with its text escaped', () => {
    const ics = interviewIcs(
      { id: 'iv-1', scheduledAt: '2026-11-04T04:30:00.000Z', durationMinutes: 45, mode: 'VIDEO', meetingLink: 'https://meet.example/abc', location: null, instructions: 'Bring your passport; arrive early, please' },
      'Interview, round 1',
      new Date('2026-10-27T00:00:00Z'),
    );
    expect(ics).toContain('DTSTART:20261104T043000Z');
    expect(ics).toContain('DTEND:20261104T051500Z');
    expect(ics).toContain('SUMMARY:Interview\\, round 1');
    expect(ics).toContain('Bring your passport\\; arrive early\\, please');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});

// --- offers ----------------------------------------------------------------------------------------------

describe('job offers', () => {
  it('fingerprints every term, so a signature never carries over to changed terms', () => {
    const h = termsHash(TERMS);
    expect(termsHash({ ...TERMS })).toBe(h);
    for (const [key, value] of Object.entries({ salaryAmount: 2400, hoursPerWeek: 48, accommodation: 'NOT_PROVIDED', otherTerms: 'x', city: null })) {
      expect(termsHash({ ...TERMS, [key]: value } as OfferTerms)).not.toBe(h);
    }
    // The order fields arrive in does not matter.
    const shuffled = Object.fromEntries(Object.entries(TERMS).reverse()) as unknown as OfferTerms;
    expect(canonicalOfferTerms(shuffled)).toBe(canonicalOfferTerms(TERMS));
  });

  it('takes a typed name as a signature, not a tick or a number', () => {
    expect(checkSignature('  Nimali   Perera ')).toBe('Nimali Perera');
    expect(checkSignature('නිමාලි පෙරේරා')).toBe('නිමාලි පෙරේරා');
    expect(() => checkSignature('x')).toThrow(/full name/);
    expect(() => checkSignature('12345')).toThrow(/full name/);
    expect(() => checkSignature(undefined)).toThrow(/full name/);
  });

  it('checks the dates an offer gives', () => {
    const today = '2026-10-27';
    expect(() => checkOfferDates({ startDate: '2026-10-01' }, today)).toThrow(/start date/);
    expect(() => checkOfferDates({ expiresOn: '2026-10-26' }, today)).toThrow(/answer-by/);
    expect(() => checkOfferDates({ startDate: '2026-12-01', expiresOn: '2026-12-15' }, today)).toThrow(/before the start/);
    expect(() => checkOfferDates({ startDate: '2027-01-01', expiresOn: '2026-11-10' }, today)).not.toThrow();
    expect(isExpired({ status: 'SENT', expiresOn: '2026-10-26' }, today)).toBe(true);
    expect(isExpired({ status: 'ACCEPTED', expiresOn: '2026-10-26' }, today)).toBe(false);
  });

  function offers(results: unknown[]) {
    const fake = fakeDb(results);
    const n = notifier();
    const service = new OffersService(fake.db, { assertVerified: jest.fn() } as never, { liveSlugs: jest.fn().mockResolvedValue(new Map([['cg-1', 's']])) } as never, n as never);
    return { service, n, ...fake };
  }

  it('lets only the caregiver themself sign - never staff acting for them', async () => {
    const { service, writes } = offers([]);
    await expect(service.respond('cg-1', 'of-1', { action: 'ACCEPT', signatureName: 'Nimali Perera' }, { role: 'STAFF', ip: null })).rejects.toThrow(ForbiddenException);
    expect(writes).toHaveLength(0);
  });

  it('refuses an offer past its answer-by date', async () => {
    const { service } = offers([[offerRow({ expiresOn: addDays(todayColombo(), -1) })]]);
    await expect(service.respond('cg-1', 'of-1', { action: 'ACCEPT', signatureName: 'Nimali Perera' }, { role: 'CAREGIVER', ip: '1.2.3.4' })).rejects.toThrow(/answer-by/);
  });

  it('refuses to accept terms that no longer match what the employer signed', async () => {
    const { service, writes } = offers([[offerRow({ salaryAmount: 1900 })], [{ c: { id: 'cand-1', status: 'SELECTED' }, e: ENQUIRY }]]);
    await expect(service.respond('cg-1', 'of-1', { action: 'ACCEPT', signatureName: 'Nimali Perera' }, { role: 'CAREGIVER', ip: null })).rejects.toThrow(/changed/);
    expect(writes).toHaveLength(0);
  });

  it('records the signature, the time and where it came from when the caregiver accepts', async () => {
    const { service, writes, n } = offers([[offerRow()], [{ c: { id: 'cand-1', status: 'INTERVIEW_SCHEDULED' }, e: ENQUIRY }], []]);
    await service.respond('cg-1', 'of-1', { action: 'ACCEPT', signatureName: 'Nimali  Perera' }, { role: 'CAREGIVER', ip: '203.0.113.9' });
    expect(writes[0].values).toMatchObject({ status: 'ACCEPTED', caregiverSignatureName: 'Nimali Perera', caregiverSignedIp: '203.0.113.9', caregiverSignedAt: expect.any(Date) });
    expect(writes[1].values).toMatchObject({ status: 'SELECTED' });
    await new Promise((r) => setImmediate(r));
    expect(n.toStaff).toHaveBeenCalled();
    expect(n.toAddress).toHaveBeenCalledWith(ENQUIRY.email, expect.any(String), expect.objectContaining({ subject: expect.stringMatching(/accepted/) }));
  });

  it('needs a note to send an offer back to the employer', async () => {
    const { service, writes } = offers([[offerRow({ status: 'PENDING_REVIEW' })], [{ c: { id: 'cand-1', status: 'SELECTED' }, e: ENQUIRY }]]);
    await expect(service.review('of-1', { action: 'RETURN' }, 'staff-1')).rejects.toThrow(/what to change/);
    expect(writes).toHaveLength(0);
  });
});

// --- departure and welfare ------------------------------------------------------------------------------------

describe('departure and welfare', () => {
  it('always lists every checklist step, in order', () => {
    const list = checklistOf([{ item: 'VISA_GRANTED', doneOn: '2026-10-01', dueOn: null, note: 'Collect from the embassy' }]);
    expect(list.map((i) => i.item)).toEqual([...departureItemValues]);
    expect(list.find((i) => i.item === 'VISA_GRANTED')).toMatchObject({ done: true, note: 'Collect from the embassy' });
    expect(list.find((i) => i.item === 'MEDICAL')).toMatchObject({ done: false, doneOn: null });
  });

  it('accepts an SOS with no words, and asks for a sentence otherwise', () => {
    expect(checkReport({ severity: 'SOS', category: 'SAFETY' })).toMatch(/SOS/);
    expect(() => checkReport({ severity: 'CONCERN', category: 'PAY', message: 'no' })).toThrow(/sentence/);
    expect(checkReport({ severity: 'CONCERN', category: 'PAY', message: '  My salary is late again  ' })).toBe('My salary is late again');
  });

  it('never rate-limits an SOS, and raises it with every staff member', async () => {
    const placement = { id: 'pl-1', caregiverId: 'cg-1', status: 'DEPLOYED', country: 'AE' };
    const fake = fakeDb([[placement], [{ n: 99 }], []]);
    const n = notifier();
    const service = new WelfareService(fake.db, n as never);
    const alert = jest.spyOn(service as never as { alertStaff: () => Promise<void> }, 'alertStaff').mockResolvedValue(undefined);
    await service.create('cg-1', 'pl-1', { severity: 'SOS', category: 'SAFETY' }, 'user-1');
    expect(fake.writes.map((w) => w.values)).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'SOS', placementId: 'pl-1' }), expect.objectContaining({ authorRole: 'CAREGIVER' })]),
    );
    expect(alert).toHaveBeenCalled();

    // The alert itself goes to everyone, with the local emergency numbers.
    alert.mockRestore();
    jest.spyOn(service, 'staffGet').mockResolvedValue({
      id: 'wr-1',
      reference: 'WR-ABC234',
      severity: 'SOS',
      category: 'SAFETY',
      status: 'OPEN',
      country: 'AE',
      fullName: 'Nimali Perera',
      registrationNumber: 'CG-1',
      organisationName: 'Gulf Care',
      contact: { phoneAbroad: '+971 50 000 0000', addressAbroad: 'Dubai', emergencyContactName: 'Sunil', emergencyContactNumber: '077', emergencyContactRelationship: 'Brother' },
      messages: [{ id: 'm', from: 'CAREGIVER', body: 'SOS', createdAt: '' }],
    } as never);
    await (service as never as { alertStaff: (id: string, w: string) => Promise<void> }).alertStaff('wr-1', 'new');
    expect(n.toAllStaff).toHaveBeenCalledWith(
      expect.stringContaining('SOS'),
      expect.objectContaining({ paragraphs: expect.arrayContaining([expect.stringContaining(`police ${EMERGENCY_NUMBERS.AE!.police}`)]) }),
    );
    expect(n.toStaff).not.toHaveBeenCalled();
  });

  it('stops a flood of everyday reports', async () => {
    const fake = fakeDb([[{ id: 'pl-1', caregiverId: 'cg-1', status: 'DEPLOYED' }], [{ n: 10 }]]);
    const service = new WelfareService(fake.db, notifier() as never);
    await expect(service.create('cg-1', 'pl-1', { severity: 'QUESTION', category: 'OTHER', message: 'When is my next check-in?' }, 'u')).rejects.toThrow(/several reports/);
  });
});

// --- reports ------------------------------------------------------------------------------------------------------

describe('reports', () => {
  it('defaults to the last 12 months and refuses backwards or huge ranges', () => {
    expect(resolveRange({}, '2026-10-27')).toEqual({ from: '2025-10-28', to: '2026-10-27' });
    expect(() => resolveRange({ from: '2026-10-01', to: '2026-09-01' })).toThrow(/after its end/);
    expect(() => resolveRange({ from: '2015-01-01', to: '2026-01-01' })).toThrow(/five years/);
  });

  it('counts by the Colombo calendar', () => {
    const { start, end } = dayBoundsUtc('2026-10-01', '2026-10-31');
    expect(start.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    // 20:00 UTC on 31 Oct is already 1 Nov in Colombo.
    expect(colomboMonth(new Date('2026-10-31T20:00:00Z'))).toBe('2026-11');
    expect(monthsBetween('2026-11-15', '2027-02-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('adds money in cents and takes the median of time to place', () => {
    const t = new MoneyTotals().add('USD', '0.10').add('USD', 0.2).add('GBP', '100.00').add('EUR', '5').add('EUR', '-5');
    expect(t.list()).toEqual([
      { currency: 'GBP', amount: '100.00' },
      { currency: 'USD', amount: '0.30' },
    ]);
    expect(median([])).toBeNull();
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 20, 30, 41])).toBe(25);
  });
});

// --- who can reach what --------------------------------------------------------------------------------------------

describe('phase 4 access', () => {
  const reflector = new Reflector();
  const roles = (cls: object) => reflector.get<string[]>(ROLES_KEY, cls as never);
  const isPublic = (cls: { prototype: object }, method: string) => reflector.get<boolean>(IS_PUBLIC_KEY, (cls.prototype as Record<string, () => void>)[method]);

  it('keeps staff routes for staff and employer routes for employers', () => {
    expect(roles(StaffPhase4Controller)).toEqual(['ADMIN', 'STAFF']);
    expect(roles(EmployerPhase4Controller)).toEqual(['EMPLOYER']);
  });

  it('opens only the certificate check to the public', () => {
    expect(isPublic(PublicCertificatesController, 'check')).toBe(true);
    for (const m of ['offerList', 'respond', 'report', 'welfareList']) {
      for (const cls of [CaregiverPhase4Controller, StaffPhase4Controller, EmployerPhase4Controller]) {
        if ((cls.prototype as unknown as Record<string, unknown>)[m]) expect(isPublic(cls, m)).toBeFalsy();
      }
    }
  });

  it("scopes every caregiver route to the caregiver's own record", () => {
    for (const m of Object.getOwnPropertyNames(CaregiverPhase4Controller.prototype).filter((n) => n !== 'constructor')) {
      expect(reflector.get(CAREGIVER_SCOPE_KEY, (CaregiverPhase4Controller.prototype as unknown as Record<string, () => void>)[m])).toBeDefined();
    }
  });
});
