import { HttpException, Inject, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { and, eq, isNull, like, or } from 'drizzle-orm';
import { colomboToday, isValidDate, type AssistantLink, type SearchRequest } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../../database/database.module';
import { bookings, careRequests, caregivers, districts, patients } from '../../database/schema';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CareRequestsService } from '../../care-requests/care-requests.service';
import { BookingsService } from '../../bookings/bookings.service';
import { CareRequestQueryDto } from '../../care-requests/dto/care-request-query.dto';
import { UpdateCareRequestStatusDto } from '../../care-requests/dto/update-care-request-status.dto';
import { CreateStaffCareRequestDto } from '../../care-requests/dto/create-staff-care-request.dto';
import { BookingQueryDto, CreateBookingDto } from '../../bookings/dto/booking.dto';
import { AiMatchingService } from '../ai-matching.service';

/** A tool was called with arguments that cannot work. The message goes back to the model to correct. */
export class ToolInputError extends Error {}

export interface ReadResult {
  data: unknown;
  links: AssistantLink[];
}

export interface Proposal {
  /** Normalised, validated arguments - what execute() will run with. */
  args: Record<string, unknown>;
  summary: string;
  details: { label: string; value: string }[];
}

export interface ExecutionResult {
  kind: 'request' | 'booking';
  id: string;
  reference: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CLOSE_REASONS: Record<string, string> = {
  CLIENT_NOT_PROCEEDING: 'client not proceeding',
  CLIENT_UNREACHABLE: 'client unreachable',
  CAREGIVER_UNAVAILABLE: 'caregiver unavailable',
  CAREGIVER_DECLINED: 'caregiver declined',
  NOT_A_MATCH: 'not a match',
  PLACED: 'placed',
  OTHER: 'other',
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function limitOf(v: unknown, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

async function validated<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<T> {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: false });
  if (errors.length) {
    const messages = errors.flatMap((e) => [...Object.values(e.constraints ?? {}), ...(e.children ?? []).flatMap((c) => Object.values(c.constraints ?? {}))]);
    throw new ToolInputError(messages.join('; ') || 'Invalid arguments');
  }
  return instance;
}

/**
 * What the assistant's tools actually do. Reads go through the same services
 * as the staff pages and are trimmed to what the model needs - no phone
 * numbers, emails, addresses or ID numbers ever reach the model. Writes are
 * split in two: propose() validates and describes (no side effects), and
 * execute() - only after a staff member approves - calls the same service
 * method the staff page would, as that staff member.
 */
@Injectable()
export class AssistantToolbox {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly requests: CareRequestsService,
    private readonly bookingsService: BookingsService,
    private readonly matching: AiMatchingService,
  ) {}

  // --- resolving references ------------------------------------------------------

  private async requestByRef(value: unknown): Promise<{ id: string; reference: string }> {
    const v = str(value);
    if (!v) throw new ToolInputError('Give the request reference (CR-...) or id');
    const [row] = await this.db
      .select({ id: careRequests.id, reference: careRequests.reference })
      .from(careRequests)
      .where(UUID.test(v) ? eq(careRequests.id, v) : eq(careRequests.reference, v.toUpperCase()))
      .limit(1);
    if (!row) throw new ToolInputError(`No request found for "${v}"`);
    return row;
  }

  private async bookingByRef(value: unknown): Promise<{ id: string; reference: string }> {
    const v = str(value);
    if (!v) throw new ToolInputError('Give the booking reference (BK-...) or id');
    const [row] = await this.db
      .select({ id: bookings.id, reference: bookings.reference })
      .from(bookings)
      .where(UUID.test(v) ? eq(bookings.id, v) : eq(bookings.reference, v.toUpperCase()))
      .limit(1);
    if (!row) throw new ToolInputError(`No booking found for "${v}"`);
    return row;
  }

  private async caregiverLabel(id: string): Promise<string> {
    if (!UUID.test(id)) throw new ToolInputError('caregiver_id must be a caregiver id - look it up with find_caregivers or suggest_caregivers_for_request');
    const [row] = await this.db
      .select({ fullName: caregivers.fullName, registrationNumber: caregivers.registrationNumber, deletedAt: caregivers.deletedAt })
      .from(caregivers)
      .where(eq(caregivers.id, id))
      .limit(1);
    if (!row || row.deletedAt) throw new ToolInputError('That caregiver does not exist or has been removed');
    return `${row.fullName} (${row.registrationNumber})`;
  }

