import { ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Database } from '../database/database.module';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AdminRecordsService } from './admin-records.service';
import { AdminOverseasController } from './admin.controllers';

/** The recorded stand-in database the other international specs use. */
function fakeDb(results: unknown[]) {
  const writes: { op: string; values: Record<string, unknown> }[] = [];
  const ops: string[] = [];
  const queue = [...results];
  const chain = (op: string | null): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          const value = op ? [{ affectedRows: 1 }] : queue.shift();
          return (resolve: (v: unknown) => void) => resolve(value);
        }
        if (prop === 'values' || prop === 'set') {
          return (values: Record<string, unknown>) => {
            writes.push({ op: op ?? String(prop), values });
            return chain(op);
          };
        }
        if (prop === 'insert' || prop === 'update' || prop === 'delete') {
          return () => {
            ops.push(String(prop));
            return chain(String(prop));
          };
        }
        return () => chain(op);
      },
    });
  return { db: chain(null) as Database, writes, ops, queue };
}

const service = (db: Database) => new AdminRecordsService(db, {} as never, {} as never, {} as never);
const none = [{ n: 0 }];

describe('AdminRecordsService', () => {
  it('refuses to delete an enquiry that has candidates, and says what to do instead', async () => {
    const { db, ops } = fakeDb([[{ reference: 'IE-AAAAAA' }], [{ n: 2 }], none, none, none, none]);
    await expect(service(db).deleteEnquiry('e1')).rejects.toThrow(new ConflictException('This enquiry has candidates, vacancies, offers, placements or invoices, so it cannot be deleted. Close it instead.'));
    expect(ops).toEqual([]);
  });

  it('deletes an enquiry nothing hangs off', async () => {
    const { db, ops } = fakeDb([[{ reference: 'IE-AAAAAA' }], none, none, none, none, none]);
    await expect(service(db).deleteEnquiry('e1')).resolves.toEqual({ deleted: true, reference: 'IE-AAAAAA' });
    expect(ops).toEqual(['delete']);
  });

  it('404s an enquiry that does not exist', async () => {
    const { db } = fakeDb([[]]);
    await expect(service(db).deleteEnquiry('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never deletes an accepted offer', async () => {
    const { db, ops } = fakeDb([[{ reference: 'OF-AAAAAA', status: 'ACCEPTED' }]]);
    await expect(service(db).deleteOffer('o1')).rejects.toThrow('An accepted offer is a signed agreement and cannot be deleted.');
    expect(ops).toEqual([]);
  });

  it('deletes an offer still in review', async () => {
    const { db, ops } = fakeDb([[{ reference: 'OF-AAAAAA', status: 'PENDING_REVIEW' }]]);
    await expect(service(db).deleteOffer('o1')).resolves.toEqual({ deleted: true, reference: 'OF-AAAAAA' });
    expect(ops).toEqual(['delete']);
  });

  it('keeps an open welfare report', async () => {
    const { db } = fakeDb([[{ reference: 'WR-AAAAAA', status: 'OPEN' }]]);
    await expect(service(db).deleteWelfareReport('w1')).rejects.toThrow('Resolve this report before deleting it.');
  });

  it('refuses to delete a vacancy with applications, or a programme with sign-ups', async () => {
    const vacancy = fakeDb([[{ reference: 'VC-AAAAAA' }], [{ n: 1 }]]);
    await expect(service(vacancy.db).deleteVacancy('v1')).rejects.toThrow('This vacancy has applications, so it cannot be deleted. Close it instead.');
    const programme = fakeDb([[{ id: 'p1' }], [{ n: 3 }]]);
    await expect(service(programme.db).deleteProgramme('p1')).rejects.toThrow('Make it inactive instead');
  });

  it('will not sign a caregiver up twice', async () => {
    const { db } = fakeDb([[{ id: 'p1' }], [{ id: 'c1', deletedAt: null }], [{ id: 'existing' }]]);
    await expect(service(db).enrol('p1', { caregiverId: 'c1' })).rejects.toThrow('This caregiver is already signed up for this programme.');
  });
});

describe('AdminOverseasController', () => {
  const reflector = new Reflector();
  const roles = (method: keyof AdminOverseasController) => reflector.get<string[]>(ROLES_KEY, AdminOverseasController.prototype[method] as () => unknown);

  it('is admin-only, except signing a caregiver up for training', () => {
    const methods = Object.getOwnPropertyNames(AdminOverseasController.prototype).filter((m) => m !== 'constructor') as (keyof AdminOverseasController)[];
    expect(methods.length).toBeGreaterThan(10);
    for (const m of methods) expect(roles(m)).toEqual(m === 'enrol' ? ['ADMIN', 'STAFF'] : ['ADMIN']);
  });
});
