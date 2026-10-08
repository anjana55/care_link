import { UnauthorizedException } from '@nestjs/common';
import { AccountClaimService } from './account-claim.service';
import * as identity from './identity.util';

/**
 * The claim flow's decisions, with the database reduced to the two lookups the
 * service makes through identity.util (mocked) plus a transaction stub. What
 * matters here is which channel is used, that every refusal looks the same, and
 * that success hands out a pending-link grant - never a session.
 */
jest.mock('./identity.util', () => {
  const actual = jest.requireActual('./identity.util');
  return { ...actual, findCaregiverByRegistrationNumber: jest.fn(), loadAccountState: jest.fn() };
});

const CAREGIVER = {
  id: 'cg-1',
  userId: 'u-1',
  fullName: 'Nimali Perera',
  primaryPhone: '0771234567',
  registrationNumber: 'CG-2026-123456',
  deletedAt: null,
};
const USER = { id: 'u-1', email: 'nimali@example.com', phone: '+94771234567', isActive: true, role: 'CAREGIVER', passwordHash: null };

function settings(overrides: Record<string, unknown> = {}) {
  return { enabled: true, caregiverEnabled: true, defaultCountryCode: '94', otpResendCooldownSeconds: 60, ...overrides };
}

function makeService(opts: { whatsapp?: Record<string, unknown>; claimVerify?: string | null; otpVerify?: boolean } = {}) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const chain: any = {};
  chain.select = jest.fn(() => chain);
  chain.from = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.limit = jest.fn(async () => []);
  chain.insert = jest.fn(() => ({ values: jest.fn(async (v: Record<string, unknown>) => inserts.push(v)) }));
  chain.update = jest.fn(() => ({
    set: jest.fn((v: Record<string, unknown>) => {
      updates.push(v);
      return { where: jest.fn(async () => undefined) };
    }),
  }));
  chain.transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(chain));

  const otp = {
    issue: jest.fn(async () => ({ issued: true, id: 'o1', code: '111222', expiresAt: new Date() })),
    verify: jest.fn(async () => opts.otpVerify ?? false),
  };
  const whatsapp = { sendOtp: jest.fn(async () => ({})), isDevConsole: () => false };
  const email = { sendClaimCodeEmail: jest.fn(async () => undefined) };
  const claimCodes = {
    issue: jest.fn(async () => ({ issued: true, code: '654321', expiresAt: new Date() })),
    verify: jest.fn(async () => opts.claimVerify ?? null),
  };
  const socialAuth = {
    pendingLinkGrant: jest.fn(async (userId: string) => ({
      pendingToken: `pending-for-${userId}`,
      pendingTokenExpiresInSeconds: 900,
      providers: { GOOGLE: true, MICROSOFT: false, FACEBOOK: false },
    })),
  };
  const service = new AccountClaimService(
    chain as never,
    { get: () => 'production' } as never,
    { getResolved: async () => settings(opts.whatsapp) } as never,
    otp as never,
    whatsapp as never,
    email as never,
    claimCodes as never,
    socialAuth as never,
  );
  return { service, otp, whatsapp, email, claimCodes, socialAuth, updates, inserts };
}

const findCaregiver = identity.findCaregiverByRegistrationNumber as jest.Mock;
const loadState = identity.loadAccountState as jest.Mock;

beforeEach(() => {
  findCaregiver.mockReset().mockResolvedValue(CAREGIVER);
  loadState.mockReset().mockResolvedValue({ user: USER, links: [], claimable: true });
});

