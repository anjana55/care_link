import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, desc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import {
  ACCOUNT_DELETION_GRACE_DAYS,
  type AccountDeletionReceipt,
  type AccountOpenItems,
  type StaffAccountDeletion,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  accountDeletionRequests,
  availability,
  billingAdjustments,
  bookingShifts,
  bookings,
  caregiverDocuments,
  caregiverHealthInformation,
  caregiverLanguages,
  caregiverOverseasProfiles,
  caregivers,
  caregiverSkills,
  careRequests,
  deviceTokens,
  documentExpiryReminders,
  employerShortlist,
  experiences,
  invoices,
  OPEN_CARE_REQUEST_STATUSES,
  patients,
  payoutStatements,
  placements,
  preferredLocations,
  qualifications,
  references,
  refreshTokens,
  savedCaregivers,
  sharedProfiles,
  users,
  verifications,
  caregiverReviews,
  caregiverReviewBadges,
  caregiverRatingStats,
  reviewRequests,
} from '../database/schema';
import { releaseLogin } from '../account-access/identity.util';
import { AuditService } from '../audit/audit.service';
import { PushService } from '../push/push.service';
import { AccountDeletionNotifier } from './account-deletion.notifier';
import { PENDING_DELETION_OPEN_ITEMS_MESSAGE, PENDING_DELETION_RECORD_DELETED_MESSAGE } from './pending-deletion.util';
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.interface';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

type Request = typeof accountDeletionRequests.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
/** What an erased record is called, where the column can't be empty. */
export const ERASED_NAME = { CAREGIVER: 'Deleted caregiver', PATIENT_GUARDIAN: 'Deleted client', USER: 'Deleted account' } as const;
/** A date of birth that is plainly not one, for the NOT NULL column. */
const ERASED_BIRTH_DATE = new Date(Date.UTC(1900, 0, 1));

const NO_OPEN_ITEMS: AccountOpenItems = {
  upcomingShifts: 0,
  unpaidPayouts: 0,
  activePlacements: 0,
  activeBookings: 0,
  unpaidInvoices: 0,
  openCareRequests: 0,
  openAdjustments: 0,
};

