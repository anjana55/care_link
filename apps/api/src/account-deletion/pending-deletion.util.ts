import { ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { accountDeletionRequests } from '../database/schema';

export const PENDING_DELETION_MESSAGE =
  'This person asked to delete their account. To restore it, cancel the request in Account deletions.';

/**
 * Refuses a staff change that would bring back an account its owner asked to
 * delete - its status, or its sign-in - while the request is pending. Staff
 * restore it by cancelling the request, which puts everything back as it was;
 * otherwise the person could reappear in search while their login stays locked
 * and their data is about to be erased.
 */
export async function assertNoPendingDeletion(db: Database, who: { caregiverId: string } | { patientId: string }): Promise<void> {
  const column = 'caregiverId' in who ? accountDeletionRequests.caregiverId : accountDeletionRequests.patientId;
  const id = 'caregiverId' in who ? who.caregiverId : who.patientId;
  const [pending] = await db
    .select({ id: accountDeletionRequests.id })
    .from(accountDeletionRequests)
    .where(and(eq(column, id), eq(accountDeletionRequests.status, 'PENDING')))
    .limit(1);
  if (pending) throw new ConflictException(PENDING_DELETION_MESSAGE);
}