describe('AccountClaimService.start', () => {
  it('sends a WhatsApp code to the phone on the caregiver record when WhatsApp is on', async () => {
    const { service, otp, whatsapp, email } = makeService();
    const res = await service.start('cg 2026 123456');
    expect(findCaregiver).toHaveBeenCalledWith(expect.anything(), 'CG-2026-123456');
    expect(otp.issue).toHaveBeenCalledWith('+94771234567', 'CLAIM', expect.anything());
    expect(whatsapp.sendOtp).toHaveBeenCalled();
    expect(email.sendClaimCodeEmail).not.toHaveBeenCalled();
    expect(res).not.toHaveProperty('devCode');
  });

  it('falls back to an email code when WhatsApp is off for caregivers', async () => {
    const { service, otp, email, claimCodes } = makeService({ whatsapp: { caregiverEnabled: false } });
    await service.start('CG-2026-123456');
    expect(otp.issue).not.toHaveBeenCalled();
    expect(claimCodes.issue).toHaveBeenCalledWith('cg-1', 'EMAIL');
    expect(email.sendClaimCodeEmail).toHaveBeenCalledWith('nimali@example.com', '654321', 'CG-2026-123456', 15);
  });

  it('answers identically for an unknown number and for an account that is already secured', async () => {
    const { service, otp } = makeService();
    const sent = await service.start('CG-2026-123456');

    findCaregiver.mockResolvedValueOnce(null);
    const unknown = await service.start('CG-2026-999999');
    loadState.mockResolvedValueOnce({ user: USER, links: [{ provider: 'GOOGLE' }], claimable: false });
    const secured = await service.start('CG-2026-123456');

    expect(unknown.message).toBe(sent.message);
    expect(secured.message).toBe(sent.message);
    expect(otp.issue).toHaveBeenCalledTimes(1);
  });
});

describe('AccountClaimService.verify', () => {
  it('accepts a WhatsApp code and returns a pending-link grant, not a session', async () => {
    const { service, socialAuth, updates } = makeService({ otpVerify: true });
    const res = await service.verify('CG-2026-123456', '111 222');
    expect(res.channel).toBe('WHATSAPP');
    expect(res.pendingToken).toBe('pending-for-u-1');
    expect(res).not.toHaveProperty('accessToken');
    expect(socialAuth.pendingLinkGrant).toHaveBeenCalledWith('u-1');
    // The phone just proven over WhatsApp is marked verified on the login.
    expect(updates).toContainEqual(expect.objectContaining({ phone: '+94771234567', phoneVerifiedAt: expect.any(Date) }));
  });

  it('never tries the WhatsApp check for a staff-shaped code', async () => {
    const { service, otp } = makeService();
    await expect(service.verify('CG-2026-123456', 'ABCD-EFGH')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(otp.verify).not.toHaveBeenCalled();
  });

  it('creates the login for a staff-entered caregiver who claims with a staff code', async () => {
    findCaregiver.mockResolvedValueOnce({ ...CAREGIVER, userId: null });
    loadState.mockResolvedValueOnce({ user: null, links: [], claimable: true });
    const { service, inserts } = makeService({ claimVerify: 'STAFF' });
    const res = await service.verify('CG-2026-123456', 'ABCD-EFGH');
    expect(res.channel).toBe('STAFF');
    expect(inserts).toContainEqual(
      expect.objectContaining({ role: 'CAREGIVER', fullName: 'Nimali Perera', phone: null, passwordHash: null, isActive: true }),
    );
  });

  it('rejects a correct-looking code for an account that has been secured since, with the generic message', async () => {
    loadState.mockResolvedValueOnce({ user: USER, links: [{ provider: 'GOOGLE' }], claimable: false });
    const { service, claimCodes, otp } = makeService({ otpVerify: true });
    await expect(service.verify('CG-2026-123456', '111222')).rejects.toThrow(
      'This code is invalid or has expired. Request a new one and try again.',
    );
    expect(claimCodes.verify).not.toHaveBeenCalled();
    expect(otp.verify).not.toHaveBeenCalled();
  });

  it('rejects an unknown registration number with the same message', async () => {
    findCaregiver.mockResolvedValueOnce(null);
    const { service } = makeService({ otpVerify: true });
    await expect(service.verify('CG-2026-000000', '111222')).rejects.toThrow(
      'This code is invalid or has expired. Request a new one and try again.',
    );
  });
});
