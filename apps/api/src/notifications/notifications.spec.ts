import { greetingName, inQuietHours, notificationCategory, webPathFor, type TodoItem } from '@care-platform/shared';
import { NotificationsService, textFor } from './notifications.service';
import { daysBetween, sortTodos, TodosService } from './todos.service';
import { digestNotice, documentCheckedNotice, documentExpiryNotice, type ReminderLine } from './notification-messages';
import { announcementText } from './announcements.service';
import { byPerson, ReminderSweepService, type Candidate } from './reminder-sweep.service';
import { messagesFor } from '../push/push.service';

const UUID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('greeting name', () => {
  it('greets by the first word that is a name, not an initial or a title', () => {
    expect(greetingName('Kamala Perera')).toBe('Kamala');
    expect(greetingName('W.A. Kamala Perera')).toBe('Kamala');
    expect(greetingName('W. A. Kamala Perera')).toBe('Kamala');
    expect(greetingName('K Nimal Silva')).toBe('Nimal');
    expect(greetingName('Mrs. Kamala Perera')).toBe('Kamala');
    expect(greetingName('Dr Sunil Fernando')).toBe('Sunil');
    expect(greetingName('  කමලා  පෙරේරා ')).toBe('කමලා');
  });

  it('gives nothing to greet by when there is no name left', () => {
    expect(greetingName('W.A.')).toBeNull();
    expect(greetingName('')).toBeNull();
    expect(greetingName(null)).toBeNull();
  });
});

describe('notification paths', () => {
  it('maps every app path a notice carries to the right website page, by role', () => {
    expect(webPathFor(`/bookings/${UUID}/rate/abc_12`, 'PATIENT_GUARDIAN')).toBe(`/account/bookings/${UUID}/rate/abc_12`);
    expect(webPathFor(`/bookings/${UUID}`, 'PATIENT_GUARDIAN')).toBe('/account/bookings');
    expect(webPathFor('/care', 'PATIENT_GUARDIAN')).toBe('/account/bookings');
    expect(webPathFor(`/invoices/${UUID}`, 'PATIENT_GUARDIAN')).toBe(`/account/invoices/${UUID}`);
    expect(webPathFor('/invoices', 'PATIENT_GUARDIAN')).toBe('/account/invoices');
    expect(webPathFor(`/requests/${UUID}`, 'PATIENT_GUARDIAN')).toBe('/account/requests');
    expect(webPathFor('/notifications', 'PATIENT_GUARDIAN')).toBe('/account/notifications');

    expect(webPathFor('/shifts', 'CAREGIVER')).toBe('/caregiver/shifts');
    expect(webPathFor('/payments', 'CAREGIVER')).toBe('/caregiver/payments');
    expect(webPathFor('/me/ratings', 'CAREGIVER')).toBe('/caregiver/ratings');
    expect(webPathFor('/documents', 'CAREGIVER')).toBe('/caregiver/documents');
    expect(webPathFor(`/requests/${UUID}`, 'CAREGIVER')).toBe('/caregiver/dashboard');
    expect(webPathFor('/notifications', 'CAREGIVER')).toBe('/caregiver/notifications');
    // A caregiver never lands on a client's page, whatever the path.
    expect(webPathFor(`/invoices/${UUID}`, 'CAREGIVER')).toBe('/caregiver/notifications');
    // Nothing odd gets through to a page.
    expect(webPathFor('/invoices/../../admin', 'PATIENT_GUARDIAN')).toBe('/account/invoices');
  });

  it('files each path under a category', () => {
    expect(notificationCategory(`/bookings/${UUID}/rate/x`)).toBe('REVIEW');
    expect(notificationCategory('/me/ratings')).toBe('REVIEW');
    expect(notificationCategory(`/bookings/${UUID}`)).toBe('BOOKING');
    expect(notificationCategory('/shifts')).toBe('BOOKING');
    expect(notificationCategory(`/requests/${UUID}`)).toBe('REQUEST');
    expect(notificationCategory(`/invoices/${UUID}`)).toBe('INVOICE');
    expect(notificationCategory('/payments')).toBe('PAYOUT');
    expect(notificationCategory('/care')).toBe('CARE');
    expect(notificationCategory('/documents')).toBe('DOCUMENT');
    expect(notificationCategory('/somewhere')).toBe('OTHER');
  });

  it('knows quiet hours, including ones that run past midnight', () => {
    const s = { quietStartHour: 21, quietEndHour: 7 };
    expect([20, 21, 23, 0, 6, 7].map((h) => inQuietHours(h, s))).toEqual([false, true, true, true, true, false]);
    expect([12, 13, 14].map((h) => inQuietHours(h, { quietStartHour: 13, quietEndHour: 14 }))).toEqual([false, true, false]);
    expect(inQuietHours(3, { quietStartHour: 5, quietEndHour: 5 })).toBe(false);
  });
});

