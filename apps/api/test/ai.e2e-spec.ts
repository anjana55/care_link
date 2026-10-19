import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { auditLogs, careRequests, caregivers, patients, skills } from '../src/database/schema';
import { SEED_PASSWORD } from './seed-password';

/**
 * The AI features over real HTTP, against a stand-in OpenAI-compatible model
 * server: Settings > AI, the public AI Search (extract + re-rank), staff
 * caregiver suggestions, and the staff assistant's propose -> approve flow.
 * The stand-in answers by recognising which prompt it was sent, and records
 * every request so the tests can check what reached the "model".
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

type Msg = { role: string; content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string };

describe('AI features (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let model: Server;
  let modelUrl: string;
  const seen: { messages: Msg[]; tools?: unknown[] }[] = [];
  /** What the stand-in does for an assistant turn, decided per test. */
  let assistantScript: (messages: Msg[]) => Record<string, unknown> = () => ({ content: 'Hello' });
  let districtId: number;
  let cityId: number;
  let skillId: string;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = Math.floor(Date.now() / 1000) % 10_000;
  let n = 0;
  // 077 is a mobile prefix every validator accepts; 7 digits always, whatever the clock says.
  const newPhone = () => `077${String((run * 1000 + ++n) % 10_000_000).padStart(7, '0')}`;

  function reply(message: Record<string, unknown>) {
    return { id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: null, ...message }, finish_reason: 'stop' }] };
  }

  async function newCaregiver() {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `AI Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy',
        dateOfBirth: '1985-03-02', gender: 'FEMALE', civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.execute(sql`UPDATE caregivers SET status = 'ACTIVE', district_id = ${districtId}, city_id = NULL WHERE id = ${row.id}`);
    return { id: row.id, publicId: row.publicId, fullName: row.fullName };
  }

  async function newClientRequest(caregiverPublicId: string) {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-patient')
      .send({
        email: `ai-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'AI Test Client', phone, consentAccepted: true,
        registrantType: 'GUARDIAN', recipientName: 'Kamala Perera', recipientRelationship: 'PARENT', recipientAge: 81, recipientGender: 'FEMALE',
        preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Has dementia and needs help at night with medication.', careSchedule: 'NIGHT',
        careStart: 'WITHIN_WEEK',
      })
      .expect(201);
    const [row] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    const token = jwt.sign({ sub: row.userId, role: 'PATIENT_GUARDIAN', patientId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    const req = await api().post('/me/care-requests').set(bearer(token)).send({ caregiverPublicId }).expect(201);
    const [cr] = await db.select().from(careRequests).where(eq(careRequests.id, req.body.id));
    return { id: cr.id, reference: cr.reference, phone };
  }

  beforeAll(async () => {
    model = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}') as { messages: Msg[]; tools?: unknown[] };
        seen.push(parsed);
        const system = parsed.messages.find((m) => m.role === 'system')?.content ?? '';
        let out: Record<string, unknown>;
        if (req.headers.authorization !== 'Bearer test-key') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad key' }));
          return;
        }
        if (system.includes('turn a family')) {
          // Extraction: a real district and skill, plus fields that must be dropped.
          out = reply({
            content: JSON.stringify({
              patient: { age: 81, gender: 'FEMALE', medicalConditions: ['dementia'] },
              districtId,
              city: 'Nowhere-ville',
              mandatorySkillIds: ['S999'],
              optionalSkillIds: ['S1'],
              languageIds: [],
              shift: 'NIGHT',
              caregiverGenderPreference: 'FEMALE',
              desiredStartDate: '1999-01-01',
              minimumExperienceYears: null,
              dailyBudget: '4,500',
              monthlyBudget: null,
            }),
          });
        } else if (system.includes('order a shortlist')) {
          // Re-rank: reverse the pool, with a made-up handle mixed in.
          const handles = [...(parsed.messages.at(-1)?.content ?? '').matchAll(/^(C\d+):/gm)].map((m) => m[1]);
          out = reply({ content: JSON.stringify({ ranking: [{ id: 'C99', reason: 'ghost' }, ...handles.reverse().map((h) => ({ id: h, reason: `Good fit ${h}` }))] }) });
        } else if (parsed.tools?.length && system.includes('operations assistant')) {
          out = reply(assistantScript(parsed.messages));
        } else {
          out = reply({ content: 'OK' });
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      });
    });
    await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
    modelUrl = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    districtId = tree.flatMap((p) => p.districts).at(-1)!.id;
    cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    const allSkills = await db.select().from(skills).orderBy(skills.name);
    skillId = allSkills[0].id;
  });

  afterAll(async () => {
    await api().patch('/settings/ai').set(bearer(adminToken)).send({ enabled: false });
    await app.close();
    await new Promise((resolve) => model.close(resolve));
  });

  it('is off by default, and only an admin can configure it; the key never comes back', async () => {
    await api().patch('/settings/ai').set(bearer(adminToken)).send({ enabled: false, clearApiKey: true }).expect(200);
    const cfg = await api().get('/public/meta/search-config').expect(200);
    expect(cfg.body).toEqual({ aiSearchEnabled: false });
    await api().post('/public/ai/extract').send({ query: 'my mother needs night care in Kandy' }).expect(503);
    await api().get('/settings/ai').set(bearer(staffToken)).expect(403);
    await api().patch('/settings/ai').set(bearer(staffToken)).send({ enabled: true }).expect(403);

    // A hosted provider without a key cannot be switched on.
    await api().patch('/settings/ai').set(bearer(adminToken)).send({ enabled: true, provider: 'OPENAI_COMPATIBLE', baseUrl: modelUrl, model: 'stand-in' }).expect(400);

    const saved = await api()
      .patch('/settings/ai')
      .set(bearer(adminToken))
      .send({ enabled: true, provider: 'OPENAI_COMPATIBLE', baseUrl: `${modelUrl}/`, model: 'stand-in', apiKey: 'test-key', candidatePoolSize: 10 })
      .expect(200);
    expect(saved.body).toMatchObject({ enabled: true, provider: 'OPENAI_COMPATIBLE', baseUrl: modelUrl, apiKeySet: true, apiKeyHint: '••••-key' });
    expect(JSON.stringify(saved.body)).not.toContain('test-key');

    const test = await api().post('/settings/ai/test').set(bearer(adminToken)).expect(200);
    expect(test.body).toMatchObject({ ok: true, provider: 'OPENAI_COMPATIBLE' });

    // Blank temperature means "not sent".
    const blank = await api().patch('/settings/ai').set(bearer(adminToken)).send({ temperature: null }).expect(200);
    expect(blank.body.temperature).toBeNull();
    const before = seen.length;
    await api().post('/settings/ai/test').set(bearer(adminToken)).expect(200);
    expect(seen.slice(before).every((r) => !('temperature' in r))).toBe(true);
    await api().patch('/settings/ai').set(bearer(adminToken)).send({ temperature: 0.2 }).expect(200);

    expect((await api().get('/public/meta/search-config').expect(200)).body).toEqual({ aiSearchEnabled: true });
    expect((await api().get('/ai/status').set(bearer(staffToken)).expect(200)).body).toEqual({ matching: true, assistant: true });
  });

  it('extracts a validated search request from free text, dropping anything it cannot stand behind', async () => {
    const res = await api().post('/public/ai/extract').send({ query: 'My 81 year old mother has dementia, needs a female carer at night', locale: 'en' }).expect(200);
    const r = res.body.requirements;
    expect(r.location).toEqual({ districtId }); // unknown city dropped
    expect(r.optionalSkillIds).toEqual([skillId]);
    expect(r.mandatorySkillIds).toBeUndefined(); // S999 does not exist
    expect(r.desiredStartDate).toBeUndefined(); // in the past
    expect(r.shift).toBe('NIGHT');
    expect(r.caregiverGenderPreference).toBe('FEMALE');
    expect(r.budget).toEqual({ dailyRate: 4500 });
    expect(r.patient).toEqual({ age: 81, gender: 'FEMALE', medicalConditions: ['dementia'] });
    expect(res.body.summary.care).toContain('Night care');

    await api().post('/public/ai/extract').send({ query: 'short' }).expect(400);
  });

  it('re-ranks only the hard-filtered pool, with reasons, and pages without asking the model again', async () => {
    const a = await newCaregiver();
    const b = await newCaregiver();
    const today = new Date().toISOString().slice(0, 10);
    const body = { request: { location: { districtId }, desiredStartDate: today, page: 1, pageSize: 50, locale: 'en' }, query: 'Night care for my father' };

    const plain = await api().post('/public/search').send(body.request).expect(200);
    const res = await api().post('/public/ai/search').send(body).expect(200);
    expect(res.body.aiRanked).toBe(true);
    expect(res.body.total).toBe(plain.body.total);
    const ids = res.body.items.map((i: { publicId: string }) => i.publicId);
    expect(ids).toEqual(expect.arrayContaining([a.publicId, b.publicId]));
    expect(res.body.items[0].aiReason).toMatch(/^Good fit C\d+$/);
    // Nothing reached the model that the public card does not show.
    const rerank = seen.filter((s) => s.messages[0]?.content?.includes('order a shortlist')).at(-1)!;
    expect(JSON.stringify(rerank)).not.toContain(a.fullName);

    const calls = seen.length;
    await api().post('/public/ai/search').send({ ...body, request: { ...body.request, page: 2, pageSize: 1 } }).expect(200);
    expect(seen.length).toBe(calls); // cached order
  });

  it('suggests caregivers for a request, for staff only', async () => {
    const cg = await newCaregiver();
    const req = await newClientRequest(cg.publicId);
    const res = await api().get(`/care-requests/${req.id}/suggestions`).set(bearer(staffToken)).expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0]).toEqual(expect.objectContaining({ caregiverId: expect.any(String), fullName: expect.any(String) }));
    expect(res.body.criteria).toContain('Night care');
    const client = await api().get(`/care-requests/${req.id}/suggestions`);
    expect(client.status).toBe(401);
  });

  it('lets the assistant look up and propose, but changes nothing until staff approve', async () => {
    const cg = await newCaregiver();
    const req = await newClientRequest(cg.publicId);

    assistantScript = (messages) => {
      const last = messages.at(-1)!;
      if (last.role === 'user') return { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_request', arguments: JSON.stringify({ request: req.reference }) } }] };
      const lastCall = [...messages].reverse().find((m) => m.tool_calls)!.tool_calls![0].function.name;
      if (lastCall === 'get_request') {
        return {
          tool_calls: [
            { id: 'c2', type: 'function', function: { name: 'update_request_status', arguments: JSON.stringify({ request: req.reference, status: 'IN_PROGRESS', note: 'Calling the family today' }) } },
            { id: 'c3', type: 'function', function: { name: 'update_request_status', arguments: JSON.stringify({ request: req.reference, status: 'INTRODUCED' }) } },
          ],
        };
      }
      return { content: `I have proposed moving ${req.reference} to In progress - please approve it.` };
    };

    const convo = await api().post('/assistant/conversations').set(bearer(staffToken)).expect(201);
    const turn = await api()
      .post(`/assistant/conversations/${convo.body.id}/messages`)
      .set(bearer(staffToken))
      .send({ content: `Please pick up ${req.reference}` })
      .expect(200);

    const reply = turn.body.messages.at(-1);
    expect(reply.role).toBe('assistant');
    expect(reply.content).toContain('proposed');
    expect(reply.links).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'request', id: req.id })]));
    // The impossible second move (NEW -> INTRODUCED) was refused at proposal time, not offered to staff.
    expect(reply.actions).toHaveLength(1);
    const action = reply.actions[0];
    expect(action).toMatchObject({ tool: 'update_request_status', status: 'PENDING' });
    expect(action.summary).toContain(req.reference);
    const [before] = await db.select().from(careRequests).where(eq(careRequests.id, req.id));
    expect(before.status).toBe('NEW');

    // The client's phone number never reached the model.
    const turnRequests = seen.filter((s) => s.messages[0]?.content?.includes('operations assistant'));
    expect(JSON.stringify(turnRequests)).not.toContain(req.phone);
    // ...and the refused proposal went back to it as an error it can correct.
    expect(JSON.stringify(turnRequests)).toContain('it can move to');

    // Someone else cannot see or approve it.
    await api().get(`/assistant/conversations/${convo.body.id}`).set(bearer(adminToken)).expect(404);
    await api().post(`/assistant/actions/${action.id}/approve`).set(bearer(adminToken)).expect(404);

    const approved = await api().post(`/assistant/actions/${action.id}/approve`).set(bearer(staffToken)).expect(200);
    expect(approved.body).toMatchObject({ status: 'EXECUTED', result: { kind: 'request', id: req.id, reference: req.reference } });
    await api().post(`/assistant/actions/${action.id}/approve`).set(bearer(staffToken)).expect(409);
    await api().post(`/assistant/actions/${action.id}/reject`).set(bearer(staffToken)).expect(409);

    const [after] = await db.select().from(careRequests).where(eq(careRequests.id, req.id));
    expect(after.status).toBe('IN_PROGRESS');
    await new Promise((r) => setTimeout(r, 100)); // the audit write is fire-and-forget
    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, req.id), eq(auditLogs.action, 'UPDATE_CARE_REQUEST_STATUS')));
    expect(audits.some((a) => (a.metadata as { via?: string } | null)?.via === 'assistant')).toBe(true);

    // The next turn tells the model what became of its proposal.
    assistantScript = () => ({ content: 'Noted.' });
    await api().post(`/assistant/conversations/${convo.body.id}/messages`).set(bearer(staffToken)).send({ content: 'Thanks' }).expect(200);
    const lastSystem = seen.at(-1)!.messages[0].content!;
    expect(lastSystem).toContain('APPROVED and done');

    const list = await api().get('/assistant/conversations').set(bearer(staffToken)).expect(200);
    expect(list.body[0]).toMatchObject({ id: convo.body.id, title: `Please pick up ${req.reference}` });
  });

  it('is unavailable when switched off, and verifiers cannot use it', async () => {
    const convo = await api().post('/assistant/conversations').set(bearer(staffToken)).expect(201);
    await api().patch('/settings/ai').set(bearer(adminToken)).send({ staffAssistantEnabled: false }).expect(200);
    await api().post(`/assistant/conversations/${convo.body.id}/messages`).set(bearer(staffToken)).send({ content: 'hi' }).expect(503);
    await api().patch('/settings/ai').set(bearer(adminToken)).send({ staffAssistantEnabled: true }).expect(200);
    const verifier = (await api().post('/auth/login').send({ email: 'verifier@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    await api().get('/assistant/conversations').set(bearer(verifier)).expect(403);
  });
});
