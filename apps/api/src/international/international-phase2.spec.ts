import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Database } from '../database/database.module';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { canUsePortal } from '../common/auth/login-portal';
import { computeReadiness, addMonths, type ReadinessFacts } from './readiness.service';
import { EmployersService, employerIdOf } from './employers.service';
import { CandidatesService } from './candidates.service';
import { EmployerController } from './employer.controller';

/**
 * Phase 2 of the international paths: employer accounts, candidates on an
 * enquiry, and readiness. The database is a recorded stand-in (see
 * international.spec.ts) - enough to check which rules each service applies
 * and what it writes.
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

const EMPLOYER = {
  id: 'emp-1',
  userId: 'u-emp',
  organisationName: 'Sakura Care',
  organisationType: 'CARE_HOME' as const,
  country: 'JP',
  contactName: 'Aiko Tanaka',
  phone: null,
  website: null,
  companyRegistrationNumber: null,
  status: 'VERIFIED' as string,
  reviewNote: null,
  reviewedByUserId: null,
  reviewedAt: null,
  consentAcceptedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ENQUIRY = {
  id: 'enq-1',
  reference: 'IE-7K2Q9M',
  employerId: 'emp-1',
  organisationName: 'Sakura Care',
  organisationType: 'CARE_HOME',
  country: 'JP',
  email: 'aiko@example.jp',
  status: 'IN_PROGRESS',
  rolesCount: 2,
  careSettings: ['NURSING_HOME'],
  createdAt: new Date(),
};

// --- readiness ------------------------------------------------------------------

describe('readiness', () => {
  const ready: ReadinessFacts = {
    caregiverStatus: 'VERIFIED',
    openToOverseas: true,
    targetCountries: 2,
    passportHeld: true,
    passportExpiry: '2028-06-01',
    availableFrom: '2027-01-01',
    policeClearanceVerified: true,
    englishTrainingCompleted: true,
    englishFluent: false,
    caregivingTrainingCompleted: false,
    verifiedQualification: true,
    sharedProfileLive: true,
  };

  it('counts every item done for a caregiver who is ready', () => {
    const report = computeReadiness(ready, '2026-10-26');
    expect(report).toMatchObject({ done: 7, total: 7 });
  });

  it('wants the passport valid six months after the caregiver could start, not just today', () => {
    // Valid today and at the start date, but not six months past it.
    const short = computeReadiness({ ...ready, passportExpiry: '2027-03-01' }, '2026-10-26');
    expect(short.items.find((i) => i.key === 'passportValid')?.done).toBe(false);
    const enough = computeReadiness({ ...ready, passportExpiry: '2027-07-01' }, '2026-10-26');
    expect(enough.items.find((i) => i.key === 'passportValid')?.done).toBe(true);
  });

  it('measures from today when the start date has passed or is not given', () => {
    const r = computeReadiness({ ...ready, availableFrom: null, passportExpiry: '2027-04-27' }, '2026-10-26');
    expect(r.items.find((i) => i.key === 'passportValid')?.done).toBe(true);
  });

  it('accepts English training or recorded fluency, and caregiving training or a verified qualification', () => {
    const r = computeReadiness({ ...ready, englishTrainingCompleted: false, englishFluent: true, verifiedQualification: false, caregivingTrainingCompleted: true });
    expect(r.items.filter((i) => ['english', 'caregiving'].includes(i.key)).every((i) => i.done)).toBe(true);
  });

  it('is not open to overseas work without at least one country', () => {
    const r = computeReadiness({ ...ready, targetCountries: 0 });
    expect(r.items.find((i) => i.key === 'openToOverseas')?.done).toBe(false);
  });

  it('adds months without running past the end of a short month', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
  });
});

// --- employer accounts -------------------------------------------------------------

describe('employer accounts', () => {
  function employers(results: unknown[]) {
    const fake = fakeDb(results);
    const n = notifier();
    const service = new EmployersService(fake.db, { liveCards: jest.fn().mockResolvedValue(new Map()), liveCaregiverIdForSlug: jest.fn() } as never, n as never);
    return { service, n, ...fake };
  }

  it('signs EMPLOYER logins in only on the employer portal', () => {
    expect(canUsePortal('EMPLOYER', 'employer')).toBe(true);
    for (const portal of ['staff', 'caregiver', 'customer'] as const) expect(canUsePortal('EMPLOYER', portal)).toBe(false);
    expect(canUsePortal('PATIENT_GUARDIAN', 'employer')).toBe(false);
  });

  it('works only on the employer the login owns', () => {
    expect(employerIdOf({ userId: 'u', email: null, role: 'EMPLOYER', employerId: 'emp-1' })).toBe('emp-1');
    expect(() => employerIdOf({ userId: 'u', email: null, role: 'PATIENT_GUARDIAN', patientId: 'p' })).toThrow(ForbiddenException);
  });

  it('keeps every employer route behind the EMPLOYER role', () => {
    expect(new Reflector().get(ROLES_KEY, EmployerController)).toEqual(['EMPLOYER']);
  });

  it('will not let a verified employer rename their organisation themselves', async () => {
    const { service, writes } = employers([[EMPLOYER]]);
    await expect(service.updateMe('emp-1', { organisationName: 'Other Co' })).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toHaveLength(0);
  });

  it('sends a rejected organisation back for review when it corrects its details', async () => {
    const { service, writes } = employers([[{ ...EMPLOYER, status: 'REJECTED' }], [{ e: EMPLOYER, email: 'aiko@example.jp' }]]);
    await service.updateMe('emp-1', { organisationName: 'Sakura Care KK' });
    expect(writes[0].values).toMatchObject({ organisationName: 'Sakura Care KK', status: 'PENDING_REVIEW', reviewNote: null });
  });

  it('only lets a verified employer ask for interviews', async () => {
    const { service } = employers([[{ ...EMPLOYER, status: 'PENDING_REVIEW' }]]);
    await expect(service.assertVerified('emp-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('asks staff to say why when rejecting or suspending', async () => {
    const { service } = employers([[EMPLOYER]]);
    await expect(service.review('emp-1', { decision: 'REJECT' }, 'staff-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('on verification, joins enquiries sent earlier from the same address and tells the employer', async () => {
    const { service, writes, n } = employers([[{ ...EMPLOYER, status: 'PENDING_REVIEW' }], [{ email: 'Aiko@Example.jp' }], []]);
    await service.review('emp-1', { decision: 'VERIFY' }, 'staff-1').catch(() => undefined);
    expect(writes[0].values).toMatchObject({ status: 'VERIFIED', reviewedByUserId: 'staff-1' });
    expect(writes[1].values).toEqual({ employerId: 'emp-1' });
    await new Promise((r) => setImmediate(r));
    expect(n.toAddress).toHaveBeenCalledWith('Aiko@Example.jp', 'employer verified', expect.objectContaining({ subject: 'Your organisation is verified' }));
  });
});

// --- candidates -----------------------------------------------------------------------

describe('candidates', () => {
  function candidates(results: unknown[], opts: { live?: Map<string, string>; slugTo?: string | null; verified?: boolean } = {}) {
    const fake = fakeDb(results);
    const n = notifier();
    const shared = {
      liveSlugs: jest.fn().mockResolvedValue(opts.live ?? new Map()),
      liveCaregiverIdForSlug: jest.fn().mockResolvedValue(opts.slugTo ?? null),
      liveCards: jest.fn().mockResolvedValue(new Map()),
    };
    const employers = {
      assertVerified: opts.verified === false ? jest.fn().mockRejectedValue(new ForbiddenException()) : jest.fn().mockResolvedValue(EMPLOYER),
    };
    const placements = { openForCandidate: jest.fn().mockResolvedValue('pl-1') };
    const service = new CandidatesService(fake.db, shared as never, employers as never, n as never, placements as never, { forCandidates: jest.fn().mockResolvedValue(new Map()) } as never, { briefForCandidates: jest.fn().mockResolvedValue(new Map()), latestForCandidates: jest.fn().mockResolvedValue(new Map()) } as never);
    return { service, n, shared, placements, ...fake };
  }

  it('puts forward only caregivers whose shared profile is live', async () => {
    const { service, writes } = candidates([[ENQUIRY]], { live: new Map() });
    await expect(service.propose('enq-1', { caregiverId: 'cg-1' })).rejects.toThrow(/live shared profile/);
    expect(writes).toHaveLength(0);
  });

  it('records a staff proposal, moves the enquiry to Introduced and tells both sides', async () => {
    const { service, writes, n } = candidates([[ENQUIRY], [], [], [{ email: 'nadeesha@example.com' }]], { live: new Map([['cg-1', 'abcdefgh2345']]) });
    await service.propose('enq-1', { caregiverId: 'cg-1', messageToEmployer: 'Strong English' }).catch(() => undefined);
    expect(writes[0]).toMatchObject({ op: 'insert', values: { caregiverId: 'cg-1', source: 'STAFF', status: 'PROPOSED', messageToEmployer: 'Strong English' } });
    expect(writes[1].values).toMatchObject({ status: 'INTRODUCED' });
    await new Promise((r) => setImmediate(r));
    expect(n.toAddress).toHaveBeenCalledWith('aiko@example.jp', expect.stringContaining('proposed'), expect.anything());
  });

  it('will not put forward a caregiver on a closed enquiry', async () => {
    const { service } = candidates([[{ ...ENQUIRY, status: 'CLOSED' }]], { live: new Map([['cg-1', 'x']]) });
    await expect(service.propose('enq-1', { caregiverId: 'cg-1' })).rejects.toThrow('no longer open');
  });

  it('needs an interview date before marking one scheduled', async () => {
    const { service } = candidates([[{ id: 'c1', enquiryId: 'enq-1', caregiverId: 'cg-1', status: 'INTERVIEW_REQUESTED', interviewAt: null }]]);
    await expect(service.update('c1', { status: 'INTERVIEW_SCHEDULED' })).rejects.toThrow('interview date');
  });

  it("refuses an unverified employer's interview request", async () => {
    const { service, writes } = candidates([], { verified: false });
    await expect(service.requestInterview('emp-1', { enquiryId: 'enq-1', talentSlug: 'abcdefgh2345' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toHaveLength(0);
  });

  it("treats another employer's enquiry as not found", async () => {
    const { service } = candidates([[{ ...ENQUIRY, employerId: 'emp-2' }]], { slugTo: 'cg-1' });
    await expect(service.requestInterview('emp-1', { enquiryId: 'enq-1', talentSlug: 'abcdefgh2345' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records an interview request on a live profile and alerts staff', async () => {
    const { service, writes, n } = candidates([[ENQUIRY], [], [{ email: null }], []], { slugTo: 'cg-1' });
    await service.requestInterview('emp-1', { enquiryId: 'enq-1', talentSlug: 'abcdefgh2345', message: 'Can she start in March?' }).catch(() => undefined);
    expect(writes[0]).toMatchObject({ op: 'insert', values: { caregiverId: 'cg-1', source: 'EMPLOYER', status: 'INTERVIEW_REQUESTED', employerMessage: 'Can she start in March?' } });
    await new Promise((r) => setImmediate(r));
    expect(n.toStaff).toHaveBeenCalled();
  });

  it('lets the employer move a candidate only along the allowed steps', async () => {
    const { service } = candidates(
      [[{ id: 'c1', enquiryId: 'enq-1', caregiverId: 'cg-1', status: 'PLACED' }], [ENQUIRY]],
      { live: new Map([['cg-1', 'x']]) },
    );
    await expect(service.employerAction('emp-1', 'c1', { action: 'DECLINE' })).rejects.toThrow('not possible');
  });

  it("tells a caregiver only the country and kind of employer, never who", async () => {
    const { service } = candidates([
      [{ c: { id: 'c1', status: 'PROPOSED', interviewAt: null, createdAt: new Date('2026-10-20') }, country: 'JP', organisationType: 'CARE_HOME' }],
    ]);
    const [interest] = await service.interestFor('cg-1');
    expect(Object.keys(interest).sort()).toEqual(['country', 'createdAt', 'id', 'interviewAt', 'organisationType', 'status']);
  });
});
