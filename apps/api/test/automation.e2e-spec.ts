import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID as uuid } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { AutomationOverview } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { agentDecisions, auditLogs, users } from '../src/database/schema';
import { AutomationService } from '../src/automation/automation.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * The automation rail over real HTTP and MySQL: everything starts Manual, the
 * dial and the risk tiers decide what an agent may do, autonomy has to be
 * earned and is lost again, and each of the four switches back to manual
 * works - without losing the dial settings or anything in flight.
 *
 * No agent exists yet, so the "agent" here is the test calling the same
 * gate() / decide() an agent will.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Automation rail (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let automation: AutomationService;
  let staffToken: string;
  let adminToken: string;
  let caregiverToken: string;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const admin = {
    overview: async () => (await api().get('/settings/automation').set(bearer(adminToken)).expect(200)).body as AutomationOverview,
    mode: (key: string, mode: string) => api().patch(`/settings/automation/functions/${key}`).set(bearer(adminToken)).send({ mode }),
    master: (on: boolean, reason?: string) => api().post('/settings/automation/master').set(bearer(adminToken)).send({ on, reason }),
    policy: (action: string, body: object) => api().patch(`/settings/automation/actions/${action}`).set(bearer(adminToken)).send(body),
    bar: (body: object) => api().patch('/settings/automation').set(bearer(adminToken)).send(body),
  };
  const review = (id: string, verdict: string, note?: string) =>
    api().post(`/automation/decisions/${id}/review`).set(bearer(staffToken)).send({ verdict, note });
  const fn = (o: AutomationOverview, key: string) => o.functions.find((f) => f.key === key)!;
  const action = (o: AutomationOverview, key: string) => o.functions.flatMap((f) => f.actions).find((a) => a.key === key)!;

  async function wipe() {
    for (const table of ['agent_decisions', 'automation_cases', 'automation_action_policies', 'automation_functions', 'automation_settings']) {
      await db.execute(sql.raw(`DELETE FROM ${table}`));
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    automation = app.get(AutomationService);
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    const [caregiver] = await db.select().from(users).where(eq(users.role, 'CAREGIVER')).limit(1);
    caregiverToken = app
      .get(JwtService)
      .sign({ sub: caregiver.id, role: 'CAREGIVER' }, { secret: app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!, expiresIn: '10m' });
    expect(adminToken).toBeTruthy();
    expect(staffToken).toBeTruthy();
  });

  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  it('ships fully manual: every dial at Manual and the gate closed to everything', async () => {
    const o = await admin.overview();
    expect(o.masterManual).toBe(false);
    expect(o.disabledByServer).toBe(false);
    expect(o.bar).toEqual({ cases: 50, agreementPercent: 90, demoteAfterReversals: 3 });
    expect(o.functions.map((f) => f.key)).toEqual(['INTAKE', 'MATCHING', 'BOOKING', 'BILLING', 'LIVE_CARE', 'ONBOARDING']);
    for (const f of o.functions) {
      expect(f.mode).toBe('MANUAL');
      expect(f.effectiveMode).toBe('MANUAL');
      expect(f.actions.every((a) => !a.autoAllowed)).toBe(true);
    }

    const result = await automation.decide({ action: 'billing.issue_invoice', reason: 'Shifts completed' });
    expect(result.outcome).toBe('NONE');
    expect(result.decisionId).toBeNull();
    expect(await db.select().from(agentDecisions)).toHaveLength(0);
  });

  it('keeps the settings to admins and the case controls to staff', async () => {
    await api().get('/settings/automation').set(bearer(staffToken)).expect(403);
    await api().patch('/settings/automation/functions/BILLING').set(bearer(staffToken)).send({ mode: 'AUTO' }).expect(403);
    await api().post('/settings/automation/master').set(bearer(staffToken)).send({ on: true }).expect(403);
    await api().get('/automation/decisions').set(bearer(staffToken)).expect(200);
    await api().get('/automation/decisions').expect(401);
    await api().get('/automation/decisions').set(bearer(caregiverToken)).expect(403);
    await api().post(`/automation/cases/BOOKING/${uuid()}/take-over`).set(bearer(caregiverToken)).send({}).expect(403);
    await admin.mode('PAYROLL', 'AUTO').expect(400);
    await admin.mode('BILLING', 'FULL').expect(400);
  });

  it('follows the dial: Shadow only logs, Assist proposes, Auto acts on reversible steps', async () => {
    const invoice = { caseType: 'INVOICE' as const, caseId: uuid() };

    await admin.mode('BILLING', 'SHADOW').expect(200);
    const shadow = await automation.decide({ action: 'billing.issue_invoice', case: invoice, reason: 'All 5 shifts completed', confidence: 0.93, model: 'test-model' });
    expect(shadow.outcome).toBe('SHADOW');

    await admin.mode('BILLING', 'ASSIST').expect(200);
    expect((await automation.decide({ action: 'billing.issue_invoice', case: invoice, reason: 'All 5 shifts completed' })).outcome).toBe('PROPOSE');

    await admin.mode('BILLING', 'AUTO').expect(200);
    expect((await automation.decide({ action: 'billing.issue_invoice', case: invoice, reason: 'All 5 shifts completed' })).outcome).toBe('EXECUTE');
    // A commitment that has not earned it, and a human-only action: proposals even in Auto.
    expect((await automation.gate('billing.approve_payout')).outcome).toBe('PROPOSE');
    expect((await automation.gate('billing.refund')).outcome).toBe('PROPOSE');
    // Another function's dial has not moved.
    expect((await automation.gate('matching.send_offer')).outcome).toBe('NONE');

    const log = (await api().get(`/automation/decisions?caseType=INVOICE&caseId=${invoice.caseId}`).set(bearer(staffToken)).expect(200)).body;
    expect(log.map((d: { outcome: string }) => d.outcome)).toEqual(['EXECUTED', 'PROPOSED', 'SHADOW']);
    expect(log[2]).toMatchObject({ mode: 'SHADOW', tier: 1, reason: 'All 5 shifts completed', confidence: 0.93, model: 'test-model', actionLabel: 'Issue an invoice for completed shifts' });

    const awaiting = (await api().get('/automation/decisions?awaitingStaff=true').set(bearer(staffToken)).expect(200)).body;
    expect(awaiting).toHaveLength(1);
    const o = await admin.overview();
    expect(fn(o, 'BILLING').recent).toEqual({ SHADOW: 1, PROPOSED: 1, EXECUTED: 1 });
    expect(fn(o, 'BILLING').awaitingStaff).toBe(1);
  });

  it('makes a commitment earn acting alone, and takes it away after reversals', async () => {
    await admin.mode('BILLING', 'AUTO').expect(200);
    await admin.bar({ cases: 10, agreementPercent: 90, demoteAfterReversals: 3 }).expect(200);

    // Never for a human-only action; nothing to grant for tiers 0-1; not without the record.
    expect((await admin.policy('billing.refund', { autoAllowed: true }).expect(400)).body.message).toMatch(/always needs a person/);
    await admin.policy('billing.issue_invoice', { autoAllowed: true }).expect(400);
    await admin.policy('billing.no_such_action', { autoAllowed: true }).expect(404);
    expect((await admin.policy('billing.approve_payout', { autoAllowed: true }).expect(400)).body.message).toMatch(/Not earned yet/);

    // Ten proposals; staff approve nine and turn one down: 90%.
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const d = await automation.decide({ action: 'billing.approve_payout', reason: `Payout ${i} matches completed shifts` });
      expect(d.outcome).toBe('PROPOSE');
      ids.push(d.decisionId!);
    }
    for (const id of ids.slice(0, 8)) await review(id, 'AGREED').expect(200);
    await review(ids[8], 'DIFFERED', 'Allowance missing').expect(200);
    let a = action(await admin.overview(), 'billing.approve_payout');
    expect(a).toMatchObject({ record: { judged: 9, agreed: 8, serious: 0 }, agreementPercent: 89, eligibleForAuto: false });
    await admin.policy('billing.approve_payout', { autoAllowed: true }).expect(400);

    await review(ids[9], 'AGREED').expect(200);
    a = action(await admin.overview(), 'billing.approve_payout');
    expect(a).toMatchObject({ record: { judged: 10, agreed: 9 }, agreementPercent: 90, eligibleForAuto: true, autoAllowed: false });

    await admin.policy('billing.approve_payout', { autoAllowed: true, limits: { maxAmount: 25000 } }).expect(200);
    const gate = await automation.gate('billing.approve_payout');
    expect(gate).toMatchObject({ outcome: 'EXECUTE', limits: { maxAmount: 25000 } });

    // Staff undo it three times in a day: back to needing approval, and the old record no longer counts.
    await review(ids[0], 'REVERSED').expect(400); // a proposal was never carried out, so it cannot be reversed
    for (let i = 0; i < 3; i++) {
      const d = await automation.decide({ action: 'billing.approve_payout', reason: 'Payout matches completed shifts' });
      expect(d.outcome).toBe('EXECUTE');
      await review(d.decisionId!, 'REVERSED', 'Wrong bank account').expect(200);
    }
    expect((await automation.gate('billing.approve_payout')).outcome).toBe('PROPOSE');
    a = action(await admin.overview(), 'billing.approve_payout');
    expect(a.autoAllowed).toBe(false);
    expect(a.demotedAt).toBeTruthy();
    expect(a.record.judged).toBe(0);
    expect(a.eligibleForAuto).toBe(false);
    await admin.policy('billing.approve_payout', { autoAllowed: true }).expect(400);
  });

  it('demotes at once on a serious mistake, and a serious mistake blocks promotion', async () => {
    await admin.mode('BOOKING', 'AUTO').expect(200);
    await admin.bar({ cases: 10 }).expect(200);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await automation.decide({ action: 'booking.confirm', reason: 'Paid and accepted' })).decisionId!);
    for (const id of ids) await review(id, 'AGREED').expect(200);
    await admin.policy('booking.confirm', { autoAllowed: true }).expect(200);

    const done = await automation.decide({ action: 'booking.confirm', reason: 'Paid and accepted' });
    expect(done.outcome).toBe('EXECUTE');
    await review(done.decisionId!, 'SERIOUS', 'Confirmed with an unverified caregiver').expect(200);
    expect((await automation.gate('booking.confirm')).outcome).toBe('PROPOSE');

    // After a serious miss in the current record, it cannot be re-earned until an admin resets the record.
    const again = await automation.decide({ action: 'booking.confirm', reason: 'Paid and accepted' });
    await review(again.decisionId!, 'SERIOUS').expect(200);
    for (let i = 0; i < 10; i++) {
      await review((await automation.decide({ action: 'booking.confirm', reason: 'Paid and accepted' })).decisionId!, 'AGREED').expect(200);
    }
    expect(action(await admin.overview(), 'booking.confirm')).toMatchObject({ record: { judged: 11, agreed: 10, serious: 1 }, eligibleForAuto: false });
    await admin.policy('booking.confirm', { autoAllowed: true }).expect(400);
    await admin.policy('booking.confirm', { resetRecord: true }).expect(200);
    expect(action(await admin.overview(), 'booking.confirm').record.judged).toBe(0);
  });

  it('lets staff take over one case and hand it back, keeping the handover note', async () => {
    await admin.mode('MATCHING', 'AUTO').expect(200);
    const mine = { caseType: 'REQUEST' as const, caseId: uuid() };
    const other = { caseType: 'REQUEST' as const, caseId: uuid() };
    const path = `/automation/cases/REQUEST/${mine.caseId}`;

    expect((await api().get(path).set(bearer(staffToken)).expect(200)).body).toMatchObject({
      driver: 'AGENT',
      handoverNote: null,
      agentActive: true,
      mode: 'AUTO',
      decisions: [],
    });
    await api().post(`${path}/hand-back`).set(bearer(staffToken)).expect(400);

    const note = { done: 'Offered to CG-2041 and CG-1187', waiting: 'CG-1187 to answer by 14:10', next: 'Offer to CG-3310 if no answer' };
    await automation.setHandoverNote(mine, note);
    expect((await automation.gate('matching.send_offer', mine)).outcome).toBe('EXECUTE');

    const taken = (await api().post(`${path}/take-over`).set(bearer(staffToken)).send({ reason: 'Client phoned the office' }).expect(200)).body;
    expect(taken).toMatchObject({ driver: 'STAFF', takeoverSource: 'STAFF', takeoverReason: 'Client phoned the office', handoverNote: note });
    expect(taken.takenOverByUserId).toBeTruthy();
    expect(taken.takenOverByName).toBeTruthy();

    expect((await automation.decide({ action: 'matching.send_offer', case: mine, reason: 'Next best match' })).outcome).toBe('NONE');
    expect((await automation.gate('matching.send_offer', other)).outcome).toBe('EXECUTE');
    expect((await admin.overview()).casesTakenOver).toBe(1);

    const back = (await api().post(`${path}/hand-back`).set(bearer(staffToken)).expect(200)).body;
    expect(back).toMatchObject({ driver: 'AGENT', takenOverAt: null, takenOverByName: null, takeoverReason: null, handoverNote: note });
    // The page gets the agent's decisions on this case with it, and only this case's.
    await automation.decide({ action: 'matching.send_offer', case: mine, reason: 'Closest verified match' });
    await automation.decide({ action: 'matching.send_offer', case: other, reason: 'Someone else' });
    const view = (await api().get(path).set(bearer(staffToken)).expect(200)).body;
    expect(view.decisions).toHaveLength(1);
    expect(view.decisions[0]).toMatchObject({ outcome: 'EXECUTED', reason: 'Closest verified match' });
    // An invoice is not worked on by the matching agent: its page shows nothing.
    expect((await api().get(`/automation/cases/INVOICE/${uuid()}`).set(bearer(staffToken)).expect(200)).body).toMatchObject({ agentActive: false, mode: 'MANUAL' });
    // With the master switch on, no agent is active on any page.
    await admin.master(true).expect(200);
    expect((await api().get(path).set(bearer(staffToken)).expect(200)).body).toMatchObject({ agentActive: false, mode: 'MANUAL' });
    await admin.master(false).expect(200);
    expect((await automation.gate('matching.send_offer', mine)).outcome).toBe('EXECUTE');

    await api().get('/automation/cases/TICKET/' + mine.caseId).set(bearer(staffToken)).expect(400);
    await api().get('/automation/cases/REQUEST/not-a-uuid').set(bearer(staffToken)).expect(400);
  });

  it('master switch: everything manual at once, and the dials are back when it is switched off', async () => {
    await admin.mode('BILLING', 'AUTO').expect(200);
    await admin.mode('MATCHING', 'ASSIST').expect(200);

    const on = (await admin.master(true, 'AI provider outage').expect(200)).body as AutomationOverview;
    expect(on).toMatchObject({ masterManual: true, masterReason: 'AI provider outage' });
    expect(fn(on, 'BILLING')).toMatchObject({ mode: 'AUTO', effectiveMode: 'MANUAL' });
    expect(fn(on, 'MATCHING')).toMatchObject({ mode: 'ASSIST', effectiveMode: 'MANUAL' });
    expect((await automation.gate('billing.issue_invoice')).outcome).toBe('NONE');
    expect((await automation.gate('matching.rank_caregivers')).outcome).toBe('NONE');

    const off = (await admin.master(false).expect(200)).body as AutomationOverview;
    expect(off).toMatchObject({ masterManual: false, masterReason: null });
    expect(fn(off, 'BILLING').effectiveMode).toBe('AUTO');
    expect((await automation.gate('billing.issue_invoice')).outcome).toBe('EXECUTE');
    expect((await automation.gate('matching.send_offer')).outcome).toBe('PROPOSE');
  });

  it('automatic trip: the function stays manual until an admin resets it', async () => {
    await admin.mode('LIVE_CARE', 'AUTO').expect(200);
    await admin.mode('BILLING', 'AUTO').expect(200);

    await automation.trip('LIVE_CARE', 'AI endpoint timed out 5 times in 10 minutes');
    await automation.trip('LIVE_CARE', 'a later, different reason');

    let o = await admin.overview();
    expect(fn(o, 'LIVE_CARE')).toMatchObject({ mode: 'AUTO', effectiveMode: 'MANUAL', tripReason: 'AI endpoint timed out 5 times in 10 minutes' });
    expect(fn(o, 'LIVE_CARE').trippedAt).toBeTruthy();
    expect((await automation.gate('live_care.chase_late_caregiver')).outcome).toBe('NONE');
    // Only that function stopped.
    expect((await automation.gate('billing.issue_invoice')).outcome).toBe('EXECUTE');

    await admin.mode('LIVE_CARE', 'AUTO').expect(400);
    await admin.mode('LIVE_CARE', 'MANUAL').expect(200);
    await api().post('/settings/automation/functions/BILLING/reset').set(bearer(adminToken)).send({}).expect(400);

    o = (await api().post('/settings/automation/functions/LIVE_CARE/reset').set(bearer(adminToken)).send({ mode: 'ASSIST' }).expect(200)).body;
    expect(fn(o, 'LIVE_CARE')).toMatchObject({ mode: 'ASSIST', effectiveMode: 'ASSIST', trippedAt: null, tripReason: null });
    expect((await automation.gate('live_care.chase_late_caregiver')).outcome).toBe('PROPOSE');
  });

  it('AUTOMATION_ENABLED=false on the server overrides every dial', async () => {
    await admin.mode('BILLING', 'AUTO').expect(200);
    const config = app.get(ConfigService);
    const original = config.get.bind(config);
    const spy = jest.spyOn(config, 'get').mockImplementation(((key: string) => (key === 'AUTOMATION_ENABLED' ? 'false' : original(key))) as never);
    try {
      expect((await automation.gate('billing.issue_invoice')).outcome).toBe('NONE');
      const o = await admin.overview();
      expect(o.disabledByServer).toBe(true);
      expect(fn(o, 'BILLING')).toMatchObject({ mode: 'AUTO', effectiveMode: 'MANUAL' });
    } finally {
      spy.mockRestore();
    }
    expect((await automation.gate('billing.issue_invoice')).outcome).toBe('EXECUTE');
  });

  it('writes every switch to the audit log', async () => {
    const [{ before }] = (await db.select({ before: sql<number>`COUNT(*)` }).from(auditLogs).where(eq(auditLogs.entityType, 'AutomationSettings'))) as { before: number }[];
    await admin.master(true, 'Drill').expect(200);
    await admin.master(false).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    const [{ after }] = (await db.select({ after: sql<number>`COUNT(*)` }).from(auditLogs).where(eq(auditLogs.entityType, 'AutomationSettings'))) as { after: number }[];
    expect(Number(after) - Number(before)).toBe(2);
  });
});
