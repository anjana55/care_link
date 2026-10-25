import { BadRequestException } from '@nestjs/common';
import { AUTO_NOTIFY_NEEDS_WRITTEN_CHANNEL, CaregiversService } from './caregivers.service';
import { caregivers } from '../database/schema';
import type { Database } from '../database/database.module';

/**
 * Auto-notify messages a caregiver in writing the moment a client asks for
 * them; a caregiver who prefers phone calls is rung by staff instead. The two
 * must never be on together, and getting there must not make an ordinary
 * profile save fail.
 *
 * Exercised through a stubbed database, as in caregiver-location-write.spec:
 * what matters is the SET payload update() builds.
 */
describe('CaregiversService auto-notify vs phone-call preference', () => {
  function stubDb(current: { preferredContactMethod: string | null; autoNotifyRequests: boolean }) {
    const updates: Record<string, unknown>[] = [];
    const ROW = { id: 'cg-1', deletedAt: null, ...current };

    const makeChain = (): Record<string, unknown> => {
      let rows: unknown[] = [];
      const chain: Record<string, unknown> = {
        select: () => makeChain(),
        from: (table: unknown) => {
          rows = table === caregivers ? [ROW] : [];
          return chain;
        },
        where: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(rows),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    };

    const db = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop !== 'update') return () => makeChain();
          return () => {
            const c: Record<string, unknown> = {
              set: (values: Record<string, unknown>) => {
                updates.push(values);
                return c;
              },
              where: () => Promise.resolve([]),
            };
            return c;
          };
        },
      },
    ) as unknown as Database;

    return { service: new CaregiversService(db, { record: async () => undefined } as never), updates };
  }

  it('refuses to turn auto-notify on for a caregiver who prefers phone calls', async () => {
    const { service, updates } = stubDb({ preferredContactMethod: 'PHONE_CALL', autoNotifyRequests: false });
    await expect(service.update('cg-1', { autoNotifyRequests: true })).rejects.toThrow(new BadRequestException(AUTO_NOTIFY_NEEDS_WRITTEN_CHANNEL));
    expect(updates).toEqual([]);
  });

  it('refuses both at once in a single save', async () => {
    const { service } = stubDb({ preferredContactMethod: 'EMAIL', autoNotifyRequests: false });
    await expect(service.update('cg-1', { preferredContactMethod: 'PHONE_CALL', autoNotifyRequests: true })).rejects.toThrow(BadRequestException);
  });

  it('switches auto-notify off, instead of failing, when the preference changes to phone call', async () => {
    const { service, updates } = stubDb({ preferredContactMethod: 'WHATSAPP', autoNotifyRequests: true });
    await service.update('cg-1', { preferredContactMethod: 'PHONE_CALL' });
    expect(updates).toEqual([expect.objectContaining({ preferredContactMethod: 'PHONE_CALL', autoNotifyRequests: false })]);
  });

  it('lets auto-notify be turned on once the preference is a written channel', async () => {
    const { service, updates } = stubDb({ preferredContactMethod: 'PHONE_CALL', autoNotifyRequests: false });
    await service.update('cg-1', { preferredContactMethod: 'WHATSAPP', autoNotifyRequests: true });
    expect(updates).toEqual([expect.objectContaining({ preferredContactMethod: 'WHATSAPP', autoNotifyRequests: true })]);
  });

  it('leaves auto-notify alone for a caregiver with no preference set', async () => {
    const { service, updates } = stubDb({ preferredContactMethod: null, autoNotifyRequests: false });
    await service.update('cg-1', { autoNotifyRequests: true });
    expect(updates).toEqual([{ autoNotifyRequests: true }]);
  });
});