describe('NotificationsService', () => {
  function service() {
    const inserts: any[] = [];
    const db = {
      insert: () => ({ values: async (rows: any[]) => void inserts.push(...rows) }),
      select: () => {
        const q: any = { from: () => q, where: () => q, groupBy: async () => [{ userId: 'u-1', n: 2 }] };
        return q;
      },
    };
    const push = { notify: jest.fn() };
    const s = new NotificationsService(db as never, push as never);
    return { s, inserts, push };
  }

  it('keeps the notice in all three languages for each person, then pushes with their badge and the row to mark read', async () => {
    const { s, inserts, push } = service();
    s.setTodoCounter(async (userId) => (userId === 'u-1' ? 3 : 0));
    const build = (lang: 'en' | 'si' | 'ta') => ({ title: `T-${lang}`, body: `B-${lang} {brand}` });
    const written = await s.deliver(['u-1', 'u-1', null, 'u-2'], build, '/invoices/' + UUID, 'test');

    expect(inserts).toHaveLength(2);
    expect(inserts.map((r) => r.userId)).toEqual(['u-1', 'u-2']);
    expect(inserts[0]).toMatchObject({ category: 'INVOICE', path: '/invoices/' + UUID, important: false });
    expect(inserts[0].text).toEqual({ en: { title: 'T-en', body: 'B-en {brand}' }, si: { title: 'T-si', body: 'B-si {brand}' }, ta: { title: 'T-ta', body: 'B-ta {brand}' } });

    const [ids, , path, , extras] = push.notify.mock.calls[0];
    expect(ids).toEqual(['u-1', 'u-2']);
    expect(path).toBe('/invoices/' + UUID);
    expect(extras.get('u-1')).toEqual({ notificationId: written.get('u-1'), badge: 5 }); // 2 unread + 3 to-dos
    expect(extras.get('u-2')).toEqual({ notificationId: written.get('u-2'), badge: 0 });
  });

  it('can keep a notice in the bell without a push', async () => {
    const { s, inserts, push } = service();
    await s.deliver(['u-1'], () => ({ title: 'a', body: 'b' }), '/notifications', 'quiet', { push: false, category: 'REMINDER' });
    expect(inserts[0].category).toBe('REMINDER');
    expect(push.notify).not.toHaveBeenCalled();
  });

  it('still pushes when the database is down', async () => {
    const push = { notify: jest.fn() };
    const db = {
      insert: () => ({ values: async () => Promise.reject(new Error('gone')) }),
      select: () => {
        throw new Error('gone');
      },
    };
    const s = new NotificationsService(db as never, push as never);
    const written = await s.deliver(['u-1'], () => ({ title: 'a', body: 'b' }), '/shifts', 'x');
    expect(written.size).toBe(0);
    expect(push.notify).toHaveBeenCalledTimes(1);
  });

  it('falls back to English for a language whose text could not be built', () => {
    const t = textFor((lang) => {
      if (lang === 'ta') throw new Error('no Tamil');
      return { title: `T-${lang}`, body: 'b' };
    });
    expect(t?.ta).toEqual({ title: 'T-en', body: 'b' });
    expect(t?.si.title).toBe('T-si');
  });
});

describe('push extras', () => {
  it('puts each person’s badge and notification id on their own phones only', () => {
    const devices = [
      { expoPushToken: 'a', locale: 'en' as const, userId: 'u-1' },
      { expoPushToken: 'b', locale: 'si' as const, userId: 'u-2' },
    ];
    const out = messagesFor(devices, () => ({ title: 't', body: 'b' }), '/shifts', 'X', new Map([['u-1', { badge: 4, notificationId: 'n-1' }]]));
    expect(out[0]).toMatchObject({ to: 'a', badge: 4, data: { path: '/shifts', notificationId: 'n-1' } });
    expect(out[1]).toEqual({ to: 'b', title: 't', body: 'b', sound: 'default', channelId: 'default', data: { path: '/shifts' } });
  });
});

