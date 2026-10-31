import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { SQL } from 'drizzle-orm';
import { PushService, SEND_CHUNK, fromBlocks, messagesFor } from './push.service';
import { RegisterDeviceDto } from './devices.controller';

const dialect = new MySqlDialect();
const render = (where: SQL) => dialect.sqlToQuery(where);

/**
 * A stand-in for the Drizzle client: each select answers with the next queued
 * rows; updates and inserts are recorded with their WHERE clause rendered to SQL.
 */
function fakeDb(selects: unknown[][] = []) {
  const updates: { set: Record<string, unknown>; where: { sql: string; params: unknown[] } }[] = [];
  const inserts: Record<string, unknown>[] = [];
  const rows = () => {
    const r = selects.shift() ?? [];
    return Object.assign(Promise.resolve(r), { limit: () => Promise.resolve(r) });
  };
  const db = {
    select: () => ({ from: () => ({ where: rows }) }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => {
          updates.push({ set, where: render(where) });
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return Promise.resolve();
      },
    }),
  };
  return { db, updates, inserts };
}

const config = (env: Record<string, string> = {}) => new ConfigService(env);
const branding = { companyName: async () => 'Vivanti Health' };

/** Expo's push service: answers each send with a ticket per message from `ticket`. */
function expo(ticket: (to: string, i: number) => unknown, receipts: Record<string, unknown> = {}) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const http = jest.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, headers: init.headers as Record<string, string> });
    const data = url.endsWith('/send') ? body.map((m: { to: string }, i: number) => ticket(m.to, i)) : receipts;
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  return { http, calls };
}

const device = (n: number, locale: 'en' | 'si' | 'ta' = 'en') => ({ expoPushToken: `ExponentPushToken[t${n}]`, locale });
const text = (lang: string) => ({ title: `{brand} ${lang}`, body: `Booking BK-1 (${lang})` });

function service(selects: unknown[][] = [], env: Record<string, string> = {}) {
  const fake = fakeDb(selects);
  const push = new PushService(fake.db as never, config(env), branding as never);
  return { push, ...fake };
}