/**
 * "Delete my account", which both app stores require of an app people can
 * sign up in.
 *
 * - **Asking** locks the account at once: signed out everywhere, unable to
 *   sign in again, push stopped, and the caregiver or client set INACTIVE
 *   (so a caregiver leaves search and any shared profile link).
 * - **Staff can cancel** within the grace period, which puts it all back.
 * - **Erasure** (eraseDue, hourly) comes after ACCOUNT_DELETION_GRACE_DAYS,
 *   once nothing is open - shifts to work, payouts, bookings, invoices, care
 *   requests, an active placement abroad. Those wait for staff, so nobody is
 *   left unpaid or a booking without its contact.
 *
 * Erasure is in place: the rows stay so bookings, invoices, payouts, care
 * records and the audit log keep their references, but the person's name,
 * contact details, IDs, address, documents and files go, and the login is
 * taken apart. Invoices keep the bill-to details printed on them: they are
 * tax records. Records of what happened abroad (offers, placements, welfare
 * reports, certificates issued) are kept for the same reason.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly push: PushService,
    private readonly notifier: AccountDeletionNotifier,
  ) {}

  // --- the person ---------------------------------------------------------------

  async request(user: AuthenticatedUser, ipAddress: string | null, now = new Date()): Promise<AccountDeletionReceipt> {
    const role = user.role;
    if (role !== 'CAREGIVER' && role !== 'PATIENT_GUARDIAN') {
      throw new ForbiddenException('Only caregiver and client accounts can be deleted here. Please contact us.');
    }
    const caregiverId = role === 'CAREGIVER' ? (user.caregiverId ?? null) : null;
    const patientId = role === 'PATIENT_GUARDIAN' ? (user.patientId ?? null) : null;

    const receipt = await this.db.transaction(async (tx) => {
      // Already asked (a double tap, or the website after the app): the same answer.
      const [existing] = await tx
        .select()
        .from(accountDeletionRequests)
        .where(and(eq(accountDeletionRequests.userId, user.userId), eq(accountDeletionRequests.status, 'PENDING')))
        .limit(1);
      if (existing) return { id: existing.id, eraseAfter: existing.eraseAfter.toISOString(), created: false };

      let previousStatus: string | null = null;
      if (caregiverId) {
        const [c] = await tx.select({ status: caregivers.status }).from(caregivers).where(eq(caregivers.id, caregiverId)).limit(1);
        previousStatus = c?.status ?? null;
        await tx.update(caregivers).set({ status: 'INACTIVE' }).where(eq(caregivers.id, caregiverId));
      } else if (patientId) {
        const [p] = await tx.select({ status: patients.status }).from(patients).where(eq(patients.id, patientId)).limit(1);
        previousStatus = p?.status ?? null;
        await tx.update(patients).set({ status: 'INACTIVE' }).where(eq(patients.id, patientId));
      }

      const eraseAfter = new Date(now.getTime() + ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
      const id = uuid();
      await tx.insert(accountDeletionRequests).values({
        id,
        userId: user.userId,
        role,
        caregiverId,
        patientId,
        status: 'PENDING',
        requestedAt: now,
        eraseAfter,
        previousStatus,
      });
      // Locked: the next request with any token is refused (JwtStrategy checks isActive).
      await tx.update(users).set({ isActive: false }).where(eq(users.id, user.userId));
      await tx.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, user.userId));
      return { id, eraseAfter: eraseAfter.toISOString(), created: true };
    });

    if (receipt.created) {
      await this.push.revokeAllForUser(user.userId);
      const r = { id: receipt.id, userId: user.userId, role, caregiverId, patientId };
      await this.record(r, 'REQUEST_ACCOUNT_DELETION', user.userId, ipAddress, { eraseAfter: receipt.eraseAfter });
      // Staff hear about it at once, not just from the record turning Inactive. Not awaited: email is slow, and best-effort.
      void this.alertStaff(r, now, new Date(receipt.eraseAfter));
    }
    return { eraseAfter: receipt.eraseAfter };
  }

  /**
   * An audit entry about the caregiver or client record - where staff look,
   * on its Audit tab - naming the login and the request in the details.
   */
  private record(
    r: Pick<Request, 'id' | 'userId' | 'role' | 'caregiverId' | 'patientId'>,
    action: 'REQUEST_ACCOUNT_DELETION' | 'CANCEL_ACCOUNT_DELETION' | 'ERASE_ACCOUNT',
    by: string | null,
    ipAddress: string | null,
    metadata: Record<string, unknown> = {},
  ) {
    const entity = r.caregiverId
      ? { entityType: 'Caregiver', entityId: r.caregiverId }
      : r.patientId
        ? { entityType: 'Patient', entityId: r.patientId }
        : { entityType: 'User', entityId: r.userId };
    return this.audit.record({ userId: by, action, ...entity, metadata: { ...metadata, accountUserId: r.userId, requestId: r.id, role: r.role }, ipAddress });
  }

  private async alertStaff(r: Pick<Request, 'userId' | 'role' | 'caregiverId' | 'patientId'>, requestedAt: Date, eraseAfter: Date) {
    try {
      const [who] = await this.db.select({ fullName: users.fullName, email: users.email, phone: users.phone }).from(users).where(eq(users.id, r.userId)).limit(1);
      const [cg] = r.caregiverId
        ? await this.db.select({ registrationNumber: caregivers.registrationNumber }).from(caregivers).where(eq(caregivers.id, r.caregiverId)).limit(1)
        : [];
      await this.notifier.requested({
        role: r.role as 'CAREGIVER' | 'PATIENT_GUARDIAN',
        name: who?.fullName ?? null,
        reference: cg?.registrationNumber ?? who?.email ?? who?.phone ?? null,
        requestedAt,
        eraseAfter,
        openItems: await this.openItems(r, requestedAt),
      });
    } catch (err) {
      this.logger.warn(`Account deletion request: staff alert failed - ${(err as Error).message}`);
    }
  }

  // --- staff --------------------------------------------------------------------

  /** For the staff app's sidebar badge. */
  async summary(): Promise<{ pending: number }> {
    const [row] = await this.db.select({ n: sql<number>`count(*)` }).from(accountDeletionRequests).where(eq(accountDeletionRequests.status, 'PENDING'));
    return { pending: Number(row?.n ?? 0) };
  }

  /** Pending requests first (soonest erasure first), then the last 90 days of cancelled and erased ones. */
  async list(now = new Date()): Promise<StaffAccountDeletion[]> {
    const rows = await this.db
      .select({
        r: accountDeletionRequests,
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
        registrationNumber: caregivers.registrationNumber,
        caregiverDeletedAt: caregivers.deletedAt,
        patientRowId: patients.id,
      })
      .from(accountDeletionRequests)
      .leftJoin(users, eq(users.id, accountDeletionRequests.userId))
      .leftJoin(caregivers, eq(caregivers.id, accountDeletionRequests.caregiverId))
      .leftJoin(patients, eq(patients.id, accountDeletionRequests.patientId))
      .where(
        or(
          eq(accountDeletionRequests.status, 'PENDING'),
          gt(accountDeletionRequests.updatedAt, new Date(now.getTime() - 90 * DAY_MS)),
        ),
      )
      .orderBy(sql`${accountDeletionRequests.status} = 'PENDING' DESC`, accountDeletionRequests.eraseAfter, desc(accountDeletionRequests.updatedAt));

    return Promise.all(
      rows.map(async ({ r, fullName, email, phone, registrationNumber, caregiverDeletedAt, patientRowId }) => {
        const erased = r.status === 'ERASED';
        return {
          id: r.id,
          role: r.role,
          status: r.status,
          name: erased ? null : (fullName ?? null),
          reference: erased ? null : (registrationNumber ?? email ?? phone ?? null),
          caregiverId: r.caregiverId,
          patientId: r.patientId,
          requestedAt: r.requestedAt.toISOString(),
          eraseAfter: r.eraseAfter.toISOString(),
          cancelledAt: r.cancelledAt?.toISOString() ?? null,
          erasedAt: r.erasedAt?.toISOString() ?? null,
          openItems: r.status === 'PENDING' ? await this.openItems(r, now) : null,
          recordDeleted: !erased && isRecordDeleted(r, caregiverDeletedAt, patientRowId),
        };
      }),
    );
  }

  /** Staff, before erasure: the account comes back exactly as it was. */
  async cancel(id: string, staffUserId: string, ipAddress: string | null, now = new Date()) {
    const cancelled = await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, id)).limit(1);
      if (!r) throw new NotFoundException('Deletion request not found');
      if (r.status !== 'PENDING') throw new ConflictException(r.status === 'ERASED' ? 'This account has already been erased.' : 'This request was already cancelled.');
      // Staff deleted the record while this waited (before that closed the request too): turning
      // the login back on would bring back an account with no record and no email or phone.
      const [cg] = r.caregiverId ? await tx.select({ deletedAt: caregivers.deletedAt }).from(caregivers).where(eq(caregivers.id, r.caregiverId)).limit(1) : [];
      const [pt] = r.patientId ? await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, r.patientId)).limit(1) : [];
      if (isRecordDeleted(r, cg?.deletedAt ?? null, pt?.id ?? null, Boolean(cg))) throw new ConflictException(PENDING_DELETION_RECORD_DELETED_MESSAGE);
      await tx
        .update(accountDeletionRequests)
        .set({ status: 'CANCELLED', cancelledAt: now, cancelledByUserId: staffUserId, updatedAt: now })
        .where(eq(accountDeletionRequests.id, id));
      await tx.update(users).set({ isActive: true }).where(eq(users.id, r.userId));
      if (r.caregiverId && r.previousStatus) {
        await tx.update(caregivers).set({ status: r.previousStatus as never }).where(eq(caregivers.id, r.caregiverId));
      }
      if (r.patientId && r.previousStatus) {
        await tx.update(patients).set({ status: r.previousStatus as never }).where(eq(patients.id, r.patientId));
      }
      return r;
    });
    await this.record(cancelled, 'CANCEL_ACCOUNT_DELETION', staffUserId, ipAddress, { restoredStatus: cancelled.previousStatus });
    return { success: true };
  }

  /**
   * Staff deleting a caregiver who has already asked to delete their account.
   *
   * The usual staff delete is a soft delete: it keeps the name, NIC, address
   * and documents on the record for the audit history. For someone who asked
   * to be deleted that is the opposite of what they asked for, and it left
   * their request waiting in Account deletions with a link to a record that
   * no longer opens. So the request is carried out now instead: erased exactly
   * as at the end of the grace period, and closed.
   *
   * Refused while something is still open, for the reason erasure waits for
   * it (nobody left unpaid, no shift without its caregiver).
   *
   * Returns false when no request is pending, so the usual delete goes ahead.
   */
  async eraseCaregiverForStaff(caregiverId: string, staffUserId: string | null, ipAddress: string | null, now = new Date()): Promise<boolean> {
    const [r] = await this.db
      .select()
      .from(accountDeletionRequests)
      .where(and(eq(accountDeletionRequests.caregiverId, caregiverId), eq(accountDeletionRequests.status, 'PENDING')))
      .limit(1);
    if (!r) return false;
    const open = await this.openItems(r, now);
    if (Object.values(open).some((n) => n > 0)) throw new ConflictException(PENDING_DELETION_OPEN_ITEMS_MESSAGE);
    return this.erase(r, now, { userId: staffUserId, ipAddress });
  }

  // --- what's still open --------------------------------------------------------

  async openItems(r: Pick<Request, 'caregiverId' | 'patientId'>, now = new Date()): Promise<AccountOpenItems> {
    const items = { ...NO_OPEN_ITEMS };
    const count = async (query: Promise<{ n: number }[]>) => Number((await query)[0]?.n ?? 0);
    const n = sql<number>`count(*)`;
    if (r.caregiverId) {
      const id = r.caregiverId;
      items.upcomingShifts = await count(
        this.db.select({ n }).from(bookingShifts).where(and(eq(bookingShifts.caregiverId, id), inArray(bookingShifts.status, ['DRAFT', 'SCHEDULED']), gt(bookingShifts.endsAt, now))),
      );
      items.unpaidPayouts = await count(this.db.select({ n }).from(payoutStatements).where(and(eq(payoutStatements.caregiverId, id), inArray(payoutStatements.status, ['DRAFT', 'APPROVED']))));
      items.activePlacements = await count(this.db.select({ n }).from(placements).where(and(eq(placements.caregiverId, id), inArray(placements.status, ['PRE_DEPARTURE', 'DEPLOYED']))));
      items.openAdjustments += await count(this.db.select({ n }).from(billingAdjustments).where(and(eq(billingAdjustments.caregiverId, id), eq(billingAdjustments.status, 'OPEN'))));
    }
    if (r.patientId) {
      const id = r.patientId;
      items.activeBookings = await count(this.db.select({ n }).from(bookings).where(and(eq(bookings.patientId, id), inArray(bookings.status, ['DRAFT', 'CONFIRMED']))));
      items.unpaidInvoices = await count(this.db.select({ n }).from(invoices).where(and(eq(invoices.patientId, id), inArray(invoices.status, ['DRAFT', 'ISSUED']))));
      items.openCareRequests = await count(this.db.select({ n }).from(careRequests).where(and(eq(careRequests.patientId, id), inArray(careRequests.status, [...OPEN_CARE_REQUEST_STATUSES]))));
      items.openAdjustments += await count(this.db.select({ n }).from(billingAdjustments).where(and(eq(billingAdjustments.patientId, id), eq(billingAdjustments.status, 'OPEN'))));
    }
    return items;
  }

  // --- erasure ------------------------------------------------------------------

  /** Erases every request past its grace period with nothing left open. Returns how many were erased. */
  async eraseDue(now = new Date()): Promise<number> {
    const due = await this.db
      .select()
      .from(accountDeletionRequests)
      .where(and(eq(accountDeletionRequests.status, 'PENDING'), lte(accountDeletionRequests.eraseAfter, now)))
      .limit(50);
    let erased = 0;
    for (const r of due) {
      const open = await this.openItems(r, now);
      if (Object.values(open).some((n) => n > 0)) continue; // waits for staff to settle it
      if (await this.erase(r, now)) erased += 1;
    }
    return erased;
  }

  /** `byStaff`: a staff member deleting the record before the grace period ran out (eraseCaregiverForStaff). */
  private async erase(r: Request, now: Date, byStaff?: { userId: string | null; ipAddress: string | null }) {
    const files: string[] = [];
    const erased = await this.db.transaction(async (tx) => {
      // Still pending? A second API instance, or staff cancelling at the same moment, may have got there first.
      // Locked, so the other one waits here and then sees it is no longer pending.
      const [current] = await tx
        .select({ status: accountDeletionRequests.status })
        .from(accountDeletionRequests)
        .where(eq(accountDeletionRequests.id, r.id))
        .limit(1)
        .for('update');
      if (current?.status !== 'PENDING') return false;

      if (r.caregiverId) files.push(...(await this.eraseCaregiver(tx as unknown as Database, r.caregiverId, now)));
      if (r.patientId) await this.eraseClient(tx as unknown as Database, r.patientId);

      await releaseLogin(tx as unknown as Database, { userId: r.userId, caregiverId: r.caregiverId });
      await tx.update(users).set({ fullName: ERASED_NAME.USER, lastLoginAt: null }).where(eq(users.id, r.userId));
      await tx.delete(deviceTokens).where(eq(deviceTokens.userId, r.userId));
      await tx.update(accountDeletionRequests).set({ status: 'ERASED', erasedAt: now, updatedAt: now }).where(eq(accountDeletionRequests.id, r.id));
      return true;
    });
    // Someone else got there first: nothing was erased here, so nothing to record.
    if (!erased) return false;

    // Files after the database: a file left behind can be found and removed; a row pointing at a missing file can't be undone.
    for (const key of files) {
      await this.storage.delete(key).catch((err) => this.logger.warn(`Account erasure: could not delete a file: ${(err as Error).message}`));
    }
    await this.record(r, 'ERASE_ACCOUNT', byStaff?.userId ?? null, byStaff?.ipAddress ?? null, {
      filesRemoved: files.length,
      ...(byStaff ? { deletedByStaff: true } : {}),
    });
    this.logger.log(`Account erasure: erased a ${r.role === 'CAREGIVER' ? 'caregiver' : 'client'} account (request ${r.id}).`);
    return true;
  }

  /** The caregiver's record kept for bookings and payouts, without the person. Returns the storage keys to delete. */
  private async eraseCaregiver(db: Database, caregiverId: string, now: Date): Promise<string[]> {
    const docs = await db.select({ key: caregiverDocuments.storageKey }).from(caregiverDocuments).where(eq(caregiverDocuments.caregiverId, caregiverId));
    const photos = await db.select({ key: sharedProfiles.photoKey }).from(sharedProfiles).where(eq(sharedProfiles.caregiverId, caregiverId));

    await db
      .update(caregivers)
      .set({
        fullName: ERASED_NAME.CAREGIVER,
        permanentAddress: '',
        nic: null,
        passportNumber: null,
        dateOfBirth: ERASED_BIRTH_DATE,
        heightIn: null,
        weightKg: null,
        primaryPhone: '',
        secondaryPhone: null,
        emergencyContactName: '',
        emergencyContactNumber: '',
        emergencyContactRelationship: '',
        policeDivision: null,
        policeStation: null,
        preferredContactMethod: null,
        cityId: null,
        city: null,
        postalCode: null,
        status: 'INACTIVE',
        deletedAt: sql`COALESCE(${caregivers.deletedAt}, ${now})`,
      })
      .where(eq(caregivers.id, caregiverId));

    for (const table of [
      caregiverDocuments,
      qualifications,
      experiences,
      references,
      caregiverHealthInformation,
      availability,
      preferredLocations,
      caregiverSkills,
      caregiverLanguages,
      sharedProfiles,
      caregiverOverseasProfiles,
      employerShortlist,
      documentExpiryReminders,
    ] as const) {
      await db.delete(table).where(eq(table.caregiverId, caregiverId));
    }
    // Staff's verification record stays (it was done), without notes that may name the person.
    await db.update(verifications).set({ notes: null }).where(eq(verifications.caregiverId, caregiverId));
    // Their ratings go with the profile.
    const reviewIds = (await db.select({ id: caregiverReviews.id }).from(caregiverReviews).where(eq(caregiverReviews.caregiverId, caregiverId))).map((r) => r.id);
    if (reviewIds.length) await db.delete(caregiverReviewBadges).where(inArray(caregiverReviewBadges.reviewId, reviewIds));
    await db.delete(caregiverReviews).where(eq(caregiverReviews.caregiverId, caregiverId));
    await db.delete(caregiverRatingStats).where(eq(caregiverRatingStats.caregiverId, caregiverId));
    await db.delete(reviewRequests).where(eq(reviewRequests.caregiverId, caregiverId));

    return [...docs.map((d) => d.key), ...photos.map((p) => p.key).filter((k): k is string => Boolean(k))];
  }

  /** The client's record kept for bookings and invoices, without the person or the one they care for. */
  private async eraseClient(db: Database, patientId: string) {
    await db
      .update(patients)
      .set({
        fullName: ERASED_NAME.PATIENT_GUARDIAN,
        phone: null,
        permanentAddress: null,
        dateOfBirth: null,
        gender: null,
        nic: null,
        cityId: null,
        city: null,
        postalCode: null,
        notes: null,
        recipientName: null,
        recipientRelationship: null,
        recipientAge: null,
        recipientGender: null,
        alternatePhone: null,
        preferredContactMethod: null,
        preferredContactTime: null,
        careRemindersEnabled: false,
        careAddress: null,
        careNeeds: null,
        preferredCaregiverGender: null,
        status: 'INACTIVE',
      })
      .where(eq(patients.id, patientId));
    await db.delete(savedCaregivers).where(eq(savedCaregivers.patientId, patientId));
    // The requests stay (staff's record of who was introduced); what the client wrote doesn't.
    await db.update(careRequests).set({ message: null }).where(eq(careRequests.patientId, patientId));
    // Their ratings stay, anonymously - a caregiver keeps the stars and badges they earned - but what they wrote goes.
    await db
      .update(caregiverReviews)
      .set({ reviewerUserId: null, comment: null, commentLanguage: null, commentStatus: 'NONE', commentRejectReason: null, privateNote: null })
      .where(eq(caregiverReviews.patientId, patientId));
  }
}

/**
 * Whether the caregiver or client record behind a request is gone: a
 * caregiver soft-deleted by staff, or a client's record deleted outright.
 * `caregiverFound` tells a missing caregiver row from one that is there.
 */
function isRecordDeleted(
  r: Pick<Request, 'caregiverId' | 'patientId'>,
  caregiverDeletedAt: Date | null,
  patientRowId: string | null,
  caregiverFound = true,
): boolean {
  if (r.caregiverId) return Boolean(caregiverDeletedAt) || !caregiverFound;
  if (r.patientId) return !patientRowId;
  return false;
}
