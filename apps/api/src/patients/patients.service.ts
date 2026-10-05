import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  patients,
  users,
  districts,
  cities,
  refreshTokens,
  emailVerificationTokens,
  CLIENT_STATUS_TRANSITIONS,
  type ClientStatus,
} from '../database/schema';
import { PatientQueryDto } from './dto/patient-query.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { maskPhone } from '../common/utils/masking.util';
import { normalizePhone } from '../common/utils/phone.util';
import { resolveLocationRefs } from '../common/utils/location.util';
import { assertWhatsappNumberAvailable } from '../auth/phone-accounts.util';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';

/**
 * The columns a staff edit may write directly. Everything else is either set
 * at registration, owned by a dedicated endpoint, or resolved rather than
 * trusted: districtId/cityId feed resolveLocationRefs and the display caches
 * come back from it, and phone/email are written as a matched pair across
 * `patients` and `users` in update() below.
 *
 * An explicit list, never a spread of the DTO - a hand-rolled request could
 * otherwise write `status` or the location caches and desynchronise them from
 * the ids that search and the status ladder actually match on. Keep in lockstep
 * with UpdatePatientDto. Note `.has`, not `in`: `in` on a Set tests for a
 * property rather than for membership and silently rejects every field.
 */
const UPDATABLE_COLUMNS: ReadonlySet<string> = new Set([
  'fullName',
  'permanentAddress',
  'dateOfBirth',
  'gender',
  'nic',
  'notes',
]);

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
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly whatsappSettings: WhatsappSettingsService,
  ) {}

  /** Loads the client profile joined to its login account, or throws. */
  private async findOrThrow(id: string) {
    const [row] = await this.db
      .select({
        id: patients.id,
        userId: patients.userId,
        fullName: patients.fullName,
        phone: patients.phone,
        alternatePhone: patients.alternatePhone,
        // --- intake, captured at self-registration ------------------------
        registrantType: patients.registrantType,
        recipientName: patients.recipientName,
        recipientRelationship: patients.recipientRelationship,
        recipientAge: patients.recipientAge,
        recipientGender: patients.recipientGender,
        preferredContactMethod: patients.preferredContactMethod,
        preferredContactTime: patients.preferredContactTime,
        careAddress: patients.careAddress,
        careNeeds: patients.careNeeds,
        careSchedule: patients.careSchedule,
        careStart: patients.careStart,
        preferredCaregiverGender: patients.preferredCaregiverGender,
        consentAcceptedAt: patients.consentAcceptedAt,
        permanentAddress: patients.permanentAddress,
        dateOfBirth: patients.dateOfBirth,
        gender: patients.gender,
        nic: patients.nic,
        districtId: patients.districtId,
        cityId: patients.cityId,
        district: patients.district,
        city: patients.city,
        province: patients.province,
        postalCode: patients.postalCode,
        notes: patients.notes,
        status: patients.status,
        createdAt: patients.createdAt,
        updatedAt: patients.updatedAt,
        email: users.email,
        // The WhatsApp LOGIN number: E.164, and a different field from `phone`
        // above, which is free text and is null for every email-registered
        // client (AuthService.registerPatient never writes users.phone). Read
        // by update() to tell a genuine change of number from a respelling of
        // the same one, and returned so staff can see both side by side.
        accountPhone: users.phone,
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
      conditions.push(
        or(
          like(patients.fullName, term),
          // A guardian registers under their own name but is really searching
          // for the person they registered on behalf of.
          like(patients.recipientName, term),
          like(patients.phone, term),
          like(patients.alternatePhone, term),
          like(users.phone, term),
          like(users.email, term),
        )!,
      );
    }
    if (query.status) {
      conditions.push(eq(patients.status, query.status));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(users.isActive, query.isActive));
    }
    // Intake facets. These match NULL for every client who registered before
    // the intake form existed, so a filtered view legitimately drops them.
    if (query.districtId) conditions.push(eq(patients.districtId, query.districtId));
    if (query.cityId) conditions.push(eq(patients.cityId, query.cityId));
    if (query.careSchedule) conditions.push(eq(patients.careSchedule, query.careSchedule));
    if (query.careStart) conditions.push(eq(patients.careStart, query.careStart));
    if (query.contactMethod) conditions.push(eq(patients.preferredContactMethod, query.contactMethod));
    if (query.registrantType) conditions.push(eq(patients.registrantType, query.registrantType));
    // Either channel counts as verified: a WhatsApp client has no email to
    // confirm and an email client has no phone to confirm.
    if (query.verification === 'VERIFIED') {
      conditions.push(or(isNotNull(users.emailVerifiedAt), isNotNull(users.phoneVerifiedAt))!);
    } else if (query.verification === 'UNVERIFIED') {
      conditions.push(and(isNull(users.emailVerifiedAt), isNull(users.phoneVerifiedAt))!);
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
      alternatePhone: patients.alternatePhone,
      status: patients.status,
      registrantType: patients.registrantType,
      recipientName: patients.recipientName,
      recipientRelationship: patients.recipientRelationship,
      recipientAge: patients.recipientAge,
      recipientGender: patients.recipientGender,
      preferredContactMethod: patients.preferredContactMethod,
      preferredContactTime: patients.preferredContactTime,
      careSchedule: patients.careSchedule,
      careStart: patients.careStart,
      districtId: patients.districtId,
      cityId: patients.cityId,
      // Resolved from the referenced rows so the list renders without a join
      // in the client - the same display caches the staff edit writes.
      district: districts.nameEn,
      city: cities.nameEn,
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
        .leftJoin(districts, eq(patients.districtId, districts.id))
        .leftJoin(cities, eq(patients.cityId, cities.id))
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
    // values only on the detail endpoint. The alternate number is a contact
    // detail for the same reason, so it is masked alongside the primary.
    const items = rows.map((row) => ({
      ...row,
      phone: maskPhone(row.phone),
      alternatePhone: maskPhone(row.alternatePhone),
    }));

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

  /**
   * Staff edit of a client's details. Writes two tables - `patients` for the
   * profile and `users` for the login's email and WhatsApp number - so it runs
   * in a transaction. A partial write here would reintroduce exactly the drift
   * the phone sync exists to prevent, and the conflict pre-checks have to read
   * the same snapshot the writes land in or they are not checks at all.
   *
   * The two phone columns, which is the easy thing to get wrong:
   *   patients.phone  free text, exactly as typed. This is the display and
   *                    search column - findAll LIKEs against it and masks it -
   *                    and the app stores phones as typed everywhere outside
   *                    `users`.
   *   users.phone     E.164. This is the UNIQUE WhatsApp login identity, and
   *                    every lookup against it is an equality with E.164
   *                    (whatsapp-auth.service.ts, phone-accounts.util.ts).
   *                    Writing anything else there breaks sign-in.
   */
  async update(id: string, dto: UpdatePatientDto) {
    const target = await this.findOrThrow(id);

    // Both are cheap and pure enough to run before the transaction opens.
    const defaultCountryCode = await this.whatsappSettings.getDefaultCountryCode();
    const typedPhone = dto.phone?.trim() ? dto.phone.trim() : null;

    // Explicit allowlist rather than spreading the DTO - see UPDATABLE_COLUMNS.
    // Empty string becomes null so clearing a field can't leave '' in a text
    // column or trip a unique constraint.
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (!UPDATABLE_COLUMNS.has(key)) continue;
      updateData[key] = value === '' ? null : value;
    }
    // 'YYYY-MM-DD' is what the column wants; the cast says Date only because
    // drizzle types the builder that way. Do not turn this into new Date() -
    // mysql2 would serialise it in the connection's local timezone and shift
    // the stored day by one west of UTC.
    if (dto.dateOfBirth) updateData.dateOfBirth = dto.dateOfBirth as unknown as Date;

    // Only resolve when this edit actually names a location, so a partial
    // update that touches neither is a no-op rather than an erasure.
    const location = await resolveLocationRefs(this.db, dto);
    if (location) {
      updateData.districtId = location.districtId;
      updateData.cityId = location.cityId;
      updateData.district = location.district;
      updateData.city = location.city;
      updateData.province = location.province;
      updateData.postalCode = location.postalCode;
    }

    await this.db.transaction(async (tx) => {
      // A transaction handle exposes the query-builder surface these helpers
      // need, but not the full Database type.
      const txDb = tx as unknown as Database;
      const accountData: Partial<typeof users.$inferInsert> = {};

      // --- phone: one field, two representations, one decision -----------
      if (typedPhone) {
        const e164 = normalizePhone(typedPhone, defaultCountryCode);
        if (!e164) {
          // Same wording as WhatsappAuthService.requirePhone, so "that is not
          // a usable number" reads identically wherever it is said.
          throw new BadRequestException(
            'Enter a valid phone number, including the country code if it is not a local number',
          );
        }
        // Compared as E.164 against the login's E.164, NOT against
        // patients.phone. Re-saving "0771234567" as "+94771234567" is the same
        // number and must not cost the client their WhatsApp verification.
        const changed = e164 !== target.accountPhone;
        if (changed) {
          // Excludes this client's own two rows, which would otherwise match
          // themselves - the users row always, the patients row whenever the
          // stored spelling is a variant of the number being written.
          await assertWhatsappNumberAvailable(txDb, e164, defaultCountryCode, {
            userId: target.userId,
            patientId: target.id,
          });
          // The new number is unproven, and leaving phoneVerifiedAt set would
          // let whoever holds it complete a LOGIN OTP and take the account
          // over. Recovery is self-service: the client requests a REGISTER OTP,
          // which is exactly what an unverified row is eligible for.
          accountData.phoneVerifiedAt = null;
        }
        accountData.phone = e164;
        // Free text, as typed, on the display/search column. Written even when
        // `changed` is false, so a respelling tidies the stored value.
        updateData.phone = typedPhone;
      }
      // A blank phone means "not submitted", not a request to clear it.
      // Clearing users.phone would leave a WhatsApp-only client (no email, no
      // password) with no way to sign in, and no endpoint that can undo it.

      // --- email: users only, and deliberately not re-verified ------------
      // @IsOptional() skips validation for null as well as undefined, so a
      // client sending {"email": null} - the natural "clear this" spelling -
      // passes the DTO. Treat it as absent rather than letting .trim() throw a
      // TypeError, which would surface as a 500 instead of a no-op.
      const typedEmail = dto.email?.trim();
      if (typedEmail !== undefined) {
        // Case-insensitive, so a respelling of the same address under different
        // casing is not treated as a change. MySQL's default collation is
        // case-insensitive too, so this and the unique index agree.
        if (typedEmail && typedEmail.toLowerCase() !== target.email?.toLowerCase()) {
          const [existing] = await txDb
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.email, typedEmail), ne(users.id, target.userId)))
            .limit(1);
          if (existing) {
            throw new ConflictException('An account with this email already exists');
          }
          // emailVerifiedAt is deliberately NOT cleared, asymmetric with phone.
          // The phone case has a self-service recovery (the OTP page), the
          // email case has none: there is no resend-verification UI in
          // public-web and no admin action that mints a token for someone
          // else, so clearing it would be a one-way door into a locked
          // account - worse when the new address is itself a typo the
          // verification mail would then be sent to.
          accountData.email = typedEmail;
        }
      }

      if (Object.keys(updateData).length) {
        // No $onUpdate on this table, so MySQL will not touch it. This is the
        // first write in the codebase that sets it at all.
        updateData.updatedAt = new Date();
        await tx.update(patients).set(updateData).where(eq(patients.id, id));
      }
      if (Object.keys(accountData).length) {
        // users.updatedAt is left alone, matching UsersService.update and
        // setActive, which also skip it. A codebase-wide gap, worth its own
        // ticket rather than a lone fix here.
        await tx.update(users).set(accountData).where(eq(users.id, target.userId));
      }
    });

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