describe('push notifications', () => {
  describe('the messages', () => {
    it('writes each phone’s push in that phone’s app language, names the company and carries the screen to open', () => {
      const out = messagesFor([device(1, 'si'), device(2, 'en')], text, '/bookings/b-1', 'Vivanti Health');
      expect(out).toEqual([
        { to: 'ExponentPushToken[t1]', title: 'Vivanti Health si', body: 'Booking BK-1 (si)', sound: 'default', channelId: 'default', data: { path: '/bookings/b-1' } },
        { to: 'ExponentPushToken[t2]', title: 'Vivanti Health en', body: 'Booking BK-1 (en)', sound: 'default', channelId: 'default', data: { path: '/bookings/b-1' } },
      ]);
    });

    it('takes a three-language notice in the phone’s language, falling back to English', () => {
      const blocks = [
        { lang: 'en' as const, heading: 'New shift', body: 'English' },
        { lang: 'ta' as const, heading: 'புதிய', body: 'Tamil' },
      ];
      expect(fromBlocks(blocks, 'ta')).toEqual({ title: 'புதிய', body: 'Tamil' });
      expect(fromBlocks(blocks, 'si')).toEqual({ title: 'New shift', body: 'English' });
    });
  });

  describe('sending', () => {
    it('sends nothing, and calls nobody, when the person has no phone registered', async () => {
      const { push } = service([[]]);
      const { http } = expo(() => ({ status: 'ok', id: 'x' }));
      push.http = http;
      expect(await push.send(['u-1'], text, '/home', 'test')).toBe(0);
      expect(http).not.toHaveBeenCalled();
    });

    it('does not even look when there is nobody to tell', async () => {
      const { push } = service([]);
      push.http = expo(() => ({ status: 'ok', id: 'x' })).http;
      expect(await push.send([null, undefined], text, '/home', 'test')).toBe(0);
    });

    it('sends in batches Expo accepts, and remembers each ticket for its receipt', async () => {
      const devices = Array.from({ length: SEND_CHUNK + 50 }, (_, i) => device(i));
      const { push } = service([devices]);
      const { http, calls } = expo((_, i) => ({ status: 'ok', id: `ticket-${calls.length}-${i}` }));
      push.http = http;

      expect(await push.send(['u-1', 'u-1', 'u-2'], text, '/home', 'test')).toBe(150);
      expect(calls.map((c) => c.body.length)).toEqual([100, 50]);
      expect(calls[0].url).toBe('https://exp.host/--/api/v2/push/send');
      expect(calls[0].headers.Authorization).toBeUndefined();
      expect(push.pendingReceipts).toBe(150);
    });

    it('sends the access token when the Expo project requires one', async () => {
      const { push } = service([[device(1)]], { EXPO_ACCESS_TOKEN: 'secret' });
      const { http, calls } = expo(() => ({ status: 'ok', id: 'x' }));
      push.http = http;
      await push.send(['u-1'], text, '/home', 'test');
      expect(calls[0].headers.Authorization).toBe('Bearer secret');
    });

    it('revokes a token Expo says is no longer registered, and only that one', async () => {
      const { push, updates } = service([[device(1), device(2)]]);
      push.http = expo((to) =>
        to.endsWith('[t1]') ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' },
      ).http;
      expect(await push.send(['u-1'], text, '/home', 'test')).toBe(1);
      expect(updates).toHaveLength(1);
      expect(updates[0].set.revokedAt).toBeInstanceOf(Date);
      expect(updates[0].where.params).toEqual(['ExponentPushToken[t1]']);
    });

    it('keeps a token that failed for another reason', async () => {
      const { push, updates } = service([[device(1)]]);
      push.http = expo(() => ({ status: 'error', message: 'too big', details: { error: 'MessageTooBig' } })).http;
      expect(await push.send(['u-1'], text, '/home', 'test')).toBe(0);
      expect(updates).toHaveLength(0);
    });

    it('never throws, whatever goes wrong - the WhatsApp or email send must not be affected', async () => {
      const { push } = service([[device(1)]]);
      push.http = jest.fn().mockRejectedValue(new Error('no network'));
      await expect(push.send(['u-1'], text, '/home', 'test')).resolves.toBe(0);

      const down = service([[device(1)]]);
      down.push.http = jest.fn(async () => new Response('busy', { status: 503 }));
      await expect(down.push.send(['u-1'], text, '/home', 'test')).resolves.toBe(0);

      const broken = new PushService({ select: () => { throw new Error('db down'); } } as never, config(), branding as never);
      expect(() => broken.notify(['u-1'], text, '/home', 'test')).not.toThrow();
      await expect(broken.send(['u-1'], text, '/home', 'test')).resolves.toBe(0);
    });

    it('sends nothing when push is switched off', async () => {
      const { push } = service([[device(1)]], { PUSH_ENABLED: 'false' });
      const { http } = expo(() => ({ status: 'ok', id: 'x' }));
      push.http = http;
      expect(await push.send(['u-1'], text, '/home', 'test')).toBe(0);
      expect(http).not.toHaveBeenCalled();
    });
  });

  describe('delivery receipts', () => {
    it('reads them once they are due, and revokes the phones that are gone', async () => {
      const { push, updates } = service([[device(1), device(2)]]);
      const { http, calls } = expo(
        (to) => ({ status: 'ok', id: to.endsWith('[t1]') ? 'r1' : 'r2' }),
        { r1: { status: 'error', details: { error: 'DeviceNotRegistered' } }, r2: { status: 'ok' } },
      );
      push.http = http;
      await push.send(['u-1'], text, '/home', 'test');
      const sentAt = Date.now();

      await push.checkReceipts(sentAt + 5 * 60_000);
      expect(calls).toHaveLength(1); // not due yet

      await push.checkReceipts(sentAt + 16 * 60_000);
      expect(calls[1].url).toBe('https://exp.host/--/api/v2/push/getReceipts');
      expect(calls[1].body.ids.sort()).toEqual(['r1', 'r2']);
      expect(updates.map((u) => u.where.params)).toEqual([['ExponentPushToken[t1]']]);
      expect(push.pendingReceipts).toBe(0);
    });
  });

  describe('phones', () => {
    it('registers a new phone for the person, in the app’s language', async () => {
      const { push, inserts } = service([[]]);
      const { id } = await push.register('u-1', { expoPushToken: 'ExponentPushToken[a]', platform: 'android', appVersion: '1.0.0', locale: 'si' });
      expect(inserts).toEqual([expect.objectContaining({ id, userId: 'u-1', expoPushToken: 'ExponentPushToken[a]', platform: 'android', locale: 'si', revokedAt: null })]);
    });

    it('moves a phone to whoever signs in on it now, and brings a revoked one back', async () => {
      const { push, updates, inserts } = service([[{ id: 'd-1' }]]);
      expect(await push.register('u-2', { expoPushToken: 'ExponentPushToken[a]', platform: 'ios' })).toEqual({ id: 'd-1' });
      expect(inserts).toHaveLength(0);
      expect(updates[0].set).toEqual(expect.objectContaining({ userId: 'u-2', revokedAt: null, locale: 'en' }));
      expect(updates[0].where.params).toEqual(['d-1']);
    });

    it('lets a person remove only their own phone', async () => {
      const { push, updates } = service();
      await push.revoke('u-1', 'd-9');
      expect(updates[0].where.sql).toMatch(/`user_id` = \?/);
      expect(updates[0].where.params).toEqual(['d-9', 'u-1']);
    });

    it('stops every phone of a person who signs out', async () => {
      const { push, updates } = service();
      await push.revokeAllForUser('u-1');
      expect(updates[0].where.sql).toMatch(/`user_id` = \?.*`revoked_at` is null/);
      expect(updates[0].where.params).toEqual(['u-1']);
    });

    it('accepts only Expo push tokens and the app’s platforms and languages', () => {
      const errors = (body: object) => validateSync(plainToInstance(RegisterDeviceDto, body)).map((e) => e.property);
      expect(errors({ expoPushToken: 'ExponentPushToken[abc]', platform: 'ios', locale: 'ta' })).toEqual([]);
      expect(errors({ expoPushToken: 'ExpoPushToken[abc]', platform: 'android' })).toEqual([]);
      expect(errors({ expoPushToken: 'fcm:abc', platform: 'android' })).toEqual(['expoPushToken']);
      expect(errors({ expoPushToken: 'ExponentPushToken[abc]', platform: 'web', locale: 'fr' })).toEqual(['platform', 'locale']);
    });
  });
});
