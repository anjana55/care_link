import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt, randomUUID as uuid } from 'crypto';
import { and, asc, count, desc, eq, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import type { ClientCareRequest, CaregiverRelation } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  careRequests,
  careRequestEvents,
  caregivers,
  cities,
  districts,
  patients,
  savedCaregivers,
  users,
  CARE_REQUEST_STATUS_TRANSITIONS,
  OPEN_CARE_REQUEST_STATUSES,
  careRequestStatusEnum,
  type CareRequestLanguage,
  type CareRequestStatus,
} from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { maskPhone } from '../common/utils/masking.util';
import { PublicSearchService } from '../public-search/public-search.service';
import { CareRequestNotifier } from './care-request-notifier.service';
import { CreateCareRequestDto } from './dto/create-care-request.dto';
import { CareRequestQueryDto } from './dto/care-request-query.dto';
import { UpdateCareRequestStatusDto } from './dto/update-care-request-status.dto';

/** How many open requests one client may have at once - enough for a real search, too few to spam staff. */
export const MAX_OPEN_REQUESTS_PER_CLIENT = 10;

/** Crockford-style alphabet without 0/O, 1/I/L, U: easy to read out over the phone. */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateReference(): string {
  let out = 'CR-';
  for (let i = 0; i < 6; i++) out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return out;
}

const isDuplicate = (err: unknown, index?: string) => {
  const e = err as { code?: string; sqlMessage?: string; cause?: { code?: string; sqlMessage?: string } };
  const code = e.code ?? e.cause?.code;
  const msg = e.sqlMessage ?? e.cause?.sqlMessage ?? '';
  return code === 'ER_DUP_ENTRY' && (!index || msg.includes(index));
};

/**
 * "Contact this caregiver" end to end: the client's side (create, list,
 * cancel) and the staff Requests queue (list, read, move on, note, assign).
 *
 * The client side only ever speaks in caregiver *public* ids and public
 * profiles. The staff side sees both parties in full - that is the job.
 */