  private async clientLabel(id: string): Promise<string> {
    if (!UUID.test(id)) throw new ToolInputError('client_id must be a client id - look it up with find_clients');
    const [row] = await this.db.select({ fullName: patients.fullName, recipientName: patients.recipientName }).from(patients).where(eq(patients.id, id)).limit(1);
    if (!row) throw new ToolInputError('That client does not exist');
    return row.recipientName && row.recipientName !== row.fullName ? `${row.fullName} (care for ${row.recipientName})` : row.fullName;
  }

  // --- reads ---------------------------------------------------------------------

  async read(name: string, args: Record<string, unknown>, actor: AuthenticatedUser): Promise<ReadResult> {
    switch (name) {
      case 'work_summary': {
        const [req, book] = await Promise.all([this.requests.summary(), this.bookingsService.summary()]);
        return { data: { requests: req, bookings: book }, links: [] };
      }
      case 'list_requests': {
        const query = plainToInstance(CareRequestQueryDto, {
          status: str(args.status),
          scope: args.open_only ? 'open' : undefined,
          unmatched: args.unmatched === true ? true : undefined,
          assigned: args.assigned === 'me' || args.assigned === 'unassigned' ? args.assigned : undefined,
          search: str(args.search)?.slice(0, 100),
          page: 1,
          pageSize: limitOf(args.limit, 20, 10),
        });
        const result = await this.requests.findAll(query, actor);
        return {
          data: {
            total: result.total,
            items: result.items.map((r) => ({
              id: r.id,
              reference: r.reference,
              status: r.status,
              source: r.source,
              createdAt: r.createdAt,
              client: { id: r.clientId, name: r.clientName, careRecipient: r.recipientName, status: r.clientStatus, careStart: r.careStart },
              caregiver: r.caregiverId ? { id: r.caregiverId, name: r.caregiverName, registrationNumber: r.caregiverRegistrationNumber, status: r.caregiverStatus } : null,
              assignedTo: r.assignedTo?.fullName ?? null,
            })),
          },
          links: result.items.slice(0, 5).map((r) => ({ kind: 'request' as const, id: r.id, label: `${r.reference} · ${r.recipientName || r.clientName}` })),
        };
      }
      case 'get_request': {
        const { id } = await this.requestByRef(args.request);
        const r = await this.requests.findOne(id);
        const c = r.client;
        return {
          data: {
            id: r.id,
            reference: r.reference,
            status: r.status,
            source: r.source,
            language: r.language,
            message: r.message,
            closeReason: r.closeReason,
            createdAt: r.createdAt,
            assignedTo: r.assignedTo?.fullName ?? null,
            allowedNextStatuses: r.allowedNextStatuses,
            canChangeCaregiver: r.canChangeCaregiver,
            client: {
              id: c.id,
              name: c.fullName,
              status: c.status,
              registrantType: c.registrantType,
              careRecipient: c.recipientName,
              relationship: c.recipientRelationship,
              recipientAge: c.recipientAge,
              recipientGender: c.recipientGender,
              district: c.district,
              city: c.city,
              careNeeds: c.careNeeds,
              careSchedule: c.careSchedule,
              careStart: c.careStart,
              preferredCaregiverGender: c.preferredCaregiverGender,
              preferredContactMethod: c.preferredContactMethod,
              preferredContactTime: c.preferredContactTime,
            },
            caregiver: r.caregiver
              ? { id: r.caregiver.id, name: r.caregiver.fullName, registrationNumber: r.caregiver.registrationNumber, status: r.caregiver.status, removed: r.caregiver.deleted, district: r.caregiver.district }
              : null,
            history: r.events.slice(-10).map((e) => ({ type: e.type, from: e.fromStatus, to: e.toStatus, closeReason: e.closeReason, note: e.note, at: e.createdAt, by: e.actor?.fullName ?? null })),
          },
          links: [
            { kind: 'request', id: r.id, label: r.reference },
            ...(r.caregiver ? [{ kind: 'caregiver' as const, id: r.caregiver.id, label: r.caregiver.fullName }] : []),
          ],
        };
      }
      case 'list_bookings': {
        const req = str(args.request) ? await this.requestByRef(args.request) : null;
        const query = plainToInstance(BookingQueryDto, {
          status: str(args.status),
          search: str(args.search)?.slice(0, 100),
          patientId: str(args.client_id),
          caregiverId: str(args.caregiver_id),
          careRequestId: req?.id,
          page: 1,
          pageSize: limitOf(args.limit, 20, 10),
        });
        const result = await this.bookingsService.findAll(query);
        return {
          data: {
            total: result.total,
            items: result.items.map((b) => ({
              id: b.id,
              reference: b.reference,
              status: b.status,
              scheduleType: b.scheduleType,
              days: String(b.daysOfWeek).split(',').map((d) => DAY_NAMES[Number(d)]).join(' '),
              time: `${b.shiftStartTime}-${b.shiftEndTime}`,
              from: b.startDate,
              to: b.endDate,
              client: { id: b.clientId, name: b.clientName, careRecipient: b.recipientName },
              caregiver: { id: b.caregiverId, name: b.caregiverName, registrationNumber: b.caregiverRegistrationNumber },
              nextShiftAt: b.nextShiftAt,
            })),
          },
          links: result.items.slice(0, 5).map((b) => ({ kind: 'booking' as const, id: b.id, label: `${b.reference} · ${b.recipientName || b.clientName}` })),
        };
      }
      case 'get_booking': {
        const { id } = await this.bookingByRef(args.booking);
        const b = await this.bookingsService.findOne(id);
        const now = Date.now();
        const upcoming = b.shifts.filter((s) => new Date(s.endsAt).getTime() > now && s.status !== 'CANCELLED');
        return {
          data: {
            id: b.id,
            reference: b.reference,
            status: b.status,
            careRequest: b.careRequest,
            client: b.client ? { id: b.client.id, name: b.client.fullName, careRecipient: b.client.recipientName, district: b.client.district, city: b.client.city } : null,
            caregiver: b.caregiver ? { id: b.caregiver.id, name: b.caregiver.fullName, registrationNumber: b.caregiver.registrationNumber, status: b.caregiver.status } : null,
            pattern: {
              scheduleType: b.scheduleType,
              days: b.daysOfWeek.map((d: number) => DAY_NAMES[d]).join(' '),
              shiftStart: b.shiftStartTime,
              shiftEnd: b.shiftEndTime,
              startDate: b.startDate,
              endDate: b.endDate,
            },
            clientRate: b.rateType ? `${b.rateAmount} LKR ${b.rateType.toLowerCase()}` : null,
            payRate: b.payRateType ? `${b.payRateAmount} LKR ${b.payRateType.toLowerCase()}` : null,
            estimate: b.estimate,
            shiftCount: b.shifts.length,
            blockingConflicts: b.blockingConflicts,
            nextShifts: upcoming.slice(0, 5).map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, caregiver: s.caregiver?.fullName ?? null, conflicts: s.conflicts.length })),
            notes: b.notes,
            history: b.events.slice(-8).map((e) => ({ type: e.type, note: e.note, at: e.createdAt, by: e.actor?.fullName ?? null })),
          },
          links: [{ kind: 'booking', id: b.id, label: b.reference }],
        };
      }
      case 'find_clients': {
        const term = str(args.search);
        if (!term) throw new ToolInputError('Give a name or phone number to search for');
        const like_ = `%${term.slice(0, 100)}%`;
        const rows = await this.db
          .select({
            id: patients.id,
            fullName: patients.fullName,
            recipientName: patients.recipientName,
            status: patients.status,
            district: districts.nameEn,
            careSchedule: patients.careSchedule,
          })
          .from(patients)
          .leftJoin(districts, eq(patients.districtId, districts.id))
          .where(or(like(patients.fullName, like_), like(patients.recipientName, like_), like(patients.phone, like_)))
          .limit(10);
        return {
          data: rows.map((r) => ({ id: r.id, name: r.fullName, careRecipient: r.recipientName, status: r.status, district: r.district, careSchedule: r.careSchedule })),
          links: rows.slice(0, 5).map((r) => ({ kind: 'client' as const, id: r.id, label: r.fullName })),
        };
      }
      case 'find_caregivers': {
        const term = str(args.search);
        if (!term) throw new ToolInputError('Give a name or registration number to search for');
        const like_ = `%${term.slice(0, 100)}%`;
        const rows = await this.db
          .select({ id: caregivers.id, fullName: caregivers.fullName, registrationNumber: caregivers.registrationNumber, status: caregivers.status, district: districts.nameEn })
          .from(caregivers)
          .leftJoin(districts, eq(caregivers.districtId, districts.id))
          .where(and(isNull(caregivers.deletedAt), or(like(caregivers.fullName, like_), like(caregivers.registrationNumber, like_))))
          .limit(10);
        return {
          data: rows,
          links: rows.slice(0, 5).map((r) => ({ kind: 'caregiver' as const, id: r.id, label: r.fullName })),
        };
      }
      case 'suggest_caregivers_for_request': {
        const { id, reference } = await this.requestByRef(args.request);
        const result = await this.matching.suggestForRequest(id, limitOf(args.limit, 10, 5));
        return { data: { request: reference, ...this.compactSuggestions(result) }, links: this.suggestionLinks(result.items) };
      }
      case 'search_matching_caregivers': {
        const base: SearchRequest = { page: 1, pageSize: 10, locale: 'en' };
        const districtName = str(args.district);
        if (districtName) {
          const [d] = await this.db.select({ id: districts.id }).from(districts).where(eq(districts.nameEn, districtName)).limit(1);
          if (!d) throw new ToolInputError(`Unknown district "${districtName}" - use the English district name`);
          base.location = { districtId: d.id };
        }
        if (['DAY', 'NIGHT', 'TWENTY_FOUR_HOUR_LIVE_IN', 'FLEXIBLE'].includes(String(args.shift))) base.shift = args.shift as SearchRequest['shift'];
        if (['MALE', 'FEMALE', 'ANY'].includes(String(args.caregiver_gender))) base.caregiverGenderPreference = args.caregiver_gender as SearchRequest['caregiverGenderPreference'];
        const start = str(args.start_date);
        if (start && isValidDate(start) && start >= colomboToday()) base.desiredStartDate = start;
        const result = await this.matching.suggest(base, str(args.needs) ?? '', limitOf(args.limit, 10, 5));
        return { data: this.compactSuggestions(result), links: this.suggestionLinks(result.items) };
      }
      case 'list_staff': {
        return { data: (await this.requests.assignableStaff()).map((u) => ({ ...u, isMe: u.id === actor.userId })), links: [] };
      }
      default:
        throw new ToolInputError(`Unknown tool ${name}`);
    }
  }

  private compactSuggestions(result: Awaited<ReturnType<AiMatchingService['suggest']>>) {
    return {
      criteria: result.criteria,
      aiRanked: result.aiRanked,
      caregivers: result.items.map((c) => ({
        id: c.caregiverId,
        name: c.fullName,
        registrationNumber: c.registrationNumber,
        district: c.district,
        yearsExperience: c.yearsExperience,
        skills: c.skills.slice(0, 8),
        languages: c.languages,
        shifts: [c.dayDuty && 'day', c.nightDuty && 'night', c.liveIn24h && 'live-in'].filter(Boolean),
        verifiedQualification: c.hasVerifiedQualification,
        why: c.aiReason ?? c.reasons.slice(0, 3).join('; '),
      })),
    };
  }

  private suggestionLinks(items: { caregiverId: string; fullName: string }[]): AssistantLink[] {
    return items.slice(0, 5).map((c) => ({ kind: 'caregiver', id: c.caregiverId, label: c.fullName }));
  }

  // --- writes: propose -------------------------------------------------------------

  async propose(name: string, args: Record<string, unknown>, actor: AuthenticatedUser): Promise<Proposal> {
    switch (name) {
      case 'update_request_status': {
        const req = await this.requestByRef(args.request);
        const dto = await validated(UpdateCareRequestStatusDto, { status: str(args.status), closeReason: str(args.close_reason), note: str(args.note) });
        const current = await this.requests.findOne(req.id);
        if (!current.allowedNextStatuses.includes(dto.status)) {
          throw new ToolInputError(`${req.reference} is ${current.status}; it can move to: ${current.allowedNextStatuses.join(', ') || 'nothing'}`);
        }
        const status = dto.status === 'CLOSED' ? `CLOSED (${CLOSE_REASONS[dto.closeReason!] ?? dto.closeReason})` : dto.status;
        return {
          args: { requestId: req.id, reference: req.reference, status: dto.status, closeReason: dto.closeReason ?? null, note: dto.note ?? null },
          summary: `Move request ${req.reference} from ${current.status} to ${status}`,
          details: [{ label: 'Request', value: req.reference }, { label: 'New status', value: status }, ...(dto.note ? [{ label: 'Note', value: dto.note }] : [])],
        };
      }
      case 'add_request_note': {
        const req = await this.requestByRef(args.request);
        const note = str(args.note);
        if (!note) throw new ToolInputError('Write the note');
        if (note.length > 2000) throw new ToolInputError('Notes must be 2000 characters or fewer');
        return { args: { requestId: req.id, reference: req.reference, note }, summary: `Add a note to request ${req.reference}`, details: [{ label: 'Note', value: note }] };
      }
      case 'assign_request': {
        const req = await this.requestByRef(args.request);
        const raw = str(args.assignee)?.toLowerCase();
        if (!raw) throw new ToolInputError('Say who to assign it to: "me", a user id from list_staff, or "none"');
        let userId: string | null;
        let label: string;
        if (raw === 'none' || raw === 'unassign' || raw === 'nobody') {
          userId = null;
          label = 'nobody (unassigned)';
        } else {
          userId = raw === 'me' ? actor.userId : str(args.assignee)!;
          const staff = await this.requests.assignableStaff();
          const person = staff.find((s) => s.id === userId);
          if (!person) throw new ToolInputError('That user is not active staff - pick an id from list_staff');
          label = person.id === actor.userId ? `${person.fullName} (you)` : person.fullName;
        }
        return { args: { requestId: req.id, reference: req.reference, userId }, summary: `Assign request ${req.reference} to ${label}`, details: [{ label: 'Assign to', value: label }] };
      }
      case 'set_request_caregiver': {
        const req = await this.requestByRef(args.request);
        const raw = str(args.caregiver_id);
        if (!raw) throw new ToolInputError('Give the caregiver id, or "none" to detach');
        const detach = raw.toLowerCase() === 'none';
        const label = detach ? 'no caregiver' : await this.caregiverLabel(raw);
        const current = await this.requests.findOne(req.id);
        if (!current.canChangeCaregiver) throw new ToolInputError(`${req.reference} is ${current.status}; the caregiver can only be changed while it is NEW or IN_PROGRESS`);
        return {
          args: { requestId: req.id, reference: req.reference, caregiverId: detach ? null : raw },
          summary: detach ? `Detach the caregiver from request ${req.reference}` : `Attach ${label} to request ${req.reference}`,
          details: [{ label: 'Caregiver', value: label }],
        };
      }
      case 'create_request': {
        const clientId = str(args.client_id) ?? '';
        const clientLabel = await this.clientLabel(clientId);
        const caregiverId = str(args.caregiver_id);
        const caregiverLabel = caregiverId ? await this.caregiverLabel(caregiverId) : null;
        const dto = await validated(CreateStaffCareRequestDto, { patientId: clientId, caregiverId, message: str(args.message), language: str(args.language) });
        return {
          args: { patientId: dto.patientId, caregiverId: dto.caregiverId ?? null, message: dto.message ?? null, language: dto.language },
          summary: `Log a new request for ${clientLabel}${caregiverLabel ? ` with ${caregiverLabel}` : ''}`,
          details: [
            { label: 'Client', value: clientLabel },
            { label: 'Caregiver', value: caregiverLabel ?? 'match later' },
            ...(dto.message ? [{ label: 'Message', value: dto.message }] : []),
            { label: 'Updates in', value: { en: 'English', si: 'Sinhala', ta: 'Tamil' }[dto.language] },
          ],
        };
      }
      case 'create_booking': {
        const req = str(args.request) ? await this.requestByRef(args.request) : null;
        const plain = {
          careRequestId: req?.id,
          patientId: str(args.client_id),
          caregiverId: str(args.caregiver_id),
          scheduleType: str(args.schedule_type),
          daysOfWeek: Array.isArray(args.days_of_week) ? args.days_of_week.map(Number) : args.days_of_week,
          shiftStartTime: str(args.shift_start),
          shiftEndTime: str(args.shift_end),
          startDate: str(args.start_date),
          endDate: str(args.end_date),
          rateType: str(args.rate_type),
          rateAmount: args.rate_amount !== undefined && args.rate_amount !== null ? String(args.rate_amount) : undefined,
          payRateType: str(args.pay_rate_type),
          payRateAmount: args.pay_rate_amount !== undefined && args.pay_rate_amount !== null ? String(args.pay_rate_amount) : undefined,
          notes: str(args.notes),
        };
        const dto = await validated(CreateBookingDto, plain);
        if (dto.endDate < dto.startDate) throw new ToolInputError('end_date must be on or after start_date');

        let clientId = dto.patientId ?? null;
        let caregiverId = dto.caregiverId ?? null;
        if (req) {
          const r = await this.requests.findOne(req.id);
          if (r.status === 'CLOSED' || r.status === 'CANCELLED') throw new ToolInputError(`${req.reference} is ${r.status} - reopen it or book directly`);
          clientId = r.client.id;
          caregiverId = caregiverId ?? r.caregiver?.id ?? null;
        }
        if (!clientId) throw new ToolInputError('Give the request, or the client_id');
        if (!caregiverId) throw new ToolInputError('Give caregiver_id - the request has no caregiver attached');
        const [clientLabel, caregiverLabel] = await Promise.all([this.clientLabel(clientId), this.caregiverLabel(caregiverId)]);
        const days = [...new Set(dto.daysOfWeek)].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(' ');
        return {
          args: { ...plain, caregiverId, patientId: req ? undefined : clientId, requestReference: req?.reference ?? null },
          summary: `Create a draft booking for ${clientLabel} with ${caregiverLabel}, ${dto.startDate} to ${dto.endDate}`,
          details: [
            ...(req ? [{ label: 'Request', value: req.reference }] : []),
            { label: 'Client', value: clientLabel },
            { label: 'Caregiver', value: caregiverLabel },
            { label: 'Schedule', value: `${dto.scheduleType}, ${days}, ${dto.shiftStartTime}-${dto.shiftEndTime}` },
            { label: 'Dates', value: `${dto.startDate} to ${dto.endDate}` },
            ...(dto.rateType ? [{ label: 'Client rate', value: `${dto.rateAmount} LKR ${dto.rateType.toLowerCase()}` }] : []),
            ...(dto.payRateType ? [{ label: 'Caregiver pay', value: `${dto.payRateAmount} LKR ${dto.payRateType.toLowerCase()}` }] : []),
            ...(dto.notes ? [{ label: 'Notes', value: dto.notes }] : []),
          ],
        };
      }
      case 'confirm_booking': {
        const b = await this.bookingByRef(args.booking);
        const full = await this.bookingsService.findOne(b.id);
        if (full.status !== 'DRAFT') throw new ToolInputError(`${b.reference} is ${full.status}; only a DRAFT booking can be confirmed`);
        if (full.blockingConflicts > 0) throw new ToolInputError(`${b.reference} has ${full.blockingConflicts} clashing shift(s) - resolve them on the booking page first`);
        return {
          args: { bookingId: b.id, reference: b.reference },
          summary: `Confirm booking ${b.reference} (${full.shifts.length} shifts) and notify the client and caregiver`,
          details: [
            { label: 'Client', value: full.client?.recipientName || full.client?.fullName || '-' },
            { label: 'Caregiver', value: full.caregiver?.fullName ?? '-' },
            { label: 'Dates', value: `${full.startDate} to ${full.endDate}` },
          ],
        };
      }
      case 'cancel_booking': {
        const b = await this.bookingByRef(args.booking);
        const reason = str(args.reason);
        if (!reason) throw new ToolInputError('Say why the booking is being cancelled');
        if (reason.length > 500) throw new ToolInputError('Keep the reason under 500 characters');
        const full = await this.bookingsService.findOne(b.id);
        if (full.status === 'CANCELLED' || full.status === 'COMPLETED') throw new ToolInputError(`${b.reference} is already ${full.status}`);
        return {
          args: { bookingId: b.id, reference: b.reference, reason },
          summary: `Cancel booking ${b.reference} and notify the client and caregiver`,
          details: [{ label: 'Reason', value: reason }],
        };
      }
      case 'extend_booking': {
        const b = await this.bookingByRef(args.booking);
        const endDate = str(args.end_date);
        if (!endDate || !isValidDate(endDate)) throw new ToolInputError('Give the new end date as YYYY-MM-DD');
        const full = await this.bookingsService.findOne(b.id);
        if (endDate <= full.endDate) throw new ToolInputError(`${b.reference} already runs to ${full.endDate}; the new end date must be later`);
        return {
          args: { bookingId: b.id, reference: b.reference, endDate },
          summary: `Extend booking ${b.reference} from ${full.endDate} to ${endDate}`,
          details: [{ label: 'New end date', value: endDate }],
        };
      }
      case 'add_booking_note': {
        const b = await this.bookingByRef(args.booking);
        const note = str(args.note);
        if (!note) throw new ToolInputError('Write the note');
        if (note.length > 2000) throw new ToolInputError('Notes must be 2000 characters or fewer');
        return { args: { bookingId: b.id, reference: b.reference, note }, summary: `Add a note to booking ${b.reference}`, details: [{ label: 'Note', value: note }] };
      }
      default:
        throw new ToolInputError(`Unknown tool ${name}`);
    }
  }

  // --- writes: execute (after approval) --------------------------------------------

  async execute(name: string, a: Record<string, any>, actor: AuthenticatedUser): Promise<ExecutionResult> {
    switch (name) {
      case 'update_request_status': {
        const dto = await validated(UpdateCareRequestStatusDto, { status: a.status, closeReason: a.closeReason ?? undefined, note: a.note ?? undefined });
        await this.requests.updateStatus(a.requestId, dto, actor);
        return { kind: 'request', id: a.requestId, reference: a.reference };
      }
      case 'add_request_note':
        await this.requests.addNote(a.requestId, a.note, actor);
        return { kind: 'request', id: a.requestId, reference: a.reference };
      case 'assign_request':
        await this.requests.assign(a.requestId, a.userId ?? null, actor);
        return { kind: 'request', id: a.requestId, reference: a.reference };
      case 'set_request_caregiver':
        await this.requests.setCaregiver(a.requestId, a.caregiverId ?? null, actor);
        return { kind: 'request', id: a.requestId, reference: a.reference };
      case 'create_request': {
        const dto = await validated(CreateStaffCareRequestDto, {
          patientId: a.patientId,
          caregiverId: a.caregiverId ?? undefined,
          message: a.message ?? undefined,
          language: a.language,
        });
        const created = (await this.requests.createByStaff(dto, actor)) as { id: string; reference?: string };
        return { kind: 'request', id: created.id, reference: created.reference ?? null };
      }
      case 'create_booking': {
        const { requestReference, ...plain } = a;
        const dto = await validated(CreateBookingDto, plain);
        const created = await this.bookingsService.create(dto, actor);
        return { kind: 'booking', id: created.id, reference: created.reference };
      }
      case 'confirm_booking':
        await this.bookingsService.confirm(a.bookingId, actor);
        return { kind: 'booking', id: a.bookingId, reference: a.reference };
      case 'cancel_booking':
        await this.bookingsService.cancel(a.bookingId, a.reason, actor);
        return { kind: 'booking', id: a.bookingId, reference: a.reference };
      case 'extend_booking':
        await this.bookingsService.extend(a.bookingId, a.endDate, actor);
        return { kind: 'booking', id: a.bookingId, reference: a.reference };
      case 'add_booking_note':
        await this.bookingsService.addNote(a.bookingId, a.note, actor);
        return { kind: 'booking', id: a.bookingId, reference: a.reference };
      default:
        // Only tools this service proposed are ever stored, so this is a programming error.
        throw new Error(`Unknown assistant action ${name}`);
    }
  }
}

/** The text a failed service call leaves for staff and the model - the service's own message. */
export function errorMessage(err: unknown): string {
  if (err instanceof ToolInputError) return err.message;
  if (err instanceof HttpException) {
    const res = err.getResponse();
    if (typeof res === 'string') return res;
    const message = (res as { message?: unknown }).message;
    return Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : err.message;
  }
  return 'Something went wrong';
}
