import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  patients,
  users,
  refreshTokens,
  emailVerificationTokens,
  CLIENT_STATUS_TRANSITIONS,
  type ClientStatus,
} from '../database/schema';
import { PatientQueryDto } from './dto/patient-query.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { maskPhone } from '../common/utils/masking.util';

/**
 * The staff-facing view of registered patients/guardians.
 *
 * Every client is a `users` row with role PATIENT_GUARDIAN plus a 1:1
 * `patients` row, so most read paths are a join across the two. There is no
 * create() here: clients self-register through the public site
 * (POST /auth/register-patient and its WhatsApp twin), so unlike caregivers
 * there is no staff-mediated creation to expose.
 */
@Injectable()
export class PatientsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Loads the client profile joined to its login account, or throws. */
  private async findOrThrow(id: string) {
    const [row] = await this.db
      .select({
        id: patients.id,
        userId: patients.userId,
        fullName: patients.fullName,
        phone: patients.phone,
        status: patients.status,
        consentAcceptedAt: patients.consentAcceptedAt,
        createdAt: patients.createdAt,
        updatedAt: patients.updatedAt,
        email: users.email,
        isActive: users.isActive,
        emailVerifiedAt: users.emailVerifiedAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(patients)
      .innerJoin(users, eq(patients.userId, users.id))
      .where(eq(patients.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Client not found');
    return row;
  }

  async findAll(query: PatientQueryDto) {
    const conditions: SQL[] = [];

    if (query.search) {
      const term = `%${query.search}%`;
      // users.email is nullable (a WhatsApp-only client has none); LIKE
      // against NULL yields NULL, which OR treats as non-matching, so those
      // clients simply drop out of an email search and still match on name.
      conditions.push(or(like(patients.fullName, term), like(patients.phone, term), like(users.email, term))!);
    }
    if (query.status) {
      conditions.push(eq(patients.status, query.status));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(users.isActive, query.isActive));
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const sortColumn = {
      fullName: patients.fullName,
      createdAt: patients.createdAt,
      status: patients.status,
    }[query.sortBy];
    const orderFn = query.sortDir === 'asc' ? asc : desc;

    const columns = {
      id: patients.id,
      userId: patients.userId,
      fullName: patients.fullName,
      phone: patients.phone,
      status: patients.status,
      consentAcceptedAt: patients.consentAcceptedAt,
      createdAt: patients.createdAt,
      updatedAt: patients.updatedAt,
      email: users.email,
      isActive: users.isActive,
      emailVerifiedAt: users.emailVerifiedAt,
      lastLoginAt: users.lastLoginAt,
    };

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select(columns)
        .from(patients)
        .innerJoin(users, eq(patients.userId, users.id))
        .where(whereClause)
        .orderBy(orderFn(sortColumn))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ total: sql<number>`count(*)` })
        .from(patients)
        .innerJoin(users, eq(patients.userId, users.id))
        .where(whereClause),
    ]);

    // Same PII split as the caregiver list: mask on the list, expose raw
    // values only on the detail endpoint.
    const items = rows.map((row) => ({ ...row, phone: maskPhone(row.phone) }));

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / query.pageSize),
    };
  }

  async findOne(id: string) {
    return this.findOrThrow(id);
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const target = await this.findOrThrow(id);

    const allowed = CLIENT_STATUS_TRANSITIONS[target.status as ClientStatus] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot change status from ${target.status} to ${dto.status}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    await this.db.update(patients).set({ status: dto.status }).where(eq(patients.id, id));
    return this.findOrThrow(id);
  }

  /**
   * Flips the login account's active flag. Deliberately separate from
   * `status`: this is the auth-level switch (the account cannot sign in),
   * while status is the staff-facing review state. They move independently -
   * deactivating a login does not mean the client is suspended, and vice versa.
   */
  async setActive(id: string, isActive: boolean) {
    const target = await this.findOrThrow(id);
    await this.db.update(users).set({ isActive }).where(eq(users.id, target.userId));

    // An account that just lost access must not keep a live refresh token,
    // or it stays signed in until that token expires.
    if (!isActive) {
      await this.db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, target.userId));
    }
    return this.findOrThrow(id);
  }

  /**
   * Deletes the client and the login account behind it, in one transaction.
   *
   * UsersService.remove() deletes tokens + the users row but NOT the profile
   * row - safe there only because that module refuses self-registered roles,
   * so it can never reach a patient. Here it is reachable, so this must clean
   * up both sides or it would leave an orphan `patients` row pointing at a
   * deleted user. Audit log rows deliberately keep their userId.
   */
  async remove(id: string) {
    const target = await this.findOrThrow(id);

    await this.db.transaction(async (tx) => {
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, target.userId));
      await tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, target.userId));
      await tx.delete(users).where(eq(users.id, target.userId));
      await tx.delete(patients).where(eq(patients.id, id));
    });

    return { success: true };
  }
}