@Injectable()
export class CareRequestsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly publicSearch: PublicSearchService,
    private readonly notifier: CareRequestNotifier,
  ) {}

  // --- client side ----------------------------------------------------------

  /**
   * The signed-in client's patient record, or 403. Suspended and inactive
   * clients may still sign in and look, but cannot send requests; a client
   * whose account is still PENDING_REVIEW can - staff see the review status on
   * the request and review them then.
   */
  private async requireClient(user: AuthenticatedUser) {
    if (user.role !== 'PATIENT_GUARDIAN' || !user.patientId) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    const [patient] = await this.db
      .select({ id: patients.id, status: patients.status })
      .from(patients)
      .where(eq(patients.id, user.patientId))
      .limit(1);
    if (!patient) throw new ForbiddenException('You do not have permission to perform this action');
    return patient;
  }

  /** A caregiver a member of the public may see - same rule as search: ACTIVE and not deleted. */
  private async visibleCaregiverByPublicId(publicId: string) {
    const [row] = await this.db
      .select({ id: caregivers.id, publicId: caregivers.publicId })
      .from(caregivers)
      .where(and(eq(caregivers.publicId, publicId), isNull(caregivers.deletedAt), eq(caregivers.status, 'ACTIVE')))
      .limit(1);
    // One message for "no such id" and "exists but not public", like findByPublicId.
    if (!row) throw new NotFoundException('Caregiver not found');
    return row;
  }

  async create(user: AuthenticatedUser, dto: CreateCareRequestDto, language: CareRequestLanguage): Promise<ClientCareRequest> {
    const patient = await this.requireClient(user);
    if (patient.status === 'SUSPENDED' || patient.status === 'INACTIVE') {
      throw new ForbiddenException("Your account can't send requests right now. Please contact us for help.");
    }
    const caregiver = await this.visibleCaregiverByPublicId(dto.caregiverPublicId);

    const [{ open }] = await this.db
      .select({ open: count() })
      .from(careRequests)
      .where(and(eq(careRequests.patientId, patient.id), inArray(careRequests.status, [...OPEN_CARE_REQUEST_STATUSES])));
    if (open >= MAX_OPEN_REQUESTS_PER_CLIENT) {
      throw new BadRequestException(
        'You already have the most open requests allowed. Our team will be in touch - you can cancel one to send another.',
      );
    }

    const id = uuid();
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.transaction(async (tx) => {
          await tx.insert(careRequests).values({
            id,
            reference: generateReference(),
            patientId: patient.id,
            caregiverId: caregiver.id,
            status: 'NEW',
            message: dto.message ?? null,
            language,
          });
          await tx.insert(careRequestEvents).values({
            id: uuid(),
            requestId: id,
            type: 'CREATED',
            toStatus: 'NEW',
            actorUserId: user.userId,
          });
        });
        break;
      } catch (err) {
        // The generated open_pair_key is unique: a second open request for the
        // same caregiver - a double click, a second tab - lands here.
        if (isDuplicate(err, 'care_requests_open_pair_unique')) {
          throw new ConflictException('You already have an open request for this caregiver');
        }
        // A reference collision (1 in ~700 million per pair) - draw again.
        if (isDuplicate(err, 'care_requests_reference_unique') && attempt < 3) continue;
        throw err;
      }
    }

    void this.notifier.requestCreated(id);
    const [created] = await this.listForClient(user, undefined, [id]);
    return created;
  }

  /** The client's own requests, newest first, each with the caregiver's public profile. */
  async listForClient(user: AuthenticatedUser, locale?: string, onlyIds?: string[]): Promise<ClientCareRequest[]> {
    const patient = await this.requireClient(user);
    const conditions: SQL[] = [eq(careRequests.patientId, patient.id)];
    if (onlyIds?.length) conditions.push(inArray(careRequests.id, onlyIds));

    const rows = await this.db
      .select({
        id: careRequests.id,
        reference: careRequests.reference,
        status: careRequests.status,
        createdAt: careRequests.createdAt,
        updatedAt: careRequests.updatedAt,
        closedAt: careRequests.closedAt,
        caregiverId: careRequests.caregiverId,
        caregiverPublicId: caregivers.publicId,
      })
      .from(careRequests)
      .innerJoin(caregivers, eq(careRequests.caregiverId, caregivers.id))
      .where(and(...conditions))
      .orderBy(desc(careRequests.createdAt))
      .limit(200);

    const profiles = await this.publicSearch.profilesFor(
      rows.map((r) => r.caregiverId),
      locale,
    );
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
      closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
      caregiverPublicId: r.caregiverPublicId,
      caregiver: profiles.get(r.caregiverId) ?? null,
    }));
  }

  async cancelByClient(user: AuthenticatedUser, id: string): Promise<ClientCareRequest> {
    const patient = await this.requireClient(user);
    const [row] = await this.db
      .select({ id: careRequests.id, status: careRequests.status })
      .from(careRequests)
      .where(and(eq(careRequests.id, id), eq(careRequests.patientId, patient.id)))
      .limit(1);
    // Someone else's request is "not found", never "forbidden" - no confirming it exists.
    if (!row) throw new NotFoundException('Request not found');
    if (!OPEN_CARE_REQUEST_STATUSES.includes(row.status)) {
      throw new BadRequestException('This request can no longer be cancelled');
    }

    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(careRequests)
        .set({ status: 'CANCELLED', closedAt: now, updatedAt: now })
        .where(and(eq(careRequests.id, id), inArray(careRequests.status, [...OPEN_CARE_REQUEST_STATUSES])));
      await tx.insert(careRequestEvents).values({
        id: uuid(),
        requestId: id,
        type: 'CANCELLED',
        fromStatus: row.status,
        toStatus: 'CANCELLED',
        actorUserId: user.userId,
      });
    });
    const [updated] = await this.listForClient(user, undefined, [id]);
    return updated;
  }

  /**
   * For each caregiver on screen: has this client saved them, and is there an
   * open request? Unknown or non-public ids are simply left out.
   */
  async relationsFor(user: AuthenticatedUser, publicIds: string[]): Promise<CaregiverRelation[]> {
    const patient = await this.requireClient(user);
    const ids = [...new Set(publicIds)].slice(0, 100);
    if (!ids.length) return [];

    const cgs = await this.db
      .select({ id: caregivers.id, publicId: caregivers.publicId })
      .from(caregivers)
      .where(and(inArray(caregivers.publicId, ids), isNull(caregivers.deletedAt), eq(caregivers.status, 'ACTIVE')));
    if (!cgs.length) return [];
    const cgIds = cgs.map((c) => c.id);

    const [saved, open] = await Promise.all([
      this.db
        .select({ caregiverId: savedCaregivers.caregiverId })
        .from(savedCaregivers)
        .where(and(eq(savedCaregivers.patientId, patient.id), inArray(savedCaregivers.caregiverId, cgIds))),
      this.db
        .select({ id: careRequests.id, reference: careRequests.reference, status: careRequests.status, caregiverId: careRequests.caregiverId })
        .from(careRequests)
        .where(
          and(
            eq(careRequests.patientId, patient.id),
            inArray(careRequests.caregiverId, cgIds),
            inArray(careRequests.status, [...OPEN_CARE_REQUEST_STATUSES]),
          ),
        ),
    ]);
    const savedSet = new Set(saved.map((s) => s.caregiverId));
    return cgs.map((c) => {
      const req = open.find((o) => o.caregiverId === c.id);
      return {
        caregiverPublicId: c.publicId,
        saved: savedSet.has(c.id),
        openRequest: req ? { id: req.id, reference: req.reference, status: req.status } : null,
      };
    });
  }

  // --- staff side -------------------------------------------------------------

  async findAll(query: CareRequestQueryDto, actor: AuthenticatedUser) {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(careRequests.status, query.status));
    else if (query.scope === 'open') conditions.push(inArray(careRequests.status, [...OPEN_CARE_REQUEST_STATUSES]));
    if (query.assigned === 'me') conditions.push(eq(careRequests.assignedToUserId, actor.userId));
    if (query.assigned === 'unassigned') conditions.push(isNull(careRequests.assignedToUserId));
    if (query.patientId) conditions.push(eq(careRequests.patientId, query.patientId));
    if (query.caregiverId) conditions.push(eq(careRequests.caregiverId, query.caregiverId));
    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      conditions.push(
        or(
          like(careRequests.reference, term),
          like(patients.fullName, term),
          like(patients.recipientName, term),
          like(patients.phone, term),
          like(caregivers.fullName, term),
          like(caregivers.registrationNumber, term),
        )!,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(careRequests)
      .innerJoin(patients, eq(careRequests.patientId, patients.id))
      .innerJoin(caregivers, eq(careRequests.caregiverId, caregivers.id))
      .where(where);

    const rows = await this.db
      .select({
        id: careRequests.id,
        reference: careRequests.reference,
        status: careRequests.status,
        createdAt: careRequests.createdAt,
        updatedAt: careRequests.updatedAt,
        assignedToUserId: careRequests.assignedToUserId,
        clientId: patients.id,
        clientName: patients.fullName,
        clientStatus: patients.status,
        clientPhone: patients.phone,
        recipientName: patients.recipientName,
        registrantType: patients.registrantType,
        careStart: patients.careStart,
        caregiverId: caregivers.id,
        caregiverName: caregivers.fullName,
        caregiverRegistrationNumber: caregivers.registrationNumber,
        caregiverStatus: caregivers.status,
        caregiverDeletedAt: caregivers.deletedAt,
      })
      .from(careRequests)
      .innerJoin(patients, eq(careRequests.patientId, patients.id))
      .innerJoin(caregivers, eq(careRequests.caregiverId, caregivers.id))
      .where(where)
      // New work first, then oldest-waiting first within a status, so the
      // queue reads top-down as "what to do next".
      .orderBy(
        sql`FIELD(${careRequests.status}, 'NEW', 'IN_PROGRESS', 'INTRODUCED', 'CLOSED', 'CANCELLED')`,
        sql`CASE WHEN ${careRequests.status} IN ('NEW', 'IN_PROGRESS') THEN ${careRequests.createdAt} END ASC`,
        desc(careRequests.updatedAt),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const assignees = await this.userNames(rows.map((r) => r.assignedToUserId));
    return {
      items: rows.map(({ clientPhone, caregiverDeletedAt, assignedToUserId, ...r }) => ({
        ...r,
        // Masked in the list like the clients list; the detail shows it in full.
        clientPhone: maskPhone(clientPhone),
        caregiverDeleted: Boolean(caregiverDeletedAt),
        assignedTo: assignedToUserId ? (assignees.get(assignedToUserId) ?? null) : null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** Counts per status, plus "new and unassigned" for the sidebar badge. */
  async summary() {
    const rows = await this.db
      .select({ status: careRequests.status, n: count() })
      .from(careRequests)
      .groupBy(careRequests.status);
    const byStatus = Object.fromEntries(careRequestStatusEnum.map((s) => [s, 0])) as Record<CareRequestStatus, number>;
    for (const r of rows) byStatus[r.status] = r.n;
    return { byStatus, open: byStatus.NEW + byStatus.IN_PROGRESS, new: byStatus.NEW };
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    const map = new Map<string, { id: string; fullName: string }>();
    if (!unique.length) return map;
    const rows = await this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, unique));
    for (const r of rows) map.set(r.id, r);
    return map;
  }

  private async placeNames(cityIds: (number | null)[], districtIds: (number | null)[]) {
    const cIds = [...new Set(cityIds.filter((v): v is number => Boolean(v)))];
    const dIds = [...new Set(districtIds.filter((v): v is number => Boolean(v)))];
    const [cityRows, districtRows] = await Promise.all([
      cIds.length ? this.db.select({ id: cities.id, name: cities.nameEn }).from(cities).where(inArray(cities.id, cIds)) : Promise.resolve([] as { id: number; name: string }[]),
      dIds.length ? this.db.select({ id: districts.id, name: districts.nameEn }).from(districts).where(inArray(districts.id, dIds)) : Promise.resolve([] as { id: number; name: string }[]),
    ]);
    return {
      cities: new Map<number, string>(cityRows.map((r) => [r.id, r.name])),
      districts: new Map<number, string>(districtRows.map((r) => [r.id, r.name])),
    };
  }

  async findOne(id: string) {
    const [row] = await this.db
      .select({ request: careRequests, patient: patients, caregiver: caregivers })
      .from(careRequests)
      .innerJoin(patients, eq(careRequests.patientId, patients.id))
      .innerJoin(caregivers, eq(careRequests.caregiverId, caregivers.id))
      .where(eq(careRequests.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Request not found');
    const { request, patient, caregiver } = row;

    const accountIds = [patient.userId, caregiver.userId].filter((v): v is string => Boolean(v));
    const [accounts, events] = await Promise.all([
      accountIds.length
        ? this.db.select({ id: users.id, email: users.email, phone: users.phone }).from(users).where(inArray(users.id, accountIds))
        : Promise.resolve([] as { id: string; email: string | null; phone: string | null }[]),
      this.db.select().from(careRequestEvents).where(eq(careRequestEvents.requestId, id)).orderBy(asc(careRequestEvents.createdAt)),
    ]);
    const account = (uid: string | null) => accounts.find((a) => a.id === uid);
    const [names, places] = await Promise.all([
      this.userNames([request.assignedToUserId, ...events.map((e) => e.actorUserId)]),
      this.placeNames([patient.cityId, caregiver.cityId], [patient.districtId, caregiver.districtId]),
    ]);
    // The ids are the source of truth; the English caches on the row are only
    // filled by some write paths (self-registration stores ids alone).
    const city = (id: number | null, cache: string | null) => (id ? (places.cities.get(id) ?? cache) : cache);
    const district = (id: number | null, cache: string | null) => (id ? (places.districts.get(id) ?? cache) : cache);

    const { openPairKey, assignedToUserId, ...rest } = request;
    return {
      ...rest,
      assignedTo: assignedToUserId ? (names.get(assignedToUserId) ?? null) : null,
      allowedNextStatuses: CARE_REQUEST_STATUS_TRANSITIONS[request.status],
      client: {
        id: patient.id,
        fullName: patient.fullName,
        status: patient.status,
        email: account(patient.userId)?.email ?? null,
        phone: patient.phone,
        accountPhone: account(patient.userId)?.phone ?? null,
        alternatePhone: patient.alternatePhone,
        preferredContactMethod: patient.preferredContactMethod,
        preferredContactTime: patient.preferredContactTime,
        registrantType: patient.registrantType,
        recipientName: patient.recipientName,
        recipientRelationship: patient.recipientRelationship,
        recipientAge: patient.recipientAge,
        recipientGender: patient.recipientGender,
        district: district(patient.districtId, patient.district),
        city: city(patient.cityId, patient.city),
        careAddress: patient.careAddress,
        careNeeds: patient.careNeeds,
        careSchedule: patient.careSchedule,
        careStart: patient.careStart,
        preferredCaregiverGender: patient.preferredCaregiverGender,
      },
      caregiver: {
        id: caregiver.id,
        publicId: caregiver.publicId,
        fullName: caregiver.fullName,
        registrationNumber: caregiver.registrationNumber,
        status: caregiver.status,
        deleted: Boolean(caregiver.deletedAt),
        gender: caregiver.gender,
        primaryPhone: caregiver.primaryPhone,
        secondaryPhone: caregiver.secondaryPhone,
        email: account(caregiver.userId)?.email ?? null,
        district: district(caregiver.districtId, caregiver.district),
        city: city(caregiver.cityId, caregiver.city),
      },
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        closeReason: e.closeReason,
        note: e.note,
        createdAt: e.createdAt,
        actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
      })),
    };
  }

  async updateStatus(id: string, dto: UpdateCareRequestStatusDto, actor: AuthenticatedUser) {
    const [current] = await this.db
      .select({ status: careRequests.status, assignedToUserId: careRequests.assignedToUserId })
      .from(careRequests)
      .where(eq(careRequests.id, id))
      .limit(1);
    if (!current) throw new NotFoundException('Request not found');
    if (!CARE_REQUEST_STATUS_TRANSITIONS[current.status].includes(dto.status)) {
      throw new BadRequestException('This request cannot be moved to that status');
    }

    const now = new Date();
    const terminal = dto.status === 'CLOSED';
    try {
      await this.db.transaction(async (tx) => {
        const result = await tx
          .update(careRequests)
          .set({
            status: dto.status,
            closeReason: terminal ? dto.closeReason : null,
            closedAt: terminal ? now : null,
            updatedAt: now,
            // Picking a request up makes it yours, unless someone already has it.
            ...(dto.status === 'IN_PROGRESS' && !current.assignedToUserId ? { assignedToUserId: actor.userId } : {}),
          })
          // Guarded on the status that was read, so two staff moving the same
          // request at once cannot both "win" from the same starting point.
          .where(and(eq(careRequests.id, id), eq(careRequests.status, current.status)));
        if ((result as unknown as [{ affectedRows: number }])[0]?.affectedRows === 0) {
          throw new ConflictException('This request was just changed by someone else - reload and try again');
        }
        await tx.insert(careRequestEvents).values({
          id: uuid(),
          requestId: id,
          type: 'STATUS_CHANGED',
          fromStatus: current.status,
          toStatus: dto.status,
          closeReason: terminal ? dto.closeReason : null,
          note: dto.note ?? null,
          actorUserId: actor.userId,
        });
      });
    } catch (err) {
      // Reopening a closed request recreates its open pair key - which collides
      // if the client has since opened a new request for the same caregiver.
      if (isDuplicate(err, 'care_requests_open_pair_unique')) {
        throw new ConflictException('The client already has another open request for this caregiver');
      }
      throw err;
    }

    void this.notifier.statusChanged(id, dto.status);
    return this.findOne(id);
  }

  async addNote(id: string, note: string, actor: AuthenticatedUser) {
    if (!note?.trim()) throw new BadRequestException('Write a note first');
    const [exists] = await this.db.select({ id: careRequests.id }).from(careRequests).where(eq(careRequests.id, id)).limit(1);
    if (!exists) throw new NotFoundException('Request not found');
    await this.db.transaction(async (tx) => {
      await tx.insert(careRequestEvents).values({ id: uuid(), requestId: id, type: 'NOTE', note: note.trim(), actorUserId: actor.userId });
      await tx.update(careRequests).set({ updatedAt: new Date() }).where(eq(careRequests.id, id));
    });
    return this.findOne(id);
  }

  async assign(id: string, userId: string | null, actor: AuthenticatedUser) {
    const [exists] = await this.db.select({ id: careRequests.id }).from(careRequests).where(eq(careRequests.id, id)).limit(1);
    if (!exists) throw new NotFoundException('Request not found');
    let assignee: { id: string; fullName: string } | null = null;
    if (userId) {
      const [u] = await this.db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(and(eq(users.id, userId), inArray(users.role, ['ADMIN', 'STAFF']), eq(users.isActive, true)))
        .limit(1);
      if (!u) throw new BadRequestException('Requests can only be assigned to an active staff member');
      assignee = u;
    }
    await this.db.transaction(async (tx) => {
      await tx.update(careRequests).set({ assignedToUserId: assignee?.id ?? null, updatedAt: new Date() }).where(eq(careRequests.id, id));
      await tx.insert(careRequestEvents).values({
        id: uuid(),
        requestId: id,
        type: 'ASSIGNED',
        // The assignee's name, recorded at the time, so the history still reads
        // correctly if that account is later renamed or removed.
        note: assignee ? assignee.fullName : null,
        actorUserId: actor.userId,
      });
    });
    return this.findOne(id);
  }

  /** Active admin and staff accounts a request can be assigned to. */
  async assignableStaff() {
    return this.db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(and(inArray(users.role, ['ADMIN', 'STAFF']), eq(users.isActive, true)))
      .orderBy(asc(users.fullName));
  }
}
