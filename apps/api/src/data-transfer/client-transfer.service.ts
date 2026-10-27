import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, like, or, type SQL } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  careScheduleEnum,
  caregivers,
  careStartEnum,
  caregiverGenderPreferenceEnum,
  contactMethodEnum,
  contactTimeEnum,
  genderEnum,
  patients,
  recipientGenderEnum,
  recipientRelationshipEnum,
  registrantTypeEnum,
  users,
} from '../database/schema';
import { resolveLocationRefs } from '../common/utils/location.util';
import { normalizePhone, phoneVariants } from '../common/utils/phone.util';
import { assertWhatsappNumberAvailable } from '../auth/phone-accounts.util';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { headerKey, parseDate, parseEnum, readCsv, toCsv, type CsvColumn } from './csv.util';
import { LocationMatcher, MAX_IMPORT_ROWS, textCell, type ColumnSpec, type ImportIssue, type ImportReport, type ImportRowResult } from './import-types';
import type { ClientExportDto } from './dto/transfer.dto';

/**
 * The client spreadsheet: one row per client (the account holder - a patient,
 * or the family member arranging care - and, for a guardian, who the care is
 * for). Same columns out and in; export-only columns are ignored on import.
 */
export const CLIENT_COLUMNS: ColumnSpec[] = [
  { key: 'fullName', header: 'Full name', required: true, max: 255 },
  { key: 'email', header: 'Email', max: 255 },
  { key: 'phone', header: 'Phone', max: 20 },
  { key: 'alternatePhone', header: 'Alternate phone', max: 20 },
  { key: 'status', header: 'Status' },
  { key: 'preferredContactMethod', header: 'Preferred contact' },
  { key: 'preferredContactTime', header: 'Preferred contact time' },
  { key: 'registrantType', header: 'Registering for' },
  { key: 'recipientName', header: 'Care recipient name', max: 255 },
  { key: 'recipientRelationship', header: 'Care recipient relationship' },
  { key: 'recipientAge', header: 'Care recipient age' },
  { key: 'recipientGender', header: 'Care recipient gender' },
  { key: 'nic', header: 'NIC', max: 20 },
  { key: 'dateOfBirth', header: 'Date of birth' },
  { key: 'gender', header: 'Gender' },
  { key: 'permanentAddress', header: 'Address', max: 2000 },
  { key: 'district', header: 'District' },
  { key: 'city', header: 'City' },
  { key: 'careAddress', header: 'Care address', max: 500 },
  { key: 'careNeeds', header: 'Care needs', max: 5000 },
  { key: 'careSchedule', header: 'Care schedule' },
  { key: 'careStart', header: 'Care start' },
  { key: 'preferredCaregiverGender', header: 'Preferred caregiver gender' },
  { key: 'notes', header: 'Staff notes', max: 2000 },
  { key: 'verified', header: 'Verified', exportOnly: true },
  { key: 'createdAt', header: 'Created', exportOnly: true },
];

/** Statuses an import may set. Suspension is a decision about a real client, not something to bulk-load. */
const IMPORT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

const col = (key: string) => CLIENT_COLUMNS.find((c) => c.key === key)!;
const keyOf = (c: ColumnSpec) => headerKey(c.header);

const TEMPLATE_EXAMPLE: Record<string, string> = {
  fullName: 'Example Silva',
  email: 'example.silva@example.com',
  phone: '0771234567',
  status: 'ACTIVE',
  preferredContactMethod: 'PHONE_CALL',
  preferredContactTime: 'MORNING',
  registrantType: 'GUARDIAN',
  recipientName: 'Kamala Silva',
  recipientRelationship: 'PARENT',
  recipientAge: '78',
  recipientGender: 'FEMALE',
  district: 'Colombo',
  city: 'Dehiwala',
  careAddress: '45 Galle Road, Dehiwala',
  careNeeds: 'Help with bathing and meals; mild dementia',
  careSchedule: 'DAY',
  careStart: 'WITHIN_MONTH',
  preferredCaregiverGender: 'FEMALE',
};

