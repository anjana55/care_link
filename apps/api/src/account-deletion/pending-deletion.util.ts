import { ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { accountDeletionRequests } from '../database/schema';

export const PENDING_DELETION_MESSAGE =
  'This person asked to delete their account. To restore it, cancel the request in Account deletions.';

/** Staff deleting a record whose owner asked to be deleted, while something of theirs is still open. */
export const PENDING_DELETION_OPEN_ITEMS_MESSAGE =
  'This person asked to delete their account, and something of theirs is still open. Settle it first - see Account deletions - or leave it: the account is erased once nothing is open.';

/** Cancelling a request whose caregiver or client record staff have already deleted. */
export const PENDING_DELETION_RECORD_DELETED_MESSAGE =
  'This record has been deleted, so there is nothing to restore.';

type Who = { caregiverId: string } | { patientId: string };

const whereOpen = (who: Who) =>
  and(
    'caregiverId' in who ? eq(accountDeletionRequests.caregiverId, who.caregiverId) : eq(accountDeletionRequests.patientId, who.patientId),
    eq(accountDeletionRequests.status, 'PENDING'),
  );

/**
 * Refuses a staff change that would bring back an account its owner asked to
 * delete - its status, or its sign-in - while the request is pending. Staff
 * restore it by cancelling the request, which puts everything back as it was;
 * otherwise the person could reappear in search while their login stays locked
 * and their data is about to be erased.
 */
export async function assertNoPendingDeletion(db: Database, who: Who): Promise<void> {
  const [pending] = await db.select({ id: accountDeletionRequests.id }).from(accountDeletionRequests).where(whereOpen(who)).limit(1);
  if (pending) throw new ConflictException(PENDING_DELETION_MESSAGE);
}

/**
 * Closes the person's pending request as erased, for a delete that removes
 * them outright (a client's record and login are deleted, not kept). Without
 * it the request stayed in the Account deletions queue, pointing at a record
 * that no longer opens. Returns whether there was one.
 */
export async function closePendingDeletionAsErased(db: Database, who: Who, now = new Date()): Promise<boolean> {
  const [pending] = await db.select({ id: accountDeletionRequests.id }).from(accountDeletionRequests).where(whereOpen(who)).limit(1);
  if (!pending) return false;
  await db
    .update(accountDeletionRequests)
    .set({ status: 'ERASED', erasedAt: now, updatedAt: now })
    .where(eq(accountDeletionRequests.id, pending.id));
  return true;
}
