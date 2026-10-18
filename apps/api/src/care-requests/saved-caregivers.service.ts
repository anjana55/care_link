import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { SavedCaregiverItem } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, patients, savedCaregivers } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PublicSearchService } from '../public-search/public-search.service';

/** A generous shortlist; well past what anyone compares by hand. */
export const MAX_SAVED_CAREGIVERS = 100;

/**
 * A client's shortlist. Saved by public id and shown as public profiles, the
 * same as everything else the public site sees. Saving is allowed for every
 * client status - it reveals nothing and contacts nobody.
 */
@Injectable()
export class SavedCaregiversService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly publicSearch: PublicSearchService,
  ) {}

  private async patientId(user: AuthenticatedUser): Promise<string> {
    if (user.role !== 'PATIENT_GUARDIAN' || !user.patientId) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    const [row] = await this.db.select({ id: patients.id }).from(patients).where(eq(patients.id, user.patientId)).limit(1);
    if (!row) throw new ForbiddenException('You do not have permission to perform this action');
    return row.id;
  }

  async list(user: AuthenticatedUser, locale?: string): Promise<SavedCaregiverItem[]> {
    const patientId = await this.patientId(user);
    const rows = await this.db
      .select({ caregiverId: savedCaregivers.caregiverId, savedAt: savedCaregivers.createdAt, publicId: caregivers.publicId })
      .from(savedCaregivers)
      .innerJoin(caregivers, eq(savedCaregivers.caregiverId, caregivers.id))
      .where(eq(savedCaregivers.patientId, patientId))
      .orderBy(desc(savedCaregivers.createdAt));
    const profiles = await this.publicSearch.profilesFor(
      rows.map((r) => r.caregiverId),
      locale,
    );
    return rows.map((r) => ({
      caregiverPublicId: r.publicId,
      savedAt: new Date(r.savedAt).toISOString(),
      caregiver: profiles.get(r.caregiverId) ?? null,
    }));
  }

  async save(user: AuthenticatedUser, publicId: string) {
    const patientId = await this.patientId(user);
    const [caregiver] = await this.db
      .select({ id: caregivers.id })
      .from(caregivers)
      .where(and(eq(caregivers.publicId, publicId), isNull(caregivers.deletedAt), eq(caregivers.status, 'ACTIVE')))
      .limit(1);
    if (!caregiver) throw new NotFoundException('Caregiver not found');

    const [{ n }] = await this.db.select({ n: count() }).from(savedCaregivers).where(eq(savedCaregivers.patientId, patientId));
    if (n >= MAX_SAVED_CAREGIVERS) {
      throw new BadRequestException('Your saved list is full - remove someone to save another caregiver');
    }

    // Saving twice is a no-op, not an error: the button may be pressed from two tabs.
    await this.db
      .insert(savedCaregivers)
      .values({ patientId, caregiverId: caregiver.id })
      .onDuplicateKeyUpdate({ set: { patientId } });
    return { saved: true };
  }

  /** Unsaving works for any caregiver on the list, including one who is no longer public. */
  async remove(user: AuthenticatedUser, publicId: string) {
    const patientId = await this.patientId(user);
    const [caregiver] = await this.db.select({ id: caregivers.id }).from(caregivers).where(eq(caregivers.publicId, publicId)).limit(1);
    if (caregiver) {
      await this.db
        .delete(savedCaregivers)
        .where(and(eq(savedCaregivers.patientId, patientId), eq(savedCaregivers.caregiverId, caregiver.id)));
    }
    return { saved: false };
  }
}