interface PreparedClient {
  fullName: string;
  email: string | null;
  e164: string | null;
  patient: Omit<typeof patients.$inferInsert, 'id' | 'userId' | 'fullName'>;
}

@Injectable()
export class ClientTransferService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly whatsappSettings: WhatsappSettingsService,
  ) {}

  template(): string {
    const columns = CLIENT_COLUMNS.filter((c) => !c.exportOnly);
    return toCsv<Record<string, string>>(
      columns.map((c) => ({ header: c.header, value: (r) => r[c.key] ?? '' })),
      [TEMPLATE_EXAMPLE],
    );
  }

  async export(filter: ClientExportDto): Promise<{ csv: string; count: number }> {
    const conditions: SQL[] = [];
    if (filter.search) {
      const term = `%${filter.search}%`;
      conditions.push(or(like(patients.fullName, term), like(patients.recipientName, term), like(patients.phone, term), like(users.phone, term), like(users.email, term))!);
    }
    if (filter.status) conditions.push(eq(patients.status, filter.status));
    if (filter.districtId) conditions.push(eq(patients.districtId, filter.districtId));

    const rows = await this.db
      .select({ p: patients, email: users.email, accountPhone: users.phone, emailVerifiedAt: users.emailVerifiedAt, phoneVerifiedAt: users.phoneVerifiedAt })
      .from(patients)
      .innerJoin(users, eq(patients.userId, users.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(patients.fullName));

    const day = (d: Date | string | null) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : '');
    const data: Record<string, unknown>[] = rows.map(({ p, email, accountPhone, emailVerifiedAt, phoneVerifiedAt }) => ({
      ...p,
      email: email ?? '',
      phone: p.phone ?? accountPhone ?? '',
      dateOfBirth: day(p.dateOfBirth),
      verified: emailVerifiedAt || phoneVerifiedAt ? 'Yes' : 'No',
      createdAt: p.createdAt ? new Date(p.createdAt).toISOString().replace('T', ' ').slice(0, 16) : '',
    }));
    const columns: CsvColumn<Record<string, unknown>>[] = CLIENT_COLUMNS.map((c) => ({ header: c.header, value: (r) => r[c.key] }));
    return { csv: toCsv(columns, data), count: data.length };
  }

  /**
   * Each imported client gets a client login with no password: a client with
   * a phone number signs in on the WhatsApp login page with a code sent to it. A row whose email or
   * phone already belongs to anyone on the platform is skipped.
   */
  async import(text: string, dryRun: boolean): Promise<ImportReport> {
    const { headers, records } = readCsv(text);
    const known = new Set(CLIENT_COLUMNS.map(keyOf));
    const report: ImportReport = {
      dryRun,
      total: records.length,
      ready: 0,
      created: 0,
      duplicates: 0,
      errors: 0,
      ignoredColumns: headers.filter((h) => h && !known.has(h)),
      missingColumns: CLIENT_COLUMNS.filter((c) => c.required && !headers.includes(keyOf(c))).map((c) => c.header),
      rows: [],
    };
    if (report.missingColumns.length || records.length > MAX_IMPORT_ROWS) return report;

    const cc = await this.whatsappSettings.getDefaultCountryCode();
    const locations = await LocationMatcher.load(this.db);
    const seen = new Map<string, number>();

    for (const record of records) {
      const errors: ImportIssue[] = [];
      const warnings: ImportIssue[] = [];
      const v = record.values;
      const result: ImportRowResult = { row: record.rowNumber, name: v[keyOf(col('fullName'))] || '', outcome: 'READY', errors, warnings };
      report.rows.push(result);

      const prepared = this.prepare(v, errors, warnings, cc, locations);
      if (prepared) {
        const fileKeys = [prepared.email && `email:${prepared.email}`, prepared.e164 && `phone:${prepared.e164}`].filter(Boolean) as string[];
        const earlier = fileKeys.map((k) => seen.get(k)).find((r) => r !== undefined);
        if (earlier !== undefined) errors.push({ code: 'duplicateFile', params: { row: earlier } });
        else fileKeys.forEach((k) => seen.set(k, record.rowNumber));

        const match = errors.length ? null : await this.findExisting(prepared, cc);
        if (match) {
          result.outcome = 'DUPLICATE';
          errors.push({ code: 'duplicate', column: match.column, params: { match: match.name } });
        }
      }

      if (result.outcome === 'DUPLICATE') {
        report.duplicates++;
        continue;
      }
      if (errors.length || !prepared) {
        result.outcome = 'ERROR';
        report.errors++;
        continue;
      }
      if (dryRun) {
        report.ready++;
        continue;
      }
      try {
        const id = await this.create(prepared, cc);
        Object.assign(result, { outcome: 'CREATED', id });
        report.created++;
      } catch (err) {
        if (err instanceof ConflictException) {
          // Someone registered with this email or number between the check and now.
          result.outcome = 'DUPLICATE';
          errors.push({ code: 'duplicate', column: col(prepared.email ? 'email' : 'phone').header, params: { match: '' } });
          report.duplicates++;
        } else {
          result.outcome = 'ERROR';
          errors.push({ code: 'failed', params: { message: (err as Error).message?.slice(0, 200) ?? '' } });
          report.errors++;
        }
      }
    }
    return report;
  }

  private prepare(v: Record<string, string>, errors: ImportIssue[], warnings: ImportIssue[], cc: string, locations: LocationMatcher): PreparedClient | null {
    const text = (key: string) => textCell(v, col(key), errors, keyOf);
    const enumCell = <T extends string>(key: string, allowed: readonly T[]): T | null => {
      const raw = text(key);
      if (!raw) return null;
      const parsed = parseEnum(raw, allowed);
      if (!parsed) errors.push({ code: 'invalid', column: col(key).header, value: raw, params: { allowed: allowed.join(', ') } });
      return parsed;
    };

    const fullName = text('fullName');
    const email = text('email')?.toLowerCase() ?? null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ code: 'invalid', column: col('email').header, value: email });

    const phoneCell = (key: string) => {
      let raw = text(key);
      if (!raw) return { raw: null, e164: null };
      if (/^7\d{8}$/.test(raw)) {
        raw = `0${raw}`;
        warnings.push({ code: 'fixedPhone', column: col(key).header, value: raw });
      }
      const e164 = normalizePhone(raw, cc);
      if (!e164) errors.push({ code: 'invalid', column: col(key).header, value: raw });
      return { raw, e164 };
    };
    const phone = phoneCell('phone');
    const alternate = phoneCell('alternatePhone');
    if (!email && !phone.raw && !errors.some((e) => e.column === col('email').header || e.column === col('phone').header)) errors.push({ code: 'needsContact' });

    const status = enumCell('status', IMPORT_STATUSES) ?? 'ACTIVE';
    const preferredContactMethod = enumCell('preferredContactMethod', contactMethodEnum);
    if (preferredContactMethod === 'EMAIL' && !email) errors.push({ code: 'needsEmail', column: col('preferredContactMethod').header });
    const preferredContactTime = enumCell('preferredContactTime', contactTimeEnum);
    const registrantType = enumCell('registrantType', registrantTypeEnum);
    const recipientName = text('recipientName');
    const recipientRelationship = enumCell('recipientRelationship', recipientRelationshipEnum);
    const ageRaw = text('recipientAge');
    let recipientAge: number | null = null;
    if (ageRaw) {
      const n = Number(ageRaw);
      if (!Number.isInteger(n) || n < 0 || n > 120) errors.push({ code: 'invalid', column: col('recipientAge').header, value: ageRaw });
      else recipientAge = n;
    }
    const recipientGender = enumCell('recipientGender', recipientGenderEnum);
    const nic = text('nic')?.toUpperCase() ?? null;
    const dobRaw = text('dateOfBirth');
    const dateOfBirth = dobRaw ? parseDate(dobRaw) : null;
    if (dobRaw && (!dateOfBirth || dateOfBirth > new Date().toISOString().slice(0, 10))) errors.push({ code: 'invalid', column: col('dateOfBirth').header, value: dobRaw });
    const gender = enumCell('gender', genderEnum);
    const location = locations.resolve(v[keyOf(col('district'))] ?? '', v[keyOf(col('city'))] ?? '', warnings, { district: col('district').header, city: col('city').header });

    const patient = {
      phone: phone.raw,
      alternatePhone: alternate.raw,
      status,
      preferredContactMethod,
      preferredContactTime,
      // A guardian without a recipient name is still a guardian; SELF clears the recipient fields.
      registrantType,
      recipientName: registrantType === 'SELF' ? null : recipientName,
      recipientRelationship: registrantType === 'SELF' ? null : recipientRelationship,
      recipientAge,
      recipientGender,
      nic,
      dateOfBirth: dateOfBirth as unknown as Date,
      gender,
      permanentAddress: text('permanentAddress'),
      careAddress: text('careAddress'),
      careNeeds: text('careNeeds'),
      careSchedule: enumCell('careSchedule', careScheduleEnum),
      careStart: enumCell('careStart', careStartEnum),
      preferredCaregiverGender: enumCell('preferredCaregiverGender', caregiverGenderPreferenceEnum),
      notes: text('notes'),
      districtId: location.districtId,
      cityId: location.cityId,
    };
    if (errors.length) return null;
    return { fullName: fullName!, email, e164: phone.e164, patient };
  }

  /** The email or number already belongs to someone - a client, a caregiver or a staff login. */
  private async findExisting(p: PreparedClient, cc: string): Promise<{ column: string; name: string } | null> {
    if (p.email) {
      const [row] = await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.email, p.email)).limit(1);
      if (row) return { column: col('email').header, name: row.fullName };
    }
    if (p.e164) {
      try {
        await assertWhatsappNumberAvailable(this.db, p.e164, cc);
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
        // Name whoever holds it - a login, a caregiver or another client - so staff can check.
        const variants = phoneVariants(p.e164, cc);
        const [login] = await this.db.select({ name: users.fullName }).from(users).where(eq(users.phone, p.e164)).limit(1);
        const [caregiver] = login ? [] : await this.db.select({ name: caregivers.fullName }).from(caregivers).where(inArray(caregivers.livePrimaryPhone, variants)).limit(1);
        const [client] = login || caregiver ? [] : await this.db.select({ name: patients.fullName }).from(patients).where(inArray(patients.phone, variants)).limit(1);
        return { column: col('phone').header, name: (login ?? caregiver ?? client)?.name ?? '' };
      }
    }
    return null;
  }

  private async create(p: PreparedClient, cc: string): Promise<string> {
    return this.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      // Re-checked inside the transaction, as the registration routes do.
      if (p.e164) await assertWhatsappNumberAvailable(txDb, p.e164, cc);
      if (p.email) {
        const [taken] = await txDb.select({ id: users.id }).from(users).where(eq(users.email, p.email)).limit(1);
        if (taken) throw new ConflictException('An account with this email already exists');
      }
      const location = await resolveLocationRefs(txDb, { districtId: p.patient.districtId, cityId: p.patient.cityId });
      const userId = uuid();
      await tx.insert(users).values({
        id: userId,
        email: p.email,
        // No password. The number counts as confirmed because the office
        // entered it - which is what lets the client sign in from the
        // WhatsApp login page; every sign-in still needs the code sent to it.
        // (Left unconfirmed, the public site has no screen that would let
        // them confirm it, so they could never get in.)
        passwordHash: null,
        phone: p.e164,
        phoneVerifiedAt: p.e164 ? new Date() : null,
        emailVerifiedAt: null,
        fullName: p.fullName,
        role: 'PATIENT_GUARDIAN',
        isActive: true,
      });
      const id = uuid();
      await tx.insert(patients).values({
        ...p.patient,
        id,
        userId,
        fullName: p.fullName,
        district: location?.district ?? null,
        city: location?.city ?? null,
        province: location?.province ?? null,
        postalCode: location?.postalCode ?? null,
      });
      return id;
    });
  }
}