describe('To do', () => {
  const todo = (key: string, urgent: boolean, dueOn: string | null): TodoItem => ({ key, kind: 'PAY_INVOICE', path: '/x', urgent, dueOn, params: {} });

  it('puts urgent things first, then the soonest due', () => {
    const sorted = sortTodos([todo('a', false, null), todo('b', false, '2026-11-09'), todo('c', true, '2026-11-20'), todo('d', false, '2026-11-05')]);
    expect(sorted.map((t) => t.key)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('counts days between Colombo dates', () => {
    expect(daysBetween('2026-11-04', '2026-11-04')).toBe(0);
    expect(daysBetween('2026-11-04', '2026-12-04')).toBe(30);
    expect(daysBetween('2026-11-04', '2026-11-01')).toBe(-3);
  });

  /** Each select answers with the next queued rows. */
  function fakeDb(selects: unknown[][]) {
    const query = (): any => {
      const q: any = { from: () => q, innerJoin: () => q, where: () => q, orderBy: () => q, limit: () => Promise.resolve(selects.shift() ?? []) };
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(selects.shift() ?? []).then(res, rej);
      return q;
    };
    return { select: query };
  }
  const todos = (selects: unknown[][]) => new TodosService(fakeDb(selects) as never, {} as never, {} as never, { setTodoCounter: () => undefined } as never);
  const NOW = new Date('2026-11-04T06:00:00Z'); // 11:30 in Colombo

  it('lists issued invoices with something still owed, and marks overdue ones urgent', async () => {
    const out = await todos([
      [
        { id: 'i-1', number: 'INV-1', total: '10000.00', amountPaid: '0.00', dueDate: '2026-11-01' },
        { id: 'i-2', number: 'INV-2', total: '5000.00', amountPaid: '5000.00', dueDate: '2026-11-10' },
        { id: 'i-3', number: 'INV-3', total: '8000.00', amountPaid: '3000.00', dueDate: '2026-11-10' },
      ],
    ]).invoicesToPay('p-1', NOW);
    expect(out.map((t) => [t.key, t.urgent, t.params.overdue])).toEqual([
      ['invoice:i-1', true, 1],
      ['invoice:i-3', false, 0],
    ]);
    expect(out[1].params.amount).toContain('5,000');
    expect(out[1].path).toBe('/invoices/i-3');
  });

  it('asks for each missing core document, flags a rejected one, and warns about expiry within 30 days', async () => {
    const out = await todos([
      [
        { id: 'd-1', type: 'NIC', status: 'VERIFIED', expiresOn: null, createdAt: NOW },
        { id: 'd-2', type: 'POLICE_CLEARANCE', status: 'REJECTED', expiresOn: null, createdAt: NOW },
        { id: 'd-3', type: 'PASSPORT', status: 'VERIFIED', expiresOn: '2026-11-20', createdAt: NOW },
      ],
    ]).documents('c-1', NOW);
    expect(out.map((t) => [t.kind, t.params.document, t.urgent])).toEqual([
      ['DOCUMENT_REJECTED', 'police', true],
      ['UPLOAD_DOCUMENT', 'gn', false],
      ['DOCUMENT_EXPIRING', 'PASSPORT', false],
    ]);
    expect(out[2].params.daysLeft).toBe(16);
  });

  it("doesn't ask about care before the evening", async () => {
    const carePlans = { openCountForPatient: jest.fn(async () => 3) };
    const t = new TodosService({} as never, carePlans as never, {} as never, { setTodoCounter: () => undefined } as never);
    expect(await t.careToTick('p-1', NOW)).toEqual([]);
    const evening = new Date('2026-11-04T13:00:00Z'); // 18:30 in Colombo
    expect(await t.careToTick('p-1', evening)).toEqual([expect.objectContaining({ kind: 'TICK_OFF_CARE', params: { count: 3 }, path: '/care' })]);
  });

  it('only lists ratings that can still be given', async () => {
    const reviews = {
      pending: async () => [
        { bookingId: 'b-1', bookingReference: 'BK-1', caregiverPublicId: 'p1', isCover: false, reviewUntil: '2026-12-01T00:00:00.000Z', canReview: true },
        { bookingId: 'b-2', bookingReference: 'BK-2', caregiverPublicId: 'p2', isCover: true, reviewUntil: '2026-12-01T00:00:00.000Z', canReview: false },
      ],
    };
    const t = new TodosService({} as never, {} as never, reviews as never, { setTodoCounter: () => undefined } as never);
    const out = await t.caregiversToRate({ userId: 'u', role: 'PATIENT_GUARDIAN', patientId: 'p', email: null });
    expect(out).toEqual([
      { key: 'review:b-1:p1', kind: 'RATE_CAREGIVER', path: '/bookings/b-1/rate/p1', urgent: false, dueOn: '2026-12-01', params: { reference: 'BK-1', cover: 0 } },
    ]);
  });
});

describe('messages', () => {
  const line = (kind: ReminderLine['kind'], params: TodoItem['params'], dueOn: string | null = null): ReminderLine => ({
    kind,
    todo: { key: kind, kind: 'PAY_INVOICE', path: '/x', urgent: false, dueOn, params },
  });

  it('writes one reminder, or a digest of several, in each language', () => {
    const one = digestNotice([line('INVOICE_DUE', { number: 'INV-7', amount: 'LKR 12,500.00' }, '2026-11-05')], 'en');
    expect(one.title).toBe('A reminder from {brand}');
    expect(one.body).toBe('Pay invoice INV-7 (LKR 12,500.00) by 2026-11-05.');

    const lines = [line('DOCUMENT_REJECTED', { document: 'police' }), line('SHIFT_TODAY', { time: '08:00', reference: 'BK-3' })];
    const en = digestNotice(lines, 'en');
    expect(en.title).toBe('You have 2 things to do');
    expect(en.lines).toEqual(['Upload your police clearance certificate again - the last one could not be accepted.', 'You have a shift today at 08:00 (BK-3).']);
    for (const lang of ['si', 'ta'] as const) {
      const t = digestNotice(lines, lang);
      expect(t.title).toContain('2');
      expect(t.body).toContain('08:00');
      expect(t.body).not.toContain('{');
      expect(t.body).not.toBe(en.body);
    }
  });

  it('names documents in the reader’s language', () => {
    expect(documentCheckedNotice('REJECTED', 'POLICE_CLEARANCE', 'en').body).toContain('police clearance certificate');
    expect(documentCheckedNotice('VERIFIED', 'NIC', 'si').body).toContain('ජාතික හැඳුනුම්පත');
    expect(documentExpiryNotice(true, 'PASSPORT', '2026-11-01', 'ta').body).toContain('கடவுச்சீட்டு');
    expect(documentExpiryNotice(false, 'UNKNOWN', '2026-12-01', 'en').body).toBe('Your document expires on 2026-12-01. Please upload the renewed one.');
  });

  it('fills an announcement’s empty Sinhala and Tamil from the English', () => {
    const t = announcementText({ en: { title: 'Holiday', body: 'Closed Monday' }, si: { title: 'නිවාඩු', body: '' }, ta: undefined });
    expect(t.si).toEqual({ title: 'නිවාඩු', body: 'Closed Monday' });
    expect(t.ta).toEqual({ title: 'Holiday', body: 'Closed Monday' });
  });
});

describe('reminders', () => {
  const c = (userId: string, key: string, kind: ReminderLine['kind'] = 'INVOICE_DUE'): Candidate => ({
    userId,
    stage: 'DUE_SOON',
    line: { kind, todo: { key, kind: 'PAY_INVOICE', path: `/invoices/${key}`, urgent: false, dueOn: '2026-11-05', params: { number: key, amount: 'LKR 1.00' } } },
  });

  it('groups what is due by person', () => {
    const g = byPerson([c('u-1', 'a'), c('u-2', 'b'), c('u-1', 'c')]);
    expect([...g.keys()]).toEqual(['u-1', 'u-2']);
    expect(g.get('u-1')!.map((x) => x.line.todo.key)).toEqual(['a', 'c']);
  });

  /** A sweep over a fake database: `sent` is what reminder_sends already holds, `today` how many messages went today. */
  function sweep(opts: { sent?: { itemKey: string; stage: string }[]; today?: number; duplicate?: string[] }) {
    const locks: { itemKey: string; stage: string }[] = [];
    let selects = 0;
    const db = {
      select: () => {
        const n = selects++;
        const q: any = { from: () => q, where: () => q, innerJoin: () => q, orderBy: () => q, limit: () => Promise.resolve([]) };
        q.then = (res: (v: unknown) => unknown) => Promise.resolve(n === 0 ? (opts.sent ?? []) : [{ n: opts.today ?? 0 }]).then(res);
        return q;
      },
      insert: () => ({
        values: async (v: { itemKey: string; stage: string }) => {
          if (opts.duplicate?.includes(v.itemKey)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
          locks.push({ itemKey: v.itemKey, stage: v.stage });
        },
      }),
    };
    const notices = { notify: jest.fn() };
    const s = new ReminderSweepService(db as never, { get: () => undefined } as never, notices as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    // The usual channel is checked separately; here only the bell and push matter.
    (s as any).usualChannel = jest.fn(async () => undefined);
    return { s, locks, notices };
  }
  const settings = { remindersEnabled: true, quietStartHour: 21, quietEndHour: 7, dailyReminderCap: 2, retentionDays: 180 };

  it('sends several reminders as one digest that opens the bell, and locks each item', async () => {
    const { s, locks, notices } = sweep({});
    expect(await s.remind('u-1', [c('u-1', 'a'), c('u-1', 'b')], settings)).toBe(true);
    expect(locks.filter((l) => l.stage === 'DUE_SOON').map((l) => l.itemKey)).toEqual(['a', 'b']);
    expect(locks.filter((l) => l.stage === 'MESSAGE')).toHaveLength(1);
    const [ids, build, path, , opts] = notices.notify.mock.calls[0];
    expect(ids).toEqual(['u-1']);
    expect(path).toBe('/notifications');
    expect(opts).toEqual({ category: 'REMINDER' });
    expect(build('en').title).toBe('You have 2 things to do');
    expect((s as any).usualChannel).toHaveBeenCalledTimes(1);
  });

  it('opens the thing itself when there is one reminder', async () => {
    const { s, notices } = sweep({});
    await s.remind('u-1', [c('u-1', 'a')], settings);
    expect(notices.notify.mock.calls[0][2]).toBe('/invoices/a');
  });

  it('never sends the same reminder twice', async () => {
    const { s, notices } = sweep({ sent: [{ itemKey: 'a', stage: 'DUE_SOON' }] });
    expect(await s.remind('u-1', [c('u-1', 'a')], settings)).toBe(false);
    expect(notices.notify).not.toHaveBeenCalled();
  });

  it('stops at the daily cap', async () => {
    const { s, notices, locks } = sweep({ today: 2 });
    expect(await s.remind('u-1', [c('u-1', 'a')], settings)).toBe(false);
    expect(notices.notify).not.toHaveBeenCalled();
    expect(locks).toEqual([]);
  });

  it('leaves out an item another run has just locked', async () => {
    const { s, notices } = sweep({ duplicate: ['a'] });
    expect(await s.remind('u-1', [c('u-1', 'a'), c('u-1', 'b')], settings)).toBe(true);
    expect(notices.notify.mock.calls[0][1]('en').body).toBe('Pay invoice b (LKR 1.00) by 2026-11-05.');
  });

  it('uses the usual channel only for money and document problems', async () => {
    const { s } = sweep({});
    const shift: Candidate = { ...c('u-1', 'shiftday:x', 'SHIFT_TODAY'), stage: 'TODAY:x' };
    await s.remind('u-1', [shift], settings);
    expect((s as any).usualChannel).not.toHaveBeenCalled();
  });

  it('does nothing in quiet hours or when reminders are off', async () => {
    const settingsService = { getResolved: async () => settings };
    const notices = { deleteOlderThan: jest.fn(async () => 0) };
    const db = { delete: () => ({ where: async () => undefined }) };
    const s = new ReminderSweepService(db as never, { get: () => undefined } as never, notices as never, settingsService as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const spy = jest.spyOn(s, 'invoicesDueTomorrow');
    expect(await s.tick(new Date('2026-11-04T17:00:00Z'))).toEqual({ messages: 0, staff: 0, deleted: 0 }); // 22:30 Colombo
    expect(spy).not.toHaveBeenCalled();
    expect(notices.deleteOlderThan).toHaveBeenCalledWith(180, expect.any(Date)); // housekeeping still runs
  });
});
